import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { PrismaClient } from '@prisma/client';
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import { createLogger, format, transports } from 'winston';
import Redis from 'ioredis';

import { credentialRoutes } from './routes/credentials';
import { verificationRoutes } from './routes/verification';
import { identityRoutes } from './routes/identity';
import { governanceRoutes } from './routes/governance';
import { auditRoutes } from './routes/audit';
import enterpriseIntegrationRoutes, { oidcPublicRouter } from './routes/enterprise/integration';
import enterpriseComplianceRoutes from './routes/enterprise/compliance';
import { authMiddleware } from './middleware/auth';
import { createRateLimiter } from './middleware/rateLimit';
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

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: true }),
    format.json(),
  ),
  defaultMeta: { service: 'zeroid-api' },
  transports: [
    new transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? format.json()
        : format.combine(format.colorize(), format.simple()),
    }),
  ],
});

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production'
    ? ['error']
    : ['query', 'info', 'warn', 'error'],
});

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  },
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on('error', (err) => logger.error('Redis connection error', { error: err.message }));
redis.on('connect', () => logger.info('Redis connected'));

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestCounter = new Counter({
  name: 'zeroid_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'zeroid_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const credentialIssuedCounter = new Counter({
  name: 'zeroid_credentials_issued_total',
  help: 'Total credentials issued',
  registers: [metricsRegistry],
});

export const verificationCounter = new Counter({
  name: 'zeroid_verifications_total',
  help: 'Total verification requests',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

const trustedProxy = process.env.TRUSTED_PROXY
  ?.split(',')
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

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function resolveRequestId(value: unknown): string {
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS
app.use(cors({
  origin: getAllowedCorsOrigins(),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Zeroid-Org-Id'],
  credentials: true,
  maxAge: 86400,
}));

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '2mb',
  parameterLimit: 100,
  depth: 5,
} as Parameters<typeof express.urlencoded>[0] & { depth: number }));

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
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'zeroid-api' });
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

  const allHealthy = Object.values(checks).every((v) => v === 'ok');
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

function requireMetricsAccess(req: Request, res: Response, next: NextFunction): void {
  if (isMetricsEndpointDisabled()) {
    res.status(404).json({ error: 'Metrics endpoint disabled', code: 'METRICS_DISABLED' });
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
    res.status(401).json({ error: 'Metrics authorization required', code: 'METRICS_AUTH_REQUIRED' });
    return;
  }

  next();
}

app.get('/metrics', metricsLimiter, requireMetricsAccess, async (_req: Request, res: Response) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

// ---------------------------------------------------------------------------
// Global rate limiter (per-IP)
// ---------------------------------------------------------------------------
const globalLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  keyPrefix: 'rl:global',
});
app.use('/api', globalLimiter);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/v1/identity', apiRouteLimiter, identityRoutes);
app.use('/api/v1/credentials', apiRouteLimiter, authMiddleware, credentialRoutes);
app.use('/api/v1/verification', apiRouteLimiter, authMiddleware, verificationRoutes);
app.use('/api/v1/governance', apiRouteLimiter, authMiddleware, governanceRoutes);
app.use('/api/v1/audit', apiRouteLimiter, authMiddleware, auditRoutes);

// Enterprise routes — mounted behind auth + stricter rate limit
const enterpriseLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'rl:enterprise',
});

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
app.use('/api/v1/enterprise', enterpriseLimiter, authMiddleware, enterpriseIntegrationRoutes);
app.use('/api/v1/enterprise/compliance', enterpriseLimiter, authMiddleware, enterpriseComplianceRoutes);

const { aiComplianceRoutes } = require('./routes/ai/compliance') as typeof import('./routes/ai/compliance');
const { aiAgentIdentityRoutes } = require('./routes/ai/agent-identity') as typeof import('./routes/ai/agent-identity');
app.use('/api/v1/ai/compliance', enterpriseLimiter, aiComplianceRoutes);
app.use('/api/v1/ai/agents', enterpriseLimiter, aiAgentIdentityRoutes);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', code: 'ROUTE_NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err: Error & { statusCode?: number; code?: string }, req: Request, res: Response, _next: NextFunction) => {
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
});

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
      logger.error('CRITICAL_SECURITY_VIOLATION: production safety control failed', {
        control: v.control,
        risk: v.risk,
      });
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

async function bootstrap(): Promise<void> {
  try {
    validateProductionConfig();

    await redis.connect();
    await prisma.$connect();
    logger.info('Database connected');

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
