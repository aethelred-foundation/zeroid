import { z } from "zod";
import { createLogger, format, transports } from "winston";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "api-gateway" },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const APIKeyScopeSchema = z.enum([
  "credentials:read",
  "credentials:write",
  "verification:read",
  "verification:write",
  "identity:read",
  "identity:write",
  "compliance:read",
  "compliance:write",
  "webhooks:manage",
  "reports:read",
  "reports:write",
  "admin:full",
]);

export type APIKeyScope = z.infer<typeof APIKeyScopeSchema>;

export const CreateAPIKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(APIKeyScopeSchema).min(1),
  environment: z.enum(["sandbox", "production"]),
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
  grantType: z.literal("client_credentials"),
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
  environment: "sandbox" | "production";
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
  private apiKeys: Map<string, APIKey> = new Map();
  private keyHashIndex: Map<string, string> = new Map(); // hash -> id
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
  private readonly supportedVersions = ["v1", "v2"];
  private readonly defaultVersion = "v1";

  constructor() {
    logger.info("APIGateway initialized");
  }

  // -------------------------------------------------------------------------
  // API key management
  // -------------------------------------------------------------------------
  createAPIKey(
    clientId: string,
    options: CreateAPIKey,
  ): { apiKey: string; apiKeyId: string; expiresAt: string } {
    const parsed = CreateAPIKeySchema.parse(options);
    const id = crypto.randomUUID();
    const rawKey = `zid_${parsed.environment === "sandbox" ? "test" : "live"}_${crypto.randomBytes(24).toString("base64url")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.substring(0, 12);
    const expiresAt = new Date(
      Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const apiKey: APIKey = {
      id,
      clientId,
      keyHash,
      keyPrefix,
      name: parsed.name,
      scopes: parsed.scopes,
      environment: parsed.environment,
      ipAllowlist: parsed.ipAllowlist,
      dailyQuota: parsed.dailyQuota,
      monthlyQuota: parsed.monthlyQuota,
      rateLimit: parsed.rateLimit,
      metadata: parsed.metadata,
      createdAt: new Date().toISOString(),
      expiresAt,
      lastUsedAt: null,
      active: true,
      revokedAt: null,
      revokedReason: null,
    };

    this.apiKeys.set(id, apiKey);
    this.keyHashIndex.set(keyHash, id);
    this.quotaTrackers.set(id, {
      apiKeyId: id,
      dailyUsage: new Map(),
      monthlyUsage: new Map(),
    });

    logger.info("api_key_created", {
      apiKeyId: id,
      clientId,
      name: parsed.name,
      environment: parsed.environment,
      scopes: parsed.scopes,
    });

    return { apiKey: rawKey, apiKeyId: id, expiresAt };
  }

  revokeAPIKey(apiKeyId: string, clientId: string, reason: string): void {
    const key = this.apiKeys.get(apiKeyId);
    if (!key || key.clientId !== clientId) {
      throw new GatewayError("API key not found", "KEY_NOT_FOUND", 404);
    }

    key.active = false;
    key.revokedAt = new Date().toISOString();
    key.revokedReason = reason;

    logger.info("api_key_revoked", { apiKeyId, clientId, reason });
  }

  listAPIKeys(clientId: string): Array<Omit<APIKey, "keyHash">> {
    return [...this.apiKeys.values()]
      .filter((k) => k.clientId === clientId)
      .map(({ keyHash: _, ...rest }) => rest);
  }

  // -------------------------------------------------------------------------
  // Authenticate API request
  // -------------------------------------------------------------------------
  authenticateRequest(
    rawKey: string,
    requestIp: string,
    requiredScopes: APIKeyScope[],
  ): {
    apiKeyId: string;
    clientId: string;
    environment: string;
    scopes: APIKeyScope[];
  } {
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyId = this.keyHashIndex.get(keyHash);
    if (!keyId) {
      throw new GatewayError("Invalid API key", "INVALID_KEY", 401);
    }

    const key = this.apiKeys.get(keyId)!;

    if (!key.active) {
      throw new GatewayError("API key has been revoked", "KEY_REVOKED", 401);
    }

    if (new Date(key.expiresAt) < new Date()) {
      throw new GatewayError("API key has expired", "KEY_EXPIRED", 401);
    }

    // IP allowlist check
    if (key.ipAllowlist.length > 0 && !key.ipAllowlist.includes(requestIp)) {
      throw new GatewayError(
        "Request IP not in allowlist",
        "IP_NOT_ALLOWED",
        403,
      );
    }

    // Scope check
    const missingScopes = requiredScopes.filter(
      (s) => !key.scopes.includes(s) && !key.scopes.includes("admin:full"),
    );
    if (missingScopes.length > 0) {
      throw new GatewayError(
        `Missing required scopes: ${missingScopes.join(", ")}`,
        "INSUFFICIENT_SCOPE",
        403,
      );
    }

    // Rate limiting
    if (!this.checkRateLimit(keyId, key.rateLimit)) {
      throw new GatewayError("Rate limit exceeded", "RATE_LIMITED", 429);
    }

    // Quota check
    if (!this.checkQuota(keyId, key.dailyQuota, key.monthlyQuota)) {
      throw new GatewayError("API quota exceeded", "QUOTA_EXCEEDED", 429);
    }

    key.lastUsedAt = new Date().toISOString();

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
    const clientSecret = crypto.randomBytes(32).toString("base64url");
    const clientSecretHash = crypto
      .createHash("sha256")
      .update(clientSecret)
      .digest("hex");

    this.oauth2Clients.set(clientId, {
      clientId,
      clientSecretHash,
      scopes,
      environment,
    });

    logger.info("oauth2_client_registered", { clientId, scopes, environment });
    return { clientId, clientSecret };
  }

  issueOAuth2Token(credentials: OAuth2ClientCredentials): OAuth2Token {
    const parsed = OAuth2ClientCredentialsSchema.parse(credentials);
    const client = this.oauth2Clients.get(parsed.clientId);
    if (!client) {
      throw new GatewayError(
        "Invalid client credentials",
        "INVALID_CLIENT",
        401,
      );
    }

    const secretHash = crypto
      .createHash("sha256")
      .update(parsed.clientSecret)
      .digest("hex");
    if (secretHash !== client.clientSecretHash) {
      throw new GatewayError(
        "Invalid client credentials",
        "INVALID_CLIENT",
        401,
      );
    }

    const accessToken = crypto.randomBytes(32).toString("base64url");
    const token: OAuth2Token = {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: parsed.scope ?? client.scopes.join(" "),
      issuedAt: Math.floor(Date.now() / 1000),
    };

    this.oauth2Tokens.set(accessToken, {
      ...token,
      clientId: parsed.clientId,
      scopes: client.scopes,
    });

    logger.info("oauth2_token_issued", { clientId: parsed.clientId });
    return token;
  }

  validateOAuth2Token(accessToken: string): {
    clientId: string;
    scopes: APIKeyScope[];
    environment: string;
  } {
    const tokenData = this.oauth2Tokens.get(accessToken);
    if (!tokenData) {
      throw new GatewayError("Invalid access token", "INVALID_TOKEN", 401);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > tokenData.issuedAt + tokenData.expiresIn) {
      this.oauth2Tokens.delete(accessToken);
      throw new GatewayError("Access token expired", "TOKEN_EXPIRED", 401);
    }

    const client = this.oauth2Clients.get(tokenData.clientId);
    return {
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      environment: client?.environment ?? "sandbox",
    };
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

  getQuotaStatus(apiKeyId: string): {
    daily: { used: number; limit: number };
    monthly: { used: number; limit: number };
  } {
    const key = this.apiKeys.get(apiKeyId);
    const tracker = this.quotaTrackers.get(apiKeyId);
    if (!key || !tracker) {
      throw new GatewayError("API key not found", "KEY_NOT_FOUND", 404);
    }

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
  recordUsage(record: Omit<UsageRecord, "timestamp">): void {
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

    const endpointBreakdown: APIAnalytics["endpointBreakdown"] = {};
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
      `Unsupported API version: ${requestedVersion}. Supported: ${this.supportedVersions.join(", ")}`,
      "UNSUPPORTED_VERSION",
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
    if (fromVersion === "v1" && toVersion === "v2") {
      const transformed = { ...body };
      // v2 uses camelCase for all fields and wraps in data envelope
      return { data: transformed, apiVersion: "v2" };
    }

    // v2 -> v1 transformation
    if (fromVersion === "v2" && toVersion === "v1") {
      const data = (body.data as Record<string, unknown>) ?? body;
      return { ...data };
    }

    return body;
  }

  transformResponse(
    body: Record<string, unknown>,
    apiVersion: string,
  ): Record<string, unknown> {
    if (apiVersion === "v2") {
      return {
        data: body,
        meta: {
          apiVersion: "v2",
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
    const isSandboxPath = requestPath.includes("/sandbox");
    const isProductionKey = apiKeyEnvironment === "production";

    if (isSandboxPath && isProductionKey) {
      throw new GatewayError(
        "Production keys cannot access sandbox endpoints",
        "ENVIRONMENT_MISMATCH",
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
        production: "https://api.zeroid.aethelred.network",
        sandbox: "https://sandbox.api.zeroid.aethelred.network",
      },
      authentication: {
        methods: ["api_key", "oauth2_client_credentials"],
        apiKeyHeader: "X-ZeroID-API-Key",
        oauth2TokenUrl: "/oauth2/token",
      },
      rateLimits: {
        standard: { requestsPerSecond: 100, burstSize: 200 },
        professional: { requestsPerSecond: 500, burstSize: 1000 },
        enterprise: { requestsPerSecond: 5000, burstSize: 10000 },
      },
      sdkLanguages: ["typescript", "python", "go", "rust", "java"],
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
        path: "/credentials",
        method: "POST",
        scopes: ["credentials:write"],
        versions: ["v1", "v2"],
      },
      {
        path: "/credentials/:id",
        method: "GET",
        scopes: ["credentials:read"],
        versions: ["v1", "v2"],
      },
      {
        path: "/verification/verify",
        method: "POST",
        scopes: ["verification:write"],
        versions: ["v1", "v2"],
      },
      {
        path: "/identity/register",
        method: "POST",
        scopes: ["identity:write"],
        versions: ["v1", "v2"],
      },
      {
        path: "/compliance/screen",
        method: "POST",
        scopes: ["compliance:write"],
        versions: ["v1", "v2"],
      },
      {
        path: "/compliance/status/:id",
        method: "GET",
        scopes: ["compliance:read"],
        versions: ["v1", "v2"],
      },
      {
        path: "/enterprise/webhooks",
        method: "POST",
        scopes: ["webhooks:manage"],
        versions: ["v1", "v2"],
      },
      {
        path: "/enterprise/sla/report",
        method: "GET",
        scopes: ["reports:read"],
        versions: ["v2"],
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
    this.name = "GatewayError";
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const apiGateway = new APIGateway();
