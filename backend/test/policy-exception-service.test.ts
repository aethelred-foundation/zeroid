const mockPolicyExceptionCreate = jest.fn();
const mockPolicyExceptionFindMany = jest.fn();
const mockPolicyExceptionFindFirst = jest.fn();
const mockPolicyExceptionUpdate = jest.fn();
const mockAuditLogCreate = jest.fn();

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

jest.mock('../src/services/enterprise/policy-registry-service', () => ({
  policyRegistryService: {
    getEffectivePolicy: mockGetEffectivePolicy,
  },
}));

import { policyExceptionService, PolicyExceptionError } from '../src/services/enterprise/policy-exception-service';

describe('PolicyExceptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      status: data.status,
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: data.approvedByIdentityId ?? null,
      effectiveFrom: data.effectiveFrom ?? null,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
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
    });
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
});
