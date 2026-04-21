const routeRegistry: Record<string, Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>> = {};

const mockCreateExceptionRequest = jest.fn();
const mockListExceptions = jest.fn();
const mockApproveException = jest.fn();
const mockRejectException = jest.fn();
const mockRevokeException = jest.fn();

jest.mock('express', () => {
  const createRouter = () => {
    const router: any = {
      use: jest.fn(() => router),
      get: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`GET ${path}`] = handlers;
        return router;
      }),
      post: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`POST ${path}`] = handlers;
        return router;
      }),
      patch: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`PATCH ${path}`] = handlers;
        return router;
      }),
      delete: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`DELETE ${path}`] = handlers;
        return router;
      }),
    };
    return router;
  };

  return {
    Router: jest.fn(() => createRouter()),
  };
}, { virtual: true });

jest.mock('winston', () => {
  const noop = jest.fn();
  return {
    createLogger: jest.fn(() => ({ info: noop, warn: noop, error: noop, debug: noop })),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      json: jest.fn(),
    },
    transports: { Console: jest.fn() },
  };
}, { virtual: true });

jest.mock('../src/middleware/enterprise', () => ({
  requireEnterpriseContext: () => (req: Record<string, any>, _res: unknown, next: () => void) => {
    req.identity = { id: 'admin-1' };
    req.enterpriseContext = {
      organizationId: 'org-1',
      role: 'admin',
      membershipId: 'membership-1',
    };
    next();
  },
}));

jest.mock('../src/middleware/rateLimit', () => ({
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/enterprise/webhook-system', () => ({
  webhookSystem: {},
  WebhookRegistrationSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  WebhookUpdateSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/api-gateway', () => ({
  apiGateway: {},
  CreateAPIKeySchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/oidc-bridge', () => ({
  oidcBridge: { getDiscoveryDocument: jest.fn(), getJWKS: jest.fn() },
  OIDCClientRegistrationSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/sla-monitor', () => ({
  slaMonitor: {},
  SLADefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/organization-service', () => ({
  CreateOrganizationSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  AddOrganizationMemberSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  enterpriseOrganizationService: {},
}));

jest.mock('../src/services/enterprise/issuer-trust-service', () => ({
  issuerTrustRegistryService: {},
  RegisterIssuerTrustSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RecordIssuerKeySchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/policy-registry-service', () => ({
  POLICY_APPROVAL_MODES: ['single_admin', 'separation_of_duties', 'dual_control'],
  CreatePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  DeprecatePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RevokePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  policyRegistryService: {
    createPolicyDraft: jest.fn(),
    listPolicies: jest.fn(),
    submitPolicyForReview: jest.fn(),
    approvePolicy: jest.fn(),
    deprecatePolicy: jest.fn(),
    revokePolicy: jest.fn(),
    getEffectivePolicy: jest.fn(),
  },
}));

jest.mock('../src/services/enterprise/policy-exception-service', () => ({
  CreatePolicyExceptionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RevokePolicyExceptionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  policyExceptionService: {
    createExceptionRequest: mockCreateExceptionRequest,
    listExceptions: mockListExceptions,
    approveException: mockApproveException,
    rejectException: mockRejectException,
    revokeException: mockRevokeException,
  },
}));

jest.mock('../src/index', () => ({
  prisma: {},
}));

import '../src/routes/enterprise/integration';

async function invokeRoute(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: Record<string, unknown>; params?: Record<string, string>; query?: Record<string, unknown> } = {},
): Promise<{ statusCode: number; body: any }> {
  const handlers = routeRegistry[`${method} ${path}`];
  if (!handlers) {
    throw new Error(`Route not registered: ${method} ${path}`);
  }

  const req: Record<string, any> = {
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
    headers: {},
    path,
  };

  let statusCode = 200;
  let responseBody: any;
  let ended = false;

  const res: Record<string, any> = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      responseBody = payload;
      ended = true;
      return res;
    },
  };

  for (const handler of handlers) {
    if (ended) break;
    await new Promise<void>((resolve, reject) => {
      let nextCalled = false;
      const next = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      try {
        const result = handler(req, res, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(() => {
            if (!nextCalled) resolve();
          }).catch(reject);
          return;
        }
        if (!nextCalled) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  return { statusCode, body: responseBody };
}

describe('enterprise policy exception routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExceptionRequest.mockResolvedValue({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      status: 'pending_review',
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: null,
      effectiveFrom: null,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      metadata: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockListExceptions.mockResolvedValue([]);
    mockApproveException.mockResolvedValue({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      status: 'approved',
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      metadata: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockRejectException.mockResolvedValue({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      status: 'rejected',
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: null,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      metadata: { rejectionReason: 'Rejected by enterprise administrator' },
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockRevokeException.mockResolvedValue({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      status: 'revoked',
      requestedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      revokedAt: new Date('2026-05-15T00:00:00.000Z'),
      revokedByIdentityId: 'admin-1',
      revocationReason: 'Override revoked after treaty withdrawal',
      metadata: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-15T00:00:00.000Z'),
    });
  });

  it('creates and lists policy exception requests', async () => {
    const createResponse = await invokeRoute('POST', '/policies/exceptions', {
      body: {
        policyName: 'jurisdiction_compliance',
        subjectEntityId: 'entity-1',
        scope: 'subject',
        justification: 'Temporary sovereign override for onboarding due to treaty obligations',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.body.data).toMatchObject({
      policyName: 'jurisdiction_compliance',
      status: 'pending_review',
    });

    const listResponse = await invokeRoute('GET', '/policies/exceptions', {
      query: { policyName: 'jurisdiction_compliance' },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(mockListExceptions).toHaveBeenCalledWith('org-1', expect.objectContaining({
      policyName: 'jurisdiction_compliance',
    }));
  });

  it('approves and rejects exception requests', async () => {
    const approveResponse = await invokeRoute('POST', '/policies/exceptions/:exceptionId/approve', {
      params: { exceptionId: 'exception-1' },
      body: { effectiveFrom: '2026-05-01T00:00:00.000Z' },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.body.data).toMatchObject({ status: 'approved' });

    const rejectResponse = await invokeRoute('POST', '/policies/exceptions/:exceptionId/reject', {
      params: { exceptionId: 'exception-1' },
      body: { reason: 'Override no longer justified' },
    });
    expect(rejectResponse.statusCode).toBe(200);
    expect(rejectResponse.body.data).toMatchObject({ status: 'rejected' });

    const revokeResponse = await invokeRoute('POST', '/policies/exceptions/:exceptionId/revoke', {
      params: { exceptionId: 'exception-1' },
      body: { reason: 'Override revoked after treaty withdrawal' },
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.body.data).toMatchObject({ status: 'revoked' });
  });

  it('returns a pending-review response when exception quorum is not yet met', async () => {
    mockApproveException.mockResolvedValueOnce({
      id: 'exception-1',
      organizationId: 'org-1',
      policyDefinitionId: 'policy-1',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.05.2',
      policyReference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      subjectEntityId: 'entity-1',
      scope: 'subject',
      justification: 'Temporary sovereign override for onboarding',
      conditions: { reviewEveryDays: 30 },
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      approvalCount: 1,
      approvalTrail: [
        { identityId: 'admin-1', action: 'approve', decidedAt: '2026-05-01T00:00:00.000Z' },
      ],
      status: 'pending_review',
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

    const response = await invokeRoute('POST', '/policies/exceptions/:exceptionId/approve', {
      params: { exceptionId: 'exception-1' },
      body: { effectiveFrom: '2026-05-01T00:00:00.000Z' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'pending_review',
      requiredApprovals: 2,
      approvalCount: 1,
    });
    expect(response.body.message).toContain('additional approvals required');
  });
});
