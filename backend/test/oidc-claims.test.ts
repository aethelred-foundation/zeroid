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

describe('buildTrustedOIDCClaims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVerificationStatus.mockResolvedValue(null);
    mockIsAttestationValid.mockResolvedValue(false);
  });

  it('does not issue profile or contact claims from self-asserted subject metadata', async () => {
    const claims = await buildTrustedOIDCClaims('identity-1', {
      displayName: 'Alice Sovereign',
      metadata: {
        name: 'Alice Metadata',
        email: 'alice@example.test',
        email_verified: true,
      },
      teeAttestationId: 'attestation-stale',
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

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

  it('issues government and TEE claims only from current evidence', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-current',
      verifiedFields: ['fullName', 'email', 'mobile', 'address', 'nationality'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });
    mockIsAttestationValid.mockResolvedValueOnce(true);

    const claims = await buildTrustedOIDCClaims('identity-1', {
      displayName: null,
      metadata: {
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
      teeAttestationId: 'attestation-current',
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(claims).toMatchObject({
      name: 'Alice Sovereign',
      email: 'alice@example.test',
      email_verified: true,
      phone_number: '+971501234567',
      phone_number_verified: true,
      address: {
        formatted: 'Dubai, AE',
        country: 'AE',
      },
      nationality: 'ARE',
      kyc_level: 'government_verified',
      kyc_provider: 'emirates_id',
      kyc_verified_at: 1777334400,
      verification_level: 'government_and_tee',
      tee_attestation_id: 'attestation-current',
      verified_claims: {
        verification: expect.objectContaining({
          trust_framework: 'zeroid_government',
          assurance_level: 'government_verified',
          provider: 'emirates_id',
          reference_id: 'eid-current',
        }),
        claims: expect.objectContaining({
          name: 'Alice Sovereign',
          email: 'alice@example.test',
          phone_number: '+971501234567',
          nationality: 'ARE',
        }),
      },
    });
    expect(claims.address).not.toHaveProperty('internal_note');
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
      displayName: null,
      metadata: {},
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

    const claims = await buildTrustedOIDCClaims('identity-3', {
      displayName: null,
      metadata: {
        verified_oidc_claims: {
          name: 'Expired Alice',
          email: 'expired@example.test',
        },
      },
      teeAttestationId: null,
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(claims).toEqual({ updated_at: 1777334400 });
  });
});
