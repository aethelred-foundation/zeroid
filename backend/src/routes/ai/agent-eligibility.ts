/**
 * ZeroID — AI Agent Passport v1: agent eligibility route.
 *
 * POST /api/v1/ai/agents/eligibility/proof — reserved for a future
 * challenge-authenticated agent eligibility flow. It currently fails closed;
 * a human bearer session plus database credential state is not sufficient to
 * authenticate an agent operation or issue a ZK eligibility decision.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma, logger } from '../../runtime';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import {
  agentEligibilityUnavailableError,
  AgentEligibilityError,
  type AgentEligibilityDeps,
  type AgentEligibilityProofResponse,
} from '../../services/ai/agent-eligibility';
import type { IdempotencyStore } from '../../services/idempotency';
import { sendServiceError } from '../../services/errors';
import type {
  AgentStatus,
  CredentialStatus,
  RiskTier,
} from '../../services/ai/agent-passport';

const AgentEligibilityProofSchema = z
  .object({
    agentDid: z.string().min(1).max(256),
    controllerDid: z.string().min(1).max(256),
    subjectDid: z.string().min(1).max(256),
    credentialId: z.string().min(1).max(128),
    policyId: z.string().min(1).max(256),
    relyingAppId: z.string().min(1).max(128),
    contextNonce: z.string().min(8).max(128),
  })
  .strict();

/** Wire the service's injected dependencies to real Prisma + eligibility. */
export function buildAgentEligibilityDeps(
  _controllerIdentity: NonNullable<AuthenticatedRequest['identity']>,
  idempotencyStore?: IdempotencyStore<AgentEligibilityProofResponse>,
): AgentEligibilityDeps {
  return {
    idempotencyStore,
    async loadAgent(agentDid) {
      const agent = await prisma.aIAgent.findUnique({
        where: { agentDid },
        include: {
          operator: { select: { did: true } },
          agentCredentials: {
            where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
            orderBy: { issuedAt: 'desc' },
            take: 1,
          },
        },
      });
      if (!agent) return null;
      const cred = agent.agentCredentials[0];
      return {
        agentDid: agent.agentDid,
        controllerDid: agent.controllerDid ?? agent.operator.did,
        agentStatus: agent.status as AgentStatus,
        credentialStatus: (cred?.status ?? 'REVOKED') as CredentialStatus,
        scopes: cred?.scopes ?? [],
        agentMaxRiskTier: (cred?.maxRiskTier ?? agent.riskTier) as RiskTier,
      };
    },

    async loadController(controllerDid) {
      const identity = await prisma.identity.findUnique({
        where: { did: controllerDid },
      });
      if (!identity) return null;
      const riskAssessment = await prisma.riskAssessment.findFirst({
        where: { entityId: identity.id, entityType: 'identity' },
        orderBy: { assessedAt: 'desc' },
        select: { level: true },
      });
      if (!riskAssessment) {
        throw new AgentEligibilityError(
          'controller risk assessment is required',
          'CONTROLLER_RISK_ASSESSMENT_REQUIRED',
          503,
        );
      }
      return {
        controllerStatus: identity.status as string,
        controllerKycValid: identity.governmentVerified,
        controllerRiskTier: riskAssessment.level as RiskTier,
      };
    },

    async runEligibility(_input) {
      throw agentEligibilityUnavailableError();
    },

    async recordAgentAction(action) {
      const agent = await prisma.aIAgent.findUnique({
        where: { agentDid: action.agentDid },
        select: { id: true },
      });
      if (!agent) {
        throw new AgentEligibilityError(
          'agent not found',
          'AGENT_NOT_FOUND',
          404,
        );
      }
      const created = await prisma.agentAction.create({
        data: {
          agentId: agent.id,
          actionType: action.actionType,
          targetResource: action.resourceId,
          controllerDid: action.controllerDid,
          policyId: action.policyId,
          decision: action.status,
        },
      });
      return created.id;
    },
  };
}

const router = Router();

router.post(
  '/eligibility/proof',
  apiRateLimiter,
  authMiddleware,
  validate({ body: AgentEligibilityProofSchema }),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      throw agentEligibilityUnavailableError();
    } catch (error) {
      sendServiceError(res, error, logger);
    }
  },
);

export default router;
