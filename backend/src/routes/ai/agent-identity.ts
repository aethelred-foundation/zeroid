import { Router, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import {
  agentIdentityService,
  AgentIdentityError,
} from '../../services/ai/agent-identity';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const AgentCapabilitySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(5).max(500),
  resourceTypes: z.array(z.string().min(1).max(50)).min(1).max(20),
  actions: z.array(z.string().min(1).max(50)).min(1).max(20),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  requiresApproval: z.boolean(),
  rateLimit: z.object({
    maxPerHour: z.number().int().min(1).max(10000),
    maxPerDay: z.number().int().min(1).max(100000),
  }).optional(),
});

const RegisterAgentSchema = z.object({
  agentName: z.string().min(3).max(100),
  agentDescription: z.string().min(10).max(1000),
  agentProtocol: z.enum([
    'openai_functions', 'anthropic_tool_use', 'google_genai',
    'aethelred_native', 'custom',
  ]),
  capabilities: z.array(AgentCapabilitySchema).min(1).max(50),
  publicKey: z.string().min(32).max(512),
  maxDelegationDepth: z.number().int().min(0).max(5).default(2),
  teeRequired: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

const AgentIdParamsSchema = z.object({
  agentId: z.string().min(1),
});

const UpdateCapabilitiesSchema = z.object({
  capabilities: z.array(AgentCapabilitySchema).min(1).max(50),
});

const DelegationConstraintSchema = z.object({
  type: z.enum([
    'time_bounded', 'action_scoped', 'resource_scoped',
    'rate_limited', 'approval_required',
  ]),
  parameters: z.record(z.unknown()),
});

const CreateDelegationSchema = z.object({
  toAgentId: z.string().min(1),
  capabilities: z.array(z.string().min(1).max(100)).min(1),
  constraints: z.array(DelegationConstraintSchema).max(10).default([]),
  durationHours: z.number().min(0.1).max(8760), // max 1 year
});

const VerifyAgentSchema = z.object({
  challenge: z.string().min(32).max(512),
  signature: z.string().min(64).max(1024),
  requestedCapabilities: z.array(z.string().min(1).max(100)).min(1).max(20),
  context: z.object({
    callerAgentId: z.string().optional(),
    callerProtocol: z.enum([
      'openai_functions', 'anthropic_tool_use', 'google_genai',
      'aethelred_native', 'custom',
    ]).optional(),
    purpose: z.string().min(3).max(500),
    resourceId: z.string().optional(),
  }),
});

const SuspendAgentSchema = z.object({
  reason: z.string().min(5).max(1000),
});

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ApprovalResponseSchema = z.object({
  requestId: z.string().min(1),
  approved: z.boolean(),
  note: z.string().min(1).max(1000),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// All agent identity routes require authentication
router.use(authMiddleware);

// ---------------------------------------------------------------------------
// POST /ai/agents — Register a new AI agent identity
// ---------------------------------------------------------------------------
router.post(
  '/',
  validate({ body: RegisterAgentSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const agent = await agentIdentityService.registerAgent({
        operatorId: req.identity.id,
        ...req.body,
      });

      res.status(201).json({
        success: true,
        data: {
          agentId: agent.agentId,
          did: agent.did,
          agentName: agent.agentName,
          status: agent.status,
          protocol: agent.agentProtocol,
          capabilities: agent.capabilities.map((c) => ({
            name: c.name,
            riskLevel: c.riskLevel,
            requiresApproval: c.requiresApproval,
          })),
          maxDelegationDepth: agent.maxDelegationDepth,
          createdAt: agent.createdAt,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /ai/agents/:agentId — Get agent profile
// ---------------------------------------------------------------------------
router.get(
  '/:agentId',
  validate({ params: AgentIdParamsSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const agent = await agentIdentityService.getAgent(req.params.agentId as string);

      res.json({
        success: true,
        data: {
          agentId: agent.agentId,
          did: agent.did,
          operatorId: agent.operatorId,
          agentName: agent.agentName,
          agentDescription: agent.agentDescription,
          agentProtocol: agent.agentProtocol,
          status: agent.status,
          capabilities: agent.capabilities,
          publicKeyHash: agent.publicKeyHash,
          maxDelegationDepth: agent.maxDelegationDepth,
          teeAttested: agent.teeAttested,
          teeAttestationId: agent.teeAttestationId,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          lastActiveAt: agent.lastActiveAt,
          stats: agent.stats,
          metadata: agent.metadata,
          ...(agent.status === 'suspended' && {
            suspension: {
              suspendedAt: agent.suspendedAt,
              suspendedBy: agent.suspendedBy,
              reason: agent.suspensionReason,
            },
          }),
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/:agentId/capabilities — Update agent capabilities
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/capabilities',
  validate({
    params: AgentIdParamsSchema,
    body: UpdateCapabilitiesSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const agent = await agentIdentityService.updateCapabilities(
        req.params.agentId as string,
        req.body.capabilities,
        req.identity.id,
      );

      res.json({
        success: true,
        data: {
          agentId: agent.agentId,
          capabilities: agent.capabilities.map((c) => ({
            name: c.name,
            riskLevel: c.riskLevel,
            requiresApproval: c.requiresApproval,
            actions: c.actions,
          })),
          updatedAt: agent.updatedAt,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/:agentId/delegate — Create delegation chain
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/delegate',
  validate({
    params: AgentIdParamsSchema,
    body: CreateDelegationSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const { toAgentId, capabilities, constraints, durationHours } = req.body;

      const delegation = await agentIdentityService.createDelegation(
        req.params.agentId as string,
        toAgentId,
        capabilities,
        constraints,
        durationHours,
        req.identity.id,
      );

      res.status(201).json({
        success: true,
        data: {
          delegationId: delegation.delegationId,
          fromAgentId: delegation.fromAgentId,
          toAgentId: delegation.toAgentId,
          capabilities: delegation.capabilities,
          constraints: delegation.constraints.map((c) => c.type),
          depth: delegation.depth,
          status: delegation.status,
          createdAt: delegation.createdAt,
          expiresAt: delegation.expiresAt,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/:agentId/verify — Verify agent identity for M2M
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/verify',
  validate({
    params: AgentIdParamsSchema,
    body: VerifyAgentSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const result = await agentIdentityService.verifyAgent({
        agentId: req.params.agentId as string,
        ...req.body,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /ai/agents/:agentId/audit — Get agent activity audit
// ---------------------------------------------------------------------------
router.get(
  '/:agentId/audit',
  validate({
    params: AgentIdParamsSchema,
    query: AuditQuerySchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const entries = await agentIdentityService.getAgentAudit(
        req.params.agentId as string,
        limit,
      );

      // Also fetch the agent to include summary stats
      const agent = await agentIdentityService.getAgent(req.params.agentId as string);

      res.json({
        success: true,
        data: {
          agentId: req.params.agentId as string,
          stats: agent.stats,
          entries,
          total: entries.length,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/:agentId/suspend — Suspend agent (human-in-the-loop)
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/suspend',
  validate({
    params: AgentIdParamsSchema,
    body: SuspendAgentSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const agent = await agentIdentityService.suspendAgent(
        req.params.agentId as string,
        req.identity.id,
        req.body.reason,
      );

      res.json({
        success: true,
        data: {
          agentId: agent.agentId,
          status: agent.status,
          suspendedAt: agent.suspendedAt,
          suspendedBy: agent.suspendedBy,
          reason: agent.suspensionReason,
        },
        message: 'Agent has been suspended. All active delegations have been revoked.',
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/approvals/respond — Respond to human-in-the-loop approval
// ---------------------------------------------------------------------------
router.post(
  '/approvals/respond',
  validate({ body: ApprovalResponseSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const { requestId, approved, note } = req.body;

      const result = await agentIdentityService.respondToApproval(
        requestId,
        req.identity.id,
        approved,
        note,
      );

      res.json({
        success: true,
        data: {
          requestId: result.requestId,
          agentId: result.agentId,
          action: result.action,
          status: result.status,
          respondedAt: result.respondedAt,
          respondedBy: result.respondedBy,
        },
        message: `Approval request ${approved ? 'approved' : 'rejected'}`,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
function handleError(error: unknown, res: Response): void {
  if (error instanceof AgentIdentityError) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  logger.error('ai_agent_route_error', {
    error: (error as Error).message,
    stack: (error as Error).stack,
  });

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
  });
}

export { router as aiAgentIdentityRoutes };
