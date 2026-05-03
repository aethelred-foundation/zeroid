import { z } from 'zod';

const routeRegistry: Record<
  string,
  Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>
> = {};

const mockExchangeToken = jest.fn();
const mockAuthorize = jest.fn();
const mockIdentityFindUnique = jest.fn();

jest.mock('express', () => {
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
      patch: jest.fn(() => router),
      delete: jest.fn(() => router),
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
}, { virtual: true });

jest.mock('../src/middleware/enterprise', () => ({
  requireEnterpriseContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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
  oidcBridge: {
    getDiscoveryDocument: jest.fn(),
    getJWKS: jest.fn(),
    authorize: mockAuthorize,
    exchangeToken: mockExchangeToken,
  },
  OIDCClientRegistrationSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));

jest.mock('../src/services/enterprise/oidc-claims', () => ({
  buildTrustedOIDCClaims: jest.fn(async () => ({
    sub: 'identity-1',
    name: 'Test Subject',
  })),
}));

jest.mock('../src/services/enterprise/sla-monitor', () => ({
  slaMonitor: {},
  SLADefinitionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

jest.mock('../src/services/enterprise/organization-service', () => ({
  CreateOrganizationSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  AddOrganizationMemberSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  UpdateOrganizationGovernanceSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  enterpriseOrganizationService: {},
}));

jest.mock('../src/services/enterprise/policy-governance-service', () => ({
  policyGovernanceService: {},
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
  policyRegistryService: {},
}));

jest.mock('../src/services/enterprise/policy-exception-service', () => ({
  CreatePolicyExceptionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  RevokePolicyExceptionSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
  policyExceptionService: {},
}));

jest.mock('../src/index', () => ({
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
    },
  },
}));

import '../src/routes/enterprise/integration';

async function invokeRoute(
  method: 'POST',
  path: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    identity?: Record<string, unknown>;
    sessionId?: string;
    sessionAuthTime?: number;
  } = {},
): Promise<{ statusCode: number; body: any; redirectUrl?: string }> {
  const handlers = routeRegistry[`${method} ${path}`];
  if (!handlers) {
    throw new Error(`Route not registered: ${method} ${path}`);
  }

  const req: Record<string, any> = {
    body: options.body ?? {},
    headers: options.headers ?? {},
    params: {},
    query: {},
    path,
    identity: options.identity,
    sessionId: options.sessionId,
    sessionAuthTime: options.sessionAuthTime,
  };

  let statusCode = 200;
  let responseBody: any;
  let redirectUrl: string | undefined;
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
    redirect(codeOrUrl: number | string, maybeUrl?: string) {
      if (typeof codeOrUrl === 'number') {
        statusCode = codeOrUrl;
        redirectUrl = maybeUrl;
      } else {
        statusCode = 302;
        redirectUrl = codeOrUrl;
      }
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
        if (err) reject(err);
        else resolve();
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

  return { statusCode, body: responseBody, redirectUrl };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

describe('OIDC token route client authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExchangeToken.mockResolvedValue({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid',
    });
    mockAuthorize.mockResolvedValue({
      redirectUrl: 'https://app.example.com/callback?code=secret-code&state=state-1',
      sessionId: 'session-1',
    });
    mockIdentityFindUnique.mockResolvedValue({
      displayName: 'Test Subject',
      metadata: {},
      status: 'ACTIVE',
      teeAttestationId: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('rejects Basic auth mixed with body client credentials', async () => {
    const response = await invokeRoute('POST', '/oidc/token', {
      headers: {
        authorization: basicAuth('client-1', 'secret-1'),
      },
      body: {
        grant_type: 'authorization_code',
        code: 'code-1',
        redirect_uri: 'https://app.example.com/callback',
        client_id: 'client-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'invalid_request',
    });
    expect(mockExchangeToken).not.toHaveBeenCalled();
  });

  it('rejects conflicting body credential aliases', async () => {
    const response = await invokeRoute('POST', '/oidc/token', {
      body: {
        grant_type: 'client_credentials',
        client_id: 'client-1',
        clientId: 'client-2',
        client_secret: 'secret-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'invalid_request',
    });
    expect(mockExchangeToken).not.toHaveBeenCalled();
  });

  it('passes a pure Basic auth token request to the bridge', async () => {
    const response = await invokeRoute('POST', '/oidc/token', {
      headers: {
        authorization: basicAuth('client-1', 'secret-1'),
      },
      body: {
        grant_type: 'authorization_code',
        code: 'code-1',
        redirect_uri: 'https://app.example.com/callback',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockExchangeToken).toHaveBeenCalledWith({
      grantType: 'authorization_code',
      code: 'code-1',
      redirectUri: 'https://app.example.com/callback',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      clientAuthMethod: 'client_secret_basic',
      codeVerifier: undefined,
      refreshToken: undefined,
      scope: undefined,
    });
  });

  it('redirects OIDC authorization responses instead of serializing raw codes', async () => {
    const response = await invokeRoute('POST', '/oidc/authorize', {
      identity: {
        id: 'identity-1',
        status: 'ACTIVE',
      },
      sessionId: 'platform-session-1',
      sessionAuthTime: 123456,
      body: {
        client_id: 'client-1',
        redirect_uri: 'https://app.example.com/callback',
        response_type: 'code',
        scope: 'openid profile',
        state: 'state-1',
        nonce: 'nonce-1',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.redirectUrl).toBe(
      'https://app.example.com/callback?code=secret-code&state=state-1',
    );
    expect(response.body).toBeUndefined();
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        redirectUri: 'https://app.example.com/callback',
      }),
      'identity-1',
      expect.any(Object),
      expect.objectContaining({
        platformSessionId: 'platform-session-1',
        platformAuthTime: 123456,
      }),
    );
  });

  it('returns invalid_request when bridge request validation fails', async () => {
    const parsed = z.object({ grantType: z.string() }).safeParse({
      grantType: 123,
    });
    if (parsed.success) {
      throw new Error('expected malformed OAuth fixture');
    }
    mockExchangeToken.mockRejectedValueOnce(parsed.error);

    const response = await invokeRoute('POST', '/oidc/token', {
      body: {
        grant_type: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'invalid_request',
    });
    expect(response.body.error_description).toContain('grantType');
  });

  it('keeps the SAML bridge disabled without returning assertion material', async () => {
    const response = await invokeRoute('POST', '/oidc/saml', {
      body: {
        client_id: 'client-1',
        subject: 'user-1',
      },
    });

    expect(response.statusCode).toBe(501);
    expect(response.body).toMatchObject({
      code: 'SAML_NOT_IMPLEMENTED',
    });
    expect(response.body).not.toHaveProperty('samlResponse');
    expect(response.body).not.toHaveProperty('assertion');
  });
});
