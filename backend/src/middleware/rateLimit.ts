import { Request, Response, NextFunction } from 'express';
import { redis, logger } from '../index';

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
  } = config;

  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = keyExtractor ? keyExtractor(req) : extractClientIP(req);
    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Sliding window counter via Redis sorted set
      const pipeline = redis.pipeline();
      // Remove entries outside the current window
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Add current request
      pipeline.zadd(key, now, `${now}:${crypto.randomUUID()}`);
      // Count entries in window
      pipeline.zcard(key);
      // Set TTL on the key
      pipeline.expire(key, windowSec + 1);

      const results = await pipeline.exec();
      if (!results) {
        // Redis unavailable — fail open
        logger.warn('rate_limit_redis_unavailable', { key });
        next();
        return;
      }

      const requestCount = (results[2]?.[1] as number) ?? 0;
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
      // Fail open if Redis is unavailable
      logger.error('rate_limit_error', {
        error: (err as Error).message,
        key,
      });
      next();
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
  const trustedProxy = process.env.TRUSTED_PROXY;

  if (trustedProxy) {
    // Only trust forwarding headers when behind a known proxy
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
  }

  // Use socket peer address — not spoofable
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
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
