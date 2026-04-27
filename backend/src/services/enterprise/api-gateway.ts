import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import { prisma, redis } from '../../index';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'api-gateway' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const APIKeyScopeSchema = z.enum([
  'credentials:read',
  'credentials:write',
  'verification:read',
  'verification:write',
  'identity:read',
  'identity:write',
  'compliance:read',
  'compliance:write',
  'webhooks:manage',
  'reports:read',
  'reports:write',
  'admin:full',
]);

export type APIKeyScope = z.infer<typeof APIKeyScopeSchema>;

export const CreateAPIKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(APIKeyScopeSchema).min(1),
  environment: z.enum(['sandbox', 'production']),
  expiresInDays: z.number().int().min(1).max(365).default(90),
  ipAllowlist: z.array(z.string()).default([]),
  dailyQuota: z.number().int().min(100).max(10_000_000).default(10000),
  monthlyQuota: z.number().int().min(1000).max(100_000_000).default(1_000_000),
  rateLimit: z
    .object({
      requestsPerSecond: z.number().int().min(1).max(10000).default(100),
      burstSize: z.number().int().min(1).max(50000).default(200),
    })
    .default({}),
  metadata: z.record(z.string()).default({}),
});

export type CreateAPIKey = z.infer<typeof CreateAPIKeySchema>;

export const OAuth2ClientCredentialsSchema = z.object({
  grantType: z.literal('client_credentials'),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string().optional(),
});

export type OAuth2ClientCredentials = z.infer<
  typeof OAuth2ClientCredentialsSchema
>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface APIKey {
  id: string;
  clientId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  scopes: APIKeyScope[];
  environment: 'sandbox' | 'production';
  ipAllowlist: string[];
  dailyQuota: number;
  monthlyQuota: number;
  rateLimit: { requestsPerSecond: number; burstSize: number };
  metadata: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  active: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
}

interface APIKeyConfig {
  dailyQuota: number;
  monthlyQuota: number;
  rateLimit: { requestsPerSecond: number; burstSize: number };
  metadata: Record<string, string>;
  revokedAt: string | null;
  revokedReason: string | null;
}

interface UsageRecord {
  apiKeyId: string;
  clientId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  requestSize: number;
  responseSize: number;
  timestamp: number;
  environment: string;
  apiVersion: string;
}

interface QuotaTracker {
  apiKeyId: string;
  dailyUsage: Map<string, number>; // dateKey -> count
  monthlyUsage: Map<string, number>; // monthKey -> count
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
  requestsPerSecond: number;
  burstSize: number;
}

interface APIAnalytics {
  totalRequests: number;
  totalErrors: number;
  averageLatencyMs: number;
  endpointBreakdown: Record<
    string,
    { count: number; errors: number; avgLatencyMs: number }
  >;
  statusCodeBreakdown: Record<string, number>;
  dailyUsage: Array<{ date: string; requests: number; errors: number }>;
  topEndpoints: Array<{ endpoint: string; count: number }>;
}

interface OAuth2Token {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  issuedAt: number;
}

// ---------------------------------------------------------------------------
// APIGateway
// ---------------------------------------------------------------------------
export class APIGateway {
  private usageRecords: UsageRecord[] = [];
  private quotaTrackers: Map<string, QuotaTracker> = new Map();
  private rateLimitStates: Map<string, RateLimitState> = new Map();
  private oauth2Clients: Map<
    string,
    {
      clientId: string;
      clientSecretHash: string;
      scopes: APIKeyScope[];
      environment: string;
    }
  > = new Map();
  private oauth2Tokens: Map<
    string,
    OAuth2Token & { clientId: string; scopes: APIKeyScope[] }
  > = new Map();

  private readonly maxUsageRecords = 500_000;

  // API version configuration
  private readonly supportedVersions = ['v1', 'v2'];
  private readonly defaultVersion = 'v1';

  constructor() {
    logger.info('APIGateway initialized');
  }

  private apiKeyConfigKey(apiKeyId: string): string {
    return `enterprise:api-key-config:${apiKeyId}`;
  }

  private async persistAPIKeyConfig(
    apiKeyId: string,
    config: APIKeyConfig,
  ): Promise<void> {
    await redis.set(this.apiKeyConfigKey(apiKeyId), JSON.stringify(config));
  }

  private async getAPIKeyConfig(
    apiKeyId: string,
  ): Promise<APIKeyConfig | null> {
    const raw = await redis.get(this.apiKeyConfigKey(apiKeyId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as APIKeyConfig;
    } catch {
      return null;
    }
  }

  private async hydrateAPIKey(record: any): Promise<APIKey> {
    const config = await this.getAPIKeyConfig(record.id);
    const dailyQuota = config?.dailyQuota ?? 10000;
    const monthlyQuota = config?.monthlyQuota ?? 1_000_000;
    const rateLimit = config?.rateLimit ?? {
      requestsPerSecond: Math.max(
        1,
        Math.floor((record.rateLimitPerMinute ?? 60) / 60),
      ),
      burstSize: Math.max(
        1,
        Math.floor((record.rateLimitPerMinute ?? 60) / 30),
      ),
    };

    return {
      id: record.id,
      clientId: record.organizationId,
      keyHash: record.keyHash,
      keyPrefix: record.keyPrefix,
      name: record.name,
      scopes: record.scopes,
      environment: record.environment,
      ipAllowlist: record.ipAllowlist,
      dailyQuota,
      monthlyQuota,
      rateLimit,
      metadata: config?.metadata ?? {},
      createdAt: record.createdAt.toISOString(),
      expiresAt:
        record.expiresAt?.toISOString() ??
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      active: record.isActive,
      revokedAt: config?.revokedAt ?? null,
      revokedReason: config?.revokedReason ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // API key management
  // -------------------------------------------------------------------------
  async createAPIKey(
    clientId: string,
    options: CreateAPIKey,
  ): Promise<{ apiKey: string; apiKeyId: string; expiresAt: string }> {
    const parsed = CreateAPIKeySchema.parse(options);
    const id = crypto.randomUUID();
    const rawKey = `zid_${parsed.environment === 'sandbox' ? 'test' : 'live'}_${crypto.randomBytes(24).toString('base64url')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const expiresAt = new Date(
      Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    await prisma.aPIKey.create({
      data: {
        id,
        organizationId: clientId,
        name: parsed.name,
        keyHash,
        keyPrefix,
        scopes: parsed.scopes,
        environment: parsed.environment,
        rateLimitPerMinute: parsed.rateLimit.requestsPerSecond * 60,
        ipAllowlist: parsed.ipAllowlist,
        expiresAt: new Date(expiresAt),
        isActive: true,
      },
    });

    await this.persistAPIKeyConfig(id, {
      dailyQuota: parsed.dailyQuota,
      monthlyQuota: parsed.monthlyQuota,
      rateLimit: parsed.rateLimit,
      metadata: parsed.metadata,
      revokedAt: null,
      revokedReason: null,
    });

    this.quotaTrackers.set(id, {
      apiKeyId: id,
      dailyUsage: new Map(),
      monthlyUsage: new Map(),
    });

    logger.info('api_key_created', {
      apiKeyId: id,
      organizationId: clientId,
      name: parsed.name,
      environment: parsed.environment,
      scopeCount: parsed.scopes.length,
      hasExpiration: Boolean(expiresAt),
    });

    return { apiKey: rawKey, apiKeyId: id, expiresAt };
  }

  async revokeAPIKey(
    apiKeyId: string,
    clientId: string,
    reason: string,
  ): Promise<void> {
    const keyRecord = await prisma.aPIKey.findFirst({
      where: {
        id: apiKeyId,
        organizationId: clientId,
      },
    });
    if (!keyRecord) {
      throw new GatewayError('API key not found', 'KEY_NOT_FOUND', 404);
    }

    await prisma.aPIKey.update({
      where: { id: apiKeyId },
      data: {
        isActive: false,
      },
    });

    const existingConfig = await this.getAPIKeyConfig(apiKeyId);
    await this.persistAPIKeyConfig(apiKeyId, {
      dailyQuota: existingConfig?.dailyQuota ?? 10000,
      monthlyQuota: existingConfig?.monthlyQuota ?? 1_000_000,
      rateLimit: existingConfig?.rateLimit ?? {
        requestsPerSecond: 100,
        burstSize: 200,
      },
      metadata: existingConfig?.metadata ?? {},
      revokedAt: new Date().toISOString(),
      revokedReason: reason,
    });

    logger.info('api_key_revoked', {
      apiKeyId,
      organizationId: clientId,
      environment: keyRecord.environment,
      reason,
    });
  }

  async listAPIKeys(clientId: string): Promise<Array<Omit<APIKey, 'keyHash'>>> {
    const keyRecords = await prisma.aPIKey.findMany({
      where: { organizationId: clientId },
      orderBy: { createdAt: 'desc' },
    });

    const keys = await Promise.all(
      keyRecords.map((record) => this.hydrateAPIKey(record)),
    );
    return keys.map(({ keyHash: _, ...rest }) => rest);
  }

  // -------------------------------------------------------------------------
  // Authenticate API request
  // -------------------------------------------------------------------------
  async authenticateRequest(
    rawKey: string,
    requestIp: string,
    requiredScopes: APIKeyScope[],
  ): Promise<{
    apiKeyId: string;
    clientId: string;
    environment: string;
    scopes: APIKeyScope[];
  }> {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyRecord = await prisma.aPIKey.findUnique({
      where: { keyHash },
    });
    if (!keyRecord) {
      throw new GatewayError('Invalid API key', 'INVALID_KEY', 401);
    }

    const key = await this.hydrateAPIKey(keyRecord);
    const keyId = key.id;

    if (!key.active) {
      throw new GatewayError('API key has been revoked', 'KEY_REVOKED', 401);
    }

    if (new Date(key.expiresAt) < new Date()) {
      throw new GatewayError('API key has expired', 'KEY_EXPIRED', 401);
    }

    // IP allowlist check
    if (key.ipAllowlist.length > 0 && !key.ipAllowlist.includes(requestIp)) {
      throw new GatewayError(
        'Request IP not in allowlist',
        'IP_NOT_ALLOWED',
        403,
      );
    }

    // Scope check
    const missingScopes = requiredScopes.filter(
      (s) => !key.scopes.includes(s) && !key.scopes.includes('admin:full'),
    );
    if (missingScopes.length > 0) {
      throw new GatewayError(
        `Missing required scopes: ${missingScopes.join(', ')}`,
        'INSUFFICIENT_SCOPE',
        403,
      );
    }

    // Rate limiting
    if (!this.checkRateLimit(keyId, key.rateLimit)) {
      throw new GatewayError('Rate limit exceeded', 'RATE_LIMITED', 429);
    }

    // Quota check
    if (!this.checkQuota(keyId, key.dailyQuota, key.monthlyQuota)) {
      throw new GatewayError('API quota exceeded', 'QUOTA_EXCEEDED', 429);
    }

    key.lastUsedAt = new Date().toISOString();
    await prisma.aPIKey.update({
      where: { id: keyId },
      data: {
        lastUsedAt: new Date(key.lastUsedAt),
      },
    });

    return {
      apiKeyId: keyId,
      clientId: key.clientId,
      environment: key.environment,
      scopes: key.scopes,
    };
  }

  // -------------------------------------------------------------------------
  // OAuth2 client credentials flow
  // -------------------------------------------------------------------------
  registerOAuth2Client(
    clientId: string,
    scopes: APIKeyScope[],
    environment: string,
  ): { clientId: string; clientSecret: string } {
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const clientSecretHash = this.hashOAuth2ClientSecret(clientSecret);

    this.oauth2Clients.set(clientId, {
      clientId,
      clientSecretHash,
      scopes,
      environment,
    });

    logger.info('oauth2_client_registered', { clientId, scopes, environment });
    return { clientId, clientSecret };
  }

  issueOAuth2Token(credentials: OAuth2ClientCredentials): OAuth2Token {
    const parsed = OAuth2ClientCredentialsSchema.parse(credentials);
    const client = this.oauth2Clients.get(parsed.clientId);
    if (!client) {
      throw new GatewayError(
        'Invalid client credentials',
        'INVALID_CLIENT',
        401,
      );
    }

    const secretHash = crypto
      .createHash('sha256')
      .update(parsed.clientSecret)
      .digest('hex');
    if (
      !this.timingSafeStringEqual(
        this.hashOAuth2ClientSecret(parsed.clientSecret),
        client.clientSecretHash,
      ) &&
      !this.timingSafeStringEqual(secretHash, client.clientSecretHash)
    ) {
      throw new GatewayError(
        'Invalid client credentials',
        'INVALID_CLIENT',
        401,
      );
    }

    const requestedScopes = this.resolveOAuth2RequestedScopes(
      parsed.scope,
      client.scopes,
    );
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const token: OAuth2Token = {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: requestedScopes.join(' '),
      issuedAt: Math.floor(Date.now() / 1000),
    };

    this.oauth2Tokens.set(accessToken, {
      ...token,
      clientId: parsed.clientId,
      scopes: requestedScopes,
    });

    logger.info('oauth2_token_issued', { clientId: parsed.clientId });
    return token;
  }

  validateOAuth2Token(accessToken: string): {
    clientId: string;
    scopes: APIKeyScope[];
    environment: string;
  } {
    const tokenData = this.oauth2Tokens.get(accessToken);
    if (!tokenData) {
      throw new GatewayError('Invalid access token', 'INVALID_TOKEN', 401);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > tokenData.issuedAt + tokenData.expiresIn) {
      this.oauth2Tokens.delete(accessToken);
      throw new GatewayError('Access token expired', 'TOKEN_EXPIRED', 401);
    }

    const client = this.oauth2Clients.get(tokenData.clientId);
    return {
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      environment: client?.environment ?? 'sandbox',
    };
  }

  private hashOAuth2ClientSecret(clientSecret: string): string {
    return crypto
      .createHash('sha256')
      .update('zeroid:enterprise-oauth2-client-secret:v1:')
      .update(clientSecret)
      .digest('hex');
  }

  private timingSafeStringEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      crypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private resolveOAuth2RequestedScopes(
    requestedScope: string | undefined,
    allowedScopes: APIKeyScope[],
  ): APIKeyScope[] {
    if (!requestedScope?.trim()) {
      return [...allowedScopes];
    }

    const requestedScopes = [
      ...new Set(requestedScope.split(/\s+/).filter(Boolean)),
    ] as APIKeyScope[];
    const allowed = new Set(allowedScopes);
    const unauthorizedScope = requestedScopes.find(
      (scope) => !allowed.has(scope),
    );
    if (unauthorizedScope) {
      throw new GatewayError(
        `Requested OAuth2 scope is not allowed: ${unauthorizedScope}`,
        'INVALID_SCOPE',
        400,
      );
    }

    return requestedScopes;
  }

  // -------------------------------------------------------------------------
  // Rate limiting (token bucket)
  // -------------------------------------------------------------------------
  private checkRateLimit(
    apiKeyId: string,
    config: { requestsPerSecond: number; burstSize: number },
  ): boolean {
    let state = this.rateLimitStates.get(apiKeyId);
    const now = Date.now();

    if (!state) {
      state = {
        tokens: config.burstSize,
        lastRefill: now,
        requestsPerSecond: config.requestsPerSecond,
        burstSize: config.burstSize,
      };
      this.rateLimitStates.set(apiKeyId, state);
    }

    // Refill tokens
    const elapsed = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(
      state.burstSize,
      state.tokens + elapsed * state.requestsPerSecond,
    );
    state.lastRefill = now;

    if (state.tokens < 1) {
      return false;
    }

    state.tokens -= 1;
    return true;
  }

  // -------------------------------------------------------------------------
  // Quota management
  // -------------------------------------------------------------------------
  private checkQuota(
    apiKeyId: string,
    dailyLimit: number,
    monthlyLimit: number,
  ): boolean {
    const tracker = this.quotaTrackers.get(apiKeyId);
    if (!tracker) return true;

    const now = new Date();
    const dayKey = now.toISOString().substring(0, 10);
    const monthKey = now.toISOString().substring(0, 7);

    const dailyCount = (tracker.dailyUsage.get(dayKey) ?? 0) + 1;
    const monthlyCount = (tracker.monthlyUsage.get(monthKey) ?? 0) + 1;

    if (dailyCount > dailyLimit || monthlyCount > monthlyLimit) {
      return false;
    }

    tracker.dailyUsage.set(dayKey, dailyCount);
    tracker.monthlyUsage.set(monthKey, monthlyCount);
    return true;
  }

  async getQuotaStatus(apiKeyId: string): Promise<{
    daily: { used: number; limit: number };
    monthly: { used: number; limit: number };
  }> {
    const keyRecord = await prisma.aPIKey.findUnique({
      where: { id: apiKeyId },
    });
    const tracker = this.quotaTrackers.get(apiKeyId);
    if (!keyRecord || !tracker) {
      throw new GatewayError('API key not found', 'KEY_NOT_FOUND', 404);
    }
    const key = await this.hydrateAPIKey(keyRecord);

    const now = new Date();
    const dayKey = now.toISOString().substring(0, 10);
    const monthKey = now.toISOString().substring(0, 7);

    return {
      daily: {
        used: tracker.dailyUsage.get(dayKey) ?? 0,
        limit: key.dailyQuota,
      },
      monthly: {
        used: tracker.monthlyUsage.get(monthKey) ?? 0,
        limit: key.monthlyQuota,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Usage metering
  // -------------------------------------------------------------------------
  recordUsage(record: Omit<UsageRecord, 'timestamp'>): void {
    this.usageRecords.push({ ...record, timestamp: Date.now() });
    if (this.usageRecords.length > this.maxUsageRecords) {
      this.usageRecords = this.usageRecords.slice(
        -Math.floor(this.maxUsageRecords / 2),
      );
    }
  }

  // -------------------------------------------------------------------------
  // API analytics
  // -------------------------------------------------------------------------
  getAnalytics(clientId: string, periodDays = 30): APIAnalytics {
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    const records = this.usageRecords.filter(
      (r) => r.clientId === clientId && r.timestamp >= cutoff,
    );

    const endpointBreakdown: APIAnalytics['endpointBreakdown'] = {};
    const statusCodeBreakdown: Record<string, number> = {};
    const dailyMap = new Map<string, { requests: number; errors: number }>();
    let totalLatency = 0;
    let totalErrors = 0;

    for (const record of records) {
      // Endpoint breakdown
      const key = `${record.method} ${record.endpoint}`;
      if (!endpointBreakdown[key]) {
        endpointBreakdown[key] = { count: 0, errors: 0, avgLatencyMs: 0 };
      }
      const ep = endpointBreakdown[key];
      ep.avgLatencyMs =
        (ep.avgLatencyMs * ep.count + record.latencyMs) / (ep.count + 1);
      ep.count++;
      if (record.statusCode >= 400) ep.errors++;

      // Status codes
      const statusKey = String(record.statusCode);
      statusCodeBreakdown[statusKey] =
        (statusCodeBreakdown[statusKey] ?? 0) + 1;

      // Daily
      const dateKey = new Date(record.timestamp).toISOString().substring(0, 10);
      const daily = dailyMap.get(dateKey) ?? { requests: 0, errors: 0 };
      daily.requests++;
      if (record.statusCode >= 400) daily.errors++;
      dailyMap.set(dateKey, daily);

      totalLatency += record.latencyMs;
      if (record.statusCode >= 400) totalErrors++;
    }

    const topEndpoints = Object.entries(endpointBreakdown)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([endpoint, data]) => ({ endpoint, count: data.count }));

    const dailyUsage = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    return {
      totalRequests: records.length,
      totalErrors,
      averageLatencyMs:
        records.length > 0 ? Math.round(totalLatency / records.length) : 0,
      endpointBreakdown,
      statusCodeBreakdown,
      dailyUsage,
      topEndpoints,
    };
  }

  // -------------------------------------------------------------------------
  // API versioning
  // -------------------------------------------------------------------------
  resolveVersion(requestedVersion?: string): string {
    if (!requestedVersion) return this.defaultVersion;
    if (this.supportedVersions.includes(requestedVersion))
      return requestedVersion;
    throw new GatewayError(
      `Unsupported API version: ${requestedVersion}. Supported: ${this.supportedVersions.join(', ')}`,
      'UNSUPPORTED_VERSION',
      400,
    );
  }

  // -------------------------------------------------------------------------
  // Request/response transformation
  // -------------------------------------------------------------------------
  transformRequest(
    body: Record<string, unknown>,
    fromVersion: string,
    toVersion: string,
  ): Record<string, unknown> {
    if (fromVersion === toVersion) return body;

    // v1 -> v2 transformation
    if (fromVersion === 'v1' && toVersion === 'v2') {
      const transformed = { ...body };
      // v2 uses camelCase for all fields and wraps in data envelope
      return { data: transformed, apiVersion: 'v2' };
    }

    // v2 -> v1 transformation
    if (fromVersion === 'v2' && toVersion === 'v1') {
      const data = (body.data as Record<string, unknown>) ?? body;
      return { ...data };
    }

    return body;
  }

  transformResponse(
    body: Record<string, unknown>,
    apiVersion: string,
  ): Record<string, unknown> {
    if (apiVersion === 'v2') {
      return {
        data: body,
        meta: {
          apiVersion: 'v2',
          timestamp: new Date().toISOString(),
        },
      };
    }
    return body;
  }

  // -------------------------------------------------------------------------
  // Environment isolation
  // -------------------------------------------------------------------------
  validateEnvironment(apiKeyEnvironment: string, requestPath: string): void {
    const isSandboxPath = requestPath.includes('/sandbox');
    const isProductionKey = apiKeyEnvironment === 'production';

    if (isSandboxPath && isProductionKey) {
      throw new GatewayError(
        'Production keys cannot access sandbox endpoints',
        'ENVIRONMENT_MISMATCH',
        403,
      );
    }
  }

  // -------------------------------------------------------------------------
  // SDK code generation metadata
  // -------------------------------------------------------------------------
  getSDKMetadata(): Record<string, unknown> {
    return {
      apiVersions: this.supportedVersions,
      defaultVersion: this.defaultVersion,
      baseUrls: {
        production: 'https://api.zeroid.aethelred.network',
        sandbox: 'https://sandbox.api.zeroid.aethelred.network',
      },
      authentication: {
        methods: ['api_key', 'oauth2_client_credentials'],
        apiKeyHeader: 'X-ZeroID-API-Key',
        oauth2TokenUrl: '/oauth2/token',
      },
      rateLimits: {
        standard: { requestsPerSecond: 100, burstSize: 200 },
        professional: { requestsPerSecond: 500, burstSize: 1000 },
        enterprise: { requestsPerSecond: 5000, burstSize: 10000 },
      },
      sdkLanguages: ['typescript', 'python', 'go', 'rust', 'java'],
      endpoints: this.getEndpointCatalog(),
    };
  }

  private getEndpointCatalog(): Array<{
    path: string;
    method: string;
    scopes: string[];
    versions: string[];
  }> {
    return [
      {
        path: '/credentials',
        method: 'POST',
        scopes: ['credentials:write'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/credentials/:id',
        method: 'GET',
        scopes: ['credentials:read'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/verification/verify',
        method: 'POST',
        scopes: ['verification:write'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/identity/register',
        method: 'POST',
        scopes: ['identity:write'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/compliance/screen',
        method: 'POST',
        scopes: ['compliance:write'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/compliance/status/:id',
        method: 'GET',
        scopes: ['compliance:read'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/enterprise/webhooks',
        method: 'POST',
        scopes: ['webhooks:manage'],
        versions: ['v1', 'v2'],
      },
      {
        path: '/enterprise/sla/report',
        method: 'GET',
        scopes: ['reports:read'],
        versions: ['v2'],
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const apiGateway = new APIGateway();
