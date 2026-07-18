import crypto from 'crypto';
import type { AIAgent as PrismaAIAgent } from '@prisma/client';
import { prisma, logger, redis } from '../../runtime';
// tee import removed — not used in this module

const AGENT_RECORD_TTL_SECONDS = 30 * 86400;
const APPROVAL_RECORD_TTL_SECONDS = 30 * 86400;
const DELEGATION_RECORD_GRACE_SECONDS = 60;
const AGENT_VERIFICATION_CHALLENGE_TTL_SECONDS = 300;
const INTERNAL_ANOMALY_SUSPENSION_ACTOR = 'internal:anomaly-detector';
const AGENT_PROTOCOLS = new Set<AgentProtocol>([
  'openai_functions',
  'anthropic_tool_use',
  'google_genai',
  'aethelred_native',
  'custom',
]);

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export type AgentStatus = 'pending' | 'active' | 'suspended' | 'revoked';
export type AgentProtocol = 'openai_functions' | 'anthropic_tool_use' | 'google_genai' | 'aethelred_native' | 'custom';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type DelegationConstraint = 'time_bounded' | 'action_scoped' | 'resource_scoped' | 'rate_limited' | 'approval_required';

export interface AgentIdentityRegistration {
  operatorId: string;           // identity ID of the human operator
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  capabilities: AgentCapability[];
  publicKey: string;            // agent's cryptographic public key
  maxDelegationDepth: number;   // how many levels of sub-delegation allowed
  teeRequired: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  name: string;
  description: string;
  resourceTypes: string[];     // e.g., ['credential', 'verification', 'identity']
  actions: string[];           // e.g., ['read', 'create', 'verify', 'present']
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;   // human-in-the-loop for this capability
  rateLimit?: { maxPerHour: number; maxPerDay: number };
}

export interface AgentIdentity {
  agentId: string;
  did: string;                  // did:aethelred:agent:<identifier>
  operatorId: string;
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  status: AgentStatus;
  capabilities: AgentCapability[];
  publicKey: string;
  publicKeyHash: string;
  maxDelegationDepth: number;
  teeAttested: boolean;
  teeAttestationId?: string;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt?: Date;
  suspendedAt?: Date;
  suspendedBy?: string;
  suspensionReason?: string;
  metadata: Record<string, unknown>;
  stats: AgentStats;
  /** Internal optimistic-concurrency version; routes do not expose it. */
  recordVersion: number;
}

interface AgentStats {
  totalActions: number;
  actionsToday: number;
  successRate: number;
  averageLatencyMs: number;
  anomalyCount: number;
  lastAnomalyAt?: Date;
}

export interface DelegationChain {
  delegationId: string;
  fromAgentId: string;         // delegator
  toAgentId: string;           // delegate
  capabilities: string[];      // subset of delegator's capabilities
  constraints: DelegationConstraintSpec[];
  depth: number;               // current chain depth
  maxDepth: number;
  status: 'active' | 'expired' | 'revoked';
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  parentDelegationId?: string; // for tracking chains
}

interface DelegationConstraintSpec {
  type: DelegationConstraint;
  parameters: Record<string, unknown>;
}

export interface AgentVerificationRequest {
  agentId: string;
  challenge: string;
  signature: string;          // signature of the canonical verification payload
  requestedCapabilities: string[];
  context: {
    callerAgentId?: string;
    callerProtocol?: AgentProtocol;
    purpose: string;
    resourceId?: string;
  };
}

export interface AgentVerificationResult {
  verificationId: string;
  agentId: string;
  verified: boolean;
  authorizedCapabilities: string[];
  deniedCapabilities: { name: string; reason: string }[];
  delegationChain?: string[];  // chain of agent IDs if delegated
  teeAttested: boolean;
  expiresAt: Date;
  details: string[];
}

export interface HumanApprovalRequest {
  requestId: string;
  agentId: string;
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  riskLevel: string;
  context: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: Date;
  respondedAt?: Date;
  respondedBy?: string;
  responseNote?: string;
}

export interface AgentAuditEntry {
  entryId: string;
  agentId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  anomalyDetected: boolean;
  anomalyDetails?: string;
  timestamp: Date;
}

export function buildAgentVerificationSigningPayload(
  request: Pick<
    AgentVerificationRequest,
    'agentId' | 'challenge' | 'requestedCapabilities' | 'context'
  >,
): string {
  return JSON.stringify({
    version: 'zeroid-agent-verification-v1',
    agentId: request.agentId,
    challenge: request.challenge,
    requestedCapabilities: [...request.requestedCapabilities].sort(),
    context: {
      callerAgentId: request.context.callerAgentId ?? null,
      callerProtocol: request.context.callerProtocol ?? null,
      purpose: request.context.purpose,
      resourceId: request.context.resourceId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Agent Identity Service
// ---------------------------------------------------------------------------

export class AgentIdentityService {
  private delegations: Map<string, DelegationChain> = new Map();
  private approvalRequests: Map<string, HumanApprovalRequest> = new Map();
  private auditEntries: Map<string, AgentAuditEntry[]> = new Map();

  // Behavioral baselines for anomaly detection
  private behaviorBaselines: Map<string, {
    meanActionsPerHour: number;
    stdDevActionsPerHour: number;
    typicalCapabilities: Set<string>;
    typicalHours: Set<number>;
    sampleCount: number;
  }> = new Map();

  // -------------------------------------------------------------------------
  // Register a new AI agent identity
  // -------------------------------------------------------------------------
  async registerAgent(registration: AgentIdentityRegistration): Promise<AgentIdentity> {
    const agentId = `agent-${crypto.randomUUID()}`;
    const identifier = crypto.randomBytes(16).toString('hex');
    const did = `did:aethelred:agent:${identifier}`;

    logger.info('agent_registration_start', {
      agentId,
      operatorId: registration.operatorId,
      agentName: registration.agentName,
      protocol: registration.agentProtocol,
    });

    // Verify the operator identity exists and is active
    const operator = await prisma.identity.findUnique({
      where: { id: registration.operatorId },
      select: { id: true, did: true, status: true },
    });

    if (!operator || operator.status !== 'ACTIVE') {
      throw new AgentIdentityError(
        'Operator identity not found or not active',
        'OPERATOR_INVALID',
        403,
      );
    }

    // Validate capabilities
    for (const cap of registration.capabilities) {
      if (cap.riskLevel === 'critical' && !cap.requiresApproval) {
        throw new AgentIdentityError(
          `Critical capability "${cap.name}" must require human approval`,
          'CRITICAL_CAP_NO_APPROVAL',
          400,
        );
      }
    }

    const publicKeyHash = crypto.createHash('sha256')
      .update(registration.publicKey)
      .digest('hex');

    const maxDelegationDepth = Math.min(registration.maxDelegationDepth, 5);
    const persisted = await prisma.$transaction(async (tx) => {
      const created = await tx.aIAgent.create({
        data: {
          id: agentId,
          agentDid: did,
          name: registration.agentName,
          description: registration.agentDescription,
          operatorId: registration.operatorId,
          controllerDid: operator.did,
          riskTier: 'LOW',
          // Preserve the existing public protocol while keeping agentType
          // compatible with consumers that predate the dedicated column.
          agentType: registration.agentProtocol,
          agentProtocol: registration.agentProtocol,
          publicKey: registration.publicKey,
          publicKeyHash,
          capabilities: registration.capabilities as any,
          maxDelegationDepth,
          status: 'ACTIVE',
          humanApprovalRequired: registration.capabilities.some(
            (capability) => capability.requiresApproval,
          ),
          teeAttested: false,
          metadata: (registration.metadata ?? {}) as any,
        },
      });

      await tx.auditLog.create({
        data: {
          identityId: registration.operatorId,
          action: 'AGENT_REGISTERED' as any,
          resourceType: 'agent_identity',
          resourceId: agentId,
          details: {
            did,
            agentName: registration.agentName,
            protocol: registration.agentProtocol,
            capabilityCount: registration.capabilities.length,
            publicKeyHash,
          },
        },
      });

      return created;
    });

    const agent = this.fromPrismaAgent(persisted);
    await this.cacheAgent(agent);

    logger.info('agent_registered', {
      agentId,
      did,
      operatorId: registration.operatorId,
      capabilities: agent.capabilities.map((c) => c.name),
    });

    return agent;
  }

  // -------------------------------------------------------------------------
  // Get agent profile
  // -------------------------------------------------------------------------
  async getAgent(agentId: string): Promise<AgentIdentity> {
    // Prisma is authoritative. Never authorize from a stale process/Redis copy;
    // Redis is refreshed only after the durable row has been validated.
    const persisted = await prisma.aIAgent.findUnique({ where: { id: agentId } });
    if (!persisted) {
      throw new AgentIdentityError('Agent not found', 'AGENT_NOT_FOUND', 404);
    }

    const agent = this.fromPrismaAgent(persisted);
    await this.cacheAgent(agent);
    return agent;
  }

  // -------------------------------------------------------------------------
  // List agents owned by an operator
  // -------------------------------------------------------------------------
  async listAgentsForOperator(operatorId: string): Promise<AgentIdentity[]> {
    const persisted = await prisma.aIAgent.findMany({
      where: { operatorId },
      orderBy: { createdAt: 'desc' },
    });
    const agents = persisted.map((row) => this.fromPrismaAgent(row));
    await Promise.all(agents.map((agent) => this.cacheAgent(agent)));
    return agents;
  }

  // -------------------------------------------------------------------------
  // Update agent capabilities
  // -------------------------------------------------------------------------
  async updateCapabilities(
    agentId: string,
    capabilities: AgentCapability[],
    requestedBy: string,
  ): Promise<AgentIdentity> {
    const agent = await this.getAgent(agentId);

    // Only the operator can update capabilities
    if (agent.operatorId !== requestedBy) {
      throw new AgentIdentityError(
        'Only the agent operator can update capabilities',
        'UNAUTHORIZED_CAPABILITY_UPDATE',
        403,
      );
    }

    // Validate critical capabilities
    for (const cap of capabilities) {
      if (cap.riskLevel === 'critical' && !cap.requiresApproval) {
        throw new AgentIdentityError(
          `Critical capability "${cap.name}" must require human approval`,
          'CRITICAL_CAP_NO_APPROVAL',
          400,
        );
      }
    }

    const previousCapabilities = agent.capabilities.map((c) => c.name);
    const persisted = await prisma.$transaction(async (tx) => {
      const updated = await tx.aIAgent.updateMany({
        where: {
          id: agentId,
          operatorId: requestedBy,
          version: agent.recordVersion,
        },
        data: {
          capabilities: capabilities as any,
          humanApprovalRequired: capabilities.some(
            (capability) => capability.requiresApproval,
          ),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new AgentIdentityError(
          'Agent was updated concurrently; reload before changing capabilities',
          'AGENT_CONCURRENT_UPDATE',
          409,
        );
      }

      const row = await tx.aIAgent.findUnique({ where: { id: agentId } });
      if (!row) {
        throw new AgentIdentityError('Agent not found', 'AGENT_NOT_FOUND', 404);
      }

      await tx.auditLog.create({
        data: {
          identityId: agent.operatorId,
          action: 'AGENT_CAPABILITIES_UPDATED' as any,
          resourceType: 'agent_identity',
          resourceId: agentId,
          details: {
            previousCapabilities,
            newCapabilities: capabilities.map((c) => c.name),
            updatedBy: requestedBy,
          },
        },
      });

      return row;
    });
    const updatedAgent = this.fromPrismaAgent(persisted);
    await this.cacheAgent(updatedAgent);

    logger.info('agent_capabilities_updated', {
      agentId,
      previousCount: previousCapabilities.length,
      newCount: capabilities.length,
      updatedBy: requestedBy,
    });

    return updatedAgent;
  }

  // -------------------------------------------------------------------------
  // Create delegation chain
  // -------------------------------------------------------------------------
  async createDelegation(
    fromAgentId: string,
    toAgentId: string,
    capabilities: string[],
    constraints: DelegationConstraintSpec[],
    durationHours: number,
    requestedBy: string,
  ): Promise<DelegationChain> {
    const fromAgent = await this.getAgent(fromAgentId);
    await this.getAgent(toAgentId); // validate delegate exists

    // Verify authorization: either the operator or the agent itself
    if (fromAgent.operatorId !== requestedBy) {
      throw new AgentIdentityError(
        'Only the operator can create delegations',
        'UNAUTHORIZED_DELEGATION',
        403,
      );
    }

    // Verify the delegator has the capabilities being delegated
    const delegatorCapNames = new Set(fromAgent.capabilities.map((c) => c.name));
    const unauthorized = capabilities.filter((c) => !delegatorCapNames.has(c));
    if (unauthorized.length > 0) {
      throw new AgentIdentityError(
        `Agent does not have capabilities to delegate: ${unauthorized.join(', ')}`,
        'INSUFFICIENT_CAPABILITIES',
        400,
      );
    }

    // Check delegation depth
    const existingChainDepth = await this.getChainDepth(fromAgentId);
    if (existingChainDepth >= fromAgent.maxDelegationDepth) {
      throw new AgentIdentityError(
        `Maximum delegation depth (${fromAgent.maxDelegationDepth}) exceeded`,
        'DELEGATION_DEPTH_EXCEEDED',
        400,
      );
    }

    const delegationId = `del-${crypto.randomUUID()}`;
    const now = new Date();

    const delegation: DelegationChain = {
      delegationId,
      fromAgentId,
      toAgentId,
      capabilities,
      constraints,
      depth: existingChainDepth + 1,
      maxDepth: fromAgent.maxDelegationDepth,
      status: 'active',
      createdAt: now,
      expiresAt: new Date(now.getTime() + durationHours * 3600_000),
    };

    this.delegations.set(delegationId, delegation);

    await this.persistDelegation(delegation);

    // Index delegations by agent
    await redis.sadd(`delegations:from:${fromAgentId}`, delegationId);
    await redis.sadd(`delegations:to:${toAgentId}`, delegationId);

    await prisma.auditLog.create({
      data: {
        identityId: fromAgent.operatorId,
        action: 'AGENT_DELEGATION_CREATED' as any,
        resourceType: 'delegation',
        resourceId: delegationId,
        details: {
          fromAgentId,
          toAgentId,
          capabilities,
          constraints: constraints.map((c) => c.type),
          depth: delegation.depth,
          expiresAt: delegation.expiresAt,
        },
      },
    });

    logger.info('delegation_created', {
      delegationId,
      fromAgentId,
      toAgentId,
      capabilities,
      depth: delegation.depth,
      durationHours,
    });

    return delegation;
  }

  // -------------------------------------------------------------------------
  // Verify agent identity (M2M verification)
  // -------------------------------------------------------------------------
  async verifyAgent(request: AgentVerificationRequest): Promise<AgentVerificationResult> {
    const verificationId = `av-${crypto.randomUUID()}`;
    const startTime = performance.now();

    logger.info('agent_verification_start', {
      verificationId,
      agentId: request.agentId,
      requestedCapabilities: request.requestedCapabilities,
    });

    let agent = await this.getAgent(request.agentId);
    const details: string[] = [];

    // 1. Verify agent status
    if (agent.status !== 'active') {
      return {
        verificationId,
        agentId: request.agentId,
        verified: false,
        authorizedCapabilities: [],
        deniedCapabilities: request.requestedCapabilities.map((c) => ({
          name: c,
          reason: `Agent status is ${agent.status}`,
        })),
        teeAttested: agent.teeAttested,
        expiresAt: new Date(),
        details: [`Agent is ${agent.status} — verification denied`],
      };
    }

    // 2. Verify the full authorization payload, not just the nonce.
    const signingPayload = buildAgentVerificationSigningPayload(request);
    const signatureValid = this.verifySignature(
      signingPayload,
      request.signature,
      agent.publicKey,
    );

    if (!signatureValid) {
      details.push('Cryptographic signature verification failed');
      await this.recordAnomalyEvent(agent, 'Invalid signature presented for verification');

      return {
        verificationId,
        agentId: request.agentId,
        verified: false,
        authorizedCapabilities: [],
        deniedCapabilities: request.requestedCapabilities.map((c) => ({
          name: c,
          reason: 'Signature verification failed',
        })),
        teeAttested: agent.teeAttested,
        expiresAt: new Date(),
        details,
      };
    }
    details.push('Cryptographic signature verified');

    if (!(await this.reserveVerificationChallenge(request.agentId, request.challenge))) {
      details.push('Challenge has already been used');
      await this.recordAnomalyEvent(agent, 'Replayed verification challenge');

      return {
        verificationId,
        agentId: request.agentId,
        verified: false,
        authorizedCapabilities: [],
        deniedCapabilities: request.requestedCapabilities.map((c) => ({
          name: c,
          reason: 'Challenge has already been used',
        })),
        teeAttested: agent.teeAttested,
        expiresAt: new Date(),
        details,
      };
    }

    // 3. Check capability authorization
    const agentCapNames = new Set(agent.capabilities.map((c) => c.name));
    const authorized: string[] = [];
    const denied: { name: string; reason: string }[] = [];

    // Also check delegations
    const delegatedCaps = await this.getDelegatedCapabilities(request.agentId);
    const allAvailableCaps = new Set([...agentCapNames, ...delegatedCaps]);

    for (const requested of request.requestedCapabilities) {
      if (allAvailableCaps.has(requested)) {
        // Check if this capability requires human approval
        const cap = agent.capabilities.find((c) => c.name === requested);
        if (cap?.requiresApproval) {
          // Create approval request
          const approval = await this.createApprovalRequest(
            agent,
            requested,
            request.context.resourceId ?? 'unknown',
            request.context.purpose,
          );
          denied.push({
            name: requested,
            reason: `Requires human approval (request: ${approval.requestId})`,
          });
        } else {
          // Check rate limits
          const rateLimitOk = await this.checkRateLimit(agent.agentId, requested, cap);
          if (rateLimitOk) {
            authorized.push(requested);
          } else {
            denied.push({ name: requested, reason: 'Rate limit exceeded' });
          }
        }
      } else {
        denied.push({ name: requested, reason: 'Capability not granted to this agent' });
      }
    }

    // 4. Build delegation chain if applicable
    let delegationChain: string[] | undefined;
    if (request.context.callerAgentId) {
      delegationChain = await this.traceDelegationChain(
        request.context.callerAgentId,
        request.agentId,
      );
      if (delegationChain.length > 0) {
        details.push(`Delegation chain: ${delegationChain.join(' -> ')}`);
      }
    }

    // 5. Anomaly detection on the verification request
    agent = await this.detectVerificationAnomaly(agent, request);

    if (agent.status !== 'active' && authorized.length > 0) {
      for (const capability of authorized.splice(0, authorized.length)) {
        denied.push({
          name: capability,
          reason: `Agent status changed to ${agent.status}`,
        });
      }
      details.push(`Agent is ${agent.status} — authorization withdrawn`);
    }

    const verified = authorized.length > 0;
    const latencyMs = performance.now() - startTime;

    // Atomic increments prevent concurrent verifications from losing counters.
    agent = await this.recordVerificationStats(agent.agentId, latencyMs, verified);

    details.push(`Authorized: ${authorized.length}/${request.requestedCapabilities.length} capabilities`);

    const result: AgentVerificationResult = {
      verificationId,
      agentId: request.agentId,
      verified,
      authorizedCapabilities: authorized,
      deniedCapabilities: denied,
      delegationChain,
      teeAttested: agent.teeAttested,
      expiresAt: new Date(Date.now() + 3600_000), // 1-hour validity
      details,
    };

    logger.info('agent_verification_complete', {
      verificationId,
      agentId: request.agentId,
      verified,
      authorizedCount: authorized.length,
      deniedCount: denied.length,
      latencyMs: latencyMs.toFixed(2),
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Suspend agent (human-in-the-loop)
  // -------------------------------------------------------------------------
  async suspendAgent(
    agentId: string,
    suspendedBy: string,
    reason: string,
  ): Promise<AgentIdentity> {
    const agent = await this.getAgent(agentId);

    // Only the owning operator may suspend an agent. A platform-admin role is
    // not modeled yet, so treating any active identity as an administrator
    // would allow cross-tenant suspension.
    if (agent.operatorId !== suspendedBy) {
      throw new AgentIdentityError(
        'Not authorized to suspend this agent',
        'UNAUTHORIZED_SUSPENSION',
        403,
      );
    }

    return this.applySuspension(
      agent,
      suspendedBy,
      reason,
      'operator',
    );
  }

  /**
   * Durable suspension transition shared by the owner-authorized public path
   * and the private anomaly policy. The internal actor string is never accepted
   * from an API request, so it cannot become a forgeable platform-admin role.
   */
  private async applySuspension(
    current: AgentIdentity,
    suspendedBy: string,
    reason: string,
    source: 'operator' | 'anomaly-threshold',
  ): Promise<AgentIdentity> {
    if (current.status === 'suspended') return current;
    if (current.status !== 'active') {
      throw new AgentIdentityError(
        `Agent status ${current.status} cannot transition to suspended`,
        'AGENT_STATUS_INVALID',
        409,
      );
    }

    const suspendedAt = new Date();
    const persisted = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.aIAgent.updateMany({
        where: { id: current.agentId, status: 'ACTIVE' },
        data: {
          status: 'SUSPENDED',
          suspendedAt,
          suspendedBy,
          suspensionReason: reason,
          version: { increment: 1 },
        },
      });

      const row = await tx.aIAgent.findUnique({ where: { id: current.agentId } });
      if (!row) {
        throw new AgentIdentityError('Agent not found', 'AGENT_NOT_FOUND', 404);
      }

      if (transitioned.count === 1) {
        await tx.auditLog.create({
          data: {
            // Anchor the event to the owning tenant. The actual actor and source
            // are explicit in details; no synthetic Identity/admin is created.
            identityId: row.operatorId,
            action: 'AGENT_SUSPENDED' as any,
            resourceType: 'agent_identity',
            resourceId: current.agentId,
            details: {
              suspendedBy,
              reason,
              source,
              automatic: source === 'anomaly-threshold',
              anomalyCount: row.anomalyCount,
              delegationEnforcement: 'source_status_and_cache_revocation',
            },
          },
        });
      }

      return row;
    });

    const suspended = this.fromPrismaAgent(persisted);
    await this.cacheAgent(suspended);
    const revokedDelegations = await this.revokeDelegationsBestEffort(
      suspended.agentId,
      suspendedBy,
    );

    logger.warn('agent_suspended', {
      agentId: suspended.agentId,
      suspendedBy,
      reason,
      source,
      revokedDelegations,
    });

    return suspended;
  }

  // -------------------------------------------------------------------------
  // Get agent audit trail
  // -------------------------------------------------------------------------
  async getAgentAudit(agentId: string, limit = 50): Promise<AgentAuditEntry[]> {
    await this.getAgent(agentId); // verify exists

    const entries = this.auditEntries.get(agentId) ?? [];
    return entries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Agent behavior monitoring & anomaly detection
  // -------------------------------------------------------------------------
  private async detectVerificationAnomaly(
    agent: AgentIdentity,
    request: AgentVerificationRequest,
  ): Promise<AgentIdentity> {
    const baseline = this.behaviorBaselines.get(agent.agentId);
    const hour = new Date().getUTCHours();
    const anomalies: string[] = [];

    if (baseline && baseline.sampleCount >= 10) {
      // Check for unusual capabilities being requested
      const unusualCaps = request.requestedCapabilities.filter(
        (c) => !baseline.typicalCapabilities.has(c),
      );
      if (unusualCaps.length > 0) {
        anomalies.push(`Unusual capabilities requested: ${unusualCaps.join(', ')}`);
      }

      // Check for unusual time-of-day
      if (!baseline.typicalHours.has(hour)) {
        anomalies.push(`Activity at unusual hour: ${hour}:00 UTC`);
      }
    }

    // Update baseline
    if (!baseline) {
      this.behaviorBaselines.set(agent.agentId, {
        meanActionsPerHour: 1,
        stdDevActionsPerHour: 0,
        typicalCapabilities: new Set(request.requestedCapabilities),
        typicalHours: new Set([hour]),
        sampleCount: 1,
      });
    } else {
      for (const cap of request.requestedCapabilities) {
        baseline.typicalCapabilities.add(cap);
      }
      baseline.typicalHours.add(hour);
      baseline.sampleCount++;
      this.behaviorBaselines.set(agent.agentId, baseline);
    }

    if (anomalies.length > 0) {
      return this.recordAnomalyEvent(agent, anomalies.join('; '));
    }
    return agent;
  }

  private async recordAnomalyEvent(
    agent: AgentIdentity,
    details: string,
  ): Promise<AgentIdentity> {
    const lastAnomalyAt = new Date();
    const persisted = await prisma.aIAgent.update({
      where: { id: agent.agentId },
      data: {
        anomalyCount: { increment: 1 },
        lastAnomalyAt,
        version: { increment: 1 },
      },
    });
    let updatedAgent = this.fromPrismaAgent(persisted);
    await this.cacheAgent(updatedAgent);

    const entry: AgentAuditEntry = {
      entryId: `aae-${crypto.randomUUID()}`,
      agentId: agent.agentId,
      action: 'ANOMALY_DETECTED',
      resourceType: 'agent_behavior',
      success: false,
      latencyMs: 0,
      anomalyDetected: true,
      anomalyDetails: details,
      timestamp: new Date(),
    };

    const entries = this.auditEntries.get(agent.agentId) ?? [];
    entries.push(entry);
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    this.auditEntries.set(agent.agentId, entries);

    logger.warn('agent_anomaly_detected', {
      agentId: agent.agentId,
      operatorId: agent.operatorId,
      details,
      totalAnomalies: updatedAgent.stats.anomalyCount,
    });

    // Auto-suspend after repeated anomalies
    if (updatedAgent.stats.anomalyCount >= 10 && updatedAgent.status === 'active') {
      logger.warn('agent_auto_suspend_threshold', {
        agentId: updatedAgent.agentId,
        anomalyCount: updatedAgent.stats.anomalyCount,
      });
      updatedAgent = await this.applySuspension(
        updatedAgent,
        INTERNAL_ANOMALY_SUSPENSION_ACTOR,
        `Automatic suspension: ${updatedAgent.stats.anomalyCount} anomalies detected`,
        'anomaly-threshold',
      );
    }

    return updatedAgent;
  }

  // -------------------------------------------------------------------------
  // Human-in-the-loop approval workflows
  // -------------------------------------------------------------------------
  private async createApprovalRequest(
    agent: AgentIdentity,
    action: string,
    resourceId: string,
    purpose: string,
  ): Promise<HumanApprovalRequest> {
    const request: HumanApprovalRequest = {
      requestId: `apr-${crypto.randomUUID()}`,
      agentId: agent.agentId,
      operatorId: agent.operatorId,
      action,
      resourceType: 'capability_execution',
      resourceId,
      riskLevel: agent.capabilities.find((c) => c.name === action)?.riskLevel ?? 'high',
      context: { purpose, agentName: agent.agentName, protocol: agent.agentProtocol },
      status: 'pending',
      createdAt: new Date(),
    };

    this.approvalRequests.set(request.requestId, request);
    await this.persistApprovalRequest(request);
    await redis.sadd(this.operatorApprovalSetKey(agent.operatorId), request.requestId);
    await redis.expire(this.operatorApprovalSetKey(agent.operatorId), APPROVAL_RECORD_TTL_SECONDS);

    // Notify operator via Redis pub/sub
    await redis.publish(
      `approval:${agent.operatorId}`,
      JSON.stringify(request),
    );

    logger.info('approval_request_created', {
      requestId: request.requestId,
      agentId: agent.agentId,
      operatorId: agent.operatorId,
      action,
      riskLevel: request.riskLevel,
    });

    return request;
  }

  async respondToApproval(
    requestId: string,
    respondedBy: string,
    approved: boolean,
    note: string,
  ): Promise<HumanApprovalRequest> {
    const request = await this.getApprovalRequest(requestId);
    if (!request) {
      throw new AgentIdentityError('Approval request not found', 'APPROVAL_NOT_FOUND', 404);
    }

    if (request.operatorId !== respondedBy) {
      throw new AgentIdentityError(
        'Only the operator can respond to approval requests',
        'UNAUTHORIZED_APPROVAL',
        403,
      );
    }

    if (request.status !== 'pending') {
      throw new AgentIdentityError(
        'Approval request has already been resolved',
        'APPROVAL_ALREADY_RESOLVED',
        409,
      );
    }

    request.status = approved ? 'approved' : 'rejected';
    request.respondedAt = new Date();
    request.respondedBy = respondedBy;
    request.responseNote = note;
    this.approvalRequests.set(requestId, request);
    await this.persistApprovalRequest(request);
    await redis.srem(this.operatorApprovalSetKey(request.operatorId), requestId);

    await prisma.auditLog.create({
      data: {
        identityId: respondedBy,
        action: (approved ? 'AGENT_ACTION_APPROVED' : 'AGENT_ACTION_REJECTED') as any,
        resourceType: 'approval_request',
        resourceId: requestId,
        details: {
          agentId: request.agentId,
          action: request.action,
          approved,
          note,
        },
      },
    });

    logger.info('approval_response', {
      requestId,
      agentId: request.agentId,
      approved,
      respondedBy,
    });

    return request;
  }

  async listPendingApprovals(operatorId: string): Promise<HumanApprovalRequest[]> {
    const indexedIds = await redis.smembers(this.operatorApprovalSetKey(operatorId));
    const candidateIds = new Set(indexedIds);

    for (const [requestId, request] of this.approvalRequests.entries()) {
      if (request.operatorId === operatorId && request.status === 'pending') {
        candidateIds.add(requestId);
      }
    }

    const approvals: HumanApprovalRequest[] = [];
    for (const requestId of candidateIds) {
      const request = await this.getApprovalRequest(requestId);
      if (!request) {
        await redis.srem(this.operatorApprovalSetKey(operatorId), requestId);
        continue;
      }

      if (request.operatorId !== operatorId || request.status !== 'pending') {
        await redis.srem(this.operatorApprovalSetKey(operatorId), requestId);
        continue;
      }

      approvals.push(request);
    }

    return approvals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private verifySignature(payload: string, signature: string, publicKey: string): boolean {
    try {
      const key = this.parseVerificationKey(publicKey);
      const sigBuffer = this.decodeSignature(signature);
      const message = Buffer.from(payload, 'utf8');

      if (key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448') {
        return crypto.verify(null, message, key, sigBuffer);
      }

      if (key.asymmetricKeyType === 'ec' || key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss') {
        return crypto.verify('sha256', message, key, sigBuffer);
      }

      logger.warn('agent_signature_unsupported_key_type', {
        asymmetricKeyType: key.asymmetricKeyType,
      });
      return false;
    } catch {
      return false;
    }
  }

  private async reserveVerificationChallenge(
    agentId: string,
    challenge: string,
  ): Promise<boolean> {
    const challengeDigest = crypto
      .createHash('sha256')
      .update(`${agentId}:${challenge}`)
      .digest('hex');
    const reserved = await redis.set(
      `agent:verification-challenge:${challengeDigest}`,
      JSON.stringify({ agentId, usedAt: new Date().toISOString() }),
      'EX',
      AGENT_VERIFICATION_CHALLENGE_TTL_SECONDS,
      'NX',
    );

    return reserved === 'OK';
  }

  private parseVerificationKey(publicKey: string): crypto.KeyObject {
    const trimmed = publicKey.trim();

    if (trimmed.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey(trimmed);
    }

    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const der = Buffer.from(normalized, 'base64');
    if (der.length === 0) {
      throw new Error('Empty public key');
    }

    if (der.length === 32) {
      return crypto.createPublicKey({
        key: this.buildEd25519Spki(der),
        format: 'der',
        type: 'spki',
      });
    }

    return crypto.createPublicKey({
      key: der,
      format: 'der',
      type: 'spki',
    });
  }

  private decodeSignature(signature: string): Buffer {
    const trimmed = signature.trim();

    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return Buffer.from(trimmed, 'hex');
    }

    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64');
  }

  private buildEd25519Spki(rawPublicKey: Buffer): Buffer {
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    return Buffer.concat([spkiPrefix, rawPublicKey]);
  }

  private async getChainDepth(agentId: string): Promise<number> {
    const delegationIds = await redis.smembers(`delegations:to:${agentId}`);
    let maxDepth = 0;

    for (const delId of delegationIds) {
      const delegation = await this.getDelegation(delId);
      if (!delegation) {
        await redis.srem(`delegations:to:${agentId}`, delId);
        continue;
      }
      if (delegation && delegation.status === 'active') {
        maxDepth = Math.max(maxDepth, delegation.depth);
      }
    }

    return maxDepth;
  }

  private async getDelegatedCapabilities(agentId: string): Promise<Set<string>> {
    const delegationIds = await redis.smembers(`delegations:to:${agentId}`);
    const caps = new Set<string>();

    for (const delId of delegationIds) {
      const delegation = await this.getDelegation(delId);
      if (!delegation) {
        await redis.srem(`delegations:to:${agentId}`, delId);
        continue;
      }
      if (
        delegation &&
        delegation.status === 'active' &&
        new Date() < delegation.expiresAt &&
        await this.isAgentActive(delegation.fromAgentId)
      ) {
        for (const cap of delegation.capabilities) {
          caps.add(cap);
        }
      }
    }

    return caps;
  }

  private async traceDelegationChain(fromAgentId: string, toAgentId: string): Promise<string[]> {
    const chain: string[] = [fromAgentId];
    const visited = new Set<string>([fromAgentId]);
    let currentId = fromAgentId;

    // BFS through delegation graph
    for (let depth = 0; depth < 10; depth++) {
      if (!(await this.isAgentActive(currentId))) break;
      const delegationIds = await redis.smembers(`delegations:from:${currentId}`);
      let found = false;

      for (const delId of delegationIds) {
        const delegation = await this.getDelegation(delId);
        if (!delegation) {
          await redis.srem(`delegations:from:${currentId}`, delId);
          continue;
        }
        if (delegation && delegation.status === 'active' && !visited.has(delegation.toAgentId)) {
          chain.push(delegation.toAgentId);
          visited.add(delegation.toAgentId);

          if (delegation.toAgentId === toAgentId) {
            return chain;
          }

          currentId = delegation.toAgentId;
          found = true;
          break;
        }
      }

      if (!found) break;
    }

    return chain.length > 1 ? chain : [];
  }

  private async getDelegation(delegationId: string): Promise<DelegationChain | null> {
    const raw = await redis.get(`delegation:${delegationId}`);
    if (raw) {
      const delegation = this.parseStoredDelegation(raw);
      this.delegations.set(delegationId, delegation);
      return delegation;
    }

    return this.delegations.get(delegationId) ?? null;
  }

  private async getApprovalRequest(requestId: string): Promise<HumanApprovalRequest | null> {
    const raw = await redis.get(this.approvalRequestKey(requestId));
    if (raw) {
      const request = this.parseStoredApprovalRequest(raw);
      this.approvalRequests.set(requestId, request);
      return request;
    }

    return this.approvalRequests.get(requestId) ?? null;
  }

  private async cacheAgent(agent: AgentIdentity): Promise<void> {
    try {
      await redis.set(
        `agent:${agent.agentId}`,
        JSON.stringify(agent),
        'EX',
        AGENT_RECORD_TTL_SECONDS,
      );
      await redis.set(
        `agent:did:${agent.did}`,
        agent.agentId,
        'EX',
        AGENT_RECORD_TTL_SECONDS,
      );
      await redis.sadd(this.operatorAgentSetKey(agent.operatorId), agent.agentId);
      await redis.expire(
        this.operatorAgentSetKey(agent.operatorId),
        AGENT_RECORD_TTL_SECONDS,
      );
    } catch (error) {
      // Cache loss must not roll back or hide the authoritative Prisma row.
      logger.warn('agent_cache_write_failed', {
        agentId: agent.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordVerificationStats(
    agentId: string,
    latencyMs: number,
    successful: boolean,
  ): Promise<AgentIdentity> {
    const persisted = await prisma.aIAgent.update({
      where: { id: agentId },
      data: {
        totalActions: { increment: 1 },
        successfulActions: { increment: successful ? 1 : 0 },
        totalLatencyMs: { increment: latencyMs },
        lastActiveAt: new Date(),
        version: { increment: 1 },
      },
    });
    const agent = this.fromPrismaAgent(persisted);
    await this.cacheAgent(agent);
    return agent;
  }

  private async isAgentActive(agentId: string): Promise<boolean> {
    try {
      return (await this.getAgent(agentId)).status === 'active';
    } catch (error) {
      if (error instanceof AgentIdentityError && error.code === 'AGENT_NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  private async revokeDelegationsBestEffort(
    agentId: string,
    revokedBy: string,
  ): Promise<number> {
    try {
      const delegationIds = await redis.smembers(`delegations:from:${agentId}`);
      let revoked = 0;
      for (const delegationId of delegationIds) {
        const delegation = await this.getDelegation(delegationId);
        if (!delegation) {
          await redis.srem(`delegations:from:${agentId}`, delegationId);
          continue;
        }
        if (delegation.status === 'active') {
          delegation.status = 'revoked';
          delegation.revokedAt = new Date();
          delegation.revokedBy = revokedBy;
          this.delegations.set(delegationId, delegation);
          await this.persistDelegation(delegation);
          revoked++;
        }
      }
      return revoked;
    } catch (error) {
      // Status checks consult Prisma, so suspension still blocks the agent and
      // any delegated capability sourced from it if Redis is unavailable.
      logger.error('agent_delegation_cache_revocation_failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  private fromPrismaAgent(row: PrismaAIAgent): AgentIdentity {
    if (
      !row.description ||
      !row.agentProtocol ||
      !AGENT_PROTOCOLS.has(row.agentProtocol as AgentProtocol) ||
      !row.publicKey ||
      !row.publicKeyHash
    ) {
      throw new AgentIdentityError(
        'Durable agent record is missing protocol or verification-key material',
        'AGENT_RECORD_INCOMPLETE',
        503,
      );
    }

    const computedPublicKeyHash = crypto
      .createHash('sha256')
      .update(row.publicKey)
      .digest('hex');
    if (computedPublicKeyHash !== row.publicKeyHash) {
      throw new AgentIdentityError(
        'Durable agent verification-key fingerprint is invalid',
        'AGENT_RECORD_INVALID',
        503,
      );
    }

    const capabilities = this.parsePersistedCapabilities(row.capabilities);
    const metadata = this.parsePersistedMetadata(row.metadata);
    if (
      !Number.isSafeInteger(row.totalActions) ||
      row.totalActions < 0 ||
      !Number.isSafeInteger(row.actionsToday) ||
      row.actionsToday < 0 ||
      !Number.isSafeInteger(row.successfulActions) ||
      row.successfulActions < 0 ||
      row.successfulActions > row.totalActions ||
      !Number.isFinite(row.totalLatencyMs) ||
      row.totalLatencyMs < 0 ||
      !Number.isSafeInteger(row.anomalyCount) ||
      row.anomalyCount < 0 ||
      !Number.isSafeInteger(row.version) ||
      row.version < 0
    ) {
      throw new AgentIdentityError(
        'Durable agent counters are invalid',
        'AGENT_RECORD_INVALID',
        503,
      );
    }

    const status = this.fromPrismaAgentStatus(row.status);
    if (
      status === 'suspended' &&
      (!row.suspendedAt || !row.suspendedBy || !row.suspensionReason)
    ) {
      throw new AgentIdentityError(
        'Suspended durable agent is missing suspension evidence',
        'AGENT_RECORD_INCOMPLETE',
        503,
      );
    }

    return {
      agentId: row.id,
      did: row.agentDid,
      operatorId: row.operatorId,
      agentName: row.name,
      agentDescription: row.description,
      agentProtocol: row.agentProtocol as AgentProtocol,
      status,
      capabilities,
      publicKey: row.publicKey,
      publicKeyHash: row.publicKeyHash,
      maxDelegationDepth: row.maxDelegationDepth,
      teeAttested: row.teeAttested,
      teeAttestationId: row.teeAttestationId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActiveAt: row.lastActiveAt ?? undefined,
      suspendedAt: row.suspendedAt ?? undefined,
      suspendedBy: row.suspendedBy ?? undefined,
      suspensionReason: row.suspensionReason ?? undefined,
      metadata,
      stats: {
        totalActions: row.totalActions,
        actionsToday: row.actionsToday,
        successRate:
          row.totalActions === 0
            ? 1
            : row.successfulActions / row.totalActions,
        averageLatencyMs:
          row.totalActions === 0 ? 0 : row.totalLatencyMs / row.totalActions,
        anomalyCount: row.anomalyCount,
        lastAnomalyAt: row.lastAnomalyAt ?? undefined,
      },
      recordVersion: row.version,
    };
  }

  private fromPrismaAgentStatus(status: PrismaAIAgent['status']): AgentStatus {
    switch (status) {
      case 'PENDING_APPROVAL': return 'pending';
      case 'ACTIVE': return 'active';
      case 'SUSPENDED': return 'suspended';
      case 'REVOKED': return 'revoked';
    }
  }

  private parsePersistedCapabilities(value: unknown): AgentCapability[] {
    if (!Array.isArray(value)) {
      throw new AgentIdentityError(
        'Durable agent capabilities are invalid',
        'AGENT_RECORD_INVALID',
        503,
      );
    }

    const validRiskLevels = new Set(['low', 'medium', 'high', 'critical']);
    for (const item of value) {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item)
      ) {
        throw new AgentIdentityError(
          'Durable agent capabilities are invalid',
          'AGENT_RECORD_INVALID',
          503,
        );
      }
      const capability = item as Record<string, unknown>;
      const rateLimit = capability.rateLimit;
      const validRateLimit =
        rateLimit === undefined ||
        (
          typeof rateLimit === 'object' &&
          rateLimit !== null &&
          !Array.isArray(rateLimit) &&
          Number.isSafeInteger((rateLimit as Record<string, unknown>).maxPerHour) &&
          Number.isSafeInteger((rateLimit as Record<string, unknown>).maxPerDay)
        );
      if (
        typeof capability.name !== 'string' ||
        typeof capability.description !== 'string' ||
        !Array.isArray(capability.resourceTypes) ||
        !capability.resourceTypes.every((entry) => typeof entry === 'string') ||
        !Array.isArray(capability.actions) ||
        !capability.actions.every((entry) => typeof entry === 'string') ||
        typeof capability.riskLevel !== 'string' ||
        !validRiskLevels.has(capability.riskLevel) ||
        typeof capability.requiresApproval !== 'boolean' ||
        !validRateLimit
      ) {
        throw new AgentIdentityError(
          'Durable agent capabilities are invalid',
          'AGENT_RECORD_INVALID',
          503,
        );
      }
    }
    return value as AgentCapability[];
  }

  private parsePersistedMetadata(value: unknown): Record<string, unknown> {
    if (value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIdentityError(
        'Durable agent metadata is invalid',
        'AGENT_RECORD_INVALID',
        503,
      );
    }
    return value as Record<string, unknown>;
  }

  private async persistDelegation(delegation: DelegationChain): Promise<void> {
    const secondsUntilExpiry = Math.ceil((delegation.expiresAt.getTime() - Date.now()) / 1000);
    const ttl = Math.max(1, secondsUntilExpiry + DELEGATION_RECORD_GRACE_SECONDS);
    await redis.set(
      `delegation:${delegation.delegationId}`,
      JSON.stringify(delegation),
      'EX',
      ttl,
    );
  }

  private async persistApprovalRequest(request: HumanApprovalRequest): Promise<void> {
    await redis.set(
      this.approvalRequestKey(request.requestId),
      JSON.stringify(request),
      'EX',
      APPROVAL_RECORD_TTL_SECONDS,
    );
  }

  private parseStoredDelegation(raw: string): DelegationChain {
    const parsed = JSON.parse(raw) as DelegationChain;
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: new Date(parsed.expiresAt),
      revokedAt: parsed.revokedAt ? new Date(parsed.revokedAt) : undefined,
    };
  }

  private parseStoredApprovalRequest(raw: string): HumanApprovalRequest {
    const parsed = JSON.parse(raw) as HumanApprovalRequest;
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      respondedAt: parsed.respondedAt ? new Date(parsed.respondedAt) : undefined,
    };
  }

  private operatorAgentSetKey(operatorId: string): string {
    return `agents:operator:${operatorId}`;
  }

  private operatorApprovalSetKey(operatorId: string): string {
    return `approvals:operator:${operatorId}`;
  }

  private approvalRequestKey(requestId: string): string {
    return `approval:request:${requestId}`;
  }

  private async checkRateLimit(
    agentId: string,
    capabilityName: string,
    capability?: AgentCapability,
  ): Promise<boolean> {
    if (!capability?.rateLimit) return true;

    const hourKey = `ratelimit:agent:${agentId}:${capabilityName}:hour`;
    const dayKey = `ratelimit:agent:${agentId}:${capabilityName}:day`;

    const [hourCount, dayCount] = await Promise.all([
      redis.incr(hourKey),
      redis.incr(dayKey),
    ]);

    // Set TTLs on first increment
    if (hourCount === 1) await redis.expire(hourKey, 3600);
    if (dayCount === 1) await redis.expire(dayKey, 86400);

    if (hourCount > capability.rateLimit.maxPerHour) {
      logger.warn('agent_rate_limit_exceeded', {
        agentId,
        capability: capabilityName,
        window: 'hour',
        count: hourCount,
        limit: capability.rateLimit.maxPerHour,
      });
      return false;
    }

    if (dayCount > capability.rateLimit.maxPerDay) {
      logger.warn('agent_rate_limit_exceeded', {
        agentId,
        capability: capabilityName,
        window: 'day',
        count: dayCount,
        limit: capability.rateLimit.maxPerDay,
      });
      return false;
    }

    return true;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
export class AgentIdentityError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AgentIdentityError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const agentIdentityService = new AgentIdentityService();
