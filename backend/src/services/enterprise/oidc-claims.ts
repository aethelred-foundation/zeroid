export interface TrustedOIDCSubject {
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

const DEFAULT_GOVERNMENT_EVIDENCE_MAX_AGE_DAYS = 365;
const GOVERNMENT_EVIDENCE_FUTURE_SKEW_MS = 5 * 60 * 1000;

export async function buildTrustedOIDCClaims(
  subjectId: string,
  subject: TrustedOIDCSubject,
  dependencies?: TrustedOIDCClaimDependencies,
): Promise<Record<string, unknown>> {
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

  // Identity profile metadata is client-mutable and therefore never a source
  // of authoritative OIDC values. Until government-provider claim values have
  // a dedicated persisted evidence record, issue only status-level assurance
  // claims and fail closed for name, contact, address, and identity-assurance
  // claim values.
  const currentGovernmentStatus = isCurrentGovernmentStatus(governmentStatus)
    ? governmentStatus
    : null;
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

  return claims;
}

function isCurrentGovernmentStatus(
  governmentStatus: TrustedGovernmentStatus | null,
): governmentStatus is TrustedGovernmentStatus {
  if (!governmentStatus || governmentStatus.verified !== true) {
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
  return Boolean(expiresAt && expiresAt.getTime() > now);
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
