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

  it('does not issue verification claims from stale subject columns', async () => {
    const claims = await buildTrustedOIDCClaims('identity-1', {
      displayName: 'Alice Sovereign',
      metadata: {
        email: 'alice@example.test',
        email_verified: true,
      },
      teeAttestationId: 'attestation-stale',
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(mockGetVerificationStatus).toHaveBeenCalledWith('identity-1');
    expect(mockIsAttestationValid).toHaveBeenCalledWith('attestation-stale');
    expect(claims).toMatchObject({
      name: 'Alice Sovereign',
      email: 'alice@example.test',
      email_verified: true,
      updated_at: 1777334400,
    });
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
      verifiedFields: ['idNumber'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });
    mockIsAttestationValid.mockResolvedValueOnce(true);

    const claims = await buildTrustedOIDCClaims('identity-1', {
      displayName: null,
      metadata: {
        given_name: 'Alice',
        family_name: 'Sovereign',
        age_over_21: true,
      },
      teeAttestationId: 'attestation-current',
      updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(claims).toMatchObject({
      given_name: 'Alice',
      family_name: 'Sovereign',
      age_over_21: true,
      kyc_level: 'government_verified',
      kyc_provider: 'emirates_id',
      verification_level: 'government_and_tee',
      tee_attestation_id: 'attestation-current',
    });
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
});
