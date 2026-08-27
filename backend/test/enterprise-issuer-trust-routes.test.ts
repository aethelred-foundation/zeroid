const routeRegistry: Record<string, Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>> = {};

const mockRegisterIssuerTrust = jest.fn();
const mockListIssuerTrustRecords = jest.fn();
const mockGetIssuerTrustRecordById = jest.fn();
const mockAccreditIssuer = jest.fn();
const mockSuspendIssuer = jest.fn();
const mockRecordIssuerKeyVersion = jest.fn();
const mockListIssuerKeyHistory = jest.fn();
const mockGetIssuerKeyHistoryRecord = jest.fn();

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

jest.mock('../src/services/enterprise/policy-registry-service', () => ({
  POLICY_APPROVAL_MODES: ['single_admin', 'separation_of_duties', 'dual_control'],
  CreatePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  DeprecatePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RevokePolicyDefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  policyRegistryService: {
    createPolicyDraft: jest.fn(),
    listPolicies: jest.fn(),
    getPolicyById: jest.fn(),
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
    createExceptionRequest: jest.fn(),
    listExceptions: jest.fn(),
    getExceptionById: jest.fn(),
    approveException: jest.fn(),
    rejectException: jest.fn(),
    revokeException: jest.fn(),
  },
}));

jest.mock('../src/services/enterprise/issuer-trust-service', () => ({
  RegisterIssuerTrustSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RecordIssuerKeySchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  issuerTrustRegistryService: {
    registerIssuerTrust: mockRegisterIssuerTrust,
    listIssuerTrustRecords: mockListIssuerTrustRecords,
    getIssuerTrustRecordById: mockGetIssuerTrustRecordById,
    accreditIssuer: mockAccreditIssuer,
    suspendIssuer: mockSuspendIssuer,
    recordIssuerKeyVersion: mockRecordIssuerKeyVersion,
    listIssuerKeyHistory: mockListIssuerKeyHistory,
    getIssuerKeyHistoryRecord: mockGetIssuerKeyHistoryRecord,
  },
}));

jest.mock('../src/runtime', () => ({
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

describe('enterprise issuer trust routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetIssuerTrustRecordById.mockResolvedValue({
      id: 'trust-1',
      organizationId: 'org-1',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      issuerDisplayName: 'Alpha Registry Authority',
      status: 'accredited',
      accreditationScope: 'sovereign',
      assuranceLevel: 'qualified',
      allowedCredentialTypes: ['kyc_enhanced'],
      allowedJurisdictions: ['AE-ADGM'],
      proposedByIdentityId: 'admin-1',
      accreditedByIdentityId: 'admin-2',
      suspensionReason: null,
      metadata: { trustFramework: 'ADGM' },
      accreditedAt: new Date('2026-04-22T00:00:00.000Z'),
      expiresAt: new Date('2027-04-21T00:00:00.000Z'),
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    });

    mockListIssuerKeyHistory.mockResolvedValue([
      {
        id: 'hist-2',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:alpha',
        keyVersion: '2',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
        status: 'active',
        validFrom: new Date('2026-04-21T00:00:00.000Z'),
        validUntil: null,
        rotatedByIdentityId: 'admin-2',
        metadata: { hsm: 'aws-kms' },
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
      },
      {
        id: 'hist-1',
        issuerIdentityId: 'issuer-1',
        issuerDid: 'did:aethelred:issuer:alpha',
        keyVersion: '1',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-1',
        status: 'retired',
        validFrom: new Date('2025-04-21T00:00:00.000Z'),
        validUntil: new Date('2026-04-21T00:00:00.000Z'),
        rotatedByIdentityId: 'admin-1',
        metadata: { hsm: 'aws-kms' },
        createdAt: new Date('2025-04-21T00:00:00.000Z'),
      },
    ]);

    mockGetIssuerKeyHistoryRecord.mockResolvedValue({
      id: 'hist-2',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'active',
      validFrom: new Date('2026-04-21T00:00:00.000Z'),
      validUntil: null,
      rotatedByIdentityId: 'admin-2',
      metadata: { hsm: 'aws-kms' },
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
    });

    mockRecordIssuerKeyVersion.mockResolvedValue({
      id: 'hist-2',
      issuerIdentityId: 'issuer-1',
      issuerDid: 'did:aethelred:issuer:alpha',
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'active',
      validFrom: new Date('2026-04-21T00:00:00.000Z'),
      validUntil: null,
      rotatedByIdentityId: 'admin-1',
      metadata: { hsm: 'aws-kms' },
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
    });
  });

  it('exports issuer trust governance evidence bundles', async () => {
    const response = await invokeRoute('GET', '/trust/issuers/:trustId/evidence', {
      params: { trustId: 'trust-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetIssuerTrustRecordById).toHaveBeenCalledWith('trust-1', 'org-1');
    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.governance_evidence.v1',
      artifactType: 'issuer_trust_record',
      artifact: expect.objectContaining({
        id: 'trust-1',
        assuranceLevel: 'qualified',
      }),
      issuer: {
        identityId: 'issuer-1',
        did: 'did:aethelred:issuer:alpha',
        displayName: 'Alpha Registry Authority',
      },
      trustRegime: {
        status: 'accredited',
        accreditationScope: 'sovereign',
        assuranceLevel: 'qualified',
        allowedCredentialTypes: ['kyc_enhanced'],
        allowedJurisdictions: ['AE-ADGM'],
      },
      provenance: expect.objectContaining({
        proposedByIdentityId: 'admin-1',
        accreditedByIdentityId: 'admin-2',
      }),
      lifecycle: expect.objectContaining({
        status: 'accredited',
      }),
    });
  });

  it('exports issuer key lineage evidence bundles', async () => {
    const response = await invokeRoute('GET', '/trust/issuers/:issuerIdentityId/keys/:keyHistoryId/evidence', {
      params: { issuerIdentityId: 'issuer-1', keyHistoryId: 'hist-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetIssuerKeyHistoryRecord).toHaveBeenCalledWith('org-1', 'issuer-1', 'hist-2');
    expect(mockListIssuerKeyHistory).toHaveBeenCalledWith('org-1', 'issuer-1');
    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.governance_evidence.v1',
      artifactType: 'issuer_key_history',
      artifact: expect.objectContaining({
        id: 'hist-2',
        keyVersion: '2',
        status: 'active',
      }),
      issuer: {
        identityId: 'issuer-1',
        did: 'did:aethelred:issuer:alpha',
      },
      keyLineage: {
        current: expect.objectContaining({
          id: 'hist-2',
          keyVersion: '2',
        }),
        history: expect.arrayContaining([
          expect.objectContaining({ id: 'hist-2', keyVersion: '2' }),
          expect.objectContaining({ id: 'hist-1', keyVersion: '1' }),
        ]),
      },
      lifecycle: expect.objectContaining({
        status: 'active',
      }),
    });
  });

  it('passes enterprise organization context when recording issuer key versions', async () => {
    const body = {
      keyVersion: '2',
      keyAlgorithm: 'ES256',
      publicKey: '-----BEGIN PUBLIC KEY-----mock-key-----END PUBLIC KEY-----',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
      status: 'active',
      metadata: { hsm: 'aws-kms' },
    };

    const response = await invokeRoute('POST', '/trust/issuers/:issuerIdentityId/keys', {
      params: { issuerIdentityId: 'issuer-1' },
      body,
    });

    expect(response.statusCode).toBe(201);
    expect(mockRecordIssuerKeyVersion).toHaveBeenCalledWith(
      'org-1',
      'issuer-1',
      'admin-1',
      body,
    );
  });
});
