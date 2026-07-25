import { Router, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { logger } from '../../runtime';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import type { AgentIdentity } from '../../services/ai/agent-identity';
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
  rateLimit: z
    .object({
      maxPerHour: z.number().int().min(1).max(10000),
      maxPerDay: z.number().int().min(1).max(100000),
    })
    .optional(),
});

const RegisterAgentSchema = z.object({
  agentName: z.string().min(3).max(100),
  agentDescription: z.string().min(10).max(1000),
  agentProtocol: z.enum([
    'openai_functions',
    'anthropic_tool_use',
    'google_genai',
    'aethelred_native',
    'custom',
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

const DelegationScopeListSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Constraint values must be unique',
  });

const DelegationConstraintSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('time_bounded'),
      parameters: z
        .object({
          notBefore: z.string().datetime().optional(),
          notAfter: z.string().datetime().optional(),
        })
        .strict()
        .refine(({ notBefore, notAfter }) => Boolean(notBefore || notAfter), {
          message: 'notBefore or notAfter is required',
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal('action_scoped'),
      parameters: z
        .object({
          actions: DelegationScopeListSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('resource_scoped'),
      parameters: z
        .object({
          resourceIds: DelegationScopeListSchema.optional(),
          resourceTypes: DelegationScopeListSchema.optional(),
        })
        .strict()
        .refine(
          ({ resourceIds, resourceTypes }) =>
            Boolean(resourceIds || resourceTypes),
          { message: 'resourceIds or resourceTypes is required' },
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal('risk_bounded'),
      parameters: z
        .object({
          maxRiskLevel: z.enum(['low', 'medium', 'high', 'critical']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('rate_limited'),
      parameters: z
        .object({
          maxPerHour: z.number().int().min(1).max(10000).optional(),
          maxPerDay: z.number().int().min(1).max(100000).optional(),
        })
        .strict()
        .refine(
          ({ maxPerHour, maxPerDay }) =>
            maxPerHour !== undefined || maxPerDay !== undefined,
          { message: 'maxPerHour or maxPerDay is required' },
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal('approval_required'),
      parameters: z
        .object({
          reason: z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
    })
    .strict(),
]);

const CreateDelegationSchema = z
  .object({
    toAgentId: z.string().min(1),
    capabilities: z.array(z.string().min(1).max(100)).min(1),
    constraints: z.array(DelegationConstraintSchema).max(10).default([]),
    durationHours: z.number().min(0.1).max(8760), // max 1 year
  })
  .strict();

const DelegationPathParamsSchema = z.object({
  agentId: z.string().min(1),
  delegationId: z.string().regex(/^del-[0-9a-f-]{36}$/i),
});

const AgentOperationContextSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
    callerAgentId: z.string().trim().min(1).max(200).optional(),
    callerProtocol: z
      .enum([
        'openai_functions',
        'anthropic_tool_use',
        'google_genai',
        'aethelred_native',
        'custom',
      ])
      .optional(),
    purpose: z.string().trim().min(3).max(500),
    resourceId: z.string().trim().min(1).max(500),
    resourceType: z.string().trim().min(1).max(200),
    action: z.string().trim().min(1).max(200),
  })
  .strict();

const IssueChallengeSchema = z
  .object({
    requestedCapabilities: z.array(z.string().min(1).max(100)).min(1).max(20),
    context: AgentOperationContextSchema,
    approvalGroupId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const VerifyAgentSchema = z
  .object({
    challengeId: z.string().regex(/^ach-[0-9a-f-]{36}$/i),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    audience: z.string().trim().min(1).max(200),
    signature: z.string().min(64).max(1024),
    requestedCapabilities: z.array(z.string().min(1).max(100)).min(1).max(20),
    context: AgentOperationContextSchema,
    approvalGroupId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const SuspendAgentSchema = z.object({
  reason: z.string().min(5).max(1000),
});

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ApprovalIdParamsSchema = z.object({
  requestId: z.string().min(1),
});

const ApprovalPathResponseSchema = z
  .object({
    approved: z.boolean(),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// All agent identity routes require authentication
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    },
  }),
);
router.use(authMiddleware);
router.use(apiRateLimiter);

function requireAgentOperator(
  req: AuthenticatedRequest,
  res: Response,
  agent: AgentIdentity,
): boolean {
  if (!req.identity) {
    res.status(401).json({
      error: 'AUTH_REQUIRED',
      message: 'Authentication required',
    });
    return false;
  }

  if (agent.operatorId !== req.identity.id) {
    res.status(404).json({
      error: 'Agent not found',
      code: 'AGENT_NOT_FOUND',
    });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// GET /ai/agents — List operator-owned agents
// ---------------------------------------------------------------------------
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const agents = await agentIdentityService.listAgentsForOperator(
        req.identity.id,
      );

      res.json({
        success: true,
        data: agents.map((agent) => ({
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
        })),
        meta: {
          total: agents.length,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /ai/agents/approvals — List pending approvals
// ---------------------------------------------------------------------------
router.get(
  '/approvals',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const approvals = await agentIdentityService.listPendingApprovals(
        req.identity.id,
      );

      res.json({
        success: true,
        data: approvals.map(formatApprovalQueueItem),
        meta: {
          total: approvals.length,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/approvals/:requestId — Resolve one approval
// ---------------------------------------------------------------------------
router.post(
  '/approvals/:requestId',
  validate({
    params: ApprovalIdParamsSchema,
    body: ApprovalPathResponseSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }

      const result = await agentIdentityService.respondToApproval(
        req.params.requestId as string,
        req.identity.id,
        req.body.approved,
        req.body.note,
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
        message: `Approval request ${req.body.approved ? 'approved' : 'rejected'}`,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /ai/agents/:agentId/delegations/:delegationId — Revoke one tree
// ---------------------------------------------------------------------------
router.delete(
  '/:agentId/delegations/:delegationId',
  validate({ params: DelegationPathParamsSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }
      const result = await agentIdentityService.revokeDelegation(
        req.params.delegationId as string,
        req.identity.id,
        req.params.agentId as string,
      );
      res.json({
        success: true,
        data: {
          delegationId: result.delegation.delegationId,
          status: result.delegation.status,
          revokedAt: result.delegation.revokedAt,
          revokedBy: result.delegation.revokedBy,
          revokedDelegationIds: result.revokedDelegationIds,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents — Register a new agent identity
// ---------------------------------------------------------------------------
router.post(
  '/',
  validate({ body: RegisterAgentSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
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
      const agent = await agentIdentityService.getAgent(
        req.params.agentId as string,
      );
      if (!requireAgentOperator(req, res, agent)) return;

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
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
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
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
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
// POST /ai/agents/:agentId/challenges — Issue a durable operation challenge
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/challenges',
  validate({
    params: AgentIdParamsSchema,
    body: IssueChallengeSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }
      const challenge = await agentIdentityService.issueVerificationChallenge(
        req.params.agentId as string,
        req.identity.id,
        req.body,
      );
      res.status(201).json({ success: true, data: challenge });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/agents/:agentId/verify — Verify and authorize one issued operation
// ---------------------------------------------------------------------------
router.post(
  '/:agentId/verify',
  validate({
    params: AgentIdParamsSchema,
    body: VerifyAgentSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity) {
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
        return;
      }
      const result = await agentIdentityService.verifyAgent(
        {
          agentId: req.params.agentId as string,
          ...req.body,
        },
        req.identity.id,
      );

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
      const agent = await agentIdentityService.getAgent(
        req.params.agentId as string,
      );
      if (!requireAgentOperator(req, res, agent)) return;
      const entries = await agentIdentityService.getAgentAudit(
        req.params.agentId as string,
        limit,
      );

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
        res
          .status(401)
          .json({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
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
        message:
          'Agent has been suspended. All active delegations have been revoked.',
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

function formatApprovalQueueItem(approval: {
  requestId: string;
  agentId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  riskLevel: string;
  context: Record<string, unknown>;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  operatorId: string;
  approvalGroupId: string;
  operationId: string;
  operationDigest: string;
  authorizationSnapshotDigest: string;
  requestedCapabilities: string[];
  requiredApproverIds: string[];
  audienceId: string;
}) {
  return {
    id: approval.requestId,
    requestId: approval.requestId,
    agentId: approval.agentId,
    approvalGroupId: approval.approvalGroupId,
    operationId: approval.operationId,
    operationDigest: approval.operationDigest,
    authorizationSnapshotDigest: approval.authorizationSnapshotDigest,
    requestedCapabilities: approval.requestedCapabilities,
    requiredApproverIds: approval.requiredApproverIds,
    audienceId: approval.audienceId,
    operatorId: approval.operatorId,
    action: approval.action,
    actionType: approval.action,
    actionDescription: `${approval.action} on ${approval.resourceType}:${approval.resourceId}`,
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    riskLevel: approval.riskLevel,
    context: approval.context,
    status: approval.status,
    requestedAt: approval.createdAt,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
  };
}

export { router as aiAgentIdentityRoutes };
