const mockPolicyDefinitionFindUnique = jest.fn();
const mockPolicyDefinitionCreate = jest.fn();
const mockPolicyDefinitionFindMany = jest.fn();
const mockPolicyDefinitionFindFirst = jest.fn();
const mockPolicyDefinitionUpdate = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    policyDefinition: {
      findUnique: mockPolicyDefinitionFindUnique,
      create: mockPolicyDefinitionCreate,
      findMany: mockPolicyDefinitionFindMany,
      findFirst: mockPolicyDefinitionFindFirst,
      update: mockPolicyDefinitionUpdate,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

import { policyRegistryService, PolicyRegistryError } from '../src/services/enterprise/policy-registry-service';

describe('PolicyRegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyDefinitionFindUnique.mockResolvedValue(null);
    mockPolicyDefinitionFindMany.mockResolvedValue([]);
    mockPolicyDefinitionFindFirst.mockResolvedValue(null);
    mockPolicyDefinitionCreate.mockImplementation(async ({ data }: any) => ({
      id: 'policy-1',
      ...data,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    }));
    mockPolicyDefinitionUpdate.mockImplementation(async ({ data, where }: any) => ({
      id: where.id,
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: data.status,
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: data.approvedByIdentityId ?? null,
      effectiveFrom: data.effectiveFrom ?? null,
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    }));
  });

  it('creates a draft enterprise policy definition', async () => {
    const policy = await policyRegistryService.createPolicyDraft('org-1', 'admin-1', {
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      description: 'ADGM-first onboarding policy',
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
    });

    expect(mockPolicyDefinitionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        status: 'DRAFT',
      }),
    }));
    expect(policy).toMatchObject({
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      status: 'draft',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
    });
  });

  it('submits and approves a draft policy lifecycle', async () => {
    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-1',
        organizationId: 'org-1',
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        description: 'ADGM-first onboarding policy',
        status: 'DRAFT',
        definition: { riskModel: 'enhanced' },
        changeSummary: 'Adds ADGM issuer trust requirement',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-1',
        organizationId: 'org-1',
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        description: 'ADGM-first onboarding policy',
        status: 'PENDING_REVIEW',
        definition: { riskModel: 'enhanced' },
        changeSummary: 'Adds ADGM issuer trust requirement',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const submitted = await policyRegistryService.submitPolicyForReview('policy-1', 'org-1', 'admin-1');
    expect(submitted.status).toBe('pending_review');

    const approved = await policyRegistryService.approvePolicy(
      'policy-1',
      'org-1',
      'admin-2',
      '2026-05-01T00:00:00.000Z',
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedByIdentityId).toBe('admin-2');
    expect(approved.effectiveFrom?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('returns the effective approved policy version for an organization', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-2',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'APPROVED',
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-2',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    });

    const policy = await policyRegistryService.getEffectivePolicy('org-1', 'jurisdiction_compliance');
    expect(policy).toMatchObject({
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      status: 'approved',
    });
  });

  it('rejects duplicate policy versions per organization', async () => {
    mockPolicyDefinitionFindUnique.mockResolvedValue({
      id: 'existing-policy',
    });

    await expect(
      policyRegistryService.createPolicyDraft('org-1', 'admin-1', {
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        family: 'compliance',
        description: 'ADGM-first onboarding policy',
        definition: { riskModel: 'enhanced' },
      }),
    ).rejects.toMatchObject<Partial<PolicyRegistryError>>({
      code: 'POLICY_VERSION_DUPLICATE',
      statusCode: 409,
    });
  });
});
