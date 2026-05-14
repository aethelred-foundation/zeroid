/**
 * useSelectiveDisclosure — Hook for privacy-preserving attribute disclosure.
 *
 * Manages creating disclosure requests (verifier side), building disclosure
 * responses with ZK proofs (holder side), and viewing disclosure history.
 */

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ZeroIDApiError } from "@/lib/api/client";
import type {
  DisclosureRequest,
  DisclosureResponse,
  DisclosureHistoryEntry,
  DisclosureAttribute,
  DisclosurePolicy,
} from "@/types";

function unsupportedDisclosureFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
}

// ---------------------------------------------------------------------------
// Create a disclosure request (verifier creates this)
// ---------------------------------------------------------------------------

export function useCreateDisclosureRequest() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      subjectDid: string;
      requestedAttributes: DisclosureAttribute[];
      policy: DisclosurePolicy;
      purpose: string;
      expiresIn?: number;
    }): Promise<{ requestId: string; challenge: string }> => {
      void params;
      void address;
      unsupportedDisclosureFlow(
        "Selective disclosure request creation is not exposed by the backend API. Use context-bound ZK proof generation and verification endpoints.",
        "DISCLOSURE_REQUEST_CREATE_UNAVAILABLE",
      );
    },
    onSuccess: (data) => {
      toast.success("Disclosure request created", {
        description: `Challenge issued: ${data.challenge.slice(0, 16)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["disclosureHistory"] });
    },
    onError: (err: Error) => {
      toast.error("Failed to create disclosure request", {
        description: err.message,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Build a disclosure response (holder selects attributes + generates proof)
// ---------------------------------------------------------------------------

export function useBuildDisclosureResponse() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      requestId: string;
      selectedAttributes: DisclosureAttribute[];
      credentialIds: string[];
      zkProof: string;
    }): Promise<DisclosureResponse> => {
      void params;
      void address;
      unsupportedDisclosureFlow(
        "Selective disclosure responses are not exposed by the backend API. Submit generated ZK proofs through /api/v1/verification/zk-verify.",
        "DISCLOSURE_RESPONSE_UNAVAILABLE",
      );
    },
    onSuccess: () => {
      toast.success("Disclosure response submitted", {
        description: "Selected attributes shared with verifier",
      });
      queryClient.invalidateQueries({ queryKey: ["disclosureHistory"] });
      queryClient.invalidateQueries({ queryKey: ["pendingDisclosures"] });
    },
    onError: (err: Error) => {
      toast.error("Disclosure response failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Pending disclosure requests for the connected user
// ---------------------------------------------------------------------------

export function usePendingDisclosures() {
  const { address } = useAccount();

  return useQuery<DisclosureRequest[]>({
    queryKey: ["pendingDisclosures", address],
    queryFn: () =>
      unsupportedDisclosureFlow(
        "Pending disclosure requests are not exposed by the backend API.",
        "DISCLOSURE_PENDING_UNAVAILABLE",
      ),
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Disclosure request detail
// ---------------------------------------------------------------------------

export function useDisclosureRequest(requestId: string | undefined) {
  return useQuery<DisclosureRequest>({
    queryKey: ["disclosureRequest", requestId],
    queryFn: () => {
      void requestId;
      unsupportedDisclosureFlow(
        "Disclosure request detail is not exposed by the backend API.",
        "DISCLOSURE_DETAIL_UNAVAILABLE",
      );
    },
    enabled: !!requestId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Disclosure history
// ---------------------------------------------------------------------------

export function useDisclosureHistory(page = 1, pageSize = 20) {
  const { address } = useAccount();
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  return useQuery<{ items: DisclosureHistoryEntry[]; total: number }>({
    queryKey: ["disclosureHistory", address, page],
    queryFn: () => {
      void params;
      void address;
      unsupportedDisclosureFlow(
        "Disclosure history is not exposed by the backend API.",
        "DISCLOSURE_HISTORY_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 30_000,
  });
}
