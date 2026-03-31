import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { webhookSystem, WebhookRegistrationSchema, WebhookUpdateSchema } from '../../services/enterprise/webhook-system';
import { apiGateway, CreateAPIKeySchema } from '../../services/enterprise/api-gateway';
import { oidcBridge, OIDCClientRegistrationSchema } from '../../services/enterprise/oidc-bridge';
import { slaMonitor, SLADefinitionSchema } from '../../services/enterprise/sla-monitor';
import { AuthenticatedRequest } from '../../middleware/auth';

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

// ---------------------------------------------------------------------------
// Public OIDC router — MUST NOT sit behind authMiddleware.
//
// OpenID Connect Discovery §4 and RFC 7517 §5 mandate that the provider
// configuration and JWKS URIs are accessible without bearer tokens.
// The token endpoint is also unauthenticated (the relying party authenticates
// via client_secret / PKCE, not a user JWT).
// ---------------------------------------------------------------------------
export const oidcPublicRouter = Router();

// ---------------------------------------------------------------------------
// Middleware: strip spoofable identity headers at the enterprise edge
//
// Internet clients MUST NOT be able to assert identity via raw headers.
// The only trusted identity source is the JWT verified by authMiddleware.
// This middleware runs on every enterprise route and removes headers that
// internal services might otherwise trust.
// ---------------------------------------------------------------------------
const SPOOFABLE_HEADERS = [
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
        value: typeof req.headers[header] === 'string'
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
// Middleware: validate request body with Zod schema
// ---------------------------------------------------------------------------
function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: () => void) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Helper: extract client ID from request (API key or session)
// ---------------------------------------------------------------------------
function getClientId(req: Request): string {
  return (req.headers['x-zeroid-client-id'] as string) ?? (req as any).clientId ?? 'anonymous';
}

function buildTrustedOIDCClaims(subject: {
  displayName: string | null;
  metadata: unknown;
  teeAttested: boolean;
  teeAttestationId: string | null;
  governmentVerified: boolean;
  updatedAt: Date;
}): Record<string, unknown> {
  const metadata = (subject.metadata && typeof subject.metadata === 'object')
    ? subject.metadata as Record<string, unknown>
    : {};

  const claims: Record<string, unknown> = {
    updated_at: Math.floor(subject.updatedAt.getTime() / 1000),
  };

  if (subject.displayName) {
    claims.name = subject.displayName;
  }

  for (const field of ['given_name', 'family_name', 'middle_name', 'preferred_username', 'picture', 'email', 'address', 'phone_number'] as const) {
    const value = metadata[field];
    if (typeof value === 'string' && value.length > 0) {
      claims[field] = value;
    }
  }

  for (const field of ['email_verified', 'phone_number_verified', 'age_over_18', 'age_over_21'] as const) {
    const value = metadata[field];
    if (typeof value === 'boolean') {
      claims[field] = value;
    }
  }

  if (subject.governmentVerified) {
    claims.kyc_level = 'government_verified';
    claims.kyc_provider = 'zeroid_government_registry';
  }

  if (subject.teeAttested) {
    claims.verification_level = subject.governmentVerified ? 'government_and_tee' : 'tee_attested';
  } else if (subject.governmentVerified) {
    claims.verification_level = 'government_verified';
  }

  if (subject.teeAttestationId) {
    claims.tee_attestation_id = subject.teeAttestationId;
  }

  return claims;
}

// ==========================================================================
// WEBHOOK ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/webhooks — Register webhook
// ---------------------------------------------------------------------------
router.post('/webhooks', validate(WebhookRegistrationSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const webhook = webhookSystem.register(clientId, req.body);
    res.status(201).json({
      data: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secret: webhook.secret,
        active: webhook.active,
        createdAt: webhook.createdAt,
      },
      message: 'Webhook registered successfully',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('webhook_register_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'WEBHOOK_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/webhooks — List webhooks
// ---------------------------------------------------------------------------
router.get('/webhooks', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const webhooks = webhookSystem.list(clientId);
    res.status(200).json({
      data: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        health: w.health,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    });
  } catch (err) {
    const error = err as Error;
    logger.error('webhook_list_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'WEBHOOK_LIST_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /enterprise/webhooks/:id — Update webhook
// ---------------------------------------------------------------------------
router.patch('/webhooks/:id', validate(WebhookUpdateSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const webhook = webhookSystem.update(req.params.id as string, clientId, req.body);
    res.status(200).json({ data: webhook, message: 'Webhook updated' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('webhook_update_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'WEBHOOK_UPDATE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /enterprise/webhooks/:id — Remove webhook
// ---------------------------------------------------------------------------
router.delete('/webhooks/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    webhookSystem.remove(req.params.id as string, clientId);
    res.status(204).send();
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('webhook_delete_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'WEBHOOK_DELETE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/webhooks/:id/deliveries — Get delivery logs
// ---------------------------------------------------------------------------
router.get('/webhooks/:id/deliveries', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const deliveries = webhookSystem.getDeliveries(req.params.id as string, limit);
    res.status(200).json({ data: deliveries });
  } catch (err) {
    const error = err as Error;
    logger.error('webhook_deliveries_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'DELIVERY_LOG_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/webhooks/:id/replay — Replay events
// ---------------------------------------------------------------------------
router.post('/webhooks/:id/replay', async (req: Request, res: Response): Promise<void> => {
  try {
    const { since, until } = req.body;
    if (!since) {
      res.status(400).json({ error: '"since" timestamp is required', code: 'VALIDATION_ERROR' });
      return;
    }
    const result = await webhookSystem.replayEvents(req.params.id as string, since, until);
    res.status(200).json({ data: result, message: 'Events replayed' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('webhook_replay_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'REPLAY_ERROR' });
  }
});

// ==========================================================================
// API KEY ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/api-keys — Generate API key
// ---------------------------------------------------------------------------
router.post('/api-keys', validate(CreateAPIKeySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const result = apiGateway.createAPIKey(clientId, req.body);
    res.status(201).json({
      data: result,
      message: 'API key created. Store the key securely — it will not be shown again.',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('api_key_create_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'API_KEY_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/api-keys — List API keys
// ---------------------------------------------------------------------------
router.get('/api-keys', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const keys = apiGateway.listAPIKeys(clientId);
    res.status(200).json({ data: keys });
  } catch (err) {
    const error = err as Error;
    logger.error('api_key_list_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'API_KEY_LIST_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /enterprise/api-keys/:id — Revoke API key
// ---------------------------------------------------------------------------
router.delete('/api-keys/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const reason = (req.body?.reason as string) ?? 'Revoked by client';
    apiGateway.revokeAPIKey(req.params.id as string, clientId, reason);
    res.status(200).json({ message: 'API key revoked' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('api_key_revoke_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'API_KEY_REVOKE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/api-keys/:id/quota — Get quota status
// ---------------------------------------------------------------------------
router.get('/api-keys/:id/quota', async (req: Request, res: Response): Promise<void> => {
  try {
    const quota = apiGateway.getQuotaStatus(req.params.id as string);
    res.status(200).json({ data: quota });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('api_key_quota_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'QUOTA_ERROR' });
  }
});

// ==========================================================================
// OAUTH2 ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/oauth2/token — OAuth2 token exchange
// ---------------------------------------------------------------------------
router.post('/oauth2/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const grantType = req.body.grantType ?? req.body.grant_type;

    if (grantType === 'client_credentials') {
      const token = apiGateway.issueOAuth2Token({
        grantType: 'client_credentials',
        clientId: req.body.clientId ?? req.body.client_id,
        clientSecret: req.body.clientSecret ?? req.body.client_secret,
        scope: req.body.scope,
      });
      res.status(200).json(token);
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials supported on this endpoint' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('oauth2_token_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'OAUTH2_ERROR' });
  }
});

// ==========================================================================
// OIDC ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/.well-known/openid-configuration  [PUBLIC]
// ---------------------------------------------------------------------------
oidcPublicRouter.get('/oidc/.well-known/openid-configuration', (_req: Request, res: Response): void => {
  res.status(200).json(oidcBridge.getDiscoveryDocument());
});

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/.well-known/jwks.json  [PUBLIC]
// ---------------------------------------------------------------------------
oidcPublicRouter.get('/oidc/.well-known/jwks.json', (_req: Request, res: Response): void => {
  try {
    res.status(200).json(oidcBridge.getJWKS());
  } catch (err) {
    const error = err as Error & { statusCode?: number; errorCode?: string };
    logger.error('oidc_jwks_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.errorCode ?? 'OIDC_JWKS_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/register — Dynamic client registration
// ---------------------------------------------------------------------------
router.post('/oidc/register', validate(OIDCClientRegistrationSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await oidcBridge.registerClient(req.body);
    res.status(201).json({ data: result, message: 'OIDC client registered' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('oidc_register_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'OIDC_REGISTER_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/authorize — OIDC authorization
// ---------------------------------------------------------------------------
// NOTE: This route MUST be mounted behind authMiddleware in index.ts.
// The authenticated identity is sourced from the JWT — never from raw headers.
router.post('/oidc/authorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const subjectId = authReq.identity?.id;
    if (!subjectId || authReq.identity?.status !== 'ACTIVE') {
      // authMiddleware already validates the JWT and identity status,
      // so this is a defence-in-depth check.
      res.status(401).json({ error: 'Subject not authenticated', code: 'UNAUTHENTICATED' });
      return;
    }

    // Spoofable headers are already stripped by the router-level middleware.

    const { prisma } = await import('../../index');
    const subject = await prisma.identity.findUnique({
      where: { id: subjectId },
      select: {
        displayName: true,
        metadata: true,
        status: true,
        teeAttested: true,
        teeAttestationId: true,
        governmentVerified: true,
        updatedAt: true,
      },
    });

    if (!subject || subject.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Subject not found or inactive', code: 'OIDC_SUBJECT_INVALID' });
      return;
    }

    const subjectClaims = buildTrustedOIDCClaims(subject);
    const result = await oidcBridge.authorize(req.body, subjectId, subjectClaims);
    res.status(200).json({ data: result });
  } catch (err) {
    const error = err as Error & { statusCode?: number; errorCode?: string };
    logger.error('oidc_authorize_error', { error: error.message });
    const errorCode = (error as any).errorCode ?? 'OIDC_AUTH_ERROR';
    res.status(error.statusCode ?? 500).json({ error: errorCode, error_description: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/oidc/token — OIDC token exchange  [PUBLIC]
//
// The token endpoint is unauthenticated per OAuth 2.0 / OIDC spec — the
// relying party authenticates via client_secret or PKCE, not a user JWT.
// ---------------------------------------------------------------------------
oidcPublicRouter.post('/oidc/token', async (req: Request, res: Response): Promise<void> => {
  try {
    // Map snake_case from standard OIDC to camelCase
    const tokenRequest = {
      grantType: req.body.grant_type ?? req.body.grantType,
      code: req.body.code,
      redirectUri: req.body.redirect_uri ?? req.body.redirectUri,
      clientId: req.body.client_id ?? req.body.clientId,
      clientSecret: req.body.client_secret ?? req.body.clientSecret,
      codeVerifier: req.body.code_verifier ?? req.body.codeVerifier,
      refreshToken: req.body.refresh_token ?? req.body.refreshToken,
      scope: req.body.scope,
    };

    const result = await oidcBridge.exchangeToken(tokenRequest);
    res.status(200).json(result);
  } catch (err) {
    const error = err as Error & { statusCode?: number; errorCode?: string };
    logger.error('oidc_token_error', { error: error.message });
    const errorCode = (error as any).errorCode ?? 'OIDC_TOKEN_ERROR';
    res.status(error.statusCode ?? 500).json({ error: errorCode, error_description: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/oidc/userinfo — UserInfo endpoint  [PUBLIC]
//
// Per OpenID Connect Core §5.3, the UserInfo endpoint authenticates the
// caller using the OIDC-issued access token (Bearer), NOT the platform JWT.
// A standards-compliant relying party will present only the OIDC token.
// ---------------------------------------------------------------------------
oidcPublicRouter.get('/oidc/userinfo', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Bearer token required' });
      return;
    }
    const token = authHeader.slice(7);
    const userInfo = await oidcBridge.getUserInfo(token);
    res.status(200).json(userInfo);
  } catch (err) {
    const error = err as Error & { statusCode?: number; errorCode?: string };
    logger.error('oidc_userinfo_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: (error as any).errorCode ?? 'USERINFO_ERROR', error_description: error.message });
  }
});

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
    error: 'SAML bridge is disabled for launch — unsigned assertions are not production-safe',
    code: 'SAML_NOT_IMPLEMENTED',
  });
});

// ==========================================================================
// SLA ROUTES
// ==========================================================================

// ---------------------------------------------------------------------------
// POST /enterprise/sla/register — Register SLA definition
// ---------------------------------------------------------------------------
router.post('/sla/register', validate(SLADefinitionSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    slaMonitor.registerSLA(req.body);
    res.status(201).json({ message: 'SLA definition registered' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('sla_register_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'SLA_REGISTER_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/sla/report — SLA report
// ---------------------------------------------------------------------------
router.get('/sla/report', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const periodDays = parseInt(req.query.period as string, 10) || undefined;
    const report = slaMonitor.generateReport(clientId, periodDays);
    res.status(200).json({ data: report });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('sla_report_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'SLA_REPORT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/sla/violations — Get SLA violations
// ---------------------------------------------------------------------------
router.get('/sla/violations', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const since = req.query.since as string | undefined;
    const violations = slaMonitor.getViolations(clientId, since);
    res.status(200).json({ data: violations });
  } catch (err) {
    const error = err as Error;
    logger.error('sla_violations_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'SLA_VIOLATIONS_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/sla/alerts — Get SLA alerts
// ---------------------------------------------------------------------------
router.get('/sla/alerts', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const alerts = slaMonitor.getAlerts(clientId, limit);
    res.status(200).json({ data: alerts });
  } catch (err) {
    const error = err as Error;
    logger.error('sla_alerts_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'SLA_ALERTS_ERROR' });
  }
});

// ==========================================================================
// USAGE / ANALYTICS
// ==========================================================================

// ---------------------------------------------------------------------------
// GET /enterprise/usage — Usage metrics
// ---------------------------------------------------------------------------
router.get('/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = getClientId(req);
    const periodDays = parseInt(req.query.period as string, 10) || 30;
    const analytics = apiGateway.getAnalytics(clientId, periodDays);
    res.status(200).json({ data: analytics });
  } catch (err) {
    const error = err as Error;
    logger.error('usage_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'USAGE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/sdk/metadata — SDK generation metadata
// ---------------------------------------------------------------------------
router.get('/sdk/metadata', (_req: Request, res: Response): void => {
  res.status(200).json({ data: apiGateway.getSDKMetadata() });
});

export default router;
