import crypto from 'crypto';
import { prisma, logger, redis } from '../../index';
// tee import removed — not used in this module

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
  signature: string;          // agent's signature of the challenge
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

// ---------------------------------------------------------------------------
// Agent Identity Service
// ---------------------------------------------------------------------------

export class AgentIdentityService {
  private agents: Map<string, AgentIdentity> = new Map();
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

    const agent: AgentIdentity = {
      agentId,
      did,
      operatorId: registration.operatorId,
      agentName: registration.agentName,
      agentDescription: registration.agentDescription,
      agentProtocol: registration.agentProtocol,
      status: 'active',
      capabilities: registration.capabilities,
      publicKey: registration.publicKey,
      publicKeyHash,
      maxDelegationDepth: Math.min(registration.maxDelegationDepth, 5), // hard cap at 5
      teeAttested: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: registration.metadata ?? {},
      stats: {
        totalActions: 0,
        actionsToday: 0,
        successRate: 1.0,
        averageLatencyMs: 0,
        anomalyCount: 0,
      },
    };

    this.agents.set(agentId, agent);

    // Create DID document in identity store
    await prisma.auditLog.create({
      data: {
        identityId: registration.operatorId,
        action: 'AGENT_REGISTERED' as any,
        resourceType: 'agent_identity',
        resourceId: agentId,
        details: {
          did,
          agentName: agent.agentName,
          protocol: agent.agentProtocol,
          capabilityCount: agent.capabilities.length,
          publicKeyHash,
        },
      },
    });

    // Cache agent identity
    await redis.set(`agent:${agentId}`, JSON.stringify(agent), 'EX', 30 * 86400);
    await redis.set(`agent:did:${did}`, agentId, 'EX', 30 * 86400);

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
    const agent = this.agents.get(agentId);
    if (!agent) {
      // Try cache
      const cached = await redis.get(`agent:${agentId}`);
      if (cached) {
        const parsed = JSON.parse(cached) as AgentIdentity;
        this.agents.set(agentId, parsed);
        return parsed;
      }
      throw new AgentIdentityError('Agent not found', 'AGENT_NOT_FOUND', 404);
    }
    return agent;
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
    agent.capabilities = capabilities;
    agent.updatedAt = new Date();
    this.agents.set(agentId, agent);

    await redis.set(`agent:${agentId}`, JSON.stringify(agent), 'EX', 30 * 86400);

    await prisma.auditLog.create({
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

    logger.info('agent_capabilities_updated', {
      agentId,
      previousCount: previousCapabilities.length,
      newCount: capabilities.length,
      updatedBy: requestedBy,
    });

    return agent;
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

    await redis.set(
      `delegation:${delegationId}`,
      JSON.stringify(delegation),
      'EX',
      durationHours * 3600,
    );

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

    const agent = await this.getAgent(request.agentId);
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

    // 2. Verify cryptographic signature
    const signatureValid = this.verifySignature(
      request.challenge,
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
    await this.detectVerificationAnomaly(agent, request);

    const verified = authorized.length > 0;
    const latencyMs = performance.now() - startTime;

    // Update agent stats
    agent.lastActiveAt = new Date();
    agent.stats.totalActions++;
    agent.stats.averageLatencyMs = (
      agent.stats.averageLatencyMs * (agent.stats.totalActions - 1) + latencyMs
    ) / agent.stats.totalActions;
    this.agents.set(agent.agentId, agent);

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

    // Verify authority: operator or system admin
    if (agent.operatorId !== suspendedBy) {
      // Check if suspendedBy is a valid identity (admin)
      const suspender = await prisma.identity.findUnique({
        where: { id: suspendedBy },
        select: { id: true, status: true },
      });
      if (!suspender || suspender.status !== 'ACTIVE') {
        throw new AgentIdentityError(
          'Not authorized to suspend this agent',
          'UNAUTHORIZED_SUSPENSION',
          403,
        );
      }
    }

    agent.status = 'suspended';
    agent.suspendedAt = new Date();
    agent.suspendedBy = suspendedBy;
    agent.suspensionReason = reason;
    agent.updatedAt = new Date();
    this.agents.set(agentId, agent);

    // Revoke all active delegations from this agent
    const delegationIds = await redis.smembers(`delegations:from:${agentId}`);
    for (const delId of delegationIds) {
      const delegation = this.delegations.get(delId);
      if (delegation && delegation.status === 'active') {
        delegation.status = 'revoked';
        delegation.revokedAt = new Date();
        delegation.revokedBy = suspendedBy;
        this.delegations.set(delId, delegation);
      }
    }

    await redis.set(`agent:${agentId}`, JSON.stringify(agent), 'EX', 30 * 86400);

    await prisma.auditLog.create({
      data: {
        identityId: agent.operatorId,
        action: 'AGENT_SUSPENDED' as any,
        resourceType: 'agent_identity',
        resourceId: agentId,
        details: {
          suspendedBy,
          reason,
          revokedDelegations: delegationIds.length,
        },
      },
    });

    logger.warn('agent_suspended', {
      agentId,
      suspendedBy,
      reason,
      revokedDelegations: delegationIds.length,
    });

    return agent;
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
  ): Promise<void> {
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
      await this.recordAnomalyEvent(agent, anomalies.join('; '));
    }
  }

  private async recordAnomalyEvent(agent: AgentIdentity, details: string): Promise<void> {
    agent.stats.anomalyCount++;
    agent.stats.lastAnomalyAt = new Date();
    this.agents.set(agent.agentId, agent);

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
      totalAnomalies: agent.stats.anomalyCount,
    });

    // Auto-suspend after repeated anomalies
    if (agent.stats.anomalyCount >= 10 && agent.status === 'active') {
      logger.warn('agent_auto_suspend_threshold', {
        agentId: agent.agentId,
        anomalyCount: agent.stats.anomalyCount,
      });
      await this.suspendAgent(agent.agentId, 'system:anomaly-detector', `Automatic suspension: ${agent.stats.anomalyCount} anomalies detected`);
    }
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
    const request = this.approvalRequests.get(requestId);
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

    request.status = approved ? 'approved' : 'rejected';
    request.respondedAt = new Date();
    request.respondedBy = respondedBy;
    request.responseNote = note;
    this.approvalRequests.set(requestId, request);

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

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private verifySignature(challenge: string, signature: string, publicKey: string): boolean {
    try {
      const key = this.parseVerificationKey(publicKey);
      const sigBuffer = this.decodeSignature(signature);
      const message = Buffer.from(challenge, 'utf8');

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
      const delegation = this.delegations.get(delId);
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
      const delegation = this.delegations.get(delId);
      if (delegation && delegation.status === 'active' && new Date() < delegation.expiresAt) {
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
      const delegationIds = await redis.smembers(`delegations:from:${currentId}`);
      let found = false;

      for (const delId of delegationIds) {
        const delegation = this.delegations.get(delId);
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
