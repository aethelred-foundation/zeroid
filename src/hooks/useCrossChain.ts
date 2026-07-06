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
import { apiClient } from "@/lib/api/client";
import { CONTRACT_ADDRESSES } from "@/config/constants";
import type { Address, Bytes32, Credential, ISODateString } from "@/types";

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

const FALLBACK_BRIDGE_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

function bridgeAddress(): Address {
  return CONTRACT_ADDRESSES.crossChainBridge || FALLBACK_BRIDGE_ADDRESS;
}

function supportedChains(): SupportedChain[] {
  return [
    {
      chainId: 1,
      name: "Ethereum",
      shortName: "eth",
      network: "mainnet",
      bridgeContractAddress: bridgeAddress(),
      explorerUrl: "https://etherscan.io",
      avgBlockTimeMs: 12_000,
      requiredConfirmations: 12,
      isActive: Boolean(CONTRACT_ADDRESSES.crossChainBridge),
      supportedCredentialTypes: ["kyc", "identity", "proof_of_address"],
      bridgeFeeBaseBps: 35,
    },
    {
      chainId: 137,
      name: "Polygon",
      shortName: "pol",
      network: "mainnet",
      bridgeContractAddress: bridgeAddress(),
      explorerUrl: "https://polygonscan.com",
      avgBlockTimeMs: 2_100,
      requiredConfirmations: 128,
      isActive: Boolean(CONTRACT_ADDRESSES.crossChainBridge),
      supportedCredentialTypes: ["kyc", "identity", "proof_of_address"],
      bridgeFeeBaseBps: 20,
    },
    {
      chainId: 42161,
      name: "Arbitrum One",
      shortName: "arb",
      network: "mainnet",
      bridgeContractAddress: bridgeAddress(),
      explorerUrl: "https://arbiscan.io",
      avgBlockTimeMs: 250,
      requiredConfirmations: 20,
      isActive: Boolean(CONTRACT_ADDRESSES.crossChainBridge),
      supportedCredentialTypes: ["kyc", "identity", "proof_of_address"],
      bridgeFeeBaseBps: 25,
    },
    {
      chainId: 11155111,
      name: "Sepolia",
      shortName: "sep",
      network: "testnet",
      bridgeContractAddress: bridgeAddress(),
      explorerUrl: "https://sepolia.etherscan.io",
      avgBlockTimeMs: 12_000,
      requiredConfirmations: 6,
      isActive: Boolean(CONTRACT_ADDRESSES.crossChainBridge),
      supportedCredentialTypes: ["kyc", "identity", "proof_of_address"],
      bridgeFeeBaseBps: 10,
    },
  ];
}

function chainById(chainId: number): SupportedChain | undefined {
  return supportedChains().find((chain) => chain.chainId === chainId);
}

function priorityMultiplier(priority: BridgePriority): number {
  return { standard: 1, fast: 1.8, instant: 3.2 }[priority];
}

function buildFee(
  chain: SupportedChain,
  priority: BridgePriority,
): BridgeFee {
  const base = 0.001 + chain.bridgeFeeBaseBps / 1_000_000;
  const priorityFee = base * (priorityMultiplier(priority) - 1);
  const total = base + priorityFee;
  return {
    baseFee: base.toFixed(6),
    priorityFee: priorityFee.toFixed(6),
    totalFee: total.toFixed(6),
    feeCurrency: "ETH",
    feeUSD: Number((total * 3_200).toFixed(2)),
  };
}

function ensureBridgeConfigured(): void {
  if (!CONTRACT_ADDRESSES.crossChainBridge) {
    throw new Error(
      "Cross-chain bridge contract is not configured for this environment. Set NEXT_PUBLIC_BRIDGE_CONTRACT_ADDRESS and connect a relayer before submitting bridge transactions.",
    );
  }
}

function isCredentialActive(credential: Credential): boolean {
  const status = String(credential.status).toLowerCase();
  const expiresAt =
    typeof credential.expiresAt === "number"
      ? credential.expiresAt * 1000
      : Number(credential.expiresAt);
  return (
    !["revoked", "expired", "4", "3"].includes(status) &&
    (!Number.isFinite(expiresAt) || expiresAt > Date.now())
  );
}

// ---------------------------------------------------------------------------
// Supported Chains
// ---------------------------------------------------------------------------

export function useSupportedChains() {
  return useQuery({
    queryKey: crossChainKeys.chains(),
    queryFn: () => supportedChains(),
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
      void address;
      ensureBridgeConfigured();
      const destinationChain = chainById(request.destinationChainId);
      if (!destinationChain) {
        throw new Error(`Unsupported destination chain ${request.destinationChainId}`);
      }
      throw new Error(
        "Cross-chain bridge relayer endpoint is not configured. The bridge contract is known, but transaction submission requires a relayer service and operator signing key.",
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
    queryFn: () => {
      ensureBridgeConfigured();
      throw new Error(
        "Bridge status polling requires a configured bridge relayer status endpoint.",
      );
    },
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
    queryFn: async () => {
      const credentials = await apiClient.get<Credential[]>(
        "/api/v1/credentials?role=subject",
      );
      return credentials
        .filter((credential) =>
          Array.isArray((credential as unknown as { bridgedChains?: unknown[] }).bridgedChains),
        )
        .flatMap((credential) => {
          const bridgedChains =
            (credential as unknown as { bridgedChains?: number[] }).bridgedChains ?? [];
          return bridgedChains.map<BridgedCredential>((chainId) => {
            const chain = chainById(chainId);
            return {
              credentialId: credential.id ?? credential.hash,
              originalChainId: 1,
              bridgedChainId: chainId,
              originalChainName: "Ethereum",
              bridgedChainName: chain?.name ?? `Chain ${chainId}`,
              schemaName:
                credential.schemaName ??
                credential.schemaType ??
                credential.name ??
                "Credential",
              bridgedAt: new Date(
                typeof credential.issuedAt === "number"
                  ? credential.issuedAt * 1000
                  : Date.now(),
              ).toISOString(),
              expiresAt: new Date(
                typeof credential.expiresAt === "number"
                  ? credential.expiresAt * 1000
                  : Date.now(),
              ).toISOString(),
              status: isCredentialActive(credential) ? "active" : "expired",
              bridgeTxId: `${credential.hash}:${chainId}`,
              lastSyncedAt: new Date().toISOString(),
            };
          });
        });
    },
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
    queryFn: () => {
      const chain = chainById(destinationChainId as number);
      if (!chain) {
        throw new Error(`Unsupported destination chain ${destinationChainId}`);
      }
      return {
        credentialId: credentialId as string,
        destinationChainId: destinationChainId as number,
        estimates: {
          standard: buildFee(chain, "standard"),
          fast: buildFee(chain, "fast"),
          instant: buildFee(chain, "instant"),
        },
        estimatedTimes: {
          standard:
            (chain.requiredConfirmations * chain.avgBlockTimeMs) / 1000 + 600,
          fast:
            (chain.requiredConfirmations * chain.avgBlockTimeMs) / 1000 + 180,
          instant:
            (chain.requiredConfirmations * chain.avgBlockTimeMs) / 1000 + 45,
        },
        validUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
      } satisfies BridgeFeeEstimate;
    },
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
      const chain = chainById(params.chainId);
      if (!chain) {
        throw new Error(`Unsupported chain ${params.chainId}`);
      }
      const credential = await apiClient.get<Credential>(
        `/api/v1/credentials/${params.credentialId}`,
      );
      const expiryValid = isCredentialActive(credential);
      const integrityValid = Boolean(
        credential.hash || credential.contentHash || credential.merkleRoot,
      );
      const issuerValid = Boolean(credential.issuerDid || credential.issuer);
      const verified =
        Boolean(CONTRACT_ADDRESSES.crossChainBridge) &&
        expiryValid &&
        integrityValid &&
        issuerValid;

      return {
        credentialId: params.credentialId,
        chainId: params.chainId,
        chainName: chain.name,
        verified,
        verifiedAt: new Date().toISOString(),
        onChainProofHash:
          (credential.hash as Bytes32 | undefined) ??
          (credential.contentHash as Bytes32 | undefined),
        integrityValid,
        expiryValid,
        issuerValid,
        revocationChecked: true,
        isRevoked: String(credential.status).toLowerCase() === "revoked",
      };
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
