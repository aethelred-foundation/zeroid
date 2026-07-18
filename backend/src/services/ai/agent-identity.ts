import crypto from "crypto";
import type {
  AIAgent as PrismaAIAgent,
  AgentApprovalRequest as PrismaAgentApprovalRequest,
  AgentDelegation as PrismaAgentDelegation,
  AgentVerificationChallenge as PrismaAgentVerificationChallenge,
  Prisma,
} from "@prisma/client";
import { prisma, logger, redis } from "../../runtime";
// tee import removed — not used in this module

const AGENT_RECORD_TTL_SECONDS = 30 * 86400;
const APPROVAL_RECORD_TTL_SECONDS = 30 * 86400;
const DELEGATION_RECORD_GRACE_SECONDS = 60;
const AGENT_VERIFICATION_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_AUDIENCE_SIGNATURE_FAILURES_PER_HOUR = 20;
const APPROVAL_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DELEGATION_TRAVERSAL_DEPTH = 5;
const AGENT_PROTOCOLS = new Set<AgentProtocol>([
  "openai_functions",
  "anthropic_tool_use",
  "google_genai",
  "aethelred_native",
  "custom",
]);

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export type AgentStatus = "pending" | "active" | "suspended" | "revoked";
export type AgentProtocol =
  | "openai_functions"
  | "anthropic_tool_use"
  | "google_genai"
  | "aethelred_native"
  | "custom";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "consumed";
export type DelegationConstraint =
  | "time_bounded"
  | "action_scoped"
  | "resource_scoped"
  | "risk_bounded"
  | "rate_limited"
  | "approval_required";

export interface AgentIdentityRegistration {
  operatorId: string; // identity ID of the human operator
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  capabilities: AgentCapability[];
  publicKey: string; // agent's cryptographic public key
  maxDelegationDepth: number; // how many levels of sub-delegation allowed
  teeRequired: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  name: string;
  description: string;
  resourceTypes: string[]; // e.g., ['credential', 'verification', 'identity']
  actions: string[]; // e.g., ['read', 'create', 'verify', 'present']
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean; // human-in-the-loop for this capability
  rateLimit?: { maxPerHour: number; maxPerDay: number };
}

export interface AgentIdentity {
  agentId: string;
  did: string; // did:aethelred:agent:<identifier>
  operatorId: string;
  /** Durable DID binding for the current controlling Identity. */
  controllerDid: string;
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
  /** Security-state version; telemetry updates never change it. */
  authorizationVersion: number;
}

interface AgentStats {
  totalActions: number;
  successRate?: number;
  averageLatencyMs?: number;
}

export interface DelegationChain {
  delegationId: string;
  fromAgentId: string; // delegator
  toAgentId: string; // delegate
  capabilities: string[]; // subset of delegator's capabilities
  constraints: DelegationConstraintSpec[];
  depth: number; // current chain depth
  maxDepth: number;
  status: "active" | "expired" | "revoked";
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  parentDelegationId?: string; // for tracking chains
  /** Internal optimistic-concurrency version; routes do not expose it. */
  recordVersion: number;
}

export interface AgentDelegationRevocation {
  delegation: DelegationChain;
  revokedDelegationIds: string[];
}

export interface DelegationConstraintSpec {
  type: DelegationConstraint;
  parameters: Record<string, unknown>;
}

export interface AgentOperationContext {
  operationId: string;
  callerAgentId?: string;
  callerProtocol?: AgentProtocol;
  purpose: string;
  resourceId: string;
  resourceType: string;
  action: string;
}

export interface AgentVerificationChallenge {
  challengeId: string;
  agentId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  audience: string;
  requestedCapabilities: string[];
  context: AgentOperationContext;
  approvalGroupId?: string;
}

export interface AgentChallengeIssueRequest {
  requestedCapabilities: string[];
  context: AgentOperationContext;
  approvalGroupId?: string;
}

export interface AgentVerificationRequest extends AgentVerificationChallenge {
  signature: string; // signature of the canonical verification payload
}

export interface AgentVerificationResult {
  verificationId: string;
  agentId: string;
  verified: boolean;
  authorizedCapabilities: string[];
  deniedCapabilities: { name: string; reason: string }[];
  delegationChain?: string[]; // chain of agent IDs if delegated
  approvalGroupId?: string;
  teeAttested: boolean;
  expiresAt: Date;
  details: string[];
}

export interface HumanApprovalRequest {
  requestId: string;
  approvalGroupId: string;
  operationId: string;
  operationDigest: string;
  authorizationSnapshotDigest: string;
  requestedCapabilities: string[];
  requiredApproverIds: string[];
  agentId: string;
  audienceId: string;
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  riskLevel: string;
  context: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
  respondedAt?: Date;
  respondedBy?: string;
  responseNote?: string;
  consumedAt?: Date;
  consumedByChallengeId?: string;
  /** Internal optimistic-concurrency version; routes do not expose it. */
  recordVersion: number;
}

interface AuthorizationRateLimit {
  ownerAgentId: string;
  scopeKey: string;
  delegationId?: string;
  maxPerHour?: number;
  maxPerDay?: number;
}

type CapabilityGrantDecision =
  | { authorized: false; reason: string }
  | {
      authorized: true;
      capability: AgentCapability;
      requiredApproverIds: string[];
      delegationChain?: string[];
      rateLimits: AuthorizationRateLimit[];
      validUntil?: Date;
      snapshot: AuthorizationSnapshot;
      path?: DelegationPath;
    };

interface DelegationPath {
  delegations: DelegationChain[];
  agentIds: string[];
  agents: AgentIdentity[];
  rootCapability: AgentCapability;
}

interface AuthorizationSnapshot {
  agents: Array<{ agentId: string; authorizationVersion: number }>;
  delegations: Array<{ delegationId: string; recordVersion: number }>;
  rootAgentId: string;
  capabilityFingerprint: string;
}

type DelegationAuthorityDatabase = Pick<
  Prisma.TransactionClient,
  "aIAgent" | "agentDelegation"
>;

interface ResolvedCapabilityGrant {
  capabilityName: string;
  grant: Extract<CapabilityGrantDecision, { authorized: true }>;
}

interface FinalAuthorizationOutcome {
  challengeConsumed: boolean;
  authorizedCapabilities: string[];
  deniedCapabilities: { name: string; reason: string }[];
  delegationChain?: string[];
  approvalGroupId?: string;
  expiresAt: Date;
}

class AuthorizationTransactionAbort extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "AuthorizationTransactionAbort";
  }
}

export interface AgentAuditEntry {
  entryId: string;
  agentId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
  anomalyDetected: boolean;
  anomalyDetails?: string;
  timestamp: Date;
}

export function buildAgentVerificationSigningPayload(
  request: Omit<AgentVerificationRequest, "signature">,
): string {
  return JSON.stringify({
    version: "zeroid-agent-verification-v2",
    challengeId: request.challengeId,
    agentId: request.agentId,
    nonce: request.nonce,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    audience: request.audience,
    approvalGroupId: request.approvalGroupId ?? null,
    requestedCapabilities: [...request.requestedCapabilities].sort(),
    context: {
      operationId: request.context.operationId,
      callerAgentId: request.context.callerAgentId ?? null,
      callerProtocol: request.context.callerProtocol ?? null,
      purpose: request.context.purpose,
      resourceId: request.context.resourceId,
      resourceType: request.context.resourceType,
      action: request.context.action,
    },
  });
}

export function buildAgentOperationDigest(
  operation: Pick<
    AgentVerificationChallenge,
    "agentId" | "audience" | "requestedCapabilities" | "context"
  >,
): string {
  const canonical = JSON.stringify({
    version: "zeroid-agent-operation-v1",
    agentId: operation.agentId,
    audience: operation.audience,
    requestedCapabilities: [...operation.requestedCapabilities].sort(),
    context: {
      operationId: operation.context.operationId,
      callerAgentId: operation.context.callerAgentId ?? null,
      callerProtocol: operation.context.callerProtocol ?? null,
      purpose: operation.context.purpose,
      resourceId: operation.context.resourceId,
      resourceType: operation.context.resourceType,
      action: operation.context.action,
    },
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Agent Identity Service
// ---------------------------------------------------------------------------

export class AgentIdentityService {
  // -------------------------------------------------------------------------
  // Register a new AI agent identity
  // -------------------------------------------------------------------------
  async registerAgent(
    registration: AgentIdentityRegistration,
  ): Promise<AgentIdentity> {
    const agentId = `agent-${crypto.randomUUID()}`;
    const identifier = crypto.randomBytes(16).toString("hex");
    const did = `did:aethelred:agent:${identifier}`;

    logger.info("agent_registration_start", {
      agentId,
      operatorId: registration.operatorId,
      agentName: registration.agentName,
      protocol: registration.agentProtocol,
    });

    if (registration.teeRequired) {
      throw new AgentIdentityError(
        "TEE-required agent registration is unavailable until enrollment and attestation verification are implemented",
        "TEE_ENROLLMENT_UNAVAILABLE",
        501,
      );
    }
    if (!AGENT_PROTOCOLS.has(registration.agentProtocol)) {
      throw new AgentIdentityError(
        "Agent protocol is not supported",
        "AGENT_PROTOCOL_INVALID",
        400,
      );
    }
    if (
      !Number.isSafeInteger(registration.maxDelegationDepth) ||
      registration.maxDelegationDepth < 0 ||
      registration.maxDelegationDepth > MAX_DELEGATION_TRAVERSAL_DEPTH
    ) {
      throw new AgentIdentityError(
        `Maximum delegation depth must be an integer between 0 and ${MAX_DELEGATION_TRAVERSAL_DEPTH}`,
        "DELEGATION_DEPTH_INVALID",
        400,
      );
    }

    let canonicalPublicKey: string;
    try {
      const verificationKey = this.parseVerificationKey(registration.publicKey);
      if (verificationKey.asymmetricKeyType !== "ed25519") {
        throw new Error("Unsupported key type");
      }
      canonicalPublicKey = verificationKey
        .export({ type: "spki", format: "pem" })
        .toString();
    } catch {
      throw new AgentIdentityError(
        "Agent registration requires a valid Ed25519 public key",
        "AGENT_PUBLIC_KEY_INVALID",
        400,
      );
    }

    // Verify the operator identity exists and is active
    const operator = await prisma.identity.findUnique({
      where: { id: registration.operatorId },
      select: { id: true, did: true, status: true },
    });

    if (!operator || operator.status !== "ACTIVE") {
      throw new AgentIdentityError(
        "Operator identity not found or not active",
        "OPERATOR_INVALID",
        403,
      );
    }

    // Validate capabilities
    for (const cap of registration.capabilities) {
      if (cap.riskLevel === "critical" && !cap.requiresApproval) {
        throw new AgentIdentityError(
          `Critical capability "${cap.name}" must require human approval`,
          "CRITICAL_CAP_NO_APPROVAL",
          400,
        );
      }
    }
    this.validateRequestedCapabilities(registration.capabilities);

    const publicKeyHash = crypto
      .createHash("sha256")
      .update(canonicalPublicKey)
      .digest("hex");

    const maxDelegationDepth = registration.maxDelegationDepth;
    const persisted = await prisma.$transaction(async (tx) => {
      const created = await tx.aIAgent.create({
        data: {
          id: agentId,
          agentDid: did,
          name: registration.agentName,
          description: registration.agentDescription,
          operatorId: registration.operatorId,
          controllerDid: operator.did,
          riskTier: "LOW",
          // Preserve the existing public protocol while keeping agentType
          // compatible with consumers that predate the dedicated column.
          agentType: registration.agentProtocol,
          agentProtocol: registration.agentProtocol,
          publicKey: canonicalPublicKey,
          publicKeyHash,
          capabilities: registration.capabilities as any,
          maxDelegationDepth,
          status: "ACTIVE",
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
          action: "AGENT_REGISTERED" as any,
          resourceType: "agent_identity",
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

    logger.info("agent_registered", {
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
    const persisted = await prisma.aIAgent.findUnique({
      where: { id: agentId },
    });
    if (!persisted) {
      throw new AgentIdentityError("Agent not found", "AGENT_NOT_FOUND", 404);
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
      orderBy: { createdAt: "desc" },
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
        "Only the agent operator can update capabilities",
        "UNAUTHORIZED_CAPABILITY_UPDATE",
        403,
      );
    }

    // Validate critical capabilities
    for (const cap of capabilities) {
      if (cap.riskLevel === "critical" && !cap.requiresApproval) {
        throw new AgentIdentityError(
          `Critical capability "${cap.name}" must require human approval`,
          "CRITICAL_CAP_NO_APPROVAL",
          400,
        );
      }
    }
    this.validateRequestedCapabilities(capabilities);

    const previousCapabilities = agent.capabilities.map((c) => c.name);
    const changedAt = new Date();
    const outcome = await prisma.$transaction(
      async (tx) => {
        const controller = await tx.identity.findUnique({
          where: { id: requestedBy },
          select: { did: true, status: true },
        });
        if (
          !controller ||
          controller.status !== "ACTIVE" ||
          controller.did !== agent.controllerDid
        ) {
          throw new AgentIdentityError(
            "Agent controller identity is inactive or no longer matches",
            "AGENT_CONTROLLER_INVALID",
            403,
          );
        }
        const updated = await tx.aIAgent.updateMany({
          where: {
            id: agentId,
            operatorId: requestedBy,
            authorizationVersion: agent.authorizationVersion,
          },
          data: {
            capabilities: capabilities as any,
            humanApprovalRequired: capabilities.some(
              (capability) => capability.requiresApproval,
            ),
            version: { increment: 1 },
            authorizationVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new AgentIdentityError(
            "Agent was updated concurrently; reload before changing capabilities",
            "AGENT_CONCURRENT_UPDATE",
            409,
          );
        }

        const affectedDelegations =
          await this.collectOutgoingDelegationTreeInTransaction(tx, agentId);
        await this.revokeDelegationRowsInTransaction(
          tx,
          affectedDelegations,
          requestedBy,
          changedAt,
        );

        const row = await tx.aIAgent.findUnique({ where: { id: agentId } });
        if (!row) {
          throw new AgentIdentityError(
            "Agent not found",
            "AGENT_NOT_FOUND",
            404,
          );
        }

        await tx.auditLog.create({
          data: {
            identityId: agent.operatorId,
            action: "AGENT_CAPABILITIES_UPDATED" as any,
            resourceType: "agent_identity",
            resourceId: agentId,
            details: {
              previousCapabilities,
              newCapabilities: capabilities.map((c) => c.name),
              updatedBy: requestedBy,
              revokedDelegationIds: affectedDelegations.map((row) => row.id),
            },
          },
        });

        return { row, affectedDelegations };
      },
      { isolationLevel: "Serializable" },
    );
    const updatedAgent = this.fromPrismaAgent(outcome.row);
    await this.cacheAgent(updatedAgent);
    await Promise.all(
      Array.from(
        new Set(
          outcome.affectedDelegations.flatMap((row) => [
            row.fromAgentId,
            row.toAgentId,
          ]),
        ),
      ).map((affectedAgentId) =>
        this.invalidateDelegationCacheBestEffort(affectedAgentId),
      ),
    );

    logger.info("agent_capabilities_updated", {
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
    if (fromAgentId === toAgentId) {
      throw new AgentIdentityError(
        "An agent cannot delegate capabilities to itself",
        "DELEGATION_CYCLE",
        400,
      );
    }
    if (
      capabilities.length === 0 ||
      capabilities.some((capability) => !capability.trim()) ||
      new Set(capabilities).size !== capabilities.length
    ) {
      throw new AgentIdentityError(
        "Delegated capabilities must be non-empty and unique",
        "DELEGATION_CAPABILITIES_INVALID",
        400,
      );
    }
    if (
      !Number.isFinite(durationHours) ||
      durationHours < 0.1 ||
      durationHours > 8760
    ) {
      throw new AgentIdentityError(
        "Delegation duration must be between 0.1 and 8760 hours",
        "DELEGATION_DURATION_INVALID",
        400,
      );
    }

    const delegationId = `del-${crypto.randomUUID()}`;
    let persisted: PrismaAgentDelegation;
    try {
      persisted = await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const [fromRow, toRow, requester] = await Promise.all([
            tx.aIAgent.findUnique({ where: { id: fromAgentId } }),
            tx.aIAgent.findUnique({ where: { id: toAgentId } }),
            tx.identity.findUnique({
              where: { id: requestedBy },
              select: { id: true, did: true, status: true },
            }),
          ]);
          if (!fromRow || !toRow) {
            throw new AgentIdentityError(
              "Source or target agent not found",
              "AGENT_NOT_FOUND",
              404,
            );
          }
          const fromAgent = this.fromPrismaAgent(fromRow);
          const toAgent = this.fromPrismaAgent(toRow);
          if (
            fromAgent.operatorId !== requestedBy ||
            !requester ||
            requester.status !== "ACTIVE" ||
            requester.did !== fromAgent.controllerDid
          ) {
            throw new AgentIdentityError(
              "Only the active current controller can create delegations",
              "UNAUTHORIZED_DELEGATION",
              403,
            );
          }
          if (fromAgent.status !== "active" || toAgent.status !== "active") {
            throw new AgentIdentityError(
              "Delegations require active source and target agents",
              "DELEGATION_AGENT_INACTIVE",
              409,
            );
          }
          if (
            !(await this.hasActiveAgentControllerInTransaction(tx, toAgentId))
          ) {
            throw new AgentIdentityError(
              "Target agent controller identity is inactive or mismatched",
              "DELEGATION_AGENT_INACTIVE",
              409,
            );
          }

          const authority = await this.resolveDelegationCreationAuthority(
            fromAgent,
            capabilities,
            now,
            tx,
          );
          for (const authorityAgentId of authority.chainAgentIds) {
            if (
              !(await this.hasActiveAgentControllerInTransaction(
                tx,
                authorityAgentId,
              ))
            ) {
              throw new AgentIdentityError(
                "Delegation authority path contains an inactive or mismatched controller",
                "DELEGATION_AGENT_INACTIVE",
                409,
              );
            }
          }
          if (authority.chainAgentIds.includes(toAgentId)) {
            throw new AgentIdentityError(
              "Delegation would introduce a cycle",
              "DELEGATION_CYCLE",
              400,
            );
          }
          const requestedExpiresAt = new Date(
            now.getTime() + durationHours * 3600_000,
          );
          const expiresAt =
            authority.authorityExpiresAt &&
            authority.authorityExpiresAt < requestedExpiresAt
              ? authority.authorityExpiresAt
              : requestedExpiresAt;
          const normalizedConstraints = this.normalizeDelegationConstraints(
            constraints,
            now,
            expiresAt,
          );
          const created = await tx.agentDelegation.create({
            data: {
              id: delegationId,
              fromAgentId,
              toAgentId,
              capabilities,
              constraints: normalizedConstraints as any,
              depth: authority.depth,
              maxDepth: authority.maxDepth,
              status: "ACTIVE",
              parentDelegationId: authority.parentDelegationId,
              createdAt: now,
              expiresAt,
            },
          });

          await tx.auditLog.create({
            data: {
              identityId: requestedBy,
              action: "AGENT_DELEGATION_CREATED" as any,
              resourceType: "delegation",
              resourceId: delegationId,
              details: {
                fromAgentId,
                toAgentId,
                capabilities,
                constraints: normalizedConstraints.map(
                  (constraint) => constraint.type,
                ),
                depth: authority.depth,
                maxDepth: authority.maxDepth,
                parentDelegationId: authority.parentDelegationId,
                expiresAt,
              },
            },
          });
          return created;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if ((error as { code?: string }).code === "P2034") {
        throw new AgentIdentityError(
          "Delegation authority changed concurrently; retry from fresh state",
          "DELEGATION_CONCURRENT_UPDATE",
          409,
        );
      }
      throw error;
    }
    const delegation = this.fromPrismaDelegation(persisted);
    await this.cacheDelegation(delegation);

    logger.info("delegation_created", {
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
  // Revoke one delegation and every grant derived from it
  // -------------------------------------------------------------------------
  async revokeDelegation(
    delegationId: string,
    requestedBy: string,
    expectedFromAgentId?: string,
  ): Promise<AgentDelegationRevocation> {
    const revokedAt = new Date();
    const outcome = await prisma.$transaction(
      async (tx) => {
        const root = await tx.agentDelegation.findUnique({
          where: { id: delegationId },
        });
        if (!root) {
          throw new AgentIdentityError(
            "Delegation not found",
            "DELEGATION_NOT_FOUND",
            404,
          );
        }
        if (expectedFromAgentId && root.fromAgentId !== expectedFromAgentId) {
          throw new AgentIdentityError(
            "Delegation not found for this source agent",
            "DELEGATION_NOT_FOUND",
            404,
          );
        }
        const source = await tx.aIAgent.findUnique({
          where: { id: root.fromAgentId },
        });
        if (!source) {
          throw new AgentIdentityError(
            "Delegation source agent not found",
            "AGENT_NOT_FOUND",
            404,
          );
        }
        const sourceAgent = this.fromPrismaAgent(source);
        const controller = await tx.identity.findUnique({
          where: { id: requestedBy },
          select: { did: true, status: true },
        });
        if (
          sourceAgent.operatorId !== requestedBy ||
          !controller ||
          controller.status !== "ACTIVE" ||
          controller.did !== sourceAgent.controllerDid
        ) {
          throw new AgentIdentityError(
            "Only the active source-agent controller can revoke this delegation",
            "UNAUTHORIZED_DELEGATION_REVOCATION",
            403,
          );
        }
        if (root.status !== "ACTIVE") {
          throw new AgentIdentityError(
            `Delegation is already ${root.status.toLowerCase()}`,
            "DELEGATION_NOT_ACTIVE",
            409,
          );
        }

        const affectedDelegations = (
          await this.collectDelegationTreeInTransaction(tx, [root])
        ).filter((row) => row.status === "ACTIVE");
        await this.revokeDelegationRowsInTransaction(
          tx,
          affectedDelegations,
          requestedBy,
          revokedAt,
        );
        await tx.auditLog.create({
          data: {
            identityId: requestedBy,
            action: "DELEGATION_REVOKED",
            resourceType: "agent_delegation",
            resourceId: delegationId,
            details: {
              fromAgentId: root.fromAgentId,
              toAgentId: root.toAgentId,
              revokedBy: requestedBy,
              revokedAt,
              revokedDelegationIds: affectedDelegations.map((row) => row.id),
              descendantCount: Math.max(0, affectedDelegations.length - 1),
            },
          },
        });
        const persisted = await tx.agentDelegation.findUnique({
          where: { id: delegationId },
        });
        if (!persisted) {
          throw new AgentIdentityError(
            "Delegation not found after revocation",
            "DELEGATION_NOT_FOUND",
            404,
          );
        }
        return { persisted, affectedDelegations };
      },
      { isolationLevel: "Serializable" },
    );

    await Promise.all(
      Array.from(
        new Set(
          outcome.affectedDelegations.flatMap((row) => [
            row.fromAgentId,
            row.toAgentId,
          ]),
        ),
      ).map((agentId) => this.invalidateDelegationCacheBestEffort(agentId)),
    );
    return {
      delegation: this.fromPrismaDelegation(outcome.persisted),
      revokedDelegationIds: outcome.affectedDelegations.map((row) => row.id),
    };
  }

  // -------------------------------------------------------------------------
  // Issue a durable, audience- and operation-bound verification challenge
  // -------------------------------------------------------------------------
  async issueVerificationChallenge(
    agentId: string,
    audienceId: string,
    input: AgentChallengeIssueRequest,
  ): Promise<AgentVerificationChallenge> {
    this.validateAgentOperationInput(
      input.requestedCapabilities,
      input.context,
    );
    const [agent, audience] = await Promise.all([
      this.getAgent(agentId),
      prisma.identity.findUnique({
        where: { id: audienceId },
        select: { id: true, did: true, status: true },
      }),
    ]);
    if (agent.status !== "active") {
      throw new AgentIdentityError(
        `Agent status is ${agent.status}`,
        "AGENT_NOT_ACTIVE",
        409,
      );
    }
    if (!audience || audience.status !== "ACTIVE") {
      throw new AgentIdentityError(
        "Challenge audience is not an active identity",
        "CHALLENGE_AUDIENCE_INVALID",
        403,
      );
    }
    const controller =
      agent.operatorId === audienceId
        ? audience
        : await prisma.identity.findUnique({
            where: { id: agent.operatorId },
            select: { id: true, did: true, status: true },
          });
    if (
      !controller ||
      controller.status !== "ACTIVE" ||
      controller.did !== agent.controllerDid
    ) {
      throw new AgentIdentityError(
        "Agent controller identity is not active or no longer matches",
        "AGENT_CONTROLLER_INVALID",
        403,
      );
    }
    await this.enforceAudienceSignatureFailureLimit(audienceId, agentId);
    if (input.context.callerAgentId) {
      const caller = await this.getAgent(input.context.callerAgentId);
      if (
        caller.status !== "active" ||
        caller.operatorId !== audienceId ||
        caller.controllerDid !== audience.did
      ) {
        throw new AgentIdentityError(
          "Authenticated audience does not control the asserted caller agent",
          "CHALLENGE_CALLER_INVALID",
          403,
        );
      }
    }

    const operationDigest = buildAgentOperationDigest({
      agentId,
      audience: audienceId,
      requestedCapabilities: input.requestedCapabilities,
      context: input.context,
    });
    const existingOperation =
      await prisma.agentAuthorizationOperation.findUnique({
        where: {
          agentId_audienceId_operationId: {
            agentId,
            audienceId,
            operationId: input.context.operationId,
          },
        },
      });
    if (existingOperation) {
      if (existingOperation.operationDigest !== operationDigest) {
        throw new AgentIdentityError(
          "Operation ID is already bound to different signed operation data",
          "AGENT_OPERATION_CONFLICT",
          409,
        );
      }
      if (existingOperation.status === "AUTHORIZED") {
        throw new AgentIdentityError(
          "Operation has already been authorized",
          "AGENT_OPERATION_ALREADY_AUTHORIZED",
          409,
        );
      }
      if (
        !input.approvalGroupId ||
        input.approvalGroupId !== existingOperation.approvalGroupId
      ) {
        throw new AgentIdentityError(
          "Operation is awaiting its bound approval group",
          "AGENT_OPERATION_APPROVAL_REQUIRED",
          409,
        );
      }
    } else if (input.approvalGroupId) {
      throw new AgentIdentityError(
        "Approval group is not bound to a pending operation",
        "APPROVAL_GROUP_INVALID",
        409,
      );
    }
    if (input.approvalGroupId) {
      await this.validateApprovalGroupForChallenge(
        input.approvalGroupId,
        agentId,
        audienceId,
        operationDigest,
      );
    }

    const challengeId = `ach-${crypto.randomUUID()}`;
    const nonce = crypto.randomBytes(32).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + AGENT_VERIFICATION_CHALLENGE_TTL_MS,
    );
    await prisma.agentVerificationChallenge.create({
      data: {
        id: challengeId,
        agentId,
        audienceId,
        nonceHash: this.hashChallengeNonce(challengeId, nonce),
        operationId: input.context.operationId,
        operationDigest,
        requestedCapabilities: [...input.requestedCapabilities].sort(),
        context: input.context as any,
        approvalGroupId: input.approvalGroupId,
        status: "ISSUED",
        issuedAt,
        expiresAt,
      },
    });

    return {
      challengeId,
      agentId,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      audience: audienceId,
      requestedCapabilities: [...input.requestedCapabilities],
      context: { ...input.context },
      approvalGroupId: input.approvalGroupId,
    };
  }

  // -------------------------------------------------------------------------
  // Verify agent identity and atomically authorize one issued operation
  // -------------------------------------------------------------------------
  async verifyAgent(
    request: AgentVerificationRequest,
    authenticatedAudienceId: string,
  ): Promise<AgentVerificationResult> {
    const verificationId = `av-${crypto.randomUUID()}`;
    const startTime = performance.now();
    this.validateAgentOperationInput(
      request.requestedCapabilities,
      request.context,
    );
    const challenge = await this.getIssuedVerificationChallenge(
      request,
      authenticatedAudienceId,
    );
    const agent = await this.getAgent(request.agentId);
    const details: string[] = [];

    const signatureValid = this.verifySignature(
      buildAgentVerificationSigningPayload(request),
      request.signature,
      agent.publicKey,
    );
    if (!signatureValid) {
      const failedAttempt = await this.consumeInvalidSignatureChallenge(
        challenge,
        request,
        authenticatedAudienceId,
        verificationId,
      );
      if (!failedAttempt.consumed) {
        throw new AgentIdentityError(
          "Verification challenge has already been consumed",
          "AGENT_CHALLENGE_ALREADY_USED",
          409,
        );
      }
      logger.warn("agent_signature_rejected", {
        agentId: request.agentId,
        audienceId: authenticatedAudienceId,
        challengeId: request.challengeId,
        audienceFailureCount: failedAttempt.failureCount,
      });
      return this.deniedVerificationResult(
        verificationId,
        request,
        agent,
        "Signature verification failed",
        ["Cryptographic signature verification failed"],
      );
    }
    details.push("Cryptographic signature verified");

    const resolved: ResolvedCapabilityGrant[] = [];
    const denied: { name: string; reason: string }[] = [];
    let selectedDelegationChain: string[] | undefined;
    for (const capabilityName of request.requestedCapabilities) {
      const grant = await this.resolveCapabilityGrant(
        agent,
        capabilityName,
        request,
      );
      if (!grant.authorized) {
        denied.push({ name: capabilityName, reason: grant.reason });
        continue;
      }
      if (
        grant.delegationChain &&
        selectedDelegationChain &&
        !this.sameDelegationChain(
          grant.delegationChain,
          selectedDelegationChain,
        )
      ) {
        denied.push({
          name: capabilityName,
          reason: "Capability resolves through a different delegation path",
        });
        continue;
      }
      if (grant.delegationChain) {
        selectedDelegationChain = grant.delegationChain;
      }
      resolved.push({ capabilityName, grant });
    }

    const finalized = await this.finalizeAuthorization(
      verificationId,
      request,
      challenge,
      agent,
      resolved,
      denied,
    );
    if (!finalized.challengeConsumed) {
      return this.deniedVerificationResult(
        verificationId,
        request,
        agent,
        "Challenge has already been used or expired",
        [...details, "Durable one-time challenge consumption failed"],
      );
    }

    const verified = finalized.authorizedCapabilities.length > 0;
    const latencyMs = performance.now() - startTime;
    try {
      await this.recordVerificationStats(agent.agentId, latencyMs, verified);
    } catch (error) {
      // Authorization and one-time approval redemption have already committed.
      // Telemetry must not turn that durable result into a retryable API error.
      logger.warn("agent_verification_stats_write_failed", {
        agentId: agent.agentId,
        verificationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (finalized.delegationChain) {
      details.push(
        `Delegation chain: ${finalized.delegationChain.join(" -> ")}`,
      );
    }
    details.push(
      `Authorized: ${finalized.authorizedCapabilities.length}/${request.requestedCapabilities.length} capabilities`,
    );

    logger.info("agent_verification_complete", {
      verificationId,
      agentId: request.agentId,
      audienceId: authenticatedAudienceId,
      operationDigest: challenge.operationDigest,
      verified,
      authorizedCount: finalized.authorizedCapabilities.length,
      deniedCount: finalized.deniedCapabilities.length,
      latencyMs: latencyMs.toFixed(2),
    });

    return {
      verificationId,
      agentId: request.agentId,
      verified,
      authorizedCapabilities: finalized.authorizedCapabilities,
      deniedCapabilities: finalized.deniedCapabilities,
      delegationChain: finalized.delegationChain,
      approvalGroupId: finalized.approvalGroupId,
      teeAttested: false,
      expiresAt: verified ? finalized.expiresAt : new Date(),
      details,
    };
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
        "Not authorized to suspend this agent",
        "UNAUTHORIZED_SUSPENSION",
        403,
      );
    }

    return this.applySuspension(agent, suspendedBy, reason, "operator");
  }

  /** Durable owner-authorized suspension transition. */
  private async applySuspension(
    current: AgentIdentity,
    suspendedBy: string,
    reason: string,
    source: "operator",
  ): Promise<AgentIdentity> {
    if (current.status === "suspended") return current;
    if (current.status !== "active") {
      throw new AgentIdentityError(
        `Agent status ${current.status} cannot transition to suspended`,
        "AGENT_STATUS_INVALID",
        409,
      );
    }

    const suspendedAt = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.aIAgent.updateMany({
        where: { id: current.agentId, status: "ACTIVE" },
        data: {
          status: "SUSPENDED",
          suspendedAt,
          suspendedBy,
          suspensionReason: reason,
          version: { increment: 1 },
          authorizationVersion: { increment: 1 },
        },
      });

      const row = await tx.aIAgent.findUnique({
        where: { id: current.agentId },
      });
      if (!row) {
        throw new AgentIdentityError("Agent not found", "AGENT_NOT_FOUND", 404);
      }

      const revokedDelegations =
        transitioned.count === 1
          ? await tx.agentDelegation.updateMany({
              where: {
                status: "ACTIVE",
                OR: [
                  { fromAgentId: current.agentId },
                  { toAgentId: current.agentId },
                ],
              },
              data: {
                status: "REVOKED",
                revokedAt: suspendedAt,
                revokedBy: suspendedBy,
                version: { increment: 1 },
              },
            })
          : { count: 0 };

      if (transitioned.count === 1) {
        await tx.auditLog.create({
          data: {
            // Anchor the event to the owning tenant. The actual actor and source
            // are explicit in details; no synthetic Identity/admin is created.
            identityId: row.operatorId,
            action: "AGENT_SUSPENDED" as any,
            resourceType: "agent_identity",
            resourceId: current.agentId,
            details: {
              suspendedBy,
              reason,
              source,
              automatic: false,
              anomalyCount: row.anomalyCount,
              revokedDelegations: revokedDelegations.count,
              delegationEnforcement: "prisma_status_and_revocation",
            },
          },
        });
      }

      return { row, revokedDelegations: revokedDelegations.count };
    });

    const suspended = this.fromPrismaAgent(outcome.row);
    await this.cacheAgent(suspended);
    await this.invalidateDelegationCacheBestEffort(suspended.agentId);

    logger.warn("agent_suspended", {
      agentId: suspended.agentId,
      suspendedBy,
      reason,
      source,
      revokedDelegations: outcome.revokedDelegations,
    });

    return suspended;
  }

  // -------------------------------------------------------------------------
  // Get agent audit trail
  // -------------------------------------------------------------------------
  async getAgentAudit(agentId: string, limit = 50): Promise<AgentAuditEntry[]> {
    const agent = await this.getAgent(agentId);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await prisma.auditLog.findMany({
      where: {
        identityId: agent.operatorId,
        OR: [
          { resourceId: agentId },
          { details: { path: ["agentId"], equals: agentId } },
        ],
      },
      orderBy: { timestamp: "desc" },
      take: boundedLimit,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        details: true,
        timestamp: true,
      },
    });

    return rows.map((row) => {
      const details =
        row.details &&
        typeof row.details === "object" &&
        !Array.isArray(row.details)
          ? (row.details as Record<string, unknown>)
          : {};
      const latencyMs =
        typeof details.latencyMs === "number" &&
        Number.isFinite(details.latencyMs)
          ? details.latencyMs
          : undefined;
      const error =
        typeof details.reason === "string"
          ? details.reason
          : typeof details.error === "string"
            ? details.error
            : undefined;
      const anomalyDetails =
        typeof details.anomalyDetails === "string"
          ? details.anomalyDetails
          : undefined;

      return {
        entryId: row.id,
        agentId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        success: ![
          "VERIFICATION_FAILED",
          "AGENT_ACTION_REJECTED",
          "AUTH_FAILED",
        ].includes(row.action),
        ...(latencyMs === undefined ? {} : { latencyMs }),
        ...(error ? { error } : {}),
        anomalyDetected: details.anomalyDetected === true,
        ...(anomalyDetails ? { anomalyDetails } : {}),
        timestamp: row.timestamp,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Human-in-the-loop approval workflows
  // -------------------------------------------------------------------------
  async respondToApproval(
    requestId: string,
    respondedBy: string,
    approved: boolean,
    note: string,
  ): Promise<HumanApprovalRequest> {
    if (!note.trim() || note.length > 1000) {
      throw new AgentIdentityError(
        "Approval response note must contain 1 to 1000 characters",
        "APPROVAL_NOTE_INVALID",
        400,
      );
    }
    const request = await this.getApprovalRequest(requestId);
    if (!request) {
      throw new AgentIdentityError(
        "Approval request not found",
        "APPROVAL_NOT_FOUND",
        404,
      );
    }

    if (request.operatorId !== respondedBy) {
      throw new AgentIdentityError(
        "Only the operator can respond to approval requests",
        "UNAUTHORIZED_APPROVAL",
        403,
      );
    }
    if (request.status === "expired") {
      throw new AgentIdentityError(
        "Approval request has expired",
        "APPROVAL_EXPIRED",
        410,
      );
    }

    const now = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      if (request.status === "pending" && request.expiresAt <= now) {
        await tx.agentApprovalRequest.updateMany({
          where: {
            id: requestId,
            operatorId: respondedBy,
            status: "PENDING",
            version: request.recordVersion,
          },
          data: { status: "EXPIRED", version: { increment: 1 } },
        });
        return { kind: "expired" as const };
      }

      if (request.status !== "pending") {
        return { kind: "resolved" as const };
      }

      const updated = await tx.agentApprovalRequest.updateMany({
        where: {
          id: requestId,
          operatorId: respondedBy,
          status: "PENDING",
          version: request.recordVersion,
          expiresAt: { gt: now },
        },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          respondedAt: now,
          respondedBy,
          responseNote: note,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await tx.agentApprovalRequest.findUnique({
          where: { id: requestId },
        });
        return {
          kind:
            latest?.status === "EXPIRED" ||
            (latest?.status === "PENDING" && latest.expiresAt <= now)
              ? ("expired" as const)
              : ("resolved" as const),
        };
      }

      const persisted = await tx.agentApprovalRequest.findUnique({
        where: { id: requestId },
      });
      if (!persisted) {
        throw new AgentIdentityError(
          "Approval request not found",
          "APPROVAL_NOT_FOUND",
          404,
        );
      }

      await tx.auditLog.create({
        data: {
          identityId: respondedBy,
          action: (approved
            ? "AGENT_ACTION_APPROVED"
            : "AGENT_ACTION_REJECTED") as any,
          resourceType: "approval_request",
          resourceId: requestId,
          details: {
            agentId: request.agentId,
            action: request.action,
            approved,
            note,
          },
        },
      });
      return { kind: "updated" as const, persisted };
    });

    if (outcome.kind === "expired") {
      throw new AgentIdentityError(
        "Approval request has expired",
        "APPROVAL_EXPIRED",
        410,
      );
    }
    if (outcome.kind === "resolved") {
      throw new AgentIdentityError(
        "Approval request has already been resolved",
        "APPROVAL_ALREADY_RESOLVED",
        409,
      );
    }

    if (!("persisted" in outcome) || !outcome.persisted) {
      throw new AgentIdentityError(
        "Approval decision was not durably persisted",
        "AGENT_APPROVAL_RECORD_INVALID",
        503,
      );
    }
    const resolved = this.fromPrismaApprovalRequest(outcome.persisted);
    await this.cacheApprovalRequest(resolved);

    logger.info("approval_response", {
      requestId,
      agentId: request.agentId,
      approved,
      respondedBy,
    });

    return resolved;
  }

  async listPendingApprovals(
    operatorId: string,
  ): Promise<HumanApprovalRequest[]> {
    const now = new Date();
    await prisma.agentApprovalRequest.updateMany({
      where: {
        operatorId,
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
    const persisted = await prisma.agentApprovalRequest.findMany({
      where: {
        operatorId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    const approvals = persisted.map((row) =>
      this.fromPrismaApprovalRequest(row),
    );
    await Promise.all(
      approvals.map((approval) => this.cacheApprovalRequest(approval)),
    );
    return approvals;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private verifySignature(
    payload: string,
    signature: string,
    publicKey: string,
  ): boolean {
    try {
      const key = this.parseVerificationKey(publicKey);
      const sigBuffer = this.decodeSignature(signature);
      const message = Buffer.from(payload, "utf8");
      return (
        key.asymmetricKeyType === "ed25519" &&
        crypto.verify(null, message, key, sigBuffer)
      );
    } catch {
      return false;
    }
  }

  private validateAgentOperationInput(
    requestedCapabilities: string[],
    context: AgentOperationContext,
  ): void {
    if (
      !Array.isArray(requestedCapabilities) ||
      requestedCapabilities.length === 0 ||
      requestedCapabilities.length > 20 ||
      requestedCapabilities.some(
        (capability) =>
          typeof capability !== "string" ||
          capability.trim().length === 0 ||
          capability.length > 100,
      ) ||
      new Set(requestedCapabilities).size !== requestedCapabilities.length
    ) {
      throw new AgentIdentityError(
        "Requested capabilities must be non-empty and unique",
        "AGENT_OPERATION_INVALID",
        400,
      );
    }
    const requiredFields = [
      context?.operationId,
      context?.purpose,
      context?.resourceId,
      context?.resourceType,
      context?.action,
    ];
    if (
      requiredFields.some(
        (value) =>
          typeof value !== "string" ||
          value.trim().length === 0 ||
          value.length > 500,
      )
    ) {
      throw new AgentIdentityError(
        "Operation ID, purpose, action, resource type, and resource ID are required",
        "AGENT_OPERATION_INVALID",
        400,
      );
    }
  }

  private hashChallengeNonce(challengeId: string, nonce: string): string {
    return crypto
      .createHash("sha256")
      .update(`${challengeId}:${nonce}`)
      .digest("hex");
  }

  private verificationFailureWindowStart(now: Date): Date {
    const windowStart = new Date(now);
    windowStart.setUTCMinutes(0, 0, 0);
    return windowStart;
  }

  private async enforceAudienceSignatureFailureLimit(
    audienceId: string,
    agentId: string,
  ): Promise<void> {
    const usage = await prisma.agentVerificationFailureWindow.findUnique({
      where: {
        audienceId_agentId_windowStart: {
          audienceId,
          agentId,
          windowStart: this.verificationFailureWindowStart(new Date()),
        },
      },
      select: { count: true },
    });
    if (usage && usage.count >= MAX_AUDIENCE_SIGNATURE_FAILURES_PER_HOUR) {
      throw new AgentIdentityError(
        "Too many invalid signatures for this audience and target agent",
        "AGENT_AUDIENCE_RATE_LIMITED",
        429,
      );
    }
  }

  private async consumeInvalidSignatureChallenge(
    challenge: PrismaAgentVerificationChallenge,
    request: AgentVerificationRequest,
    audienceId: string,
    verificationId: string,
  ): Promise<{ consumed: boolean; failureCount: number }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const consumed = await tx.agentVerificationChallenge.updateMany({
              where: {
                id: challenge.id,
                agentId: request.agentId,
                audienceId,
                operationDigest: challenge.operationDigest,
                status: "ISSUED",
                version: challenge.version,
                expiresAt: { gt: now },
              },
              data: {
                status: "CONSUMED",
                consumedAt: now,
                version: { increment: 1 },
              },
            });
            if (consumed.count !== 1) {
              return { consumed: false, failureCount: 0 };
            }
            const usage = await tx.agentVerificationFailureWindow.upsert({
              where: {
                audienceId_agentId_windowStart: {
                  audienceId,
                  agentId: request.agentId,
                  windowStart: this.verificationFailureWindowStart(now),
                },
              },
              create: {
                audienceId,
                agentId: request.agentId,
                windowStart: this.verificationFailureWindowStart(now),
                count: 1,
                lastChallengeId: challenge.id,
              },
              update: {
                count: { increment: 1 },
                lastChallengeId: challenge.id,
              },
            });
            await this.recordVerificationAuditInTransaction(tx, {
              verificationId,
              operatorId: audienceId,
              request,
              challenge,
              authorizedCapabilities: [],
              deniedCapabilities: request.requestedCapabilities.map((name) => ({
                name,
                reason: "Signature verification failed",
              })),
              reason: "Signature verification failed",
            });
            return { consumed: true, failureCount: usage.count };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          (this.isAuditTailConflict(error) ||
            (error as { code?: string }).code === "P2034") &&
          attempt < 2
        ) {
          continue;
        }
        if (this.isAuditTailConflict(error)) {
          throw new AgentIdentityError(
            "Invalid-signature audit chain is contended; retry the same challenge",
            "AGENT_AUDIT_APPEND_CONFLICT",
            503,
          );
        }
        throw error;
      }
    }
    throw new AgentIdentityError(
      "Invalid-signature attempt could not be serialized safely",
      "AGENT_AUTHORIZATION_CONFLICT",
      503,
    );
  }

  private async getIssuedVerificationChallenge(
    request: AgentVerificationRequest,
    authenticatedAudienceId: string,
  ): Promise<PrismaAgentVerificationChallenge> {
    const row = await prisma.agentVerificationChallenge.findUnique({
      where: { id: request.challengeId },
    });
    if (!row) {
      throw new AgentIdentityError(
        "Server-issued verification challenge not found",
        "AGENT_CHALLENGE_NOT_FOUND",
        404,
      );
    }
    const issuedAt = new Date(request.issuedAt);
    const expiresAt = new Date(request.expiresAt);
    const operationDigest = buildAgentOperationDigest(request);
    const sortedRequested = [...request.requestedCapabilities].sort();
    const rowRequested = [...row.requestedCapabilities].sort();
    if (
      request.audience !== authenticatedAudienceId ||
      row.audienceId !== authenticatedAudienceId ||
      row.agentId !== request.agentId ||
      row.nonceHash !== this.hashChallengeNonce(row.id, request.nonce) ||
      !Number.isFinite(issuedAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      row.issuedAt.getTime() !== issuedAt.getTime() ||
      row.expiresAt.getTime() !== expiresAt.getTime() ||
      row.operationDigest !== operationDigest ||
      row.operationId !== request.context.operationId ||
      JSON.stringify(rowRequested) !== JSON.stringify(sortedRequested) ||
      (row.approvalGroupId ?? undefined) !== request.approvalGroupId
    ) {
      throw new AgentIdentityError(
        "Verification challenge does not match the authenticated operation",
        "AGENT_CHALLENGE_MISMATCH",
        400,
      );
    }
    const now = new Date();
    if (row.status === "ISSUED" && row.expiresAt <= now) {
      await prisma.agentVerificationChallenge.updateMany({
        where: { id: row.id, status: "ISSUED", version: row.version },
        data: { status: "EXPIRED", version: { increment: 1 } },
      });
      throw new AgentIdentityError(
        "Verification challenge has expired",
        "AGENT_CHALLENGE_EXPIRED",
        410,
      );
    }
    if (row.status !== "ISSUED") {
      throw new AgentIdentityError(
        "Verification challenge has already been consumed",
        "AGENT_CHALLENGE_ALREADY_USED",
        409,
      );
    }
    return row;
  }

  private async validateApprovalGroupForChallenge(
    approvalGroupId: string,
    agentId: string,
    audienceId: string,
    operationDigest: string,
  ): Promise<void> {
    const rows = await prisma.agentApprovalRequest.findMany({
      where: { approvalGroupId },
      orderBy: { operatorId: "asc" },
    });
    const now = new Date();
    if (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row.agentId !== agentId ||
          row.audienceId !== audienceId ||
          row.operationDigest !== operationDigest ||
          row.status !== "APPROVED" ||
          row.expiresAt <= now ||
          row.consumedAt !== null,
      )
    ) {
      throw new AgentIdentityError(
        "Approval group is not approved for this exact operation",
        "APPROVAL_GROUP_INVALID",
        409,
      );
    }
  }

  private deniedVerificationResult(
    verificationId: string,
    request: AgentVerificationRequest,
    agent: AgentIdentity,
    reason: string,
    details: string[],
  ): AgentVerificationResult {
    return {
      verificationId,
      agentId: request.agentId,
      verified: false,
      authorizedCapabilities: [],
      deniedCapabilities: request.requestedCapabilities.map((name) => ({
        name,
        reason,
      })),
      teeAttested: agent.teeAttested,
      expiresAt: new Date(),
      details,
    };
  }

  private async finalizeAuthorization(
    verificationId: string,
    request: AgentVerificationRequest,
    challenge: PrismaAgentVerificationChallenge,
    actingAgent: AgentIdentity,
    resolved: ResolvedCapabilityGrant[],
    initiallyDenied: { name: string; reason: string }[],
  ): Promise<FinalAuthorizationOutcome> {
    const denyAll = (reason: string): FinalAuthorizationOutcome => ({
      challengeConsumed: true,
      authorizedCapabilities: [],
      deniedCapabilities: request.requestedCapabilities.map((name) => {
        const specific = initiallyDenied.find((denied) => denied.name === name);
        return { name, reason: specific?.reason ?? reason };
      }),
      expiresAt: new Date(),
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const consumed = await tx.agentVerificationChallenge.updateMany({
              where: {
                id: challenge.id,
                agentId: request.agentId,
                audienceId: request.audience,
                operationDigest: challenge.operationDigest,
                status: "ISSUED",
                version: challenge.version,
                expiresAt: { gt: now },
              },
              data: {
                status: "CONSUMED",
                consumedAt: now,
                version: { increment: 1 },
              },
            });
            if (consumed.count !== 1) {
              return {
                ...denyAll("Challenge has already been used or expired"),
                challengeConsumed: false,
              };
            }

            const persistOutcome = async (
              outcome: FinalAuthorizationOutcome,
              reason?: string,
            ): Promise<FinalAuthorizationOutcome> => {
              await this.recordVerificationAuditInTransaction(tx, {
                verificationId,
                operatorId: actingAgent.operatorId,
                request,
                challenge,
                authorizedCapabilities: outcome.authorizedCapabilities,
                deniedCapabilities: outcome.deniedCapabilities,
                approvalGroupId: outcome.approvalGroupId,
                reason,
              });
              return outcome;
            };

            const actingAgentClaim = await tx.aIAgent.updateMany({
              where: {
                id: actingAgent.agentId,
                status: "ACTIVE",
                authorizationVersion: actingAgent.authorizationVersion,
              },
              data: { lastActiveAt: now },
            });
            if (actingAgentClaim.count !== 1) {
              throw new AuthorizationTransactionAbort(
                "Agent security state changed before authorization committed",
              );
            }
            if (
              !(await this.hasActiveAgentControllerInTransaction(
                tx,
                actingAgent.agentId,
              ))
            ) {
              throw new AuthorizationTransactionAbort(
                "Agent controller identity is inactive or no longer matches",
              );
            }

            const operation = await tx.agentAuthorizationOperation.findUnique({
              where: {
                agentId_audienceId_operationId: {
                  agentId: request.agentId,
                  audienceId: request.audience,
                  operationId: request.context.operationId,
                },
              },
            });
            if (
              operation &&
              operation.operationDigest !== challenge.operationDigest
            ) {
              const reason =
                "Operation ID is already bound to different signed operation data";
              return persistOutcome(denyAll(reason), reason);
            }
            if (operation?.status === "AUTHORIZED") {
              const reason = "Operation has already been authorized";
              return persistOutcome(denyAll(reason), reason);
            }

            if (
              initiallyDenied.length > 0 ||
              resolved.length !== request.requestedCapabilities.length
            ) {
              const reason = "Atomic operation contains a denied capability";
              return persistOutcome(denyAll(reason), reason);
            }

            const touchedAgents = new Map<string, number>([
              [actingAgent.agentId, actingAgent.authorizationVersion],
            ]);
            const touchedDelegations = new Map<string, number>();
            for (const item of resolved) {
              const validationFailure =
                await this.validateGrantSnapshotInTransaction(
                  tx,
                  item,
                  request,
                  now,
                  touchedAgents,
                  touchedDelegations,
                );
              if (validationFailure) {
                throw new AuthorizationTransactionAbort(validationFailure);
              }
            }

            const requiredApproverIds = Array.from(
              new Set(
                resolved.flatMap((item) => item.grant.requiredApproverIds),
              ),
            ).sort();
            const snapshotDigest = this.computeAuthorizationSnapshotDigest(
              resolved,
              requiredApproverIds,
            );
            let approvalGroupId: string | undefined;
            if (requiredApproverIds.length > 0) {
              approvalGroupId = this.computeApprovalGroupId(
                challenge.operationDigest,
                requiredApproverIds,
                snapshotDigest,
              );
              if (!request.approvalGroupId) {
                if (operation) {
                  const reason =
                    operation.approvalGroupId === approvalGroupId
                      ? `Human approval is still required for operation group ${approvalGroupId}`
                      : "Pending operation does not match the current authorization path";
                  return persistOutcome(
                    {
                      ...denyAll(reason),
                      approvalGroupId: operation.approvalGroupId ?? undefined,
                    },
                    reason,
                  );
                }
                await tx.agentAuthorizationOperation.create({
                  data: {
                    agentId: request.agentId,
                    audienceId: request.audience,
                    operationId: request.context.operationId,
                    operationDigest: challenge.operationDigest,
                    status: "PENDING_APPROVAL",
                    approvalGroupId,
                    initialChallengeId: challenge.id,
                    initialVerificationId: verificationId,
                  },
                });
                await this.createApprovalGroupInTransaction(
                  tx,
                  approvalGroupId,
                  snapshotDigest,
                  challenge.operationDigest,
                  request,
                  resolved,
                  requiredApproverIds,
                  now,
                );
                const reason = `Human approval is required for operation group ${approvalGroupId}`;
                return persistOutcome(
                  {
                    ...denyAll(reason),
                    approvalGroupId,
                  },
                  reason,
                );
              }
              if (request.approvalGroupId !== approvalGroupId) {
                const reason =
                  "Approval group does not match the current authorization path";
                return persistOutcome(denyAll(reason), reason);
              }
              if (
                !operation ||
                operation.status !== "PENDING_APPROVAL" ||
                operation.approvalGroupId !== approvalGroupId
              ) {
                const reason =
                  "Approval group is not bound to a pending authorization operation";
                return persistOutcome(denyAll(reason), reason);
              }
              const redeemed = await this.redeemApprovalGroupInTransaction(
                tx,
                approvalGroupId,
                snapshotDigest,
                challenge.operationDigest,
                request,
                requiredApproverIds,
                now,
              );
              if (!redeemed) {
                const reason =
                  "Approval group is incomplete, rejected, expired, or consumed";
                return persistOutcome(denyAll(reason), reason);
              }
            } else if (request.approvalGroupId) {
              const reason =
                "This operation does not require an approval group";
              return persistOutcome(denyAll(reason), reason);
            }

            if (requiredApproverIds.length === 0) {
              if (operation) {
                const reason = "Operation has already been claimed";
                return persistOutcome(denyAll(reason), reason);
              }
              await tx.agentAuthorizationOperation.create({
                data: {
                  agentId: request.agentId,
                  audienceId: request.audience,
                  operationId: request.context.operationId,
                  operationDigest: challenge.operationDigest,
                  status: "AUTHORIZED",
                  initialChallengeId: challenge.id,
                  initialVerificationId: verificationId,
                  authorizedChallengeId: challenge.id,
                  authorizationVerificationId: verificationId,
                  authorizedAt: now,
                },
              });
            } else {
              const authorized =
                await tx.agentAuthorizationOperation.updateMany({
                  where: {
                    id: operation!.id,
                    status: "PENDING_APPROVAL",
                    version: operation!.version,
                    approvalGroupId,
                    operationDigest: challenge.operationDigest,
                  },
                  data: {
                    status: "AUTHORIZED",
                    authorizedChallengeId: challenge.id,
                    authorizationVerificationId: verificationId,
                    authorizedAt: now,
                    version: { increment: 1 },
                  },
                });
              if (authorized.count !== 1) {
                throw new AuthorizationTransactionAbort(
                  "Operation authorization was claimed concurrently",
                );
              }
            }

            for (const item of resolved) {
              const rate =
                await this.consumeAuthorizationRateLimitsInTransaction(
                  tx,
                  actingAgent.agentId,
                  item.capabilityName,
                  item.grant.rateLimits,
                  now,
                );
              if (!rate.allowed) {
                throw new AuthorizationTransactionAbort(
                  rate.reason ?? "Authorization rate limit exceeded",
                );
              }
            }

            for (const item of resolved) {
              for (const delegation of item.grant.snapshot.delegations) {
                const counted = await tx.agentDelegation.updateMany({
                  where: {
                    id: delegation.delegationId,
                    version: delegation.recordVersion,
                    status: "ACTIVE",
                    expiresAt: { gt: now },
                  },
                  data: {
                    authorizationCount: { increment: 1 },
                    lastAuthorizedAt: now,
                  },
                });
                if (counted.count !== 1) {
                  throw new AuthorizationTransactionAbort(
                    "Delegation changed while authorization was committing",
                  );
                }
              }
            }

            const expiresAt = resolved.reduce(
              (current, item) =>
                item.grant.validUntil && item.grant.validUntil < current
                  ? item.grant.validUntil
                  : current,
              new Date(now.getTime() + 3600_000),
            );
            return persistOutcome({
              challengeConsumed: true,
              authorizedCapabilities: resolved.map(
                (item) => item.capabilityName,
              ),
              deniedCapabilities: [],
              delegationChain: resolved.find(
                (item) => item.grant.delegationChain,
              )?.grant.delegationChain,
              approvalGroupId,
              expiresAt,
            });
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        const auditTailConflict = this.isAuditTailConflict(error);
        if (
          ((error as { code?: string }).code === "P2034" ||
            auditTailConflict) &&
          attempt < 2
        ) {
          continue;
        }
        if (auditTailConflict) {
          // The entire transaction (including challenge consumption and the
          // operation claim) was rolled back. Preserve the issued challenge so
          // the caller can safely retry after the audit tail advances.
          throw new AgentIdentityError(
            "Authorization audit chain is contended; retry the same challenge",
            "AGENT_AUDIT_APPEND_CONFLICT",
            503,
          );
        }
        if (
          error instanceof AuthorizationTransactionAbort ||
          (error as { code?: string }).code === "P2034" ||
          (error as { code?: string }).code === "P2002"
        ) {
          const failureReason =
            error instanceof AuthorizationTransactionAbort
              ? error.reason
              : (error as { code?: string }).code === "P2002"
                ? "Operation authorization was claimed concurrently"
                : "Authorization could not be serialized safely";
          const challengeConsumed = await this.consumeChallengeAfterAbort(
            challenge,
            request,
            actingAgent.operatorId,
            verificationId,
            failureReason,
          );
          return {
            ...denyAll(failureReason),
            challengeConsumed,
          };
        }
        throw error;
      }
    }
    return {
      ...denyAll("Authorization could not be serialized safely"),
      challengeConsumed: false,
    };
  }

  private async consumeChallengeAfterAbort(
    challenge: PrismaAgentVerificationChallenge,
    request: AgentVerificationRequest,
    operatorId: string,
    verificationId: string,
    reason: string,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const consumed = await tx.agentVerificationChallenge.updateMany({
              where: {
                id: challenge.id,
                agentId: request.agentId,
                audienceId: request.audience,
                operationDigest: challenge.operationDigest,
                status: "ISSUED",
                version: challenge.version,
                expiresAt: { gt: now },
              },
              data: {
                status: "CONSUMED",
                consumedAt: now,
                version: { increment: 1 },
              },
            });
            if (consumed.count !== 1) return false;
            await this.recordVerificationAuditInTransaction(tx, {
              verificationId,
              operatorId,
              request,
              challenge,
              authorizedCapabilities: [],
              deniedCapabilities: request.requestedCapabilities.map((name) => ({
                name,
                reason,
              })),
              reason,
            });
            return true;
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          (this.isAuditTailConflict(error) ||
            (error as { code?: string }).code === "P2034") &&
          attempt < 2
        ) {
          continue;
        }
        if (this.isAuditTailConflict(error)) {
          throw new AgentIdentityError(
            "Authorization-denial audit chain is contended; retry the same challenge",
            "AGENT_AUDIT_APPEND_CONFLICT",
            503,
          );
        }
        throw error;
      }
    }
    throw new AgentIdentityError(
      "Authorization denial could not be serialized safely",
      "AGENT_AUTHORIZATION_CONFLICT",
      503,
    );
  }

  private async recordVerificationAuditInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      verificationId: string;
      operatorId: string;
      request: AgentVerificationRequest;
      challenge: PrismaAgentVerificationChallenge;
      authorizedCapabilities: string[];
      deniedCapabilities: { name: string; reason: string }[];
      approvalGroupId?: string;
      reason?: string;
    },
  ): Promise<void> {
    const verified =
      input.authorizedCapabilities.length > 0 &&
      input.deniedCapabilities.length === 0;
    await tx.auditLog.create({
      data: {
        identityId: input.operatorId,
        action: verified ? "VERIFICATION_COMPLETED" : "VERIFICATION_FAILED",
        resourceType: "agent_authorization",
        resourceId: input.verificationId,
        details: {
          agentId: input.request.agentId,
          audienceId: input.request.audience,
          challengeId: input.challenge.id,
          operationDigest: input.challenge.operationDigest,
          operationId: input.request.context.operationId,
          requestedCapabilities: input.request.requestedCapabilities,
          authorizedCapabilities: input.authorizedCapabilities,
          deniedCapabilities: input.deniedCapabilities,
          approvalGroupId:
            input.approvalGroupId ?? input.request.approvalGroupId ?? null,
          verified,
          reason: input.reason ?? null,
          context: {
            purpose: input.request.context.purpose,
            resourceId: input.request.context.resourceId,
            resourceType: input.request.context.resourceType,
            action: input.request.context.action,
            callerAgentId: input.request.context.callerAgentId ?? null,
            callerProtocol: input.request.context.callerProtocol ?? null,
          },
        },
      },
    });
  }

  private isAuditTailConflict(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as {
      code?: string;
      meta?: { target?: unknown };
    };
    if (candidate.code !== "P2002") return false;
    const target = candidate.meta?.target;
    return Array.isArray(target)
      ? target.includes("previousHash")
      : typeof target === "string" && target.includes("previousHash");
  }

  private async hasActiveAgentControllerInTransaction(
    tx: Prisma.TransactionClient,
    agentId: string,
  ): Promise<boolean> {
    const agent = await tx.aIAgent.findUnique({
      where: { id: agentId },
      select: { operatorId: true, controllerDid: true },
    });
    if (!agent?.controllerDid) return false;
    const controller = await tx.identity.findUnique({
      where: { id: agent.operatorId },
      select: { did: true, status: true },
    });
    return (
      controller?.status === "ACTIVE" && controller.did === agent.controllerDid
    );
  }

  private async validateGrantSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    item: ResolvedCapabilityGrant,
    request: AgentVerificationRequest,
    now: Date,
    touchedAgents: Map<string, number>,
    touchedDelegations: Map<string, number>,
  ): Promise<string | null> {
    for (const snapshot of [...item.grant.snapshot.agents].sort((left, right) =>
      left.agentId.localeCompare(right.agentId),
    )) {
      const existingVersion = touchedAgents.get(snapshot.agentId);
      if (existingVersion !== undefined) {
        if (existingVersion !== snapshot.authorizationVersion) {
          return "Agent authorization versions disagree across the operation";
        }
        continue;
      }
      const claimed = await tx.aIAgent.updateMany({
        where: {
          id: snapshot.agentId,
          status: "ACTIVE",
          authorizationVersion: snapshot.authorizationVersion,
        },
        data: { lastActiveAt: now },
      });
      if (claimed.count !== 1) {
        return "An agent in the authorization path changed or became inactive";
      }
      if (
        !(await this.hasActiveAgentControllerInTransaction(
          tx,
          snapshot.agentId,
        ))
      ) {
        return "An agent controller in the authorization path is inactive or mismatched";
      }
      touchedAgents.set(snapshot.agentId, snapshot.authorizationVersion);
    }

    for (const snapshot of [...item.grant.snapshot.delegations].sort(
      (left, right) => left.delegationId.localeCompare(right.delegationId),
    )) {
      const existingVersion = touchedDelegations.get(snapshot.delegationId);
      if (existingVersion !== undefined) {
        if (existingVersion !== snapshot.recordVersion) {
          return "Delegation versions disagree across the operation";
        }
        continue;
      }
      const claimed = await tx.agentDelegation.updateMany({
        where: {
          id: snapshot.delegationId,
          version: snapshot.recordVersion,
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        data: { lastAuthorizedAt: now },
      });
      if (claimed.count !== 1) {
        return "A delegation changed, expired, or was revoked";
      }
      touchedDelegations.set(snapshot.delegationId, snapshot.recordVersion);
    }

    const rootRow = await tx.aIAgent.findUnique({
      where: { id: item.grant.snapshot.rootAgentId },
    });
    if (!rootRow) return "Root capability authority no longer exists";
    const rootAgent = this.fromPrismaAgent(rootRow);
    const currentCapability = rootAgent.capabilities.find(
      (capability) => capability.name === item.capabilityName,
    );
    if (
      rootAgent.status !== "active" ||
      rootAgent.authorizationVersion !==
        item.grant.snapshot.agents.find(
          (snapshot) => snapshot.agentId === rootAgent.agentId,
        )?.authorizationVersion ||
      !currentCapability ||
      this.fingerprintCapability(currentCapability) !==
        item.grant.snapshot.capabilityFingerprint
    ) {
      return "Root capability changed before authorization committed";
    }
    const contextFailure = this.validateCapabilityContext(
      currentCapability,
      request,
    );
    if (contextFailure) return contextFailure;
    if (item.grant.path) {
      const constraintResult = this.evaluateDelegationConstraints(
        item.grant.path,
        request,
        now,
      );
      if (!constraintResult.allowed) return constraintResult.reason;
    }
    return null;
  }

  private computeAuthorizationSnapshotDigest(
    resolved: ResolvedCapabilityGrant[],
    requiredApproverIds: string[],
  ): string {
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          capabilities: resolved
            .map((item) => ({
              name: item.capabilityName,
              fingerprint: item.grant.snapshot.capabilityFingerprint,
              rootAgentId: item.grant.snapshot.rootAgentId,
              agents: [...item.grant.snapshot.agents].sort((left, right) =>
                left.agentId.localeCompare(right.agentId),
              ),
              delegations: [...item.grant.snapshot.delegations].sort(
                (left, right) =>
                  left.delegationId.localeCompare(right.delegationId),
              ),
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          requiredApproverIds,
        }),
      )
      .digest("hex");
  }

  private computeApprovalGroupId(
    operationDigest: string,
    requiredApproverIds: string[],
    snapshotDigest: string,
  ): string {
    const digest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          operationDigest,
          requiredApproverIds,
          snapshotDigest,
        }),
      )
      .digest("hex");
    return `apg-${digest}`;
  }

  private async createApprovalGroupInTransaction(
    tx: Prisma.TransactionClient,
    approvalGroupId: string,
    snapshotDigest: string,
    operationDigest: string,
    request: AgentVerificationRequest,
    resolved: ResolvedCapabilityGrant[],
    requiredApproverIds: string[],
    now: Date,
  ): Promise<void> {
    const riskRanks: Record<AgentCapability["riskLevel"], number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };
    const effectiveRisk = resolved.reduce<AgentCapability["riskLevel"]>(
      (current, item) =>
        riskRanks[item.grant.capability.riskLevel] > riskRanks[current]
          ? item.grant.capability.riskLevel
          : current,
      "low",
    );
    const expiresAt = resolved.reduce(
      (current, item) =>
        item.grant.validUntil && item.grant.validUntil < current
          ? item.grant.validUntil
          : current,
      new Date(now.getTime() + APPROVAL_REQUEST_TTL_MS),
    );
    await tx.agentApprovalRequest.createMany({
      data: requiredApproverIds.map((operatorId) => ({
        id: `apr-${crypto.randomUUID()}`,
        approvalGroupId,
        operationId: request.context.operationId,
        operationDigest,
        authorizationSnapshotDigest: snapshotDigest,
        requestedCapabilities: [...request.requestedCapabilities].sort(),
        requiredApproverIds,
        agentId: request.agentId,
        audienceId: request.audience,
        operatorId,
        action: request.context.action,
        resourceType: request.context.resourceType,
        resourceId: request.context.resourceId,
        riskLevel: effectiveRisk,
        context: request.context as any,
        status: "PENDING" as const,
        createdAt: now,
        expiresAt,
      })),
      skipDuplicates: true,
    });
    const rows = await tx.agentApprovalRequest.findMany({
      where: { approvalGroupId },
    });
    const operators = rows.map((row) => row.operatorId).sort();
    if (
      JSON.stringify(operators) !== JSON.stringify(requiredApproverIds) ||
      rows.some(
        (row) =>
          row.operationDigest !== operationDigest ||
          row.authorizationSnapshotDigest !== snapshotDigest ||
          row.audienceId !== request.audience ||
          JSON.stringify([...row.requiredApproverIds].sort()) !==
            JSON.stringify(requiredApproverIds),
      )
    ) {
      throw new AuthorizationTransactionAbort(
        "Conflicting approval group already exists for the operation",
      );
    }
  }

  private async redeemApprovalGroupInTransaction(
    tx: Prisma.TransactionClient,
    approvalGroupId: string,
    snapshotDigest: string,
    operationDigest: string,
    request: AgentVerificationRequest,
    requiredApproverIds: string[],
    now: Date,
  ): Promise<boolean> {
    const rows = await tx.agentApprovalRequest.findMany({
      where: { approvalGroupId },
      orderBy: { operatorId: "asc" },
    });
    if (
      rows.length !== requiredApproverIds.length ||
      rows.some(
        (row, index) =>
          row.operatorId !== requiredApproverIds[index] ||
          row.agentId !== request.agentId ||
          row.audienceId !== request.audience ||
          row.operationDigest !== operationDigest ||
          row.authorizationSnapshotDigest !== snapshotDigest ||
          row.status !== "APPROVED" ||
          row.expiresAt <= now ||
          row.consumedAt !== null ||
          JSON.stringify([...row.requiredApproverIds].sort()) !==
            JSON.stringify(requiredApproverIds),
      )
    ) {
      return false;
    }
    const consumed = await tx.agentApprovalRequest.updateMany({
      where: {
        approvalGroupId,
        status: "APPROVED",
        expiresAt: { gt: now },
        consumedAt: null,
      },
      data: {
        status: "CONSUMED",
        consumedAt: now,
        consumedByChallengeId: request.challengeId,
        version: { increment: 1 },
      },
    });
    if (consumed.count !== requiredApproverIds.length) {
      throw new AuthorizationTransactionAbort(
        "Approval group was redeemed concurrently",
      );
    }
    return true;
  }

  private parseVerificationKey(publicKey: string): crypto.KeyObject {
    const trimmed = publicKey.trim();

    if (trimmed.includes("BEGIN PUBLIC KEY")) {
      return crypto.createPublicKey(trimmed);
    }

    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const der = Buffer.from(normalized, "base64");
    if (der.length === 0) {
      throw new Error("Empty public key");
    }

    if (der.length === 32) {
      return crypto.createPublicKey({
        key: this.buildEd25519Spki(der),
        format: "der",
        type: "spki",
      });
    }

    return crypto.createPublicKey({
      key: der,
      format: "der",
      type: "spki",
    });
  }

  private decodeSignature(signature: string): Buffer {
    const trimmed = signature.trim();

    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return Buffer.from(trimmed, "hex");
    }

    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64");
  }

  private buildEd25519Spki(rawPublicKey: Buffer): Buffer {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    return Buffer.concat([spkiPrefix, rawPublicKey]);
  }

  private async resolveDelegationCreationAuthority(
    fromAgent: AgentIdentity,
    capabilities: string[],
    now: Date,
    db: DelegationAuthorityDatabase = prisma,
  ): Promise<{
    parentDelegationId?: string;
    depth: number;
    maxDepth: number;
    chainAgentIds: string[];
    authorityExpiresAt?: Date;
  }> {
    if (fromAgent.maxDelegationDepth < 1) {
      throw new AgentIdentityError(
        "Source agent does not permit delegation",
        "DELEGATION_DEPTH_EXCEEDED",
        400,
      );
    }

    const directCapabilities = new Set(
      fromAgent.capabilities.map((capability) => capability.name),
    );
    if (
      capabilities.every((capability) => directCapabilities.has(capability))
    ) {
      return {
        depth: 1,
        maxDepth: fromAgent.maxDelegationDepth,
        chainAgentIds: [fromAgent.agentId],
      };
    }

    const parents = await db.agentDelegation.findMany({
      where: {
        toAgentId: fromAgent.agentId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        capabilities: { hasEvery: capabilities },
      },
      orderBy: { createdAt: "asc" },
    });
    let depthExceeded = false;

    for (const parent of parents) {
      try {
        const path = await this.buildDelegationPathForCapabilities(
          parent,
          capabilities,
          now,
          db,
        );
        const mappedParent = path.delegations[path.delegations.length - 1];
        const depth = mappedParent.depth + 1;
        const maxDepth = Math.min(
          mappedParent.maxDepth,
          fromAgent.maxDelegationDepth,
        );
        if (depth > maxDepth) {
          depthExceeded = true;
          continue;
        }
        return {
          parentDelegationId: mappedParent.delegationId,
          depth,
          maxDepth,
          chainAgentIds: path.agentIds,
          authorityExpiresAt: new Date(
            Math.min(
              ...path.delegations.map((delegation) =>
                delegation.expiresAt.getTime(),
              ),
            ),
          ),
        };
      } catch (error) {
        logger.warn("delegation_parent_path_rejected", {
          parentDelegationId: parent.id,
          code:
            error instanceof AgentIdentityError
              ? error.code
              : "DELEGATION_PATH_INVALID",
        });
      }
    }

    if (depthExceeded) {
      throw new AgentIdentityError(
        "Maximum delegation depth exceeded",
        "DELEGATION_DEPTH_EXCEEDED",
        400,
      );
    }
    throw new AgentIdentityError(
      `Agent does not have one valid authority path for: ${capabilities.join(", ")}`,
      "INSUFFICIENT_CAPABILITIES",
      400,
    );
  }

  private async resolveCapabilityGrant(
    agent: AgentIdentity,
    capabilityName: string,
    request: AgentVerificationRequest,
  ): Promise<CapabilityGrantDecision> {
    const direct = agent.capabilities.find(
      (capability) => capability.name === capabilityName,
    );
    if (direct) {
      const contextFailure = this.validateCapabilityContext(direct, request);
      if (contextFailure) return { authorized: false, reason: contextFailure };
      return {
        authorized: true,
        capability: direct,
        requiredApproverIds: direct.requiresApproval ? [agent.operatorId] : [],
        rateLimits: direct.rateLimit
          ? [
              {
                ownerAgentId: agent.agentId,
                scopeKey: "direct",
                maxPerHour: direct.rateLimit.maxPerHour,
                maxPerDay: direct.rateLimit.maxPerDay,
              },
            ]
          : [],
        snapshot: {
          agents: [
            {
              agentId: agent.agentId,
              authorizationVersion: agent.authorizationVersion,
            },
          ],
          delegations: [],
          rootAgentId: agent.agentId,
          capabilityFingerprint: this.fingerprintCapability(direct),
        },
      };
    }

    const now = new Date();
    await this.expireDelegations(now, agent.agentId);
    const candidates = await prisma.agentDelegation.findMany({
      where: {
        toAgentId: agent.agentId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        capabilities: { has: capabilityName },
      },
      orderBy: { createdAt: "asc" },
    });
    let lastFailure = "Capability not granted to this agent";

    for (const candidate of candidates) {
      try {
        const path = await this.buildDelegationPathForCapabilities(
          candidate,
          [capabilityName],
          now,
        );
        const leaf = path.delegations[path.delegations.length - 1];
        if (
          request.context.callerAgentId &&
          request.context.callerAgentId !== leaf.fromAgentId
        ) {
          lastFailure = "Caller is not the immediate delegating agent";
          continue;
        }

        const contextFailure = this.validateCapabilityContext(
          path.rootCapability,
          request,
        );
        if (contextFailure) {
          lastFailure = contextFailure;
          continue;
        }

        const constraintResult = this.evaluateDelegationConstraints(
          path,
          request,
          now,
        );
        if (!constraintResult.allowed) {
          lastFailure = constraintResult.reason;
          continue;
        }

        const rateLimits: AuthorizationRateLimit[] = [];
        if (path.rootCapability.rateLimit) {
          rateLimits.push({
            ownerAgentId: path.agentIds[0],
            scopeKey: "direct",
            maxPerHour: path.rootCapability.rateLimit.maxPerHour,
            maxPerDay: path.rootCapability.rateLimit.maxPerDay,
          });
        }
        rateLimits.push(...constraintResult.rateLimits);

        return {
          authorized: true,
          capability: path.rootCapability,
          requiredApproverIds: Array.from(
            new Set([
              ...(path.rootCapability.requiresApproval
                ? [path.agents[0].operatorId]
                : []),
              ...constraintResult.requiredApproverIds,
            ]),
          ).sort(),
          delegationChain: path.agentIds,
          rateLimits: this.mergeAuthorizationRateLimits(rateLimits),
          validUntil: this.getDelegationPathValidUntil(path),
          snapshot: {
            agents: path.agents.map((pathAgent) => ({
              agentId: pathAgent.agentId,
              authorizationVersion: pathAgent.authorizationVersion,
            })),
            delegations: path.delegations.map((delegation) => ({
              delegationId: delegation.delegationId,
              recordVersion: delegation.recordVersion,
            })),
            rootAgentId: path.agents[0].agentId,
            capabilityFingerprint: this.fingerprintCapability(
              path.rootCapability,
            ),
          },
          path,
        };
      } catch (error) {
        lastFailure = "Delegation path is invalid";
        logger.warn("delegation_authorization_path_rejected", {
          delegationId: candidate.id,
          code:
            error instanceof AgentIdentityError
              ? error.code
              : "DELEGATION_PATH_INVALID",
        });
      }
    }

    return { authorized: false, reason: lastFailure };
  }

  private async buildDelegationPathForCapabilities(
    leafRow: PrismaAgentDelegation,
    capabilities: string[],
    now: Date,
    db: DelegationAuthorityDatabase = prisma,
  ): Promise<DelegationPath> {
    const leafToRoot: DelegationChain[] = [];
    const visited = new Set<string>();
    let current = this.fromPrismaDelegation(leafRow);

    for (let hops = 0; hops < MAX_DELEGATION_TRAVERSAL_DEPTH; hops++) {
      if (visited.has(current.delegationId)) {
        throw new AgentIdentityError(
          "Delegation cycle detected",
          "DELEGATION_PATH_INVALID",
          403,
        );
      }
      visited.add(current.delegationId);
      if (
        current.status !== "active" ||
        current.expiresAt <= now ||
        current.depth < 1 ||
        current.depth > current.maxDepth ||
        !capabilities.every((capability) =>
          current.capabilities.includes(capability),
        )
      ) {
        throw new AgentIdentityError(
          "Delegation is inactive, expired, over-depth, or incomplete",
          "DELEGATION_PATH_INVALID",
          403,
        );
      }
      leafToRoot.push(current);

      if (!current.parentDelegationId) break;
      const parentRow = await db.agentDelegation.findUnique({
        where: { id: current.parentDelegationId },
      });
      if (!parentRow) {
        throw new AgentIdentityError(
          "Delegation parent is missing",
          "DELEGATION_PATH_INVALID",
          403,
        );
      }
      const parent = this.fromPrismaDelegation(parentRow);
      if (
        parent.toAgentId !== current.fromAgentId ||
        current.depth !== parent.depth + 1 ||
        current.maxDepth > parent.maxDepth
      ) {
        throw new AgentIdentityError(
          "Delegation parent linkage is inconsistent",
          "DELEGATION_PATH_INVALID",
          403,
        );
      }
      current = parent;
    }

    const rootCandidate = leafToRoot[leafToRoot.length - 1];
    if (
      rootCandidate.parentDelegationId ||
      rootCandidate.depth !== 1 ||
      leafToRoot.length > MAX_DELEGATION_TRAVERSAL_DEPTH
    ) {
      throw new AgentIdentityError(
        "Delegation path does not terminate at a valid root",
        "DELEGATION_PATH_INVALID",
        403,
      );
    }

    const delegations = [...leafToRoot].reverse();
    const agentIds = [
      delegations[0].fromAgentId,
      ...delegations.map((delegation) => delegation.toAgentId),
    ];
    if (new Set(agentIds).size !== agentIds.length) {
      throw new AgentIdentityError(
        "Delegation path contains an agent cycle",
        "DELEGATION_PATH_INVALID",
        403,
      );
    }

    const agentRows = await Promise.all(
      agentIds.map((agentId) =>
        db.aIAgent.findUnique({ where: { id: agentId } }),
      ),
    );
    if (agentRows.some((row) => !row)) {
      throw new AgentIdentityError(
        "Delegation path contains a missing agent",
        "DELEGATION_PATH_INVALID",
        403,
      );
    }
    const agents = agentRows.map((row) => this.fromPrismaAgent(row!));
    if (agents.some((pathAgent) => pathAgent.status !== "active")) {
      throw new AgentIdentityError(
        "Delegation path contains an inactive agent",
        "DELEGATION_AGENT_INACTIVE",
        403,
      );
    }
    const rootAgent = agents[0];
    if (
      delegations[delegations.length - 1].depth > rootAgent.maxDelegationDepth
    ) {
      throw new AgentIdentityError(
        "Delegation path exceeds the root authority depth",
        "DELEGATION_DEPTH_EXCEEDED",
        403,
      );
    }
    const rootCapabilities = capabilities.map((capabilityName) =>
      rootAgent.capabilities.find(
        (capability) => capability.name === capabilityName,
      ),
    );
    if (rootCapabilities.some((capability) => !capability)) {
      throw new AgentIdentityError(
        "Root agent no longer holds the delegated capability",
        "DELEGATION_PATH_INVALID",
        403,
      );
    }

    return {
      delegations,
      agentIds,
      agents,
      rootCapability: rootCapabilities[0]!,
    };
  }

  private validateCapabilityContext(
    capability: AgentCapability,
    request: AgentVerificationRequest,
  ): string | null {
    if (!capability.actions.includes(request.context.action)) {
      return `Action ${request.context.action} is outside the capability grant`;
    }
    if (!capability.resourceTypes.includes(request.context.resourceType)) {
      return `Resource type ${request.context.resourceType} is outside the capability grant`;
    }
    return null;
  }

  private evaluateDelegationConstraints(
    path: DelegationPath,
    request: AgentVerificationRequest,
    now: Date,
  ):
    | {
        allowed: true;
        requiredApproverIds: string[];
        rateLimits: AuthorizationRateLimit[];
      }
    | { allowed: false; reason: string } {
    const requiredApproverIds = new Set<string>();
    const rateLimits: AuthorizationRateLimit[] = [];
    const riskRanks: Record<AgentCapability["riskLevel"], number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };

    for (const delegation of path.delegations) {
      for (const constraint of delegation.constraints) {
        const parameters = constraint.parameters;
        if (constraint.type === "time_bounded") {
          const notBefore = parameters.notBefore
            ? new Date(parameters.notBefore as string)
            : undefined;
          const notAfter = parameters.notAfter
            ? new Date(parameters.notAfter as string)
            : undefined;
          if (notBefore && now < notBefore) {
            return { allowed: false, reason: "Delegation is not active yet" };
          }
          if (notAfter && now >= notAfter) {
            return {
              allowed: false,
              reason: "Delegation time constraint expired",
            };
          }
        } else if (constraint.type === "action_scoped") {
          const actions = parameters.actions as string[];
          if (!request.context.action) {
            return {
              allowed: false,
              reason: "Signed action context is required by the delegation",
            };
          }
          if (!actions.includes(request.context.action)) {
            return {
              allowed: false,
              reason: "Action is outside the delegation constraint",
            };
          }
        } else if (constraint.type === "resource_scoped") {
          const resourceIds = parameters.resourceIds as string[] | undefined;
          const resourceTypes = parameters.resourceTypes as
            | string[]
            | undefined;
          if (
            resourceIds &&
            (!request.context.resourceId ||
              !resourceIds.includes(request.context.resourceId))
          ) {
            return {
              allowed: false,
              reason: "Resource ID is outside the delegation constraint",
            };
          }
          if (
            resourceTypes &&
            (!request.context.resourceType ||
              !resourceTypes.includes(request.context.resourceType))
          ) {
            return {
              allowed: false,
              reason: "Resource type is outside the delegation constraint",
            };
          }
        } else if (constraint.type === "risk_bounded") {
          const maxRiskLevel =
            parameters.maxRiskLevel as AgentCapability["riskLevel"];
          if (
            riskRanks[path.rootCapability.riskLevel] > riskRanks[maxRiskLevel]
          ) {
            return {
              allowed: false,
              reason: "Risk level exceeds the delegation constraint",
            };
          }
        } else if (constraint.type === "rate_limited") {
          rateLimits.push({
            ownerAgentId: path.agentIds[0],
            scopeKey: delegation.delegationId,
            delegationId: delegation.delegationId,
            maxPerHour: parameters.maxPerHour as number | undefined,
            maxPerDay: parameters.maxPerDay as number | undefined,
          });
        } else if (constraint.type === "approval_required") {
          const grantor = path.agents.find(
            (pathAgent) => pathAgent.agentId === delegation.fromAgentId,
          );
          if (!grantor) {
            return {
              allowed: false,
              reason: "Delegation approval authority is unavailable",
            };
          }
          requiredApproverIds.add(grantor.operatorId);
        }
      }
    }

    return {
      allowed: true,
      requiredApproverIds: Array.from(requiredApproverIds).sort(),
      rateLimits,
    };
  }

  private fingerprintCapability(capability: AgentCapability): string {
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          name: capability.name,
          description: capability.description,
          resourceTypes: [...capability.resourceTypes].sort(),
          actions: [...capability.actions].sort(),
          riskLevel: capability.riskLevel,
          requiresApproval: capability.requiresApproval,
          rateLimit: capability.rateLimit ?? null,
        }),
      )
      .digest("hex");
  }

  private mergeAuthorizationRateLimits(
    limits: AuthorizationRateLimit[],
  ): AuthorizationRateLimit[] {
    const merged = new Map<string, AuthorizationRateLimit>();
    for (const limit of limits) {
      const key = `${limit.ownerAgentId}:${limit.scopeKey}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, { ...limit });
        continue;
      }
      current.maxPerHour = this.minimumDefined(
        current.maxPerHour,
        limit.maxPerHour,
      );
      current.maxPerDay = this.minimumDefined(
        current.maxPerDay,
        limit.maxPerDay,
      );
    }
    return Array.from(merged.values());
  }

  private getDelegationPathValidUntil(path: DelegationPath): Date {
    let validUntil = Math.min(
      ...path.delegations.map((delegation) => delegation.expiresAt.getTime()),
    );
    for (const delegation of path.delegations) {
      for (const constraint of delegation.constraints) {
        if (
          constraint.type === "time_bounded" &&
          typeof constraint.parameters.notAfter === "string"
        ) {
          validUntil = Math.min(
            validUntil,
            new Date(constraint.parameters.notAfter).getTime(),
          );
        }
      }
    }
    return new Date(validUntil);
  }

  private minimumDefined(left?: number, right?: number): number | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.min(left, right);
  }

  private sameDelegationChain(left: string[], right: string[]): boolean {
    return (
      left.length === right.length &&
      left.every((agentId, index) => agentId === right[index])
    );
  }

  private async collectOutgoingDelegationTreeInTransaction(
    tx: Prisma.TransactionClient,
    fromAgentId: string,
  ): Promise<PrismaAgentDelegation[]> {
    const roots = await tx.agentDelegation.findMany({
      where: { fromAgentId },
      orderBy: { createdAt: "asc" },
    });
    return (await this.collectDelegationTreeInTransaction(tx, roots)).filter(
      (row) => row.status === "ACTIVE",
    );
  }

  private async collectDelegationTreeInTransaction(
    tx: Prisma.TransactionClient,
    roots: PrismaAgentDelegation[],
  ): Promise<PrismaAgentDelegation[]> {
    const collected = new Map<string, PrismaAgentDelegation>();
    let frontier = roots;
    for (let depth = 0; depth <= MAX_DELEGATION_TRAVERSAL_DEPTH; depth++) {
      const unseen = frontier.filter((row) => !collected.has(row.id));
      if (unseen.length === 0) return Array.from(collected.values());
      for (const row of unseen) collected.set(row.id, row);
      const parentIds = unseen.map((row) => row.id);
      frontier = await tx.agentDelegation.findMany({
        where: {
          parentDelegationId: { in: parentIds },
        },
        orderBy: { createdAt: "asc" },
      });
    }
    if (frontier.some((row) => !collected.has(row.id))) {
      throw new AgentIdentityError(
        "Delegation tree exceeds the supported maximum depth",
        "DELEGATION_PATH_INVALID",
        503,
      );
    }
    return Array.from(collected.values());
  }

  private async revokeDelegationRowsInTransaction(
    tx: Prisma.TransactionClient,
    rows: PrismaAgentDelegation[],
    revokedBy: string,
    revokedAt: Date,
  ): Promise<void> {
    for (const row of rows) {
      const revoked = await tx.agentDelegation.updateMany({
        where: {
          id: row.id,
          status: "ACTIVE",
          version: row.version,
        },
        data: {
          status: "REVOKED",
          revokedAt,
          revokedBy,
          version: { increment: 1 },
        },
      });
      if (revoked.count !== 1) {
        throw new AgentIdentityError(
          "Delegation tree changed concurrently during revocation",
          "DELEGATION_CONCURRENT_UPDATE",
          409,
        );
      }
    }
  }

  private async expireDelegations(now: Date, agentId?: string): Promise<void> {
    await prisma.agentDelegation.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: now },
        ...(agentId
          ? { OR: [{ fromAgentId: agentId }, { toAgentId: agentId }] }
          : {}),
      },
      data: { status: "EXPIRED", version: { increment: 1 } },
    });
  }

  private async getApprovalRequest(
    requestId: string,
  ): Promise<HumanApprovalRequest | null> {
    const row = await prisma.agentApprovalRequest.findUnique({
      where: { id: requestId },
    });
    if (!row) return null;
    if (row.status === "PENDING" && row.expiresAt <= new Date()) {
      await prisma.agentApprovalRequest.updateMany({
        where: { id: requestId, status: "PENDING", version: row.version },
        data: { status: "EXPIRED", version: { increment: 1 } },
      });
      const refreshed = await prisma.agentApprovalRequest.findUnique({
        where: { id: requestId },
      });
      if (!refreshed) return null;
      const expired = this.fromPrismaApprovalRequest(refreshed);
      await this.cacheApprovalRequest(expired);
      return expired;
    }
    const request = this.fromPrismaApprovalRequest(row);
    await this.cacheApprovalRequest(request);
    return request;
  }

  private normalizeDelegationConstraints(
    constraints: DelegationConstraintSpec[],
    createdAt: Date,
    expiresAt: Date,
  ): DelegationConstraintSpec[] {
    const seen = new Set<DelegationConstraint>();
    return constraints.map((constraint) => {
      if (!constraint || typeof constraint !== "object") {
        throw new AgentIdentityError(
          "Delegation constraint must be an object",
          "DELEGATION_CONSTRAINT_INVALID",
          400,
        );
      }
      if (seen.has(constraint.type)) {
        throw new AgentIdentityError(
          `Delegation constraint ${constraint.type} is duplicated`,
          "DELEGATION_CONSTRAINT_INVALID",
          400,
        );
      }
      seen.add(constraint.type);
      if (
        !constraint.parameters ||
        typeof constraint.parameters !== "object" ||
        Array.isArray(constraint.parameters)
      ) {
        throw new AgentIdentityError(
          `Delegation constraint ${constraint.type} has invalid parameters`,
          "DELEGATION_CONSTRAINT_INVALID",
          400,
        );
      }
      const parameters = constraint.parameters;

      if (constraint.type === "time_bounded") {
        this.requireOnlyConstraintKeys(parameters, ["notBefore", "notAfter"]);
        const notBefore = this.parseConstraintDate(
          parameters.notBefore,
          "notBefore",
        );
        const notAfter = this.parseConstraintDate(
          parameters.notAfter,
          "notAfter",
        );
        if (!notBefore && !notAfter) {
          throw new AgentIdentityError(
            "time_bounded requires notBefore or notAfter",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        if (
          (notBefore && notBefore >= expiresAt) ||
          (notAfter && (notAfter <= createdAt || notAfter > expiresAt)) ||
          (notBefore && notAfter && notBefore >= notAfter)
        ) {
          throw new AgentIdentityError(
            "time_bounded must fit within the delegation lifetime",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        return {
          type: constraint.type,
          parameters: {
            ...(notBefore ? { notBefore: notBefore.toISOString() } : {}),
            ...(notAfter ? { notAfter: notAfter.toISOString() } : {}),
          },
        };
      }

      if (constraint.type === "action_scoped") {
        this.requireOnlyConstraintKeys(parameters, ["actions"]);
        return {
          type: constraint.type,
          parameters: {
            actions: this.parseConstraintStringArray(
              parameters.actions,
              "actions",
            ),
          },
        };
      }

      if (constraint.type === "resource_scoped") {
        this.requireOnlyConstraintKeys(parameters, [
          "resourceIds",
          "resourceTypes",
        ]);
        const resourceIds =
          parameters.resourceIds === undefined
            ? undefined
            : this.parseConstraintStringArray(
                parameters.resourceIds,
                "resourceIds",
              );
        const resourceTypes =
          parameters.resourceTypes === undefined
            ? undefined
            : this.parseConstraintStringArray(
                parameters.resourceTypes,
                "resourceTypes",
              );
        if (!resourceIds && !resourceTypes) {
          throw new AgentIdentityError(
            "resource_scoped requires resourceIds or resourceTypes",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        return {
          type: constraint.type,
          parameters: {
            ...(resourceIds ? { resourceIds } : {}),
            ...(resourceTypes ? { resourceTypes } : {}),
          },
        };
      }

      if (constraint.type === "risk_bounded") {
        this.requireOnlyConstraintKeys(parameters, ["maxRiskLevel"]);
        if (
          parameters.maxRiskLevel !== "low" &&
          parameters.maxRiskLevel !== "medium" &&
          parameters.maxRiskLevel !== "high" &&
          parameters.maxRiskLevel !== "critical"
        ) {
          throw new AgentIdentityError(
            "risk_bounded requires a valid maxRiskLevel",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        return {
          type: constraint.type,
          parameters: { maxRiskLevel: parameters.maxRiskLevel },
        };
      }

      if (constraint.type === "rate_limited") {
        this.requireOnlyConstraintKeys(parameters, ["maxPerHour", "maxPerDay"]);
        const maxPerHour = this.parseConstraintPositiveInteger(
          parameters.maxPerHour,
          "maxPerHour",
        );
        const maxPerDay = this.parseConstraintPositiveInteger(
          parameters.maxPerDay,
          "maxPerDay",
        );
        if (maxPerHour === undefined && maxPerDay === undefined) {
          throw new AgentIdentityError(
            "rate_limited requires maxPerHour or maxPerDay",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        return {
          type: constraint.type,
          parameters: {
            ...(maxPerHour !== undefined ? { maxPerHour } : {}),
            ...(maxPerDay !== undefined ? { maxPerDay } : {}),
          },
        };
      }

      if (constraint.type === "approval_required") {
        this.requireOnlyConstraintKeys(parameters, ["reason"]);
        if (
          parameters.reason !== undefined &&
          (typeof parameters.reason !== "string" ||
            parameters.reason.trim().length === 0 ||
            parameters.reason.length > 500)
        ) {
          throw new AgentIdentityError(
            "approval_required reason is invalid",
            "DELEGATION_CONSTRAINT_INVALID",
            400,
          );
        }
        return {
          type: constraint.type,
          parameters:
            typeof parameters.reason === "string"
              ? { reason: parameters.reason }
              : {},
        };
      }

      throw new AgentIdentityError(
        "Unsupported delegation constraint",
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    });
  }

  private requireOnlyConstraintKeys(
    parameters: Record<string, unknown>,
    allowed: string[],
  ): void {
    if (Object.keys(parameters).some((key) => !allowed.includes(key))) {
      throw new AgentIdentityError(
        "Delegation constraint contains unsupported parameters",
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    }
  }

  private parseConstraintDate(value: unknown, field: string): Date | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new AgentIdentityError(
        `${field} must be an ISO timestamp`,
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new AgentIdentityError(
        `${field} must be an ISO timestamp`,
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    }
    return date;
  }

  private parseConstraintStringArray(value: unknown, field: string): string[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > 50 ||
      value.some(
        (entry) =>
          typeof entry !== "string" ||
          entry.trim().length === 0 ||
          entry.length > 200,
      ) ||
      new Set(value).size !== value.length
    ) {
      throw new AgentIdentityError(
        `${field} must be a non-empty unique string array`,
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    }
    return [...value] as string[];
  }

  private parseConstraintPositiveInteger(
    value: unknown,
    field: string,
  ): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new AgentIdentityError(
        `${field} must be a positive integer`,
        "DELEGATION_CONSTRAINT_INVALID",
        400,
      );
    }
    return value as number;
  }

  private async consumeAuthorizationRateLimitsInTransaction(
    tx: Prisma.TransactionClient,
    actingAgentId: string,
    capability: string,
    limits: AuthorizationRateLimit[],
    now: Date,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (limits.length === 0) return { allowed: true };

    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    const counters: Array<{
      scopeKey: string;
      window: "hour" | "day";
      count: number;
      limit: number;
    }> = [];
    for (const limit of limits) {
      const windows = [
        {
          type: "HOUR" as const,
          label: "hour" as const,
          start: hourStart,
          maximum: limit.maxPerHour,
        },
        {
          type: "DAY" as const,
          label: "day" as const,
          start: dayStart,
          maximum: limit.maxPerDay,
        },
      ];
      for (const window of windows) {
        if (window.maximum === undefined) continue;
        const usage = await tx.agentAuthorizationUsage.upsert({
          where: {
            agentId_scopeKey_capability_windowType_windowStart: {
              agentId: limit.ownerAgentId,
              scopeKey: limit.scopeKey,
              capability,
              windowType: window.type,
              windowStart: window.start,
            },
          },
          create: {
            agentId: limit.ownerAgentId,
            delegationId: limit.delegationId,
            scopeKey: limit.scopeKey,
            capability,
            windowType: window.type,
            windowStart: window.start,
            count: 1,
          },
          update: { count: { increment: 1 } },
        });
        counters.push({
          scopeKey: limit.scopeKey,
          window: window.label,
          count: usage.count,
          limit: window.maximum,
        });
      }
    }

    const exceeded = counters.find((counter) => counter.count > counter.limit);
    if (!exceeded) return { allowed: true };
    logger.warn("agent_rate_limit_exceeded", {
      agentId: actingAgentId,
      capability,
      scopeKey: exceeded.scopeKey,
      window: exceeded.window,
      count: exceeded.count,
      limit: exceeded.limit,
    });
    return {
      allowed: false,
      reason: `Rate limit exceeded for ${exceeded.window} window`,
    };
  }

  private async cacheDelegation(delegation: DelegationChain): Promise<void> {
    try {
      const secondsUntilExpiry = Math.ceil(
        (delegation.expiresAt.getTime() - Date.now()) / 1000,
      );
      const ttl = Math.max(
        1,
        secondsUntilExpiry + DELEGATION_RECORD_GRACE_SECONDS,
      );
      await redis.set(
        `delegation:${delegation.delegationId}`,
        JSON.stringify(delegation),
        "EX",
        ttl,
      );
      await redis.sadd(
        `delegations:from:${delegation.fromAgentId}`,
        delegation.delegationId,
      );
      await redis.sadd(
        `delegations:to:${delegation.toAgentId}`,
        delegation.delegationId,
      );
    } catch (error) {
      logger.warn("delegation_cache_write_failed", {
        delegationId: delegation.delegationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cacheApprovalRequest(
    request: HumanApprovalRequest,
  ): Promise<void> {
    try {
      await redis.set(
        this.approvalRequestKey(request.requestId),
        JSON.stringify(request),
        "EX",
        APPROVAL_RECORD_TTL_SECONDS,
      );
      if (request.status === "pending") {
        await redis.sadd(
          this.operatorApprovalSetKey(request.operatorId),
          request.requestId,
        );
        await redis.expire(
          this.operatorApprovalSetKey(request.operatorId),
          APPROVAL_RECORD_TTL_SECONDS,
        );
      } else {
        await redis.srem(
          this.operatorApprovalSetKey(request.operatorId),
          request.requestId,
        );
      }
    } catch (error) {
      logger.warn("approval_cache_write_failed", {
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cacheAgent(agent: AgentIdentity): Promise<void> {
    try {
      await redis.set(
        `agent:${agent.agentId}`,
        JSON.stringify(agent),
        "EX",
        AGENT_RECORD_TTL_SECONDS,
      );
      await redis.set(
        `agent:did:${agent.did}`,
        agent.agentId,
        "EX",
        AGENT_RECORD_TTL_SECONDS,
      );
      await redis.sadd(
        this.operatorAgentSetKey(agent.operatorId),
        agent.agentId,
      );
      await redis.expire(
        this.operatorAgentSetKey(agent.operatorId),
        AGENT_RECORD_TTL_SECONDS,
      );
    } catch (error) {
      // Cache loss must not roll back or hide the authoritative Prisma row.
      logger.warn("agent_cache_write_failed", {
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

  private async invalidateDelegationCacheBestEffort(
    agentId: string,
  ): Promise<void> {
    try {
      const fromKey = `delegations:from:${agentId}`;
      const toKey = `delegations:to:${agentId}`;
      const [outgoing, incoming] = await Promise.all([
        redis.smembers(fromKey),
        redis.smembers(toKey),
      ]);
      const delegationIds = Array.from(new Set([...outgoing, ...incoming]));
      if (delegationIds.length > 0) {
        await redis.del(
          ...delegationIds.map((delegationId) => `delegation:${delegationId}`),
        );
      }
      await redis.del(fromKey, toKey);
    } catch (error) {
      // Authorization always consults Prisma, so stale or unavailable cache
      // entries cannot preserve a revoked grant.
      logger.warn("agent_delegation_cache_invalidation_failed", {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private fromPrismaAgent(row: PrismaAIAgent): AgentIdentity {
    if (
      !row.description ||
      !row.controllerDid ||
      !row.agentProtocol ||
      !AGENT_PROTOCOLS.has(row.agentProtocol as AgentProtocol) ||
      !row.publicKey ||
      !row.publicKeyHash
    ) {
      throw new AgentIdentityError(
        "Durable agent record is missing protocol or verification-key material",
        "AGENT_RECORD_INCOMPLETE",
        503,
      );
    }

    const computedPublicKeyHash = crypto
      .createHash("sha256")
      .update(row.publicKey)
      .digest("hex");
    if (computedPublicKeyHash !== row.publicKeyHash) {
      throw new AgentIdentityError(
        "Durable agent verification-key fingerprint is invalid",
        "AGENT_RECORD_INVALID",
        503,
      );
    }
    try {
      const persistedKey = this.parseVerificationKey(row.publicKey);
      if (persistedKey.asymmetricKeyType !== "ed25519") {
        throw new Error("Unsupported key type");
      }
    } catch {
      throw new AgentIdentityError(
        "Durable agent verification key is not valid Ed25519 material",
        "AGENT_RECORD_INVALID",
        503,
      );
    }

    const capabilities = this.parsePersistedCapabilities(row.capabilities);
    const metadata = this.parsePersistedMetadata(row.metadata);
    if (
      row.teeAttested ||
      row.teeAttestationId !== null ||
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
      row.version < 0 ||
      !Number.isSafeInteger(row.authorizationVersion) ||
      row.authorizationVersion < 0 ||
      !Number.isSafeInteger(row.maxDelegationDepth) ||
      row.maxDelegationDepth < 0 ||
      row.maxDelegationDepth > MAX_DELEGATION_TRAVERSAL_DEPTH
    ) {
      throw new AgentIdentityError(
        "Durable agent security state is invalid or unsupported",
        "AGENT_RECORD_INVALID",
        503,
      );
    }

    const status = this.fromPrismaAgentStatus(row.status);
    if (
      status === "suspended" &&
      (!row.suspendedAt || !row.suspendedBy || !row.suspensionReason)
    ) {
      throw new AgentIdentityError(
        "Suspended durable agent is missing suspension evidence",
        "AGENT_RECORD_INCOMPLETE",
        503,
      );
    }

    return {
      agentId: row.id,
      did: row.agentDid,
      operatorId: row.operatorId,
      controllerDid: row.controllerDid,
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
        ...(row.totalActions === 0
          ? {}
          : {
              successRate: row.successfulActions / row.totalActions,
              averageLatencyMs: row.totalLatencyMs / row.totalActions,
            }),
      },
      recordVersion: row.version,
      authorizationVersion: row.authorizationVersion,
    };
  }

  private fromPrismaAgentStatus(status: PrismaAIAgent["status"]): AgentStatus {
    switch (status) {
      case "PENDING_APPROVAL":
        return "pending";
      case "ACTIVE":
        return "active";
      case "SUSPENDED":
        return "suspended";
      case "REVOKED":
        return "revoked";
    }
  }

  private fromPrismaDelegation(row: PrismaAgentDelegation): DelegationChain {
    if (
      !row.id ||
      !row.fromAgentId ||
      !row.toAgentId ||
      row.fromAgentId === row.toAgentId ||
      !Array.isArray(row.capabilities) ||
      row.capabilities.length === 0 ||
      row.capabilities.some(
        (capability) =>
          typeof capability !== "string" || capability.trim().length === 0,
      ) ||
      new Set(row.capabilities).size !== row.capabilities.length ||
      !Number.isSafeInteger(row.depth) ||
      row.depth < 1 ||
      !Number.isSafeInteger(row.maxDepth) ||
      row.maxDepth < 1 ||
      row.maxDepth > MAX_DELEGATION_TRAVERSAL_DEPTH ||
      row.depth > row.maxDepth ||
      !Number.isSafeInteger(row.authorizationCount) ||
      row.authorizationCount < 0 ||
      !Number.isSafeInteger(row.version) ||
      row.version < 0 ||
      !(row.createdAt instanceof Date) ||
      !Number.isFinite(row.createdAt.getTime()) ||
      !(row.expiresAt instanceof Date) ||
      !Number.isFinite(row.expiresAt.getTime()) ||
      row.expiresAt <= row.createdAt
    ) {
      throw new AgentIdentityError(
        "Durable delegation record is invalid",
        "AGENT_DELEGATION_RECORD_INVALID",
        503,
      );
    }

    const status = this.fromPrismaDelegationStatus(row.status);
    if (
      (status === "revoked" &&
        (!row.revokedAt || !row.revokedBy || !row.revokedBy.trim())) ||
      (status !== "revoked" &&
        (row.revokedAt !== null || row.revokedBy !== null))
    ) {
      throw new AgentIdentityError(
        "Durable delegation revocation evidence is invalid",
        "AGENT_DELEGATION_RECORD_INVALID",
        503,
      );
    }

    let constraints: DelegationConstraintSpec[];
    try {
      if (!Array.isArray(row.constraints)) {
        throw new Error("constraints must be an array");
      }
      constraints = this.normalizeDelegationConstraints(
        row.constraints as unknown as DelegationConstraintSpec[],
        row.createdAt,
        row.expiresAt,
      );
    } catch {
      throw new AgentIdentityError(
        "Durable delegation constraints are invalid",
        "AGENT_DELEGATION_RECORD_INVALID",
        503,
      );
    }

    return {
      delegationId: row.id,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      capabilities: [...row.capabilities],
      constraints,
      depth: row.depth,
      maxDepth: row.maxDepth,
      status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? undefined,
      revokedBy: row.revokedBy ?? undefined,
      parentDelegationId: row.parentDelegationId ?? undefined,
      recordVersion: row.version,
    };
  }

  private fromPrismaDelegationStatus(
    status: PrismaAgentDelegation["status"],
  ): DelegationChain["status"] {
    switch (status) {
      case "ACTIVE":
        return "active";
      case "EXPIRED":
        return "expired";
      case "REVOKED":
        return "revoked";
    }
  }

  private fromPrismaApprovalRequest(
    row: PrismaAgentApprovalRequest,
  ): HumanApprovalRequest {
    const riskLevels = new Set(["low", "medium", "high", "critical"]);
    if (
      !row.id ||
      !row.approvalGroupId ||
      !row.operationId ||
      !/^[a-f0-9]{64}$/.test(row.operationDigest) ||
      !/^[a-f0-9]{64}$/.test(row.authorizationSnapshotDigest) ||
      !Array.isArray(row.requestedCapabilities) ||
      row.requestedCapabilities.length === 0 ||
      !Array.isArray(row.requiredApproverIds) ||
      row.requiredApproverIds.length === 0 ||
      new Set(row.requiredApproverIds).size !==
        row.requiredApproverIds.length ||
      !row.agentId ||
      !row.audienceId ||
      !row.operatorId ||
      !row.requiredApproverIds.includes(row.operatorId) ||
      !row.action ||
      !row.resourceType ||
      !row.resourceId ||
      !riskLevels.has(row.riskLevel) ||
      typeof row.context !== "object" ||
      row.context === null ||
      Array.isArray(row.context) ||
      !Number.isSafeInteger(row.version) ||
      row.version < 0 ||
      !(row.createdAt instanceof Date) ||
      !Number.isFinite(row.createdAt.getTime()) ||
      !(row.expiresAt instanceof Date) ||
      !Number.isFinite(row.expiresAt.getTime()) ||
      row.expiresAt <= row.createdAt
    ) {
      throw new AgentIdentityError(
        "Durable approval request is invalid",
        "AGENT_APPROVAL_RECORD_INVALID",
        503,
      );
    }

    const status = this.fromPrismaApprovalStatus(row.status);
    const hasCompleteResponse = Boolean(
      row.respondedAt && row.respondedBy?.trim() && row.responseNote?.trim(),
    );
    const hasAnyResponse = Boolean(
      row.respondedAt || row.respondedBy || row.responseNote,
    );
    const hasCompleteConsumption = Boolean(
      row.consumedAt && row.consumedByChallengeId?.trim(),
    );
    const hasAnyConsumption = Boolean(
      row.consumedAt || row.consumedByChallengeId,
    );
    if (
      ((status === "approved" ||
        status === "rejected" ||
        status === "consumed") &&
        !hasCompleteResponse) ||
      ((status === "pending" || status === "expired") && hasAnyResponse) ||
      (status === "consumed" && !hasCompleteConsumption) ||
      (status !== "consumed" && hasAnyConsumption)
    ) {
      throw new AgentIdentityError(
        "Durable approval response evidence is invalid",
        "AGENT_APPROVAL_RECORD_INVALID",
        503,
      );
    }

    return {
      requestId: row.id,
      approvalGroupId: row.approvalGroupId,
      operationId: row.operationId,
      operationDigest: row.operationDigest,
      authorizationSnapshotDigest: row.authorizationSnapshotDigest,
      requestedCapabilities: [...row.requestedCapabilities],
      requiredApproverIds: [...row.requiredApproverIds],
      agentId: row.agentId,
      audienceId: row.audienceId,
      operatorId: row.operatorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      riskLevel: row.riskLevel,
      context: row.context as Record<string, unknown>,
      status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      respondedAt: row.respondedAt ?? undefined,
      respondedBy: row.respondedBy ?? undefined,
      responseNote: row.responseNote ?? undefined,
      consumedAt: row.consumedAt ?? undefined,
      consumedByChallengeId: row.consumedByChallengeId ?? undefined,
      recordVersion: row.version,
    };
  }

  private fromPrismaApprovalStatus(
    status: PrismaAgentApprovalRequest["status"],
  ): ApprovalStatus {
    switch (status) {
      case "PENDING":
        return "pending";
      case "APPROVED":
        return "approved";
      case "REJECTED":
        return "rejected";
      case "EXPIRED":
        return "expired";
      case "CONSUMED":
        return "consumed";
    }
  }

  private parsePersistedCapabilities(value: unknown): AgentCapability[] {
    if (!Array.isArray(value)) {
      throw new AgentIdentityError(
        "Durable agent capabilities are invalid",
        "AGENT_RECORD_INVALID",
        503,
      );
    }

    const validRiskLevels = new Set(["low", "medium", "high", "critical"]);
    const capabilityNames = new Set<string>();
    for (const item of value) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new AgentIdentityError(
          "Durable agent capabilities are invalid",
          "AGENT_RECORD_INVALID",
          503,
        );
      }
      const capability = item as Record<string, unknown>;
      const rateLimit = capability.rateLimit;
      const rateLimitRecord = rateLimit as Record<string, unknown> | undefined;
      const validRateLimit =
        rateLimit === undefined ||
        (typeof rateLimit === "object" &&
          rateLimit !== null &&
          !Array.isArray(rateLimit) &&
          Object.keys(rateLimit).every(
            (key) => key === "maxPerHour" || key === "maxPerDay",
          ) &&
          Number.isSafeInteger(rateLimitRecord?.maxPerHour) &&
          (rateLimitRecord?.maxPerHour as number) > 0 &&
          (rateLimitRecord?.maxPerHour as number) <= 10000 &&
          Number.isSafeInteger(rateLimitRecord?.maxPerDay) &&
          (rateLimitRecord?.maxPerDay as number) > 0 &&
          (rateLimitRecord?.maxPerDay as number) <= 100000);
      const validStringList = (candidate: unknown): candidate is string[] =>
        Array.isArray(candidate) &&
        candidate.length > 0 &&
        candidate.length <= 20 &&
        candidate.every(
          (entry) =>
            typeof entry === "string" &&
            entry.trim().length > 0 &&
            entry.length <= 50,
        ) &&
        new Set(candidate).size === candidate.length;
      if (
        typeof capability.name !== "string" ||
        capability.name.trim().length === 0 ||
        capability.name.length > 100 ||
        capabilityNames.has(capability.name) ||
        typeof capability.description !== "string" ||
        capability.description.trim().length === 0 ||
        capability.description.length > 500 ||
        !validStringList(capability.resourceTypes) ||
        !validStringList(capability.actions) ||
        typeof capability.riskLevel !== "string" ||
        !validRiskLevels.has(capability.riskLevel) ||
        typeof capability.requiresApproval !== "boolean" ||
        (capability.riskLevel === "critical" &&
          capability.requiresApproval !== true) ||
        !validRateLimit
      ) {
        throw new AgentIdentityError(
          "Durable agent capabilities are invalid",
          "AGENT_RECORD_INVALID",
          503,
        );
      }
      capabilityNames.add(capability.name);
    }
    return value as AgentCapability[];
  }

  private validateRequestedCapabilities(capabilities: AgentCapability[]): void {
    try {
      this.parsePersistedCapabilities(capabilities);
    } catch {
      throw new AgentIdentityError(
        "Agent capabilities are invalid",
        "AGENT_CAPABILITIES_INVALID",
        400,
      );
    }
  }

  private parsePersistedMetadata(value: unknown): Record<string, unknown> {
    if (value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new AgentIdentityError(
        "Durable agent metadata is invalid",
        "AGENT_RECORD_INVALID",
        503,
      );
    }
    return value as Record<string, unknown>;
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
    this.name = "AgentIdentityError";
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const agentIdentityService = new AgentIdentityService();
