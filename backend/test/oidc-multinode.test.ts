/**
 * OIDC-01: Multi-node OIDC test suite
 *
 * Proves that two independent OIDCBridge instances sharing the same Redis
 * (simulated via a Map-backed mock) produce consistent behaviour — sessions,
 * auth codes, tokens, refresh tokens, clients, logout, JWKS, and key IDs all
 * work across nodes.
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';
import * as https from 'https';
import { promises as dns } from 'dns';

// ---------------------------------------------------------------------------
// Generate a deterministic RSA-2048 key pair BEFORE any module loads
// ---------------------------------------------------------------------------
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const PRIVATE_PEM = privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

process.env.OIDC_SIGNING_PRIVATE_KEY = PRIVATE_PEM;
process.env.OIDC_SIGNING_PUBLIC_KEY = PUBLIC_PEM;
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';
process.env.NODE_ENV = 'test';

jest.mock(
  'winston',
  () => ({
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      json: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
    },
  }),
  { virtual: true },
);

jest.mock('https', () => ({
  request: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Functional Redis mock — backed by a shared Map so both OIDCBridge instances
// see the same data, exactly as they would against a real Redis cluster.
// ---------------------------------------------------------------------------
const store = new Map<string, string>();
const setStore = new Map<string, Set<string>>();

const redisMock = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(
    async (key: string, value: string, _ex?: string, _ttl?: number) => {
      store.set(key, value);
      return 'OK';
    },
  ),
  del: jest.fn(async (key: string) => {
    const had = store.has(key) || setStore.has(key);
    store.delete(key);
    setStore.delete(key);
    return had ? 1 : 0;
  }),
  exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  sadd: jest.fn(async (key: string, ...members: string[]) => {
    if (!setStore.has(key)) setStore.set(key, new Set());
    const s = setStore.get(key)!;
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    return added;
  }),
  smembers: jest.fn(async (key: string) => {
    const s = setStore.get(key);
    return s ? [...s] : [];
  }),
  srem: jest.fn(async (key: string, ...members: string[]) => {
    const s = setStore.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const member of members) {
      if (s.delete(member)) removed++;
    }
    if (s.size === 0) setStore.delete(key);
    return removed;
  }),
  expire: jest.fn(async () => 1),
  ttl: jest.fn(async (key: string) => {
    // Mock always returns -1 (no TTL) — sufficient for Lua script compatibility
    return store.has(key) ? -1 : -2;
  }),
  getdel: jest.fn(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  }),
  eval: jest.fn(async (lua: string, numKeys: number, ...args: string[]) => {
    // Minimal Lua CAS emulation for the RedisStore.compareAndSet method.
    // The Lua script does: GET → decode → check field → update → SET
    const redisKey = args[0];
    const field = args[1];
    const expectedStr = args[2];
    const newValueJson = args[3];
    const additionalExpectedJson = args[4];

    const raw = store.get(redisKey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (String(obj[field]) !== expectedStr) return null;
    const additionalExpected = additionalExpectedJson
      ? JSON.parse(additionalExpectedJson)
      : {};
    for (const [expectedField, expectedValue] of Object.entries(additionalExpected)) {
      if (String(obj[expectedField]) !== String(expectedValue)) return null;
    }
    obj[field] = JSON.parse(newValueJson);
    store.set(redisKey, JSON.stringify(obj));
    return JSON.stringify(obj);
  }),
};

jest.mock('../src/index', () => {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    redis: redisMock,
    prisma: {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    },
    metricsRegistry: {},
  };
});

// Import AFTER the mock is wired up
import { OIDCBridge, OIDCError } from '../src/services/enterprise/oidc-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REDIRECT_URI = 'https://app.example.com/callback';
const LOGOUT_URI = 'https://app.example.com/logout';
const BACKCHANNEL_LOGOUT_URI = 'https://app.example.com/backchannel-logout';
const fetchMock = jest.fn();

Object.defineProperty(globalThis, 'fetch', {
  value: fetchMock,
  writable: true,
});

/** Register a client on the given bridge instance and return credentials. */
async function registerTestClient(bridge: OIDCBridge) {
  return bridge.registerClient({
    clientName: 'Test Client',
    redirectUris: [REDIRECT_URI],
    postLogoutRedirectUris: [LOGOUT_URI],
    backchannelLogoutUri: BACKCHANNEL_LOGOUT_URI,
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    scopes: ['openid', 'profile', 'email'],
    requirePkce: false,
  });
}

async function registerOwnedClient(
  bridge: OIDCBridge,
  ownership: {
    organizationId: string;
    registeredByIdentityId: string;
    registeredByRole: string;
  },
) {
  return bridge.registerClient(
    {
      clientName: 'Governed Test Client',
      redirectUris: [REDIRECT_URI],
      postLogoutRedirectUris: [LOGOUT_URI],
      backchannelLogoutUri: BACKCHANNEL_LOGOUT_URI,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['openid', 'profile', 'email'],
      requirePkce: false,
    },
    ownership,
  );
}

/** Generate a PKCE pair (S256). */
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

/** Authorize (code flow) on a bridge instance, returns code + sessionId. */
async function authorizeCode(
  bridge: OIDCBridge,
  clientId: string,
  subjectId: string,
  opts?: {
    codeChallenge?: string;
    codeChallengeMethod?: 'S256';
    scope?: string;
    platformSessionId?: string;
  },
) {
  const result = await bridge.authorize(
    {
      clientId,
      redirectUri: REDIRECT_URI,
      responseType: 'code',
      scope: opts?.scope ?? 'openid profile email',
      state: crypto.randomBytes(8).toString('hex'),
      nonce: crypto.randomBytes(8).toString('hex'),
      codeChallenge: opts?.codeChallenge,
      codeChallengeMethod: opts?.codeChallengeMethod,
    },
    subjectId,
    { name: 'Alice', email: 'alice@example.com', email_verified: true },
    { platformSessionId: opts?.platformSessionId },
  );
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('OIDC multi-node correctness', () => {
  let bridgeA: OIDCBridge;
  let bridgeB: OIDCBridge;

  beforeAll(() => {
    bridgeA = new OIDCBridge('https://id.zeroid.test/oidc');
    bridgeB = new OIDCBridge('https://id.zeroid.test/oidc');
  });

  beforeEach(() => {
    store.clear();
    setStore.clear();
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  test('discovery does not advertise unrouted logout endpoints', () => {
    const discovery = bridgeA.getDiscoveryDocument();

    expect(discovery).not.toHaveProperty('end_session_endpoint');
    expect(discovery).not.toHaveProperty('frontchannel_logout_supported');
    expect(discovery).not.toHaveProperty('backchannel_logout_supported');
  });

  test('discovery does not advertise unsupported encrypted ID tokens', () => {
    const discovery = bridgeA.getDiscoveryDocument();

    expect(discovery).not.toHaveProperty(
      'id_token_encryption_alg_values_supported',
    );
  });

  test('client registration rejects encrypted ID token metadata until JWE issuance is enabled', async () => {
    await expect(
      bridgeA.registerClient({
        clientName: 'Encrypted Token Client',
        redirectUris: [REDIRECT_URI],
        postLogoutRedirectUris: [LOGOUT_URI],
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        scopes: ['openid'],
        idTokenEncryptedResponseAlg: 'RSA-OAEP',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client_metadata',
    });
  });

  test('production issuer must be HTTPS and non-local', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      expect(() => new OIDCBridge('http://localhost:4000/oidc')).toThrow(
        /OIDC_ISSUER_URL/,
      );
      expect(() => new OIDCBridge('https://127.0.0.1/oidc')).toThrow(
        /OIDC_ISSUER_URL/,
      );
      expect(() => new OIDCBridge('https://metadata.google.internal/oidc')).toThrow(
        /OIDC_ISSUER_URL/,
      );
      expect(() => new OIDCBridge('https://user:pass@id.zeroid.example.com/oidc')).toThrow(
        /OIDC_ISSUER_URL/,
      );
      expect(() => new OIDCBridge('https://id.zeroid.example.com/oidc')).not.toThrow();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  test('client registration rejects insecure redirect and JWKS URIs', async () => {
    await expect(
      bridgeA.registerClient({
        clientName: 'Insecure Client',
        redirectUris: ['http://app.example.com/callback'],
        postLogoutRedirectUris: ['https://app.example.com/logout'],
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        scopes: ['openid'],
        jwksUri: 'http://app.example.com/jwks.json',
      }),
    ).rejects.toThrow(/Redirect URI must use HTTPS/);
  });

  test('production client registration rejects private OIDC metadata endpoints', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      await expect(
        bridgeA.registerClient({
          clientName: 'Private Redirect Client',
          redirectUris: ['https://10.0.0.5/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
        }),
      ).rejects.toThrow(/Redirect URI/);

      await expect(
        bridgeA.registerClient({
          clientName: 'Shared Address Space Client',
          redirectUris: ['https://100.64.0.5/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
        }),
      ).rejects.toThrow(/Redirect URI/);

      await expect(
        bridgeA.registerClient({
          clientName: 'Private Backchannel Client',
          redirectUris: ['https://app.example.com/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          backchannelLogoutUri: 'https://metadata.google.internal/logout',
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
        }),
      ).rejects.toThrow(/Back-channel logout URI/);

      await expect(
        bridgeA.registerClient({
          clientName: 'Mapped Private Redirect Client',
          redirectUris: ['https://[::ffff:0a00:0005]/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
        }),
      ).rejects.toThrow(/Redirect URI/);

      await expect(
        bridgeA.registerClient({
          clientName: 'Credentialed JWKS Client',
          redirectUris: ['https://app.example.com/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
          jwksUri: 'https://user:pass@app.example.com/jwks.json',
        }),
      ).rejects.toThrow(/JWKS URI/);

      await expect(
        bridgeA.registerClient({
          clientName: 'Insecure Policy Metadata Client',
          redirectUris: ['https://app.example.com/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
          policyUri: 'http://app.example.com/policy',
        }),
      ).rejects.toThrow(/Policy URI/);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  test('production client registration refuses disabled PKCE for code flow', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      await expect(
        bridgeA.registerClient({
          clientName: 'PKCE Disabled Client',
          redirectUris: ['https://app.example.com/callback'],
          postLogoutRedirectUris: ['https://app.example.com/logout'],
          grantTypes: ['authorization_code'],
          responseTypes: ['code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          scopes: ['openid'],
          requirePkce: false,
        }),
      ).rejects.toMatchObject({
        errorCode: 'invalid_client_metadata',
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('production authorization requires PKCE for legacy stored clients', async () => {
    const client = await registerTestClient(bridgeA);
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      await expect(
        bridgeB.authorize(
          {
            clientId: client.clientId,
            redirectUri: REDIRECT_URI,
            responseType: 'code',
            scope: 'openid profile',
            state: crypto.randomBytes(8).toString('hex'),
            nonce: crypto.randomBytes(8).toString('hex'),
          },
          'user-production-pkce',
          { name: 'PKCE User' },
        ),
      ).rejects.toMatchObject({
        errorCode: 'invalid_request',
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('authorize rejects implicit flow even for a legacy stored client', async () => {
    const client = await registerTestClient(bridgeA);
    const storedClient = JSON.parse(
      store.get(`oidc:clients:${client.clientId}`)!,
    );
    storedClient.registration.responseTypes = ['id_token'];
    store.set(`oidc:clients:${client.clientId}`, JSON.stringify(storedClient));

    await expect(
      bridgeB.authorize(
        {
          clientId: client.clientId,
          redirectUri: REDIRECT_URI,
          responseType: 'id_token',
          scope: 'openid profile',
          state: crypto.randomBytes(8).toString('hex'),
          nonce: crypto.randomBytes(8).toString('hex'),
        },
        'user-implicit',
        { name: 'Legacy User' },
      ),
    ).rejects.toMatchObject({
      errorCode: 'unsupported_response_type',
    });
  });

  // 1. Cross-instance session access
  test('session created on A is retrievable on B', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-1',
    );

    // Instance B should see the session and deliver a signed logout token.
    const result = await bridgeB.backChannelLogout(sessionId);
    expect(result.notified).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      BACKCHANNEL_LOGOUT_URI,
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: expect.any(String),
      }),
    );

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    const logoutToken = new URLSearchParams(requestBody).get('logout_token');
    expect(logoutToken).toBeTruthy();
    const [encodedHeader, encodedPayload, encodedSignature] =
      logoutToken!.split('.');
    const header = JSON.parse(
      Buffer.from(encodedHeader, 'base64url').toString('utf-8'),
    );
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf-8'),
    );

    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(payload).toMatchObject({
      iss: 'https://id.zeroid.test/oidc',
      aud: client.clientId,
      sub: 'user-1',
      sid: sessionId,
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    });
    expect(payload.nonce).toBeUndefined();
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
      ),
    ).toBe(true);
  });

  test('back-channel logout refuses unsafe legacy stored logout URIs', async () => {
    const client = await registerTestClient(bridgeA);
    const storedClient = JSON.parse(
      store.get(`oidc:clients:${client.clientId}`)!,
    );
    storedClient.registration.backchannelLogoutUri = 'https://[::ffff:0a00:0005]/logout';
    store.set(`oidc:clients:${client.clientId}`, JSON.stringify(storedClient));

    const { sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-unsafe-logout',
    );
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const result = await bridgeB.backChannelLogout(sessionId);

      expect(result).toEqual({ notified: false });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('back-channel logout blocks private DNS resolution at delivery time', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-private-resolution',
    );
    const previousNodeEnv = process.env.NODE_ENV;
    const dnsSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '10.0.0.9', family: 4 },
    ]);

    try {
      process.env.NODE_ENV = 'production';

      const result = await bridgeB.backChannelLogout(sessionId);

      expect(result).toEqual({ notified: false });
      expect(dnsSpy).toHaveBeenCalledWith('app.example.com', {
        all: true,
        verbatim: true,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      dnsSpy.mockRestore();
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('back-channel logout pins vetted DNS address during production delivery', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-pinned-resolution',
    );
    const previousNodeEnv = process.env.NODE_ENV;
    const dnsSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    let capturedOptions: https.RequestOptions | undefined;
    let capturedBody = '';
    const httpsRequestMock = https.request as jest.Mock;
    httpsRequestMock.mockImplementation(
      (url: URL, options: https.RequestOptions, callback: (response: any) => void) => {
        expect(url.href).toBe(BACKCHANNEL_LOGOUT_URI);
        capturedOptions = options;

        const request = new EventEmitter() as any;
        request.write = jest.fn((chunk: string | Buffer) => {
          capturedBody += chunk.toString();
          return true;
        });
        request.end = jest.fn(() => {
          const response = new EventEmitter() as any;
          response.statusCode = 204;
          response.resume = jest.fn(() => {
            process.nextTick(() => response.emit('end'));
          });
          callback(response);
        });
        request.destroy = jest.fn((err?: Error) => {
          if (err) request.emit('error', err);
        });
        return request;
      },
    );

    try {
      process.env.NODE_ENV = 'production';

      const result = await bridgeB.backChannelLogout(sessionId);

      expect(result).toEqual({ notified: true, deliveryStatus: 204 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(httpsRequestMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).toContain('logout_token=');
      expect(capturedOptions?.servername).toBe('app.example.com');
      expect(capturedOptions?.lookup).toEqual(expect.any(Function));

      const lookup = capturedOptions!.lookup as any;
      await new Promise<void>((resolve, reject) => {
        lookup('app.example.com', {}, (err: Error | null, address: string, family: number) => {
          try {
            expect(err).toBeNull();
            expect(address).toBe('93.184.216.34');
            expect(family).toBe(4);
            resolve();
          } catch (lookupErr) {
            reject(lookupErr);
          }
        });
      });
    } finally {
      httpsRequestMock.mockReset();
      dnsSpy.mockRestore();
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  // 2. Cross-instance auth code exchange
  test('auth code generated on A can be exchanged on B', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(bridgeA, client.clientId, 'user-2');

    const tokens = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(tokens.access_token).toBeDefined();
    expect(tokens.id_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope).toBe('openid profile email');
  });

  test('authorization rejects scopes outside the client registration', async () => {
    const client = await registerTestClient(bridgeA);

    await expect(
      bridgeA.authorize(
        {
          clientId: client.clientId,
          redirectUri: REDIRECT_URI,
          responseType: 'code',
          scope: 'openid profile zeroid:kyc_status',
          state: crypto.randomBytes(8).toString('hex'),
          nonce: crypto.randomBytes(8).toString('hex'),
        },
        'user-scope-escalation',
        { name: 'Scope User', kyc_level: 'government_verified' },
      ),
    ).rejects.toMatchObject({
      errorCode: 'invalid_scope',
    });
  });

  // 3. Cross-instance token validation
  test('token issued on A is verified / getUserInfo on B', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(bridgeA, client.clientId, 'user-3');

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const userInfo = await bridgeB.getUserInfo(tokens.access_token);
    expect(userInfo.sub).toBe('user-3');
  });

  // 4. Cross-instance refresh token
  test('refresh token issued on A can be refreshed on B', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(bridgeA, client.clientId, 'user-4');

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshed = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(refreshed.access_token).toBeDefined();
    expect(refreshed.refresh_token).toBeDefined();
    // Old refresh token should be rotated (deleted)
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  });

  test('refresh token rotation preserves authorized userinfo claims', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-claims',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshed = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const userInfo = await bridgeA.getUserInfo(refreshed.access_token);
    expect(userInfo).toMatchObject({
      sub: 'user-refresh-claims',
      name: 'Alice',
      email: 'alice@example.com',
      email_verified: true,
    });
  });

  test('refresh token downscoping cannot be expanded again', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-downscope',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const downscoped = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'openid',
    });
    expect(downscoped.scope).toBe('openid');

    const downscopedUserInfo = await bridgeA.getUserInfo(
      downscoped.access_token,
    );
    expect(downscopedUserInfo.sub).toBe('user-refresh-downscope');
    expect(downscopedUserInfo.name).toBeUndefined();
    expect(downscopedUserInfo.email).toBeUndefined();

    await expect(
      bridgeA.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: downscoped.refresh_token,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        scope: 'openid email',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_scope',
    });

    const stillUsable = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: downscoped.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'openid',
    });
    expect(stillUsable.scope).toBe('openid');
  });

  test('failed client authentication does not consume refresh token', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-dos',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    await expect(
      bridgeB.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        clientSecret: 'wrong-secret',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    const refreshed = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(refreshed.access_token).toBeDefined();
    expect(refreshed.refresh_token).toBeDefined();
  });

  // 5. Cross-instance client registration
  test('client registered on A can authorize on B', async () => {
    const client = await registerTestClient(bridgeA);

    // Authorize using instance B with the client registered on A
    const { code, sessionId } = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-5',
    );
    expect(code).toBeDefined();
    expect(sessionId).toBeDefined();

    // Exchange on B as well to confirm full flow
    const tokens = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('client secrets are hashed at rest while remaining usable across nodes', async () => {
    const client = await registerTestClient(bridgeA);
    const storedRaw = store.get(`oidc:clients:${client.clientId}`);
    expect(storedRaw).toBeDefined();

    const stored = JSON.parse(storedRaw!);
    expect(stored.clientSecret).toBeUndefined();
    expect(stored.clientSecretHash).toMatch(/^sha256:/);
    expect(stored.clientSecretHash).not.toContain(client.clientSecret);
    expect(stored.clientSecretExpiresAt).toBe(client.clientSecretExpiresAt);

    const clientSetCall = redisMock.set.mock.calls.find(
      ([key]) => key === `oidc:clients:${client.clientId}`,
    );
    expect(clientSetCall).toHaveLength(2);

    const { code } = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-hashed-secret',
    );
    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('legacy plaintext client secrets are migrated after successful authentication', async () => {
    const client = await registerTestClient(bridgeA);
    const clientKey = `oidc:clients:${client.clientId}`;
    const stored = JSON.parse(store.get(clientKey)!);
    delete stored.clientSecretHash;
    delete stored.clientSecretHashAlg;
    stored.clientSecret = client.clientSecret;
    store.set(clientKey, JSON.stringify(stored));

    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-legacy-secret',
    );
    const tokens = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(tokens.access_token).toBeDefined();

    const migrated = JSON.parse(store.get(clientKey)!);
    expect(migrated.clientSecret).toBeUndefined();
    expect(migrated.clientSecretHash).toMatch(/^sha256:/);
  });

  test('expired client secrets cannot redeem authorization codes', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-expired-client-secret',
    );

    const clientKey = `oidc:clients:${client.clientId}`;
    const stored = JSON.parse(store.get(clientKey)!);
    stored.clientSecretExpiresAt = Math.floor(Date.now() / 1000) - 1;
    store.set(clientKey, JSON.stringify(stored));

    await expect(
      bridgeB.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });
  });

  test('failed client authentication does not consume authorization codes', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-auth-code-preserved',
    );

    await expect(
      bridgeB.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: client.clientId,
        clientSecret: 'wrong-secret',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('failed PKCE verification does not consume authorization codes', async () => {
    const client = await registerTestClient(bridgeA);
    const pair = pkce();
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-pkce-code-preserved',
      {
        codeChallenge: pair.challenge,
        codeChallengeMethod: 'S256',
      },
    );

    await expect(
      bridgeB.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        codeVerifier: 'wrong-verifier',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      codeVerifier: pair.verifier,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('authorization rejects weak PKCE code challenges', async () => {
    const client = await registerTestClient(bridgeA);

    await expect(
      authorizeCode(
        bridgeA,
        client.clientId,
        'user-weak-pkce',
        {
          codeChallenge: 'short',
          codeChallengeMethod: 'S256',
        },
      ),
    ).rejects.toMatchObject({
      errorCode: 'invalid_request',
    });
  });

  test('legacy plain PKCE authorization codes cannot be redeemed', async () => {
    const client = await registerTestClient(bridgeA);
    const pair = pkce();
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-plain-pkce-rejected',
      {
        codeChallenge: pair.challenge,
        codeChallengeMethod: 'S256',
      },
    );
    const codeKey = `oidc:authcodes:${code}`;
    const storedCode = JSON.parse(store.get(codeKey)!);
    storedCode.codeChallenge = 'plain-verifier';
    storedCode.codeChallengeMethod = 'plain';
    store.set(codeKey, JSON.stringify(storedCode));

    await expect(
      bridgeB.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        codeVerifier: 'plain-verifier',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });

    storedCode.codeChallenge = pair.challenge;
    storedCode.codeChallengeMethod = 'S256';
    store.set(codeKey, JSON.stringify(storedCode));
    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      codeVerifier: pair.verifier,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('authorization code claims require the registered client and redirect binding', async () => {
    const clientA = await registerTestClient(bridgeA);
    const clientB = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      clientA.clientId,
      'user-code-binding',
    );

    await expect(
      bridgeB.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: clientB.clientId,
        clientSecret: clientB.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: clientA.clientId,
      clientSecret: clientA.clientSecret,
    });
    expect(tokens.access_token).toBeDefined();
  });

  test('production rejects legacy plaintext client secrets instead of migrating them', async () => {
    const client = await registerTestClient(bridgeA);
    const clientKey = `oidc:clients:${client.clientId}`;
    const stored = JSON.parse(store.get(clientKey)!);
    delete stored.clientSecretHash;
    delete stored.clientSecretHashAlg;
    stored.clientSecret = client.clientSecret;
    store.set(clientKey, JSON.stringify(stored));

    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-prod-legacy-secret',
    );

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        bridgeB.exchangeToken({
          grantType: 'authorization_code',
          code: code!,
          redirectUri: REDIRECT_URI,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
        }),
      ).rejects.toMatchObject({
        errorCode: 'invalid_client',
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    const stillLegacy = JSON.parse(store.get(clientKey)!);
    expect(stillLegacy.clientSecret).toBe(client.clientSecret);
    expect(stillLegacy.clientSecretHash).toBeUndefined();
  });

  test('refresh tokens are stored only by digest and remain redeemable', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-hash',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(store.has(`oidc:refresh:${tokens.refresh_token}`)).toBe(false);
    const refreshKeys = [...store.keys()].filter((key) =>
      key.startsWith('oidc:refresh:'),
    );
    expect(refreshKeys).toHaveLength(1);
    expect(refreshKeys[0]).toMatch(/^oidc:refresh:sha256:/);
    for (const members of setStore.values()) {
      expect([...members]).not.toContain(tokens.refresh_token);
    }

    const refreshed = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(refreshed.access_token).toBeDefined();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  });

  test('stored refresh token digests are not accepted as bearer tokens', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-digest-leak',
    );

    await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshStorageKey = [...store.keys()]
      .find((key) => key.startsWith('oidc:refresh:sha256:'))
      ?.replace('oidc:refresh:', '');
    expect(refreshStorageKey).toMatch(/^sha256:/);

    await expect(
      bridgeB.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: refreshStorageKey,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });
  });

  test('legacy plaintext refresh token records are consumed safely', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-legacy',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshKey = [...store.keys()].find((key) =>
      key.startsWith('oidc:refresh:sha256:'),
    );
    expect(refreshKey).toBeDefined();
    const record = store.get(refreshKey!)!;
    store.delete(refreshKey!);
    store.set(`oidc:refresh:${tokens.refresh_token}`, record);

    for (const [setKey, members] of setStore.entries()) {
      if (setKey.startsWith('oidc:session-refresh-tokens:')) {
        members.clear();
        members.add(tokens.refresh_token);
      }
    }

    const refreshed = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(refreshed.access_token).toBeDefined();
    expect(store.has(`oidc:refresh:${tokens.refresh_token}`)).toBe(false);
    expect(
      [...store.keys()].some((key) => key.startsWith('oidc:refresh:sha256:')),
    ).toBe(true);
  });

  test('production rejects legacy plaintext refresh token records', async () => {
    const client = await registerTestClient(bridgeA);
    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-refresh-legacy-production',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshKey = [...store.keys()].find((key) =>
      key.startsWith('oidc:refresh:sha256:'),
    );
    expect(refreshKey).toBeDefined();
    const record = store.get(refreshKey!)!;
    store.delete(refreshKey!);
    store.set(`oidc:refresh:${tokens.refresh_token}`, record);

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        bridgeB.exchangeToken({
          grantType: 'refresh_token',
          refreshToken: tokens.refresh_token,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
        }),
      ).rejects.toMatchObject({
        errorCode: 'invalid_grant',
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(store.has(`oidc:refresh:${tokens.refresh_token}`)).toBe(true);
    expect(
      [...store.keys()].some((key) => key.startsWith('oidc:refresh:sha256:')),
    ).toBe(false);
  });

  test('authorization-code-only clients do not receive refresh tokens', async () => {
    const client = await bridgeA.registerClient({
      clientName: 'Auth Code Only Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['openid', 'profile'],
      requirePkce: false,
    });

    const { code } = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-no-refresh-grant',
      { scope: 'openid profile' },
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeUndefined();
    expect(
      [...store.keys()].some((key) => key.startsWith('oidc:refresh:')),
    ).toBe(false);
  });

  test('client credentials grant is rejected unless registered for the client', async () => {
    const authClient = await registerTestClient(bridgeA);
    await expect(
      bridgeB.exchangeToken({
        grantType: 'client_credentials',
        clientId: authClient.clientId,
        clientSecret: authClient.clientSecret,
        scope: 'openid',
      }),
    ).rejects.toMatchObject({
      errorCode: 'unauthorized_client',
    });

    const machineClient = await bridgeA.registerClient({
      clientName: 'Machine Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['client_credentials'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['openid'],
      requirePkce: false,
    });

    const token = await bridgeB.exchangeToken({
      grantType: 'client_credentials',
      clientId: machineClient.clientId,
      clientSecret: machineClient.clientSecret,
      scope: 'openid',
    });

    expect(token.access_token).toBeDefined();
    expect(token.token_type).toBe('Bearer');

    await expect(
      bridgeB.exchangeToken({
        grantType: 'client_credentials',
        clientId: machineClient.clientId,
        clientSecret: machineClient.clientSecret,
        scope: 'openid zeroid:kyc_status',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_scope',
    });
  });

  test('token exchange enforces the registered client authentication method', async () => {
    const basicClient = await bridgeA.registerClient({
      clientName: 'Basic Auth Machine Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['client_credentials'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['openid'],
      requirePkce: false,
    });

    await expect(
      bridgeB.exchangeToken({
        grantType: 'client_credentials',
        clientId: basicClient.clientId,
        clientSecret: basicClient.clientSecret,
        clientAuthMethod: 'client_secret_post',
        scope: 'openid',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    const postClient = await bridgeA.registerClient({
      clientName: 'Post Auth Machine Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['client_credentials'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      scopes: ['openid'],
      requirePkce: false,
    });

    await expect(
      bridgeB.exchangeToken({
        grantType: 'client_credentials',
        clientId: postClient.clientId,
        clientSecret: postClient.clientSecret,
        clientAuthMethod: 'client_secret_basic',
        scope: 'openid',
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    const token = await bridgeB.exchangeToken({
      grantType: 'client_credentials',
      clientId: postClient.clientId,
      clientSecret: postClient.clientSecret,
      clientAuthMethod: 'client_secret_post',
      scope: 'openid',
    });

    expect(token.access_token).toBeDefined();
  });

  test('token endpoint rejects grant requests missing required fields', async () => {
    const client = await registerTestClient(bridgeA);

    await expect(
      bridgeA.exchangeToken({
        grantType: 'authorization_code',
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_request',
    });

    await expect(
      bridgeA.exchangeToken({
        grantType: 'refresh_token',
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_request',
    });
  });

  // 6. Pending lifecycle clients cannot authorize before approval
  test('pending client registered on A cannot authorize on B before approval', async () => {
    const client = await registerOwnedClient(bridgeA, {
      organizationId: 'org-governed',
      registeredByIdentityId: 'operator-1',
      registeredByRole: 'operator',
    });

    expect(client.status).toBe('pending_approval');
    await expect(
      authorizeCode(bridgeB, client.clientId, 'user-pending-1'),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });
  });

  // 7. Approval must propagate across nodes
  test('client approved on A becomes usable on B', async () => {
    const client = await registerOwnedClient(bridgeA, {
      organizationId: 'org-governed',
      registeredByIdentityId: 'operator-2',
      registeredByRole: 'operator',
    });

    const approved = await bridgeA.approveClient(
      client.clientId,
      'org-governed',
      'admin-1',
    );
    expect(approved.status).toBe('active');
    expect(approved.active).toBe(true);

    const { code } = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-approved-1',
    );
    const tokens = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
  });

  // 8. Deactivation must block both new auth and refresh reuse
  test('deactivated client cannot authorize or refresh on another node', async () => {
    const client = await registerOwnedClient(bridgeA, {
      organizationId: 'org-governed',
      registeredByIdentityId: 'admin-2',
      registeredByRole: 'admin',
    });

    const { code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-deactivated-1',
    );
    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const deactivated = await bridgeA.deactivateClient(
      client.clientId,
      'org-governed',
      'admin-2',
      'Lifecycle shutdown test',
    );
    expect(deactivated.status).toBe('revoked');
    expect(deactivated.active).toBe(false);

    await expect(
      authorizeCode(bridgeB, client.clientId, 'user-deactivated-2'),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    await expect(
      bridgeB.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_client',
    });

    await expect(
      bridgeB.getUserInfo(tokens.access_token),
    ).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
  });

  // 9. Cross-instance logout
  test('session created on A, front-channel logout on B terminates it', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId, code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-6',
    );

    // Exchange token so there are tokens to revoke
    await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    // Logout via instance B
    const { logoutUrls } = await bridgeB.frontChannelLogout(sessionId);
    expect(logoutUrls).toContain(LOGOUT_URI);

    // Session should now be inactive — backChannelLogout still finds it but
    // we can verify by checking the session is marked inactive.
    // Attempting another frontChannelLogout should still work (session exists but inactive).
    const secondLogout = await bridgeB.frontChannelLogout(sessionId);
    expect(secondLogout.logoutUrls).toContain(LOGOUT_URI);
  });

  test('front-channel logout blocks pending authorization code redemption', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId, code } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-logout-before-exchange',
    );

    await bridgeB.frontChannelLogout(sessionId);

    await expect(
      bridgeA.exchangeToken({
        grantType: 'authorization_code',
        code: code!,
        redirectUri: REDIRECT_URI,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });
  });

  // 10. JWKS consistency
  test('both instances return identical JWKS documents', () => {
    const jwksA = bridgeA.getJWKS();
    const jwksB = bridgeB.getJWKS();

    expect(jwksA).toEqual(jwksB);
    expect(jwksA.keys as unknown[]).toHaveLength(1);

    const keyA = (jwksA.keys as Record<string, unknown>[])[0];
    expect(keyA.use).toBe('sig');
    expect(keyA.alg).toBe('RS256');
    expect(keyA.kid).toBeDefined();
  });

  // 11. Key ID stability
  test('both instances derive the same kid for the same signing key', () => {
    const jwksA = bridgeA.getJWKS();
    const jwksB = bridgeB.getJWKS();

    const kidA = (jwksA.keys as Record<string, unknown>[])[0].kid;
    const kidB = (jwksB.keys as Record<string, unknown>[])[0].kid;

    expect(kidA).toBe(kidB);
    expect(typeof kidA).toBe('string');
    expect((kidA as string).length).toBeGreaterThan(0);
  });

  // 12. Session-scoped logout — logging out session A must NOT revoke session B's tokens
  test('logout of session A does not revoke session B tokens for same user', async () => {
    const client = await registerTestClient(bridgeA);

    // Same user creates two sessions (e.g., two browser tabs, two devices)
    const sessionA = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-multi',
    );
    const sessionB = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-multi',
    );

    // Exchange both auth codes for tokens
    const tokensA = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: sessionA.code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const tokensB = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: sessionB.code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    // Both tokens should be valid before logout
    const userInfoA = await bridgeA.getUserInfo(tokensA.access_token);
    const userInfoB = await bridgeB.getUserInfo(tokensB.access_token);
    expect(userInfoA.sub).toBe('user-multi');
    expect(userInfoB.sub).toBe('user-multi');

    // Log out session A only
    await bridgeA.frontChannelLogout(sessionA.sessionId);

    // Session A's token should be revoked
    await expect(bridgeB.getUserInfo(tokensA.access_token)).rejects.toThrow();
    await expect(
      bridgeB.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: tokensA.refresh_token,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });

    // Session B's token must STILL be valid — this is the regression test
    const userInfoBAfter = await bridgeB.getUserInfo(tokensB.access_token);
    expect(userInfoBAfter.sub).toBe('user-multi');

    const refreshedB = await bridgeB.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: tokensB.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(refreshedB.access_token).toBeDefined();
  });

  test('session-bound access token is rejected after logout even if token index was missed', async () => {
    const client = await registerTestClient(bridgeA);
    const { code, sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-index-race',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    await expect(bridgeB.getUserInfo(tokens.access_token)).resolves.toMatchObject({
      sub: 'user-index-race',
    });

    await redisMock.del(`oidc:session-tokens:${sessionId}`);
    await bridgeA.frontChannelLogout(sessionId);

    await expect(bridgeB.getUserInfo(tokens.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
  });

  test('platform session revocation invalidates linked OIDC access and refresh tokens', async () => {
    const client = await registerTestClient(bridgeA);
    const platformSessionId = 'platform-session-oidc-1';
    const { code, sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-platform-logout',
      { platformSessionId },
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    await expect(bridgeB.getUserInfo(tokens.access_token)).resolves.toMatchObject({
      sub: 'user-platform-logout',
    });

    const revoked = await bridgeB.revokePlatformSession(platformSessionId);
    expect(revoked.revokedSessions).toBe(1);
    expect(await redisMock.smembers(`oidc:platform-session:${platformSessionId}`)).toEqual([]);

    await expect(bridgeA.getUserInfo(tokens.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
    await expect(
      bridgeA.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });

    const storedSession = JSON.parse((await redisMock.get(`oidc:sessions:${sessionId}`))!);
    expect(storedSession.active).toBe(false);
  });

  test('subject session revocation invalidates all linked OIDC sessions for recovery', async () => {
    const client = await registerTestClient(bridgeA);
    const sessionA = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-recovery',
      { platformSessionId: 'platform-session-recovery-a' },
    );
    const sessionB = await authorizeCode(
      bridgeB,
      client.clientId,
      'user-recovery',
      { platformSessionId: 'platform-session-recovery-b' },
    );

    const tokensA = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: sessionA.code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    const tokensB = await bridgeB.exchangeToken({
      grantType: 'authorization_code',
      code: sessionB.code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const revoked = await bridgeA.revokeSubjectSessions('user-recovery');
    expect(revoked.revokedSessions).toBe(2);
    expect(await redisMock.smembers('oidc:subject-sessions:user-recovery')).toEqual([]);

    await expect(bridgeB.getUserInfo(tokensA.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
    await expect(bridgeA.getUserInfo(tokensB.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
  });

  // 13. Back-channel logout must also invalidate refresh tokens for the session.
  test('back-channel logout revokes session refresh tokens', async () => {
    const client = await registerTestClient(bridgeA);
    const { code, sessionId } = await authorizeCode(
      bridgeA,
      client.clientId,
      'user-backchannel-refresh',
    );

    const tokens = await bridgeA.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const logout = await bridgeB.backChannelLogout(sessionId);
    expect(logout.notified).toBe(true);

    await expect(
      bridgeA.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
    });
  });
});
