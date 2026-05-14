/**
 * useVerification — Hook for verification request flows.
 *
 * Manages creating verification requests, responding to incoming requests,
 * selecting attributes for selective disclosure, and viewing history.
 */

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, ZeroIDApiError } from "@/lib/api/client";
import type {
  VerificationRequest,
  VerificationResponse,
  VerificationHistory,
  AttributeSelection,
  VerificationStatus,
  CreateVerificationParams,
} from "@/types";

function toBackendVerificationResult(status?: VerificationStatus): string | undefined {
  if (!status) return undefined;

  const mapped: Record<string, string> = {
    pending: "PENDING",
    completed: "VERIFIED",
    verified: "VERIFIED",
    failed: "FAILED",
    expired: "EXPIRED",
  };

  return mapped[String(status).toLowerCase()] ?? String(status).toUpperCase();
}

function unsupportedVerificationRequestFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
}

// ---------------------------------------------------------------------------
// Create a verification request (as a verifier)
// ---------------------------------------------------------------------------

export function useCreateVerificationRequest() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (
      params: CreateVerificationParams,
    ): Promise<{ requestId: string }> => {
      void params;
      void address;
      unsupportedVerificationRequestFlow(
        "Verifier-created request inboxes are not exposed by the backend API. Use context-bound ZK proof generation and /api/v1/verification/zk-verify instead.",
        "VERIFICATION_REQUEST_CREATE_UNAVAILABLE",
      );
    },
    onSuccess: (data) => {
      toast.success("Verification request created", {
        description: `Request ID: ${data.requestId.slice(0, 12)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["verificationHistory"] });
    },
    onError: (err: Error) => {
      toast.error("Failed to create verification request", {
        description: err.message,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Respond to a verification request (as a holder)
// ---------------------------------------------------------------------------

export function useRespondToVerification() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      requestId: string;
      selectedAttributes: AttributeSelection[];
      proofData: string;
    }): Promise<VerificationResponse> => {
      void params;
      void address;
      unsupportedVerificationRequestFlow(
        "Verification request responses are not exposed by the backend API. Submit context-bound proofs through /api/v1/verification/zk-verify.",
        "VERIFICATION_REQUEST_RESPONSE_UNAVAILABLE",
      );
    },
    onSuccess: () => {
      toast.success("Verification response submitted");
      queryClient.invalidateQueries({ queryKey: ["verificationHistory"] });
      queryClient.invalidateQueries({ queryKey: ["pendingVerifications"] });
    },
    onError: (err: Error) => {
      toast.error("Verification response failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Select attributes for disclosure (helper for building responses)
// ---------------------------------------------------------------------------

export function useSelectAttributes(requestId: string | undefined) {
  const { address } = useAccount();

  return useQuery<{
    request: VerificationRequest;
    availableAttributes: AttributeSelection[];
    requiredAttributes: VerificationRequest["requiredAttributes"];
  }>({
    queryKey: ["attributeSelection", requestId, address],
    queryFn: async () => {
      void requestId;
      void address;
      unsupportedVerificationRequestFlow(
        "Verification request detail and credential attribute selection endpoints are not exposed by the backend API.",
        "VERIFICATION_REQUEST_DETAIL_UNAVAILABLE",
      );
    },
    enabled: !!requestId && !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Pending verification requests for the connected user
// ---------------------------------------------------------------------------

export function usePendingVerifications() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["pendingVerifications", address],
    queryFn: () =>
      apiClient.get<VerificationRequest[]>(
        "/api/v1/verification/history?result=PENDING&limit=100",
      ),
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Verification history
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need a simple { verificationHistory } shape
// ---------------------------------------------------------------------------

export function useVerification() {
  const history = useVerificationHistory();
  const pending = usePendingVerifications();
  const respond = useRespondToVerification();

  return {
    verificationHistory: history.data?.items ?? [],
    pendingRequests: pending.data ?? [],
    total: history.data?.total ?? 0,
    isLoading: history.isLoading || pending.isLoading,
    isVerifying: respond.isPending,
    submitProof: async (params: {
      proof: unknown;
      requestId: string;
      disclosedAttributes: AttributeSelection[];
    }) =>
      respond.mutateAsync({
        requestId: params.requestId,
        selectedAttributes: params.disclosedAttributes,
        proofData: JSON.stringify(params.proof),
      }),
  };
}

export function useVerificationHistory(
  status?: VerificationStatus,
  page = 1,
  pageSize = 20,
) {
  const { address } = useAccount();
  const params = new URLSearchParams();
  const backendResult = toBackendVerificationResult(status);
  if (backendResult) params.set("result", backendResult);
  params.set("page", String(page));
  params.set("limit", String(pageSize));

  return useQuery({
    queryKey: ["verificationHistory", address, status, page],
    queryFn: async () => {
      const items = await apiClient.get<VerificationHistory[]>(
        `/api/v1/verification/history?${params.toString()}`,
      );
      return {
        items,
        total: items.length,
      };
    },
    enabled: !!address,
    staleTime: 15_000,
  });
}
