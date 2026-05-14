/**
 * useCrossChain — Hook for cross-chain identity and credential bridging.
 *
 * Manages bridging credentials between supported chains, tracking bridge
 * progress, fee estimation, and cross-chain credential verification.
 * Uses a combination of on-chain reads (wagmi) and API calls.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ZeroIDApiError } from "@/lib/api/client";
import type { Address, Bytes32, ISODateString } from "@/types";

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

function unsupportedBridgeFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
}

// ---------------------------------------------------------------------------
// Supported Chains
// ---------------------------------------------------------------------------

export function useSupportedChains() {
  return useQuery({
    queryKey: crossChainKeys.chains(),
    queryFn: () =>
      unsupportedBridgeFlow(
        "Cross-chain bridge discovery is not exposed by the backend API.",
        "BRIDGE_CHAIN_DISCOVERY_UNAVAILABLE",
      ),
    staleTime: 600_000,
  });
}

// ---------------------------------------------------------------------------
// Bridge Credential
// ---------------------------------------------------------------------------

export function useBridgeCredential() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (request: BridgeRequest): Promise<BridgeTransaction> => {
      void request;
      void address;
      unsupportedBridgeFlow(
        "Cross-chain bridging is not exposed by the backend API; no bridge transaction was submitted.",
        "BRIDGE_INITIATE_UNAVAILABLE",
      );
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
      unsupportedBridgeFlow(
        "Cross-chain bridge status is not exposed by the backend API.",
        "BRIDGE_STATUS_UNAVAILABLE",
      ),
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
      unsupportedBridgeFlow(
        "Bridged credential inventory is not exposed by the backend API.",
        "BRIDGE_CREDENTIALS_UNAVAILABLE",
      ),
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
      unsupportedBridgeFlow(
        "Cross-chain bridge fee estimation is not exposed by the backend API.",
        "BRIDGE_FEE_ESTIMATE_UNAVAILABLE",
      ),
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
      void params;
      unsupportedBridgeFlow(
        "Cross-chain credential verification is not exposed by the backend API.",
        "BRIDGE_VERIFY_UNAVAILABLE",
      );
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
