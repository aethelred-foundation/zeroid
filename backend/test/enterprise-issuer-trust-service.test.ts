const mockIdentityFindFirst = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockIdentityUpdate = jest.fn();
const mockIssuerTrustFindFirst = jest.fn();
const mockIssuerTrustCreate = jest.fn();
const mockIssuerTrustFindMany = jest.fn();
const mockIssuerTrustUpdate = jest.fn();
const mockIssuerKeyHistoryUpdateMany = jest.fn();
const mockIssuerKeyHistoryCreate = jest.fn();
const mockIssuerKeyHistoryFindFirst = jest.fn();
const mockIssuerKeyHistoryFindMany = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    identity: {
      findFirst: mockIdentityFindFirst,
      findUnique: mockIdentityFindUnique,
      update: mockIdentityUpdate,
    },
    issuerTrustRecord: {
      findFirst: mockIssuerTrustFindFirst,
      create: mockIssuerTrustCreate,
      findMany: mockIssuerTrustFindMany,
      update: mockIssuerTrustUpdate,
    },
    issuerKeyHistory: {
      updateMany: mockIssuerKeyHistoryUpdateMany,
      create: mockIssuerKeyHistoryCreate,
      findFirst: mockIssuerKeyHistoryFindFirst,
      findMany: mockIssuerKeyHistoryFindMany,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

import {
  issuerTrustRegistryService,
  IssuerTrustRegistryError,
} from '../src/services/enterprise/issuer-trust-service';

describe('IssuerTrustRegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockIdentityFindFirst.mockResolvedValue({
      id: 'issuer-1',
      did: 'did:aethelred:issuer:alpha',
      status: 'ACTIVE',
    });
    mockIdentityFindUnique.mockResolvedValue({
      id: 'issuer-1',
      did: 'did:aethelred:issuer:alpha',
      status: 'ACTIVE',
    });
    mockIssuerTrustFindFirst.mockResolvedValue(null);
    mockIssuerTrustCreate.mockResolvedValue({
      id: 'trust-1',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      status: 'PENDING_REVIEW',
      accreditationScope: 'SOVEREIGN',
      assuranceLevel: 'QUALIFIED',
      allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
      allowedJurisdictions: ['UAE', 'EU'],
      proposedByIdentityId: 'admin-1',
      accreditedByIdentityId: null,
      suspensionReason: null,
      metadata: { trustFramework: 'ADGM' },
      accreditedAt: null,
      expiresAt: new Date('2027-04-21T00:00:00.000Z'),
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      issuer: {
        displayName: 'Alpha Registry Authority',
      },
    });
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        organizationId: 'org-1',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:alpha',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'QUALIFIED',
        allowedCredentialTypes: ['kyc_enhanced'],
        allowedJurisdictions: ['UAE'],
        proposedByIdentityId: 'admin-1',
        accreditedByIdentityId: 'admin-2',
        suspensionReason: null,
        metadata: null,
        accreditedAt: new Date('2026-04-22T00:00:00.000Z'),
        expiresAt: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-22T00:00:00.000Z'),
        issuer: {
          displayName: 'Alpha Registry Authority',
        },
      },
    ]);
    mockIssuerTrustUpdate.mockResolvedValue({
      id: 'trust-1',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      status: 'ACCREDITED',
      accreditationScope: 'SOVEREIGN',
      assuranceLevel: 'QUALIFIED',
      allowedCredentialTypes: ['kyc_enhanced'],
      allowedJurisdictions: ['UAE'],
      proposedByIdentityId: 'admin-1',
      accreditedByIdentityId: 'admin-2',
      suspensionReason: null,
      metadata: null,
      accreditedAt: new Date('2026-04-22T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      issuer: {
        displayName: 'Alpha Registry Authority',
      },
    });
    mockIssuerKeyHistoryCreate.mockResolvedValue({
      id: 'hist-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'ACTIVE',
      rotatedByIdentityId: 'admin-2',
      metadata: { hsm: 'aws-kms' },
      validFrom: new Date('2026-04-21T00:00:00.000Z'),
      validUntil: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockIssuerKeyHistoryFindMany.mockResolvedValue([
      {
        id: 'hist-1',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:alpha',
        keyVersion: '2',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
        status: 'ACTIVE',
        rotatedByIdentityId: 'admin-2',
        metadata: { hsm: 'aws-kms' },
        validFrom: new Date('2026-04-21T00:00:00.000Z'),
        validUntil: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);
    mockIssuerKeyHistoryFindFirst.mockResolvedValue({
      id: 'hist-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'ACTIVE',
      rotatedByIdentityId: 'admin-2',
      metadata: { hsm: 'aws-kms' },
      validFrom: new Date('2026-04-21T00:00:00.000Z'),
      validUntil: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
    });
  });

  it('registers an issuer trust record in pending review', async () => {
    const result = await issuerTrustRegistryService.registerIssuerTrust('org-1', 'admin-1', {
      issuerDid: 'did:aethelred:issuer:alpha',
      accreditationScope: 'sovereign',
      assuranceLevel: 'qualified',
      allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
      allowedJurisdictions: ['UAE', 'EU'],
      metadata: { trustFramework: 'ADGM' },
      expiresAt: '2027-04-21T00:00:00.000Z',
    });

    expect(mockIssuerTrustCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:alpha',
        status: 'PENDING_REVIEW',
      }),
    }));
    expect(result.status).toBe('pending_review');
    expect(result.issuerDisplayName).toBe('Alpha Registry Authority');
  });

  it('lists issuer trust records for an organization', async () => {
    const records = await issuerTrustRegistryService.listIssuerTrustRecords('org-1');
    expect(mockIssuerTrustFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-1' }),
    }));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('accredited');
  });

  it('loads a specific issuer trust record for evidence export', async () => {
    mockIssuerTrustFindFirst.mockResolvedValueOnce({
      id: 'trust-1',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      status: 'ACCREDITED',
      accreditationScope: 'SOVEREIGN',
      assuranceLevel: 'QUALIFIED',
      allowedCredentialTypes: ['kyc_enhanced'],
      allowedJurisdictions: ['UAE'],
      proposedByIdentityId: 'admin-1',
      accreditedByIdentityId: 'admin-2',
      suspensionReason: null,
      metadata: null,
      accreditedAt: new Date('2026-04-22T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      issuer: {
        displayName: 'Alpha Registry Authority',
      },
    });

    const record = await issuerTrustRegistryService.getIssuerTrustRecordById('trust-1', 'org-1');
    expect(record).toMatchObject({
      id: 'trust-1',
      status: 'accredited',
      issuerDisplayName: 'Alpha Registry Authority',
    });
  });

  it('accredits a pending issuer trust record', async () => {
    mockIssuerTrustFindFirst.mockResolvedValueOnce({
      id: 'trust-1',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      status: 'PENDING_REVIEW',
      issuer: { displayName: 'Alpha Registry Authority' },
    });

    const result = await issuerTrustRegistryService.accreditIssuer('trust-1', 'org-1', 'admin-2');
    expect(mockIssuerTrustUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trust-1' },
      data: expect.objectContaining({
        status: 'ACCREDITED',
        accreditedByIdentityId: 'admin-2',
      }),
    }));
    expect(result.status).toBe('accredited');
  });

  it('records issuer key history and updates the live identity key material', async () => {
    const result = await issuerTrustRegistryService.recordIssuerKeyVersion('issuer-1', 'admin-2', {
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      publicKey: '-----BEGIN PUBLIC KEY-----mock-key-----END PUBLIC KEY-----',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'active',
      metadata: { hsm: 'aws-kms' },
    });

    expect(mockIssuerKeyHistoryUpdateMany).toHaveBeenCalled();
    expect(mockIssuerKeyHistoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        issuerIdentityId: 'issuer-1',
        keyVersion: '2',
        status: 'ACTIVE',
      }),
    }));
    expect(mockIdentityUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'issuer-1' },
      data: expect.objectContaining({
        keyVersion: '2',
      }),
    }));
    expect(result.status).toBe('active');
  });

  it('lists issuer key history only when the issuer is trusted by the organization', async () => {
    mockIssuerTrustFindFirst
      .mockResolvedValueOnce({ id: 'trust-1' })
      .mockResolvedValueOnce({ id: 'trust-1' });

    const records = await issuerTrustRegistryService.listIssuerKeyHistory('org-1', 'issuer-1');
    expect(mockIssuerTrustFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: 'org-1',
        issuerIdentityId: 'issuer-1',
      },
      select: { id: true },
    }));
    expect(records).toHaveLength(1);

    const record = await issuerTrustRegistryService.getIssuerKeyHistoryRecord('org-1', 'issuer-1', 'hist-1');
    expect(record).toMatchObject({
      id: 'hist-1',
      keyVersion: '2',
      status: 'active',
    });
  });

  it('rejects issuer key history access when the issuer is outside the organization trust registry', async () => {
    mockIssuerTrustFindFirst.mockResolvedValueOnce(null);

    await expect(
      issuerTrustRegistryService.listIssuerKeyHistory('org-1', 'issuer-1'),
    ).rejects.toMatchObject<Partial<IssuerTrustRegistryError>>({
      code: 'ISSUER_TRUST_SCOPE_INVALID',
      statusCode: 404,
    });
  });

  it('rejects duplicate active trust records for the same issuer and organization', async () => {
    mockIssuerTrustFindFirst.mockResolvedValue({
      id: 'trust-existing',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      status: 'ACCREDITED',
      issuer: { displayName: 'Alpha Registry Authority' },
    });

    await expect(
      issuerTrustRegistryService.registerIssuerTrust('org-1', 'admin-1', {
        issuerIdentityId: 'issuer-1',
        allowedCredentialTypes: ['kyc_enhanced'],
      }),
    ).rejects.toMatchObject<Partial<IssuerTrustRegistryError>>({
      code: 'ISSUER_TRUST_DUPLICATE',
      statusCode: 409,
    });
  });
});
