/**
 * ZeroID — AI Agent Passport v1: agent eligibility route.
 *
 * POST /api/v1/ai/agents/eligibility/proof — an AI agent requests an
 * eligibility proof on behalf of its controller. Scope + policy checks and the
 * AgentAction audit live in the (unit-tested) service; this route wires real
 * Prisma + the eligibility delegation and maps errors to HTTP status codes.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma, logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import {
  agentEligibilityProof,
  AgentEligibilityError,
  type AgentEligibilityDeps,
  type EligibilityResult,
} from '../../services/ai/agent-eligibility';
import type {
  AgentStatus,
  CredentialStatus,
  RiskTier,
} from '../../services/ai/agent-passport';
import { eligibilityProofHandler } from '../verification';

const AgentEligibilityProofSchema = z.object({
  agentDid: z.string().min(1),
  controllerDid: z.string().min(1),
  subjectDid: z.string().min(1),
  credentialId: z.string().min(1),
  policyId: z.string().min(1),
  relyingAppId: z.string().min(1),
  contextNonce: z.string().optional(),
});

/** Wire the service's injected dependencies to real Prisma + eligibility. */
export function buildAgentEligibilityDeps(
  controllerIdentity: NonNullable<AuthenticatedRequest['identity']>,
): AgentEligibilityDeps {
  return {
    async loadAgent(agentDid) {
      const agent = await prisma.aIAgent.findUnique({
        where: { agentDid },
        include: {
          operator: { select: { did: true } },
          agentCredentials: {
            where: { status: 'ACTIVE' },
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
      const identity = await prisma.identity.findUnique({ where: { did: controllerDid } });
      if (!identity) return null;
      return {
        controllerStatus: identity.status as string,
        controllerKycValid: identity.governmentVerified,
        // TODO(v1): derive from RiskAssessment; LOW is the conservative default.
        controllerRiskTier: 'LOW' as RiskTier,
      };
    },

    async runEligibility(input) {
      // Reuse the EXACT human eligibility handler (no re-implementation) via an
      // in-process response shim. `eligibilityProofHandler` is the extracted,
      // behaviour-identical handler from routes/verification.ts.
      const fakeReq = {
        identity: controllerIdentity,
        body: {
          subjectDid: input.subjectDid,
          credentialId: input.credentialId,
          policyId: input.policyId,
          relyingAppId: input.relyingAppId,
          contextNonce:
            input.contextNonce ??
            `agent-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        },
      } as unknown as AuthenticatedRequest;

      let httpStatus = 200;
      let payload:
        | { data?: EligibilityResult; error?: string; code?: string }
        | undefined;
      const fakeRes = {
        status(code: number) {
          httpStatus = code;
          return fakeRes;
        },
        json(value: unknown) {
          payload = value as typeof payload;
          return fakeRes;
        },
      } as unknown as Response;

      await eligibilityProofHandler(fakeReq, fakeRes);

      if (httpStatus !== 201 || !payload?.data) {
        throw new AgentEligibilityError(
          payload?.error ?? 'eligibility evaluation failed',
          payload?.code ?? 'ELIGIBILITY_FAILED',
          httpStatus >= 400 ? httpStatus : 502,
        );
      }
      return payload.data;
    },

    async recordAgentAction(action) {
      const agent = await prisma.aIAgent.findUnique({
        where: { agentDid: action.agentDid },
        select: { id: true },
      });
      if (!agent) {
        throw new AgentEligibilityError('agent not found', 'AGENT_NOT_FOUND', 404);
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
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await agentEligibilityProof(
        buildAgentEligibilityDeps(req.identity!),
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AgentEligibilityError) {
        res.status(error.statusCode).json({ error: error.code, message: error.message });
        return;
      }
      logger.error('agent eligibility proof failed', { error });
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal error' });
    }
  },
);

export default router;
