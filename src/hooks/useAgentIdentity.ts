/** Authenticated React Query hooks for the production AI Agent Identity API. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import {
  createAIAgent,
  getAIAgent,
  getAIAgents,
  getAgentApprovals,
  respondToAgentApproval,
  suspendAIAgent,
  type RegisterAIAgentRequest,
} from "@/lib/api/agent-passport-client";

export type {
  AgentApproval,
  AgentLifecycleStatus,
  AgentProtocol,
  AgentRiskLevel,
  AIAgentCapability,
  AIAgentRecord,
  AIAgentStats,
  RegisterAIAgentRequest,
  RegisterAIAgentResult,
  ResolveAgentApprovalResult,
  SuspendAIAgentResult,
} from "@/lib/api/agent-passport-client";

export type AgentAccessState = "wallet-required" | "sign-in-required" | "ready";

export const agentIdentityKeys = {
  all: ["agent-identity"] as const,
  list: (address?: string) =>
    [...agentIdentityKeys.all, "list", address ?? "disconnected"] as const,
  detail: (agentId: string) =>
    [...agentIdentityKeys.all, "detail", agentId] as const,
  approvals: (address?: string) =>
    [...agentIdentityKeys.all, "approvals", address ?? "disconnected"] as const,
};

function getAccessState(address?: string): AgentAccessState {
  if (!address) return "wallet-required";
  return getIdentityAuthToken() ? "ready" : "sign-in-required";
}

function requireIdentitySession(address?: string): string {
  if (!address) {
    throw new Error("Connect a wallet before managing AI agents.");
  }
  const token = getIdentityAuthToken();
  if (!token) {
    throw new Error(
      "An authenticated ZeroID identity session is required before managing AI agents.",
    );
  }
  return token;
}

export function useAgents() {
  const { address } = useAccount();
  const authToken = getIdentityAuthToken();
  const accessState = getAccessState(address);
  const query = useQuery({
    queryKey: agentIdentityKeys.list(address),
    queryFn: () => getAIAgents(authToken!),
    enabled: accessState === "ready",
    staleTime: 15_000,
  });

  return { ...query, accessState };
}

export function useAgent(agentId?: string) {
  const { address } = useAccount();
  const authToken = getIdentityAuthToken();
  const accessState = getAccessState(address);
  return useQuery({
    queryKey: agentIdentityKeys.detail(agentId ?? "unselected"),
    queryFn: () => getAIAgent(agentId!, authToken!),
    enabled: accessState === "ready" && !!agentId,
    staleTime: 10_000,
  });
}

export function useRegisterAgent() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RegisterAIAgentRequest) =>
      createAIAgent(request, requireIdentitySession(address)),
    onSuccess: (agent) => {
      toast.success("Agent registered", {
        description: `${agent.agentName} is ${agent.status}.`,
      });
      void queryClient.invalidateQueries({
        queryKey: agentIdentityKeys.list(address),
      });
    },
    onError: (error: Error) => {
      toast.error("Agent registration failed", { description: error.message });
    },
  });
}

export function useSuspendAgent() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, reason }: { agentId: string; reason: string }) =>
      suspendAIAgent(agentId, reason, requireIdentitySession(address)),
    onSuccess: (agent) => {
      toast.warning("Agent suspended", { description: agent.reason });
      void queryClient.invalidateQueries({
        queryKey: agentIdentityKeys.list(address),
      });
      void queryClient.invalidateQueries({
        queryKey: agentIdentityKeys.detail(agent.agentId),
      });
    },
    onError: (error: Error) => {
      toast.error("Suspension failed", { description: error.message });
    },
  });
}

export function useApprovalQueue() {
  const { address } = useAccount();
  const authToken = getIdentityAuthToken();
  const accessState = getAccessState(address);
  const query = useQuery({
    queryKey: agentIdentityKeys.approvals(address),
    queryFn: () => getAgentApprovals(authToken!),
    enabled: accessState === "ready",
    staleTime: 10_000,
    refetchInterval: process.env.NODE_ENV === "test" ? false : 15_000,
  });
  return { ...query, accessState };
}

export function useApproveAction() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      approved,
      note,
    }: {
      requestId: string;
      approved: boolean;
      note: string;
    }) =>
      respondToAgentApproval(
        requestId,
        approved,
        note,
        requireIdentitySession(address),
      ),
    onSuccess: (approval) => {
      toast.success(
        approval.status === "approved" ? "Action approved" : "Action rejected",
      );
      void queryClient.invalidateQueries({
        queryKey: agentIdentityKeys.approvals(address),
      });
    },
    onError: (error: Error) => {
      toast.error("Approval action failed", { description: error.message });
    },
  });
}
