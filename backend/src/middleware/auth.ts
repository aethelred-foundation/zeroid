import { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import * as jose from 'jose';
import { prisma, logger, redis } from '../runtime';
import { isAethelredDid } from '../utils/did';
import { isProductionRuntime } from '../services/production-safety';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AuthenticatedRequest extends Request {
  identity?: {
    id: string;
    did: string;
    publicKey: string;
    status: string;
  };
  sessionId?: string;
  sessionAuthTime?: number;
}

interface JWTPayload {
  sub: string;        // identity ID
  did: string;        // DID identifier
  iat: number;
  exp: number;
  jti: string;        // session ID
}

type ApiJwtAlgorithm = 'HS256' | 'RS256' | 'ES256';

interface JwtKeyConfig {
  algorithm: ApiJwtAlgorithm;
  keyId?: string;
  mode: 'asymmetric' | 'legacy-hmac';
  signingKey: Promise<Uint8Array | jose.KeyLike>;
  verificationKey: Promise<Uint8Array | jose.KeyLike>;
}

interface AuthFailureAuditDetails {
  code: string;
  reason: string;
  tokenHash?: string;
  sessionId?: string;
  subjectId?: string;
  did?: string;
  identityId?: string;
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------
function loadLegacyJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is not set. ' +
      'Refusing to start without a cryptographic signing secret.',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      'FATAL: JWT_SECRET must be at least 32 characters. ' +
      'Refusing to start with a weak signing secret.',
    );
  }
  return new TextEncoder().encode(secret);
}

const JWT_ISSUER = 'zeroid-api';
const JWT_AUDIENCE = 'zeroid-client';
const TOKEN_EXPIRY = '24h';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const JWT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizePem(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function loadApiJwtAlgorithm(hasAsymmetricKeys: boolean): ApiJwtAlgorithm {
  const configured = (process.env.API_JWT_ALGORITHM ?? process.env.JWT_ALGORITHM)?.trim();
  const algorithm = configured || (hasAsymmetricKeys ? 'RS256' : 'HS256');
  if (!['HS256', 'RS256', 'ES256'].includes(algorithm)) {
    throw new Error(`FATAL: Unsupported API JWT algorithm: ${algorithm}`);
  }
  if (hasAsymmetricKeys && algorithm === 'HS256') {
    throw new Error('FATAL: API JWT asymmetric keys cannot be used with HS256');
  }
  return algorithm as ApiJwtAlgorithm;
}

function loadJwtKeyConfig(): JwtKeyConfig {
  const privateKeyPem = (
    process.env.API_JWT_SIGNING_PRIVATE_KEY ??
    process.env.JWT_SIGNING_PRIVATE_KEY ??
    ''
  ).trim();
  const publicKeyPem = (
    process.env.API_JWT_VERIFICATION_PUBLIC_KEY ??
    process.env.JWT_VERIFICATION_PUBLIC_KEY ??
    ''
  ).trim();
  const hasAsymmetricKeys = privateKeyPem.length > 0 || publicKeyPem.length > 0;
  const algorithm = loadApiJwtAlgorithm(hasAsymmetricKeys);

  if (hasAsymmetricKeys) {
    if (!privateKeyPem || !publicKeyPem) {
      throw new Error(
        'FATAL: Both API_JWT_SIGNING_PRIVATE_KEY and API_JWT_VERIFICATION_PUBLIC_KEY are required',
      );
    }

    return {
      algorithm,
      keyId: (process.env.API_JWT_KEY_ID ?? process.env.JWT_KEY_ID)?.trim() || undefined,
      mode: 'asymmetric',
      signingKey: jose.importPKCS8(normalizePem(privateKeyPem), algorithm),
      verificationKey: jose.importSPKI(normalizePem(publicKeyPem), algorithm),
    };
  }

  if (isProductionRuntime()) {
    throw new Error(
      'FATAL: Production API JWTs require asymmetric signing keys; configure API_JWT_SIGNING_PRIVATE_KEY and API_JWT_VERIFICATION_PUBLIC_KEY',
    );
  }

  const secret = loadLegacyJWTSecret();
  return {
    algorithm: 'HS256',
    mode: 'legacy-hmac',
    signingKey: Promise.resolve(secret),
    verificationKey: Promise.resolve(secret),
  };
}

const JWT_KEYS = loadJwtKeyConfig();

function isAcceptedJwtHeader(header: jose.JWTHeaderParameters): boolean {
  if (header.alg !== JWT_KEYS.algorithm || header.typ !== 'JWT') {
    return false;
  }

  return JWT_KEYS.mode !== 'asymmetric' || !JWT_KEYS.keyId || header.kid === JWT_KEYS.keyId;
}

function parseJwtPayload(payload: jose.JWTPayload): JWTPayload | null {
  if (
    typeof payload.sub !== 'string' ||
    !JWT_ID_PATTERN.test(payload.sub) ||
    typeof payload.did !== 'string' ||
    !isAethelredDid(payload.did) ||
    typeof payload.jti !== 'string' ||
    !JWT_ID_PATTERN.test(payload.jti) ||
    typeof payload.iat !== 'number' ||
    !Number.isSafeInteger(payload.iat) ||
    typeof payload.exp !== 'number' ||
    !Number.isSafeInteger(payload.exp)
  ) {
    return null;
  }

  return {
    sub: payload.sub,
    did: payload.did,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}

function sessionTtlSeconds(expiresAt: Date): number {
  const secondsRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return Math.max(1, Math.min(SESSION_TTL_SECONDS, secondsRemaining));
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------
export async function generateToken(identityId: string, did: string): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();

  const token = await new jose.SignJWT({ did } as unknown as jose.JWTPayload)
    .setProtectedHeader({
      alg: JWT_KEYS.algorithm,
      typ: 'JWT',
      ...(JWT_KEYS.keyId ? { kid: JWT_KEYS.keyId } : {}),
    })
    .setSubject(identityId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(sessionId)
    .sign(await JWT_KEYS.signingKey);

  // Store session in database and cache
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      id: sessionId,
      identityId,
      tokenHash,
      expiresAt,
    },
  });

  // Cache session for fast lookup (TTL = 24h)
  await redis.set(
    `session:${sessionId}`,
    JSON.stringify({ identityId, did, tokenHash, expiresAt: expiresAt.toISOString() }),
    'EX',
    sessionTtlSeconds(expiresAt),
  );

  logger.info('token_generated', { identityId, did, sessionId });
  return { token, sessionId };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------
export async function revokeToken(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  await redis.del(`session:${sessionId}`);
  // Add to revocation set for remainder of original TTL
  await redis.set(`revoked:${sessionId}`, '1', 'EX', 86400);
  logger.info('token_revoked', { sessionId });
}

// ---------------------------------------------------------------------------
// DID verification
// ---------------------------------------------------------------------------
async function verifyDID(did: string, publicKey: string): Promise<boolean> {
  // Verify DID format before database lookups.
  if (!isAethelredDid(did)) {
    logger.warn('invalid_did_format', { did });
    return false;
  }

  // Look up the DID in our registry and verify the public key matches
  const identity = await prisma.identity.findUnique({ where: { did } });
  if (!identity) {
    logger.warn('did_not_found', { did });
    return false;
  }

  if (identity.publicKey !== publicKey) {
    logger.warn('did_public_key_mismatch', { did });
    return false;
  }

  if (identity.status !== 'ACTIVE') {
    logger.warn('did_not_active', { did, status: identity.status });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helper: hash token for storage
// ---------------------------------------------------------------------------
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestHeader(req: Request, name: string): string | undefined {
  if (typeof req.get === 'function') {
    return req.get(name);
  }
  return firstHeader(req.headers[name.toLowerCase()]);
}

function safeRequestId(req: Request): string | undefined {
  const requestId = requestHeader(req, 'x-request-id');
  return requestId && JWT_ID_PATTERN.test(requestId) ? requestId : undefined;
}

async function recordAuthFailure(
  req: Request,
  details: AuthFailureAuditDetails,
): Promise<void> {
  const tokenHashPrefix = details.tokenHash?.slice(0, 16);
  const resourceId = details.sessionId ?? tokenHashPrefix ?? 'anonymous';
  const requestId = safeRequestId(req);
  const auditDetails: Prisma.InputJsonObject = {
    code: details.code,
    reason: details.reason,
    method: req.method,
    path: req.originalUrl ?? req.url,
    ...(requestId ? { requestId } : {}),
    ...(details.sessionId ? { sessionId: details.sessionId } : {}),
    ...(details.subjectId ? { subjectId: details.subjectId } : {}),
    ...(details.did ? { did: details.did } : {}),
    ...(tokenHashPrefix ? { tokenHashPrefix } : {}),
  };

  try {
    await prisma.auditLog.create({
      data: {
        ...(details.identityId ? { identityId: details.identityId } : {}),
        action: 'AUTH_FAILED',
        resourceType: 'auth',
        resourceId,
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: requestHeader(req, 'user-agent'),
        details: auditDetails,
      },
    });
  } catch (err) {
    logger.error('auth_failure_audit_error', { error: (err as Error).message });
  }
}

async function rejectAuth(
  req: Request,
  res: Response,
  payload: { error: string; code: string },
  details: Omit<AuthFailureAuditDetails, 'code' | 'reason'> = {},
): Promise<void> {
  await recordAuthFailure(req, {
    ...details,
    code: payload.code,
    reason: payload.error,
  });
  res.status(401).json(payload);
}

// ---------------------------------------------------------------------------
// Authentication middleware
// ---------------------------------------------------------------------------
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await rejectAuth(req, res, {
      error: 'Missing or invalid authorization header',
      code: 'AUTH_MISSING_TOKEN',
    });
    return;
  }

  const token = authHeader.slice(7);
  let tokenHash: string | undefined;

  try {
    tokenHash = await hashToken(token);

    // Verify JWT signature and claims
    const { payload, protectedHeader } = await jose.jwtVerify(token, await JWT_KEYS.verificationKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [JWT_KEYS.algorithm],
    });

    if (!isAcceptedJwtHeader(protectedHeader)) {
      await rejectAuth(
        req,
        res,
        { error: 'Invalid token header', code: 'AUTH_CLAIMS_INVALID' },
        { tokenHash },
      );
      return;
    }

    const jwtPayload = parseJwtPayload(payload);
    if (!jwtPayload) {
      await rejectAuth(
        req,
        res,
        { error: 'Invalid token claims', code: 'AUTH_CLAIMS_INVALID' },
        { tokenHash },
      );
      return;
    }
    const sessionId = jwtPayload.jti;

    // Check revocation
    const isRevoked = await redis.get(`revoked:${sessionId}`);
    if (isRevoked) {
      logger.warn('revoked_token_used', { sessionId, did: jwtPayload.did });
      await rejectAuth(
        req,
        res,
        { error: 'Token has been revoked', code: 'AUTH_TOKEN_REVOKED' },
        {
          tokenHash,
          sessionId,
          subjectId: jwtPayload.sub,
          did: jwtPayload.did,
        },
      );
      return;
    }

    // Verify session exists — check cache first, then DB
    let sessionValid = false;
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      try {
        const session = JSON.parse(cached) as {
          identityId?: string;
          did?: string;
          tokenHash?: string;
          expiresAt?: string;
        };
        sessionValid =
          session.identityId === jwtPayload.sub &&
          session.did === jwtPayload.did &&
          session.tokenHash === tokenHash &&
          (!session.expiresAt || new Date(session.expiresAt) > new Date());
      } catch {
        sessionValid = false;
      }
    } else {
      // Fall back to database — session must exist and not be expired
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (
        session &&
        session.identityId === jwtPayload.sub &&
        session.tokenHash === tokenHash &&
        session.expiresAt > new Date()
      ) {
        sessionValid = true;
        // Re-cache the session
        const identityData = {
          identityId: session.identityId,
          did: jwtPayload.did,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt.toISOString(),
        };
        await redis.set(
          `session:${sessionId}`,
          JSON.stringify(identityData),
          'EX',
          sessionTtlSeconds(session.expiresAt),
        );
      }
    }

    if (!sessionValid) {
      logger.warn('session_not_found', { sessionId, sub: jwtPayload.sub });
      await rejectAuth(
        req,
        res,
        { error: 'Session not found or expired', code: 'AUTH_SESSION_INVALID' },
        {
          tokenHash,
          sessionId,
          subjectId: jwtPayload.sub,
          did: jwtPayload.did,
        },
      );
      return;
    }

    // Fetch full identity for downstream handlers
    const identity = await prisma.identity.findUnique({
      where: { id: jwtPayload.sub },
      select: { id: true, did: true, publicKey: true, status: true },
    });

    if (!identity || identity.status !== 'ACTIVE') {
      await rejectAuth(
        req,
        res,
        { error: 'Identity not found or inactive', code: 'AUTH_IDENTITY_INVALID' },
        {
          tokenHash,
          sessionId,
          subjectId: jwtPayload.sub,
          did: jwtPayload.did,
          identityId: identity?.id,
        },
      );
      return;
    }

    req.identity = identity;
    req.sessionId = sessionId;
    req.sessionAuthTime = jwtPayload.iat;
    next();
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      await rejectAuth(
        req,
        res,
        { error: 'Token has expired', code: 'AUTH_TOKEN_EXPIRED' },
        { tokenHash },
      );
      return;
    }
    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      await rejectAuth(
        req,
        res,
        { error: 'Invalid token claims', code: 'AUTH_CLAIMS_INVALID' },
        { tokenHash },
      );
      return;
    }
    if ((err as Error).name === 'JOSEAlgNotAllowed') {
      await rejectAuth(
        req,
        res,
        { error: 'Invalid token header', code: 'AUTH_CLAIMS_INVALID' },
        { tokenHash },
      );
      return;
    }

    logger.error('auth_error', { error: (err as Error).message });
    await rejectAuth(
      req,
      res,
      { error: 'Authentication failed', code: 'AUTH_FAILED' },
      { tokenHash },
    );
  }
}

// ---------------------------------------------------------------------------
// Optional auth (does not reject — just populates req.identity if valid)
// ---------------------------------------------------------------------------
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    const token = authHeader.slice(7);
    const tokenHash = await hashToken(token);
    const { payload, protectedHeader } = await jose.jwtVerify(token, await JWT_KEYS.verificationKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [JWT_KEYS.algorithm],
    });

    if (!isAcceptedJwtHeader(protectedHeader)) {
      next();
      return;
    }

    const jwtPayload = parseJwtPayload(payload);
    if (!jwtPayload) {
      next();
      return;
    }
    const sessionId = jwtPayload.jti;

    // Check revocation
    const isRevoked = await redis.get(`revoked:${sessionId}`);
    if (isRevoked) {
      next();
      return;
    }

    // Verify session exists — check cache first, then DB
    let sessionValid = false;
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      try {
        const session = JSON.parse(cached) as {
          identityId?: string;
          did?: string;
          tokenHash?: string;
          expiresAt?: string;
        };
        sessionValid =
          session.identityId === jwtPayload.sub &&
          session.did === jwtPayload.did &&
          session.tokenHash === tokenHash &&
          (!session.expiresAt || new Date(session.expiresAt) > new Date());
      } catch {
        sessionValid = false;
      }
    } else {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (
        session &&
        session.identityId === jwtPayload.sub &&
        session.tokenHash === tokenHash &&
        session.expiresAt > new Date()
      ) {
        sessionValid = true;
        const identityData = {
          identityId: session.identityId,
          did: jwtPayload.did,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt.toISOString(),
        };
        await redis.set(
          `session:${sessionId}`,
          JSON.stringify(identityData),
          'EX',
          sessionTtlSeconds(session.expiresAt),
        );
      }
    }

    if (!sessionValid) {
      next();
      return;
    }

    const identity = await prisma.identity.findUnique({
      where: { id: jwtPayload.sub },
      select: { id: true, did: true, publicKey: true, status: true },
    });

    if (identity?.status === 'ACTIVE') {
      req.identity = identity;
      req.sessionId = sessionId;
      req.sessionAuthTime = jwtPayload.iat;
    }
  } catch {
    // Swallow — optional auth
  }

  next();
}

export { verifyDID };
