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
  AttestationStatus,
  AttestationReport,
  TEENode,
  TEENodeHealth,
  VerifyAttestationParams,
} from "@/types";

// ---------------------------------------------------------------------------
// Attestation status (on-chain registry + API enrichment)
// ---------------------------------------------------------------------------

export function useAttestationStatus(enclaveId: string | undefined) {
  const { data: onChainStatus, isLoading: isOnChainLoading } = useReadContract({
    address: TEE_REGISTRY_ADDRESS as Address,
    abi: TEE_REGISTRY_ABI,
    functionName: "attestationStatus",
    args: enclaveId ? [enclaveId as `0x${string}`] : undefined,
    query: { enabled: !!enclaveId, refetchInterval: 60_000 },
  });

  const apiQuery = useQuery({
    queryKey: ["attestation", enclaveId],
    queryFn: () =>
      apiClient.get<AttestationReport>(`/v1/tee/attestation/${enclaveId}`),
    enabled: !!enclaveId,
    staleTime: 30_000,
  });

  const status = onChainStatus as AttestationStatus | undefined;

  return {
    ...apiQuery,
    onChainStatus: status,
    isOnChainLoading,
    isAttested: status === "verified",
    isExpired: status === "expired",
  };
}

// ---------------------------------------------------------------------------
// Verify an attestation report
// ---------------------------------------------------------------------------

export function useVerifyAttestation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: VerifyAttestationParams) => {
      // Server-side verification of the quote against Intel/AMD root of trust
      const result = await apiClient.post<{
        valid: boolean;
        enclaveId: string;
        mrEnclave: string;
        mrSigner: string;
        reportData: string;
      }>("/v1/tee/verify", {
        quote: params.quote,
        expectedMrEnclave: params.expectedMrEnclave,
        expectedMrSigner: params.expectedMrSigner,
        nonce: params.nonce,
      });

      return result;
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
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeOnly) params.set("active", "true");
      return apiClient.get<TEENode[]>(`/v1/tee/nodes?${params.toString()}`);
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
    queryFn: () =>
      apiClient.get<TEENodeHealth>(`/v1/tee/nodes/${nodeId}/health`),
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
    queryFn: () =>
      apiClient.get<{
        totalNodes: number;
        activeNodes: number;
        attestedNodes: number;
        avgUptime: number;
        lastRefresh: number;
      }>("/v1/tee/network/status"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
