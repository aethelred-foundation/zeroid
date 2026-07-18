import crypto from 'crypto';

const mockApiKeyCreate = jest.fn();
const mockApiKeyFindMany = jest.fn();
const mockApiKeyFindFirst = jest.fn();
const mockApiKeyFindUnique = jest.fn();
const mockApiKeyUpdate = jest.fn();
const mockApiUsageLogCreate = jest.fn();
const mockApiUsageLogFindMany = jest.fn();

const redisStore: Record<string, string> = {};
const ORIGINAL_ENV = { ...process.env };

const mockRedisEval = jest.fn(
  async (_script: string, numKeys: number, ...args: unknown[]) => {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys);

    if (keys[0]?.startsWith('enterprise:api-rate:')) {
      const now = Number(argv[0]);
      const rate = Number(argv[1]);
      const burst = Number(argv[2]);
      let tokens = burst;
      let lastRefill = now;

      const raw = redisStore[keys[0]];
      if (raw) {
        const [tokensRaw, lastRaw] = raw.split(':');
        tokens = Number(tokensRaw);
        lastRefill = Number(lastRaw);
      }

      const elapsed = Math.max(0, now - lastRefill) / 1000;
      tokens = Math.min(burst, tokens + elapsed * rate);
      if (tokens < 1) {
        redisStore[keys[0]] = `${tokens}:${now}`;
        return [0];
      }

      redisStore[keys[0]] = `${tokens - 1}:${now}`;
      return [1];
    }

    if (keys[0]?.startsWith('enterprise:api-quota:')) {
      const dailyLimit = Number(argv[0]);
      const monthlyLimit = Number(argv[1]);
      const daily = Number(redisStore[keys[0]] ?? '0');
      const monthly = Number(redisStore[keys[1]] ?? '0');

      if (daily + 1 > dailyLimit || monthly + 1 > monthlyLimit) {
        return [0, daily, monthly];
      }

      redisStore[keys[0]] = String(daily + 1);
      redisStore[keys[1]] = String(monthly + 1);
      return [1, daily + 1, monthly + 1];
    }

    throw new Error(`Unexpected Redis eval key: ${keys[0]}`);
  },
);

jest.mock('../src/runtime', () => ({
  prisma: {
    aPIKey: {
      create: mockApiKeyCreate,
      findMany: mockApiKeyFindMany,
      findFirst: mockApiKeyFindFirst,
      findUnique: mockApiKeyFindUnique,
      update: mockApiKeyUpdate,
    },
    aPIUsageLog: {
      create: mockApiUsageLogCreate,
      findMany: mockApiUsageLogFindMany,
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
    eval: mockRedisEval,
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

import { APIGateway, apiGateway } from '../src/services/enterprise/api-gateway';

describe('APIGateway persistence', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
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

  it('uses a deployment pepper for production API key hashes', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENTERPRISE_SECRET_HASH_PEPPER = 'p'.repeat(64);
    mockApiKeyCreate.mockResolvedValue({});
    mockApiKeyUpdate.mockResolvedValue({});

    const result = await apiGateway.createAPIKey('org-peppered', {
      name: 'Peppered production key',
      scopes: ['credentials:read'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: [],
      dailyQuota: 1000,
      monthlyQuota: 50000,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
    });

    const expectedHash = hmacEnterpriseSecret(
      'enterprise-api-key',
      result.apiKey,
    );
    const legacyHash = crypto
      .createHash('sha256')
      .update(result.apiKey)
      .digest('hex');

    expect(mockApiKeyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        keyHash: expectedHash,
      }),
    }));
    expect(expectedHash).not.toBe(legacyHash);

    mockApiKeyFindUnique.mockResolvedValue({
      id: result.apiKeyId,
      organizationId: 'org-peppered',
      name: 'Peppered production key',
      keyHash: expectedHash,
      keyPrefix: result.apiKey.substring(0, 12),
      scopes: ['credentials:read'],
      environment: 'production',
      rateLimitPerMinute: 6000,
      ipAllowlist: [],
      expiresAt: new Date(result.expiresAt),
      isActive: true,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    await expect(
      apiGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
        'credentials:read',
      ]),
    ).resolves.toMatchObject({
      apiKeyId: result.apiKeyId,
      clientId: 'org-peppered',
    });
    expect(mockApiKeyFindUnique).toHaveBeenCalledWith({
      where: { keyHash: expectedHash },
    });
  });

  it('blocks production API and OAuth secret hashing without a deployment pepper', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENTERPRISE_SECRET_HASH_PEPPER;

    await expect(apiGateway.createAPIKey('org-no-pepper', {
      name: 'Missing pepper key',
      scopes: ['credentials:read'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: [],
      dailyQuota: 1000,
      monthlyQuota: 50000,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
    })).rejects.toMatchObject({
      code: 'SECRET_HASH_PEPPER_MISSING',
      statusCode: 500,
    });

    await expect(apiGateway.registerOAuth2Client(
      'oauth-client-no-pepper',
      ['credentials:read'],
      'production',
    )).rejects.toMatchObject({
      code: 'SECRET_HASH_PEPPER_MISSING',
      statusCode: 500,
    });
  });

  it('uses ZeroID production runtime for API key secret hashing gates', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ZEROID_ENV = 'production';
    delete process.env.ENTERPRISE_SECRET_HASH_PEPPER;

    await expect(apiGateway.createAPIKey('org-zeroid-prod', {
      name: 'Missing pepper key',
      scopes: ['credentials:read'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: [],
      dailyQuota: 1000,
      monthlyQuota: 50000,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
    })).rejects.toMatchObject({
      code: 'SECRET_HASH_PEPPER_MISSING',
      statusCode: 500,
    });

    await expect(apiGateway.registerOAuth2Client(
      'oauth-client-zeroid-prod',
      ['credentials:read'],
      'production',
    )).rejects.toMatchObject({
      code: 'SECRET_HASH_PEPPER_MISSING',
      statusCode: 500,
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

  it('uses peppered OAuth2 client secrets and access token keys in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENTERPRISE_SECRET_HASH_PEPPER = 'p'.repeat(64);

    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-peppered',
      ['credentials:read'],
      'production',
    );

    const storedClient = JSON.parse(
      redisStore[`enterprise:oauth2-client:${client.clientId}`] as string,
    );
    expect(storedClient.clientSecretHashAlg).toBe('hmac-sha256-v2');
    expect(storedClient.clientSecretHash).toBe(
      hmacEnterpriseSecret(
        'enterprise-oauth2-client-secret',
        client.clientSecret,
      ),
    );

    const token = await apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'credentials:read',
    });

    const expectedTokenKey = `enterprise:oauth2-token:${hmacEnterpriseSecret(
      'enterprise-oauth2-access-token',
      token.accessToken,
    )}`;
    expect(redisStore[expectedTokenKey]).toBeDefined();
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

  it('invalidates OAuth2 access tokens when the backing client is removed', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-revoked',
      ['credentials:read'],
      'production',
    );
    const token = await apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'credentials:read',
    });

    delete redisStore[`enterprise:oauth2-client:${client.clientId}`];

    await expect(apiGateway.validateOAuth2Token(token.accessToken)).rejects.toMatchObject({
      code: 'CLIENT_REVOKED',
      statusCode: 401,
    });
    expect(
      Object.keys(redisStore).some((key) =>
        key.startsWith('enterprise:oauth2-token:'),
      ),
    ).toBe(false);
  });

  it('invalidates OAuth2 access tokens whose scopes exceed the current client grant', async () => {
    const client = await apiGateway.registerOAuth2Client(
      'oauth-client-reduced-scope',
      ['credentials:read', 'verification:write'],
      'production',
    );
    const token = await apiGateway.issueOAuth2Token({
      grantType: 'client_credentials',
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'verification:write',
    });
    const clientKey = `enterprise:oauth2-client:${client.clientId}`;
    const storedClient = JSON.parse(redisStore[clientKey] as string);
    storedClient.scopes = ['credentials:read'];
    redisStore[clientKey] = JSON.stringify(storedClient);

    await expect(apiGateway.validateOAuth2Token(token.accessToken)).rejects.toMatchObject({
      code: 'INVALID_TOKEN_SCOPE',
      statusCode: 401,
    });
    expect(
      Object.keys(redisStore).some((key) =>
        key.startsWith('enterprise:oauth2-token:'),
      ),
    ).toBe(false);
  });

  it('enforces API key quotas through redis across gateway instances', async () => {
    mockApiKeyCreate.mockResolvedValue({});
    mockApiKeyUpdate.mockResolvedValue({});

    const result = await apiGateway.createAPIKey('org-quota', {
      name: 'Quota checked key',
      scopes: ['credentials:read'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: [],
      dailyQuota: 100,
      monthlyQuota: 1000,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
    });
    redisStore[`enterprise:api-key-config:${result.apiKeyId}`] = JSON.stringify({
      dailyQuota: 2,
      monthlyQuota: 2,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
      revokedAt: null,
      revokedReason: null,
    });
    const keyHash = crypto
      .createHash('sha256')
      .update(result.apiKey)
      .digest('hex');

    mockApiKeyFindUnique.mockResolvedValue({
      id: result.apiKeyId,
      organizationId: 'org-quota',
      name: 'Quota checked key',
      keyHash,
      keyPrefix: result.apiKey.substring(0, 12),
      scopes: ['credentials:read'],
      environment: 'production',
      rateLimitPerMinute: 6000,
      ipAllowlist: [],
      expiresAt: new Date(result.expiresAt),
      isActive: true,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const secondNodeGateway = new APIGateway();
    await apiGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
      'credentials:read',
    ]);
    await secondNodeGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
      'credentials:read',
    ]);

    await expect(
      secondNodeGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
        'credentials:read',
      ]),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      statusCode: 429,
    });

    await expect(apiGateway.getQuotaStatus(result.apiKeyId)).resolves.toEqual({
      daily: { used: 2, limit: 2 },
      monthly: { used: 2, limit: 2 },
    });
  });

  it('enforces API key rate limits through redis across gateway instances', async () => {
    mockApiKeyCreate.mockResolvedValue({});
    mockApiKeyUpdate.mockResolvedValue({});

    const result = await apiGateway.createAPIKey('org-rate', {
      name: 'Rate checked key',
      scopes: ['verification:write'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: [],
      dailyQuota: 1000,
      monthlyQuota: 1000,
      rateLimit: { requestsPerSecond: 1, burstSize: 1 },
      metadata: {},
    });
    const keyHash = crypto
      .createHash('sha256')
      .update(result.apiKey)
      .digest('hex');

    mockApiKeyFindUnique.mockResolvedValue({
      id: result.apiKeyId,
      organizationId: 'org-rate',
      name: 'Rate checked key',
      keyHash,
      keyPrefix: result.apiKey.substring(0, 12),
      scopes: ['verification:write'],
      environment: 'production',
      rateLimitPerMinute: 60,
      ipAllowlist: [],
      expiresAt: new Date(result.expiresAt),
      isActive: true,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const secondNodeGateway = new APIGateway();
    await apiGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
      'verification:write',
    ]);

    await expect(
      secondNodeGateway.authenticateRequest(result.apiKey, '10.0.0.1', [
        'verification:write',
      ]),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      statusCode: 429,
    });
  });

  it('matches API key IP allowlists with CIDR ranges and IPv4-mapped request addresses', async () => {
    mockApiKeyCreate.mockResolvedValue({});
    mockApiKeyUpdate.mockResolvedValue({});

    const result = await apiGateway.createAPIKey('org-cidr', {
      name: 'CIDR checked key',
      scopes: ['credentials:read'],
      environment: 'production',
      expiresInDays: 30,
      ipAllowlist: ['203.0.113.0/24'],
      dailyQuota: 1000,
      monthlyQuota: 1000,
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      metadata: {},
    });
    const keyHash = crypto
      .createHash('sha256')
      .update(result.apiKey)
      .digest('hex');

    mockApiKeyFindUnique.mockResolvedValue({
      id: result.apiKeyId,
      organizationId: 'org-cidr',
      name: 'CIDR checked key',
      keyHash,
      keyPrefix: result.apiKey.substring(0, 12),
      scopes: ['credentials:read'],
      environment: 'production',
      rateLimitPerMinute: 6000,
      ipAllowlist: ['203.0.113.0/24'],
      expiresAt: new Date(result.expiresAt),
      isActive: true,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    await expect(
      apiGateway.authenticateRequest(result.apiKey, '::ffff:203.0.113.42', [
        'credentials:read',
      ]),
    ).resolves.toMatchObject({
      apiKeyId: result.apiKeyId,
      clientId: 'org-cidr',
    });

    await expect(
      apiGateway.authenticateRequest(result.apiKey, '203.0.114.42', [
        'credentials:read',
      ]),
    ).rejects.toMatchObject({
      code: 'IP_NOT_ALLOWED',
      statusCode: 403,
    });
  });

  it('rejects malformed API key allowlist entries before storing them', async () => {
    await expect(
      apiGateway.createAPIKey('org-invalid-allowlist', {
        name: 'Bad allowlist',
        scopes: ['credentials:read'],
        environment: 'production',
        expiresInDays: 30,
        ipAllowlist: ['not-an-address'],
        dailyQuota: 1000,
        monthlyQuota: 1000,
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
        metadata: {},
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: 'IP allowlist entries must be IP addresses or CIDR ranges',
        }),
      ]),
    });

    expect(mockApiKeyCreate).not.toHaveBeenCalled();
  });

  it('persists API usage logs in the durable analytics store', async () => {
    mockApiUsageLogCreate.mockResolvedValue({});

    await apiGateway.recordUsage({
      apiKeyId: 'key-usage-1',
      clientId: 'org-usage',
      endpoint: '/credentials',
      method: 'POST',
      statusCode: 201,
      latencyMs: 42,
      requestSize: 128,
      responseSize: 256,
      environment: 'production',
      apiVersion: 'v1',
    });

    expect(mockApiUsageLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        apiKeyId: 'key-usage-1',
        endpoint: '/credentials',
        method: 'POST',
        statusCode: 201,
        responseTimeMs: 42,
        requestSize: 128,
        responseSize: 256,
      }),
    });
  });

  it('loads API analytics from persisted usage logs scoped by organization', async () => {
    mockApiUsageLogFindMany.mockResolvedValue([
      {
        id: 'usage-1',
        apiKeyId: 'key-1',
        endpoint: '/credentials',
        method: 'POST',
        statusCode: 201,
        responseTimeMs: 40,
        requestSize: 128,
        responseSize: 256,
        ipAddress: null,
        timestamp: new Date('2026-04-21T10:00:00.000Z'),
      },
      {
        id: 'usage-2',
        apiKeyId: 'key-1',
        endpoint: '/credentials',
        method: 'POST',
        statusCode: 500,
        responseTimeMs: 80,
        requestSize: 128,
        responseSize: 256,
        ipAddress: null,
        timestamp: new Date('2026-04-21T10:01:00.000Z'),
      },
      {
        id: 'usage-3',
        apiKeyId: 'key-2',
        endpoint: '/verification/verify',
        method: 'POST',
        statusCode: 200,
        responseTimeMs: 20,
        requestSize: 64,
        responseSize: 96,
        ipAddress: null,
        timestamp: new Date('2026-04-22T10:01:00.000Z'),
      },
    ]);

    const analytics = await apiGateway.getAnalytics('org-usage', 7);

    expect(mockApiUsageLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        apiKey: { organizationId: 'org-usage' },
      }),
      orderBy: { timestamp: 'asc' },
    }));
    expect(analytics).toMatchObject({
      totalRequests: 3,
      totalErrors: 1,
      averageLatencyMs: 47,
      statusCodeBreakdown: {
        '200': 1,
        '201': 1,
        '500': 1,
      },
    });
    expect(analytics.endpointBreakdown['POST /credentials']).toMatchObject({
      count: 2,
      errors: 1,
      avgLatencyMs: 60,
    });
    expect(analytics.dailyUsage).toEqual([
      { date: '2026-04-21', requests: 2, errors: 1 },
      { date: '2026-04-22', requests: 1, errors: 0 },
    ]);
    expect(analytics.topEndpoints[0]).toEqual({
      endpoint: 'POST /credentials',
      count: 2,
    });
  });

  it('requires API key ownership before returning quota status', async () => {
    mockApiKeyFindFirst.mockResolvedValue(null);

    await expect(
      apiGateway.getQuotaStatus('foreign-key-id', 'org-1'),
    ).rejects.toMatchObject({
      code: 'KEY_NOT_FOUND',
      statusCode: 404,
    });
    expect(mockApiKeyFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-key-id',
        organizationId: 'org-1',
      },
    });
    expect(mockApiKeyFindUnique).not.toHaveBeenCalled();
  });
});

function hmacEnterpriseSecret(context: string, secret: string): string {
  return crypto
    .createHmac(
      'sha256',
      process.env.ENTERPRISE_SECRET_HASH_PEPPER as string,
    )
    .update(`zeroid:${context}:v2:`)
    .update(secret)
    .digest('hex');
}
