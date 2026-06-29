/**
 * ZeroID — OpenID4VCI issuer routes (Pre-Authorized-Code flow, MVP).
 *
 *   GET  /api/v1/oid4vci/.well-known/openid-credential-issuer  -> issuer metadata
 *   POST /api/v1/oid4vci/credential-offer  (auth)  -> mint a Credential Offer
 *   POST /api/v1/oid4vci/token                     -> pre-auth code -> access_token + c_nonce
 *   POST /api/v1/oid4vci/credential   (Bearer)     -> key proof -> SD-JWT VC
 *
 * NOTE: not yet mounted in src/index.ts (unmerged WIP). Mount with:
 *   app.use('/api/v1/oid4vci', oid4vciRouter)
 * Integration points (documented): claim sourcing -> identity/credential
 * services; issuer signing key -> OID4VCI_ISSUER_JWK / enterprise-key-signer;
 * stores -> Prisma/Redis for multi-instance (the in-memory store is single-
 * instance/dev only).
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, importJWK, type KeyLike } from 'jose';
import { logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import { ServiceError, sendServiceError } from '../../services/errors';
import {
  buildIssuerMetadata,
  createCredentialOffer,
  redeemPreAuthorizedCode,
  issueCredential,
  createInMemoryIssuanceStores,
  type IssuanceDeps,
} from '../../services/oid4vci/issuance';
import {
  createJoseIssuanceSignDeps,
  createJoseKeyProofVerifier,
} from '../../services/oid4vci/jose';
import type { SdJwtIssueDeps } from '../../services/oid4vci/sd-jwt-issuer';

const ISSUER = process.env.OID4VCI_ISSUER ?? 'https://issuer.zeroid';
const stores = createInMemoryIssuanceStores(); // single-instance/dev; swap for Prisma/Redis

let signDepsPromise: Promise<SdJwtIssueDeps> | null = null;
function getSignDeps(): Promise<SdJwtIssueDeps> {
  if (!signDepsPromise) {
    signDepsPromise = (async () => {
      const raw = process.env.OID4VCI_ISSUER_JWK;
      if (raw) {
        const jwk = JSON.parse(raw);
        const key = (await importJWK(jwk, jwk.alg ?? 'ES256')) as KeyLike;
        return createJoseIssuanceSignDeps({ privateKey: key, kid: jwk.kid });
      }
      const { privateKey } = await generateKeyPair('ES256');
      logger.warn?.('oid4vci: using ephemeral issuer key — set OID4VCI_ISSUER_JWK in production');
      return createJoseIssuanceSignDeps({ privateKey });
    })();
  }
  return signDepsPromise;
}

async function buildDeps(): Promise<IssuanceDeps> {
  return {
    issuer: ISSUER,
    stores,
    sourceClaims: async () => {
      // Integration point: resolve the subject's attributes from the identity /
      // credential / risk services. Until wired, issuance is explicitly disabled.
      throw new ServiceError(
        'claim sourcing not configured (wire to identity/credential services)',
        'unsupported_credential_type',
        501,
      );
    },
    sign: await getSignDeps(),
    verifyKeyProof: createJoseKeyProofVerifier(),
    genId: () => randomBytes(32).toString('base64url'),
    now: () => Math.floor(Date.now() / 1000),
  };
}

const OfferSchema = z.object({
  configId: z.string().min(1).max(128),
  subjectDid: z.string().min(1).max(256),
  txCode: z.string().min(1).max(16).optional(),
});

const TokenSchema = z.object({
  grant_type: z.string().min(1).max(128),
  'pre-authorized_code': z.string().min(1).max(512),
  tx_code: z.string().max(16).optional(),
});

const CredentialSchema = z.object({
  credential_configuration_id: z.string().max(128).optional(),
  proof: z.object({ proof_type: z.literal('jwt'), jwt: z.string().min(1) }),
});

const router = Router();
router.use(apiRateLimiter);

router.get('/.well-known/openid-credential-issuer', (_req, res: Response) => {
  res.status(200).json(buildIssuerMetadata(ISSUER));
});

router.post(
  '/credential-offer',
  authMiddleware,
  validate({ body: OfferSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { offer, preAuthorizedCode } = await createCredentialOffer(await buildDeps(), req.body);
      res.status(201).json({ credential_offer: offer, pre_authorized_code: preAuthorizedCode });
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.post(
  '/token',
  validate({ body: TokenSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof TokenSchema>;
      const token = await redeemPreAuthorizedCode(await buildDeps(), {
        grantType: body.grant_type,
        preAuthorizedCode: body['pre-authorized_code'],
        txCode: body.tx_code,
      });
      res.status(200).json(token);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

router.post(
  '/credential',
  validate({ body: CredentialSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const auth = req.headers.authorization;
      const accessToken = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!accessToken) throw new ServiceError('missing bearer access token', 'invalid_token', 401);
      const body = req.body as z.infer<typeof CredentialSchema>;
      const credential = await issueCredential(await buildDeps(), {
        accessToken,
        proofJwt: body.proof.jwt,
      });
      res.status(200).json(credential);
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

export default router;
