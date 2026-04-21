const mockPolicyExceptionCreate = jest.fn();
const mockPolicyExceptionFindMany = jest.fn();
const mockPolicyExceptionFindFirst = jest.fn();
const mockPolicyExceptionUpdate = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockGetApprovalAuthority = jest.fn();

const mockGetEffectivePolicy = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    policyException: {
      create: mockPolicyExceptionCreate,
      findMany: mockPolicyExceptionFindMany,
      findFirst: mockPolicyExceptionFindFirst,
      update: mockPolicyExceptionUpdate,
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

jest.mock('../src/services/enterprise/policy-registry-service', () => ({
  POLICY_APPROVAL_MODES: ['single_admin', 'separation_of_duties', 'dual_control'],
  policyRegistryService: {
    getEffectivePolicy: mockGetEffectivePolicy,
  },
}));

import { policyExceptionService, PolicyExceptionError } from '../src/services/enterprise/policy-exception-service';

describe('PolicyExceptionService', () => {
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
    mockGetEffectivePolicy.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
    });
    mockPolicyExceptionCreate.mockImplementation(async ({ data }: any) => ({
      id: 'exception-1',
      ...data,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    }));
    mockPolicyExceptionFindMany.mockResolvedValue([]);
    mockPolicyExceptionFindFirst.mockResolvedValue(null);
    mockPolicyExceptionUpdate.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'SUBJECT',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
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
        String(where.id).includes('classed') ? ['privacy', 'risk'] : []
      ),
      requiredApprovalJurisdictions: data.requiredApprovalJurisdictions ?? (
        String(where.id).includes('jurisdictional') ? ['EU-GDPR', 'AE-ADGM'] : []
      ),
      approvalTrail: data.approvalTrail ?? [],
      status: data.status,
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: data.approvedByIdentityId ?? null,
      effectiveFrom: data.effectiveFrom ?? null,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      revokedAt: data.revokedAt ?? null,
      revokedByIdentityId: data.revokedByIdentityId ?? null,
      revocationReason: data.revocationReason ?? null,
      metadata: data.metadata ?? null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    }));
  });

  it('creates a pending policy exception request against the effective policy', async () => {
    const exception = await policyExceptionService.createExceptionRequest('org-1', 'admin-1', {
      policyName: 'jurisdiction_compliance',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding due to treaty obligations',
      conditions: { reviewEveryDays: 30 },
      expiresAt: '2026-06-01T00:00:00.000Z',
    });

    expect(mockPolicyExceptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        status: 'PENDING_REVIEW',
      }),
    }));
    expect(exception).toMatchObject({
      status: 'pending_review',
      scope: 'subject',
      policyVersion: '2026.05.2',
      approvalMode: 'single_admin',
      requiredApprovals: 1,
      approvalCount: 0,
    });
  });

  it('auto-applies enterprise privacy governance baselines to exception requests', async () => {
    mockGetEffectivePolicy.mockResolvedValueOnce({
      id: 'policy-privacy-1',
      organizationId: 'org-1',
      name: 'data_subject_access',
      version: '2026.05.2',
      family: 'privacy',
      reference: 'zeroid://policy/org/org-1/data_subject_access@2026.05.2',
    });

    const exception = await policyExceptionService.createExceptionRequest('org-1', 'admin-1', {
      policyName: 'data_subject_access',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary override for a regulator-observed subject access workflow',
      conditions: { reviewEveryDays: 14 },
    });

    expect(mockPolicyExceptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: expect.arrayContaining(['admin', 'auditor']),
        requiredApprovalClasses: expect.arrayContaining(['privacy', 'legal']),
      }),
    }));
    expect(exception.requiredApprovals).toBe(2);
    expect(exception.requiredApprovalRoles).toEqual(expect.arrayContaining(['admin', 'auditor']));
    expect(exception.requiredApprovalClasses).toEqual(expect.arrayContaining(['privacy', 'legal']));
  });

  it('approves and rejects exception lifecycle transitions', async () => {
    mockPolicyExceptionFindFirst
      .mockResolvedValueOnce({
        id: 'exception-1',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override for onboarding',
        conditions: { reviewEveryDays: 30 },
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-1',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override for onboarding',
        conditions: { reviewEveryDays: 30 },
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const approved = await policyExceptionService.approveException(
      'exception-1',
      'org-1',
      'admin-2',
      '2026-05-01T00:00:00.000Z',
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedByIdentityId).toBe('admin-2');
    expect(approved.approvalCount).toBe(1);

    const rejected = await policyExceptionService.rejectException(
      'exception-1',
      'org-1',
      'admin-2',
      'Override no longer justified',
    );
    expect(rejected.status).toBe('rejected');
  });

  it('lists and resolves active approved exceptions', async () => {
    mockPolicyExceptionFindMany
      .mockResolvedValueOnce([
        {
          id: 'exception-1',
          organizationId: 'org-1',
          policyDefinitionId: 'policy-1',
          policyName: 'jurisdiction_compliance',
          policyVersion: '2026.05.2',
          policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
          subjectEntityId: 'entity-1',
          scope: 'SUBJECT',
          justification: 'Temporary sovereign override for onboarding',
          conditions: { reviewEveryDays: 30 },
          status: 'APPROVED',
          requestedByIdentityId: 'admin-1',
          approvedByIdentityId: 'admin-2',
          effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
          expiresAt: new Date('2026-06-01T00:00:00.000Z'),
          revokedAt: null,
          revokedByIdentityId: null,
          revocationReason: null,
          metadata: null,
          createdAt: new Date('2026-04-21T00:00:00.000Z'),
          updatedAt: new Date('2026-04-21T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'exception-1',
          organizationId: 'org-1',
          policyDefinitionId: 'policy-1',
          policyName: 'jurisdiction_compliance',
          policyVersion: '2026.05.2',
          policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
          subjectEntityId: 'entity-1',
          scope: 'SUBJECT',
          justification: 'Temporary sovereign override for onboarding',
          conditions: { reviewEveryDays: 30 },
          status: 'APPROVED',
          requestedByIdentityId: 'admin-1',
          approvedByIdentityId: 'admin-2',
          effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
          expiresAt: new Date('2026-06-01T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-04-21T00:00:00.000Z'),
          updatedAt: new Date('2026-04-21T00:00:00.000Z'),
        },
      ]);

    const listed = await policyExceptionService.listExceptions('org-1', { status: 'approved' });
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe('approved');

    const active = await policyExceptionService.getActiveExceptions('org-1', 'jurisdiction_compliance', 'entity-1');
    expect(active).toHaveLength(1);
    expect(active[0].subjectEntityId).toBe('entity-1');
  });

  it('fails when there is no active policy to waive', async () => {
    mockGetEffectivePolicy.mockResolvedValue(null);

    await expect(
      policyExceptionService.createExceptionRequest('org-1', 'admin-1', {
        policyName: 'unknown_policy',
        scope: 'organization',
        justification: 'Need a temporary override while sovereign approval is in flight.',
      }),
    ).rejects.toMatchObject<Partial<PolicyExceptionError>>({
      code: 'POLICY_EXCEPTION_POLICY_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('revokes an approved exception lifecycle', async () => {
    mockPolicyExceptionFindFirst.mockResolvedValue({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'SUBJECT',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      status: 'APPROVED',
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-2',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      revokedAt: null,
      revokedByIdentityId: null,
      revocationReason: null,
      metadata: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });

    const revoked = await policyExceptionService.revokeException('exception-1', 'org-1', 'admin-3', {
      reason: 'Override revoked after treaty withdrawal',
      revokedAt: '2026-05-15T00:00:00.000Z',
    });

    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedByIdentityId).toBe('admin-3');
    expect(revoked.revokedAt?.toISOString()).toBe('2026-05-15T00:00:00.000Z');
  });

  it('enforces separation of duties and dual-control exception approval governance', async () => {
    mockPolicyExceptionFindFirst
      .mockResolvedValueOnce({
        id: 'exception-sod',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'SEPARATION_OF_DUTIES',
        requiredApprovals: 1,
        approvalTrail: [],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-dual',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        approvalTrail: [],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-dual',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        approvalTrail: [
          {
            identityId: 'admin-2',
            action: 'approve',
            decidedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'admin-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    await expect(
      policyExceptionService.approveException('exception-sod', 'org-1', 'admin-1'),
    ).rejects.toMatchObject<Partial<PolicyExceptionError>>({
      code: 'POLICY_EXCEPTION_APPROVE_SOD_REQUIRED',
      statusCode: 409,
    });

    const firstApproval = await policyExceptionService.approveException(
      'exception-dual',
      'org-1',
      'admin-2',
      '2026-05-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.approvalCount).toBe(1);
    expect(firstApproval.requiredApprovals).toBe(2);

    const secondApproval = await policyExceptionService.approveException(
      'exception-dual',
      'org-1',
      'admin-3',
      '2026-05-02T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalCount).toBe(2);
    expect(secondApproval.requiredApprovals).toBe(2);
  });

  it('enforces mixed-role quorum for governed policy exceptions', async () => {
    mockPolicyExceptionFindFirst
      .mockResolvedValueOnce({
        id: 'exception-routed',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-routed',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [
          {
            identityId: 'admin-2',
            role: 'admin',
            action: 'approve',
            decidedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-routed',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        approvalTrail: [
          {
            identityId: 'admin-2',
            role: 'admin',
            action: 'approve',
            decidedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const firstApproval = await policyExceptionService.approveException(
      'exception-routed',
      'org-1',
      'admin-2',
      '2026-05-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.requiredApprovalRoles).toEqual(['admin', 'auditor']);
    expect(firstApproval.approvalTrail[0]).toMatchObject({ role: 'admin' });

    await expect(
      policyExceptionService.approveException(
        'exception-routed',
        'org-1',
        'admin-3',
        '2026-05-02T00:00:00.000Z',
      ),
    ).rejects.toMatchObject<Partial<PolicyExceptionError>>({
      code: 'POLICY_EXCEPTION_APPROVE_ROLE_DUPLICATE',
      statusCode: 409,
    });

    const secondApproval = await policyExceptionService.approveException(
      'exception-routed',
      'org-1',
      'auditor-1',
      '2026-05-03T00:00:00.000Z',
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

  it('enforces approval classes and jurisdiction-scoped authority for policy exceptions', async () => {
    mockGetApprovalAuthority
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        organizationName: 'Org One',
        role: 'admin',
        permissions: ['approval:class:privacy', 'approval:jurisdiction:EU-GDPR'],
        plan: 'enterprise',
        jurisdictions: ['AE-ADGM'],
        approvalClasses: ['admin', 'privacy'],
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

    mockPolicyExceptionFindFirst
      .mockResolvedValueOnce({
        id: 'exception-classed-jurisdictional',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'data_subject_access',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/data_subject_access@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: [],
        requiredApprovalClasses: ['privacy', 'risk'],
        requiredApprovalJurisdictions: ['EU-GDPR', 'AE-ADGM'],
        approvalTrail: [],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'exception-classed-jurisdictional',
        organizationId: 'org-1',
        policyDefinitionId: 'policy-1',
        policyName: 'data_subject_access',
        policyVersion: '2026.05.2',
        policyReference: 'zeroid://policy/org/org-1/data_subject_access@2026.05.2',
        subjectEntityId: 'entity-1',
        scope: 'SUBJECT',
        justification: 'Temporary sovereign override',
        conditions: { reviewEveryDays: 30 },
        approvalMode: 'DUAL_CONTROL',
        requiredApprovals: 2,
        requiredApprovalRoles: [],
        requiredApprovalClasses: ['privacy', 'risk'],
        requiredApprovalJurisdictions: ['EU-GDPR', 'AE-ADGM'],
        approvalTrail: [
          {
            identityId: 'admin-privacy',
            role: 'admin',
            approvalClasses: ['admin', 'privacy'],
            matchedApprovalClasses: ['privacy'],
            matchedApprovalJurisdictions: ['EU-GDPR'],
            action: 'approve',
            decidedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        status: 'PENDING_REVIEW',
        requestedByIdentityId: 'operator-1',
        approvedByIdentityId: null,
        effectiveFrom: null,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        revokedByIdentityId: null,
        revocationReason: null,
        metadata: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      });

    const firstApproval = await policyExceptionService.approveException(
      'exception-classed-jurisdictional',
      'org-1',
      'admin-privacy',
      '2026-05-01T00:00:00.000Z',
    );
    expect(firstApproval.status).toBe('pending_review');
    expect(firstApproval.requiredApprovalClasses).toEqual(['privacy', 'risk']);
    expect(firstApproval.requiredApprovalJurisdictions).toEqual(['EU-GDPR', 'AE-ADGM']);
    expect(firstApproval.approvalTrail[0]).toMatchObject({
      matchedApprovalClasses: ['privacy'],
      matchedApprovalJurisdictions: ['EU-GDPR'],
    });

    const secondApproval = await policyExceptionService.approveException(
      'exception-classed-jurisdictional',
      'org-1',
      'compliance-risk',
      '2026-05-02T00:00:00.000Z',
    );
    expect(secondApproval.status).toBe('approved');
    expect(secondApproval.approvalTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matchedApprovalClasses: ['privacy'],
          matchedApprovalJurisdictions: ['EU-GDPR'],
        }),
        expect.objectContaining({
          matchedApprovalClasses: ['risk'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
        }),
      ]),
    );
  });
});
