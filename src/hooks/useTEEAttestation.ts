/**
 * useTEEAttestation — Hook for Trusted Execution Environment attestation.
 *
 * Provides queries for attestation status, TEE node discovery,
 * node health monitoring, and on-chain attestation verification.
 */

import { useReadContract } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { TEE_REGISTRY_ADDRESS, TEE_REGISTRY_ABI } from "@/config/constants";
import type {
  AttestationReport,
  Bytes32,
  TEENode,
  TEENodeHealth,
  VerifyAttestationParams,
} from "@/types";
import { getPlatformLabel, selectBestNode } from "@/lib/tee/attestation";
import { isExpired, isValidBytes32 } from "@/lib/utils";

type BackendAttestationResult = {
  verified?: boolean;
  valid?: boolean;
  attestationId?: string;
  enclaveId?: string;
  enclaveType?: string;
  tcbStatus?: string;
  advisoryIds?: string[];
  timestamp?: string | number;
  expiresAt?: string | number;
  mrEnclave?: string;
  mrSigner?: string;
  reportData?: string;
};

type BackendAttestationChallenge = {
  challenge: string;
  reportData?: string;
  expiresAt?: string | number;
};

type DerivedTEEHealth = "healthy" | "degraded" | "offline";
type DerivedTEEStatus = "active" | "degraded" | "offline";

export interface TEENetworkStatus {
  status: DerivedTEEHealth;
  totalNodes: number;
  onlineNodes: number;
  healthyNodes: number;
  degradedNodes: number;
  offlineNodes: number;
  averageUptime: number;
  averageLatencyMs: number;
  totalVerificationsProcessed: number;
  regions: string[];
  bestNode: TEENode | null;
  updatedAt: string;
}

function statusFromNode(node: TEENode): DerivedTEEStatus {
  if (!node.isOnline) return "offline";
  if (!node.attestation.isValid || isExpired(node.attestation.expiresAt)) {
    return "degraded";
  }
  if (node.uptimePercent < 95 || node.avgLatencyMs > 5_000) {
    return "degraded";
  }
  return "active";
}

function healthFromStatus(status: DerivedTEEStatus): DerivedTEEHealth {
  if (status === "active") return "healthy";
  if (status === "offline") return "offline";
  return "degraded";
}

function nodeToHealth(node: TEENode): TEENodeHealth {
  const status = statusFromNode(node);
  const health = healthFromStatus(status);

  return {
    id: node.id,
    type: getPlatformLabel(node.platform),
    status,
    health,
    uptime: node.uptimePercent,
    region: node.region,
    name: node.name,
    lastSeen: new Date().toISOString(),
    latencyMs: node.avgLatencyMs,
    verificationsProcessed: node.verificationsProcessed,
    enclaveHash: node.attestation.enclaveHash,
    attestationValid: node.attestation.isValid,
    attestationExpiresAt: node.attestation.expiresAt,
  };
}

function summarizeNetwork(nodes: TEENode[]): TEENetworkStatus {
  const health = nodes.map((node) => healthFromStatus(statusFromNode(node)));
  const totalNodes = nodes.length;
  const healthyNodes = health.filter((state) => state === "healthy").length;
  const degradedNodes = health.filter((state) => state === "degraded").length;
  const offlineNodes = health.filter((state) => state === "offline").length;
  const onlineNodes = nodes.filter((node) => node.isOnline).length;
  const average = (values: number[]) =>
    values.length
      ? Math.round(
          (values.reduce((sum, value) => sum + value, 0) / values.length) *
            100,
        ) / 100
      : 0;

  return {
    status:
      healthyNodes === totalNodes && totalNodes > 0
        ? "healthy"
        : onlineNodes > 0
          ? "degraded"
          : "offline",
    totalNodes,
    onlineNodes,
    healthyNodes,
    degradedNodes,
    offlineNodes,
    averageUptime: average(nodes.map((node) => node.uptimePercent)),
    averageLatencyMs: average(nodes.map((node) => node.avgLatencyMs)),
    totalVerificationsProcessed: nodes.reduce(
      (sum, node) => sum + node.verificationsProcessed,
      0,
    ),
    regions: Array.from(new Set(nodes.map((node) => node.region))).sort(),
    bestNode: selectBestNode(nodes),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Attestation status (on-chain registry + API enrichment)
// ---------------------------------------------------------------------------

export function useAttestationStatus(enclaveId: string | undefined) {
  const hasValidEnclaveId = Boolean(enclaveId && isValidBytes32(enclaveId));
  const { data: onChainStatus, isLoading: isOnChainLoading } = useReadContract({
    address: TEE_REGISTRY_ADDRESS as Address,
    abi: TEE_REGISTRY_ABI,
    functionName: "isAttestationValid",
    args: hasValidEnclaveId ? [enclaveId as Bytes32] : undefined,
    query: { enabled: hasValidEnclaveId, refetchInterval: 60_000 },
  });

  const apiQuery = useQuery({
    queryKey: ["attestation", enclaveId],
    queryFn: async () =>
      apiClient.getAttestation(enclaveId as Bytes32) as Promise<AttestationReport>,
    enabled: hasValidEnclaveId,
    staleTime: 30_000,
  });

  const isValidOnChain = onChainStatus as boolean | undefined;
  const apiAttestation = apiQuery.data;
  const apiExpired = apiAttestation
    ? isExpired(apiAttestation.expiresAt)
    : false;

  return {
    ...apiQuery,
    onChainStatus: isValidOnChain,
    isOnChainLoading,
    isAttested: isValidOnChain === true || Boolean(apiAttestation?.isValid),
    isExpired: apiExpired,
  };
}

// ---------------------------------------------------------------------------
// Verify an attestation report
// ---------------------------------------------------------------------------

export function useVerifyAttestation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: VerifyAttestationParams) => {
      const challenge = await apiClient.post<BackendAttestationChallenge>(
        "/api/v1/verification/tee-challenge",
        {},
      );
      if (!challenge.challenge) {
        throw new Error("TEE attestation challenge response was malformed.");
      }

      const result = await apiClient.post<BackendAttestationResult>(
        "/api/v1/verification/tee-attest",
        {
          enclaveType: "SGX",
          quote: params.quote,
          challenge: challenge.challenge,
          userData: JSON.stringify({
            expectedMrEnclave: params.expectedMrEnclave,
            expectedMrSigner: params.expectedMrSigner,
            expectedReportData: challenge.reportData,
          }),
        },
      );

      return {
        valid: result.verified ?? result.valid ?? false,
        enclaveId: result.attestationId ?? result.enclaveId ?? "",
        mrEnclave: result.mrEnclave ?? "",
        mrSigner: result.mrSigner ?? "",
        reportData: result.reportData ?? "",
        raw: result,
      };
    },
    onSuccess: (data) => {
      if (data.valid) {
        toast.success("Attestation verified", {
          description: `Enclave ${data.enclaveId.slice(0, 16)}... is trusted`,
        });
      } else {
        toast.error("Attestation verification failed", {
          description:
            "The enclave could not be verified against root of trust",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["attestation"] });
    },
    onError: (err: Error) => {
      toast.error("Attestation verification error", {
        description: err.message,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// List available TEE nodes
// ---------------------------------------------------------------------------

export function useTEENodes(activeOnly = true) {
  return useQuery({
    queryKey: ["teeNodes", activeOnly],
    queryFn: async () => {
      const nodes = await apiClient.listTEENodes();
      if (!activeOnly) return nodes;
      return nodes.filter(
        (node) =>
          node.isOnline &&
          node.attestation.isValid &&
          !isExpired(node.attestation.expiresAt),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Node health (individual node monitoring)
// ---------------------------------------------------------------------------

export function useNodeHealth(nodeId: string | undefined) {
  return useQuery({
    queryKey: ["teeNodeHealth", nodeId],
    queryFn: async () => {
      const nodes = await apiClient.listTEENodes();
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        throw new Error(`TEE node ${nodeId} was not found in discovery.`);
      }
      return nodeToHealth(node);
    },
    enabled: !!nodeId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Aggregate TEE network status
// ---------------------------------------------------------------------------

export function useTEENetworkStatus() {
  return useQuery({
    queryKey: ["teeNetworkStatus"],
    queryFn: async () => summarizeNetwork(await apiClient.listTEENodes()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
