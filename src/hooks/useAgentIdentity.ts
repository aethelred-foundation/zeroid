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

// ---------------------------------------------------------------------------
// List Agents
// ---------------------------------------------------------------------------

export function useAgents() {
  const { address } = useAccount();

  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: () =>
      apiClient.get<Agent[]>("/api/v1/agents", {
        owner: address as string,
      }) as unknown as Agent[],
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
    queryFn: () =>
      apiClient.get<Agent>(`/api/v1/agents/${agentId}`) as unknown as Agent,
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
      return apiClient.post<Agent>(
        "/api/v1/agents/register",
        config,
      ) as unknown as Agent;
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
      return apiClient.put<Agent>(
        `/api/v1/agents/${params.agentId}/capabilities`,
        { capabilities: params.capabilities },
      ) as unknown as Agent;
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
      constraints: DelegationConstraints;
    }): Promise<DelegationChain> => {
      return apiClient.post<DelegationChain>(
        "/api/v1/agents/delegations",
        params,
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
    }): Promise<AgentVerification> => {
      return apiClient.post<AgentVerification>(
        `/api/v1/agents/${params.agentId}/verify`,
        { challenge: params.challenge },
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
      return apiClient.post<Agent>(`/api/v1/agents/${params.agentId}/suspend`, {
        reason: params.reason,
      }) as unknown as Agent;
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
      apiClient.get<ApprovalQueueItem[]>("/api/v1/agents/approvals", {
        owner: address as string,
      }) as unknown as ApprovalQueueItem[],
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
      await apiClient.post(`/api/v1/agents/approvals/${params.actionId}`, {
        approved: params.approved,
        reason: params.reason,
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
