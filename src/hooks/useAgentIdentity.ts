/**
 * useAgentIdentity — Hook for AI agent identity lifecycle management.
 *
 * Handles agent registration, capability updates, delegation chains,
 * M2M verification, suspension, and human-in-the-loop approval queues.
 * All operations are API-backed with React Query caching.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type { Address, ISODateString, UnixTimestamp } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  name: string;
  description: string;
  ownerAddress: Address;
  capabilities: AgentCapability[];
  delegationPolicy: DelegationPolicy;
  maxAutonomyLevel: AutonomyLevel;
  publicKey?: string;
  agentProtocol?: string;
  maxDelegationDepth?: number;
  teeRequired?: boolean;
  webhookUrl?: string;
  metadata?: Record<string, string>;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  ownerAddress: Address;
  status: AgentStatus;
  capabilities: AgentCapability[];
  delegationPolicy: DelegationPolicy;
  autonomyLevel: AutonomyLevel;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  lastActiveAt?: ISODateString;
  suspendedAt?: ISODateString;
  suspensionReason?: string;
  verificationCount: number;
  webhookUrl?: string;
  metadata?: Record<string, string>;
}

export type AgentStatus =
  | "active"
  | "suspended"
  | "pending_approval"
  | "revoked";

export type AutonomyLevel = "full" | "supervised" | "restricted" | "manual";

export interface AgentCapability {
  type: CapabilityType;
  scope: string;
  constraints?: Record<string, unknown>;
  grantedAt: ISODateString;
  expiresAt?: ISODateString;
}

export type CapabilityType =
  | "credential_request"
  | "credential_verify"
  | "identity_read"
  | "identity_update"
  | "payment_initiate"
  | "compliance_check"
  | "data_access"
  | "delegation_grant";

export interface DelegationPolicy {
  allowSubDelegation: boolean;
  maxDepth: number;
  requireHumanApproval: boolean;
  approvalThreshold: number;
  expirySeconds: number;
}

export interface DelegationChain {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  capabilities: CapabilityType[];
  constraints: DelegationConstraints;
  depth: number;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  status: "active" | "expired" | "revoked";
}

export interface DelegationConstraints {
  maxTransactionValue?: number;
  allowedJurisdictions?: string[];
  timeWindowStart?: string;
  timeWindowEnd?: string;
  rateLimit?: number;
  rateLimitWindow?: number;
  requireApprovalAbove?: number;
}

export interface AgentVerification {
  agentId: string;
  challenge: string;
  response: string;
  verified: boolean;
  verifiedAt: ISODateString;
  attestationHash?: string;
}

export interface ApprovalQueueItem {
  id: string;
  agentId: string;
  agentName: string;
  actionType: string;
  actionDescription: string;
  riskScore: number;
  requestedAt: ISODateString;
  expiresAt: ISODateString;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const agentKeys = {
  all: ["agents"] as const,
  list: () => [...agentKeys.all, "list"] as const,
  detail: (id: string) => [...agentKeys.all, "detail", id] as const,
  approvals: () => [...agentKeys.all, "approvals"] as const,
  delegations: (id: string) => [...agentKeys.all, "delegations", id] as const,
};

const AGENT_API_BASE = "/api/v1/ai/agents";
const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

type BackendAgentCapability = {
  name: string;
  description: string;
  resourceTypes: string[];
  actions: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  rateLimit?: { maxPerHour: number; maxPerDay: number };
};

type BackendAgent = Partial<Agent> & {
  agentId?: string;
  agentName?: string;
  agentDescription?: string;
  agentProtocol?: string;
  operatorId?: string;
  maxDelegationDepth?: number;
  stats?: {
    totalActions?: number;
  };
  suspension?: {
    reason?: string;
    suspendedAt?: string;
  };
};

type BackendDelegationConstraint = {
  type:
    | "time_bounded"
    | "action_scoped"
    | "resource_scoped"
    | "rate_limited"
    | "approval_required";
  parameters: Record<string, unknown>;
};

function toIsoDate(value: unknown): ISODateString {
  if (typeof value === "string") return value as ISODateString;
  if (value instanceof Date) return value.toISOString() as ISODateString;
  return new Date().toISOString() as ISODateString;
}

function normalizeStatus(status: unknown): AgentStatus {
  if (status === "pending") return "pending_approval";
  if (status === "active" || status === "suspended" || status === "revoked") {
    return status;
  }
  if (status === "pending_approval") return "pending_approval";
  return "active";
}

function normalizeCapabilities(capabilities: unknown): AgentCapability[] {
  if (!Array.isArray(capabilities)) return [];

  return capabilities.map((capability) => {
    const record = capability as Partial<AgentCapability> & Partial<BackendAgentCapability>;
    const type = (record.type ?? record.name ?? "data_access") as CapabilityType;
    const scope = record.scope ?? record.resourceTypes?.[0] ?? "*";
    return {
      type,
      scope,
      constraints: record.constraints,
      grantedAt: toIsoDate(record.grantedAt),
      expiresAt: record.expiresAt ? toIsoDate(record.expiresAt) : undefined,
    };
  });
}

function normalizeAgent(raw: BackendAgent): Agent {
  const id = raw.id ?? raw.agentId ?? "";
  return {
    id,
    name: raw.name ?? raw.agentName ?? id,
    description: raw.description ?? raw.agentDescription ?? "",
    ownerAddress: raw.ownerAddress ?? EMPTY_ADDRESS,
    status: normalizeStatus(raw.status),
    capabilities: normalizeCapabilities(raw.capabilities),
    delegationPolicy: raw.delegationPolicy ?? {
      allowSubDelegation: (raw.maxDelegationDepth ?? 0) > 1,
      maxDepth: raw.maxDelegationDepth ?? 0,
      requireHumanApproval: true,
      approvalThreshold: 1,
      expirySeconds: 3600,
    },
    autonomyLevel: raw.autonomyLevel ?? "supervised",
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastActiveAt: raw.lastActiveAt ? toIsoDate(raw.lastActiveAt) : undefined,
    suspendedAt: raw.suspendedAt ?? raw.suspension?.suspendedAt,
    suspensionReason: raw.suspensionReason ?? raw.suspension?.reason,
    verificationCount: raw.verificationCount ?? raw.stats?.totalActions ?? 0,
    webhookUrl: raw.webhookUrl,
    metadata: raw.metadata,
  };
}

function inferRiskLevel(type: CapabilityType): BackendAgentCapability["riskLevel"] {
  if (type === "payment_initiate" || type === "identity_update" || type === "delegation_grant") {
    return "high";
  }
  if (type === "compliance_check" || type === "data_access") {
    return "medium";
  }
  return "low";
}

function toBackendCapability(
  capability: AgentCapability,
  requireHumanApproval: boolean,
): BackendAgentCapability {
  const existing = capability as AgentCapability & Partial<BackendAgentCapability>;
  const scope = capability.scope === "*" ? "global" : capability.scope;

  return {
    name: existing.name ?? capability.type,
    description: existing.description ?? `Grants ${capability.type} on ${capability.scope}.`,
    resourceTypes: existing.resourceTypes ?? [scope],
    actions: existing.actions ?? [capability.type],
    riskLevel: existing.riskLevel ?? inferRiskLevel(capability.type),
    requiresApproval: existing.requiresApproval ?? requireHumanApproval,
    rateLimit: existing.rateLimit,
  };
}

function toDelegationConstraints(
  constraints: DelegationConstraints | BackendDelegationConstraint[],
): BackendDelegationConstraint[] {
  if (Array.isArray(constraints)) return constraints;

  const normalized: BackendDelegationConstraint[] = [];
  if (constraints.timeWindowStart || constraints.timeWindowEnd) {
    normalized.push({
      type: "time_bounded",
      parameters: {
        start: constraints.timeWindowStart,
        end: constraints.timeWindowEnd,
      },
    });
  }
  if (constraints.rateLimit || constraints.rateLimitWindow) {
    normalized.push({
      type: "rate_limited",
      parameters: {
        limit: constraints.rateLimit,
        window: constraints.rateLimitWindow,
      },
    });
  }
  if (constraints.allowedJurisdictions?.length) {
    normalized.push({
      type: "resource_scoped",
      parameters: {
        jurisdictions: constraints.allowedJurisdictions,
      },
    });
  }
  if (constraints.requireApprovalAbove !== undefined) {
    normalized.push({
      type: "approval_required",
      parameters: {
        above: constraints.requireApprovalAbove,
      },
    });
  }
  return normalized;
}

function toRegisterPayload(config: AgentConfig) {
  if (!config.publicKey) {
    throw new Error("Agent registration requires a cryptographic public key.");
  }

  return {
    agentName: config.name,
    agentDescription: config.description,
    agentProtocol: config.agentProtocol ?? "aethelred_native",
    capabilities: config.capabilities.map((capability) =>
      toBackendCapability(capability, config.delegationPolicy.requireHumanApproval),
    ),
    publicKey: config.publicKey,
    maxDelegationDepth: config.maxDelegationDepth ?? config.delegationPolicy.maxDepth,
    teeRequired: config.teeRequired ?? false,
    metadata: {
      ...config.metadata,
      ownerAddress: config.ownerAddress,
      webhookUrl: config.webhookUrl,
      maxAutonomyLevel: config.maxAutonomyLevel,
    },
  };
}

// ---------------------------------------------------------------------------
// List Agents
// ---------------------------------------------------------------------------

export function useAgents() {
  const { address } = useAccount();

  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: async () => {
      const agents = await apiClient.get<BackendAgent[]>(AGENT_API_BASE);
      return agents.map(normalizeAgent);
    },
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Get Single Agent
// ---------------------------------------------------------------------------

export function useAgent(agentId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.detail(agentId ?? ""),
    queryFn: async () => {
      const agent = await apiClient.get<BackendAgent>(`${AGENT_API_BASE}/${agentId}`);
      return normalizeAgent(agent);
    },
    enabled: !!agentId,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Register Agent
// ---------------------------------------------------------------------------

export function useRegisterAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: AgentConfig): Promise<Agent> => {
      const agent = await apiClient.post<BackendAgent>(
        AGENT_API_BASE,
        toRegisterPayload(config),
      );
      return normalizeAgent(agent);
    },
    onSuccess: (data) => {
      toast.success("Agent registered", {
        description: `${data.name} (${data.id.slice(0, 8)}...) is now ${data.status}`,
      });
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
    onError: (err: Error) => {
      toast.error("Agent registration failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Update Capabilities
// ---------------------------------------------------------------------------

export function useUpdateCapabilities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      agentId: string;
      capabilities: AgentCapability[];
    }): Promise<Agent> => {
      const agent = await apiClient.post<BackendAgent>(
        `${AGENT_API_BASE}/${params.agentId}/capabilities`,
        { capabilities: params.capabilities.map((capability) => toBackendCapability(capability, true)) },
      );
      return normalizeAgent(agent);
    },
    onSuccess: (data) => {
      toast.success("Capabilities updated", {
        description: `${data.capabilities.length} capability/ies assigned to ${data.name}`,
      });
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
    onError: (err: Error) => {
      toast.error("Capability update failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Create Delegation
// ---------------------------------------------------------------------------

export function useCreateDelegation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      fromAgentId: string;
      toAgentId: string;
      capabilities: CapabilityType[];
      constraints: DelegationConstraints | BackendDelegationConstraint[];
      durationHours?: number;
    }): Promise<DelegationChain> => {
      return apiClient.post<DelegationChain>(
        `${AGENT_API_BASE}/${params.fromAgentId}/delegate`,
        {
          toAgentId: params.toAgentId,
          capabilities: params.capabilities,
          constraints: toDelegationConstraints(params.constraints),
          durationHours: params.durationHours ?? 1,
        },
      ) as unknown as DelegationChain;
    },
    onSuccess: (data) => {
      toast.success("Delegation created", {
        description: `Chain depth: ${data.depth}, expires ${new Date(data.expiresAt).toLocaleDateString()}`,
      });
      queryClient.invalidateQueries({
        queryKey: agentKeys.delegations(data.fromAgentId),
      });
    },
    onError: (err: Error) => {
      toast.error("Delegation creation failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Verify Agent (M2M challenge-response)
// ---------------------------------------------------------------------------

export function useVerifyAgent() {
  return useMutation({
    mutationFn: async (params: {
      agentId: string;
      challenge: string;
      signature: string;
      requestedCapabilities: CapabilityType[];
      purpose: string;
      resourceId?: string;
      callerAgentId?: string;
      callerProtocol?: string;
    }): Promise<AgentVerification> => {
      return apiClient.post<AgentVerification>(
        `${AGENT_API_BASE}/${params.agentId}/verify`,
        {
          challenge: params.challenge,
          signature: params.signature,
          requestedCapabilities: params.requestedCapabilities,
          context: {
            callerAgentId: params.callerAgentId,
            callerProtocol: params.callerProtocol,
            purpose: params.purpose,
            resourceId: params.resourceId,
          },
        },
      ) as unknown as AgentVerification;
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success("Agent verified successfully");
      } else {
        toast.error("Agent verification failed");
      }
    },
    onError: (err: Error) => {
      toast.error("Verification request failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Suspend Agent
// ---------------------------------------------------------------------------

export function useSuspendAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      agentId: string;
      reason: string;
    }): Promise<Agent> => {
      const agent = await apiClient.post<BackendAgent>(
        `${AGENT_API_BASE}/${params.agentId}/suspend`,
        {
          reason: params.reason,
        },
      );
      return normalizeAgent(agent);
    },
    onSuccess: (data) => {
      toast.warning("Agent suspended", {
        description: `${data.name} has been suspended: ${data.suspensionReason}`,
      });
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.list() });
    },
    onError: (err: Error) => {
      toast.error("Suspension failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Approval Queue
// ---------------------------------------------------------------------------

export function useApprovalQueue() {
  const { address } = useAccount();

  return useQuery({
    queryKey: agentKeys.approvals(),
    queryFn: () =>
      apiClient.get<ApprovalQueueItem[]>(`${AGENT_API_BASE}/approvals`) as unknown as ApprovalQueueItem[],
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      actionId: string;
      approved: boolean;
      reason?: string;
    }): Promise<void> => {
      await apiClient.post(`${AGENT_API_BASE}/approvals/${params.actionId}`, {
        approved: params.approved,
        note: params.reason ?? (params.approved ? "Approved" : "Rejected"),
      });
    },
    onSuccess: (_, params) => {
      toast.success(params.approved ? "Action approved" : "Action rejected");
      queryClient.invalidateQueries({ queryKey: agentKeys.approvals() });
    },
    onError: (err: Error) => {
      toast.error("Approval action failed", { description: err.message });
    },
  });
}
