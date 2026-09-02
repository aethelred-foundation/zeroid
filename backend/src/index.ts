import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';

import { credentialRoutes } from './routes/credentials';
import { verificationRoutes } from './routes/verification';
import { identityRoutes } from './routes/identity';
import { identityAuthRoutes } from './routes/identity-auth';
import { governanceRoutes } from './routes/governance';
import { auditRoutes } from './routes/audit';
import partnersRoutes from './routes/partners';
import oid4vpRoutes from './routes/oid4vp';
import oid4vciRoutes from './routes/oid4vci';
import enterpriseIntegrationRoutes, {
  oidcPublicRouter,
} from './routes/enterprise/integration';
import enterpriseComplianceRoutes from './routes/enterprise/compliance';
import { authMiddleware } from './middleware/auth';
import {
  createRateLimiter,
  extractPrincipalRateLimitIdentifier,
} from './middleware/rateLimit';
import {
  checkedProductionSafetyControls,
  collectProductionSafetyViolations,
  getAllowedCorsOrigins,
  isMetricsAccessConfigured,
  isMetricsEndpointDisabled,
  isMetricsRequestAuthorized,
  isProductionRuntime,
} from './services/production-safety';
import {
  parseExpectedCircuitArtifactDigests,
  validateCircuitArtifacts,
} from './services/circuit-artifacts';
import { webhookSystem } from './services/enterprise/webhook-system';
import {
  loadIdentityRegistryConfiguration,
  probeIdentityRegistryReadiness,
} from './lib/identity-registry-config';

// ---------------------------------------------------------------------------
// Shared runtime singletons (logger, Prisma, Redis, Prometheus metrics) live in
// ./runtime to avoid a circular dependency: services construct at module load
// and importing these from this entrypoint ran before they were defined.
// ---------------------------------------------------------------------------
import {
  logger,
  prisma,
  redis,
  metricsRegistry,
  httpRequestCounter,
  httpRequestDuration,
  credentialIssuedCounter,
  verificationCounter,
} from './runtime';

// Re-export for backwards compatibility (tests + importers using '../index').
export {
  logger,
  prisma,
  redis,
  metricsRegistry,
  httpRequestCounter,
  httpRequestDuration,
  credentialIssuedCounter,
  verificationCounter,
};

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

const trustedProxy = process.env.TRUSTED_PROXY?.split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

if (trustedProxy && trustedProxy.length > 0) {
  app.set('trust proxy', trustedProxy);
  logger.info('trusted_proxy_configured', { proxyCount: trustedProxy.length });
}

const publicHealthLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'rl:health',
});

const metricsLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'rl:metrics',
});

const apiRouteLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  keyPrefix: 'rl:api-route',
});

function createAuthenticatedPrincipalLimiter(
  keyPrefix: string,
  maxRequests: number,
) {
  return createRateLimiter({
    windowMs: 60_000,
    maxRequests,
    keyPrefix,
    keyExtractor: extractPrincipalRateLimitIdentifier,
  });
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PRIVATE_NO_STORE_CACHE_CONTROL =
  'private, no-store, no-cache, must-revalidate, proxy-revalidate';

function resolveRequestId(value: unknown): string {
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}

function setSensitiveApiCacheHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', PRIVATE_NO_STORE_CACHE_CONTROL);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.vary('Authorization');
  next();
}

export function buildHelmetOptions(
  production = isProductionRuntime(),
): Parameters<typeof helmet>[0] {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
      },
    },
    hsts: production
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  };
}

// Security headers
app.use(helmet(buildHelmetOptions()));

// CORS
const allowedCorsOrigins = new Set(getAllowedCorsOrigins());
app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin are non-browser or same-origin. Browser
      // cross-origin requests must match the configured allowlist exactly.
      callback(null, origin === undefined || allowedCorsOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Zeroid-Org-Id',
      'Idempotency-Key',
    ],
    credentials: true,
    maxAge: 86400,
  }),
);

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(
  express.urlencoded({
    extended: true,
    limit: '2mb',
    parameterLimit: 100,
    depth: 5,
  } as Parameters<typeof express.urlencoded>[0] & { depth: number }),
);

// Compression
app.use(compression());

// Request ID & timing
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Request logging & metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const requestId = req.headers['x-request-id'] as string;

  logger.info('request_start', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = req.route?.path ?? req.path;

    httpRequestCounter.inc({
      method: req.method,
      route,
      status: String(res.statusCode),
    });
    httpRequestDuration.observe(
      { method: req.method, route, status: String(res.statusCode) },
      durationSec,
    );

    logger.info('request_end', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: (durationNs / 1e6).toFixed(2),
    });
  });

  next();
});

// ---------------------------------------------------------------------------
// Health & readiness
// ---------------------------------------------------------------------------
app.get('/health', publicHealthLimiter, (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'zeroid-api',
  });
});

app.get('/ready', publicHealthLimiter, async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'unavailable';
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'unavailable';
  }

  if (isProductionRuntime()) {
    const violations = collectProductionSafetyViolations();
    checks.productionSafety = violations.length === 0 ? 'ok' : 'unavailable';
    try {
      const circuitReport = validateCircuitArtifacts({
        requireArtifacts: true,
        requireExpectedDigests: true,
        expectedDigests: parseExpectedCircuitArtifactDigests(
          process.env.ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON,
        ),
      });
      checks.circuitArtifacts = circuitReport.every(
        (circuit) => circuit.artifactsReady,
      )
        ? 'ok'
        : 'unavailable';
    } catch {
      checks.circuitArtifacts = 'unavailable';
    }
  } else {
    checks.productionSafety = 'ok';
    try {
      const circuitReport = validateCircuitArtifacts();
      checks.circuitArtifacts = circuitReport.every(
        (circuit) => circuit.artifactsReady,
      )
        ? 'ok'
        : 'degraded';
    } catch {
      checks.circuitArtifacts = 'degraded';
    }
  }

  // Identity registration answers 503 until the registry verifier can reach
  // its RPC and sees code at the configured registry address.
  checks.identityRegistry = await probeIdentityRegistryReadiness();

  const allHealthy = Object.values(checks).every((v) => v === 'ok');
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

function requireMetricsAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isMetricsEndpointDisabled()) {
    res
      .status(404)
      .json({ error: 'Metrics endpoint disabled', code: 'METRICS_DISABLED' });
    return;
  }

  if (!isMetricsAccessConfigured()) {
    res.status(503).json({
      error: 'Metrics access is not configured for production',
      code: 'METRICS_ACCESS_NOT_CONFIGURED',
    });
    return;
  }

  if (!isMetricsRequestAuthorized(req.get('authorization'))) {
    res
      .status(401)
      .json({
        error: 'Metrics authorization required',
        code: 'METRICS_AUTH_REQUIRED',
      });
    return;
  }

  next();
}

app.get(
  '/metrics',
  metricsLimiter,
  requireMetricsAccess,
  async (_req: Request, res: Response) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  },
);

// ---------------------------------------------------------------------------
// Global rate limiter (per-IP)
// ---------------------------------------------------------------------------
const globalLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  keyPrefix: 'rl:global',
});
const localApiAbuseGuard = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60,
  },
});
app.use('/api', setSensitiveApiCacheHeaders);
// Keep a process-local limiter in front of the Redis sliding-window limiter.
// Redis remains the authoritative distributed control; this guard also
// protects development/testnet if their Redis instance is briefly unavailable.
app.use('/api', localApiAbuseGuard);
app.use('/api', globalLimiter);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
const credentialPrincipalLimiter = createAuthenticatedPrincipalLimiter(
  'rl:principal:credentials',
  30,
);
const verificationPrincipalLimiter = createAuthenticatedPrincipalLimiter(
  'rl:principal:verification',
  60,
);
const governancePrincipalLimiter = createAuthenticatedPrincipalLimiter(
  'rl:principal:governance',
  30,
);
const auditPrincipalLimiter = createAuthenticatedPrincipalLimiter(
  'rl:principal:audit',
  30,
);

app.use('/api/v1/identity/auth', apiRouteLimiter, identityAuthRoutes);
app.use('/api/v1/identity', apiRouteLimiter, identityRoutes);
app.use('/api/v1/partners', apiRouteLimiter, partnersRoutes);
app.use('/api/v1/oid4vp', oid4vpRoutes); // OpenID4VP verifier (self-limited; per-route auth)
app.use('/api/v1/oid4vci', oid4vciRoutes); // OpenID4VCI issuer (self-limited)
app.use(
  '/api/v1/credentials',
  apiRouteLimiter,
  authMiddleware,
  credentialPrincipalLimiter,
  credentialRoutes,
);
app.use(
  '/api/v1/verification',
  apiRouteLimiter,
  authMiddleware,
  verificationPrincipalLimiter,
  verificationRoutes,
);
app.use(
  '/api/v1/governance',
  apiRouteLimiter,
  authMiddleware,
  governancePrincipalLimiter,
  governanceRoutes,
);
app.use(
  '/api/v1/audit',
  apiRouteLimiter,
  authMiddleware,
  auditPrincipalLimiter,
  auditRoutes,
);

// Enterprise routes — mounted behind auth + stricter rate limit
const enterpriseLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'rl:enterprise',
});
const enterprisePrincipalLimiter = createAuthenticatedPrincipalLimiter(
  'rl:principal:enterprise',
  30,
);

// OIDC public routes — discovery, JWKS, and token endpoints MUST be accessible
// without a bearer token per OpenID Connect Discovery §4 and OAuth 2.0 §3.2.
// Rate-limited but NOT behind authMiddleware.
const oidcPublicLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'rl:oidc-public',
});
app.use('/api/v1/enterprise', oidcPublicLimiter, oidcPublicRouter);

// Auth-gated enterprise routes (registration, authorize, userinfo, webhooks, etc.)
app.use(
  '/api/v1/enterprise',
  enterpriseLimiter,
  authMiddleware,
  enterprisePrincipalLimiter,
  enterpriseIntegrationRoutes,
);
app.use(
  '/api/v1/enterprise/compliance',
  enterpriseLimiter,
  authMiddleware,
  enterprisePrincipalLimiter,
  enterpriseComplianceRoutes,
);

function lazyRouter(
  load: () => Promise<express.Router>,
): express.RequestHandler {
  let routerPromise: Promise<express.Router> | undefined;
  return async (req, res, next) => {
    try {
      if (!routerPromise) {
        routerPromise = load();
      }
      const router = await routerPromise;
      router(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

app.use(
  '/api/v1/ai/compliance',
  enterpriseLimiter,
  lazyRouter(async () => {
    const { aiComplianceRoutes } = await import('./routes/ai/compliance');
    return aiComplianceRoutes;
  }),
);
app.use(
  '/api/v1/ai/agents',
  enterpriseLimiter,
  lazyRouter(async () => {
    const { aiAgentIdentityRoutes } =
      await import('./routes/ai/agent-identity');
    return aiAgentIdentityRoutes;
  }),
);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use(
  (
    err: Error & { statusCode?: number; code?: string },
    req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const requestId = req.headers['x-request-id'] as string;
    const statusCode = err.statusCode ?? 500;

    logger.error('unhandled_error', {
      requestId,
      error: err.message,
      stack: err.stack,
      code: err.code,
      path: req.path,
    });

    res.status(statusCode).json({
      error: statusCode >= 500 ? 'Internal server error' : err.message,
      code: err.code ?? 'INTERNAL_ERROR',
      requestId,
    });
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// ---------------------------------------------------------------------------
// Production Safety Gates
// ---------------------------------------------------------------------------
function validateProductionConfig(): void {
  if (!isProductionRuntime()) return;

  const violations = collectProductionSafetyViolations();

  if (violations.length > 0) {
    for (const v of violations) {
      logger.error(
        'CRITICAL_SECURITY_VIOLATION: production safety control failed',
        {
          control: v.control,
          risk: v.risk,
        },
      );
    }
    throw new Error(
      `Production startup blocked: ${violations.length} unsafe control(s) detected: ` +
        `${violations.map((v) => v.control).join(', ')}. ` +
        'Fix production safety controls before deploying.',
    );
  }

  const circuitReport = validateCircuitArtifacts({
    requireArtifacts: true,
    requireExpectedDigests: true,
    expectedDigests: parseExpectedCircuitArtifactDigests(
      process.env.ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON,
    ),
  });

  logger.info('production_safety_gates_passed', {
    checkedControls: checkedProductionSafetyControls(),
    circuitArtifacts: circuitReport.map((circuit) => ({
      name: circuit.name,
      artifactsReady: circuit.artifactsReady,
      sourceSha256: circuit.source.sha256,
      artifactLabels: Object.keys(circuit.artifacts),
    })),
  });
}

export function logIdentityRegistryConfiguration(): void {
  try {
    const config = loadIdentityRegistryConfiguration();
    logger.info('identity_registry_config', {
      chainId: config.chainId.toString(),
      registryAddress: config.registryAddress,
      minimumConfirmations: config.minimumConfirmations,
      receiptWaitMs: config.receiptWaitMs,
      allowedDidNetworks: config.allowedDidNetworks,
      anchorConfigured: config.networkAnchorBlock !== undefined,
    });
  } catch (error) {
    logger.warn('identity_registry_not_configured', {
      reason: (error as Error).message,
      effect:
        'POST /api/v1/identity/register answers 503 IDENTITY_REGISTRY_NOT_CONFIGURED',
    });
  }
}

async function bootstrap(): Promise<void> {
  try {
    validateProductionConfig();
    logIdentityRegistryConfiguration();

    await redis.connect();
    await prisma.$connect();
    logger.info('Database connected');
    webhookSystem.startRetryWorker();

    app.listen(PORT, () => {
      logger.info(`ZeroID API server listening on port ${PORT}`, {
        env: process.env.NODE_ENV ?? 'development',
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: (err as Error).message });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully`);
  await webhookSystem.stopRetryWorker();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

function registerProcessHandlers(): void {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

if (require.main === module) {
  registerProcessHandlers();
  void bootstrap();
}

export default app;
