/**
 * useVerification — Hook for verification request flows.
 *
 * Manages creating verification requests, responding to incoming requests,
 * selecting attributes for selective disclosure, and viewing history.
 */

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type {
  VerificationRequest,
  VerificationResponse,
  VerificationHistory,
  AttributeSelection,
  VerificationStatus,
  CreateVerificationParams,
} from "@/types";

// ---------------------------------------------------------------------------
// Create a verification request (as a verifier)
// ---------------------------------------------------------------------------

export function useCreateVerificationRequest() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: CreateVerificationParams) => {
      const response = await apiClient.post<{ requestId: string }>(
        "/v1/verification/request",
        {
          verifierAddress: address,
          subjectDid: params.subjectDid,
          requiredCredentials: params.requiredCredentials,
          requiredAttributes: params.requiredAttributes,
          purpose: params.purpose,
          expiresIn: params.expiresIn ?? 86400,
          callbackUrl: params.callbackUrl,
        },
      );
      return response;
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
    }) => {
      const response = await apiClient.post<VerificationResponse>(
        `/v1/verification/${params.requestId}/respond`,
        {
          holderAddress: address,
          selectedAttributes: params.selectedAttributes,
          zkProof: params.proofData,
        },
      );
      return response;
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

  return useQuery({
    queryKey: ["attributeSelection", requestId, address],
    queryFn: async () => {
      const request = await apiClient.get<VerificationRequest>(
        `/v1/verification/${requestId}`,
      );
      const requiredCredentials = request.requiredCredentials ?? [];
      const requiredAttributes =
        request.requiredAttributes ?? request.requestedAttributes ?? [];

      const userCredentials = await apiClient.get<AttributeSelection[]>(
        `/v1/credentials/${address}/attributes`,
        { schemaIds: requiredCredentials.join(",") },
      );

      return {
        request,
        availableAttributes: userCredentials,
        requiredAttributes,
      };
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
        `/v1/verification/pending/${address}`,
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
  if (status) params.set("status", status);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  return useQuery({
    queryKey: ["verificationHistory", address, status, page],
    queryFn: () =>
      apiClient.get<{ items: VerificationHistory[]; total: number }>(
        `/v1/verification/history/${address}?${params.toString()}`,
      ),
    enabled: !!address,
    staleTime: 15_000,
  });
}
