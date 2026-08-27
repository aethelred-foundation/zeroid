import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import {
  WebhookRegistrationSchema,
  WebhookUpdateSchema,
} from '../../services/enterprise/webhook-system';
import {
  CreateAPIKeySchema,
} from '../../services/enterprise/api-gateway';
import {
  oidcBridge,
  OIDCClientRegistrationSchema,
  RegisteredClient,
  type AuthorizationRequest,
  type TokenRequest,
} from '../../services/enterprise/oidc-bridge';
import { buildTrustedOIDCClaims } from '../../services/enterprise/oidc-claims';
import {
  slaMonitor,
  SLADefinitionSchema,
} from '../../services/enterprise/sla-monitor';
import { AuthenticatedRequest } from '../../middleware/auth';
import {
  EnterpriseAuthenticatedRequest,
  requireEnterpriseContext,
} from '../../middleware/enterprise';
import { createRateLimiter } from '../../middleware/rateLimit';
import {
  AddOrganizationMemberSchema,
  CreateOrganizationSchema,
  enterpriseOrganizationService,
  EnterpriseRole,
  UpdateOrganizationGovernanceSchema,
} from '../../services/enterprise/organization-service';
import { policyGovernanceService } from '../../services/enterprise/policy-governance-service';
import {
  issuerTrustRegistryService,
  RecordIssuerKeySchema,
  RegisterIssuerTrustSchema,
} from '../../services/enterprise/issuer-trust-service';
import {
  CreatePolicyDefinitionSchema,
  DeprecatePolicyDefinitionSchema,
  policyRegistryService,
  RevokePolicyDefinitionSchema,
} from '../../services/enterprise/policy-registry-service';
import {
  CreatePolicyExceptionSchema,
  policyExceptionService,
  RevokePolicyExceptionSchema,
} from '../../services/enterprise/policy-exception-service';
import { prisma } from '../../runtime';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'integration-routes' },
  transports: [new transports.Console()],
});

const router = Router();
const enterpriseRouteLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'rl:enterprise:router',
});
router.use(enterpriseRouteLimiter);

// ---------------------------------------------------------------------------
// Public OIDC router — MUST NOT sit behind authMiddleware.
//
// OpenID Connect Discovery §4 and RFC 7517 §5 mandate that the provider
// configuration and JWKS URIs are accessible without bearer tokens.
// The token endpoint is also unauthenticated (the relying party authenticates
// via client_secret / PKCE, not a user JWT).
// ---------------------------------------------------------------------------
export const oidcPublicRouter = Router();
const oidcPublicRouteLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'rl:oidc:router',
});
oidcPublicRouter.use(oidcPublicRouteLimiter);

type PublicOAuthRouteError = Error & {
  statusCode?: number;
  errorCode?: string;
  code?: string;
};

function sendPublicOAuthError(
  res: Response,
  error: PublicOAuthRouteError,
  fallbackCode: string,
): void {
  const isValidationError = error instanceof z.ZodError;
  const hasExplicitStatus =
    Number.isInteger(error.statusCode) &&
    error.statusCode! >= 400 &&
    error.statusCode! < 600;
  const statusCode = isValidationError
    ? 400
    : hasExplicitStatus
      ? error.statusCode!
      : 500;
  const isServerError = statusCode >= 500;
  const protocolCode = isValidationError
    ? 'invalid_request'
    : isServerError
      ? 'server_error'
      : normalizeOAuthErrorCode(error.errorCode ?? error.code ?? fallbackCode);

  res.status(statusCode).json({
    error: protocolCode,
    error_description: isValidationError
      ? formatOAuthValidationError(error)
      : isServerError
        ? 'Internal server error'
        : error.message,
  });
}

function normalizeOAuthErrorCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
}

function formatOAuthValidationError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  return details || 'Malformed OAuth request';
}

function buildOAuthRouteError(
  errorCode: string,
  message: string,
  statusCode: number,
): PublicOAuthRouteError {
  return Object.assign(new Error(message), {
    errorCode,
    statusCode,
  });
}

function decodeBasicClientAuthPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw buildOAuthRouteError(
      'invalid_client',
      'Malformed client authentication',
      401,
    );
  }
}

function parseBasicClientAuth(
  authorizationHeader: string | undefined,
): { clientId: string; clientSecret: string } | null {
  if (!authorizationHeader) return null;
  const [scheme, encoded] = authorizationHeader.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'basic' || !encoded) {
    throw buildOAuthRouteError(
      'invalid_client',
      'Unsupported client authentication method',
      401,
    );
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw buildOAuthRouteError(
      'invalid_client',
      'Malformed client authentication',
      401,
    );
  }

  const separator = decoded.indexOf(':');
  if (separator <= 0) {
    throw buildOAuthRouteError(
      'invalid_client',
      'Malformed client authentication',
      401,
    );
  }

  return {
    clientId: decodeBasicClientAuthPart(decoded.slice(0, separator)),
    clientSecret: decodeBasicClientAuthPart(decoded.slice(separator + 1)),
  };
}

function hasBodyField(body: Record<string, unknown>, field: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(body, field) &&
    body[field] !== undefined
  );
}

function getAliasedBodyField(
  body: Record<string, unknown>,
  primaryField: string,
  alternateField: string,
  fieldLabel: string,
): unknown {
  const hasPrimary = hasBodyField(body, primaryField);
  const hasAlternate = hasBodyField(body, alternateField);
  if (
    hasPrimary &&
    hasAlternate &&
    body[primaryField] !== body[alternateField]
  ) {
    throw buildOAuthRouteError(
      'invalid_request',
      `Conflicting ${fieldLabel} aliases are not allowed`,
      400,
    );
  }

  return hasPrimary ? body[primaryField] : body[alternateField];
}

function validatePublicOAuthBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: () => void) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendPublicOAuthError(res, result.error, 'invalid_request');
      return;
    }

    req.body = result.data;
    next();
  };
}

const RouteIdSchema = z.string().trim().min(1).max(160);
const RouteIdParamSchema = z.object({ id: RouteIdSchema });
const PolicyIdParamSchema = z.object({ policyId: RouteIdSchema });
const ExceptionIdParamSchema = z.object({ exceptionId: RouteIdSchema });
const TrustIdParamSchema = z.object({ trustId: RouteIdSchema });
const IssuerIdentityIdParamSchema = z.object({
  issuerIdentityId: RouteIdSchema,
});
const IssuerKeyHistoryParamSchema = z.object({
  issuerIdentityId: RouteIdSchema,
  keyHistoryId: RouteIdSchema,
});
const OIDCClientIdParamSchema = z.object({ clientId: RouteIdSchema });

const LimitedListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const PeriodQuerySchema = z.object({
  period: z.coerce.number().int().min(1).max(366).optional(),
});

const SinceQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

const WebhookReplaySchema = z
  .object({
    since: z.string().datetime(),
    until: z.string().datetime().optional(),
  })
  .refine(
    ({ since, until }) => !until || Date.parse(until) >= Date.parse(since),
    {
      message: 'until must be at or after since',
      path: ['until'],
    },
  );

const OptionalReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

const OptionalEffectiveFromSchema = z.object({
  effectiveFrom: z.string().datetime().optional(),
});

const OAuthStringSchema = z.string().trim().min(1).max(2048);
const OAuthSecretSchema = z.string().min(1).max(4096);
const OptionalScopeSchema = z.string().trim().min(1).max(2048).optional();

const OAuth2ClientCredentialsTokenBodySchema = z.object({
  grantType: OAuthStringSchema.optional(),
  grant_type: OAuthStringSchema.optional(),
  clientId: OAuthStringSchema.optional(),
  client_id: OAuthStringSchema.optional(),
  clientSecret: OAuthSecretSchema.optional(),
  client_secret: OAuthSecretSchema.optional(),
  scope: OptionalScopeSchema,
});

const OIDCAuthorizationBodySchema = z.object({
  clientId: OAuthStringSchema.optional(),
  client_id: OAuthStringSchema.optional(),
  redirectUri: z.string().url().max(2048).optional(),
  redirect_uri: z.string().url().max(2048).optional(),
  responseType: OAuthStringSchema.optional(),
  response_type: OAuthStringSchema.optional(),
  scope: OAuthStringSchema.optional(),
  state: OAuthStringSchema.optional(),
  nonce: OAuthStringSchema.optional(),
  codeChallenge: OAuthStringSchema.optional(),
  code_challenge: OAuthStringSchema.optional(),
  codeChallengeMethod: z.enum(['S256', 'plain']).optional(),
  code_challenge_method: z.enum(['S256', 'plain']).optional(),
  prompt: OAuthStringSchema.optional(),
  maxAge: z.coerce.number().int().min(0).max(31_536_000).optional(),
  max_age: z.coerce.number().int().min(0).max(31_536_000).optional(),
  acrValues: OAuthStringSchema.optional(),
  acr_values: OAuthStringSchema.optional(),
  claims: z.record(z.unknown()).optional(),
  zeroidCredentialTypes: z.array(z.string().trim().min(1).max(120)).optional(),
  zeroid_credential_types: z
    .array(z.string().trim().min(1).max(120))
    .optional(),
});

const OIDCTokenBodySchema = z.object({
  grantType: OAuthStringSchema.optional(),
  grant_type: OAuthStringSchema.optional(),
  code: OAuthStringSchema.optional(),
  redirectUri: z.string().url().max(2048).optional(),
  redirect_uri: z.string().url().max(2048).optional(),
  clientId: OAuthStringSchema.optional(),
  client_id: OAuthStringSchema.optional(),
  clientSecret: OAuthSecretSchema.optional(),
  client_secret: OAuthSecretSchema.optional(),
  codeVerifier: OAuthStringSchema.optional(),
  code_verifier: OAuthStringSchema.optional(),
  refreshToken: OAuthSecretSchema.optional(),
  refresh_token: OAuthSecretSchema.optional(),
  scope: OptionalScopeSchema,
});

// ---------------------------------------------------------------------------
// Middleware: strip spoofable identity headers at the enterprise edge
//
// Internet clients MUST NOT be able to assert identity via raw headers.
// The only trusted identity source is the JWT verified by authMiddleware.
// This middleware runs on every enterprise route and removes headers that
// internal services might otherwise trust.
// ---------------------------------------------------------------------------
const SPOOFABLE_HEADERS = [
  'x-zeroid-client-id',
  'x-zeroid-subject-id',
  'x-zeroid-identity-id',
  'x-zeroid-did',
  'x-zeroid-role',
  'x-forwarded-user',
  'x-remote-user',
] as const;

router.use((req: Request, _res: Response, next: () => void) => {
  for (const header of SPOOFABLE_HEADERS) {
    if (req.headers[header]) {
      logger.warn('spoofable_header_stripped', {
        header,
        value:
          typeof req.headers[header] === 'string'
            ? (req.headers[header] as string).substring(0, 32)
            : '[array]',
        ip: req.ip,
        path: req.path,
      });
      delete req.headers[header];
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Middleware: validate request targets with Zod schemas
// ---------------------------------------------------------------------------
type ValidationSchemas = {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
};

function isZodSchema(value: unknown): value is z.ZodSchema {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function',
  );
}

function validate(schemaOrSchemas: z.ZodSchema | ValidationSchemas) {
  return (req: Request, res: Response, next: () => void) => {
    const schemas = isZodSchema(schemaOrSchemas)
      ? { body: schemaOrSchemas }
      : schemaOrSchemas;
    const errors: Array<{ target: string; error: z.ZodError }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) req.body = result.data;
      else errors.push({ target: 'body', error: result.error });
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) (req as Request).query = result.data;
      else errors.push({ target: 'query', error: result.error });
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) req.params = result.data;
      else errors.push({ target: 'params', error: result.error });
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.map(({ target, error }) => ({
          target,
          issues: error.flatten(),
        })),
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Helper: extract client ID from request (API key or session)
// ---------------------------------------------------------------------------
function getClientId(req: Request): string {
  const enterpriseReq = req as EnterpriseAuthenticatedRequest;
  const organizationId = enterpriseReq.enterpriseContext?.organizationId;
  if (!organizationId) {
    const error = new Error(
      'Enterprise organization context required',
    ) as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 403;
    error.code = 'ENTERPRISE_CONTEXT_REQUIRED';
    throw error;
  }

  return organizationId;
}

type EnterpriseControlPlaneCapability =
  | 'api_keys'
  | 'oauth_client_credentials'
  | 'usage_analytics';

/**
 * The legacy enterprise API gateway can mint credentials and aggregate usage,
 * but those credentials are not connected to the runtime route-authentication
 * boundary and request metering has no production caller. Keep every mounted
 * surface fail closed until those dependencies are integrated end to end.
 */
function sendEnterpriseControlPlaneUnavailable(
  req: Request,
  res: Response,
  capability: EnterpriseControlPlaneCapability,
): void {
  try {
    // Defense in depth: retain an explicit organization-context check even
    // though these routes are mounted behind enterprise auth middleware.
    getClientId(req);
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    res.status(error.statusCode ?? 403).json({
      error: error.message,
      code: error.code ?? 'ENTERPRISE_CONTEXT_REQUIRED',
    });
    return;
  }

  res.status(503).json({
    error:
      'Enterprise API access is unavailable until runtime credential authentication and durable request metering are integrated',
    code: 'ENTERPRISE_API_CONTROL_PLANE_UNAVAILABLE',
    capability,
    status: 'configuration_required',
  });
}

/**
 * Webhook configuration and delivery evidence are not authoritative until
 * domain mutations are committed to a durable outbox. Keep every mounted
 * webhook surface fail closed so synthetic test deliveries cannot be
 * mistaken for an operational event pipeline.
 */
function sendWebhookEventOutboxUnavailable(
  req: Request,
  res: Response,
): void {
  try {
    // Defense in depth: preserve the tenant boundary even though the route's
    // enterprise middleware has already resolved the caller's organization.
    getClientId(req);
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    res.status(error.statusCode ?? 403).json({
      error: error.message,
      code: error.code ?? 'ENTERPRISE_CONTEXT_REQUIRED',
    });
    return;
  }

  res.status(503).json({
    error:
      'Enterprise webhooks are unavailable until authoritative domain mutations are connected to a durable event outbox',
    code: 'WEBHOOK_EVENT_OUTBOX_UNAVAILABLE',
    status: 'configuration_required',
  });
}

const ENTERPRISE_READ_ROLES: EnterpriseRole[] = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
];
const ENTERPRISE_OPERATOR_ROLES: EnterpriseRole[] = ['operator', 'admin'];
const ENTERPRISE_ADMIN_ROLES: EnterpriseRole[] = ['admin'];
const ENTERPRISE_AUDIT_ROLES: EnterpriseRole[] = [
  'operator',
  'admin',
  'auditor',
  'compliance_officer',
];

function serializeOIDCClient(
  client: RegisteredClient,
): Record<string, unknown> {
  return {
    clientId: client.clientId,
    clientName: client.registration.clientName,
    redirectUris: client.registration.redirectUris,
    postLogoutRedirectUris: client.registration.postLogoutRedirectUris,
    backchannelLogoutUri: client.registration.backchannelLogoutUri,
    backchannelLogoutSessionRequired:
      client.registration.backchannelLogoutSessionRequired,
    grantTypes: client.registration.grantTypes,
    responseTypes: client.registration.responseTypes,
    tokenEndpointAuthMethod: client.registration.tokenEndpointAuthMethod,
    scopes: client.registration.scopes,
    requirePkce: client.registration.requirePkce,
    createdAt: client.createdAt,
    active: client.active,
    status: client.status ?? (client.active ? 'active' : 'pending_approval'),
    organizationId: client.organizationId,
    registeredByIdentityId: client.registeredByIdentityId,
    registeredByRole: client.registeredByRole,
    approvedAt: client.approvedAt,
    approvedByIdentityId: client.approvedByIdentityId,
    deactivatedAt: client.deactivatedAt,
    deactivatedByIdentityId: client.deactivatedByIdentityId,
    deactivationReason: client.deactivationReason,
  };
}

function serializeIssuerTrustRecord(record: {
  id: string;
  organizationId: string;
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName: string | null;
  status: string;
  accreditationScope: string;
  assuranceLevel: string;
  allowedCredentialTypes: string[];
  allowedJurisdictions: string[];
  proposedByIdentityId: string;
  accreditedByIdentityId: string | null;
  suspensionReason: string | null;
  metadata: Record<string, unknown> | null;
  accreditedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    ...record,
    accreditedAt: record.accreditedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function serializeIssuerKeyHistory(record: {
  id: string;
  issuerIdentityId: string;
  issuerDid: string;
  keyVersion: string;
  keyAlgorithm: string;
  verificationMethod: string;
  status: string;
  validFrom: Date;
  validUntil: Date | null;
  rotatedByIdentityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    ...record,
    validFrom: record.validFrom.toISOString(),
    validUntil: record.validUntil?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function buildIssuerTrustGovernanceEvidence(record: {
  id: string;
  organizationId: string;
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName: string | null;
  status: string;
  accreditationScope: string;
  assuranceLevel: string;
  allowedCredentialTypes: string[];
  allowedJurisdictions: string[];
  proposedByIdentityId: string;
  accreditedByIdentityId: string | null;
  suspensionReason: string | null;
  metadata: Record<string, unknown> | null;
  accreditedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    formatVersion: 'zeroid.governance_evidence.v1',
    exportedAt: new Date().toISOString(),
    artifactType: 'issuer_trust_record',
    artifact: serializeIssuerTrustRecord(record),
    issuer: {
      identityId: record.issuerIdentityId,
      did: record.issuerDid,
      displayName: record.issuerDisplayName,
    },
    trustRegime: {
      status: record.status,
      accreditationScope: record.accreditationScope,
      assuranceLevel: record.assuranceLevel,
      allowedCredentialTypes: record.allowedCredentialTypes,
      allowedJurisdictions: record.allowedJurisdictions,
    },
    provenance: {
      proposedByIdentityId: record.proposedByIdentityId,
      accreditedByIdentityId: record.accreditedByIdentityId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      accreditedAt: record.accreditedAt?.toISOString() ?? null,
    },
    lifecycle: {
      status: record.status,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      suspensionReason: record.suspensionReason,
    },
  };
}

function buildIssuerKeyHistoryEvidence(
  record: {
    id: string;
    issuerIdentityId: string;
    issuerDid: string;
    keyVersion: string;
    keyAlgorithm: string;
    verificationMethod: string;
    status: string;
    validFrom: Date;
    validUntil: Date | null;
    rotatedByIdentityId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  },
  history: Array<{
    id: string;
    issuerIdentityId: string;
    issuerDid: string;
    keyVersion: string;
    keyAlgorithm: string;
    verificationMethod: string;
    status: string;
    validFrom: Date;
    validUntil: Date | null;
    rotatedByIdentityId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }>,
): Record<string, unknown> {
  return {
    formatVersion: 'zeroid.governance_evidence.v1',
    exportedAt: new Date().toISOString(),
    artifactType: 'issuer_key_history',
    artifact: serializeIssuerKeyHistory(record),
    issuer: {
      identityId: record.issuerIdentityId,
      did: record.issuerDid,
    },
    keyLineage: {
      current: serializeIssuerKeyHistory(record),
      history: history.map(serializeIssuerKeyHistory),
    },
    rotationProvenance: {
      rotatedByIdentityId: record.rotatedByIdentityId,
      createdAt: record.createdAt.toISOString(),
    },
    lifecycle: {
      status: record.status,
      validFrom: record.validFrom.toISOString(),
      validUntil: record.validUntil?.toISOString() ?? null,
    },
  };
}

function serializePolicyDefinition(record: {
  id: string;
  organizationId: string;
  name: string;
  version: string;
  family: string;
  reference: string;
  description: string;
  status: string;
  approvalMode: string;
  requiredApprovals: number;
  requiredApprovalRoles: string[];
  requiredApprovalClasses: string[];
  requiredApprovalJurisdictions: string[];
  governanceProfileId: string | null;
  governanceProfileLabel: string | null;
  governancePackId: string | null;
  governancePackVersion: string | null;
  governancePackLabel: string | null;
  governanceProfileRationale: string[];
  approvalCount: number;
  approvalTrail: Array<{
    identityId: string;
    role: string;
    approvalClasses: string[];
    matchedApprovalClasses: string[];
    matchedApprovalJurisdictions: string[];
    action: string;
    decidedAt: string;
  }>;
  definition: Record<string, unknown>;
  changeSummary: string | null;
  proposedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  deprecatedAt: Date | null;
  deprecatedByIdentityId: string | null;
  deprecationReason: string | null;
  supersededByPolicyDefinitionId: string | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    ...record,
    effectiveFrom: record.effectiveFrom?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    deprecatedAt: record.deprecatedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function buildApprovalQuorumSnapshot(record: {
  approvalCount: number;
  requiredApprovals: number;
  requiredApprovalRoles: string[];
  requiredApprovalClasses: string[];
  requiredApprovalJurisdictions: string[];
  approvalTrail: Array<{
    role: string;
    matchedApprovalClasses: string[];
    matchedApprovalJurisdictions: string[];
  }>;
}): {
  currentApprovals: number;
  requiredApprovals: number;
  satisfied: boolean;
  rolesSatisfied: string[];
  classesSatisfied: string[];
  jurisdictionsSatisfied: string[];
} {
  const rolesSatisfied = Array.from(
    new Set(record.approvalTrail.map((entry) => entry.role)),
  ).sort();
  const classesSatisfied = Array.from(
    new Set(
      record.approvalTrail.flatMap((entry) => entry.matchedApprovalClasses),
    ),
  ).sort();
  const jurisdictionsSatisfied = Array.from(
    new Set(
      record.approvalTrail.flatMap(
        (entry) => entry.matchedApprovalJurisdictions,
      ),
    ),
  ).sort();
  const requiredRoles = [...new Set(record.requiredApprovalRoles)].sort();
  const requiredClasses = [...new Set(record.requiredApprovalClasses)].sort();
  const requiredJurisdictions = [
    ...new Set(record.requiredApprovalJurisdictions),
  ].sort();

  return {
    currentApprovals: record.approvalCount,
    requiredApprovals: record.requiredApprovals,
    satisfied:
      record.approvalCount >= record.requiredApprovals &&
      requiredRoles.every((role) => rolesSatisfied.includes(role)) &&
      requiredClasses.every((approvalClass) =>
        classesSatisfied.includes(approvalClass),
      ) &&
      requiredJurisdictions.every((jurisdiction) =>
        jurisdictionsSatisfied.includes(jurisdiction),
      ),
    rolesSatisfied,
    classesSatisfied,
    jurisdictionsSatisfied,
  };
}

function buildPolicyGovernanceEvidence(record: {
  id: string;
  organizationId: string;
  name: string;
  version: string;
  family: string;
  reference: string;
  status: string;
  approvalMode: string;
  requiredApprovals: number;
  requiredApprovalRoles: string[];
  requiredApprovalClasses: string[];
  requiredApprovalJurisdictions: string[];
  governanceProfileId: string | null;
  governanceProfileLabel: string | null;
  governancePackId: string | null;
  governancePackVersion: string | null;
  governancePackLabel: string | null;
  governanceProfileRationale: string[];
  approvalCount: number;
  approvalTrail: Array<{
    identityId: string;
    role: string;
    approvalClasses: string[];
    matchedApprovalClasses: string[];
    matchedApprovalJurisdictions: string[];
    action: string;
    decidedAt: string;
  }>;
  proposedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  deprecatedAt: Date | null;
  deprecatedByIdentityId: string | null;
  deprecationReason: string | null;
  supersededByPolicyDefinitionId: string | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  definition: Record<string, unknown>;
  changeSummary: string | null;
  description: string;
}): Record<string, unknown> {
  return {
    formatVersion: 'zeroid.governance_evidence.v1',
    exportedAt: new Date().toISOString(),
    artifactType: 'policy_definition',
    artifact: serializePolicyDefinition(record),
    governanceRegime: {
      family: record.family,
      pack: {
        id: record.governancePackId,
        version: record.governancePackVersion,
        label: record.governancePackLabel,
      },
      profile: {
        id: record.governanceProfileId,
        label: record.governanceProfileLabel,
        rationale: record.governanceProfileRationale,
      },
      approvalMode: record.approvalMode,
      requiredApprovals: record.requiredApprovals,
      requiredApprovalRoles: record.requiredApprovalRoles,
      requiredApprovalClasses: record.requiredApprovalClasses,
      requiredApprovalJurisdictions: record.requiredApprovalJurisdictions,
    },
    approvalProvenance: {
      proposedByIdentityId: record.proposedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId,
      approvalCount: record.approvalCount,
      approvalTrail: record.approvalTrail,
      quorum: buildApprovalQuorumSnapshot(record),
    },
    lifecycle: {
      status: record.status,
      effectiveFrom: record.effectiveFrom?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      deprecatedAt: record.deprecatedAt?.toISOString() ?? null,
      deprecatedByIdentityId: record.deprecatedByIdentityId,
      deprecationReason: record.deprecationReason,
      supersededByPolicyDefinitionId: record.supersededByPolicyDefinitionId,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      revokedByIdentityId: record.revokedByIdentityId,
      revocationReason: record.revocationReason,
    },
  };
}

function serializePolicyException(record: {
  id: string;
  organizationId: string;
  policyDefinitionId: string | null;
  policyName: string;
  policyVersion: string;
  policyReference: string;
  subjectEntityId: string | null;
  scope: string;
  justification: string;
  conditions: Record<string, unknown> | null;
  approvalMode: string;
  requiredApprovals: number;
  requiredApprovalRoles: string[];
  requiredApprovalClasses: string[];
  requiredApprovalJurisdictions: string[];
  governanceProfileId: string | null;
  governanceProfileLabel: string | null;
  governancePackId: string | null;
  governancePackVersion: string | null;
  governancePackLabel: string | null;
  governanceProfileRationale: string[];
  approvalCount: number;
  approvalTrail: Array<{
    identityId: string;
    role: string;
    approvalClasses: string[];
    matchedApprovalClasses: string[];
    matchedApprovalJurisdictions: string[];
    action: string;
    decidedAt: string;
  }>;
  status: string;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    ...record,
    effectiveFrom: record.effectiveFrom?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function buildPolicyExceptionGovernanceEvidence(record: {
  id: string;
  organizationId: string;
  policyDefinitionId: string | null;
  policyName: string;
  policyVersion: string;
  policyReference: string;
  subjectEntityId: string | null;
  scope: string;
  justification: string;
  conditions: Record<string, unknown> | null;
  approvalMode: string;
  requiredApprovals: number;
  requiredApprovalRoles: string[];
  requiredApprovalClasses: string[];
  requiredApprovalJurisdictions: string[];
  governanceProfileId: string | null;
  governanceProfileLabel: string | null;
  governancePackId: string | null;
  governancePackVersion: string | null;
  governancePackLabel: string | null;
  governanceProfileRationale: string[];
  approvalCount: number;
  approvalTrail: Array<{
    identityId: string;
    role: string;
    approvalClasses: string[];
    matchedApprovalClasses: string[];
    matchedApprovalJurisdictions: string[];
    action: string;
    decidedAt: string;
  }>;
  status: string;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  effectiveFrom: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByIdentityId: string | null;
  revocationReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    formatVersion: 'zeroid.governance_evidence.v1',
    exportedAt: new Date().toISOString(),
    artifactType: 'policy_exception',
    artifact: serializePolicyException(record),
    governingPolicy: {
      policyDefinitionId: record.policyDefinitionId,
      policyName: record.policyName,
      policyVersion: record.policyVersion,
      policyReference: record.policyReference,
    },
    governanceRegime: {
      pack: {
        id: record.governancePackId,
        version: record.governancePackVersion,
        label: record.governancePackLabel,
      },
      profile: {
        id: record.governanceProfileId,
        label: record.governanceProfileLabel,
        rationale: record.governanceProfileRationale,
      },
      approvalMode: record.approvalMode,
      requiredApprovals: record.requiredApprovals,
      requiredApprovalRoles: record.requiredApprovalRoles,
      requiredApprovalClasses: record.requiredApprovalClasses,
      requiredApprovalJurisdictions: record.requiredApprovalJurisdictions,
    },
    approvalProvenance: {
      requestedByIdentityId: record.requestedByIdentityId,
      approvedByIdentityId: record.approvedByIdentityId,
      approvalCount: record.approvalCount,
      approvalTrail: record.approvalTrail,
      quorum: buildApprovalQuorumSnapshot(record),
    },
    lifecycle: {
      status: record.status,
      effectiveFrom: record.effectiveFrom?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      revokedByIdentityId: record.revokedByIdentityId,
      revocationReason: record.revocationReason,
    },
  };
}

// ==========================================================================
// ORGANIZATION ROUTES
// ==========================================================================

router.post(
  '/organizations',
  validate({ body: CreateOrganizationSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const identityId = authReq.identity?.id;
      if (!identityId) {
        res.status(401).json({
          error: 'Authenticated identity required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const result = await enterpriseOrganizationService.createOrganization(
        identityId,
        req.body,
      );
      res.status(201).json({
        data: result,
        message: 'Organization created and caller added as admin',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_create_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_ORG_CREATE_ERROR',
      });
    }
  },
);

router.get(
  '/organizations',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const identityId = authReq.identity?.id;
      if (!identityId) {
        res.status(401).json({
          error: 'Authenticated identity required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const organizations =
        await enterpriseOrganizationService.listOrganizations(identityId);
      res.status(200).json({ data: organizations });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_list_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_ORG_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/organizations/context',
  requireEnterpriseContext(ENTERPRISE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const enterpriseReq = req as EnterpriseAuthenticatedRequest;
    res.status(200).json({ data: enterpriseReq.enterpriseContext });
  },
);

router.post(
  '/organizations/:id/members',
  requireEnterpriseContext(
    ENTERPRISE_ADMIN_ROLES,
    (req) => req.params.id as string,
  ),
  validate({ body: AddOrganizationMemberSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const member = await enterpriseOrganizationService.addMember(
        req.params.id as string,
        req.body,
      );
      res
        .status(201)
        .json({ data: member, message: 'Organization member added' });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_member_add_error', {
        error: error.message,
        organizationId: req.params.id,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_MEMBER_ADD_ERROR',
      });
    }
  },
);

router.get(
  '/organizations/:id/members',
  requireEnterpriseContext(
    ENTERPRISE_AUDIT_ROLES,
    (req) => req.params.id as string,
  ),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const members = await enterpriseOrganizationService.listMembers(
        req.params.id as string,
      );
      res.status(200).json({ data: members });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_member_list_error', {
        error: error.message,
        organizationId: req.params.id,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_MEMBER_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/organizations/:id/governance',
  requireEnterpriseContext(
    ENTERPRISE_AUDIT_ROLES,
    (req) => req.params.id as string,
  ),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const governance =
        await enterpriseOrganizationService.getGovernanceSettings(
          req.params.id as string,
        );
      res.status(200).json({ data: governance });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_governance_get_error', {
        error: error.message,
        organizationId: req.params.id,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_GOVERNANCE_GET_ERROR',
      });
    }
  },
);

router.patch(
  '/organizations/:id/governance',
  requireEnterpriseContext(
    ENTERPRISE_ADMIN_ROLES,
    (req) => req.params.id as string,
  ),
  validate({ body: UpdateOrganizationGovernanceSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as EnterpriseAuthenticatedRequest;
      const identityId = authReq.identity?.id;
      if (!identityId) {
        res.status(401).json({
          error: 'Authenticated identity required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const governance =
        await enterpriseOrganizationService.updateGovernanceSettings(
          req.params.id as string,
          identityId,
          req.body,
        );
      res
        .status(200)
        .json({ data: governance, message: 'Organization governance updated' });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('organization_governance_update_error', {
        error: error.message,
        organizationId: req.params.id,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_GOVERNANCE_UPDATE_ERROR',
      });
    }
  },
);

router.get(
  '/organizations/:id/governance/packs',
  requireEnterpriseContext(
    ENTERPRISE_AUDIT_ROLES,
    (req) => req.params.id as string,
  ),
  async (_req: Request, res: Response): Promise<void> => {
    res
      .status(200)
      .json({ data: policyGovernanceService.listGovernancePacks() });
  },
);

// ==========================================================================
// WEBHOOK ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/webhooks — Register webhook
// ---------------------------------------------------------------------------
router.post(
  '/webhooks',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ body: WebhookRegistrationSchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/webhooks — List webhooks
// ---------------------------------------------------------------------------
router.get(
  '/webhooks',
  requireEnterpriseContext(ENTERPRISE_READ_ROLES),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// PATCH /enterprise/webhooks/:id — Update webhook
// ---------------------------------------------------------------------------
router.patch(
  '/webhooks/:id',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ params: RouteIdParamSchema, body: WebhookUpdateSchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// DELETE /enterprise/webhooks/:id — Remove webhook
// ---------------------------------------------------------------------------
router.delete(
  '/webhooks/:id',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ params: RouteIdParamSchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/webhooks/:id/deliveries — Get delivery logs
// ---------------------------------------------------------------------------
router.get(
  '/webhooks/:id/deliveries',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: RouteIdParamSchema, query: LimitedListQuerySchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/webhooks/:id/test — Send synthetic test delivery
// ---------------------------------------------------------------------------
router.post(
  '/webhooks/:id/test',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ params: RouteIdParamSchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/webhooks/:id/replay — Replay events
// ---------------------------------------------------------------------------
router.post(
  '/webhooks/:id/replay',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ params: RouteIdParamSchema, body: WebhookReplaySchema }),
  (req: Request, res: Response): void => {
    sendWebhookEventOutboxUnavailable(req, res);
  },
);

// ==========================================================================
// API KEY ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/api-keys — API-key creation capability gate
// ---------------------------------------------------------------------------
router.post(
  '/api-keys',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ body: CreateAPIKeySchema }),
  (req: Request, res: Response): void => {
    sendEnterpriseControlPlaneUnavailable(req, res, 'api_keys');
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/api-keys — API-key inventory capability gate
// ---------------------------------------------------------------------------
router.get(
  '/api-keys',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  (req: Request, res: Response): void => {
    sendEnterpriseControlPlaneUnavailable(req, res, 'api_keys');
  },
);

// ---------------------------------------------------------------------------
// DELETE /enterprise/api-keys/:id — API-key revocation capability gate
// ---------------------------------------------------------------------------
router.delete(
  '/api-keys/:id',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ params: RouteIdParamSchema, body: OptionalReasonSchema }),
  (req: Request, res: Response): void => {
    sendEnterpriseControlPlaneUnavailable(req, res, 'api_keys');
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/api-keys/:id/quota — API-key quota capability gate
// ---------------------------------------------------------------------------
router.get(
  '/api-keys/:id/quota',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: RouteIdParamSchema }),
  (req: Request, res: Response): void => {
    sendEnterpriseControlPlaneUnavailable(req, res, 'api_keys');
  },
);

// ==========================================================================
// OAUTH2 ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/oauth2/token — OAuth2 client-credentials capability gate
// ---------------------------------------------------------------------------
router.post(
  '/oauth2/token',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validatePublicOAuthBody(OAuth2ClientCredentialsTokenBodySchema),
  (req: Request, res: Response): void => {
    const grantType = req.body.grantType ?? req.body.grant_type;
    if (grantType !== 'client_credentials') {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only client_credentials supported on this endpoint',
      });
      return;
    }

    try {
      getClientId(req);
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 403).json({
        error: 'access_denied',
        error_description: error.message,
      });
      return;
    }

    res.status(503).json({
      error: 'temporarily_unavailable',
      error_description:
        'Enterprise OAuth client credentials are unavailable until runtime token authentication and durable request metering are integrated',
    });
  },
);

// ==========================================================================
// OIDC ROUTES
// ==========================================================================

// ==========================================================================
// ISSUER TRUST REGISTRY ROUTES
// ==========================================================================

router.post(
  '/policies',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ body: CreatePolicyDefinitionSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.createPolicyDraft(
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(201).json({
        data: serializePolicyDefinition(policy),
        message: 'Policy definition created as draft',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_create_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_CREATE_ERROR',
      });
    }
  },
);

router.get(
  '/policies',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policies = await policyRegistryService.listPolicies(
        organizationId,
        {
          name: typeof req.query.name === 'string' ? req.query.name : undefined,
          status:
            typeof req.query.status === 'string'
              ? (req.query.status as any)
              : undefined,
        },
      );
      res.status(200).json({ data: policies.map(serializePolicyDefinition) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_list_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/policies/:policyId/evidence',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: PolicyIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.getPolicyById(
        req.params.policyId as string,
        organizationId,
      );
      res.status(200).json({ data: buildPolicyGovernanceEvidence(policy) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_evidence_error', {
        error: error.message,
        policyId: req.params.policyId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EVIDENCE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/:policyId/submit',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: PolicyIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.submitPolicyForReview(
        req.params.policyId as string,
        organizationId,
        actorIdentityId,
      );
      res.status(200).json({
        data: serializePolicyDefinition(policy),
        message: 'Policy submitted for review',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_submit_error', {
        error: error.message,
        policyId: req.params.policyId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_SUBMIT_ERROR',
      });
    }
  },
);

router.post(
  '/policies/:policyId/approve',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: PolicyIdParamSchema, body: OptionalEffectiveFromSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const effectiveFrom =
        typeof req.body?.effectiveFrom === 'string'
          ? req.body.effectiveFrom
          : undefined;
      const policy = await policyRegistryService.approvePolicy(
        req.params.policyId as string,
        organizationId,
        actorIdentityId,
        effectiveFrom,
      );
      res.status(200).json({
        data: serializePolicyDefinition(policy),
        message:
          policy.status === 'approved'
            ? 'Policy approved'
            : 'Policy approval recorded; additional approvals required',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_approve_error', {
        error: error.message,
        policyId: req.params.policyId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_APPROVE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/:policyId/deprecate',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({
    params: PolicyIdParamSchema,
    body: DeprecatePolicyDefinitionSchema,
  }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.deprecatePolicy(
        req.params.policyId as string,
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(200).json({
        data: serializePolicyDefinition(policy),
        message: 'Policy deprecated',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_deprecate_error', {
        error: error.message,
        policyId: req.params.policyId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_DEPRECATE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/:policyId/revoke',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: PolicyIdParamSchema, body: RevokePolicyDefinitionSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.revokePolicy(
        req.params.policyId as string,
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(200).json({
        data: serializePolicyDefinition(policy),
        message: 'Policy revoked',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_revoke_error', {
        error: error.message,
        policyId: req.params.policyId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_REVOKE_ERROR',
      });
    }
  },
);

router.get(
  '/policies/:policyName/effective',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const policy = await policyRegistryService.getEffectivePolicy(
        organizationId,
        req.params.policyName as string,
      );
      if (!policy) {
        res.status(404).json({
          error: 'Effective policy not found',
          code: 'POLICY_NOT_FOUND',
        });
        return;
      }

      res.status(200).json({ data: serializePolicyDefinition(policy) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_effective_error', {
        error: error.message,
        policyName: req.params.policyName,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EFFECTIVE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/exceptions',
  requireEnterpriseContext(['admin', 'compliance_officer']),
  validate({ body: CreatePolicyExceptionSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise policy reviewer required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const exception = await policyExceptionService.createExceptionRequest(
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(201).json({
        data: serializePolicyException(exception),
        message: 'Policy exception request created',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_create_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_CREATE_ERROR',
      });
    }
  },
);

router.get(
  '/policies/exceptions',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const exceptions = await policyExceptionService.listExceptions(
        organizationId,
        {
          policyName:
            typeof req.query.policyName === 'string'
              ? req.query.policyName
              : undefined,
          status:
            typeof req.query.status === 'string'
              ? (req.query.status as any)
              : undefined,
          subjectEntityId:
            typeof req.query.subjectEntityId === 'string'
              ? req.query.subjectEntityId
              : undefined,
        },
      );
      res.status(200).json({ data: exceptions.map(serializePolicyException) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_list_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/policies/exceptions/:exceptionId/evidence',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: ExceptionIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const exception = await policyExceptionService.getExceptionById(
        req.params.exceptionId as string,
        organizationId,
      );
      res
        .status(200)
        .json({ data: buildPolicyExceptionGovernanceEvidence(exception) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_evidence_error', {
        error: error.message,
        exceptionId: req.params.exceptionId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_EVIDENCE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/exceptions/:exceptionId/approve',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({
    params: ExceptionIdParamSchema,
    body: OptionalEffectiveFromSchema,
  }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const effectiveFrom =
        typeof req.body?.effectiveFrom === 'string'
          ? req.body.effectiveFrom
          : undefined;
      const exception = await policyExceptionService.approveException(
        req.params.exceptionId as string,
        organizationId,
        actorIdentityId,
        effectiveFrom,
      );
      res.status(200).json({
        data: serializePolicyException(exception),
        message:
          exception.status === 'approved'
            ? 'Policy exception approved'
            : 'Policy exception approval recorded; additional approvals required',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_approve_error', {
        error: error.message,
        exceptionId: req.params.exceptionId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_APPROVE_ERROR',
      });
    }
  },
);

router.post(
  '/policies/exceptions/:exceptionId/reject',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: ExceptionIdParamSchema, body: OptionalReasonSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const reason =
        typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const exception = await policyExceptionService.rejectException(
        req.params.exceptionId as string,
        organizationId,
        actorIdentityId,
        reason,
      );
      res.status(200).json({
        data: serializePolicyException(exception),
        message: 'Policy exception rejected',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_reject_error', {
        error: error.message,
        exceptionId: req.params.exceptionId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_REJECT_ERROR',
      });
    }
  },
);

router.post(
  '/policies/exceptions/:exceptionId/revoke',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({
    params: ExceptionIdParamSchema,
    body: RevokePolicyExceptionSchema,
  }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const exception = await policyExceptionService.revokeException(
        req.params.exceptionId as string,
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(200).json({
        data: serializePolicyException(exception),
        message: 'Policy exception revoked',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('policy_exception_revoke_error', {
        error: error.message,
        exceptionId: req.params.exceptionId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'POLICY_EXCEPTION_REVOKE_ERROR',
      });
    }
  },
);

router.post(
  '/trust/issuers',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ body: RegisterIssuerTrustSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const record = await issuerTrustRegistryService.registerIssuerTrust(
        organizationId,
        actorIdentityId,
        req.body,
      );
      res.status(201).json({
        data: serializeIssuerTrustRecord(record),
        message: 'Issuer trust record created and pending review',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_trust_register_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_TRUST_REGISTER_ERROR',
      });
    }
  },
);

router.get(
  '/trust/issuers',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const status =
        typeof req.query.status === 'string' ? req.query.status : undefined;
      const records = await issuerTrustRegistryService.listIssuerTrustRecords(
        organizationId,
        status as any,
      );
      res.status(200).json({ data: records.map(serializeIssuerTrustRecord) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_trust_list_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_TRUST_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/trust/issuers/:trustId/evidence',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: TrustIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const record = await issuerTrustRegistryService.getIssuerTrustRecordById(
        req.params.trustId as string,
        organizationId,
      );
      res
        .status(200)
        .json({ data: buildIssuerTrustGovernanceEvidence(record) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_trust_evidence_error', {
        error: error.message,
        trustId: req.params.trustId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_TRUST_EVIDENCE_ERROR',
      });
    }
  },
);

router.post(
  '/trust/issuers/:trustId/approve',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: TrustIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const record = await issuerTrustRegistryService.accreditIssuer(
        req.params.trustId as string,
        organizationId,
        actorIdentityId,
      );
      res.status(200).json({
        data: serializeIssuerTrustRecord(record),
        message: 'Issuer accredited',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_trust_approve_error', {
        error: error.message,
        trustId: req.params.trustId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_TRUST_APPROVE_ERROR',
      });
    }
  },
);

router.post(
  '/trust/issuers/:trustId/suspend',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: TrustIdParamSchema, body: OptionalReasonSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.length > 0
          ? req.body.reason
          : 'Suspended by enterprise administrator';
      const record = await issuerTrustRegistryService.suspendIssuer(
        req.params.trustId as string,
        organizationId,
        actorIdentityId,
        reason,
      );
      res.status(200).json({
        data: serializeIssuerTrustRecord(record),
        message: 'Issuer trust suspended',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_trust_suspend_error', {
        error: error.message,
        trustId: req.params.trustId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_TRUST_SUSPEND_ERROR',
      });
    }
  },
);

router.post(
  '/trust/issuers/:issuerIdentityId/keys',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({
    params: IssuerIdentityIdParamSchema,
    body: RecordIssuerKeySchema,
  }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const record = await issuerTrustRegistryService.recordIssuerKeyVersion(
        organizationId,
        req.params.issuerIdentityId as string,
        actorIdentityId,
        req.body,
      );
      res.status(201).json({
        data: serializeIssuerKeyHistory(record),
        message: 'Issuer key version recorded',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_key_record_error', {
        error: error.message,
        issuerIdentityId: req.params.issuerIdentityId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_KEY_RECORD_ERROR',
      });
    }
  },
);

router.get(
  '/trust/issuers/:issuerIdentityId/keys',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: IssuerIdentityIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const records = await issuerTrustRegistryService.listIssuerKeyHistory(
        organizationId,
        req.params.issuerIdentityId as string,
      );
      res.status(200).json({ data: records.map(serializeIssuerKeyHistory) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_key_list_error', {
        error: error.message,
        issuerIdentityId: req.params.issuerIdentityId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_KEY_LIST_ERROR',
      });
    }
  },
);

router.get(
  '/trust/issuers/:issuerIdentityId/keys/:keyHistoryId/evidence',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ params: IssuerKeyHistoryParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const issuerIdentityId = req.params.issuerIdentityId as string;
      const keyHistoryId = req.params.keyHistoryId as string;
      const [record, history] = await Promise.all([
        issuerTrustRegistryService.getIssuerKeyHistoryRecord(
          organizationId,
          issuerIdentityId,
          keyHistoryId,
        ),
        issuerTrustRegistryService.listIssuerKeyHistory(
          organizationId,
          issuerIdentityId,
        ),
      ]);
      res
        .status(200)
        .json({ data: buildIssuerKeyHistoryEvidence(record, history) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('issuer_key_evidence_error', {
        error: error.message,
        issuerIdentityId: req.params.issuerIdentityId,
        keyHistoryId: req.params.keyHistoryId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'ISSUER_KEY_EVIDENCE_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/.well-known/openid-configuration  [PUBLIC]
// ---------------------------------------------------------------------------
oidcPublicRouter.get(
  '/oidc/.well-known/openid-configuration',
  (_req: Request, res: Response): void => {
    res.status(200).json(oidcBridge.getDiscoveryDocument());
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/.well-known/jwks.json  [PUBLIC]
// ---------------------------------------------------------------------------
oidcPublicRouter.get(
  '/oidc/.well-known/jwks.json',
  (_req: Request, res: Response): void => {
    try {
      res.status(200).json(oidcBridge.getJWKS());
    } catch (err) {
      const error = err as Error & { statusCode?: number; errorCode?: string };
      logger.error('oidc_jwks_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.errorCode ?? 'OIDC_JWKS_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/register — Dynamic client registration
// ---------------------------------------------------------------------------
router.post(
  '/oidc/register',
  requireEnterpriseContext(ENTERPRISE_OPERATOR_ROLES),
  validate({ body: OIDCClientRegistrationSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const identityId = enterpriseReq.identity?.id;
      const enterpriseContext = enterpriseReq.enterpriseContext;
      if (!identityId || !enterpriseContext) {
        res.status(401).json({
          error: 'Authenticated enterprise operator required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const result = await oidcBridge.registerClient(req.body, {
        organizationId: enterpriseContext.organizationId,
        registeredByIdentityId: identityId,
        registeredByRole: enterpriseContext.role,
      });
      const message = result.approvalRequired
        ? 'OIDC client registered and pending admin approval'
        : 'OIDC client registered and activated';
      res.status(201).json({ data: result, message });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('oidc_register_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'OIDC_REGISTER_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/clients — List organization-owned OIDC clients
// ---------------------------------------------------------------------------
router.get(
  '/oidc/clients',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      if (!organizationId) {
        res.status(401).json({
          error: 'Authenticated enterprise context required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const clients =
        await oidcBridge.listClientsForOrganization(organizationId);
      res.status(200).json({ data: clients.map(serializeOIDCClient) });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('oidc_client_list_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'OIDC_CLIENT_LIST_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/clients/:clientId/approve — Activate pending OIDC client
// ---------------------------------------------------------------------------
router.post(
  '/oidc/clients/:clientId/approve',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: OIDCClientIdParamSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const approverIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !approverIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const client = await oidcBridge.approveClient(
        req.params.clientId as string,
        organizationId,
        approverIdentityId,
      );
      res.status(200).json({
        data: serializeOIDCClient(client),
        message: 'OIDC client approved and activated',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('oidc_client_approve_error', {
        error: error.message,
        clientId: req.params.clientId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'OIDC_CLIENT_APPROVE_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/clients/:clientId/deactivate — Deactivate OIDC client
// ---------------------------------------------------------------------------
router.post(
  '/oidc/clients/:clientId/deactivate',
  requireEnterpriseContext(ENTERPRISE_ADMIN_ROLES),
  validate({ params: OIDCClientIdParamSchema, body: OptionalReasonSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enterpriseReq = req as EnterpriseAuthenticatedRequest;
      const organizationId = enterpriseReq.enterpriseContext?.organizationId;
      const actorIdentityId = enterpriseReq.identity?.id;
      if (!organizationId || !actorIdentityId) {
        res.status(401).json({
          error: 'Authenticated enterprise admin required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.length > 0
          ? req.body.reason
          : 'Deactivated by organization administrator';
      const client = await oidcBridge.deactivateClient(
        req.params.clientId as string,
        organizationId,
        actorIdentityId,
        reason,
      );
      res.status(200).json({
        data: serializeOIDCClient(client),
        message: 'OIDC client deactivated',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('oidc_client_deactivate_error', {
        error: error.message,
        clientId: req.params.clientId,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'OIDC_CLIENT_DEACTIVATE_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/authorize — OIDC authorization
// ---------------------------------------------------------------------------
// NOTE: This route MUST be mounted behind authMiddleware in index.ts.
// The authenticated identity is sourced from the JWT — never from raw headers.
router.post(
  '/oidc/authorize',
  validatePublicOAuthBody(OIDCAuthorizationBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const subjectId = authReq.identity?.id;
      if (!subjectId || authReq.identity?.status !== 'ACTIVE') {
        // authMiddleware already validates the JWT and identity status,
        // so this is a defence-in-depth check.
        res.status(401).json({
          error: 'Subject not authenticated',
          code: 'UNAUTHENTICATED',
        });
        return;
      }

      // Spoofable headers are already stripped by the router-level middleware.

      const subject = await prisma.identity.findUnique({
        where: { id: subjectId },
        select: {
          status: true,
          teeAttestationId: true,
          updatedAt: true,
        },
      });

      if (!subject || subject.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'Subject not found or inactive',
          code: 'OIDC_SUBJECT_INVALID',
        });
        return;
      }

      const subjectClaims = await buildTrustedOIDCClaims(subjectId, subject);
      const requestBody =
        req.body && typeof req.body === 'object'
          ? (req.body as Record<string, unknown>)
          : {};
      const maxAgeRaw = requestBody.max_age ?? requestBody.maxAge;
      const maxAge =
        typeof maxAgeRaw === 'string' && maxAgeRaw.trim().length > 0
          ? Number(maxAgeRaw)
          : maxAgeRaw;
      const authorizationRequest = {
        clientId: requestBody.client_id ?? requestBody.clientId,
        redirectUri: requestBody.redirect_uri ?? requestBody.redirectUri,
        responseType: requestBody.response_type ?? requestBody.responseType,
        scope: requestBody.scope,
        state: requestBody.state,
        nonce: requestBody.nonce,
        codeChallenge: requestBody.code_challenge ?? requestBody.codeChallenge,
        codeChallengeMethod:
          requestBody.code_challenge_method ?? requestBody.codeChallengeMethod,
        prompt: requestBody.prompt,
        maxAge,
        acrValues: requestBody.acr_values ?? requestBody.acrValues,
        claims: requestBody.claims,
        zeroidCredentialTypes:
          requestBody.zeroid_credential_types ??
          requestBody.zeroidCredentialTypes,
      } as AuthorizationRequest;
      const result = await oidcBridge.authorize(
        authorizationRequest,
        subjectId,
        subjectClaims,
        {
          platformSessionId: authReq.sessionId,
          platformAuthTime: authReq.sessionAuthTime,
        },
      );
      res.redirect(302, result.redirectUrl);
    } catch (err) {
      const error = err as Error & { statusCode?: number; errorCode?: string };
      logger.error('oidc_authorize_error', { error: error.message });
      sendPublicOAuthError(res, error, 'oidc_auth_error');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/token — OIDC token exchange  [PUBLIC]
//
// The token endpoint is unauthenticated per OAuth 2.0 / OIDC spec — the
// relying party authenticates via client_secret or PKCE, not a user JWT.
// ---------------------------------------------------------------------------
oidcPublicRouter.post(
  '/oidc/token',
  validatePublicOAuthBody(OIDCTokenBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const basicAuth = parseBasicClientAuth(req.headers.authorization);
      const requestBody =
        req.body && typeof req.body === 'object'
          ? (req.body as Record<string, unknown>)
          : {};
      const bodyClientId = getAliasedBodyField(
        requestBody,
        'client_id',
        'clientId',
        'client_id',
      );
      const bodyClientSecret = getAliasedBodyField(
        requestBody,
        'client_secret',
        'clientSecret',
        'client_secret',
      );
      if (
        basicAuth &&
        (hasBodyField(requestBody, 'client_id') ||
          hasBodyField(requestBody, 'clientId') ||
          hasBodyField(requestBody, 'client_secret') ||
          hasBodyField(requestBody, 'clientSecret'))
      ) {
        throw buildOAuthRouteError(
          'invalid_request',
          'Client credentials must use exactly one authentication method',
          400,
        );
      }
      const clientAuthMethod:
        | 'client_secret_basic'
        | 'client_secret_post'
        | 'none' = basicAuth
        ? 'client_secret_basic'
        : bodyClientSecret
          ? 'client_secret_post'
          : 'none';

      // Map snake_case from standard OIDC to camelCase
      const tokenRequest = {
        grantType: requestBody.grant_type ?? requestBody.grantType,
        code: requestBody.code,
        redirectUri: requestBody.redirect_uri ?? requestBody.redirectUri,
        clientId: basicAuth?.clientId ?? bodyClientId,
        clientSecret: basicAuth?.clientSecret ?? bodyClientSecret,
        clientAuthMethod,
        codeVerifier: requestBody.code_verifier ?? requestBody.codeVerifier,
        refreshToken: requestBody.refresh_token ?? requestBody.refreshToken,
        scope: requestBody.scope,
      } as TokenRequest;

      const result = await oidcBridge.exchangeToken(tokenRequest);
      res.status(200).json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number; errorCode?: string };
      logger.error('oidc_token_error', { error: error.message });
      sendPublicOAuthError(res, error, 'oidc_token_error');
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/userinfo — UserInfo endpoint  [PUBLIC]
//
// Per OpenID Connect Core §5.3, the UserInfo endpoint authenticates the
// caller using the OIDC-issued access token (Bearer), NOT the platform JWT.
// A standards-compliant relying party will present only the OIDC token.
// ---------------------------------------------------------------------------
oidcPublicRouter.get(
  '/oidc/userinfo',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'invalid_token',
          error_description: 'Bearer token required',
        });
        return;
      }
      const token = authHeader.slice(7);
      const userInfo = await oidcBridge.getUserInfo(token);
      res.status(200).json(userInfo);
    } catch (err) {
      const error = err as Error & { statusCode?: number; errorCode?: string };
      logger.error('oidc_userinfo_error', { error: error.message });
      sendPublicOAuthError(res, error, 'userinfo_error');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/saml — SAML bridge  [DISABLED]
//
// The SAML bridge is prototype-grade: it returns unsigned, unvalidated
// assertions without proper trust controls. Shipping it as a production
// federation surface would create a false sense of security.
// Disabled until a full SAML SP/IdP implementation is in place.
// ---------------------------------------------------------------------------
router.post('/oidc/saml', (_req: Request, res: Response): void => {
  res.status(501).json({
    error:
      'SAML bridge is disabled for launch — unsigned assertions are not production-safe',
    code: 'SAML_NOT_IMPLEMENTED',
  });
});

// ==========================================================================
// SLA ROUTES
// ==========================================================================

const sendSLATelemetryUnavailable = (res: Response): void => {
  res.status(503).json({
    error:
      'SLA evidence is unavailable until an instrumented durable telemetry adapter is deployed',
    code: 'SLA_AUTHORITATIVE_TELEMETRY_UNAVAILABLE',
  });
};

// ---------------------------------------------------------------------------
// POST /enterprise/sla/register — Register SLA definition
// ---------------------------------------------------------------------------
router.post(
  '/sla/register',
  requireEnterpriseContext(['admin', 'compliance_officer']),
  validate({ body: SLADefinitionSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clientId = getClientId(req);
      slaMonitor.registerSLA({
        ...req.body,
        clientId,
      });
      res.status(201).json({
        message: 'SLA configuration registered',
        data: {
          clientId,
          configurationStatus: 'configured',
          reportingStatus:
            'unavailable_until_instrumented_durable_telemetry_adapter_is_deployed',
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('sla_register_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'SLA_REGISTER_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/sla/report — SLA report
// ---------------------------------------------------------------------------
router.get(
  '/sla/report',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ query: PeriodQuerySchema }),
  (_req: Request, res: Response): void => {
    sendSLATelemetryUnavailable(res);
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/sla/violations — Get SLA violations
// ---------------------------------------------------------------------------
router.get(
  '/sla/violations',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ query: SinceQuerySchema }),
  (_req: Request, res: Response): void => {
    sendSLATelemetryUnavailable(res);
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/sla/alerts — Get SLA alerts
// ---------------------------------------------------------------------------
router.get(
  '/sla/alerts',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ query: LimitedListQuerySchema }),
  (_req: Request, res: Response): void => {
    sendSLATelemetryUnavailable(res);
  },
);

// ==========================================================================
// USAGE / ANALYTICS
// ==========================================================================

// ---------------------------------------------------------------------------
// GET /enterprise/usage — Durable usage-metrics capability gate
// ---------------------------------------------------------------------------
router.get(
  '/usage',
  requireEnterpriseContext(ENTERPRISE_AUDIT_ROLES),
  validate({ query: PeriodQuerySchema }),
  (req: Request, res: Response): void => {
    sendEnterpriseControlPlaneUnavailable(req, res, 'usage_analytics');
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/sdk/metadata — Published SDK-contract capability gate
// ---------------------------------------------------------------------------
router.get(
  '/sdk/metadata',
  requireEnterpriseContext(ENTERPRISE_READ_ROLES),
  (req: Request, res: Response): void => {
    try {
      getClientId(req);
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 403).json({
        error: error.message,
        code: error.code ?? 'ENTERPRISE_CONTEXT_REQUIRED',
      });
      return;
    }

    res.status(501).json({
      error:
        'Enterprise SDK metadata is unavailable because no production API contract is published',
      code: 'ENTERPRISE_SDK_METADATA_NOT_IMPLEMENTED',
      status: 'not_implemented',
    });
  },
);

export default router;
