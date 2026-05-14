const routeRegistry: Record<
  string,
  Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>
> = {};

const mockGetGovernanceSettings = jest.fn();
const mockUpdateGovernanceSettings = jest.fn();
const mockListGovernancePacks = jest.fn();
const mockGetAnalytics = jest.fn();
const mockGetViolations = jest.fn();
const mockGetAlerts = jest.fn();
const mockRegisterSLA = jest.fn();
const mockUpdateGovernanceSchemaSafeParse = jest.fn();

jest.mock(
  'express',
  () => {
    const createRouter = () => {
      const router: any = {
        use: jest.fn(() => router),
        get: jest.fn(
          (
            path: string,
            ...handlers: Array<
              (req: any, res: any, next: (err?: unknown) => void) => unknown
            >
          ) => {
            routeRegistry[`GET ${path}`] = handlers;
            return router;
          },
        ),
        post: jest.fn(
          (
            path: string,
            ...handlers: Array<
              (req: any, res: any, next: (err?: unknown) => void) => unknown
            >
          ) => {
            routeRegistry[`POST ${path}`] = handlers;
            return router;
          },
        ),
        patch: jest.fn(
          (
            path: string,
            ...handlers: Array<
              (req: any, res: any, next: (err?: unknown) => void) => unknown
            >
          ) => {
            routeRegistry[`PATCH ${path}`] = handlers;
            return router;
          },
        ),
        delete: jest.fn(
          (
            path: string,
            ...handlers: Array<
              (req: any, res: any, next: (err?: unknown) => void) => unknown
            >
          ) => {
            routeRegistry[`DELETE ${path}`] = handlers;
            return router;
          },
        ),
      };
      return router;
    };

    return {
      Router: jest.fn(() => createRouter()),
    };
  },
  { virtual: true },
);

jest.mock(
  'winston',
  () => {
    const noop = jest.fn();
    return {
      createLogger: jest.fn(() => ({
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
      })),
      format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        json: jest.fn(),
      },
      transports: { Console: jest.fn() },
    };
  },
  { virtual: true },
);

jest.mock('../src/middleware/enterprise', () => ({
  requireEnterpriseContext:
    () => (req: Record<string, any>, _res: unknown, next: () => void) => {
      req.identity = { id: 'admin-1' };
      if (req.headers?.['x-test-skip-enterprise-context'] === 'true') {
        next();
        return;
      }
      req.enterpriseContext = {
        organizationId: 'org-1',
        role: 'admin',
        membershipId: 'membership-1',
      };
      next();
    },
}));

jest.mock('../src/middleware/rateLimit', () => ({
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

jest.mock('../src/services/enterprise/webhook-system', () => ({
  webhookSystem: {},
  WebhookRegistrationSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  WebhookUpdateSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/api-gateway', () => ({
  apiGateway: {
    getAnalytics: mockGetAnalytics,
  },
  CreateAPIKeySchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/oidc-bridge', () => ({
  oidcBridge: { getDiscoveryDocument: jest.fn(), getJWKS: jest.fn() },
  OIDCClientRegistrationSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/sla-monitor', () => ({
  slaMonitor: {
    registerSLA: mockRegisterSLA,
    getViolations: mockGetViolations,
    getAlerts: mockGetAlerts,
  },
  SLADefinitionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/organization-service', () => ({
  CreateOrganizationSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  AddOrganizationMemberSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  UpdateOrganizationGovernanceSchema: {
    safeParse: (value: unknown) => mockUpdateGovernanceSchemaSafeParse(value),
  },
  enterpriseOrganizationService: {
    getGovernanceSettings: mockGetGovernanceSettings,
    updateGovernanceSettings: mockUpdateGovernanceSettings,
  },
}));

jest.mock('../src/services/enterprise/issuer-trust-service', () => ({
  issuerTrustRegistryService: {},
  RegisterIssuerTrustSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  RecordIssuerKeySchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/policy-registry-service', () => ({
  POLICY_APPROVAL_MODES: [
    'single_admin',
    'separation_of_duties',
    'dual_control',
  ],
  CreatePolicyDefinitionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  DeprecatePolicyDefinitionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  RevokePolicyDefinitionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
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
  CreatePolicyExceptionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  RevokePolicyExceptionSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
  policyExceptionService: {
    createExceptionRequest: jest.fn(),
    listExceptions: jest.fn(),
    approveException: jest.fn(),
    rejectException: jest.fn(),
    revokeException: jest.fn(),
  },
}));

jest.mock('../src/services/enterprise/policy-governance-service', () => ({
  policyGovernanceService: {
    listGovernancePacks: mockListGovernancePacks,
  },
}));

jest.mock('../src/index', () => ({
  prisma: {},
}));

import '../src/routes/enterprise/integration';

async function invokeRoute(
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  } = {},
): Promise<{ statusCode: number; body: any }> {
  const handlers = routeRegistry[`${method} ${path}`];
  if (!handlers) {
    throw new Error(`Route not registered: ${method} ${path}`);
  }

  const req: Record<string, any> = {
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
    headers: options.headers ?? {},
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
          (result as Promise<unknown>)
            .then(() => {
              if (!nextCalled) resolve();
            })
            .catch(reject);
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

describe('enterprise organization governance routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGovernanceSettings.mockResolvedValue({
      defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      familyPacks: {
        privacy: { packId: 'enterprise-privacy', version: '2026.04' },
      },
    });
    mockUpdateGovernanceSettings.mockResolvedValue({
      defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      familyPacks: {
        privacy: { packId: 'enterprise-privacy', version: '2026.04' },
      },
    });
    mockListGovernancePacks.mockResolvedValue?.([]);
    mockListGovernancePacks.mockReturnValue([
      {
        id: 'baseline-core',
        version: '2026.04',
        label: 'Baseline Core Governance Pack',
        profileHints: ['default'],
      },
      {
        id: 'sovereign-core',
        version: '2026.04',
        label: 'Sovereign Core Governance Pack',
        profileHints: ['sovereign'],
      },
    ]);
    mockGetAnalytics.mockReturnValue({ totalRequests: 0 });
    mockGetViolations.mockReturnValue([]);
    mockGetAlerts.mockReturnValue([]);
    mockRegisterSLA.mockReturnValue(undefined);
    mockUpdateGovernanceSchemaSafeParse.mockImplementation(
      (value: unknown) => ({
        success: true,
        data: value,
      }),
    );
  });

  it('returns organization governance settings', async () => {
    const response = await invokeRoute('GET', '/organizations/:id/governance', {
      params: { id: 'org-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({
      defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      familyPacks: {
        privacy: { packId: 'enterprise-privacy', version: '2026.04' },
      },
    });
    expect(mockGetGovernanceSettings).toHaveBeenCalledWith('org-1');
  });

  it('updates organization governance settings', async () => {
    const response = await invokeRoute(
      'PATCH',
      '/organizations/:id/governance',
      {
        params: { id: 'org-1' },
        body: {
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy', version: '2026.04' },
          },
        },
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({
      defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      familyPacks: {
        privacy: { packId: 'enterprise-privacy', version: '2026.04' },
      },
    });
    expect(mockUpdateGovernanceSettings).toHaveBeenCalledWith(
      'org-1',
      'admin-1',
      expect.objectContaining({
        defaultPack: { packId: 'sovereign-core', version: '2026.04' },
      }),
    );
  });

  it('rejects invalid governance update bodies before service execution', async () => {
    mockUpdateGovernanceSchemaSafeParse.mockReturnValueOnce({
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: { defaultPack: ['packId is required'] },
          formErrors: [],
        }),
      },
    });

    const response = await invokeRoute(
      'PATCH',
      '/organizations/:id/governance',
      {
        params: { id: 'org-1' },
        body: {
          defaultPack: { packId: '' },
        },
      },
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateGovernanceSettings).not.toHaveBeenCalled();
  });

  it('lists available governance packs', async () => {
    const response = await invokeRoute(
      'GET',
      '/organizations/:id/governance/packs',
      {
        params: { id: 'org-1' },
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'baseline-core',
        version: '2026.04',
      }),
      expect.objectContaining({
        id: 'sovereign-core',
        label: 'Sovereign Core Governance Pack',
      }),
    ]);
    expect(mockListGovernancePacks).toHaveBeenCalled();
  });

  it('scopes usage analytics to the enterprise context organization', async () => {
    const response = await invokeRoute('GET', '/usage', {
      query: { period: '7' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetAnalytics).toHaveBeenCalledWith('org-1', 7);
  });

  it('scopes SLA violations and alerts to the enterprise context organization', async () => {
    await invokeRoute('GET', '/sla/violations', {
      query: { since: '2026-04-21T00:00:00.000Z' },
    });
    await invokeRoute('GET', '/sla/alerts', {
      query: { limit: '10' },
    });

    expect(mockGetViolations).toHaveBeenCalledWith(
      'org-1',
      '2026-04-21T00:00:00.000Z',
    );
    expect(mockGetAlerts).toHaveBeenCalledWith('org-1', 10);
  });

  it('rejects out-of-range enterprise query parameters before service execution', async () => {
    const response = await invokeRoute('GET', '/sla/alerts', {
      query: { limit: '1000000' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(mockGetAlerts).not.toHaveBeenCalled();
  });

  it('binds SLA registration to the enterprise context organization', async () => {
    const response = await invokeRoute('POST', '/sla/register', {
      body: {
        clientId: 'attacker-supplied-org',
        tier: 'enterprise',
        components: [
          {
            component: 'api_gateway',
            uptimeTarget: 99.9,
            latencyP50Ms: 100,
            latencyP95Ms: 250,
            latencyP99Ms: 500,
            errorRateTarget: 0.1,
          },
        ],
        creditPercentages: { tier1: 10, tier2: 25, tier3: 50 },
        reportingIntervalDays: 30,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockRegisterSLA).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'org-1',
        tier: 'enterprise',
      }),
    );
  });

  it('fails closed when an enterprise-scoped route lacks organization context', async () => {
    const response = await invokeRoute('GET', '/usage', {
      headers: { 'x-test-skip-enterprise-context': 'true' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({
      code: 'ENTERPRISE_CONTEXT_REQUIRED',
    });
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });
});
