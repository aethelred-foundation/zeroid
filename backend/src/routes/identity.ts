import { randomBytes } from "crypto";
import { Router, Request, Response } from "express";
import { identityService } from "../services/identity";
import { governmentAPIService } from "../services/government-api";
import { teeService } from "../services/tee";
import {
  authMiddleware,
  AuthenticatedRequest,
  optionalAuthMiddleware,
} from "../middleware/auth";
import {
  validate,
  registerIdentitySchema,
} from "../middleware/validation";
import { apiRateLimiter, authRateLimiter } from "../middleware/rateLimit";
import { logger, prisma, redis } from "../runtime";
import { asRouteError, sendRouteError } from "../utils/route-error";
import { z } from "zod";

const router = Router();
router.use(apiRateLimiter);

const UAE_PASS_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const UAE_PASS_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const UAE_PASS_STATE_IDENTITY_ID_MAX_LENGTH = 128;
const UAE_PASS_REDIRECT_URI_MAX_LENGTH = 2048;

interface UAEPassOAuthState {
  identityId: string;
  redirectUri: string;
  issuedAt: string;
}

function uaePassStateKey(state: string): string {
  return `gov:uaepass:oauth:state:${state}`;
}

function parseUAEPassOAuthState(raw: string | null): UAEPassOAuthState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<UAEPassOAuthState>;
    if (
      !isBoundedNonEmptyString(
        parsed.identityId,
        UAE_PASS_STATE_IDENTITY_ID_MAX_LENGTH,
      ) ||
      !isSafeOAuthRedirectUri(parsed.redirectUri) ||
      typeof parsed.issuedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.issuedAt))
    ) {
      return null;
    }

    return {
      identityId: parsed.identityId,
      redirectUri: parsed.redirectUri,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function isBoundedNonEmptyString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isSafeOAuthRedirectUri(value: unknown): value is string {
  if (!isBoundedNonEmptyString(value, UAE_PASS_REDIRECT_URI_MAX_LENGTH)) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/identity/register — Register a new identity
// ---------------------------------------------------------------------------
router.post(
  "/register",
  authRateLimiter,
  validate({ body: registerIdentitySchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        did,
        controller,
        publicKey,
        recoveryHash,
        signature,
        displayName,
        metadata,
      } = req.body;

      const result = await identityService.register({
        did,
        controller,
        publicKey,
        recoveryHash,
        signature,
        displayName,
        metadata,
      });

      res.status(201).json({
        data: {
          identity: result.identity,
          token: result.token,
          sessionId: result.sessionId,
        },
        message: "Identity registered successfully",
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error("identity_register_error", { error: error.message });
      sendRouteError(res, error, "IDENTITY_REGISTER_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/me — Get current identity profile
// ---------------------------------------------------------------------------
router.get(
  "/me",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = await identityService.getIdentity(req.identity!.id);
      if (!identity) {
        res
          .status(404)
          .json({ error: "Identity not found", code: "IDENTITY_NOT_FOUND" });
        return;
      }

      // Fetch government verification status
      const govStatus = await governmentAPIService.getVerificationStatus(
        req.identity!.id,
      );
      const teeAttested = await getCurrentTeeAttestationStatus(identity.id);

      res.json({
        data: {
          ...identity,
          teeAttested,
          teeAttestation: teeAttested ? { verified: true } : null,
          governmentVerification: govStatus
            ? {
                verified: govStatus.verified,
                provider: govStatus.provider,
                expiresAt: govStatus.expiresAt,
              }
            : null,
        },
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "IDENTITY_PROFILE_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/identity/government/uae-pass/start — Start UAE Pass OAuth
// ---------------------------------------------------------------------------
const uaePassStartSchema = z.object({
  redirectUri: z
    .string()
    .url()
    .max(2048)
    .refine(
      isSafeOAuthRedirectUri,
      "UAE Pass redirect URI must be HTTP(S), credential-free, and fragment-free",
    ),
});

router.post(
  "/government/uae-pass/start",
  authMiddleware,
  authRateLimiter,
  validate({ body: uaePassStartSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const redirectUri = req.body.redirectUri as string;
      const state = randomBytes(32).toString("base64url");
      const authUrl = governmentAPIService.getUAEPassAuthUrl(
        redirectUri,
        state,
      );

      const stateRecord: UAEPassOAuthState = {
        identityId: req.identity!.id,
        redirectUri,
        issuedAt: new Date().toISOString(),
      };

      await redis.set(
        uaePassStateKey(state),
        JSON.stringify(stateRecord),
        "EX",
        UAE_PASS_OAUTH_STATE_TTL_SECONDS,
      );

      res.status(201).json({
        data: {
          authUrl,
          state,
          expiresInSeconds: UAE_PASS_OAUTH_STATE_TTL_SECONDS,
        },
        message: "UAE Pass authorization started",
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "UAE_PASS_AUTH_START_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/identity/government/uae-pass/callback — Complete UAE Pass OAuth
// ---------------------------------------------------------------------------
const uaePassCallbackSchema = z
  .object({
    authorizationCode: z.string().min(8).max(4096).optional(),
    code: z.string().min(8).max(4096).optional(),
    state: z
      .string()
      .regex(UAE_PASS_OAUTH_STATE_PATTERN, "Invalid UAE Pass state"),
  })
  .refine((body) => body.authorizationCode || body.code, {
    message: "authorizationCode or code is required",
  });

router.post(
  "/government/uae-pass/callback",
  authMiddleware,
  authRateLimiter,
  validate({ body: uaePassCallbackSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const state = req.body.state as string;
      const stateKey = uaePassStateKey(state);
      const stateRecord = parseUAEPassOAuthState(await redis.get(stateKey));

      if (!stateRecord) {
        res.status(400).json({
          error: "UAE Pass authorization state is expired or invalid",
          code: "UAE_PASS_STATE_INVALID",
        });
        return;
      }

      if (stateRecord.identityId !== req.identity!.id) {
        logger.warn("uaepass_state_identity_mismatch", {
          stateIdentityId: stateRecord.identityId,
          requestIdentityId: req.identity!.id,
        });
        res.status(403).json({
          error:
            "UAE Pass authorization state does not belong to this identity",
          code: "UAE_PASS_STATE_FORBIDDEN",
        });
        return;
      }

      await redis.del(stateKey);
      const result = await governmentAPIService.authenticateWithUAEPass({
        authorizationCode: (req.body.authorizationCode ??
          req.body.code) as string,
        redirectUri: stateRecord.redirectUri,
        identityId: req.identity!.id,
      });

      res.json({
        data: result,
        message: "UAE Pass verification completed",
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "UAE_PASS_AUTH_CALLBACK_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/government/status — Current government verification
// ---------------------------------------------------------------------------
router.get(
  "/government/status",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const result = await governmentAPIService.getVerificationStatus(
        req.identity!.id,
      );
      res.json({
        data: result
          ? {
              verified: result.verified,
              provider: result.provider,
              referenceId: result.referenceId,
              verifiedFields: result.verifiedFields,
              verifiedAt: result.verifiedAt,
              expiresAt: result.expiresAt,
            }
          : null,
        message: result
          ? "Government verification status found"
          : "Government verification status not found",
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "GOVERNMENT_STATUS_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/address/:address — Resolve deterministic address DID
// ---------------------------------------------------------------------------
const addressParamsSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address"),
});

router.get(
  "/address/:address",
  optionalAuthMiddleware,
  validate({ params: addressParamsSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const controller = (req.params.address as string).toLowerCase();
      const candidateDids = ["mainnet", "testnet", "devnet"].map(
        (network) => `did:aethelred:${network}:${controller}`,
      );

      const identity = await prisma.identity.findFirst({
        where: { did: { in: candidateDids } },
        select: {
          id: true,
          did: true,
          publicKey: true,
          status: true,
          teeAttestationId: true,
          createdAt: true,
          updatedAt: true,
          displayName: true,
          _count: {
            select: {
              credentials: true,
              verificationsSubject: true,
            },
          },
        },
      });

      if (!identity) {
        res.status(404).json({
          error: "Identity not found for address",
          code: "IDENTITY_ADDRESS_NOT_FOUND",
        });
        return;
      }

      const [teeAttested, govStatus] = await Promise.all([
        identity.teeAttestationId
          ? teeService.isAttestationValid(identity.teeAttestationId)
          : Promise.resolve(false),
        governmentAPIService.getVerificationStatus(identity.id),
      ]);
      const governmentVerified = govStatus?.verified === true;

      res.json({
        data: {
          did: identity.did,
          controller,
          publicKey: identity.publicKey,
          status: identity.status,
          displayName: identity.displayName,
          credentialCount: identity._count.credentials,
          verificationCount: identity._count.verificationsSubject,
          teeAttested,
          governmentVerified,
          verificationEvidence: {
            tee: teeAttested ? { verified: true } : null,
            government: governmentVerified
              ? {
                  verified: true,
                  provider: govStatus.provider,
                  expiresAt: govStatus.expiresAt,
                }
              : null,
          },
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        },
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "IDENTITY_ADDRESS_RESOLVE_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/resolve/:did — Resolve a DID to public info
// ---------------------------------------------------------------------------
router.get(
  "/resolve/:did",
  optionalAuthMiddleware,
  validate({ params: z.object({ did: z.string().min(1) }) }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const did = decodeURIComponent(req.params.did as string);
      const identity = await prisma.identity.findUnique({
        where: { did },
        select: {
          id: true,
          did: true,
          publicKey: true,
          status: true,
          teeAttestationId: true,
          createdAt: true,
        },
      });

      if (!identity) {
        res.status(404).json({ error: "DID not found", code: "DID_NOT_FOUND" });
        return;
      }

      const [teeAttested, govStatus] = await Promise.all([
        identity.teeAttestationId
          ? teeService.isAttestationValid(identity.teeAttestationId)
          : Promise.resolve(false),
        governmentAPIService.getVerificationStatus(identity.id),
      ]);
      const governmentVerified = govStatus?.verified === true;

      // Public resolution: return limited fields
      res.json({
        data: {
          did: identity.did,
          publicKey: identity.publicKey,
          status: identity.status,
          teeAttested,
          governmentVerified,
          verificationEvidence: {
            tee: teeAttested ? { verified: true } : null,
            government: governmentVerified
              ? {
                  verified: true,
                  provider: govStatus.provider,
                  expiresAt: govStatus.expiresAt,
                }
              : null,
          },
          createdAt: identity.createdAt,
        },
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "DID_RESOLVE_FAILED");
    }
  },
);

async function getCurrentTeeAttestationStatus(
  identityId: string,
): Promise<boolean> {
  const identity = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { teeAttestationId: true },
  });
  return identity?.teeAttestationId
    ? teeService.isAttestationValid(identity.teeAttestationId)
    : false;
}

// ---------------------------------------------------------------------------
// POST /api/v1/identity/logout — Revoke current session
// ---------------------------------------------------------------------------
router.post(
  "/logout",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (req.sessionId) {
        await identityService.logout(req.identity!.id, req.sessionId);
      }
      res.json({ message: "Logged out successfully" });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "LOGOUT_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/v1/identity/me — Update own identity
// ---------------------------------------------------------------------------
const updateSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => data.displayName !== undefined || data.metadata !== undefined,
    {
      message: "At least one field must be provided",
    },
  );

router.patch(
  "/me",
  authMiddleware,
  validate({ body: updateSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = await identityService.updateIdentity(req.identity!.id, {
        displayName: req.body.displayName,
        metadata: req.body.metadata,
      });

      res.json({ data: identity, message: "Identity updated successfully" });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "IDENTITY_UPDATE_FAILED");
    }
  },
);

export { router as identityRoutes };
