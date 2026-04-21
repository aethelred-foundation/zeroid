const mockPolicyDefinitionFindUnique = jest.fn();
const mockPolicyDefinitionCreate = jest.fn();
const mockPolicyDefinitionFindMany = jest.fn();
const mockPolicyDefinitionFindFirst = jest.fn();
const mockPolicyDefinitionUpdate = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockGetApprovalAuthority = jest.fn();

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

jest.mock('../src/services/enterprise/organization-service', () => ({
  ENTERPRISE_ROLES: ['viewer', 'operator', 'admin', 'compliance_officer', 'auditor'],
  ENTERPRISE_APPROVAL_CLASSES: ['admin', 'auditor', 'compliance', 'legal', 'operator', 'privacy', 'risk', 'sovereign_operator'],
  enterpriseOrganizationService: {
    getApprovalAuthority: mockGetApprovalAuthority,
  },
}));

import { policyRegistryService, PolicyRegistryError } from '../src/services/enterprise/policy-registry-service';

describe('PolicyRegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApprovalAuthority.mockImplementation(async (identityId: string, organizationId: string) => ({
      organizationId,
      organizationName: 'Org One',
      role: String(identityId).startsWith('auditor') ? 'auditor' : String(identityId).startsWith('compliance') ? 'compliance_officer' : 'admin',
      permissions: [],
      plan: 'enterprise',
      jurisdictions: ['AE-ADGM'],
      governanceSettings: {},
      approvalClasses: String(identityId).startsWith('auditor')
        ? ['auditor']
        : String(identityId).startsWith('compliance')
          ? ['compliance', 'risk']
          : ['admin'],
      approvalJurisdictions: ['AE-ADGM'],
    }));
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
      approvalMode: data.approvalMode ?? (
        String(where.id).includes('dual') ? 'DUAL_CONTROL'
          : String(where.id).includes('sod') ? 'SEPARATION_OF_DUTIES'
            : 'SINGLE_ADMIN'
      ),
      requiredApprovals: data.requiredApprovals ?? (
        String(where.id).includes('dual') ? 2 : 1
      ),
      requiredApprovalRoles: data.requiredApprovalRoles ?? (
        String(where.id).includes('routed') ? ['admin', 'auditor'] : []
      ),
      requiredApprovalClasses: data.requiredApprovalClasses ?? (
        String(where.id).includes('classed') ? ['legal', 'risk'] : []
      ),
      requiredApprovalJurisdictions: data.requiredApprovalJurisdictions ?? (
        String(where.id).includes('jurisdictional') ? ['EU-GDPR', 'AE-ADGM'] : []
      ),
      approvalTrail: data.approvalTrail ?? [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: data.approvedByIdentityId ?? null,
      effectiveFrom: data.effectiveFrom ?? null,
      expiresAt: null,
      deprecatedAt: data.deprecatedAt ?? null,
      deprecatedByIdentityId: data.deprecatedByIdentityId ?? null,
      deprecationReason: data.deprecationReason ?? null,
      supersededByPolicyDefinitionId: data.supersededByPolicyDefinitionId ?? null,
      revokedAt: data.revokedAt ?? null,
      revokedByIdentityId: data.revokedByIdentityId ?? null,
      revocationReason: data.revocationReason ?? null,
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
      approvalMode: 'single_admin',
      requiredApprovals: 1,
      approvalCount: 0,
      approvalTrail: [],
    });
  });

  it('auto-applies enterprise privacy governance baselines for high-risk policies', async () => {
    const policy = await policyRegistryService.createPolicyDraft('org-1', 'admin-1', {
      name: 'data_subject_access',
      version: '2026.05.2',
      family: 'privacy',
      description: 'Enterprise privacy governance for subject access workflows',
      definition: { workflow: 'dsar' },
      changeSummary: 'Introduces auditable DSAR approvals',
    });

    expect(mockPolicyDefinitionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: expect.arrayContaining(['admin', 'auditor']),
        requiredApprovalClasses: expect.arrayContaining(['privacy', 'legal']),
      }),
    }));
    expect(policy.requiredApprovals).toBe(2);
    expect(policy.requiredApprovalRoles).toEqual(expect.arrayContaining(['admin', 'auditor']));
    expect(policy.requiredApprovalClasses).toEqual(expect.arrayContaining(['privacy', 'legal']));
    expect(policy.governanceProfileId).toContain('privacy');
    expect(policy.governanceProfileId).toContain('enterprise');
    expect(policy.governanceProfileLabel).toContain('Privacy');
    expect(policy.governancePackId).toBe('enterprise-privacy');
    expect(policy.governancePackVersion).toBe('2026.04');
    expect(policy.governancePackLabel).toContain('Enterprise Privacy');
    expect(policy.governanceProfileRationale.length).toBeGreaterThan(0);
  });

  it('respects tenant-selected governance packs during policy creation', async () => {
    mockGetApprovalAuthority.mockResolvedValueOnce({
      organizationId: 'org-1',
      organizationName: 'Org One',
      role: 'admin',
      permissions: [],
      plan: 'starter',
      jurisdictions: ['AE-ADGM'],
      governanceSettings: {
        defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      },
      approvalClasses: ['admin'],
      approvalJurisdictions: ['AE-ADGM'],
    });

    const policy = await policyRegistryService.createPolicyDraft('org-1', 'admin-1', {
      name: 'regulatory_reporting',
      version: '2026.05.2',
      family: 'reporting',
      description: 'Pinned sovereign governance pack for reporting',
      definition: { reportType: 'SAR' },
      changeSummary: 'Pins sovereign operating mode',
    });

    expect(policy.governancePackId).toBe('sovereign-core');
    expect(policy.governancePackVersion).toBe('2026.04');
    expect(policy.governanceProfileRationale).toEqual(
      expect.arrayContaining(['Tenant governance pack sovereign-core@2026.04 was selected.']),
    );
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
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
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
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
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
    expect(approved.approvalCount).toBe(1);
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
      deprecatedAt: null,
      deprecatedByIdentityId: null,
      deprecationReason: null,
      supersededByPolicyDefinitionId: null,
      revokedAt: null,
      revokedByIdentityId: null,
      revocationReason: null,
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

  it('deprecates and revokes approved policy lifecycle transitions', async () => {
    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-1',
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
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-2',
        organizationId: 'org-1',
        name: 'jurisdiction_compliance',
        version: '2026.06.0',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.06.0',
        description: 'Replacement policy',
        status: 'APPROVED',
        definition: { riskModel: 'enhanced' },
        changeSummary: 'Replacement',
        proposedByIdentityId: 'admin-3',
        approvedByIdentityId: 'admin-4',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-1',
        organizationId: 'org-1',
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        description: 'ADGM-first onboarding policy',
        status: 'DEPRECATED',
        definition: { riskModel: 'enhanced' },
        changeSummary: 'Adds ADGM issuer trust requirement',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: 'admin-2',
        effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: null,
        deprecatedAt: new Date('2026-06-10T00:00:00.000Z'),
        deprecatedByIdentityId: 'admin-5',
        deprecationReason: 'Superseded by newer policy',
        supersededByPolicyDefinitionId: 'policy-2',
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      });

    const deprecated = await policyRegistryService.deprecatePolicy('policy-1', 'org-1', 'admin-5', {
      reason: 'Superseded by newer policy',
      supersededByPolicyId: 'policy-2',
      deprecatedAt: '2026-06-10T00:00:00.000Z',
    });
    expect(deprecated.status).toBe('deprecated');
    expect(deprecated.supersededByPolicyDefinitionId).toBe('policy-2');

    const revoked = await policyRegistryService.revokePolicy('policy-1', 'org-1', 'admin-6', {
      reason: 'Policy revoked due to regulatory error',
      revokedAt: '2026-06-15T00:00:00.000Z',
    });
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedByIdentityId).toBe('admin-6');
    expect(revoked.revokedAt?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('enforces separation of duties and dual-control approval governance', async () => {
    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-sod',
        organizationId: 'org-1',
        name: 'critical_policy',
        version: '2026.07.0',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/critical_policy@2026.07.0',
        description: 'Critical policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'SEPARATION_OF_DUTIES',
        requiredApprovals: 1,
        approvalTrail: [],
        definition: { riskModel: 'strict' },
        changeSummary: 'Critical change',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-dual',
        organizationId: 'org-1',
        name: 'critical_policy_dual',
        version: '2026.07.1',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/critical_policy_dual@2026.07.1',
        description: 'Critical dual control policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        approvalTrail: [],
        definition: { riskModel: 'strict' },
        changeSummary: 'Critical change',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-dual',
        organizationId: 'org-1',
        name: 'critical_policy_dual',
        version: '2026.07.1',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/critical_policy_dual@2026.07.1',
        description: 'Critical dual control policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        approvalTrail: [
          {
            identityId: 'admin-2',
            action: 'approve',
            decidedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
        definition: { riskModel: 'strict' },
        changeSummary: 'Critical change',
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    await expect(
      policyRegistryService.approvePolicy('policy-sod', 'org-1', 'admin-1'),
    ).rejects.toMatchObject<Partial<PolicyRegistryError>>({
      code: 'POLICY_APPROVE_SOD_REQUIRED',
      statusCode: 409,
    });

    const firstApproval = await policyRegistryService.approvePolicy(
      'policy-dual',
      'org-1',
      'admin-2',
      '2026-07-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.approvalCount).toBe(1);
    expect(firstApproval.requiredApprovals).toBe(2);

    const secondApproval = await policyRegistryService.approvePolicy(
      'policy-dual',
      'org-1',
      'admin-3',
      '2026-07-02T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalCount).toBe(2);
    expect(secondApproval.requiredApprovals).toBe(2);
  });

  it('enforces role-routed approval quorums for governed policies', async () => {
    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-routed',
        organizationId: 'org-1',
        name: 'sovereign_policy',
        version: '2026.08.0',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/sovereign_policy@2026.08.0',
        description: 'Sovereign-grade policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [],
        definition: { riskModel: 'strict' },
        changeSummary: 'Requires mixed-role quorum',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-routed',
        organizationId: 'org-1',
        name: 'sovereign_policy',
        version: '2026.08.0',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/sovereign_policy@2026.08.0',
        description: 'Sovereign-grade policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [
          {
            identityId: 'admin-2',
            role: 'admin',
            action: 'approve',
            decidedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        definition: { riskModel: 'strict' },
        changeSummary: 'Requires mixed-role quorum',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-routed',
        organizationId: 'org-1',
        name: 'sovereign_policy',
        version: '2026.08.0',
        family: 'compliance',
        reference: 'zeroid://policy/org/org-1/sovereign_policy@2026.08.0',
        description: 'Sovereign-grade policy',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [
          {
            identityId: 'admin-2',
            role: 'admin',
            action: 'approve',
            decidedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        definition: { riskModel: 'strict' },
        changeSummary: 'Requires mixed-role quorum',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const firstApproval = await policyRegistryService.approvePolicy(
      'policy-routed',
      'org-1',
      'admin-2',
      '2026-08-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.requiredApprovalRoles).toEqual(['admin', 'auditor']);
    expect(firstApproval.approvalTrail[0]).toMatchObject({ role: 'admin' });

    await expect(
      policyRegistryService.approvePolicy(
        'policy-routed',
        'org-1',
        'admin-3',
        '2026-08-02T00:00:00.000Z',
      ),
    ).rejects.toMatchObject<Partial<PolicyRegistryError>>({
      code: 'POLICY_APPROVE_ROLE_DUPLICATE',
      statusCode: 409,
    });

    const secondApproval = await policyRegistryService.approvePolicy(
      'policy-routed',
      'org-1',
      'auditor-1',
      '2026-08-03T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalCount).toBe(2);
    expect(secondApproval.requiredApprovalRoles).toEqual(['admin', 'auditor']);
    expect(secondApproval.approvalTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'admin' }),
        expect.objectContaining({ role: 'auditor' }),
      ]),
    );
  });

  it('enforces approval classes and jurisdiction-scoped authority for governed policies', async () => {
    mockGetApprovalAuthority
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        organizationName: 'Org One',
        role: 'admin',
        permissions: ['approval:class:legal', 'approval:jurisdiction:EU-GDPR'],
        plan: 'enterprise',
        jurisdictions: ['AE-ADGM'],
        approvalClasses: ['admin', 'legal'],
        approvalJurisdictions: ['EU-GDPR'],
      })
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        organizationName: 'Org One',
        role: 'compliance_officer',
        permissions: ['approval:class:risk', 'approval:jurisdiction:AE-ADGM'],
        plan: 'enterprise',
        jurisdictions: ['AE-ADGM'],
        approvalClasses: ['compliance', 'risk'],
        approvalJurisdictions: ['AE-ADGM'],
      });

    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-classed-jurisdictional',
        organizationId: 'org-1',
        name: 'cross_border_sovereign_policy',
        version: '2026.09.0',
        family: 'privacy',
        reference: 'zeroid://policy/org/org-1/cross_border_sovereign_policy@2026.09.0',
        description: 'Requires legal and risk with jurisdiction routing',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: [],
        requiredApprovalClasses: ['legal', 'risk'],
        requiredApprovalJurisdictions: ['EU-GDPR', 'AE-ADGM'],
        approvalTrail: [],
        definition: { controls: ['dpia', 'transfer_impact_assessment'] },
        changeSummary: 'Sovereign cross-border controls',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-classed-jurisdictional',
        organizationId: 'org-1',
        name: 'cross_border_sovereign_policy',
        version: '2026.09.0',
        family: 'privacy',
        reference: 'zeroid://policy/org/org-1/cross_border_sovereign_policy@2026.09.0',
        description: 'Requires legal and risk with jurisdiction routing',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: [],
        requiredApprovalClasses: ['legal', 'risk'],
        requiredApprovalJurisdictions: ['EU-GDPR', 'AE-ADGM'],
        approvalTrail: [
          {
            identityId: 'admin-legal',
            role: 'admin',
            approvalClasses: ['admin', 'legal'],
            matchedApprovalClasses: ['legal'],
            matchedApprovalJurisdictions: ['EU-GDPR'],
            action: 'approve',
            decidedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        definition: { controls: ['dpia', 'transfer_impact_assessment'] },
        changeSummary: 'Sovereign cross-border controls',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const firstApproval = await policyRegistryService.approvePolicy(
      'policy-classed-jurisdictional',
      'org-1',
      'admin-legal',
      '2026-09-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.requiredApprovalClasses).toEqual(['legal', 'risk']);
    expect(firstApproval.requiredApprovalJurisdictions).toEqual(['EU-GDPR', 'AE-ADGM']);
    expect(firstApproval.approvalTrail[0]).toMatchObject({
      matchedApprovalClasses: ['legal'],
      matchedApprovalJurisdictions: ['EU-GDPR'],
    });

    const secondApproval = await policyRegistryService.approvePolicy(
      'policy-classed-jurisdictional',
      'org-1',
      'compliance-risk',
      '2026-09-02T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matchedApprovalClasses: ['legal'],
          matchedApprovalJurisdictions: ['EU-GDPR'],
        }),
        expect.objectContaining({
          matchedApprovalClasses: ['risk'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
        }),
      ]),
    );
  });

  it('allows dual-control approval to complete when a single role acts as a gated lane', async () => {
    mockPolicyDefinitionFindFirst
      .mockResolvedValueOnce({
        id: 'policy-single-role-dual',
        organizationId: 'org-1',
        name: 'privacy_impact_assessment',
        version: '2026.10.0',
        family: 'privacy',
        reference: 'zeroid://policy/org/org-1/privacy_impact_assessment@2026.10.0',
        description: 'Dual-control policy with a single admin role gate',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin'],
        requiredApprovalClasses: [],
        requiredApprovalJurisdictions: [],
        approvalTrail: [],
        definition: { controls: ['dpia'] },
        changeSummary: 'Require two distinct admin approvers',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'policy-single-role-dual',
        organizationId: 'org-1',
        name: 'privacy_impact_assessment',
        version: '2026.10.0',
        family: 'privacy',
        reference: 'zeroid://policy/org/org-1/privacy_impact_assessment@2026.10.0',
        description: 'Dual-control policy with a single admin role gate',
        status: 'PENDING_REVIEW',
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin'],
        requiredApprovalClasses: [],
        requiredApprovalJurisdictions: [],
        approvalTrail: [
          {
            identityId: 'admin-2',
            role: 'admin',
            approvalClasses: ['admin'],
            matchedApprovalClasses: [],
            matchedApprovalJurisdictions: [],
            action: 'approve',
            decidedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
        definition: { controls: ['dpia'] },
        changeSummary: 'Require two distinct admin approvers',
        proposedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: null,
        deprecatedAt: null,
        deprecatedByIdentityId: null,
        deprecationReason: null,
        supersededByPolicyDefinitionId: null,
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const firstApproval = await policyRegistryService.approvePolicy(
      'policy-single-role-dual',
      'org-1',
      'admin-2',
      '2026-10-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');

    const secondApproval = await policyRegistryService.approvePolicy(
      'policy-single-role-dual',
      'org-1',
      'admin-3',
      '2026-10-02T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalCount).toBe(2);
  });
});
