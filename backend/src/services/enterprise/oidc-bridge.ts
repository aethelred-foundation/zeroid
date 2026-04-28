import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import * as https from 'https';
import * as net from 'net';
import { promises as dns } from 'dns';
import { redis } from '../../index';

const PRIVATE_OIDC_HOSTNAME_SUFFIXES = [
  '.corp',
  '.home',
  '.internal',
  '.lan',
  '.local',
  '.localhost',
  '.test',
];

const isProductionRuntime = (): boolean => process.env.NODE_ENV === 'production';

function normalizeOidcHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isLocalOrPrivateOidcHost(hostname: string): boolean {
  const normalized = normalizeOidcHostname(hostname);
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '127.0.0.1' ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalized);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = extractIpv4MappedAddress(normalized);
    if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4);

    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return (
    !normalized.includes('.') ||
    PRIVATE_OIDC_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isPrivateIpv4Address(value: string): boolean {
  const octets = value.split('.').map(Number);
  const first = octets[0];
  const second = octets[1];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function extractIpv4MappedAddress(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;

  const high = parseInt(hexadecimal[1], 16);
  const low = parseInt(hexadecimal[2], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}

const isLoopbackHost = (url: URL): boolean =>
  ['localhost', '127.0.0.1', '::1'].includes(normalizeOidcHostname(url.hostname));

const isLocalDevelopmentUrl = (url: URL): boolean =>
  !isProductionRuntime() && isLoopbackHost(url);

const isTrustedProductionOidcUrl = (url: URL): boolean =>
  url.protocol === 'https:' &&
  url.username === '' &&
  url.password === '' &&
  !isLocalOrPrivateOidcHost(url.hostname);

const isSecureOidcUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return isProductionRuntime()
      ? isTrustedProductionOidcUrl(url)
      : url.protocol === 'https:' || isLocalDevelopmentUrl(url);
  } catch {
    return false;
  }
};

interface ResolvedOidcAddress {
  address: string;
  family: number;
}

interface ResolvedOidcEndpoint {
  endpoint: URL;
  pinnedAddress?: ResolvedOidcAddress;
}

interface BackChannelDeliveryResponse {
  ok: boolean;
  status: number;
}

const isTrustedProductionIssuer = (value: string): boolean => {
  try {
    const url = new URL(value);
    return isTrustedProductionOidcUrl(url);
  } catch {
    return false;
  }
};

const SUPPORTED_CLIENT_AUTH_METHODS = [
  'client_secret_basic',
  'client_secret_post',
  'none',
] as const;
const SUPPORTED_SIGNING_ALGORITHMS = ['RS256', 'PS256'] as const;
const ALLOW_PUBLIC_OIDC_CLIENTS =
  process.env.ALLOW_PUBLIC_OIDC_CLIENTS === 'true' &&
  process.env.NODE_ENV !== 'production';

type SupportedSigningAlgorithm = (typeof SUPPORTED_SIGNING_ALGORITHMS)[number];

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'oidc-bridge' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const OIDCClientRegistrationSchema = z.object({
  clientName: z.string().min(1),
  redirectUris: z
    .array(
      z
        .string()
        .url()
        .refine(
          isSecureOidcUrl,
          'Redirect URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
        ),
    )
    .min(1),
  postLogoutRedirectUris: z
    .array(
      z
        .string()
        .url()
        .refine(
          isSecureOidcUrl,
          'Post-logout redirect URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
        ),
    )
    .default([]),
  backchannelLogoutUri: z
    .string()
    .url()
    .refine(
      isSecureOidcUrl,
      'Back-channel logout URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
    )
    .optional(),
  backchannelLogoutSessionRequired: z.boolean().default(true),
  grantTypes: z
    .array(
      z.enum(['authorization_code', 'client_credentials', 'refresh_token']),
    )
    .default(['authorization_code']),
  responseTypes: z
    .array(z.enum(['code', 'id_token', 'token']))
    .default(['code']),
  tokenEndpointAuthMethod: z
    .enum(SUPPORTED_CLIENT_AUTH_METHODS)
    .default('client_secret_basic'),
  scopes: z.array(z.string()).default(['openid', 'profile']),
  contacts: z.array(z.string().email()).default([]),
  logoUri: z
    .string()
    .url()
    .refine(
      isSecureOidcUrl,
      'Logo URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
    )
    .optional(),
  policyUri: z
    .string()
    .url()
    .refine(
      isSecureOidcUrl,
      'Policy URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
    )
    .optional(),
  tosUri: z
    .string()
    .url()
    .refine(
      isSecureOidcUrl,
      'Terms URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
    )
    .optional(),
  jwksUri: z
    .string()
    .url()
    .refine(
      isSecureOidcUrl,
      'JWKS URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
    )
    .optional(),
  idTokenSignedResponseAlg: z.enum(SUPPORTED_SIGNING_ALGORITHMS).optional(),
  idTokenEncryptedResponseAlg: z.enum(['RSA-OAEP', 'A256KW']).optional(),
  requirePkce: z.boolean().default(true),
});

export type OIDCClientRegistration = z.infer<
  typeof OIDCClientRegistrationSchema
>;

export const AuthorizationRequestSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string().url(),
  responseType: z.enum(['code', 'id_token', 'token']),
  scope: z.string(),
  state: z.string(),
  nonce: z.string().optional(),
  codeChallenge: z.string().optional(),
  codeChallengeMethod: z.enum(['S256', 'plain']).optional(),
  prompt: z.enum(['none', 'login', 'consent', 'select_account']).optional(),
  maxAge: z.number().int().positive().optional(),
  acrValues: z.string().optional(),
  claims: z.record(z.unknown()).optional(),
  zeroidCredentialTypes: z.array(z.string()).optional(),
});

export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;

export const TokenRequestSchema = z.object({
  grantType: z.enum([
    'authorization_code',
    'client_credentials',
    'refresh_token',
  ]),
  code: z.string().optional(),
  redirectUri: z.string().url().optional(),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientAuthMethod: z
    .enum(SUPPORTED_CLIENT_AUTH_METHODS)
    .optional(),
  codeVerifier: z.string().optional(),
  refreshToken: z.string().optional(),
  scope: z.string().optional(),
});

export type TokenRequest = z.infer<typeof TokenRequestSchema>;
type OIDCGrantType = TokenRequest['grantType'];
type OIDCClientAuthMethod = TokenRequest['clientAuthMethod'];

export interface OIDCClientRegistrationResult {
  clientId: string;
  clientSecret: string;
  clientIdIssuedAt: number;
  clientSecretExpiresAt: number;
  status: OIDCClientStatus;
  approvalRequired: boolean;
}

// SAML 2.0 support removed — route returns 501, code excised per audit finding SAML-01.

// ---------------------------------------------------------------------------
// OIDC scopes and claims mapping
// ---------------------------------------------------------------------------
const STANDARD_SCOPES: Record<string, string[]> = {
  openid: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce'],
  profile: [
    'name',
    'family_name',
    'given_name',
    'middle_name',
    'preferred_username',
    'picture',
    'updated_at',
  ],
  email: ['email', 'email_verified'],
  address: ['address'],
  phone: ['phone_number', 'phone_number_verified'],
  'zeroid:verified_attributes': [
    'zk_proof_hash',
    'credential_types',
    'verification_level',
    'tee_attestation_id',
  ],
  'zeroid:kyc_status': [
    'kyc_level',
    'kyc_provider',
    'kyc_verified_at',
    'kyc_jurisdiction',
  ],
  'zeroid:age_verified': [
    'age_over_18',
    'age_over_21',
    'age_verification_proof',
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
  clientSecretHash?: string;
  clientSecretHashAlg?: 'sha256';
  clientSecretExpiresAt?: number;
  registration: OIDCClientRegistration;
  createdAt: string;
  active: boolean;
  status?: OIDCClientStatus;
  organizationId?: string;
  registeredByIdentityId?: string;
  registeredByRole?: string;
  approvedAt?: string;
  approvedByIdentityId?: string;
  deactivatedAt?: string;
  deactivatedByIdentityId?: string;
  deactivationReason?: string;
}

export type OIDCClientStatus = 'pending_approval' | 'active' | 'revoked';

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
  tokenType: 'access_token' | 'id_token' | 'refresh_token';
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

interface RefreshTokenRecord {
  tokenId: string;
  clientId: string;
  subjectId: string;
  scope: string;
  sessionId?: string;
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
    if (effectiveTtl > 0) {
      await redis.set(
        this.redisKey(key),
        JSON.stringify(value),
        'EX',
        effectiveTtl,
      );
      return;
    }

    await redis.set(this.redisKey(key), JSON.stringify(value));
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
    additionalExpectedFields: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    const lua = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local obj = cjson.decode(raw)
      if tostring(obj[ARGV[1]]) ~= ARGV[2] then return nil end
      local expected = cjson.decode(ARGV[4])
      for key, value in pairs(expected) do
        if tostring(obj[key]) ~= tostring(value) then return nil end
      end
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
      JSON.stringify(additionalExpectedFields),
    );
    return result ? (JSON.parse(result) as T) : undefined;
  }
}

// TTL constants for OIDC state (seconds)
const OIDC_CLIENT_TTL = 0; // Registered clients are durable until explicitly revoked.
const OIDC_AUTH_CODE_TTL = 600; // Authorization codes: 10 minutes
const OIDC_SESSION_TTL = 24 * 3600; // Sessions: 24 hours
const OIDC_TOKEN_TTL = 3600; // Access/ID tokens: 1 hour
const OIDC_REFRESH_TOKEN_TTL = 30 * 24 * 3600; // Refresh tokens: 30 days
const OIDC_CLIENT_SECRET_TTL = 365 * 24 * 3600; // Client secrets: 1 year

// Redis set key for tracking tokens per session (for bulk revocation on logout).
// Keyed by sessionId so that logging out of one session does NOT revoke tokens
// issued under a different session for the same user+client.
const sessionTokenSetKey = (sessionId: string) =>
  `oidc:session-tokens:${sessionId}`;
const sessionRefreshTokenSetKey = (sessionId: string) =>
  `oidc:session-refresh-tokens:${sessionId}`;
const organizationClientSetKey = (organizationId: string) =>
  `oidc:org-clients:${organizationId}`;

// ---------------------------------------------------------------------------
// OIDCBridge
// ---------------------------------------------------------------------------
export class OIDCBridge {
  private clients = new RedisStore<RegisteredClient>(
    'clients',
    OIDC_CLIENT_TTL,
  );
  private authorizationCodes = new RedisStore<AuthorizationCode>(
    'authcodes',
    OIDC_AUTH_CODE_TTL,
  );
  private sessions = new RedisStore<OIDCSession>('sessions', OIDC_SESSION_TTL);
  private issuedTokens = new RedisStore<IssuedToken>('tokens', OIDC_TOKEN_TTL);
  private refreshTokenMap = new RedisStore<RefreshTokenRecord>(
    'refresh',
    OIDC_REFRESH_TOKEN_TTL,
  );

  private readonly issuer: string;
  private readonly signingAlgorithm: SupportedSigningAlgorithm;
  private signingKeyId?: string;
  private signingPrivateKey?: crypto.KeyObject;
  private signingPublicKey?: crypto.KeyObject;

  constructor(
    issuer = process.env.OIDC_ISSUER_URL ??
      'https://id.zeroid.aethelred.network/enterprise/oidc',
  ) {
    if (process.env.NODE_ENV === 'production' && !isTrustedProductionIssuer(issuer)) {
      throw new Error(
        'OIDC_ISSUER_URL must be an HTTPS, non-local issuer URL in production.',
      );
    }

    this.issuer = issuer;
    this.signingAlgorithm = this.resolveSigningAlgorithm();
    logger.info('OIDCBridge initialized', {
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
      : SUPPORTED_CLIENT_AUTH_METHODS.filter((method) => method !== 'none');

    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      userinfo_endpoint: `${this.issuer}/userinfo`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      registration_endpoint: `${this.issuer}/register`,
      scopes_supported: Object.keys(STANDARD_SCOPES),
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'client_credentials',
        'refresh_token',
      ],
      subject_types_supported: ['public', 'pairwise'],
      id_token_signing_alg_values_supported: [this.signingAlgorithm],
      token_endpoint_auth_methods_supported: tokenEndpointAuthMethodsSupported,
      claims_supported: [...new Set(Object.values(STANDARD_SCOPES).flat())],
      code_challenge_methods_supported: ['S256'],
    };
  }

  getJWKS(): Record<string, unknown> {
    const jwk = this.getSigningPublicKey().export({ format: 'jwk' }) as Record<
      string,
      unknown
    >;
    return {
      keys: [
        {
          ...jwk,
          use: 'sig',
          alg: this.signingAlgorithm,
          kid: this.getSigningKeyId(),
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Dynamic client registration
  // -------------------------------------------------------------------------
  async registerClient(
    registration: OIDCClientRegistration,
  ): Promise<OIDCClientRegistrationResult>;
  async registerClient(
    registration: OIDCClientRegistration,
    ownership: {
      organizationId: string;
      registeredByIdentityId: string;
      registeredByRole: string;
    },
  ): Promise<OIDCClientRegistrationResult>;
  async registerClient(
    registration: OIDCClientRegistration,
    ownership?: {
      organizationId: string;
      registeredByIdentityId: string;
      registeredByRole: string;
    },
  ): Promise<OIDCClientRegistrationResult> {
    const parsed = OIDCClientRegistrationSchema.parse(registration);
    const requestedSigningAlg =
      parsed.idTokenSignedResponseAlg ?? this.signingAlgorithm;
    if (requestedSigningAlg !== this.signingAlgorithm) {
      throw new OIDCError(
        'invalid_client_metadata',
        `Only ${this.signingAlgorithm} is supported for id_token_signed_response_alg`,
      );
    }
    if (parsed.idTokenEncryptedResponseAlg) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Encrypted ID tokens are not supported until client key resolution and JWE issuance are enabled.',
      );
    }

    if (parsed.tokenEndpointAuthMethod === 'none') {
      if (!ALLOW_PUBLIC_OIDC_CLIENTS) {
        throw new OIDCError(
          'invalid_client_metadata',
          'Public OIDC clients are disabled. Use client_secret_basic or client_secret_post for enterprise integrations.',
        );
      }
      if (
        parsed.grantTypes.includes('client_credentials') ||
        parsed.grantTypes.includes('refresh_token')
      ) {
        throw new OIDCError(
          'invalid_client_metadata',
          'Public OIDC clients cannot use client_credentials or refresh_token grants.',
        );
      }
    }

    if (parsed.responseTypes.some((responseType) => responseType !== 'code')) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Implicit and hybrid OIDC response types are disabled. Use authorization code flow with PKCE.',
      );
    }
    if (
      isProductionRuntime() &&
      parsed.grantTypes.includes('authorization_code') &&
      parsed.requirePkce === false
    ) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Production authorization-code clients must require S256 PKCE.',
      );
    }
    this.assertKnownRegisteredScopes(parsed.scopes);

    const clientId = `zeroid_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const autoActivate =
      !ownership?.organizationId || ownership.registeredByRole === 'admin';
    const now = Math.floor(Date.now() / 1000);
    const createdAt = new Date(now * 1000).toISOString();
    const status: OIDCClientStatus = autoActivate
      ? 'active'
      : 'pending_approval';

    const client: RegisteredClient = {
      clientId,
      clientSecretHash: this.hashClientSecret(clientSecret),
      clientSecretHashAlg: 'sha256',
      clientSecretExpiresAt: now + OIDC_CLIENT_SECRET_TTL,
      registration: {
        ...parsed,
        idTokenSignedResponseAlg: requestedSigningAlg,
      },
      createdAt,
      active: autoActivate,
      status,
      organizationId: ownership?.organizationId,
      registeredByIdentityId: ownership?.registeredByIdentityId,
      registeredByRole: ownership?.registeredByRole,
      approvedAt: autoActivate ? createdAt : undefined,
      approvedByIdentityId: autoActivate
        ? ownership?.registeredByIdentityId
        : undefined,
    };

    await this.clients.set(clientId, client);
    if (ownership?.organizationId) {
      const orgKey = organizationClientSetKey(ownership.organizationId);
      await redis.sadd(orgKey, clientId);
      if (OIDC_CLIENT_TTL > 0) {
        await redis.expire(orgKey, OIDC_CLIENT_TTL);
      }
    }

    logger.info('oidc_client_registered', {
      clientId,
      clientName: parsed.clientName,
      scopes: parsed.scopes,
      organizationId: ownership?.organizationId,
      registeredByIdentityId: ownership?.registeredByIdentityId,
      registeredByRole: ownership?.registeredByRole,
      status,
    });

    return {
      clientId,
      clientSecret,
      clientIdIssuedAt: now,
      clientSecretExpiresAt: now + OIDC_CLIENT_SECRET_TTL,
      status,
      approvalRequired: status === 'pending_approval',
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
    const client = await this.getNormalizedClient(parsed.clientId);
    if (!client || !this.isClientActive(client)) {
      throw new OIDCError('invalid_client', 'Client not found or inactive');
    }
    this.assertClientGrantAllowed(client, 'authorization_code');

    if (parsed.responseType !== 'code') {
      throw new OIDCError(
        'unsupported_response_type',
        'Implicit and hybrid OIDC response types are disabled. Use authorization code flow with PKCE.',
      );
    }

    if (!client.registration.responseTypes.includes(parsed.responseType)) {
      throw new OIDCError(
        'unsupported_response_type',
        'Requested response type is not registered for this client',
      );
    }

    if (!isSecureOidcUrl(parsed.redirectUri)) {
      throw new OIDCError(
        'invalid_redirect_uri',
        'Redirect URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
      );
    }

    if (!client.registration.redirectUris.includes(parsed.redirectUri)) {
      throw new OIDCError(
        'invalid_redirect_uri',
        'Redirect URI not registered',
      );
    }

    const pkceRequired =
      client.registration.requirePkce !== false || isProductionRuntime();
    if (pkceRequired && !parsed.codeChallenge) {
      throw new OIDCError('invalid_request', 'PKCE code_challenge required');
    }

    if (parsed.codeChallengeMethod && parsed.codeChallengeMethod !== 'S256') {
      throw new OIDCError('invalid_request', 'Only S256 PKCE is supported');
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

    // Build claims based only on scopes registered for this client.
    const requestedScopes = this.assertScopesAllowed(client, parsed.scope);
    const claims = this.buildClaims(requestedScopes, subjectId, subjectClaims);

    if (parsed.responseType === 'code') {
      const code = crypto.randomBytes(32).toString('base64url');
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
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('state', parsed.state);

      logger.info('authorization_code_issued', {
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
      'id_token',
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
    this.assertTokenRequestRequiredFields(parsed);

    if (parsed.grantType === 'authorization_code') {
      return this.handleAuthCodeExchange(parsed);
    }

    if (parsed.grantType === 'client_credentials') {
      return this.handleClientCredentials(parsed);
    }

    if (parsed.grantType === 'refresh_token') {
      return this.handleRefreshToken(parsed);
    }

    throw new OIDCError(
      'unsupported_grant_type',
      `Grant type ${parsed.grantType} not supported`,
    );
  }

  private async handleAuthCodeExchange(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    id_token: string;
    refresh_token?: string;
    scope: string;
  }> {
    const client = await this.authenticateClient(
      request.clientId,
      request.clientSecret,
      request.clientAuthMethod,
    );
    this.assertClientGrantAllowed(client, 'authorization_code');

    const authCode = await this.authorizationCodes.get(request.code!);
    if (
      !authCode ||
      authCode.used ||
      authCode.clientId !== request.clientId ||
      authCode.redirectUri !== request.redirectUri
    ) {
      throw new OIDCError(
        'invalid_grant',
        'Authorization code not found, already used, or not bound to this client',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (authCode.expiresAt < now) {
      throw new OIDCError('invalid_grant', 'Authorization code expired');
    }

    if (authCode.clientId !== request.clientId) {
      throw new OIDCError('invalid_grant', 'Client ID mismatch');
    }

    if (authCode.redirectUri !== request.redirectUri) {
      throw new OIDCError('invalid_grant', 'Redirect URI mismatch');
    }
    this.assertScopesAllowed(client, authCode.scope);
    await this.assertAuthorizationSessionActive(authCode);

    const pkceRequired =
      client.registration.requirePkce !== false || isProductionRuntime();
    if (pkceRequired && !authCode.codeChallenge) {
      throw new OIDCError('invalid_grant', 'PKCE-bound code required');
    }

    if (authCode.codeChallenge) {
      if (!request.codeVerifier) {
        throw new OIDCError('invalid_grant', 'Code verifier required');
      }
      const verified = this.verifyPKCE(
        request.codeVerifier,
        authCode.codeChallenge,
        authCode.codeChallengeMethod ?? 'S256',
      );
      if (!verified) {
        throw new OIDCError('invalid_grant', 'PKCE verification failed');
      }
    }

    // Atomically claim the auth code only after verifier checks pass. If two
    // valid requests race, only one wins; failed PKCE attempts do not burn the
    // code and force the user through a fresh authorization round-trip.
    const claimedAuthCode = await this.authorizationCodes.compareAndSet(
      request.code!,
      'used',
      false,
      true,
      {
        clientId: request.clientId,
        redirectUri: request.redirectUri!,
        sessionId: authCode.sessionId,
      },
    );
    if (!claimedAuthCode) {
      throw new OIDCError(
        'invalid_grant',
        'Authorization code not found, already used, or not bound to this client',
      );
    }

    const accessToken = await this.generateToken(
      authCode.clientId,
      authCode.subjectId,
      authCode.claims,
      'access_token',
      3600,
      authCode.scope,
      authCode.sessionId,
    );
    const idToken = await this.generateToken(
      authCode.clientId,
      authCode.subjectId,
      { ...authCode.claims, nonce: authCode.nonce },
      'id_token',
      3600,
      authCode.scope,
      authCode.sessionId,
    );
    const refreshToken = client.registration.grantTypes.includes(
      'refresh_token',
    )
      ? await this.generateRefreshToken(
          authCode.clientId,
          authCode.subjectId,
          authCode.scope,
          authCode.sessionId,
        )
      : undefined;

    logger.info('tokens_issued', {
      clientId: authCode.clientId,
      subjectId: authCode.subjectId,
    });

    return {
      access_token: accessToken.token,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken.token,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      scope: authCode.scope,
    };
  }

  private async handleClientCredentials(request: TokenRequest): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  }> {
    const client = await this.authenticateClient(
      request.clientId,
      request.clientSecret,
      request.clientAuthMethod,
    );
    this.assertClientGrantAllowed(client, 'client_credentials');

    const requestedScopes = this.assertScopesAllowed(
      client,
      request.scope ?? 'openid',
    );
    const scope = requestedScopes.join(' ');
    const accessToken = await this.generateToken(
      request.clientId,
      request.clientId,
      {},
      'access_token',
      3600,
      scope,
    );

    logger.info('client_credentials_token_issued', {
      clientId: request.clientId,
    });

    return {
      access_token: accessToken.token,
      token_type: 'Bearer',
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
    const refreshToken = request.refreshToken!;
    const refreshTokenKey = this.hashRefreshToken(refreshToken);
    let refreshData = await this.refreshTokenMap.get(refreshTokenKey);
    let refreshStorageKey = refreshTokenKey;

    if (!refreshData && !this.isHashedCredentialStorageKey(refreshToken)) {
      if (process.env.NODE_ENV !== 'production') {
        refreshData = await this.refreshTokenMap.get(refreshToken);
        refreshStorageKey = refreshToken;
      } else {
        const legacyRefreshData = await this.refreshTokenMap.get(refreshToken);
        if (legacyRefreshData) {
          logger.error('oidc_plaintext_refresh_token_blocked', {
            clientId: request.clientId,
          });
        }
      }
    }

    if (!refreshData) {
      throw new OIDCError(
        'invalid_grant',
        'Refresh token not found or already consumed',
      );
    }

    if (refreshData.clientId !== request.clientId) {
      throw new OIDCError('invalid_grant', 'Client mismatch');
    }

    const client = await this.authenticateClient(
      request.clientId,
      request.clientSecret,
      request.clientAuthMethod,
    );
    this.assertClientGrantAllowed(client, 'refresh_token');
    this.assertScopesAllowed(client, refreshData.scope);
    await this.assertRefreshSessionActive(refreshData, refreshStorageKey);

    // Atomically consume the refresh token: getAndDelete ensures only one
    // concurrent caller can redeem it. The loser gets undefined.
    const consumedRefreshData =
      await this.refreshTokenMap.getAndDelete(refreshStorageKey);
    if (!consumedRefreshData) {
      throw new OIDCError(
        'invalid_grant',
        'Refresh token not found or already consumed',
      );
    }

    if (consumedRefreshData.clientId !== request.clientId) {
      throw new OIDCError('invalid_grant', 'Client mismatch');
    }
    this.assertScopesAllowed(client, consumedRefreshData.scope);

    if (consumedRefreshData.sessionId) {
      await redis.srem(
        sessionRefreshTokenSetKey(consumedRefreshData.sessionId),
        refreshStorageKey,
      );
    }

    await this.assertRefreshSessionActive(
      consumedRefreshData,
      refreshStorageKey,
    );

    const newAccessToken = await this.generateToken(
      consumedRefreshData.clientId,
      consumedRefreshData.subjectId,
      {},
      'access_token',
      3600,
      consumedRefreshData.scope,
      consumedRefreshData.sessionId,
    );
    const newRefreshToken = await this.generateRefreshToken(
      consumedRefreshData.clientId,
      consumedRefreshData.subjectId,
      consumedRefreshData.scope,
      consumedRefreshData.sessionId,
    );

    logger.info('token_refreshed', { clientId: consumedRefreshData.clientId });

    return {
      access_token: newAccessToken.token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: consumedRefreshData.scope,
    };
  }

  // -------------------------------------------------------------------------
  // UserInfo endpoint with selective disclosure
  // -------------------------------------------------------------------------
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const { tokenRecord, payload } = await this.verifyToken(
      accessToken,
      'access_token',
    );
    const scopes = tokenRecord.scope.split(' ');
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
      throw new OIDCError('invalid_session', 'Session not found');
    }

    session.active = false;
    await this.sessions.set(sessionId, session);

    await this.revokeSessionCredentials(sessionId);

    const client = await this.clients.get(session.clientId);
    const logoutUrls = client?.registration.postLogoutRedirectUris ?? [];
    const insecureLogoutUri = logoutUrls.find((uri) => !isSecureOidcUrl(uri));
    if (insecureLogoutUri) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Registered post-logout redirect URI must use HTTPS and must not target localhost, private, or internal hosts in production.',
      );
    }

    logger.info('front_channel_logout', {
      sessionId,
      clientId: session.clientId,
    });
    return { logoutUrls };
  }

  async backChannelLogout(
    sessionId: string,
  ): Promise<{ notified: boolean; deliveryStatus?: number }> {
    const session = await this.sessions.get(sessionId);
    if (!session) return { notified: false };

    session.active = false;
    await this.sessions.set(sessionId, session);
    await this.revokeSessionCredentials(sessionId);

    const client = await this.getNormalizedClient(session.clientId);
    const logoutUri = client?.registration.backchannelLogoutUri;
    if (!logoutUri) {
      logger.warn('back_channel_logout_uri_missing', {
        sessionId,
        clientId: session.clientId,
      });
      return { notified: false };
    }

    const logoutToken = this.signJwtPayload({
      iss: this.issuer,
      sub: session.subjectId,
      aud: session.clientId,
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      ...(client.registration.backchannelLogoutSessionRequired !== false
        ? { sid: sessionId }
        : {}),
    });

    const delivery = await this.deliverBackChannelLogout(
      logoutUri,
      logoutToken,
      sessionId,
      session.clientId,
    );

    logger.info('back_channel_logout', {
      sessionId,
      clientId: session.clientId,
      notified: delivery.notified,
      deliveryStatus: delivery.status,
    });
    return {
      notified: delivery.notified,
      ...(delivery.status ? { deliveryStatus: delivery.status } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private async deliverBackChannelLogout(
    logoutUri: string,
    logoutToken: string,
    sessionId: string,
    clientId: string,
  ): Promise<{ notified: boolean; status?: number }> {
    if (!isSecureOidcUrl(logoutUri)) {
      logger.warn('back_channel_logout_uri_unsafe', {
        sessionId,
        clientId,
      });
      return { notified: false };
    }

    try {
      const resolvedEndpoint = await this.resolveSafeOidcEndpoint(logoutUri);
      const response = resolvedEndpoint.pinnedAddress
        ? await this.postBackChannelLogoutWithPinnedAddress(
            resolvedEndpoint.endpoint,
            resolvedEndpoint.pinnedAddress,
            logoutToken,
          )
        : await this.postBackChannelLogoutWithFetch(logoutUri, logoutToken);

      if (!response.ok) {
        logger.warn('back_channel_logout_delivery_failed', {
          sessionId,
          clientId,
          status: response.status,
        });
      }

      return { notified: response.ok, status: response.status };
    } catch (err) {
      const error = err as Error;
      logger.error('back_channel_logout_delivery_error', {
        sessionId,
        clientId,
        error: error.message,
      });
      return { notified: false };
    }
  }

  private async resolveSafeOidcEndpoint(
    endpointUri: string,
  ): Promise<ResolvedOidcEndpoint> {
    const endpoint = new URL(endpointUri);
    if (!isProductionRuntime()) return { endpoint };

    if (isLocalOrPrivateOidcHost(endpoint.hostname)) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Back-channel logout URI resolved to localhost, private, or internal network infrastructure.',
      );
    }

    const resolvedAddresses = await dns.lookup(endpoint.hostname, {
      all: true,
      verbatim: true,
    });
    if (
      resolvedAddresses.length === 0 ||
      resolvedAddresses.some((entry) => isLocalOrPrivateOidcHost(entry.address))
    ) {
      throw new OIDCError(
        'invalid_client_metadata',
        'Back-channel logout URI resolved to localhost, private, or internal network infrastructure.',
      );
    }

    return { endpoint, pinnedAddress: resolvedAddresses[0] };
  }

  private async postBackChannelLogoutWithFetch(
    logoutUri: string,
    logoutToken: string,
  ): Promise<BackChannelDeliveryResponse> {
    const response = await fetch(logoutUri, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ logout_token: logoutToken }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    return { ok: response.ok, status: response.status };
  }

  private async postBackChannelLogoutWithPinnedAddress(
    endpoint: URL,
    pinnedAddress: ResolvedOidcAddress,
    logoutToken: string,
  ): Promise<BackChannelDeliveryResponse> {
    const body = new URLSearchParams({ logout_token: logoutToken }).toString();

    return new Promise((resolve, reject) => {
      const request = https.request(
        endpoint,
        {
          method: 'POST',
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(body),
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, pinnedAddress.address, pinnedAddress.family);
          },
          servername: endpoint.hostname,
          timeout: 5000,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.on('end', () => {
            resolve({ ok: status >= 200 && status < 300, status });
          });
          response.resume();
        },
      );

      request.on('timeout', () => {
        request.destroy(
          new Error('Back-channel logout delivery timed out.'),
        );
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  private async revokeSessionCredentials(sessionId: string): Promise<void> {
    // Revoke only tokens issued under THIS session (not all sessions for the user).
    const tokenSetKey = sessionTokenSetKey(sessionId);
    const tokenIds = await redis.smembers(tokenSetKey);
    for (const tokenId of tokenIds) {
      const token = await this.issuedTokens.get(tokenId);
      if (token) {
        token.revoked = true;
        await this.issuedTokens.set(tokenId, token);
      }
    }
    await redis.del(tokenSetKey);

    // Refresh tokens are bearer credentials too. If they survive logout, an
    // inactive session can mint fresh access tokens after the user signs out.
    const refreshSetKey = sessionRefreshTokenSetKey(sessionId);
    const refreshTokens = await redis.smembers(refreshSetKey);
    for (const refreshToken of refreshTokens) {
      await this.refreshTokenMap.delete(refreshToken);
    }
    await redis.del(refreshSetKey);
  }

  private async assertRefreshSessionActive(
    refreshData: RefreshTokenRecord,
    refreshStorageKey: string,
  ): Promise<void> {
    if (!refreshData.sessionId) {
      return;
    }

    const session = await this.sessions.get(refreshData.sessionId);
    if (
      !session ||
      !session.active ||
      session.clientId !== refreshData.clientId ||
      session.subjectId !== refreshData.subjectId
    ) {
      await this.refreshTokenMap.delete(refreshStorageKey);
      await redis.srem(
        sessionRefreshTokenSetKey(refreshData.sessionId),
        refreshStorageKey,
      );
      throw new OIDCError(
        'invalid_grant',
        'Refresh token session is no longer active',
      );
    }
  }

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
    tokenType: IssuedToken['tokenType'],
    ttl: number,
    scope: string,
    sessionId?: string,
  ): Promise<{ token: string; tokenId: string }> {
    const now = Math.floor(Date.now() / 1000);
    const tokenId = crypto.randomBytes(32).toString('base64url');

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

    const token = this.signJwtPayload(payload);

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

  private signJwtPayload(payload: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({
        alg: this.signingAlgorithm,
        typ: 'JWT',
        kid: this.getSigningKeyId(),
      }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .sign(
        'sha256',
        Buffer.from(`${header}.${body}`),
        this.getSigningKeyInput(),
      )
      .toString('base64url');

    return `${header}.${body}.${signature}`;
  }

  private async generateRefreshToken(
    clientId: string,
    subjectId: string,
    scope: string,
    sessionId?: string,
  ): Promise<string> {
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshTokenKey = this.hashRefreshToken(refreshToken);
    await this.refreshTokenMap.set(refreshTokenKey, {
      tokenId: refreshTokenKey,
      clientId,
      subjectId,
      scope,
      sessionId,
    });
    if (sessionId) {
      const setKey = sessionRefreshTokenSetKey(sessionId);
      await redis.sadd(setKey, refreshTokenKey);
      await redis.expire(setKey, OIDC_REFRESH_TOKEN_TTL);
    }
    return refreshToken;
  }

  private verifyPKCE(
    codeVerifier: string,
    codeChallenge: string,
    method: string,
  ): boolean {
    if (method === 'plain') {
      return codeVerifier === codeChallenge;
    }
    // S256
    const hash = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return hash === codeChallenge;
  }

  private async authenticateClient(
    clientId: string,
    clientSecret?: string,
    presentedAuthMethod?: OIDCClientAuthMethod,
  ): Promise<RegisteredClient> {
    const client = await this.getNormalizedClient(clientId);
    if (!client) {
      throw new OIDCError('invalid_client', 'Client not found');
    }
    if (!this.isClientActive(client)) {
      const lifecycleState = client.status ?? 'pending_approval';
      throw new OIDCError(
        'invalid_client',
        `Client is not active (${lifecycleState})`,
      );
    }
    const registeredAuthMethod = client.registration.tokenEndpointAuthMethod;
    const effectiveAuthMethod = presentedAuthMethod ?? registeredAuthMethod;
    if (effectiveAuthMethod !== registeredAuthMethod) {
      throw new OIDCError(
        'invalid_client',
        'Client authentication method does not match registration',
      );
    }

    if (registeredAuthMethod === 'none') {
      if (clientSecret) {
        throw new OIDCError('invalid_client', 'Client authentication failed');
      }
    } else {
      if (!clientSecret) {
        throw new OIDCError('invalid_client', 'Client authentication failed');
      }

      this.assertClientSecretFresh(client);
      const verification = this.verifyClientSecret(client, clientSecret);
      if (!verification.valid) {
        throw new OIDCError('invalid_client', 'Client authentication failed');
      }

      if (verification.legacyPlaintext) {
        await this.clients.set(clientId, {
          ...client,
          clientSecret: undefined,
          clientSecretHash: this.hashClientSecret(clientSecret),
          clientSecretHashAlg: 'sha256',
        });
        logger.info('oidc_client_secret_migrated_to_hash', { clientId });
      }
    }

    return client;
  }

  private assertTokenRequestRequiredFields(request: TokenRequest): void {
    if (request.grantType === 'authorization_code') {
      if (!request.code || !request.redirectUri) {
        throw new OIDCError(
          'invalid_request',
          'Authorization code grant requires code and redirectUri',
        );
      }
      return;
    }

    if (request.grantType === 'refresh_token' && !request.refreshToken) {
      throw new OIDCError(
        'invalid_request',
        'Refresh token grant requires refreshToken',
      );
    }
  }

  private assertClientGrantAllowed(
    client: RegisteredClient,
    grantType: OIDCGrantType,
  ): void {
    if (!client.registration.grantTypes.includes(grantType)) {
      throw new OIDCError(
        'unauthorized_client',
        `Client is not registered for ${grantType} grant`,
      );
    }
  }

  private assertKnownRegisteredScopes(scopes: string[]): void {
    if (scopes.length === 0) {
      throw new OIDCError(
        'invalid_client_metadata',
        'At least one registered scope is required',
      );
    }

    const unknownScope = scopes.find((scope) => !STANDARD_SCOPES[scope]);
    if (unknownScope) {
      throw new OIDCError(
        'invalid_client_metadata',
        `Unsupported registered scope: ${unknownScope}`,
      );
    }
  }

  private parseScopeString(scope: string): string[] {
    const scopes = [...new Set(scope.split(/\s+/).filter(Boolean))];
    if (scopes.length === 0) {
      throw new OIDCError('invalid_scope', 'At least one scope is required');
    }

    const unknownScope = scopes.find((item) => !STANDARD_SCOPES[item]);
    if (unknownScope) {
      throw new OIDCError('invalid_scope', `Unsupported scope: ${unknownScope}`);
    }

    return scopes;
  }

  private assertScopesAllowed(
    client: RegisteredClient,
    scope: string,
  ): string[] {
    this.assertKnownRegisteredScopes(client.registration.scopes);
    const requestedScopes = this.parseScopeString(scope);
    const registeredScopes = new Set(client.registration.scopes);
    const unauthorizedScope = requestedScopes.find(
      (item) => !registeredScopes.has(item),
    );
    if (unauthorizedScope) {
      throw new OIDCError(
        'invalid_scope',
        `Scope is not registered for this client: ${unauthorizedScope}`,
      );
    }

    return requestedScopes;
  }

  private async assertAuthorizationSessionActive(
    authCode: AuthorizationCode,
  ): Promise<void> {
    const session = await this.sessions.get(authCode.sessionId);
    if (
      !session ||
      !session.active ||
      session.clientId !== authCode.clientId ||
      session.subjectId !== authCode.subjectId
    ) {
      throw new OIDCError(
        'invalid_grant',
        'Authorization code session is no longer active',
      );
    }
  }

  private assertClientSecretFresh(client: RegisteredClient): void {
    const expiresAt = client.clientSecretExpiresAt;
    if (typeof expiresAt !== 'number') {
      if (process.env.NODE_ENV === 'production') {
        logger.error('oidc_client_secret_expiry_missing', {
          clientId: client.clientId,
        });
        throw new OIDCError(
          'invalid_client',
          'Client secret expiration is missing',
        );
      }
      return;
    }

    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      logger.warn('oidc_client_secret_expired', {
        clientId: client.clientId,
      });
      throw new OIDCError('invalid_client', 'Client secret expired');
    }
  }

  private hashClientSecret(clientSecret: string): string {
    return (
      'sha256:' +
      crypto
        .createHash('sha256')
        .update('zeroid:oidc-client-secret:v1:')
        .update(clientSecret)
        .digest('base64url')
    );
  }

  private hashRefreshToken(refreshToken: string): string {
    return (
      'sha256:' +
      crypto
        .createHash('sha256')
        .update('zeroid:oidc-refresh-token:v1:')
        .update(refreshToken)
        .digest('base64url')
    );
  }

  private isHashedCredentialStorageKey(value: string): boolean {
    return /^sha256:[A-Za-z0-9_-]{43}$/.test(value);
  }

  private verifyClientSecret(
    client: RegisteredClient,
    presentedSecret: string,
  ): { valid: boolean; legacyPlaintext: boolean } {
    if (client.clientSecretHash) {
      return {
        valid: this.timingSafeStringEqual(
          this.hashClientSecret(presentedSecret),
          client.clientSecretHash,
        ),
        legacyPlaintext: false,
      };
    }

    if (client.clientSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('oidc_plaintext_client_secret_blocked', {
          clientId: client.clientId,
        });
        return { valid: false, legacyPlaintext: false };
      }

      return {
        valid: this.timingSafeStringEqual(presentedSecret, client.clientSecret),
        legacyPlaintext: true,
      };
    }

    return { valid: false, legacyPlaintext: false };
  }

  private timingSafeStringEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      crypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private async verifyToken(
    token: string,
    expectedTokenType: IssuedToken['tokenType'],
  ): Promise<{ payload: Record<string, unknown>; tokenRecord: IssuedToken }> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new OIDCError('invalid_token', 'Malformed JWT', 401);
    }

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;

    try {
      header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
    } catch {
      throw new OIDCError('invalid_token', 'JWT decoding failed', 401);
    }

    if (
      header.alg !== this.signingAlgorithm ||
      header.kid !== this.getSigningKeyId()
    ) {
      throw new OIDCError('invalid_token', 'Unexpected JWT header', 401);
    }

    const signature = Buffer.from(encodedSignature, 'base64url');
    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      this.getVerificationKeyInput(),
      signature,
    );

    if (!verified) {
      throw new OIDCError(
        'invalid_token',
        'JWT signature verification failed',
        401,
      );
    }

    const tokenId = payload.jti;
    if (typeof tokenId !== 'string') {
      throw new OIDCError('invalid_token', 'JWT missing jti', 401);
    }

    const tokenRecord = await this.issuedTokens.get(tokenId);
    if (!tokenRecord || tokenRecord.revoked) {
      throw new OIDCError('invalid_token', 'Token not found or revoked', 401);
    }

    if (tokenRecord.tokenType !== expectedTokenType) {
      throw new OIDCError('invalid_token', 'Unexpected token type', 401);
    }

    const client = await this.getNormalizedClient(tokenRecord.clientId);
    if (!client || !this.isClientActive(client)) {
      throw new OIDCError(
        'invalid_token',
        'Token client is no longer active',
        401,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp;
    const iss = payload.iss;
    const sub = payload.sub;
    const aud = payload.aud;

    if (typeof exp !== 'number' || exp < now || tokenRecord.expiresAt < now) {
      throw new OIDCError('invalid_token', 'Token expired', 401);
    }

    if (
      iss !== this.issuer ||
      sub !== tokenRecord.subjectId ||
      aud !== tokenRecord.clientId
    ) {
      throw new OIDCError('invalid_token', 'JWT claims validation failed', 401);
    }

    return { payload, tokenRecord };
  }

  private resolveSigningAlgorithm(): SupportedSigningAlgorithm {
    const configured = process.env.OIDC_SIGNING_ALG;
    if (!configured) {
      return 'RS256';
    }

    if (configured === 'RS256' || configured === 'PS256') {
      return configured;
    }

    throw new OIDCError(
      'server_error',
      'OIDC_SIGNING_ALG must be one of RS256 or PS256.',
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
        'server_error',
        'OIDC_SIGNING_PRIVATE_KEY not configured. OIDC token issuance is disabled until asymmetric signing is configured.',
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
      return configuredKeyId;
    }

    const spki = this.getSigningPublicKey().export({
      format: 'der',
      type: 'spki',
    });
    const derivedKeyId = crypto
      .createHash('sha256')
      .update(spki)
      .digest('base64url')
      .slice(0, 24);
    this.signingKeyId = derivedKeyId;
    return derivedKeyId;
  }

  private getSigningKeyInput(): crypto.KeyLike | crypto.SignKeyObjectInput {
    if (this.signingAlgorithm === 'PS256') {
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
    if (this.signingAlgorithm === 'PS256') {
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
    if (trimmed.includes('BEGIN PRIVATE KEY')) {
      return crypto.createPrivateKey(trimmed);
    }

    return crypto.createPrivateKey({
      key: Buffer.from(this.normalizeBase64(trimmed), 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  }

  private parsePublicKey(rawKey: string): crypto.KeyObject {
    const trimmed = rawKey.trim();
    if (trimmed.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey(trimmed);
    }

    return crypto.createPublicKey({
      key: Buffer.from(this.normalizeBase64(trimmed), 'base64'),
      format: 'der',
      type: 'spki',
    });
  }

  private normalizeBase64(value: string): string {
    return value.replace(/-/g, '+').replace(/_/g, '/');
  }

  // -------------------------------------------------------------------------
  // Retrieve client info
  // -------------------------------------------------------------------------
  async getClient(clientId: string): Promise<RegisteredClient | null> {
    return (await this.getNormalizedClient(clientId)) ?? null;
  }

  async listClientsForOrganization(
    organizationId: string,
  ): Promise<RegisteredClient[]> {
    const clientIds: string[] = await redis.smembers(
      organizationClientSetKey(organizationId),
    );
    const clients = await Promise.all(
      clientIds.map(async (clientId: string) =>
        this.getNormalizedClient(clientId),
      ),
    );
    return clients
      .filter(
        (client): client is RegisteredClient =>
          client !== undefined && client.organizationId === organizationId,
      )
      .sort((left: RegisteredClient, right: RegisteredClient) =>
        right.createdAt.localeCompare(left.createdAt),
      );
  }

  async approveClient(
    clientId: string,
    organizationId: string,
    approverIdentityId: string,
  ): Promise<RegisteredClient> {
    const client = await this.requireOwnedClient(clientId, organizationId);
    if (client.status === 'revoked') {
      throw new OIDCError(
        'invalid_request',
        'Revoked client cannot be reactivated',
        409,
      );
    }
    if (this.isClientActive(client)) {
      return client;
    }

    const approvedClient: RegisteredClient = {
      ...client,
      active: true,
      status: 'active',
      approvedAt: new Date().toISOString(),
      approvedByIdentityId: approverIdentityId,
      deactivatedAt: undefined,
      deactivatedByIdentityId: undefined,
      deactivationReason: undefined,
    };
    await this.clients.set(clientId, approvedClient);
    logger.info('oidc_client_approved', {
      clientId,
      organizationId,
      approverIdentityId,
    });
    return approvedClient;
  }

  async deactivateClient(
    clientId: string,
    organizationId: string,
    actorIdentityId: string,
    reason = 'Deactivated by organization administrator',
  ): Promise<RegisteredClient> {
    const client = await this.requireOwnedClient(clientId, organizationId);
    if (client.status === 'revoked' && !client.active) {
      return client;
    }

    const deactivatedClient: RegisteredClient = {
      ...client,
      active: false,
      status: 'revoked',
      deactivatedAt: new Date().toISOString(),
      deactivatedByIdentityId: actorIdentityId,
      deactivationReason: reason,
    };
    await this.clients.set(clientId, deactivatedClient);
    logger.info('oidc_client_deactivated', {
      clientId,
      organizationId,
      actorIdentityId,
      reason,
    });
    return deactivatedClient;
  }

  async revokeClient(clientId: string): Promise<void> {
    const client = await this.getNormalizedClient(clientId);
    if (client) {
      client.active = false;
      client.status = 'revoked';
      client.deactivatedAt = new Date().toISOString();
      client.deactivationReason = 'Revoked by system';
      await this.clients.set(clientId, client);
      logger.info('oidc_client_revoked', { clientId });
    }
  }

  private async getNormalizedClient(
    clientId: string,
  ): Promise<RegisteredClient | undefined> {
    const client = await this.clients.get(clientId);
    if (!client) {
      return undefined;
    }

    if (!client.status) {
      client.status = client.active ? 'active' : 'pending_approval';
    }

    if (client.status === 'active' && !client.active) {
      client.active = true;
    }

    if (client.status !== 'active' && client.active) {
      client.active = false;
    }

    return client;
  }

  private isClientActive(client: RegisteredClient): boolean {
    return client.active && (client.status ?? 'active') === 'active';
  }

  private async requireOwnedClient(
    clientId: string,
    organizationId: string,
  ): Promise<RegisteredClient> {
    const client = await this.getNormalizedClient(clientId);
    if (!client || client.organizationId !== organizationId) {
      throw new OIDCError(
        'invalid_client',
        'Client not found for organization',
        404,
      );
    }

    return client;
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
    this.name = 'OIDCError';
  }

  toJSON(): Record<string, unknown> {
    return { error: this.errorCode, error_description: this.message };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const oidcBridge = new OIDCBridge();
