const mockGetVerificationStatus = jest.fn();
const mockIsAttestationValid = jest.fn();

jest.mock('../src/services/government-api', () => ({
  governmentAPIService: {
    getVerificationStatus: mockGetVerificationStatus,
  },
}));

jest.mock('../src/services/tee', () => ({
  teeService: {
    isAttestationValid: mockIsAttestationValid,
  },
}));

import { buildTrustedOIDCClaims } from '../src/services/enterprise/oidc-claims';

function legacySubject(
  metadata: Record<string, unknown>,
  teeAttestationId: string | null,
  displayName: string | null = null,
) {
  return {
    displayName,
    metadata,
    teeAttestationId,
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
  };
}

describe('buildTrustedOIDCClaims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVerificationStatus.mockResolvedValue(null);
    mockIsAttestationValid.mockResolvedValue(false);
  });

  it('does not issue profile or contact claims from self-asserted subject metadata', async () => {
    const claims = await buildTrustedOIDCClaims(
      'identity-1',
      legacySubject(
        {
          name: 'Alice Metadata',
          email: 'alice@example.test',
          email_verified: true,
        },
        'attestation-stale',
        'Alice Sovereign',
      ),
    );

    expect(mockGetVerificationStatus).toHaveBeenCalledWith('identity-1');
    expect(mockIsAttestationValid).toHaveBeenCalledWith('attestation-stale');
    expect(claims).toMatchObject({ updated_at: 1777334400 });
    expect(claims).not.toHaveProperty('name');
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('email_verified');
    expect(claims).not.toHaveProperty('kyc_level');
    expect(claims).not.toHaveProperty('kyc_provider');
    expect(claims).not.toHaveProperty('verification_level');
    expect(claims).not.toHaveProperty('tee_attestation_id');
  });

  it('never promotes user metadata to verified claims even when current government evidence exists', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-current',
      verifiedFields: ['fullName', 'email', 'mobile', 'address', 'nationality'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });
    mockIsAttestationValid.mockResolvedValueOnce(true);

    const claims = await buildTrustedOIDCClaims(
      'identity-1',
      legacySubject(
        {
          verified_oidc_claims: {
            name: 'Alice Sovereign',
            email: 'alice@example.test',
            phone_number: '+971501234567',
            address: {
              formatted: 'Dubai, AE',
              country: 'AE',
              internal_note: 'do-not-emit',
            },
            nationality: 'ARE',
          },
          given_name: 'Unverified',
          age_over_21: true,
        },
        'attestation-current',
      ),
    );

    expect(claims).toMatchObject({
      kyc_level: 'government_verified',
      kyc_provider: 'emirates_id',
      kyc_verified_at: 1777334400,
      verification_level: 'government_and_tee',
      tee_attestation_id: 'attestation-current',
    });
    expect(claims).not.toHaveProperty('name');
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('email_verified');
    expect(claims).not.toHaveProperty('phone_number');
    expect(claims).not.toHaveProperty('phone_number_verified');
    expect(claims).not.toHaveProperty('address');
    expect(claims).not.toHaveProperty('nationality');
    expect(claims).not.toHaveProperty('verified_claims');
    expect(claims).not.toHaveProperty('given_name');
    expect(claims).not.toHaveProperty('age_over_21');
  });

  it('does not call the TEE service when no attestation id exists', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'UAE_PASS',
      referenceId: 'uaepass-current',
      verifiedFields: ['uuid'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims('identity-2', {
      teeAttestationId: null,
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(mockIsAttestationValid).not.toHaveBeenCalled();
    expect(claims).toMatchObject({
      kyc_level: 'government_verified',
      kyc_provider: 'uae_pass',
      verification_level: 'government_verified',
    });
  });

  it('does not emit verified claim values from expired government evidence', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-expired',
      verifiedFields: ['fullName', 'email'],
      verifiedAt: new Date('2024-04-28T00:00:00.000Z'),
      expiresAt: new Date('2025-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims(
      'identity-3',
      legacySubject(
        {
          verified_oidc_claims: {
            name: 'Expired Alice',
            email: 'expired@example.test',
          },
        },
        null,
      ),
    );

    expect(claims).toEqual({ updated_at: 1777334400 });
  });

  it('does not emit verified claims when government evidence has no verification timestamp', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-no-timestamp',
      verifiedFields: ['fullName', 'email'],
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims(
      'identity-4',
      legacySubject(
        {
          verified_oidc_claims: {
            name: 'Undated Alice',
            email: 'undated@example.test',
          },
        },
        null,
      ),
    );

    expect(claims).toEqual({ updated_at: 1777334400 });
  });

  it('does not emit verified claims from stale government evidence even before expiry', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-stale',
      verifiedFields: ['fullName', 'email'],
      verifiedAt: new Date('2024-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims(
      'identity-5',
      legacySubject(
        {
          verified_oidc_claims: {
            name: 'Stale Alice',
            email: 'stale@example.test',
          },
        },
        null,
      ),
    );

    expect(claims).toEqual({ updated_at: 1777334400 });
  });

  it('requires an explicit verified=true status before issuing assurance claims', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      provider: 'EMIRATES_ID',
      referenceId: 'eid-implicit',
      verifiedFields: ['fullName'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims('identity-6', {
      teeAttestationId: null,
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(claims).toEqual({ updated_at: 1777334400 });
  });

  it('requires an explicit evidence expiry before issuing assurance claims', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-no-expiry',
      verifiedFields: ['fullName'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    const claims = await buildTrustedOIDCClaims('identity-7', {
      teeAttestationId: null,
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(claims).toEqual({ updated_at: 1777334400 });
  });
});
