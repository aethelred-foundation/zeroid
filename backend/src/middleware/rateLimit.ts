import { Request, Response, NextFunction } from 'express';
import { redis, logger } from '../index';
import { isProductionRuntime } from '../services/production-safety';

const RATE_LIMIT_WINDOW_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  local current_count = redis.call('ZCARD', KEYS[1])
  if current_count >= tonumber(ARGV[4]) then
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return current_count + 1
  end
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  return current_count + 1
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Redis key prefix to namespace limiters */
  keyPrefix: string;
  /** Custom key extractor (defaults to IP) */
  keyExtractor?: (req: Request) => string;
  /** Whether to include rate limit headers in responses */
  includeHeaders?: boolean;
  /** Custom handler when limit is exceeded */
  onLimitReached?: (req: Request, res: Response) => void;
  /** Development-only escape hatch for local Redis outages */
  failOpenOnStoreError?: boolean;
}

// ---------------------------------------------------------------------------
// Sliding window rate limiter using Redis sorted sets
// ---------------------------------------------------------------------------
export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyPrefix,
    keyExtractor,
    includeHeaders = true,
    onLimitReached,
    failOpenOnStoreError,
  } = config;

  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = keyExtractor ? keyExtractor(req) : extractClientIP(req);
    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const requestCountResult = await redis.eval(
        RATE_LIMIT_WINDOW_SCRIPT,
        1,
        key,
        String(windowStart),
        String(now),
        `${now}:${crypto.randomUUID()}`,
        String(maxRequests),
        String(windowSec + 1),
      );
      const requestCount = Number(requestCountResult);
      if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
        logger.warn('rate_limit_redis_unavailable', { key });
        handleRateLimitStoreFailure(req, res, next, {
          key,
          includeHeaders,
          maxRequests,
          windowSec,
          failOpenOnStoreError,
        });
        return;
      }

      const remaining = Math.max(0, maxRequests - requestCount);
      const resetTime = Math.ceil((now + windowMs) / 1000);

      // Set rate limit headers
      if (includeHeaders) {
        res.set('X-RateLimit-Limit', String(maxRequests));
        res.set('X-RateLimit-Remaining', String(remaining));
        res.set('X-RateLimit-Reset', String(resetTime));
        res.set('X-RateLimit-Policy', `${maxRequests};w=${windowSec}`);
      }

      if (requestCount > maxRequests) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.set('Retry-After', String(retryAfter));

        logger.warn('rate_limit_exceeded', {
          key,
          identifier,
          requestCount,
          maxRequests,
          path: req.path,
        });

        if (onLimitReached) {
          onLimitReached(req, res);
          return;
        }

        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
        });
        return;
      }

      next();
    } catch (err) {
      logger.error('rate_limit_error', {
        error: (err as Error).message,
        key,
      });
      handleRateLimitStoreFailure(req, res, next, {
        key,
        includeHeaders,
        maxRequests,
        windowSec,
        failOpenOnStoreError,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Specialized rate limiters
// ---------------------------------------------------------------------------

/** Strict limiter for authentication endpoints */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  keyPrefix: 'rl:auth',
});

/** Standard API rate limiter */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60_000, // 1 minute
  maxRequests: 60,
  keyPrefix: 'rl:api',
});

/** Strict limiter for credential issuance */
export const credentialIssuanceLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'rl:credential:issue',
});

/** Limiter for verification requests */
export const verificationLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'rl:verify',
});

/** Limiter for governance actions */
export const governanceLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
  keyPrefix: 'rl:governance',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Extract client IP address.
 * Only trusts forwarding headers when TRUSTED_PROXY is configured.
 * Otherwise uses the socket peer address to prevent spoofing.
 */
function extractClientIP(req: Request): string {
  if (isRequestFromTrustedProxy(req)) {
    // Only trust forwarding headers when behind a known proxy
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
  }

  // Use socket peer address — not spoofable
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function isRequestFromTrustedProxy(req: Request): boolean {
  const trustedProxies = parseTrustedProxyList(process.env.TRUSTED_PROXY);
  if (trustedProxies.length === 0) return false;

  const remoteAddress = normalizeProxyAddress(req.socket.remoteAddress ?? req.ip);
  return Boolean(remoteAddress && trustedProxies.includes(remoteAddress));
}

function parseTrustedProxyList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => normalizeProxyAddress(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeProxyAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/i, '')
    .toLowerCase();
}

function shouldFailOpenOnStoreError(failOpenOnStoreError: boolean | undefined): boolean {
  if (typeof failOpenOnStoreError === 'boolean') return failOpenOnStoreError;
  return !isProductionRuntime();
}

function handleRateLimitStoreFailure(
  req: Request,
  res: Response,
  next: NextFunction,
  options: {
    key: string;
    includeHeaders: boolean;
    maxRequests: number;
    windowSec: number;
    failOpenOnStoreError?: boolean;
  },
): void {
  if (shouldFailOpenOnStoreError(options.failOpenOnStoreError)) {
    logger.warn('rate_limit_store_failure_allowed', {
      key: options.key,
      path: req.path,
      env: process.env.NODE_ENV ?? 'development',
    });
    next();
    return;
  }

  const retryAfter = Math.max(1, options.windowSec);
  if (options.includeHeaders) {
    res.set('X-RateLimit-Limit', String(options.maxRequests));
    res.set('X-RateLimit-Remaining', '0');
    res.set('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + retryAfter));
    res.set('X-RateLimit-Policy', `${options.maxRequests};w=${options.windowSec}`);
  }
  res.set('Retry-After', String(retryAfter));
  res.status(503).json({
    error: 'Rate limiting temporarily unavailable',
    code: 'RATE_LIMIT_STORE_UNAVAILABLE',
    retryAfter,
  });
}

// ---------------------------------------------------------------------------
// DID-based rate limiter (uses identity DID as key)
// ---------------------------------------------------------------------------
export function createDIDRateLimiter(config: Omit<RateLimitConfig, 'keyExtractor'>) {
  return createRateLimiter({
    ...config,
    keyExtractor: (req: Request) => {
      const authReq = req as Request & { identity?: { did: string } };
      return authReq.identity?.did ?? extractClientIP(req);
    },
  });
}
