export interface TrustedOIDCSubject {
  displayName: string | null;
  metadata: unknown;
  teeAttestationId: string | null;
  updatedAt: Date;
}

export interface TrustedOIDCClaimDependencies {
  getGovernmentVerificationStatus: (identityId: string) => Promise<{ provider: string } | null>;
  isTEEAttestationValid: (attestationId: string) => Promise<boolean>;
}

let defaultDependenciesPromise: Promise<TrustedOIDCClaimDependencies> | null = null;

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

  if (subject.displayName) {
    claims.name = subject.displayName;
  }

  for (const field of [
    'given_name',
    'family_name',
    'middle_name',
    'preferred_username',
    'picture',
    'email',
    'address',
    'phone_number',
  ] as const) {
    const value = metadata[field];
    if (typeof value === 'string' && value.length > 0) {
      claims[field] = value;
    }
  }

  for (const field of [
    'email_verified',
    'phone_number_verified',
    'age_over_18',
    'age_over_21',
  ] as const) {
    const value = metadata[field];
    if (typeof value === 'boolean') {
      claims[field] = value;
    }
  }

  if (governmentStatus) {
    claims.kyc_level = 'government_verified';
    claims.kyc_provider = String(governmentStatus.provider).toLowerCase();
  }

  if (teeAttested) {
    claims.verification_level = governmentStatus
      ? 'government_and_tee'
      : 'tee_attested';
  } else if (governmentStatus) {
    claims.verification_level = 'government_verified';
  }

  if (teeAttested && subject.teeAttestationId) {
    claims.tee_attestation_id = subject.teeAttestationId;
  }

  return claims;
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
