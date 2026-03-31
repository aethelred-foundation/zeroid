/**
 * OIDC-05: Real Redis race tests for auth code redemption and refresh token rotation.
 *
 * Proves that the atomic Redis operations (Lua CAS for auth codes, GETDEL for
 * refresh tokens) prevent double-spend under concurrent access. Uses a shared
 * Map-backed Redis mock where JS single-threaded execution models the atomicity
 * guarantees of real Redis commands.
 */
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Generate RSA-2048 key pair BEFORE any module loads
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
// Functional Redis mock backed by a shared Map
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
    return store.has(key) ? -1 : -2;
  }),
  getdel: jest.fn(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  }),
  eval: jest.fn(async (_lua: string, _numKeys: number, ...args: string[]) => {
    // Atomic Lua CAS emulation for RedisStore.compareAndSet.
    // Single-threaded JS ensures no interleaving between read and write.
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

// Import AFTER mock is wired
import { OIDCBridge, OIDCError } from '../src/services/enterprise/oidc-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REDIRECT_URI = 'https://app.example.com/callback';

async function registerTestClient(bridge: OIDCBridge) {
  return bridge.registerClient({
    clientName: 'Race Test Client',
    redirectUris: [REDIRECT_URI],
    postLogoutRedirectUris: [],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    scopes: ['openid', 'profile'],
    requirePkce: false,
  });
}

async function authorizeCode(bridge: OIDCBridge, clientId: string, subjectId: string) {
  return bridge.authorize(
    {
      clientId,
      redirectUri: REDIRECT_URI,
      responseType: 'code',
      scope: 'openid profile',
      state: crypto.randomBytes(8).toString('hex'),
      nonce: crypto.randomBytes(8).toString('hex'),
    },
    subjectId,
    { name: 'Test User', email: 'test@example.com', email_verified: true },
  );
}

function settleResults<T>(results: PromiseSettledResult<T>[]): {
  fulfilled: T[];
  rejected: Error[];
} {
  const fulfilled: T[] = [];
  const rejected: Error[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') fulfilled.push(r.value);
    else rejected.push(r.reason as Error);
  }
  return { fulfilled, rejected };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('OIDC race-condition safety', () => {
  let bridge: OIDCBridge;

  beforeAll(() => {
    bridge = new OIDCBridge('https://id.zeroid.test/oidc');
  });

  beforeEach(() => {
    store.clear();
    setStore.clear();
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Auth code double-redemption
  // -----------------------------------------------------------------------
  test('concurrent auth code exchange — exactly one wins, other gets invalid_grant', async () => {
    const client = await registerTestClient(bridge);
    const { code } = await authorizeCode(bridge, client.clientId, 'user-race-1');

    const exchangeRequest = {
      grantType: 'authorization_code' as const,
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    };

    // Race two concurrent exchange attempts
    const results = await Promise.allSettled([
      bridge.exchangeToken(exchangeRequest),
      bridge.exchangeToken(exchangeRequest),
    ]);

    const { fulfilled, rejected } = settleResults(results);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The winner got valid tokens
    expect(fulfilled[0].access_token).toBeDefined();
    expect(fulfilled[0].id_token).toBeDefined();
    expect(fulfilled[0].refresh_token).toBeDefined();
    expect(fulfilled[0].token_type).toBe('Bearer');

    // The loser got invalid_grant
    expect(rejected[0]).toBeInstanceOf(OIDCError);
    expect((rejected[0] as OIDCError).errorCode).toBe('invalid_grant');
  });

  // -----------------------------------------------------------------------
  // 2. Refresh token double-rotation
  // -----------------------------------------------------------------------
  test('concurrent refresh token rotation — exactly one wins, other gets invalid_grant', async () => {
    const client = await registerTestClient(bridge);
    const { code } = await authorizeCode(bridge, client.clientId, 'user-race-2');

    // First, obtain a refresh token via normal auth code exchange
    const tokens = await bridge.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const refreshRequest = {
      grantType: 'refresh_token' as const,
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    };

    // Race two concurrent refresh attempts with the same token
    const results = await Promise.allSettled([
      bridge.exchangeToken(refreshRequest),
      bridge.exchangeToken(refreshRequest),
    ]);

    const { fulfilled, rejected } = settleResults(results);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Winner gets new tokens
    expect(fulfilled[0].access_token).toBeDefined();
    expect(fulfilled[0].refresh_token).toBeDefined();
    // Rotated token must differ from the consumed one
    expect(fulfilled[0].refresh_token).not.toBe(tokens.refresh_token);

    // Loser gets invalid_grant
    expect(rejected[0]).toBeInstanceOf(OIDCError);
    expect((rejected[0] as OIDCError).errorCode).toBe('invalid_grant');
  });

  // -----------------------------------------------------------------------
  // 3. Auth code replay after success
  // -----------------------------------------------------------------------
  test('auth code replay after successful exchange is rejected', async () => {
    const client = await registerTestClient(bridge);
    const { code } = await authorizeCode(bridge, client.clientId, 'user-replay-1');

    const exchangeRequest = {
      grantType: 'authorization_code' as const,
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    };

    // First exchange succeeds
    const tokens = await bridge.exchangeToken(exchangeRequest);
    expect(tokens.access_token).toBeDefined();

    // Second attempt with same code must fail
    await expect(bridge.exchangeToken(exchangeRequest)).rejects.toThrow(OIDCError);

    try {
      await bridge.exchangeToken(exchangeRequest);
    } catch (err) {
      expect(err).toBeInstanceOf(OIDCError);
      expect((err as OIDCError).errorCode).toBe('invalid_grant');
    }
  });

  // -----------------------------------------------------------------------
  // 4. Refresh token replay after rotation
  // -----------------------------------------------------------------------
  test('old refresh token is rejected after rotation', async () => {
    const client = await registerTestClient(bridge);
    const { code } = await authorizeCode(bridge, client.clientId, 'user-replay-2');

    const tokens = await bridge.exchangeToken({
      grantType: 'authorization_code',
      code: code!,
      redirectUri: REDIRECT_URI,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    const oldRefreshToken = tokens.refresh_token;

    // Rotate the refresh token
    const rotated = await bridge.exchangeToken({
      grantType: 'refresh_token',
      refreshToken: oldRefreshToken,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    expect(rotated.access_token).toBeDefined();
    expect(rotated.refresh_token).not.toBe(oldRefreshToken);

    // Attempt to use the old refresh token — must fail
    await expect(
      bridge.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: oldRefreshToken,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      }),
    ).rejects.toThrow(OIDCError);

    try {
      await bridge.exchangeToken({
        grantType: 'refresh_token',
        refreshToken: oldRefreshToken,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(OIDCError);
      expect((err as OIDCError).errorCode).toBe('invalid_grant');
    }
  });
});
