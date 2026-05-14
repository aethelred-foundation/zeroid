export interface TrustedOIDCSubject {
  displayName: string | null;
  metadata: unknown;
  teeAttestationId: string | null;
  updatedAt: Date;
}

export interface TrustedGovernmentStatus {
  verified?: boolean;
  provider: string;
  referenceId?: string;
  verifiedFields?: string[];
  verifiedAt?: Date | string;
  expiresAt?: Date | string;
}

export interface TrustedOIDCClaimDependencies {
  getGovernmentVerificationStatus: (identityId: string) => Promise<TrustedGovernmentStatus | null>;
  isTEEAttestationValid: (attestationId: string) => Promise<boolean>;
}

let defaultDependenciesPromise: Promise<TrustedOIDCClaimDependencies> | null = null;

const VERIFIED_OIDC_CLAIM_EVIDENCE: Record<string, string[]> = {
  name: ['name', 'fullName', 'full_name'],
  given_name: ['givenName', 'given_name'],
  family_name: ['familyName', 'family_name'],
  middle_name: ['middleName', 'middle_name'],
  preferred_username: ['preferredUsername', 'preferred_username'],
  picture: ['photo', 'picture'],
  email: ['email'],
  address: ['address'],
  phone_number: ['mobile', 'phone', 'phoneNumber', 'phone_number'],
  birthdate: ['dateOfBirth', 'birthdate', 'date_of_birth'],
  nationality: ['nationality'],
};

const STRING_OIDC_CLAIMS = new Set([
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'preferred_username',
  'picture',
  'email',
  'phone_number',
  'birthdate',
  'nationality',
]);

const ADDRESS_CLAIMS = new Set([
  'formatted',
  'street_address',
  'locality',
  'region',
  'postal_code',
  'country',
]);
const DEFAULT_GOVERNMENT_EVIDENCE_MAX_AGE_DAYS = 365;
const GOVERNMENT_EVIDENCE_FUTURE_SKEW_MS = 5 * 60 * 1000;

export async function buildTrustedOIDCClaims(
  subjectId: string,
  subject: TrustedOIDCSubject,
  dependencies?: TrustedOIDCClaimDependencies,
): Promise<Record<string, unknown>> {
  const metadata =
    subject.metadata && typeof subject.metadata === 'object'
      ? (subject.metadata as Record<string, unknown>)
      : {};
  const resolvedDependencies = dependencies ?? (await getDefaultTrustedOIDCClaimDependencies());
  const [governmentStatus, teeAttested] = await Promise.all([
    resolvedDependencies.getGovernmentVerificationStatus(subjectId),
    subject.teeAttestationId
      ? resolvedDependencies.isTEEAttestationValid(subject.teeAttestationId)
      : Promise.resolve(false),
  ]);

  const claims: Record<string, unknown> = {
    updated_at: Math.floor(subject.updatedAt.getTime() / 1000),
  };

  const currentGovernmentStatus = isCurrentGovernmentStatus(governmentStatus)
    ? governmentStatus
    : null;
  const verifiedSubjectClaims = currentGovernmentStatus
    ? extractVerifiedOIDCClaims(metadata, currentGovernmentStatus)
    : {};

  Object.assign(claims, verifiedSubjectClaims);

  if (typeof verifiedSubjectClaims.email === 'string') {
    claims.email_verified = true;
  }

  if (typeof verifiedSubjectClaims.phone_number === 'string') {
    claims.phone_number_verified = true;
  }

  if (currentGovernmentStatus) {
    claims.kyc_level = 'government_verified';
    claims.kyc_provider = String(currentGovernmentStatus.provider).toLowerCase();

    const verifiedAt = parseDate(currentGovernmentStatus.verifiedAt);
    if (verifiedAt) {
      claims.kyc_verified_at = Math.floor(verifiedAt.getTime() / 1000);
    }
  }

  if (teeAttested) {
    claims.verification_level = currentGovernmentStatus
      ? 'government_and_tee'
      : 'tee_attested';
  } else if (currentGovernmentStatus) {
    claims.verification_level = 'government_verified';
  }

  if (teeAttested && subject.teeAttestationId) {
    claims.tee_attestation_id = subject.teeAttestationId;
  }

  if (currentGovernmentStatus && Object.keys(verifiedSubjectClaims).length > 0) {
    claims.verified_claims = {
      verification: {
        trust_framework: 'zeroid_government',
        assurance_level: 'government_verified',
        provider: String(currentGovernmentStatus.provider).toLowerCase(),
        verified_at: currentGovernmentStatus.verifiedAt,
        expires_at: currentGovernmentStatus.expiresAt,
        reference_id: currentGovernmentStatus.referenceId,
      },
      claims: verifiedSubjectClaims,
    };
  }

  return claims;
}

function extractVerifiedOIDCClaims(
  metadata: Record<string, unknown>,
  governmentStatus: TrustedGovernmentStatus,
): Record<string, unknown> {
  const verifiedClaimSource = getVerifiedClaimSource(metadata);
  if (!verifiedClaimSource) return {};

  const verifiedFields = new Set(
    (governmentStatus.verifiedFields ?? []).map((field) => normalizeClaimField(field)),
  );
  const claims: Record<string, unknown> = {};

  for (const [claimName, evidenceFields] of Object.entries(VERIFIED_OIDC_CLAIM_EVIDENCE)) {
    if (!evidenceFields.some((field) => verifiedFields.has(normalizeClaimField(field)))) {
      continue;
    }

    const value = verifiedClaimSource[claimName];
    if (STRING_OIDC_CLAIMS.has(claimName)) {
      const sanitized = sanitizeStringClaim(claimName, value);
      if (sanitized) {
        claims[claimName] = sanitized;
      }
    } else if (claimName === 'address') {
      const sanitizedAddress = sanitizeAddressClaim(value);
      if (sanitizedAddress) {
        claims.address = sanitizedAddress;
      }
    }
  }

  return claims;
}

function getVerifiedClaimSource(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const direct =
    getRecord(metadata.verified_oidc_claims) ??
    getRecord(metadata.verifiedOIDCClaims) ??
    getRecord(metadata.verifiedClaims);
  if (direct) return direct;

  const identityAssuranceClaims = getRecord(getRecord(metadata.verified_claims)?.claims);
  return identityAssuranceClaims;
}

function isCurrentGovernmentStatus(
  governmentStatus: TrustedGovernmentStatus | null,
): governmentStatus is TrustedGovernmentStatus {
  if (!governmentStatus || governmentStatus.verified === false) {
    return false;
  }

  const verifiedAt = parseDate(governmentStatus.verifiedAt);
  if (!verifiedAt) {
    return false;
  }

  const now = Date.now();
  if (verifiedAt.getTime() > now + GOVERNMENT_EVIDENCE_FUTURE_SKEW_MS) {
    return false;
  }

  if (now - verifiedAt.getTime() > getGovernmentEvidenceMaxAgeMs()) {
    return false;
  }

  const expiresAt = parseDate(governmentStatus.expiresAt);
  return !expiresAt || expiresAt.getTime() > now;
}

function sanitizeStringClaim(claimName: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;

  if (claimName === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return null;
  }

  if (claimName === 'phone_number' && !/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return null;
  }

  if (claimName === 'picture') {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }

  return trimmed;
}

function sanitizeAddressClaim(value: unknown): Record<string, string> | null {
  const address = getRecord(value);
  if (!address) return null;

  const sanitized: Record<string, string> = {};
  for (const [field, fieldValue] of Object.entries(address)) {
    if (!ADDRESS_CLAIMS.has(field) || typeof fieldValue !== 'string') {
      continue;
    }

    const trimmed = fieldValue.trim();
    if (trimmed.length > 0 && trimmed.length <= 256) {
      sanitized[field] = trimmed;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeClaimField(field: string): string {
  return field.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function parseDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getGovernmentEvidenceMaxAgeMs(): number {
  const configuredDays = Number(
    process.env.OIDC_GOVERNMENT_EVIDENCE_MAX_AGE_DAYS ??
      DEFAULT_GOVERNMENT_EVIDENCE_MAX_AGE_DAYS,
  );
  const days =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : DEFAULT_GOVERNMENT_EVIDENCE_MAX_AGE_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

async function getDefaultTrustedOIDCClaimDependencies(): Promise<TrustedOIDCClaimDependencies> {
  defaultDependenciesPromise ??= Promise.all([
    import('../government-api'),
    import('../tee'),
  ]).then(([governmentModule, teeModule]) => ({
    getGovernmentVerificationStatus: (identityId: string) =>
      governmentModule.governmentAPIService.getVerificationStatus(identityId),
    isTEEAttestationValid: (attestationId: string) =>
      teeModule.teeService.isAttestationValid(attestationId),
  }));

  return defaultDependenciesPromise;
}
