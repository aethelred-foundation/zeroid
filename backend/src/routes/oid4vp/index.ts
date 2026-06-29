/**
 * ZeroID — OpenID4VP verifier routes (MVP).
 *
 *   POST /api/v1/oid4vp/authorize  -> build a presentation request (DCQL) from a policyId
 *   POST /api/v1/oid4vp/verify     -> verify a vp_token and evaluate the policy
 *
 * Same-device MVP: `/authorize` returns the nonce/state inline. The cross-device
 * flow (request_uri + QR + persisted nonce store + direct_post(.jwt)) is the
 * next increment; the verification core here is shared by both.
 *
 * NOTE: this router is intentionally not yet mounted in src/index.ts (that file
 * has unmerged WIP). Mount with:  app.use('/api/v1/oid4vp', oid4vpRouter)
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'node:crypto';
import type { JWK } from 'jose';
import { logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import { ServiceError, sendServiceError } from '../../services/errors';
import { getPresentationPolicy } from '../../services/oid4vp/policy-presentation';
import { compilePolicyToDcql } from '../../services/oid4vp/dcql';
import {
  verifyPresentation,
  type PresentationVerifierDeps,
} from '../../services/oid4vp/verifier';
import { createJoseSdJwtDeps, type IssuerKeyResolver } from '../../services/oid4vp/sd-jwt-jose';

const AuthorizeSchema = z.object({
  policyId: z.string().min(1).max(256),
  audience: z.string().min(1).max(256),
  relyingAppId: z.string().min(1).max(128).optional(),
});

const VerifySchema = z.object({
  policyId: z.string().min(1).max(256),
  vpToken: z.string().min(1),
  nonce: z.string().min(1).max(256),
  audience: z.string().min(1).max(256),
  relyingAppId: z.string().min(1).max(128).optional(),
});

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
  return { sdJwt: createJoseSdJwtDeps(resolveIssuerKeyFromEnv()) };
}

const router = Router();
router.use(apiRateLimiter, authMiddleware);

router.post(
  '/authorize',
  validate({ body: AuthorizeSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { policyId, relyingAppId } = req.body as z.infer<typeof AuthorizeSchema>;
      const policy = getPresentationPolicy(policyId); // throws POLICY_NOT_FOUND if unknown
      const dcql_query = compilePolicyToDcql(policy);
      res.status(200).json({
        state: randomUUID(),
        nonce: randomBytes(16).toString('base64url'),
        response_mode: 'direct_post',
        response_type: 'vp_token',
        dcql_query,
        policyId: policy.policyId,
        relyingAppId,
        expires_in: 300,
      });
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.post(
  '/verify',
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

export default router;
