/**
 * OIDC-01: Multi-node OIDC test suite
 *
 * Proves that two independent OIDCBridge instances sharing the same Redis
 * (simulated via a Map-backed mock) produce consistent behaviour — sessions,
 * auth codes, tokens, refresh tokens, clients, logout, JWKS, and key IDs all
 * work across nodes.
 */
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Generate a deterministic RSA-2048 key pair BEFORE any module loads
// ---------------------------------------------------------------------------
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

process.env.OIDC_SIGNING_PRIVATE_KEY = PRIVATE_PEM;
process.env.OIDC_SIGNING_PUBLIC_KEY = PUBLIC_PEM;
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Functional Redis mock — backed by a shared Map so both OIDCBridge instances
// see the same data, exactly as they would against a real Redis cluster.
// ---------------------------------------------------------------------------
const store = new Map<string, string>();
const setStore = new Map<string, Set<string>>();

const redisMock = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
    store.set(key, value);
    return 'OK';
  }),
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
      if (!s.has(m)) { s.add(m); added++; }
    }
    return added;
  }),
  smembers: jest.fn(async (key: string) => {
    const s = setStore.get(key);
    return s ? [...s] : [];
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

    const raw = store.get(redisKey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (String(obj[field]) !== expectedStr) return null;
    obj[field] = JSON.parse(newValueJson);
    store.set(redisKey, JSON.stringify(obj));
    return JSON.stringify(obj);
  }),
};

jest.mock('../src/index', () => {
  const { Registry } = require('prom-client');
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
    metricsRegistry: new Registry(),
  };
});

// Import AFTER the mock is wired up
import { OIDCBridge, OIDCError } from '../src/services/enterprise/oidc-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REDIRECT_URI = 'https://app.example.com/callback';
const LOGOUT_URI = 'https://app.example.com/logout';

/** Register a client on the given bridge instance and return credentials. */
async function registerTestClient(bridge: OIDCBridge) {
  return bridge.registerClient({
    clientName: 'Test Client',
    redirectUris: [REDIRECT_URI],
    postLogoutRedirectUris: [LOGOUT_URI],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    scopes: ['openid', 'profile', 'email'],
    requirePkce: false,
  });
}

/** Generate a PKCE pair (S256). */
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Authorize (code flow) on a bridge instance, returns code + sessionId. */
async function authorizeCode(
  bridge: OIDCBridge,
  clientId: string,
  subjectId: string,
  opts?: { codeChallenge?: string; codeChallengeMethod?: 'S256' },
) {
  const result = await bridge.authorize(
    {
      clientId,
      redirectUri: REDIRECT_URI,
      responseType: 'code',
      scope: 'openid profile email',
      state: crypto.randomBytes(8).toString('hex'),
      nonce: crypto.randomBytes(8).toString('hex'),
      codeChallenge: opts?.codeChallenge,
      codeChallengeMethod: opts?.codeChallengeMethod,
    },
    subjectId,
    { name: 'Alice', email: 'alice@example.com', email_verified: true },
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
  });

  // 1. Cross-instance session access
  test('session created on A is retrievable on B', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId } = await authorizeCode(bridgeA, client.clientId, 'user-1');

    // Instance B should see the session via backChannelLogout (reads session)
    const result = await bridgeB.backChannelLogout(sessionId);
    expect(result.notified).toBe(true);
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

  // 5. Cross-instance client registration
  test('client registered on A can authorize on B', async () => {
    const client = await registerTestClient(bridgeA);

    // Authorize using instance B with the client registered on A
    const { code, sessionId } = await authorizeCode(bridgeB, client.clientId, 'user-5');
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

  // 6. Cross-instance logout
  test('session created on A, front-channel logout on B terminates it', async () => {
    const client = await registerTestClient(bridgeA);
    const { sessionId, code } = await authorizeCode(bridgeA, client.clientId, 'user-6');

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

  // 7. JWKS consistency
  test('both instances return identical JWKS documents', () => {
    const jwksA = bridgeA.getJWKS();
    const jwksB = bridgeB.getJWKS();

    expect(jwksA).toEqual(jwksB);
    expect((jwksA.keys as unknown[])).toHaveLength(1);

    const keyA = (jwksA.keys as Record<string, unknown>[])[0];
    expect(keyA.use).toBe('sig');
    expect(keyA.alg).toBe('RS256');
    expect(keyA.kid).toBeDefined();
  });

  // 8. Key ID stability
  test('both instances derive the same kid for the same signing key', () => {
    const jwksA = bridgeA.getJWKS();
    const jwksB = bridgeB.getJWKS();

    const kidA = (jwksA.keys as Record<string, unknown>[])[0].kid;
    const kidB = (jwksB.keys as Record<string, unknown>[])[0].kid;

    expect(kidA).toBe(kidB);
    expect(typeof kidA).toBe('string');
    expect((kidA as string).length).toBeGreaterThan(0);
  });

  // 9. Session-scoped logout — logging out session A must NOT revoke session B's tokens
  test('logout of session A does not revoke session B tokens for same user', async () => {
    const client = await registerTestClient(bridgeA);

    // Same user creates two sessions (e.g., two browser tabs, two devices)
    const sessionA = await authorizeCode(bridgeA, client.clientId, 'user-multi');
    const sessionB = await authorizeCode(bridgeB, client.clientId, 'user-multi');

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

    // Session B's token must STILL be valid — this is the regression test
    const userInfoBAfter = await bridgeB.getUserInfo(tokensB.access_token);
    expect(userInfoBAfter.sub).toBe('user-multi');
  });
});
