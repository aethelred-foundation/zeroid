import { Request, Response, NextFunction } from "express";
import * as jose from "jose";
import { prisma, logger, redis } from "../index";

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
}

interface JWTPayload {
  sub: string; // identity ID
  did: string; // DID identifier
  iat: number;
  exp: number;
  jti: string; // session ID
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------
function loadJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. " +
        "Refusing to start without a cryptographic signing secret.",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET must be at least 32 characters. " +
        "Refusing to start with a weak signing secret.",
    );
  }
  return new TextEncoder().encode(secret);
}

const JWT_SECRET = loadJWTSecret();
const JWT_ISSUER = "zeroid-api";
const JWT_AUDIENCE = "zeroid-client";
const TOKEN_EXPIRY = "24h";

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------
export async function generateToken(
  identityId: string,
  did: string,
): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();

  const token = await new jose.SignJWT({ did } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(identityId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(sessionId)
    .sign(JWT_SECRET);

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
    JSON.stringify({
      identityId,
      did,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    }),
    "EX",
    86400,
  );

  logger.info("token_generated", { identityId, did, sessionId });
  return { token, sessionId };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------
export async function revokeToken(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  await redis.del(`session:${sessionId}`);
  // Add to revocation set for remainder of original TTL
  await redis.set(`revoked:${sessionId}`, "1", "EX", 86400);
  logger.info("token_revoked", { sessionId });
}

// ---------------------------------------------------------------------------
// DID verification
// ---------------------------------------------------------------------------
async function verifyDID(did: string, publicKey: string): Promise<boolean> {
  // Verify DID format: did:aethelred:<identifier>
  const didPattern = /^did:aethelred:[a-zA-Z0-9._-]+$/;
  if (!didPattern.test(did)) {
    logger.warn("invalid_did_format", { did });
    return false;
  }

  // Look up the DID in our registry and verify the public key matches
  const identity = await prisma.identity.findUnique({ where: { did } });
  if (!identity) {
    logger.warn("did_not_found", { did });
    return false;
  }

  if (identity.publicKey !== publicKey) {
    logger.warn("did_public_key_mismatch", { did });
    return false;
  }

  if (identity.status !== "ACTIVE") {
    logger.warn("did_not_active", { did, status: identity.status });
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
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Missing or invalid authorization header",
      code: "AUTH_MISSING_TOKEN",
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const tokenHash = await hashToken(token);

    // Verify JWT signature and claims
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const jwtPayload = payload as unknown as JWTPayload;
    const sessionId = jwtPayload.jti;

    // jti (session ID) is mandatory
    if (!sessionId) {
      res.status(401).json({
        error: "Token missing session identifier",
        code: "AUTH_SESSION_MISSING",
      });
      return;
    }

    // Check revocation
    const isRevoked = await redis.get(`revoked:${sessionId}`);
    if (isRevoked) {
      logger.warn("revoked_token_used", { sessionId, did: jwtPayload.did });
      res
        .status(401)
        .json({ error: "Token has been revoked", code: "AUTH_TOKEN_REVOKED" });
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
          "EX",
          86400,
        );
      }
    }

    if (!sessionValid) {
      logger.warn("session_not_found", { sessionId, sub: jwtPayload.sub });
      res.status(401).json({
        error: "Session not found or expired",
        code: "AUTH_SESSION_INVALID",
      });
      return;
    }

    // Fetch full identity for downstream handlers
    const identity = await prisma.identity.findUnique({
      where: { id: jwtPayload.sub },
      select: { id: true, did: true, publicKey: true, status: true },
    });

    if (!identity || identity.status !== "ACTIVE") {
      res.status(401).json({
        error: "Identity not found or inactive",
        code: "AUTH_IDENTITY_INVALID",
      });
      return;
    }

    req.identity = identity;
    req.sessionId = sessionId;
    next();
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      res
        .status(401)
        .json({ error: "Token has expired", code: "AUTH_TOKEN_EXPIRED" });
      return;
    }
    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      res
        .status(401)
        .json({ error: "Invalid token claims", code: "AUTH_CLAIMS_INVALID" });
      return;
    }

    logger.error("auth_error", { error: (err as Error).message });
    res
      .status(401)
      .json({ error: "Authentication failed", code: "AUTH_FAILED" });
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
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  try {
    const token = authHeader.slice(7);
    const tokenHash = await hashToken(token);
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const jwtPayload = payload as unknown as JWTPayload;
    const sessionId = jwtPayload.jti;

    // Skip if no session ID
    if (!sessionId) {
      next();
      return;
    }

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
          "EX",
          86400,
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

    if (identity?.status === "ACTIVE") {
      req.identity = identity;
      req.sessionId = sessionId;
    }
  } catch {
    // Swallow — optional auth
  }

  next();
}

export { verifyDID };
