/**
 * Shared runtime singletons — logger, Prisma, Redis, and Prometheus metrics.
 *
 * These live here, in a leaf module, rather than in the `index.ts` entrypoint.
 * Services and routes construct singletons at module load (e.g.
 * `credentialService = new CredentialService()`), and a service importing these
 * from the entrypoint created a circular dependency: the service ran before
 * `index.ts` had defined `logger`, so `logger` was `undefined` at construction
 * and the API crashed on boot. Importing from a dependency-free leaf module
 * removes that cycle. `index.ts` re-exports these for backwards compatibility.
 */
import { PrismaClient } from '@prisma/client';
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import { createLogger, format, transports } from 'winston';
import Redis from 'ioredis';

import {
  AUDIT_CHAIN_GENESIS,
  buildAuditIntegrityFields,
} from './services/audit-integrity';

// ── Logger ─────────────────────────────────────────────────────────────────
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
      format:
        process.env.NODE_ENV === 'production'
          ? format.json()
          : format.combine(format.colorize(), format.simple()),
    }),
  ],
});

// ── Prisma ─────────────────────────────────────────────────────────────────
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'production'
      ? ['error']
      : ['query', 'info', 'warn', 'error'],
});

if (typeof (prisma as any).$use === 'function') {
  prisma.$use(async (params, next) => {
    if (params.model === 'AuditLog' && params.action === 'create') {
      const data = (params.args?.data ?? {}) as Record<string, unknown>;
      if (!data.entryHash) {
        const lastSealedAudit = await (prisma.auditLog as any).findFirst({
          where: { entryHash: { not: null } },
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          select: { entryHash: true },
        });

        Object.assign(
          data,
          buildAuditIntegrityFields(
            data as any,
            lastSealedAudit?.entryHash ?? AUDIT_CHAIN_GENESIS,
          ),
        );
        params.args.data = data;
      }
    }

    return next(params);
  });
}

// ── Redis ──────────────────────────────────────────────────────────────────
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

// ── Prometheus metrics ─────────────────────────────────────────────────────
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
