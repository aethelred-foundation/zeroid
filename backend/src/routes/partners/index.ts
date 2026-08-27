/**
 * ZeroID — Partner integration routes (Wallet, Cruzible).
 *
 * Thin HTTP surface over the partner orchestrators (which reuse the human
 * eligibility handler, the AI Agent Passport, and conditional disclosure).
 * The service holds the (unit-tested) logic; this route wires real deps and
 * maps errors to HTTP status codes.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma, logger } from '../../runtime';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import {
  walletEligibility,
  poolEligibility,
  initiateWalletDisclosure,
  partnerEligibilityChallengeUnavailableError,
  partnerEligibilityEvidenceUnavailableError,
  type PartnerDeps,
} from '../../services/partners/partner-service';
import { invokeEligibility } from '../../services/eligibility-invoker';
import { agentEligibilityUnavailableError } from '../../services/ai/agent-eligibility';
import {
  createPrismaIdempotencyStore,
  readIdempotencyKey,
  withIdempotency,
} from '../../services/idempotency';
import { sendServiceError } from '../../services/errors';

// ── Validation schemas ────────────────────────────────────────────────────

const did = z.string().min(1).max(256);
const id = z.string().min(1).max(128);

const WalletEligibilitySchema = z.object({
  ownerDid: did,
  credentialId: id,
  policyId: id,
  relyingAppId: id,
});

const WalletDisclosureSchema = z.object({
  decisionId: id,
  warrantHash: z.string().min(1).max(256),
});

const PoolEligibilitySchema = z.object({
  stakerDid: did,
  credentialId: id,
  policyId: id,
  relyingAppId: id,
});

const PoolAgentScanSchema = z.object({
  agentDid: did,
  controllerDid: did,
  subjectDid: did,
  credentialId: id,
  policyId: id,
  relyingAppId: id,
});

const PoolParamsSchema = z.object({ poolId: z.string().min(1).max(128) });
const EvidenceParamsSchema = z.object({ decisionId: id });

// ── Real dependency wiring ─────────────────────────────────────────────────

function buildPartnerDeps(
  principal: NonNullable<AuthenticatedRequest['identity']>,
): PartnerDeps {
  return {
    principal: { id: principal.id, did: principal.did },
    async resolveIdentity(didStr) {
      const identity = await prisma.identity.findUnique({
        where: { did: didStr },
        select: { id: true, did: true },
      });
      return identity ?? null;
    },
    runEligibility(identity, input) {
      return invokeEligibility(identity, input);
    },
  };
}

/**
 * Run a partner write idempotently: read/validate the optional `Idempotency-Key`
 * header, then memoize the terminal response under an operation-scoped key so a
 * client retry returns the prior result instead of repeating the side effect.
 * With no header it simply runs the work (idempotency is opt-in).
 */
function runIdempotent<T>(
  req: AuthenticatedRequest,
  scope: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = readIdempotencyKey(req.headers['idempotency-key']);
  const principalId = req.identity?.id;
  if (!principalId) {
    return Promise.reject(
      new Error('authenticated principal is required for idempotent writes'),
    );
  }
  const requestDigest = createHash('sha256')
    .update(
      JSON.stringify({
        method: req.method,
        path: req.baseUrl + req.path,
        params: req.params,
        body: req.body,
      }),
    )
    .digest('hex');
  const store = createPrismaIdempotencyStore<T>(
    prisma,
    `${scope}:${principalId}:${requestDigest}`,
  );
  return withIdempotency(store, key, work);
}

/** Unified error→HTTP mapping (shared taxonomy); `logger` captures 500s only. */
function sendError(res: Response, error: unknown): void {
  sendServiceError(res, error, logger);
}

// ── Routes ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(apiRateLimiter, authMiddleware);

router.post(
  '/wallet/eligibility',
  validate({ body: WalletEligibilitySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await walletEligibility(buildPartnerDeps(req.identity!), req.body);
      sendError(res, partnerEligibilityChallengeUnavailableError());
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  '/wallet/disclosure',
  validate({ body: WalletDisclosureSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await runIdempotent(req, 'partner.wallet.disclosure', () =>
        initiateWalletDisclosure(buildPartnerDeps(req.identity!), req.body),
      );
      res.status(202).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.get(
  '/wallet/evidence/:decisionId',
  validate({ params: EvidenceParamsSchema }),
  (_req: AuthenticatedRequest, res: Response) => {
    sendError(res, partnerEligibilityEvidenceUnavailableError());
  },
);

router.post(
  '/cruzible/pools/:poolId/eligibility',
  validate({ params: PoolParamsSchema, body: PoolEligibilitySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await poolEligibility(buildPartnerDeps(req.identity!), {
        poolId: req.params.poolId,
        ...req.body,
      });
      sendError(res, partnerEligibilityChallengeUnavailableError());
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  '/cruzible/pools/:poolId/agent-scan',
  validate({ params: PoolParamsSchema, body: PoolAgentScanSchema }),
  (_req: AuthenticatedRequest, res: Response) => {
    sendError(res, agentEligibilityUnavailableError());
  },
);

export default router;
