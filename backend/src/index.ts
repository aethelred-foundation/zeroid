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
  origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  credentials: true,
  maxAge: 86400,
}));

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Compression
app.use(compression());

// Request ID & timing
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] ?? crypto.randomUUID();
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
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'zeroid-api' });
});

app.get('/ready', async (_req: Request, res: Response) => {
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

// Metrics endpoint (unauthenticated — bind to internal port in production)
app.get('/metrics', async (_req: Request, res: Response) => {
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
app.use('/api/v1/identity', identityRoutes);
app.use('/api/v1/credentials', authMiddleware, credentialRoutes);
app.use('/api/v1/verification', authMiddleware, verificationRoutes);
app.use('/api/v1/governance', authMiddleware, governanceRoutes);
app.use('/api/v1/audit', authMiddleware, auditRoutes);

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
app.use('/api/v1/enterprise', authMiddleware, enterpriseLimiter, enterpriseIntegrationRoutes);
app.use('/api/v1/enterprise/compliance', authMiddleware, enterpriseLimiter, enterpriseComplianceRoutes);

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
  if (process.env.NODE_ENV !== 'production') return;

  const unsafeFlags: { flag: string; value: string | undefined; risk: string }[] = [
    {
      flag: 'ALLOW_LOCAL_CREDENTIAL_SIGNING',
      value: process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING,
      risk: 'Bypasses KMS/HSM — signing keys in env vars or local files',
    },
    {
      flag: 'ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING',
      value: process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING,
      risk: 'Enables deprecated HMAC credential verification path',
    },
    {
      flag: 'ALLOW_PUBLIC_OIDC_CLIENTS',
      value: process.env.ALLOW_PUBLIC_OIDC_CLIENTS,
      risk: 'Allows OIDC clients without client_secret authentication',
    },
    {
      flag: 'ALLOW_UNSAFE_TEE_ATTESTATION',
      value: process.env.ALLOW_UNSAFE_TEE_ATTESTATION,
      risk: 'Disables DCAP quote verification — attestation is decorative only',
    },
  ];

  const violations = unsafeFlags.filter((f) => f.value === 'true');

  if (violations.length > 0) {
    for (const v of violations) {
      logger.error('CRITICAL_SECURITY_VIOLATION: unsafe flag enabled in production', {
        flag: v.flag,
        risk: v.risk,
      });
    }
    throw new Error(
      `Production startup blocked: ${violations.length} unsafe flag(s) detected: ` +
      `${violations.map((v) => v.flag).join(', ')}. ` +
      'Set all ALLOW_* flags to false or remove them from env before deploying.',
    );
  }

  logger.info('production_safety_gates_passed', {
    checkedFlags: unsafeFlags.map((f) => f.flag),
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

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

bootstrap();

export default app;
