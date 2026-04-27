const mockApiKeyCreate = jest.fn();
const mockApiKeyFindMany = jest.fn();
const mockApiKeyFindFirst = jest.fn();
const mockApiKeyFindUnique = jest.fn();
const mockApiKeyUpdate = jest.fn();

const redisStore: Record<string, string> = {};

jest.mock('../src/index', () => ({
  prisma: {
    aPIKey: {
      create: mockApiKeyCreate,
      findMany: mockApiKeyFindMany,
      findFirst: mockApiKeyFindFirst,
      findUnique: mockApiKeyFindUnique,
      update: mockApiKeyUpdate,
    },
  },
  redis: {
    get: jest.fn(async (key: string) => redisStore[key] ?? null),
    set: jest.fn(async (key: string, value: string) => {
      redisStore[key] = value;
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      const existed = Object.prototype.hasOwnProperty.call(redisStore, key);
      delete redisStore[key];
      return existed ? 1 : 0;
    }),
  },
}));

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

import { apiGateway } from '../src/services/enterprise/api-gateway';

describe('APIGateway persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(redisStore)) delete redisStore[key];
  });

  it('creates an organization-owned API key and persists extended config in redis', async () => {
    mockApiKeyCreate.mockResolvedValue({});

    const result = await apiGateway.createAPIKey('org-1', {
      name: 'Primary production key',
      scopes: ['credentials:read', 'verification:write'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: ['10.0.0.1'],
      dailyQuota: 5000,
      monthlyQuota: 100000,
      rateLimit: { requestsPerSecond: 20, burstSize: 50 },
      metadata: { owner: 'platform' },
    });

    expect(result.apiKey).toMatch(/^zid_live_/);
    expect(mockApiKeyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        name: 'Primary production key',
        environment: 'production',
        rateLimitPerMinute: 1200,
      }),
    }));

    const configKey = `enterprise:api-key-config:${result.apiKeyId}`;
    expect(JSON.parse(redisStore[configKey] as string)).toMatchObject({
      dailyQuota: 5000,
      monthlyQuota: 100000,
      rateLimit: { requestsPerSecond: 20, burstSize: 50 },
      metadata: { owner: 'platform' },
      revokedAt: null,
      revokedReason: null,
    });
  });

  it('lists persisted API keys for one organization only', async () => {
    const createdAt = new Date('2026-04-21T00:00:00.000Z');
    const expiresAt = new Date('2026-05-21T00:00:00.000Z');

    mockApiKeyFindMany.mockResolvedValue([
      {
        id: 'key-1',
        organizationId: 'org-1',
        name: 'Primary',
        keyHash: 'hash-1',
        keyPrefix: 'zid_live_abc',
        scopes: ['credentials:read'],
        environment: 'production',
        rateLimitPerMinute: 600,
        ipAllowlist: [],
        expiresAt,
        isActive: true,
        lastUsedAt: null,
        createdAt,
      },
    ]);

    redisStore['enterprise:api-key-config:key-1'] = JSON.stringify({
      dailyQuota: 1000,
      monthlyQuota: 50000,
      rateLimit: { requestsPerSecond: 10, burstSize: 20 },
      metadata: { owner: 'compliance' },
      revokedAt: null,
      revokedReason: null,
    });

    const keys = await apiGateway.listAPIKeys('org-1');

    expect(mockApiKeyFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
    }));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      id: 'key-1',
      clientId: 'org-1',
      name: 'Primary',
      dailyQuota: 1000,
      metadata: { owner: 'compliance' },
    });
    expect((keys[0] as any).keyHash).toBeUndefined();
  });

  it('revokes only keys owned by the target organization', async () => {
    mockApiKeyFindFirst.mockResolvedValue({
      id: 'key-1',
      organizationId: 'org-1',
      environment: 'production',
    });

    redisStore['enterprise:api-key-config:key-1'] = JSON.stringify({
      dailyQuota: 1000,
      monthlyQuota: 50000,
      rateLimit: { requestsPerSecond: 10, burstSize: 20 },
      metadata: {},
      revokedAt: null,
      revokedReason: null,
    });

    await apiGateway.revokeAPIKey('key-1', 'org-1', 'rotation');

    expect(mockApiKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'key-1' },
      data: { isActive: false },
    }));
    expect(JSON.parse(redisStore['enterprise:api-key-config:key-1'] as string)).toMatchObject({
      revokedReason: 'rotation',
    });
  });

  it('limits OAuth2 issued scopes to the registered client scope set', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-scoped',
      ['credentials:read', 'verification:write'],
      'production',
    );

    const token = await apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'credentials:read',
    });

    expect(token.scope).toBe('credentials:read');
    await expect(apiGateway.validateOAuth2Token(token.accessToken)).resolves.toMatchObject({
      clientId: client.clientId,
      scopes: ['credentials:read'],
      environment: 'production',
    });
  });

  it('rejects OAuth2 scopes outside the registered client scope set', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-scope-denied',
      ['credentials:read'],
      'production',
    );

    await expect(apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'admin:full',
    })).rejects.toMatchObject({
      code: 'INVALID_SCOPE',
      statusCode: 400,
    });
  });

  it('rejects OAuth2 client secret mismatches', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-secret-denied',
      ['credentials:read'],
      'production',
    );

    await expect(apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: `${client.clientSecret}-wrong`,
      scope: 'credentials:read',
    })).rejects.toMatchObject({
      code: 'INVALID_CLIENT',
      statusCode: 401,
    });
  });

  it('persists OAuth2 client and token state in redis for multi-node use', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-redis-backed',
      ['credentials:read'],
      'production',
    );

    expect(redisStore[`enterprise:oauth2-client:${client.clientId}`]).toBeDefined();

    const token = await apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'credentials:read',
    });

    expect(redisStore[`enterprise:oauth2-token:${token.accessToken}`]).toBeUndefined();
    expect(
      Object.keys(redisStore).some((key) =>
        key.startsWith('enterprise:oauth2-token:'),
      ),
    ).toBe(true);
  });
});
