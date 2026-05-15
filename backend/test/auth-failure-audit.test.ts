import * as jose from 'jose';

function buildRequest(overrides: Record<string, unknown> = {}) {
  const headers = {
    'user-agent': 'audit-test-agent',
    'x-request-id': 'req-auth-audit-1',
    ...(overrides.headers as Record<string, string> | undefined),
  };

  return {
    headers,
    method: 'GET',
    url: '/v1/credentials',
    originalUrl: '/v1/credentials?scope=test',
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.11' },
    get: jest.fn((name: string) => headers[name.toLowerCase()]),
    ...overrides,
  } as any;
}

function buildResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
}

describe('auth failure audit logging', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...previousEnv,
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
    };
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...previousEnv };
  });

  it('durably audits missing bearer tokens with safe request context', async () => {
    const auditCreate = jest.fn(async ({ data }) => data);
    jest.doMock('../src/index', () => ({
      prisma: {
        auditLog: { create: auditCreate },
        session: { create: jest.fn(), findUnique: jest.fn() },
        identity: { findUnique: jest.fn() },
      },
      redis: {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const { authMiddleware } = await import('../src/middleware/auth');
    const req = buildRequest();
    const res = buildResponse();

    await authMiddleware(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_MISSING_TOKEN',
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AUTH_FAILED',
        resourceType: 'auth',
        resourceId: 'anonymous',
        ipAddress: '203.0.113.10',
        userAgent: 'audit-test-agent',
        details: expect.objectContaining({
          code: 'AUTH_MISSING_TOKEN',
          method: 'GET',
          path: '/v1/credentials?scope=test',
          requestId: 'req-auth-audit-1',
        }),
      }),
    });
  });

  it('audits malformed bearer tokens without storing token material', async () => {
    const auditCreate = jest.fn(async ({ data }) => data);
    const sessionFindUnique = jest.fn();
    jest.doMock('../src/index', () => ({
      prisma: {
        auditLog: { create: auditCreate },
        session: { create: jest.fn(), findUnique: sessionFindUnique },
        identity: { findUnique: jest.fn() },
      },
      redis: {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const { authMiddleware } = await import('../src/middleware/auth');
    const req = buildRequest({
      headers: { authorization: 'Bearer malformed-token' },
    });
    const res = buildResponse();

    await authMiddleware(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_FAILED',
    }));
    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AUTH_FAILED',
        resourceId: expect.not.stringContaining('malformed-token'),
        details: expect.objectContaining({
          code: 'AUTH_FAILED',
          tokenHashPrefix: expect.stringMatching(/^[a-f0-9]{16}$/),
        }),
      }),
    });
  });

  it('audits revoked tokens with session and subject hints after claims parse', async () => {
    const auditCreate = jest.fn(async ({ data }) => data);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new jose.SignJWT({ did: 'did:aethelred:alice' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('identity-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('zeroid-api')
      .setAudience('zeroid-client')
      .setJti('session-1')
      .sign(secret);

    jest.doMock('../src/index', () => ({
      prisma: {
        auditLog: { create: auditCreate },
        session: { create: jest.fn(), findUnique: jest.fn() },
        identity: { findUnique: jest.fn() },
      },
      redis: {
        get: jest.fn(async (key: string) => (key === 'revoked:session-1' ? '1' : null)),
        set: jest.fn(),
        del: jest.fn(),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const { authMiddleware } = await import('../src/middleware/auth');
    const req = buildRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = buildResponse();

    await authMiddleware(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_TOKEN_REVOKED',
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AUTH_FAILED',
        resourceId: 'session-1',
        details: expect.objectContaining({
          code: 'AUTH_TOKEN_REVOKED',
          sessionId: 'session-1',
          subjectId: 'identity-1',
          did: 'did:aethelred:alice',
        }),
      }),
    });
  });
});
