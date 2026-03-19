/**
 * useCrossChain — Hook for cross-chain identity and credential bridging.
 *
 * Manages bridging credentials between supported chains, tracking bridge
 * progress, fee estimation, and cross-chain credential verification.
 * Uses a combination of on-chain reads (wagmi) and API calls.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { type Address as ViemAddress, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { CONTRACT_ADDRESSES } from "@/config/constants";
import type { Address, Bytes32, ISODateString, UnixTimestamp } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupportedChain {
  chainId: number;
  name: string;
  shortName: string;
  network: "mainnet" | "testnet";
  bridgeContractAddress: Address;
  explorerUrl: string;
  avgBlockTimeMs: number;
  requiredConfirmations: number;
  isActive: boolean;
  supportedCredentialTypes: string[];
  bridgeFeeBaseBps: number;
}

export interface BridgeRequest {
  credentialId: string;
  destinationChainId: number;
  recipientAddress?: Address;
  priority: BridgePriority;
  preservePrivacy: boolean;
}

export type BridgePriority = "standard" | "fast" | "instant";

export interface BridgeTransaction {
  id: string;
  credentialId: string;
  credentialSchemaName: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceChainName: string;
  destinationChainName: string;
  status: BridgeStatus;
  priority: BridgePriority;
  sourceTxHash?: string;
  destinationTxHash?: string;
  initiatedAt: ISODateString;
  confirmedAt?: ISODateString;
  completedAt?: ISODateString;
  failedAt?: ISODateString;
  failureReason?: string;
  estimatedCompletionAt: ISODateString;
  fee: BridgeFee;
  relayerAddress?: Address;
  sourceConfirmations: number;
  requiredConfirmations: number;
}

export type BridgeStatus =
  | "pending"
  | "source_confirmed"
  | "relaying"
  | "destination_pending"
  | "completed"
  | "failed"
  | "refunded";

export interface BridgeFee {
  baseFee: string;
  priorityFee: string;
  totalFee: string;
  feeCurrency: string;
  feeUSD: number;
}

export interface BridgeFeeEstimate {
  credentialId: string;
  destinationChainId: number;
  estimates: {
    standard: BridgeFee;
    fast: BridgeFee;
    instant: BridgeFee;
  };
  estimatedTimes: {
    standard: number;
    fast: number;
    instant: number;
  };
  validUntil: ISODateString;
}

export interface BridgedCredential {
  credentialId: string;
  originalChainId: number;
  bridgedChainId: number;
  originalChainName: string;
  bridgedChainName: string;
  schemaName: string;
  bridgedAt: ISODateString;
  expiresAt: ISODateString;
  status: "active" | "expired" | "revoked" | "pending_sync";
  bridgeTxId: string;
  lastSyncedAt: ISODateString;
}

export interface CrossChainVerification {
  credentialId: string;
  chainId: number;
  chainName: string;
  verified: boolean;
  verifiedAt: ISODateString;
  onChainProofHash?: Bytes32;
  integrityValid: boolean;
  expiryValid: boolean;
  issuerValid: boolean;
  revocationChecked: boolean;
  isRevoked: boolean;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const crossChainKeys = {
  all: ["cross-chain"] as const,
  chains: () => [...crossChainKeys.all, "chains"] as const,
  bridge: (id: string) => [...crossChainKeys.all, "bridge", id] as const,
  bridged: () => [...crossChainKeys.all, "bridged"] as const,
  fee: (credId: string, chainId: number) =>
    [...crossChainKeys.all, "fee", credId, chainId] as const,
};

// ---------------------------------------------------------------------------
// Supported Chains
// ---------------------------------------------------------------------------

export function useSupportedChains() {
  return useQuery({
    queryKey: crossChainKeys.chains(),
    queryFn: () =>
      apiClient.get<SupportedChain[]>(
        "/api/v1/bridge/chains",
      ) as unknown as SupportedChain[],
    staleTime: 600_000,
  });
}

// ---------------------------------------------------------------------------
// Bridge Credential
// ---------------------------------------------------------------------------

export function useBridgeCredential() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  return useMutation({
    mutationFn: async (request: BridgeRequest): Promise<BridgeTransaction> => {
      // 1. Initiate bridge on source chain
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.credentialRegistry as ViemAddress,
        abi: BRIDGE_ABI,
        functionName: "inititateBridge",
        args: [
          request.credentialId as `0x${string}`,
          BigInt(request.destinationChainId),
          (request.recipientAddress ?? address) as `0x${string}`,
          request.preservePrivacy,
        ],
      });

      // 2. Register bridge with API for relay tracking
      const bridgeTx = await apiClient.post<BridgeTransaction>(
        "/api/v1/bridge/initiate",
        {
          credentialId: request.credentialId,
          destinationChainId: request.destinationChainId,
          sourceTxHash: txHash,
          senderAddress: address,
          recipientAddress: request.recipientAddress ?? address,
          priority: request.priority,
          preservePrivacy: request.preservePrivacy,
        },
      );

      return bridgeTx as unknown as BridgeTransaction;
    },
    onSuccess: (data) => {
      toast.success("Bridge initiated", {
        description: `Bridging to ${data.destinationChainName} — est. completion: ${new Date(data.estimatedCompletionAt).toLocaleTimeString()}`,
      });
      queryClient.invalidateQueries({ queryKey: crossChainKeys.bridged() });
    },
    onError: (err: Error) => {
      toast.error("Bridge initiation failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Bridge Status
// ---------------------------------------------------------------------------

export function useBridgeStatus(bridgeId: string | undefined) {
  return useQuery({
    queryKey: crossChainKeys.bridge(bridgeId ?? ""),
    queryFn: () =>
      apiClient.get<BridgeTransaction>(
        `/api/v1/bridge/status/${bridgeId}`,
      ) as unknown as BridgeTransaction,
    enabled: !!bridgeId,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data as BridgeTransaction | undefined;
      if (!data) return 10_000;
      if (
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "refunded"
      ) {
        return false;
      }
      return 10_000;
    },
  });
}

// ---------------------------------------------------------------------------
// Bridged Credentials
// ---------------------------------------------------------------------------

export function useBridgedCredentials() {
  const { address } = useAccount();

  return useQuery({
    queryKey: crossChainKeys.bridged(),
    queryFn: () =>
      apiClient.get<BridgedCredential[]>("/api/v1/bridge/credentials", {
        owner: address as string,
      }) as unknown as BridgedCredential[],
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Fee Estimation
// ---------------------------------------------------------------------------

export function useBridgeFeeEstimate(
  credentialId: string | undefined,
  destinationChainId: number | undefined,
) {
  return useQuery({
    queryKey: crossChainKeys.fee(credentialId ?? "", destinationChainId ?? 0),
    queryFn: () =>
      apiClient.get<BridgeFeeEstimate>(`/api/v1/bridge/estimate`, {
        credentialId: credentialId!,
        destinationChainId: destinationChainId!,
      }) as unknown as BridgeFeeEstimate,
    enabled: !!credentialId && !!destinationChainId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Cross-Chain Verification
// ---------------------------------------------------------------------------

export function useVerifyBridgedCredential() {
  return useMutation({
    mutationFn: async (params: {
      credentialId: string;
      chainId: number;
    }): Promise<CrossChainVerification> => {
      return apiClient.post<CrossChainVerification>(
        "/api/v1/bridge/verify",
        params,
      ) as unknown as CrossChainVerification;
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success("Credential verified on destination chain", {
          description: `Verified on ${data.chainName} — integrity: valid, issuer: valid`,
        });
      } else {
        toast.error("Credential verification failed", {
          description: `Chain: ${data.chainName} — check integrity and issuer status`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Cross-chain verification failed", {
        description: err.message,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Minimal Bridge ABI
// ---------------------------------------------------------------------------

const BRIDGE_ABI = [
  {
    name: "inititateBridge",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "credentialId", type: "bytes32" },
      { name: "destinationChainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "preservePrivacy", type: "bool" },
    ],
    outputs: [{ name: "bridgeNonce", type: "uint256" }],
  },
  {
    name: "getBridgeStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "bridgeNonce", type: "uint256" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "destinationChainId", type: "uint256" },
      { name: "timestamp", type: "uint256" },
    ],
  },
] as const;
