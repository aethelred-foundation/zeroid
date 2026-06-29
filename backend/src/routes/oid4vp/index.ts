/**
 * ZeroID — OpenID4VP verifier routes.
 *
 * Same-device / B2B:
 *   POST /api/v1/oid4vp/verify             -> verify a vp_token, evaluate the policy (stateless)
 * Cross-device (request_uri + direct_post):
 *   POST /api/v1/oid4vp/authorize          -> persist a request (state + one-time nonce); return request_uri + DCQL
 *   GET  /api/v1/oid4vp/request/:state      -> the Authorization Request the Wallet fetches
 *   POST /api/v1/oid4vp/callback            -> Wallet posts {vp_token, state}; verify + store decision
 *   GET  /api/v1/oid4vp/result/:state       -> initiating device polls for the decision
 *
 * `/authorize` + `/verify` are relying-party operations (authenticated);
 * `/request`, `/callback`, `/result` are Wallet-facing (public, opaque-state).
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { JWK } from 'jose';
import { prisma, logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import { ServiceError, sendServiceError } from '../../services/errors';
import { verifyPresentation, type PresentationVerifierDeps } from '../../services/oid4vp/verifier';
import { createJoseSdJwtDeps, type IssuerKeyResolver } from '../../services/oid4vp/sd-jwt-jose';
import { createJoseZkDeps } from '../../services/oid4vp/zk-predicate-jose';
import { createZkProofServiceVerifier } from '../../services/oid4vp/zk-proofservice-verifier';
import { zkProofService } from '../../services/zkproof';

/** ZK eligibility deps backed by the real backend Groth16 verifier (ZKProofService). */
function buildZkDeps() {
  return createJoseZkDeps({ verifyGroth16: createZkProofServiceVerifier(zkProofService) });
}
import {
  createPresentationRequest,
  getRequestObject,
  handleCallback,
  getResult,
  type CrossDeviceDeps,
} from '../../services/oid4vp/cross-device';
import { createPrismaOid4vpRequestStore } from '../../services/oid4vp/request-store-prisma';
import { createPrismaPresentationAuditRecorder } from '../../services/oid4vp/presentation-audit';

const BASE_URL = process.env.OID4VP_BASE_URL ?? 'https://verifier.zeroid';

const AuthorizeSchema = z.object({
  policyId: z.string().min(1).max(256),
  audience: z.string().min(1).max(256),
});
const VerifySchema = z.object({
  policyId: z.string().min(1).max(256),
  vpToken: z.string().min(1),
  nonce: z.string().min(1).max(256),
  audience: z.string().min(1).max(256),
  relyingAppId: z.string().min(1).max(128).optional(),
});
const CallbackSchema = z.object({
  state: z.string().min(1).max(256),
  vp_token: z.string().min(1),
});
const StateParamsSchema = z.object({ state: z.string().min(1).max(256) });

/** Resolve issuer keys from env (the issuer-trust-registry integration point). */
function resolveIssuerKeyFromEnv(): IssuerKeyResolver {
  return async (header) => {
    const raw = process.env.OID4VP_ISSUER_JWKS;
    if (!raw) {
      throw new ServiceError('issuer key not configured (OID4VP_ISSUER_JWKS)', 'VP_TOKEN_INVALID', 401);
    }
    let store: Record<string, JWK> | JWK;
    try {
      store = JSON.parse(raw);
    } catch {
      throw new ServiceError('invalid OID4VP_ISSUER_JWKS', 'VP_TOKEN_INVALID', 401);
    }
    const kid = typeof header.kid === 'string' ? header.kid : undefined;
    const jwk =
      kid && typeof store === 'object' && kid in store
        ? (store as Record<string, JWK>)[kid]
        : (store as JWK);
    if (!jwk || typeof jwk !== 'object') {
      throw new ServiceError('no issuer key for credential', 'VP_TOKEN_INVALID', 401);
    }
    return jwk;
  };
}

export function buildVerifierDeps(): PresentationVerifierDeps {
  return { sdJwt: createJoseSdJwtDeps(resolveIssuerKeyFromEnv()), zk: buildZkDeps(), recordDecision: createPrismaPresentationAuditRecorder(prisma) };
}

function buildCrossDeviceDeps(): CrossDeviceDeps {
  return {
    store: createPrismaOid4vpRequestStore(prisma),
    verifier: { sdJwt: createJoseSdJwtDeps(resolveIssuerKeyFromEnv()), zk: buildZkDeps(), recordDecision: createPrismaPresentationAuditRecorder(prisma) },
    genId: () => randomBytes(24).toString('base64url'),
    now: () => Math.floor(Date.now() / 1000),
    baseUrl: BASE_URL,
  };
}

const router = Router();
router.use(apiRateLimiter);

// ── Relying-party operations (authenticated) ────────────────────────────────

router.post(
  '/authorize',
  authMiddleware,
  validate({ body: AuthorizeSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await createPresentationRequest(buildCrossDeviceDeps(), req.body);
      res.status(201).json(result);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.post(
  '/verify',
  authMiddleware,
  validate({ body: VerifySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const decision = await verifyPresentation(buildVerifierDeps(), req.body);
      res.status(200).json(decision);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

// ── Wallet-facing (public, opaque-state) ────────────────────────────────────

router.get(
  '/request/:state',
  validate({ params: StateParamsSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestObject = await getRequestObject(buildCrossDeviceDeps(), String(req.params.state));
      res.status(200).json(requestObject);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.post(
  '/callback',
  validate({ body: CallbackSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof CallbackSchema>;
      await handleCallback(buildCrossDeviceDeps(), { state: body.state, vpToken: body.vp_token });
      // direct_post: acknowledge receipt; the result is fetched via /result/:state.
      res.status(200).json({ received: true });
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.get(
  '/result/:state',
  validate({ params: StateParamsSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await getResult(buildCrossDeviceDeps(), String(req.params.state));
      res.status(200).json(result);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

export default router;
