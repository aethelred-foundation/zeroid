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
  poolAgentScan,
  initiateWalletDisclosure,
  getPartnerEvidence,
  type PartnerDeps,
} from '../../services/partners/partner-service';
import { invokeEligibility } from '../../services/eligibility-invoker';
import {
  agentEligibilityProof,
  AgentEligibilityError,
} from '../../services/ai/agent-eligibility';
import { buildAgentEligibilityDeps } from '../ai/agent-eligibility';
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

function buildPartnerDeps(): PartnerDeps {
  return {
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
    async runAgentScan(req) {
      const controller = await prisma.identity.findUnique({
        where: { did: req.controllerDid },
        select: { id: true, did: true, status: true, publicKey: true },
      });
      if (!controller) {
        throw new AgentEligibilityError('controller not found', 'CONTROLLER_MISMATCH', 403);
      }
      return agentEligibilityProof(
        buildAgentEligibilityDeps(
          controller as NonNullable<AuthenticatedRequest['identity']>,
        ),
        req,
      );
    },
    async recordDisclosureRequest({ decisionId, warrantHash }) {
      // Deterministic escrow id binding the decision to the warrant; the on-chain
      // quorum (ConditionalDisclosure.sol) and key-split reconstitution act on it.
      return (
        '0x' +
        createHash('sha256').update(`${decisionId}:${warrantHash}`).digest('hex')
      );
    },
    async getEvidence(decisionId) {
      const entry = await prisma.auditLog.findFirst({
        where: { resourceId: decisionId },
        orderBy: { timestamp: 'desc' },
      });
      return entry?.details ?? null;
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
  const store = createPrismaIdempotencyStore<T>(prisma, scope);
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
      const result = await runIdempotent(req, 'partner.wallet.eligibility', () =>
        walletEligibility(buildPartnerDeps(), req.body),
      );
      res.status(200).json(result);
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
        initiateWalletDisclosure(buildPartnerDeps(), req.body),
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
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.status(200).json(
        await getPartnerEvidence(buildPartnerDeps(), String(req.params.decisionId)),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  '/cruzible/pools/:poolId/eligibility',
  validate({ params: PoolParamsSchema, body: PoolEligibilitySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await runIdempotent(req, 'partner.cruzible.pool.eligibility', () =>
        poolEligibility(buildPartnerDeps(), { poolId: req.params.poolId, ...req.body }),
      );
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  '/cruzible/pools/:poolId/agent-scan',
  validate({ params: PoolParamsSchema, body: PoolAgentScanSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await runIdempotent(req, 'partner.cruzible.pool.agent-scan', () =>
        poolAgentScan(buildPartnerDeps(), { poolId: req.params.poolId, ...req.body }),
      );
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
