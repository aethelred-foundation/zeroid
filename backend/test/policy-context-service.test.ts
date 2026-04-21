const mockIssuerTrustFindMany = jest.fn();
const mockPolicyDefinitionFindFirst = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    policyDefinition: {
      findFirst: mockPolicyDefinitionFindFirst,
    },
    issuerTrustRecord: {
      findMany: mockIssuerTrustFindMany,
    },
  },
}));

import { policyContextService } from '../src/services/enterprise/policy-context-service';

describe('PolicyContextService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyDefinitionFindFirst.mockResolvedValue(null);
    mockIssuerTrustFindMany.mockResolvedValue([]);
  });

  it('resolves a versioned policy reference and trust anchors for evaluated issuer credentials', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        organizationId: 'org-1',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:1',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'QUALIFIED',
        allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
        allowedJurisdictions: ['AE-ADGM', 'EU-GDPR'],
        expiresAt: new Date('2027-04-21T00:00:00.000Z'),
        issuer: {
          displayName: 'Issuer One',
        },
      },
    ]);

    const context = await policyContextService.resolvePolicyContext(
      'jurisdiction_compliance',
      'org-1',
      {
        jurisdictionCodes: ['AE-ADGM'],
        credentials: [
          { issuerId: 'issuer-1', credentialType: 'kyc_enhanced' },
          { issuerId: 'issuer-1', credentialType: 'proof_of_residency' },
        ],
      },
    );

    expect(context).toMatchObject({
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/compliance/jurisdiction_compliance@2026.04.1',
      policyFamily: 'compliance',
      trustContext: {
        organizationId: 'org-1',
        evaluatedIssuerCount: 1,
        accreditedIssuerCount: 1,
        enforced: true,
      },
    });
    expect(context.trustContext?.anchors).toEqual([
      expect.objectContaining({
        issuerIdentityId: 'issuer-1',
        trustRecordId: 'trust-1',
        accepted: true,
        accreditationScope: 'sovereign',
        assuranceLevel: 'qualified',
        matchedJurisdictions: ['AE-ADGM'],
        evaluatedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
      }),
    ]);
  });

  it('returns only policy metadata when no credential trust inputs are provided', async () => {
    const context = await policyContextService.resolvePolicyContext('privacy_impact_assessment', 'org-1', {
      jurisdictionCodes: ['EU-GDPR'],
    });

    expect(context).toEqual({
      policyName: 'privacy_impact_assessment',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
      policyFamily: 'privacy',
    });
    expect(mockIssuerTrustFindMany).not.toHaveBeenCalled();
  });

  it('prefers an approved organization-specific policy definition over the static catalog', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      family: 'compliance',
    });

    const context = await policyContextService.resolvePolicyContext('jurisdiction_compliance', 'org-1', {
      jurisdictionCodes: ['AE-ADGM'],
    });

    expect(context).toEqual({
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      policyFamily: 'compliance',
    });
  });
});
