const routeRegistry: Record<string, Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>> = {};

const mockCreatePolicyDraft = jest.fn();
const mockListPolicies = jest.fn();
const mockGetPolicyById = jest.fn();
const mockSubmitPolicyForReview = jest.fn();
const mockApprovePolicy = jest.fn();
const mockDeprecatePolicy = jest.fn();
const mockRevokePolicy = jest.fn();
const mockGetEffectivePolicy = jest.fn();

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
  UpdateOrganizationGovernanceSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  enterpriseOrganizationService: {
    getGovernanceSettings: jest.fn(),
    updateGovernanceSettings: jest.fn(),
  },
}));

jest.mock('../src/services/enterprise/policy-governance-service', () => ({
  policyGovernanceService: {
    listGovernancePacks: jest.fn(() => []),
  },
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
    createPolicyDraft: mockCreatePolicyDraft,
    listPolicies: mockListPolicies,
    getPolicyById: mockGetPolicyById,
    submitPolicyForReview: mockSubmitPolicyForReview,
    approvePolicy: mockApprovePolicy,
    deprecatePolicy: mockDeprecatePolicy,
    revokePolicy: mockRevokePolicy,
    getEffectivePolicy: mockGetEffectivePolicy,
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

describe('enterprise policy registry routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatePolicyDraft.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'draft',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 0,
      approvalTrail: [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: null,
      effectiveFrom: null,
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockListPolicies.mockResolvedValue([]);
    mockGetPolicyById.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'approved',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 2,
      approvalTrail: [
        {
          identityId: 'admin-1',
          role: 'admin',
          approvalClasses: ['admin', 'risk'],
          matchedApprovalClasses: ['admin'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
          action: 'approve',
          decidedAt: '2026-05-01T00:00:00.000Z',
        },
        {
          identityId: 'auditor-1',
          role: 'auditor',
          approvalClasses: ['auditor', 'risk'],
          matchedApprovalClasses: ['risk'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
          action: 'approve',
          decidedAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'auditor-1',
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
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    });
    mockSubmitPolicyForReview.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'pending_review',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 0,
      approvalTrail: [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: null,
      effectiveFrom: null,
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockApprovePolicy.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'approved',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 2,
      approvalTrail: [
        {
          identityId: 'admin-1',
          role: 'admin',
          approvalClasses: ['admin', 'risk'],
          matchedApprovalClasses: ['admin'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
          action: 'approve',
          decidedAt: '2026-05-01T00:00:00.000Z',
        },
        {
          identityId: 'auditor-1',
          role: 'auditor',
          approvalClasses: ['auditor', 'risk'],
          matchedApprovalClasses: ['risk'],
          matchedApprovalJurisdictions: ['AE-ADGM'],
          action: 'approve',
          decidedAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockDeprecatePolicy.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'deprecated',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 2,
      approvalTrail: [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: null,
      deprecatedAt: new Date('2026-06-10T00:00:00.000Z'),
      deprecatedByIdentityId: 'admin-1',
      deprecationReason: 'Superseded by new policy',
      supersededByPolicyDefinitionId: 'policy-2',
      revokedAt: null,
      revokedByIdentityId: null,
      revocationReason: null,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    });
    mockRevokePolicy.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'revoked',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 2,
      approvalTrail: [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: null,
      deprecatedAt: new Date('2026-06-10T00:00:00.000Z'),
      deprecatedByIdentityId: 'admin-1',
      deprecationReason: 'Superseded by new policy',
      supersededByPolicyDefinitionId: 'policy-2',
      revokedAt: new Date('2026-06-15T00:00:00.000Z'),
      revokedByIdentityId: 'admin-1',
      revocationReason: 'Regulatory rollback',
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-06-15T00:00:00.000Z'),
    });
    mockGetEffectivePolicy.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'approved',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      requiredApprovalRoles: ['admin', 'auditor'],
      requiredApprovalClasses: ['admin', 'risk'],
      requiredApprovalJurisdictions: ['AE-ADGM'],
      governanceProfileId: 'enterprise.compliance',
      governanceProfileLabel: 'Enterprise / Compliance',
      governancePackId: 'baseline-core',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Baseline Core Governance Pack',
      governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      approvalCount: 2,
      approvalTrail: [],
      definition: { riskModel: 'enhanced' },
      changeSummary: 'Adds ADGM issuer trust requirement',
      proposedByIdentityId: 'admin-1',
      approvedByIdentityId: 'admin-1',
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
    });
  });

  it('creates a draft policy definition', async () => {
    const response = await invokeRoute('POST', '/policies', {
      body: {
        name: 'jurisdiction_compliance',
        version: '2026.05.2',
        family: 'compliance',
        description: 'ADGM-first onboarding policy',
        definition: { riskModel: 'enhanced' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'jurisdiction_compliance',
      status: 'draft',
    });
    expect(mockCreatePolicyDraft).toHaveBeenCalledWith('org-1', 'admin-1', expect.objectContaining({
      name: 'jurisdiction_compliance',
    }));
  });

  it('returns governance compatibility failures from policy draft creation', async () => {
    mockCreatePolicyDraft.mockRejectedValueOnce({
      message: 'Cross-border governance requires definition fields like transferRules, transferMechanisms, dataLocalization, or jurisdictionMatrix.',
      code: 'POLICY_GOVERNANCE_DEFINITION_INVALID',
      statusCode: 400,
    });

    const response = await invokeRoute('POST', '/policies', {
      body: {
        name: 'jurisdiction_cross_border',
        version: '2026.05.2',
        family: 'compliance',
        description: 'Cross-border policy with incomplete operating constraints',
        definition: { reviewCadence: 'daily' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      code: 'POLICY_GOVERNANCE_DEFINITION_INVALID',
    });
  });

  it('submits, approves, and fetches the effective policy version', async () => {
    const submitResponse = await invokeRoute('POST', '/policies/:policyId/submit', {
      params: { policyId: 'policy-1' },
    });
    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.body.data).toMatchObject({ status: 'pending_review' });

    const approveResponse = await invokeRoute('POST', '/policies/:policyId/approve', {
      params: { policyId: 'policy-1' },
      body: { effectiveFrom: '2026-05-01T00:00:00.000Z' },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.body.data).toMatchObject({ status: 'approved' });

    const effectiveResponse = await invokeRoute('GET', '/policies/:policyName/effective', {
      params: { policyName: 'jurisdiction_compliance' },
    });
    expect(effectiveResponse.statusCode).toBe(200);
    expect(effectiveResponse.body.data).toMatchObject({
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      status: 'approved',
    });
  });

  it('exports governed policy evidence bundles', async () => {
    const response = await invokeRoute('GET', '/policies/:policyId/evidence', {
      params: { policyId: 'policy-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetPolicyById).toHaveBeenCalledWith('policy-1', 'org-1');
    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.governance_evidence.v1',
      artifactType: 'policy_definition',
      artifact: expect.objectContaining({
        id: 'policy-1',
        governancePackId: 'baseline-core',
      }),
      governanceRegime: {
        family: 'compliance',
        pack: {
          id: 'baseline-core',
          version: '2026.04',
          label: 'Baseline Core Governance Pack',
        },
        profile: {
          id: 'enterprise.compliance',
          label: 'Enterprise / Compliance',
          rationale: ['Enterprise high-risk policies require dual-control approval.'],
        },
        approvalMode: 'dual_control',
        requiredApprovals: 2,
        requiredApprovalRoles: ['admin', 'auditor'],
        requiredApprovalClasses: ['admin', 'risk'],
        requiredApprovalJurisdictions: ['AE-ADGM'],
      },
      approvalProvenance: {
        proposedByIdentityId: 'admin-1',
        approvedByIdentityId: 'auditor-1',
        approvalCount: 2,
        quorum: expect.objectContaining({
          satisfied: true,
          currentApprovals: 2,
          requiredApprovals: 2,
          rolesSatisfied: ['admin', 'auditor'],
          classesSatisfied: ['admin', 'risk'],
          jurisdictionsSatisfied: ['AE-ADGM'],
        }),
      },
      lifecycle: expect.objectContaining({
        status: 'approved',
      }),
    });
  });

  it('deprecates and revokes a governed policy lifecycle', async () => {
    const deprecateResponse = await invokeRoute('POST', '/policies/:policyId/deprecate', {
      params: { policyId: 'policy-1' },
      body: {
        reason: 'Superseded by new policy',
        supersededByPolicyId: 'policy-2',
      },
    });
    expect(deprecateResponse.statusCode).toBe(200);
    expect(deprecateResponse.body.data).toMatchObject({ status: 'deprecated' });

    const revokeResponse = await invokeRoute('POST', '/policies/:policyId/revoke', {
      params: { policyId: 'policy-1' },
      body: {
        reason: 'Regulatory rollback',
      },
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.body.data).toMatchObject({ status: 'revoked' });
  });

  it('returns a pending-review response when policy quorum is not yet met', async () => {
    mockApprovePolicy.mockResolvedValueOnce({
      id: 'policy-1',
      organizationId: 'org-1',
      name: 'jurisdiction_compliance',
      version: '2026.05.2',
      family: 'compliance',
      reference: 'zeroid://policy/org/org-1/jurisdiction_compliance@2026.05.2',
      description: 'ADGM-first onboarding policy',
      status: 'pending_review',
      approvalMode: 'dual_control',
      requiredApprovals: 2,
      approvalCount: 1,
      approvalTrail: [
        { identityId: 'admin-1', action: 'approve', decidedAt: '2026-05-01T00:00:00.000Z' },
      ],
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

    const response = await invokeRoute('POST', '/policies/:policyId/approve', {
      params: { policyId: 'policy-1' },
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
