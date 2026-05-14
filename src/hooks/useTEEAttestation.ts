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
  VerifyAttestationParams,
} from "@/types";

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

function unsupportedTEEQuery(message: string): never {
  throw new Error(message);
}

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
    queryFn: async () => null as AttestationReport | null,
    enabled: false,
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
    queryFn: async () =>
      unsupportedTEEQuery(
        "TEE node discovery is not exposed by the backend API.",
      ),
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
    queryFn: async () =>
      unsupportedTEEQuery("TEE node health is not exposed by the backend API."),
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
    queryFn: async () =>
      unsupportedTEEQuery(
        "TEE network status is not exposed by the backend API.",
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
