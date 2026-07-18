/**
 * ZeroID — OpenID4VCI issuer routes (Pre-Authorized-Code flow, MVP).
 *
 *   GET  /api/v1/oid4vci/.well-known/openid-credential-issuer  -> issuer metadata
 *   POST /api/v1/oid4vci/credential-offer  (auth)  -> mint a Credential Offer
 *   POST /api/v1/oid4vci/token                     -> pre-auth code -> access_token + c_nonce
 *   POST /api/v1/oid4vci/credential   (Bearer)     -> key proof -> SD-JWT VC
 *
 * Mounted by src/index.ts at /api/v1/oid4vci. Claim sourcing remains
 * intentionally fail-closed until authoritative per-configuration sources are
 * wired; signing uses OID4VCI_ISSUER_JWK and stores use Prisma.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma, logger } from '../../runtime';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import { ServiceError, sendServiceError } from '../../services/errors';
import {
  buildIssuerMetadata,
  createCredentialOffer,
  redeemPreAuthorizedCode,
  issueCredential,
  type IssuanceDeps,
} from '../../services/oid4vci/issuance';
import { createPrismaIssuanceStores } from '../../services/oid4vci/issuance-stores-prisma';
import { createPrismaIssuanceAuditRecorder } from '../../services/oid4vci/issuance-audit';
import { createJoseKeyProofVerifier } from '../../services/oid4vci/jose';
import { createIssuerSignDepsFromEnv } from '../../services/oid4vci/issuer-key';
import type { SdJwtIssueDeps } from '../../services/oid4vci/sd-jwt-issuer';

const ISSUER = process.env.OID4VCI_ISSUER ?? 'https://issuer.zeroid';

let stores: IssuanceDeps['stores'] | null = null;
function getStores(): IssuanceDeps['stores'] {
  if (!stores) stores = createPrismaIssuanceStores(prisma, process.env);
  return stores;
}

// Fail-closed issuer key (audit F1): in production a missing/unusable
// OID4VCI_ISSUER_JWK throws 503 — never an ephemeral key. Dev keeps the
// ephemeral fallback (with a warning). See services/oid4vci/issuer-key.ts.
let signDepsPromise: Promise<SdJwtIssueDeps> | null = null;
function getSignDeps(): Promise<SdJwtIssueDeps> {
  if (!signDepsPromise) {
    signDepsPromise = createIssuerSignDepsFromEnv(process.env, logger).catch((error) => {
      signDepsPromise = null; // don't cache the failure
      throw error;
    });
  }
  return signDepsPromise;
}

async function buildDeps(): Promise<IssuanceDeps> {
  return {
    issuer: ISSUER,
    stores: getStores(),
    sourceClaims: async () => {
      // Do not synthesize eligibility from arbitrary Credential.claims. The
      // configuration contract does not yet identify trusted source credential
      // types, freshness limits, or claim transformations, and Identity has no
      // authoritative residence attribute. Until that contract exists,
      // issuance remains explicitly disabled.
      throw new ServiceError(
        'claim sourcing not configured (wire to identity/credential services)',
        'unsupported_credential_type',
        501,
      );
    },
    sign: await getSignDeps(),
    verifyKeyProof: createJoseKeyProofVerifier(),
    recordIssuance: createPrismaIssuanceAuditRecorder(prisma),
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
      const identity = req.identity;
      if (!identity) {
        throw new ServiceError('Authentication required', 'AUTH_REQUIRED', 401);
      }
      const body = req.body as z.infer<typeof OfferSchema>;
      if (body.subjectDid !== identity.did) {
        throw new ServiceError(
          'Credential offer subject must match the authenticated identity',
          'OID4VCI_SUBJECT_MISMATCH',
          403,
        );
      }

      const { offer, preAuthorizedCode } = await createCredentialOffer(
        await buildDeps(),
        { ...body, subjectDid: identity.did },
      );
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
