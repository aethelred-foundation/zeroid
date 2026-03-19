/**
 * useGovernance — Hook for ZeroID DAO governance interactions.
 *
 * Covers proposal creation, voting, execution, and voting power queries.
 * Uses on-chain reads for vote tallies and off-chain API for metadata.
 */

import { useCallback } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  GOVERNANCE_ADDRESS,
  GOVERNANCE_ABI,
  GOVERNANCE_TOKEN_ADDRESS,
  GOVERNANCE_TOKEN_ABI,
} from "@/config/constants";
import type {
  Proposal,
  ProposalStatus,
  VoteType,
  CreateProposalParams,
  VotingPower,
} from "@/types";

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need { proposals, votingPower }
// ---------------------------------------------------------------------------

export function useGovernance() {
  const proposalsQuery = useProposals();
  const power = useVotingPower();
  const voteMutation = useVote();

  return {
    proposals: proposalsQuery.data?.proposals ?? [],
    votingPower: Number(power.votingPower),
    delegatedTo: power.delegatee,
    isLoading: proposalsQuery.isLoading || power.isLoading,
    vote: async (proposalId: string, support: string) => {
      const supportMap: Record<string, number> = {
        for: 1,
        against: 0,
        abstain: 2,
      };
      await voteMutation.mutateAsync({
        proposalId: BigInt(proposalId),
        support: (supportMap[support] ?? 2) as any,
      });
    },
    delegate: async (_address: string) => {
      // Delegation handled via governance token contract
    },
  };
}

// ---------------------------------------------------------------------------
// Voting power (on-chain token balance + delegated weight)
// ---------------------------------------------------------------------------

export function useVotingPower() {
  const { address } = useAccount();

  const { data: balance, isLoading: isBalanceLoading } = useReadContract({
    address: GOVERNANCE_TOKEN_ADDRESS as Address,
    abi: GOVERNANCE_TOKEN_ABI,
    functionName: "getVotes",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  const { data: delegatee } = useReadContract({
    address: GOVERNANCE_TOKEN_ADDRESS as Address,
    abi: GOVERNANCE_TOKEN_ABI,
    functionName: "delegates",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    votingPower: (balance as bigint) ?? 0n,
    delegatee: delegatee as Address | undefined,
    isLoading: isBalanceLoading,
    hasPower: !!balance && (balance as bigint) > 0n,
  };
}

// ---------------------------------------------------------------------------
// Proposals list (off-chain metadata + on-chain status)
// ---------------------------------------------------------------------------

export function useProposals(status?: ProposalStatus, page = 1) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("page", String(page));
  params.set("pageSize", "20");

  return useQuery({
    queryKey: ["proposals", status, page],
    queryFn: () =>
      apiClient.get<{ proposals: Proposal[]; total: number }>(
        `/v1/governance/proposals?${params.toString()}`,
      ),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Single proposal detail with on-chain vote tally
// ---------------------------------------------------------------------------

export function useProposalDetail(proposalId: bigint | undefined) {
  const { data: votes, isLoading: isVotesLoading } = useReadContract({
    address: GOVERNANCE_ADDRESS as Address,
    abi: GOVERNANCE_ABI,
    functionName: "proposalVotes",
    args: proposalId !== undefined ? [proposalId] : undefined,
    query: { enabled: proposalId !== undefined, refetchInterval: 15_000 },
  });

  const apiQuery = useQuery({
    queryKey: ["proposal", proposalId?.toString()],
    queryFn: () =>
      apiClient.get<Proposal>(`/v1/governance/proposals/${proposalId}`),
    enabled: proposalId !== undefined,
    staleTime: 10_000,
  });

  const [againstVotes, forVotes, abstainVotes] = (votes as [
    bigint,
    bigint,
    bigint,
  ]) ?? [0n, 0n, 0n];

  return {
    ...apiQuery,
    onChainVotes: { againstVotes, forVotes, abstainVotes },
    isVotesLoading,
  };
}

// ---------------------------------------------------------------------------
// Create proposal
// ---------------------------------------------------------------------------

export function useCreateProposal() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  return useMutation({
    mutationFn: async (params: CreateProposalParams): Promise<Hash> => {
      // Submit proposal on-chain
      const hash = await writeContractAsync({
        address: GOVERNANCE_ADDRESS as Address,
        abi: GOVERNANCE_ABI,
        functionName: "propose",
        args: [
          params.targets,
          params.values,
          params.calldatas,
          params.description,
        ],
      });

      // Store extended metadata via API
      await apiClient.post("/v1/governance/proposals/metadata", {
        txHash: hash,
        title: params.title,
        summary: params.summary,
        discussionUrl: params.discussionUrl,
      });

      return hash;
    },
    onSuccess: () => {
      toast.success("Proposal created");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
    },
    onError: (err: Error) => {
      toast.error("Proposal creation failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Cast vote
// ---------------------------------------------------------------------------

export function useVote() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  return useMutation({
    mutationFn: async (params: {
      proposalId: bigint;
      support: VoteType;
      reason?: string;
    }): Promise<Hash> => {
      const fnName = params.reason ? "castVoteWithReason" : "castVote";
      const args = params.reason
        ? [params.proposalId, params.support, params.reason]
        : [params.proposalId, params.support];

      return writeContractAsync({
        address: GOVERNANCE_ADDRESS as Address,
        abi: GOVERNANCE_ABI,
        functionName: fnName as any,
        args: args as any,
      });
    },
    onSuccess: () => {
      toast.success("Vote cast successfully");
      queryClient.invalidateQueries({ queryKey: ["proposal"] });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
    },
    onError: (err: Error) => {
      toast.error("Vote failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Execute a passed proposal
// ---------------------------------------------------------------------------

export function useExecuteProposal() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  return useMutation({
    mutationFn: async (params: {
      targets: Address[];
      values: bigint[];
      calldatas: `0x${string}`[];
      descriptionHash: `0x${string}`;
    }): Promise<Hash> => {
      return writeContractAsync({
        address: GOVERNANCE_ADDRESS as Address,
        abi: GOVERNANCE_ABI,
        functionName: "execute",
        args: [
          params.targets,
          params.values,
          params.calldatas,
          params.descriptionHash,
        ],
      });
    },
    onSuccess: () => {
      toast.success("Proposal executed");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
    },
    onError: (err: Error) => {
      toast.error("Execution failed", { description: err.message });
    },
  });
}
