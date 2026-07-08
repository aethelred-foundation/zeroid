import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import * as net from 'net';
import { prisma, redis } from '../../runtime';
import { isProductionRuntime } from '../production-safety';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'api-gateway' },
  transports: [new transports.Console()],
});

const ENTERPRISE_SECRET_HASH_PEPPER_ENV = 'ENTERPRISE_SECRET_HASH_PEPPER';
const MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH = 48;
const IPV4_BITS = 32;
const IPV6_BITS = 128;

interface ParsedIpAddress {
  family: 4 | 6;
  value: bigint;
}

function normalizeIpAddress(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return null;

  const mappedIpv4 = extractIpv4MappedAddress(normalized);
  if (mappedIpv4) return mappedIpv4;

  return net.isIP(normalized) ? normalized : null;
}

function extractIpv4MappedAddress(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;

  const high = parseInt(hexadecimal[1], 16);
  const low = parseInt(hexadecimal[2], 16);
  const ipv4 = [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');

  return net.isIP(ipv4) === 4 ? ipv4 : null;
}

function parseIpAddress(value: string): ParsedIpAddress | null {
  const normalized = normalizeIpAddress(value);
  if (!normalized) return null;

  const family = net.isIP(normalized);
  if (family === 4) {
    return {
      family,
      value: normalized
        .split('.')
        .map((part) => Number(part))
        .reduce((acc, octet) => (acc << 8n) + BigInt(octet), 0n),
    };
  }

  if (family !== 6) return null;
  const expanded = expandIpv6Address(normalized);
  if (!expanded) return null;

  return {
    family,
    value: expanded.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n),
  };
}

function expandIpv6Address(value: string): number[] | null {
  if (value.includes('%')) return null;
  const sections = value.split('::');
  if (sections.length > 2) return null;

  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  if (sections.length === 1 && left.length !== 8) return null;

  const missing = 8 - left.length - right.length;
  if (missing < 0 || (sections.length === 1 && missing !== 0)) return null;

  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8) return null;

  const parsed = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return Number.NaN;
    return parseInt(part, 16);
  });

  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? parsed
    : null;
}

function isValidIpAllowlistEntry(value: string): boolean {
  const [address, prefix, extra] = value.trim().split('/');
  if (extra !== undefined || !parseIpAddress(address)) return false;
  if (prefix === undefined) return true;

  if (!/^\d+$/.test(prefix)) return false;
  const parsedIp = parseIpAddress(address);
  if (!parsedIp) return false;
  const prefixLength = Number(prefix);
  const maxPrefix = parsedIp.family === 4 ? IPV4_BITS : IPV6_BITS;
  return prefixLength >= 0 && prefixLength <= maxPrefix;
}

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
  ipAllowlist: z
    .array(
      z
        .string()
        .trim()
        .refine(
          isValidIpAllowlistEntry,
          'IP allowlist entries must be IP addresses or CIDR ranges',
        ),
    )
    .default([]),
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

interface OAuth2ClientRecord {
  clientId: string;
  clientSecretHash: string;
  clientSecretHashAlg?: 'sha256' | 'hmac-sha256-v2';
  scopes: APIKeyScope[];
  environment: string;
}

interface OAuth2TokenRecord extends OAuth2Token {
  clientId: string;
  scopes: APIKeyScope[];
}

// ---------------------------------------------------------------------------
// APIGateway
// ---------------------------------------------------------------------------
export class APIGateway {
  // API version configuration
  private readonly supportedVersions = ['v1', 'v2'];
  private readonly defaultVersion = 'v1';

  constructor() {
    logger.info('APIGateway initialized');
  }

  private apiKeyConfigKey(apiKeyId: string): string {
    return `enterprise:api-key-config:${apiKeyId}`;
  }

  private oauth2ClientKey(clientId: string): string {
    return `enterprise:oauth2-client:${clientId}`;
  }

  private oauth2TokenKey(accessToken: string): string {
    return this.oauth2TokenKeyForHash(this.hashOAuth2AccessToken(accessToken));
  }

  private oauth2TokenKeyForHash(tokenHash: string): string {
    return `enterprise:oauth2-token:${tokenHash}`;
  }

  private rateLimitKey(apiKeyId: string): string {
    return `enterprise:api-rate:${apiKeyId}`;
  }

  private dailyQuotaKey(apiKeyId: string, dayKey: string): string {
    return `enterprise:api-quota:${apiKeyId}:day:${dayKey}`;
  }

  private monthlyQuotaKey(apiKeyId: string, monthKey: string): string {
    return `enterprise:api-quota:${apiKeyId}:month:${monthKey}`;
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
    const keyHash = this.hashAPIKey(rawKey);
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
    const keyRecord = await this.findAPIKeyByPresentedSecret(rawKey);
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
    if (key.ipAllowlist.length > 0 && !this.isRequestIpAllowed(requestIp, key.ipAllowlist)) {
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
    if (!(await this.checkRateLimit(keyId, key.rateLimit))) {
      throw new GatewayError('Rate limit exceeded', 'RATE_LIMITED', 429);
    }

    // Quota check
    if (!(await this.checkQuota(keyId, key.dailyQuota, key.monthlyQuota))) {
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
  async registerOAuth2Client(
    clientId: string,
    scopes: APIKeyScope[],
    environment: string,
  ): Promise<{ clientId: string; clientSecret: string }> {
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const client: OAuth2ClientRecord = {
      clientId,
      clientSecretHash: this.hashOAuth2ClientSecret(clientSecret),
      clientSecretHashAlg: this.getEnterpriseSecretHashPepper()
        ? 'hmac-sha256-v2'
        : 'sha256',
      scopes,
      environment,
    };

    await redis.set(this.oauth2ClientKey(clientId), JSON.stringify(client));

    logger.info('oauth2_client_registered', { clientId, scopes, environment });
    return { clientId, clientSecret };
  }

  async issueOAuth2Token(
    credentials: OAuth2ClientCredentials,
  ): Promise<OAuth2Token> {
    const parsed = OAuth2ClientCredentialsSchema.parse(credentials);
    const client = await this.getOAuth2Client(parsed.clientId);
    if (!client) {
      throw new GatewayError(
        'Invalid client credentials',
        'INVALID_CLIENT',
        401,
      );
    }

    if (!this.oauth2ClientSecretMatches(parsed.clientSecret, client)) {
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

    await redis.set(this.oauth2TokenKey(accessToken), JSON.stringify({
      ...token,
      clientId: parsed.clientId,
      scopes: requestedScopes,
    } satisfies OAuth2TokenRecord), 'EX', token.expiresIn);

    logger.info('oauth2_token_issued', { clientId: parsed.clientId });
    return token;
  }

  async validateOAuth2Token(accessToken: string): Promise<{
    clientId: string;
    scopes: APIKeyScope[];
    environment: string;
  }> {
    const tokenData = await this.getOAuth2Token(accessToken);
    if (!tokenData) {
      throw new GatewayError('Invalid access token', 'INVALID_TOKEN', 401);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > tokenData.issuedAt + tokenData.expiresIn) {
      await redis.del(this.oauth2TokenKey(accessToken));
      throw new GatewayError('Access token expired', 'TOKEN_EXPIRED', 401);
    }

    const client = await this.getOAuth2Client(tokenData.clientId);
    if (!client) {
      await redis.del(this.oauth2TokenKey(accessToken));
      throw new GatewayError(
        'OAuth2 client is no longer active',
        'CLIENT_REVOKED',
        401,
      );
    }

    const currentScopes = new Set(client.scopes);
    const unauthorizedScope = tokenData.scopes.find(
      (scope) => !currentScopes.has(scope),
    );
    if (unauthorizedScope) {
      await redis.del(this.oauth2TokenKey(accessToken));
      throw new GatewayError(
        'Access token scope is no longer authorized for this client',
        'INVALID_TOKEN_SCOPE',
        401,
      );
    }

    return {
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      environment: client.environment,
    };
  }

  private async getOAuth2Client(
    clientId: string,
  ): Promise<OAuth2ClientRecord | null> {
    const raw = await redis.get(this.oauth2ClientKey(clientId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as OAuth2ClientRecord;
    } catch {
      return null;
    }
  }

  private async getOAuth2Token(
    accessToken: string,
  ): Promise<OAuth2TokenRecord | null> {
    const keys = [this.oauth2TokenKey(accessToken)];
    if (this.allowLegacySecretHashFallback()) {
      const legacyKey = this.oauth2TokenKeyForHash(
        this.legacyOAuth2AccessTokenHash(accessToken),
      );
      if (!keys.includes(legacyKey)) keys.push(legacyKey);
    }

    let raw: string | null = null;
    for (const key of keys) {
      raw = await redis.get(key);
      if (raw) break;
    }
    if (!raw) return null;

    try {
      return JSON.parse(raw) as OAuth2TokenRecord;
    } catch {
      return null;
    }
  }

  private async findAPIKeyByPresentedSecret(rawKey: string): Promise<any | null> {
    const keyHashes = [this.hashAPIKey(rawKey)];
    if (this.allowLegacySecretHashFallback()) {
      const legacyHash = this.legacyAPIKeyHash(rawKey);
      if (!keyHashes.includes(legacyHash)) keyHashes.push(legacyHash);
    }

    for (const keyHash of keyHashes) {
      const keyRecord = await prisma.aPIKey.findUnique({
        where: { keyHash },
      });
      if (keyRecord) return keyRecord;
    }

    return null;
  }

  private hashAPIKey(rawKey: string): string {
    return this.hashEnterpriseSecret(
      'enterprise-api-key',
      rawKey,
      () => this.legacyAPIKeyHash(rawKey),
    );
  }

  private legacyAPIKeyHash(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private hashOAuth2ClientSecret(clientSecret: string): string {
    return this.hashEnterpriseSecret(
      'enterprise-oauth2-client-secret',
      clientSecret,
      () => this.legacyOAuth2ClientSecretHash(clientSecret),
    );
  }

  private legacyOAuth2ClientSecretHash(clientSecret: string): string {
    return crypto
      .createHash('sha256')
      .update('zeroid:enterprise-oauth2-client-secret:v1:')
      .update(clientSecret)
      .digest('hex');
  }

  private hashOAuth2AccessToken(accessToken: string): string {
    return this.hashEnterpriseSecret(
      'enterprise-oauth2-access-token',
      accessToken,
      () => this.legacyOAuth2AccessTokenHash(accessToken),
    );
  }

  private legacyOAuth2AccessTokenHash(accessToken: string): string {
    return crypto
      .createHash('sha256')
      .update('zeroid:enterprise-oauth2-access-token:v1:')
      .update(accessToken)
      .digest('hex');
  }

  private oauth2ClientSecretMatches(
    presentedSecret: string,
    client: OAuth2ClientRecord,
  ): boolean {
    const candidateHashes = [this.hashOAuth2ClientSecret(presentedSecret)];
    if (this.allowLegacySecretHashFallback()) {
      const legacyHash = this.legacyOAuth2ClientSecretHash(presentedSecret);
      if (!candidateHashes.includes(legacyHash)) candidateHashes.push(legacyHash);
      const legacyRawHash = crypto
        .createHash('sha256')
        .update(presentedSecret)
        .digest('hex');
      if (!candidateHashes.includes(legacyRawHash)) candidateHashes.push(legacyRawHash);
    }

    return candidateHashes.some((hash) =>
      this.timingSafeStringEqual(hash, client.clientSecretHash),
    );
  }

  private hashEnterpriseSecret(
    context: string,
    secret: string,
    legacyFallback: () => string,
  ): string {
    const pepper = this.getEnterpriseSecretHashPepper();
    if (!pepper) return legacyFallback();

    return crypto
      .createHmac('sha256', pepper)
      .update(`zeroid:${context}:v2:`)
      .update(secret)
      .digest('hex');
  }

  private getEnterpriseSecretHashPepper(): string | null {
    const pepper = process.env[ENTERPRISE_SECRET_HASH_PEPPER_ENV]?.trim();
    if (pepper && pepper.length >= MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH) {
      return pepper;
    }

    if (isProductionRuntime()) {
      throw new GatewayError(
        `${ENTERPRISE_SECRET_HASH_PEPPER_ENV} must be configured in production and contain at least ${MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH} characters`,
        'SECRET_HASH_PEPPER_MISSING',
        500,
      );
    }

    return null;
  }

  private allowLegacySecretHashFallback(): boolean {
    return !isProductionRuntime();
  }

  private timingSafeStringEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      crypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private isRequestIpAllowed(requestIp: string, allowlist: string[]): boolean {
    const parsedRequestIp = parseIpAddress(requestIp);
    if (!parsedRequestIp) return false;

    return allowlist.some((entry) =>
      this.ipAllowlistEntryMatches(parsedRequestIp, entry),
    );
  }

  private ipAllowlistEntryMatches(
    requestIp: ParsedIpAddress,
    entry: string,
  ): boolean {
    const [address, prefix] = entry.trim().split('/');
    const parsedEntry = parseIpAddress(address);
    if (!parsedEntry || parsedEntry.family !== requestIp.family) {
      return false;
    }

    if (prefix === undefined) {
      return parsedEntry.value === requestIp.value;
    }

    const prefixLength = Number(prefix);
    const width = requestIp.family === 4 ? IPV4_BITS : IPV6_BITS;
    if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > width) {
      return false;
    }

    const hostBits = BigInt(width - prefixLength);
    return (parsedEntry.value >> hostBits) === (requestIp.value >> hostBits);
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
  private async checkRateLimit(
    apiKeyId: string,
    config: { requestsPerSecond: number; burstSize: number },
  ): Promise<boolean> {
    const now = Date.now();
    const ttlMs = Math.max(
      60_000,
      Math.ceil((config.burstSize / config.requestsPerSecond) * 2_000),
    );
    const result = await redis.eval(
      `
      local raw = redis.call('GET', KEYS[1])
      local now = tonumber(ARGV[1])
      local rate = tonumber(ARGV[2])
      local burst = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])
      local tokens = burst
      local last = now

      if raw then
        local separator = string.find(raw, ':')
        if separator then
          tokens = tonumber(string.sub(raw, 1, separator - 1)) or burst
          last = tonumber(string.sub(raw, separator + 1)) or now
        end
      end

      local elapsed = math.max(0, now - last) / 1000
      tokens = math.min(burst, tokens + (elapsed * rate))

      if tokens < 1 then
        redis.call('SET', KEYS[1], tostring(tokens) .. ':' .. tostring(now), 'PX', ttl)
        return {0}
      end

      tokens = tokens - 1
      redis.call('SET', KEYS[1], tostring(tokens) .. ':' .. tostring(now), 'PX', ttl)
      return {1}
      `,
      1,
      this.rateLimitKey(apiKeyId),
      now,
      config.requestsPerSecond,
      config.burstSize,
      ttlMs,
    );

    return this.redisInteger(Array.isArray(result) ? result[0] : result) === 1;
  }

  // -------------------------------------------------------------------------
  // Quota management
  // -------------------------------------------------------------------------
  private async checkQuota(
    apiKeyId: string,
    dailyLimit: number,
    monthlyLimit: number,
  ): Promise<boolean> {
    const now = new Date();
    const dayKey = now.toISOString().substring(0, 10);
    const monthKey = now.toISOString().substring(0, 7);
    const result = await redis.eval(
      `
      local daily = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
      local monthly = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
      local dailyLimit = tonumber(ARGV[1])
      local monthlyLimit = tonumber(ARGV[2])
      local dailyTtl = tonumber(ARGV[3])
      local monthlyTtl = tonumber(ARGV[4])

      if daily + 1 > dailyLimit or monthly + 1 > monthlyLimit then
        return {0, daily, monthly}
      end

      daily = redis.call('INCR', KEYS[1])
      if daily == 1 then
        redis.call('EXPIRE', KEYS[1], dailyTtl)
      end

      monthly = redis.call('INCR', KEYS[2])
      if monthly == 1 then
        redis.call('EXPIRE', KEYS[2], monthlyTtl)
      end

      return {1, daily, monthly}
      `,
      2,
      this.dailyQuotaKey(apiKeyId, dayKey),
      this.monthlyQuotaKey(apiKeyId, monthKey),
      dailyLimit,
      monthlyLimit,
      this.secondsUntilEndOfUtcDay(now),
      this.secondsUntilEndOfUtcMonth(now),
    );

    return this.redisInteger(Array.isArray(result) ? result[0] : result) === 1;
  }

  async getQuotaStatus(apiKeyId: string): Promise<{
    daily: { used: number; limit: number };
    monthly: { used: number; limit: number };
  }>;
  async getQuotaStatus(apiKeyId: string, clientId: string): Promise<{
    daily: { used: number; limit: number };
    monthly: { used: number; limit: number };
  }>;
  async getQuotaStatus(apiKeyId: string, clientId?: string): Promise<{
    daily: { used: number; limit: number };
    monthly: { used: number; limit: number };
  }> {
    const keyRecord = clientId
      ? await prisma.aPIKey.findFirst({
          where: {
            id: apiKeyId,
            organizationId: clientId,
          },
        })
      : await prisma.aPIKey.findUnique({
          where: { id: apiKeyId },
        });
    if (!keyRecord) {
      throw new GatewayError('API key not found', 'KEY_NOT_FOUND', 404);
    }
    const key = await this.hydrateAPIKey(keyRecord);

    const now = new Date();
    const dayKey = now.toISOString().substring(0, 10);
    const monthKey = now.toISOString().substring(0, 7);
    const [dailyRaw, monthlyRaw] = await Promise.all([
      redis.get(this.dailyQuotaKey(apiKeyId, dayKey)),
      redis.get(this.monthlyQuotaKey(apiKeyId, monthKey)),
    ]);

    return {
      daily: {
        used: this.redisInteger(dailyRaw),
        limit: key.dailyQuota,
      },
      monthly: {
        used: this.redisInteger(monthlyRaw),
        limit: key.monthlyQuota,
      },
    };
  }

  private secondsUntilEndOfUtcDay(now: Date): number {
    const end = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      5,
    );
    return Math.max(60, Math.ceil((end - now.getTime()) / 1000));
  }

  private secondsUntilEndOfUtcMonth(now: Date): number {
    const end = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1,
      0,
      0,
      5,
    );
    return Math.max(60, Math.ceil((end - now.getTime()) / 1000));
  }

  private redisInteger(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value !== 'string') return 0;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // -------------------------------------------------------------------------
  // Usage metering
  // -------------------------------------------------------------------------
  async recordUsage(record: Omit<UsageRecord, 'timestamp'>): Promise<void> {
    await prisma.aPIUsageLog.create({
      data: {
        apiKeyId: record.apiKeyId,
        endpoint: record.endpoint,
        method: record.method,
        statusCode: record.statusCode,
        responseTimeMs: record.latencyMs,
        requestSize: record.requestSize,
        responseSize: record.responseSize,
        timestamp: new Date(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // API analytics
  // -------------------------------------------------------------------------
  async getAnalytics(clientId: string, periodDays = 30): Promise<APIAnalytics> {
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const records = await prisma.aPIUsageLog.findMany({
      where: {
        timestamp: { gte: cutoff },
        apiKey: {
          organizationId: clientId,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

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
        (ep.avgLatencyMs * ep.count + record.responseTimeMs) / (ep.count + 1);
      ep.count++;
      if (record.statusCode >= 400) ep.errors++;

      // Status codes
      const statusKey = String(record.statusCode);
      statusCodeBreakdown[statusKey] =
        (statusCodeBreakdown[statusKey] ?? 0) + 1;

      // Daily
      const dateKey = record.timestamp.toISOString().substring(0, 10);
      const daily = dailyMap.get(dateKey) ?? { requests: 0, errors: 0 };
      daily.requests++;
      if (record.statusCode >= 400) daily.errors++;
      dailyMap.set(dateKey, daily);

      totalLatency += record.responseTimeMs;
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
