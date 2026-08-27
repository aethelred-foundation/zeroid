import crypto from 'crypto';
import * as jose from 'jose';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('API JWT asymmetric signing', () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...previousEnv };
  });

  it('issues and accepts asymmetric session tokens with a stable key id', async () => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.API_JWT_SIGNING_PRIVATE_KEY = keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    process.env.API_JWT_VERIFICATION_PUBLIC_KEY = keyPair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    process.env.API_JWT_ALGORITHM = 'RS256';
    process.env.API_JWT_KEY_ID = 'api-jwt-key-2026-05';

    let storedSession: {
      id: string;
      identityId: string;
      tokenHash: string;
      expiresAt: Date;
    } | null = null;

    jest.doMock('../src/runtime', () => ({
      prisma: {
        session: {
          create: jest.fn(async ({ data }) => {
            storedSession = data;
            return data;
          }),
          findUnique: jest.fn(async () => storedSession),
        },
        identity: {
          findUnique: jest.fn(async () => ({
            id: 'identity-1',
            did: 'did:aethelred:alice',
            publicKey: 'public-key',
            status: 'ACTIVE',
          })),
        },
      },
      redis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const { generateToken, authMiddleware } = await import('../src/middleware/auth');
    const { token } = await generateToken('identity-1', 'did:aethelred:alice');

    expect(jose.decodeProtectedHeader(token)).toMatchObject({
      alg: 'RS256',
      kid: 'api-jwt-key-2026-05',
      typ: 'JWT',
    });

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.identity).toMatchObject({
      id: 'identity-1',
      did: 'did:aethelred:alice',
      status: 'ACTIVE',
    });
  });

  it('rejects HMAC tokens while asymmetric verification is configured', async () => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.API_JWT_SIGNING_PRIVATE_KEY = keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    process.env.API_JWT_VERIFICATION_PUBLIC_KEY = keyPair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    process.env.API_JWT_ALGORITHM = 'RS256';
    process.env.API_JWT_KEY_ID = 'api-jwt-key-2026-05';

    jest.doMock('../src/runtime', () => ({
      prisma: {
        session: {
          create: jest.fn(),
          findUnique: jest.fn(),
        },
        identity: {
          findUnique: jest.fn(),
        },
      },
      redis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const { authMiddleware } = await import('../src/middleware/auth');
    const legacyToken = await new jose.SignJWT({ did: 'did:aethelred:alice' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('identity-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('zeroid-api')
      .setAudience('zeroid-client')
      .setJti('session-1')
      .sign(new TextEncoder().encode('test-secret-that-is-at-least-32-chars!!'));
    const req = {
      headers: { authorization: `Bearer ${legacyToken}` },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_CLAIMS_INVALID',
    }));
  });

  it('rejects signed tokens with malformed structured claims before session lookup', async () => {
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.API_JWT_SIGNING_PRIVATE_KEY = keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    process.env.API_JWT_VERIFICATION_PUBLIC_KEY = keyPair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    process.env.API_JWT_ALGORITHM = 'RS256';
    process.env.API_JWT_KEY_ID = 'api-jwt-key-2026-05';

    const sessionFindUnique = jest.fn();
    jest.doMock('../src/runtime', () => ({
      prisma: {
        session: {
          create: jest.fn(),
          findUnique: sessionFindUnique,
        },
        identity: {
          findUnique: jest.fn(),
        },
      },
      redis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    const malformedToken = await new jose.SignJWT({
      did: 42,
    } as unknown as jose.JWTPayload)
      .setProtectedHeader({
        alg: 'RS256',
        kid: 'api-jwt-key-2026-05',
        typ: 'JWT',
      })
      .setSubject('identity-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('zeroid-api')
      .setAudience('zeroid-client')
      .setJti('session-1')
      .sign(keyPair.privateKey);

    sessionFindUnique.mockResolvedValue({
      id: 'session-1',
      identityId: 'identity-1',
      tokenHash: sha256Hex(malformedToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { authMiddleware } = await import('../src/middleware/auth');
    const req = {
      headers: { authorization: `Bearer ${malformedToken}` },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_CLAIMS_INVALID',
    }));
  });
});
