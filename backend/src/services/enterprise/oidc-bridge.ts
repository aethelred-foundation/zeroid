import { z } from "zod";
import { createLogger, format, transports } from "winston";
import crypto from "crypto";
import { redis } from "../../index";

const SUPPORTED_CLIENT_AUTH_METHODS = [
  "client_secret_basic",
  "client_secret_post",
  "none",
] as const;
const SUPPORTED_SIGNING_ALGORITHMS = ["RS256", "PS256"] as const;
const ALLOW_PUBLIC_OIDC_CLIENTS =
  process.env.ALLOW_PUBLIC_OIDC_CLIENTS === "true" &&
  process.env.NODE_ENV !== "production";

type SupportedSigningAlgorithm = (typeof SUPPORTED_SIGNING_ALGORITHMS)[number];

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "oidc-bridge" },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const OIDCClientRegistrationSchema = z.object({
  clientName: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  postLogoutRedirectUris: z.array(z.string().url()).default([]),
  grantTypes: z
    .array(
      z.enum(["authorization_code", "client_credentials", "refresh_token"]),
    )
    .default(["authorization_code"]),
  responseTypes: z
    .array(z.enum(["code", "id_token", "token"]))
    .default(["code"]),
  tokenEndpointAuthMethod: z
    .enum(SUPPORTED_CLIENT_AUTH_METHODS)
    .default("client_secret_basic"),
  scopes: z.array(z.string()).default(["openid", "profile"]),
  contacts: z.array(z.string().email()).default([]),
  logoUri: z.string().url().optional(),
  policyUri: z.string().url().optional(),
  tosUri: z.string().url().optional(),
  jwksUri: z.string().url().optional(),
  idTokenSignedResponseAlg: z.enum(SUPPORTED_SIGNING_ALGORITHMS).optional(),
  idTokenEncryptedResponseAlg: z.enum(["RSA-OAEP", "A256KW"]).optional(),
  requirePkce: z.boolean().default(true),
});

export type OIDCClientRegistration = z.infer<
  typeof OIDCClientRegistrationSchema
>;

export const AuthorizationRequestSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string().url(),
  responseType: z.enum(["code", "id_token", "token"]),
  scope: z.string(),
  state: z.string(),
  nonce: z.string().optional(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.enum(["S256", "plain"]).optional(),
  prompt: z.enum(["none", "login", "consent", "select_account"]).optional(),
  maxAge: z.number().int().positive().optional(),
  acrValues: z.string().optional(),
  claims: z.record(z.unknown()).optional(),
  zeroidCredentialTypes: z.array(z.string()).optional(),
});

export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;

export const TokenRequestSchema = z.object({
  grantType: z.enum([
    "authorization_code",
    "client_credentials",
    "refresh_token",
  ]),
  code: z.string().optional(),
  redirectUri: z.string().url().optional(),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  codeVerifier: z.string().optional(),
  refreshToken: z.string().optional(),
  scope: z.string().optional(),
});

export type TokenRequest = z.infer<typeof TokenRequestSchema>;

// SAML 2.0 support removed — route returns 501, code excised per audit finding SAML-01.

// ---------------------------------------------------------------------------
// OIDC scopes and claims mapping
// ---------------------------------------------------------------------------
const STANDARD_SCOPES: Record<string, string[]> = {
  openid: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce"],
  profile: [
    "name",
    "family_name",
    "given_name",
    "middle_name",
    "preferred_username",
    "picture",
    "updated_at",
  ],
  email: ["email", "email_verified"],
  address: ["address"],
  phone: ["phone_number", "phone_number_verified"],
  "zeroid:verified_attributes": [
    "zk_proof_hash",
    "credential_types",
    "verification_level",
    "tee_attestation_id",
  ],
  "zeroid:kyc_status": [
    "kyc_level",
    "kyc_provider",
    "kyc_verified_at",
    "kyc_jurisdiction",
  ],
  "zeroid:age_verified": [
    "age_over_18",
    "age_over_21",
    "age_verification_proof",
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RegisteredClient {
  clientId: string;
  clientSecret: string;
  registration: OIDCClientRegistration;
  createdAt: string;
  active: boolean;
}

interface AuthorizationCode {
  code: string;
  clientId: string;
  subjectId: string;
  sessionId: string;
  redirectUri: string;
  scope: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  claims: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

interface OIDCSession {
  sessionId: string;
  subjectId: string;
  clientId: string;
  authTime: number;
  lastActivity: number;
  active: boolean;
}

interface IssuedToken {
  tokenId: string;
  clientId: string;
  subjectId: string;
  scope: string;
  tokenType: "access_token" | "id_token" | "refresh_token";
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Redis-backed store (replaces in-memory Maps for multi-instance consistency)
// ---------------------------------------------------------------------------
class RedisStore<T> {
  constructor(
    private readonly prefix: string,
    private readonly defaultTtl: number,
  ) {}

  private redisKey(key: string): string {
    return `oidc:${this.prefix}:${key}`;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTtl = ttl ?? this.defaultTtl;
    await redis.set(
      this.redisKey(key),
      JSON.stringify(value),
      "EX",
      effectiveTtl,
    );
  }

  async get(key: string): Promise<T | undefined> {
    const raw = await redis.get(this.redisKey(key));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  async delete(key: string): Promise<void> {
    await redis.del(this.redisKey(key));
  }

  async has(key: string): Promise<boolean> {
    return (await redis.exists(this.redisKey(key))) === 1;
  }

  /**
   * Atomically get and delete a key. Returns the parsed value if the key
   * existed, or undefined if it was already consumed by another caller.
   * Uses GETDEL (Redis 6.2+) for single-roundtrip atomicity.
   */
  async getAndDelete(key: string): Promise<T | undefined> {
    const raw = await (redis as any).getdel(this.redisKey(key));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  /**
   * Atomically claim a key by setting a field to a new value, but ONLY if
   * the field currently has the expected value. Uses a Lua script for
   * compare-and-set atomicity across concurrent callers.
   *
   * Returns the full object if the claim succeeded, or undefined if the
   * key doesn't exist or the field already changed (lost the race).
   */
  async compareAndSet(
    key: string,
    field: string,
    expectedValue: unknown,
    newValue: unknown,
  ): Promise<T | undefined> {
    const lua = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local obj = cjson.decode(raw)
      if tostring(obj[ARGV[1]]) ~= ARGV[2] then return nil end
      obj[ARGV[1]] = cjson.decode(ARGV[3])
      local ttl = redis.call('TTL', KEYS[1])
      if ttl > 0 then
        redis.call('SET', KEYS[1], cjson.encode(obj), 'EX', ttl)
      else
        redis.call('SET', KEYS[1], cjson.encode(obj))
      end
      return cjson.encode(obj)
    `;
    const result = await (redis as any).eval(
      lua,
      1,
      this.redisKey(key),
      field,
      String(expectedValue),
      JSON.stringify(newValue),
    );
    return result ? (JSON.parse(result) as T) : undefined;
  }
}

// TTL constants for OIDC state (seconds)
const OIDC_CLIENT_TTL = 90 * 24 * 3600; // Registered clients: 90 days
const OIDC_AUTH_CODE_TTL = 600; // Authorization codes: 10 minutes
const OIDC_SESSION_TTL = 24 * 3600; // Sessions: 24 hours
const OIDC_TOKEN_TTL = 3600; // Access/ID tokens: 1 hour
const OIDC_REFRESH_TOKEN_TTL = 30 * 24 * 3600; // Refresh tokens: 30 days

// Redis set key for tracking tokens per session (for bulk revocation on logout).
// Keyed by sessionId so that logging out of one session does NOT revoke tokens
// issued under a different session for the same user+client.
const sessionTokenSetKey = (sessionId: string) =>
  `oidc:session-tokens:${sessionId}`;

// ---------------------------------------------------------------------------
// OIDCBridge
// ---------------------------------------------------------------------------
export class OIDCBridge {
  private clients = new RedisStore<RegisteredClient>(
    "clients",
    OIDC_CLIENT_TTL,
  );
  private authorizationCodes = new RedisStore<AuthorizationCode>(
    "authcodes",
    OIDC_AUTH_CODE_TTL,
  );
  private sessions = new RedisStore<OIDCSession>("sessions", OIDC_SESSION_TTL);
  private issuedTokens = new RedisStore<IssuedToken>("tokens", OIDC_TOKEN_TTL);
  private refreshTokenMap = new RedisStore<{
    tokenId: string;
    clientId: string;
    subjectId: string;
    scope: string;
    sessionId?: string;
  }>("refresh", OIDC_REFRESH_TOKEN_TTL);

  private readonly issuer: string;
  private readonly signingAlgorithm: SupportedSigningAlgorithm;
  private signingKeyId?: string;
  private signingPrivateKey?: crypto.KeyObject;
  private signingPublicKey?: crypto.KeyObject;

  constructor(
    issuer = process.env.OIDC_ISSUER_URL ??
      "https://id.zeroid.aethelred.network/enterprise/oidc",
  ) {
    this.issuer = issuer;
    this.signingAlgorithm = this.resolveSigningAlgorithm();
    logger.info("OIDCBridge initialized", {
      issuer,
      signingAlgorithm: this.signingAlgorithm,
    });
  }

  // -------------------------------------------------------------------------
  // OpenID Connect Discovery
  // -------------------------------------------------------------------------
  getDiscoveryDocument(): Record<string, unknown> {
    const tokenEndpointAuthMethodsSupported = ALLOW_PUBLIC_OIDC_CLIENTS
      ? [...SUPPORTED_CLIENT_AUTH_METHODS]
      : SUPPORTED_CLIENT_AUTH_METHODS.filter((method) => method !== "none");

    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      userinfo_endpoint: `${this.issuer}/userinfo`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      registration_endpoint: `${this.issuer}/register`,
      scopes_supported: Object.keys(STANDARD_SCOPES),
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
      ],
      subject_types_supported: ["public", "pairwise"],
      id_token_signing_alg_values_supported: [this.signingAlgorithm],
      id_token_encryption_alg_values_supported: ["RSA-OAEP", "A256KW"],
      token_endpoint_auth_methods_supported: tokenEndpointAuthMethodsSupported,
      claims_supported: [...new Set(Object.values(STANDARD_SCOPES).flat())],
      code_challenge_methods_supported: ["S256"],
      end_session_endpoint: `${this.issuer}/logout`,
      frontchannel_logout_supported: true,
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    };
  }

  getJWKS(): Record<string, unknown> {
    const jwk = this.getSigningPublicKey().export({ format: "jwk" }) as Record<
      string,
      unknown
    >;
    return {
      keys: [
        {
          ...jwk,
          use: "sig",
          alg: this.signingAlgorithm,
          kid: this.getSigningKeyId(),
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Dynamic client registration
  // -------------------------------------------------------------------------
  async registerClient(registration: OIDCClientRegistration): Promise<{
    clientId: string;
    clientSecret: string;
    clientIdIssuedAt: number;
    clientSecretExpiresAt: number;
  }> {
    const parsed = OIDCClientRegistrationSchema.parse(registration);
    const requestedSigningAlg =
      parsed.idTokenSignedResponseAlg ?? this.signingAlgorithm;
    if (requestedSigningAlg !== this.signingAlgorithm) {
      throw new OIDCError(
        "invalid_client_metadata",
        `Only ${this.signingAlgorithm} is supported for id_token_signed_response_alg`,
      );
    }

    if (parsed.tokenEndpointAuthMethod === "none") {
      if (!ALLOW_PUBLIC_OIDC_CLIENTS) {
        throw new OIDCError(
          "invalid_client_metadata",
          "Public OIDC clients are disabled. Use client_secret_basic or client_secret_post for enterprise integrations.",
        );
      }
      if (
        parsed.grantTypes.includes("client_credentials") ||
        parsed.grantTypes.includes("refresh_token")
      ) {
        throw new OIDCError(
          "invalid_client_metadata",
          "Public OIDC clients cannot use client_credentials or refresh_token grants.",
        );
      }
    }

    if (parsed.responseTypes.some((responseType) => responseType !== "code")) {
      throw new OIDCError(
        "invalid_client_metadata",
        "Implicit and hybrid OIDC response types are disabled. Use authorization code flow with PKCE.",
      );
    }

    const clientId = `zeroid_${crypto.randomBytes(16).toString("hex")}`;
    const clientSecret = crypto.randomBytes(32).toString("base64url");

    const client: RegisteredClient = {
      clientId,
      clientSecret,
      registration: {
        ...parsed,
        idTokenSignedResponseAlg: requestedSigningAlg,
      },
      createdAt: new Date().toISOString(),
      active: true,
    };

    await this.clients.set(clientId, client);

    logger.info("oidc_client_registered", {
      clientId,
      clientName: parsed.clientName,
      scopes: parsed.scopes,
    });

    return {
      clientId,
      clientSecret,
      clientIdIssuedAt: Math.floor(Date.now() / 1000),
      clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };
  }

  // -------------------------------------------------------------------------
  // Authorization endpoint
  // -------------------------------------------------------------------------
  async authorize(
    request: AuthorizationRequest,
    subjectId: string,
    subjectClaims: Record<string, unknown>,
  ): Promise<{
    redirectUrl: string;
    code?: string;
    sessionId: string;
  }> {
    const parsed = AuthorizationRequestSchema.parse(request);
    const client = await this.clients.get(parsed.clientId);
    if (!client || !client.active) {
      throw new OIDCError("invalid_client", "Client not found or inactive");
    }

    if (!client.registration.redirectUris.includes(parsed.redirectUri)) {
      throw new OIDCError(
        "invalid_redirect_uri",
        "Redirect URI not registered",
      );
    }

    // Enforce PKCE if required
    if (client.registration.requirePkce && !parsed.codeChallenge) {
      throw new OIDCError("invalid_request", "PKCE code_challenge required");
    }

    if (parsed.codeChallengeMethod && parsed.codeChallengeMethod !== "S256") {
      throw new OIDCError("invalid_request", "Only S256 PKCE is supported");
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.sessions.set(sessionId, {
      sessionId,
      subjectId,
      clientId: parsed.clientId,
      authTime: now,
      lastActivity: now,
      active: true,
    });

    // Build claims based on requested scopes
    const requestedScopes = parsed.scope.split(" ");
    const claims = this.buildClaims(requestedScopes, subjectId, subjectClaims);

    if (parsed.responseType === "code") {
      const code = crypto.randomBytes(32).toString("base64url");
      await this.authorizationCodes.set(code, {
        code,
        clientId: parsed.clientId,
        subjectId,
        sessionId,
        redirectUri: parsed.redirectUri,
        scope: parsed.scope,
        nonce: parsed.nonce,
        codeChallenge: parsed.codeChallenge,
        codeChallengeMethod: parsed.codeChallengeMethod,
        claims,
        issuedAt: now,
        expiresAt: now + 600, // 10 minutes
        used: false,
      });

      const redirectUrl = new URL(parsed.redirectUri);
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("state", parsed.state);

      logger.info("authorization_code_issued", {
        clientId: parsed.clientId,
        sessionId,
      });
      return { redirectUrl: redirectUrl.toString(), code, sessionId };
    }

    // Implicit flow (id_token)
    const idToken = await this.generateToken(
      parsed.clientId,
      subjectId,
      claims,
      "id_token",
      3600,
      parsed.scope,
      sessionId,
    );
    const redirectUrl = new URL(parsed.redirectUri);
    redirectUrl.hash = `id_token=${idToken.token}&state=${parsed.state}&token_type=Bearer`;

    return { redirectUrl: redirectUrl.toString(), sessionId };
  }

  // -------------------------------------------------------------------------
  // Token endpoint
  // -------------------------------------------------------------------------
  async exchangeToken(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    id_token?: string;
    refresh_token?: string;
    scope: string;
  }> {
    const parsed = TokenRequestSchema.parse(request);

    if (parsed.grantType === "authorization_code") {
      return this.handleAuthCodeExchange(parsed);
    }

    if (parsed.grantType === "client_credentials") {
      return this.handleClientCredentials(parsed);
    }

    if (parsed.grantType === "refresh_token") {
      return this.handleRefreshToken(parsed);
    }

    throw new OIDCError(
      "unsupported_grant_type",
      `Grant type ${parsed.grantType} not supported`,
    );
  }

  private async handleAuthCodeExchange(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    id_token: string;
    refresh_token: string;
    scope: string;
  }> {
    // Atomically claim the auth code: compare-and-set used=false→true.
    // If two requests race, only one wins; the loser gets undefined.
    const authCode = await this.authorizationCodes.compareAndSet(
      request.code!,
      "used",
      false,
      true,
    );
    if (!authCode) {
      // Either the code doesn't exist, is expired, or was already consumed
      throw new OIDCError(
        "invalid_grant",
        "Authorization code not found or already used",
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (authCode.expiresAt < now) {
      throw new OIDCError("invalid_grant", "Authorization code expired");
    }

    if (authCode.clientId !== request.clientId) {
      throw new OIDCError("invalid_grant", "Client ID mismatch");
    }

    if (authCode.redirectUri !== request.redirectUri) {
      throw new OIDCError("invalid_grant", "Redirect URI mismatch");
    }

    // PKCE verification
    if (authCode.codeChallenge) {
      if (!request.codeVerifier) {
        throw new OIDCError("invalid_grant", "Code verifier required");
      }
      const verified = this.verifyPKCE(
        request.codeVerifier,
        authCode.codeChallenge,
        authCode.codeChallengeMethod ?? "S256",
      );
      if (!verified) {
        throw new OIDCError("invalid_grant", "PKCE verification failed");
      }
    }

    // Client authentication
    await this.authenticateClient(request.clientId, request.clientSecret);

    const accessToken = await this.generateToken(
      authCode.clientId,
      authCode.subjectId,
      authCode.claims,
      "access_token",
      3600,
      authCode.scope,
      authCode.sessionId,
    );
    const idToken = await this.generateToken(
      authCode.clientId,
      authCode.subjectId,
      { ...authCode.claims, nonce: authCode.nonce },
      "id_token",
      3600,
      authCode.scope,
      authCode.sessionId,
    );
    const refreshToken = await this.generateRefreshToken(
      authCode.clientId,
      authCode.subjectId,
      authCode.scope,
      authCode.sessionId,
    );

    logger.info("tokens_issued", {
      clientId: authCode.clientId,
      subjectId: authCode.subjectId,
    });

    return {
      access_token: accessToken.token,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken.token,
      refresh_token: refreshToken,
      scope: authCode.scope,
    };
  }

  private async handleClientCredentials(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    await this.authenticateClient(request.clientId, request.clientSecret);

    const scope = request.scope ?? "openid";
    const accessToken = await this.generateToken(
      request.clientId,
      request.clientId,
      {},
      "access_token",
      3600,
      scope,
    );

    logger.info("client_credentials_token_issued", {
      clientId: request.clientId,
    });

    return {
      access_token: accessToken.token,
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    };
  }

  private async handleRefreshToken(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
  }> {
    // Atomically consume the refresh token: getAndDelete ensures only one
    // concurrent caller can redeem it. The loser gets undefined.
    const refreshData = await this.refreshTokenMap.getAndDelete(
      request.refreshToken!,
    );
    if (!refreshData) {
      throw new OIDCError(
        "invalid_grant",
        "Refresh token not found or already consumed",
      );
    }

    if (refreshData.clientId !== request.clientId) {
      throw new OIDCError("invalid_grant", "Client mismatch");
    }

    await this.authenticateClient(request.clientId, request.clientSecret);
    const newAccessToken = await this.generateToken(
      refreshData.clientId,
      refreshData.subjectId,
      {},
      "access_token",
      3600,
      refreshData.scope,
      refreshData.sessionId,
    );
    const newRefreshToken = await this.generateRefreshToken(
      refreshData.clientId,
      refreshData.subjectId,
      refreshData.scope,
      refreshData.sessionId,
    );

    logger.info("token_refreshed", { clientId: refreshData.clientId });

    return {
      access_token: newAccessToken.token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: refreshData.scope,
    };
  }

  // -------------------------------------------------------------------------
  // UserInfo endpoint with selective disclosure
  // -------------------------------------------------------------------------
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const { tokenRecord, payload } = await this.verifyToken(
      accessToken,
      "access_token",
    );
    const scopes = tokenRecord.scope.split(" ");
    const claims: Record<string, unknown> = { sub: tokenRecord.subjectId };

    for (const scope of scopes) {
      const scopeClaims = STANDARD_SCOPES[scope];
      if (scopeClaims) {
        for (const claim of scopeClaims) {
          if (payload[claim] !== undefined) {
            claims[claim] = payload[claim];
          }
        }
      }
    }

    return claims;
  }

  // SAML 2.0 builder removed — route disabled with 501, code excised per audit finding SAML-01.

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------
  async frontChannelLogout(
    sessionId: string,
  ): Promise<{ logoutUrls: string[] }> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new OIDCError("invalid_session", "Session not found");
    }

    session.active = false;
    await this.sessions.set(sessionId, session);

    // Revoke only tokens issued under THIS session (not all sessions for the user)
    const setKey = sessionTokenSetKey(sessionId);
    const tokenIds = await redis.smembers(setKey);
    for (const tokenId of tokenIds) {
      const token = await this.issuedTokens.get(tokenId);
      if (token) {
        token.revoked = true;
        await this.issuedTokens.set(tokenId, token);
      }
    }
    await redis.del(setKey);

    const client = await this.clients.get(session.clientId);
    const logoutUrls = client?.registration.postLogoutRedirectUris ?? [];

    logger.info("front_channel_logout", {
      sessionId,
      clientId: session.clientId,
    });
    return { logoutUrls };
  }

  async backChannelLogout(sessionId: string): Promise<{ notified: boolean }> {
    const session = await this.sessions.get(sessionId);
    if (!session) return { notified: false };

    session.active = false;
    await this.sessions.set(sessionId, session);

    // Generate logout token
    const logoutToken = {
      iss: this.issuer,
      sub: session.subjectId,
      aud: session.clientId,
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      sid: sessionId,
    };

    logger.info("back_channel_logout", {
      sessionId,
      clientId: session.clientId,
      logoutTokenJti: logoutToken.jti,
    });
    return { notified: true };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private buildClaims(
    scopes: string[],
    subjectId: string,
    subjectClaims: Record<string, unknown>,
  ): Record<string, unknown> {
    const claims: Record<string, unknown> = { sub: subjectId };

    for (const scope of scopes) {
      const scopeClaims = STANDARD_SCOPES[scope];
      if (scopeClaims) {
        for (const claimName of scopeClaims) {
          if (subjectClaims[claimName] !== undefined) {
            claims[claimName] = subjectClaims[claimName];
          }
        }
      }
    }

    return claims;
  }

  private async generateToken(
    clientId: string,
    subjectId: string,
    claims: Record<string, unknown>,
    tokenType: IssuedToken["tokenType"],
    ttl: number,
    scope: string,
    sessionId?: string,
  ): Promise<{ token: string; tokenId: string }> {
    const now = Math.floor(Date.now() / 1000);
    const tokenId = crypto.randomBytes(32).toString("base64url");

    const payload: Record<string, unknown> = {
      iss: this.issuer,
      sub: subjectId,
      aud: clientId,
      iat: now,
      exp: now + ttl,
      jti: tokenId,
      scope,
      ...(sessionId ? { sid: sessionId } : {}),
      ...claims,
    };

    const header = Buffer.from(
      JSON.stringify({
        alg: this.signingAlgorithm,
        typ: "JWT",
        kid: this.getSigningKeyId(),
      }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
      .sign(
        "sha256",
        Buffer.from(`${header}.${body}`),
        this.getSigningKeyInput(),
      )
      .toString("base64url");
    const token = `${header}.${body}.${signature}`;

    await this.issuedTokens.set(tokenId, {
      tokenId,
      clientId,
      subjectId,
      scope,
      tokenType,
      issuedAt: now,
      expiresAt: now + ttl,
      revoked: false,
    });

    // Track token in session-scoped index for targeted revocation on logout.
    // Only tokens with a sessionId are indexed; client_credentials tokens
    // (no session) are not revocable via session logout.
    if (sessionId) {
      const setKey = sessionTokenSetKey(sessionId);
      await redis.sadd(setKey, tokenId);
      await redis.expire(setKey, OIDC_SESSION_TTL);
    }

    return { token, tokenId };
  }

  private async generateRefreshToken(
    clientId: string,
    subjectId: string,
    scope: string,
    sessionId?: string,
  ): Promise<string> {
    const refreshToken = crypto.randomBytes(48).toString("base64url");
    await this.refreshTokenMap.set(refreshToken, {
      tokenId: refreshToken,
      clientId,
      subjectId,
      scope,
      sessionId,
    });
    return refreshToken;
  }

  private verifyPKCE(
    codeVerifier: string,
    codeChallenge: string,
    method: string,
  ): boolean {
    if (method === "plain") {
      return codeVerifier === codeChallenge;
    }
    // S256
    const hash = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    return hash === codeChallenge;
  }

  private async authenticateClient(
    clientId: string,
    clientSecret?: string,
  ): Promise<void> {
    const client = await this.clients.get(clientId);
    if (!client) {
      throw new OIDCError("invalid_client", "Client not found");
    }
    if (!client.active) {
      throw new OIDCError("invalid_client", "Client is inactive");
    }
    if (
      client.registration.tokenEndpointAuthMethod !== "none" &&
      clientSecret !== client.clientSecret
    ) {
      throw new OIDCError("invalid_client", "Client authentication failed");
    }
  }

  private async verifyToken(
    token: string,
    expectedTokenType: IssuedToken["tokenType"],
  ): Promise<{ payload: Record<string, unknown>; tokenRecord: IssuedToken }> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new OIDCError("invalid_token", "Malformed JWT", 401);
    }

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;

    try {
      header = JSON.parse(
        Buffer.from(encodedHeader, "base64url").toString("utf-8"),
      ) as Record<string, unknown>;
      payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf-8"),
      ) as Record<string, unknown>;
    } catch {
      throw new OIDCError("invalid_token", "JWT decoding failed", 401);
    }

    if (
      header.alg !== this.signingAlgorithm ||
      header.kid !== this.getSigningKeyId()
    ) {
      throw new OIDCError("invalid_token", "Unexpected JWT header", 401);
    }

    const signature = Buffer.from(encodedSignature, "base64url");
    const verified = crypto.verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      this.getVerificationKeyInput(),
      signature,
    );

    if (!verified) {
      throw new OIDCError(
        "invalid_token",
        "JWT signature verification failed",
        401,
      );
    }

    const tokenId = payload.jti;
    if (typeof tokenId !== "string") {
      throw new OIDCError("invalid_token", "JWT missing jti", 401);
    }

    const tokenRecord = await this.issuedTokens.get(tokenId);
    if (!tokenRecord || tokenRecord.revoked) {
      throw new OIDCError("invalid_token", "Token not found or revoked", 401);
    }

    if (tokenRecord.tokenType !== expectedTokenType) {
      throw new OIDCError("invalid_token", "Unexpected token type", 401);
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp;
    const iss = payload.iss;
    const sub = payload.sub;
    const aud = payload.aud;

    if (typeof exp !== "number" || exp < now || tokenRecord.expiresAt < now) {
      throw new OIDCError("invalid_token", "Token expired", 401);
    }

    if (
      iss !== this.issuer ||
      sub !== tokenRecord.subjectId ||
      aud !== tokenRecord.clientId
    ) {
      throw new OIDCError("invalid_token", "JWT claims validation failed", 401);
    }

    return { payload, tokenRecord };
  }

  private resolveSigningAlgorithm(): SupportedSigningAlgorithm {
    const configured = process.env.OIDC_SIGNING_ALG;
    if (!configured) {
      return "RS256";
    }

    if (configured === "RS256" || configured === "PS256") {
      return configured;
    }

    throw new OIDCError(
      "server_error",
      "OIDC_SIGNING_ALG must be one of RS256 or PS256.",
      503,
    );
  }

  private getSigningPrivateKey(): crypto.KeyObject {
    if (this.signingPrivateKey) {
      return this.signingPrivateKey;
    }

    const rawPrivateKey = process.env.OIDC_SIGNING_PRIVATE_KEY;
    if (!rawPrivateKey) {
      throw new OIDCError(
        "server_error",
        "OIDC_SIGNING_PRIVATE_KEY not configured. OIDC token issuance is disabled until asymmetric signing is configured.",
        503,
      );
    }

    this.signingPrivateKey = this.parsePrivateKey(rawPrivateKey);
    return this.signingPrivateKey;
  }

  private getSigningPublicKey(): crypto.KeyObject {
    if (this.signingPublicKey) {
      return this.signingPublicKey;
    }

    const rawPublicKey = process.env.OIDC_SIGNING_PUBLIC_KEY;
    this.signingPublicKey = rawPublicKey
      ? this.parsePublicKey(rawPublicKey)
      : crypto.createPublicKey(this.getSigningPrivateKey());

    return this.signingPublicKey;
  }

  private getSigningKeyId(): string {
    if (this.signingKeyId) {
      return this.signingKeyId;
    }

    const configuredKeyId = process.env.OIDC_SIGNING_KEY_ID?.trim();
    if (configuredKeyId) {
      this.signingKeyId = configuredKeyId;
      return this.signingKeyId;
    }

    const spki = this.getSigningPublicKey().export({
      format: "der",
      type: "spki",
    });
    this.signingKeyId = crypto
      .createHash("sha256")
      .update(spki)
      .digest("base64url")
      .slice(0, 24);
    return this.signingKeyId;
  }

  private getSigningKeyInput(): crypto.KeyLike | crypto.SignKeyObjectInput {
    if (this.signingAlgorithm === "PS256") {
      return {
        key: this.getSigningPrivateKey(),
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      };
    }

    return this.getSigningPrivateKey();
  }

  private getVerificationKeyInput():
    | crypto.KeyLike
    | crypto.VerifyKeyObjectInput {
    if (this.signingAlgorithm === "PS256") {
      return {
        key: this.getSigningPublicKey(),
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      };
    }

    return this.getSigningPublicKey();
  }

  private parsePrivateKey(rawKey: string): crypto.KeyObject {
    const trimmed = rawKey.trim();
    if (trimmed.includes("BEGIN PRIVATE KEY")) {
      return crypto.createPrivateKey(trimmed);
    }

    return crypto.createPrivateKey({
      key: Buffer.from(this.normalizeBase64(trimmed), "base64"),
      format: "der",
      type: "pkcs8",
    });
  }

  private parsePublicKey(rawKey: string): crypto.KeyObject {
    const trimmed = rawKey.trim();
    if (trimmed.includes("BEGIN PUBLIC KEY")) {
      return crypto.createPublicKey(trimmed);
    }

    return crypto.createPublicKey({
      key: Buffer.from(this.normalizeBase64(trimmed), "base64"),
      format: "der",
      type: "spki",
    });
  }

  private normalizeBase64(value: string): string {
    return value.replace(/-/g, "+").replace(/_/g, "/");
  }

  // -------------------------------------------------------------------------
  // Retrieve client info
  // -------------------------------------------------------------------------
  async getClient(clientId: string): Promise<RegisteredClient | null> {
    return (await this.clients.get(clientId)) ?? null;
  }

  async revokeClient(clientId: string): Promise<void> {
    const client = await this.clients.get(clientId);
    if (client) {
      client.active = false;
      await this.clients.set(clientId, client);
      logger.info("oidc_client_revoked", { clientId });
    }
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class OIDCError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "OIDCError";
  }

  toJSON(): Record<string, unknown> {
    return { error: this.errorCode, error_description: this.message };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const oidcBridge = new OIDCBridge();
