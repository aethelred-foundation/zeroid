/**
 * useSelectiveDisclosure — Hook for privacy-preserving attribute disclosure.
 *
 * Manages creating disclosure requests (verifier side), building disclosure
 * responses with ZK proofs (holder side), and viewing disclosure history.
 */

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import type {
  DisclosureRequest,
  DisclosureResponse,
  DisclosureHistoryEntry,
  DisclosureAttribute,
  DisclosurePolicy,
  VerificationRequest,
  ZKProof,
} from "@/types";

function requireIdentityAuthToken(): string {
  const token = getIdentityAuthToken();
  if (!token) {
    throw new Error("An authenticated ZeroID identity session is required.");
  }
  return token;
}

function attributeKeys(attributes: DisclosureAttribute[]): string[] {
  return attributes.map((attribute) => attribute.key).filter(Boolean);
}

function policyString(policy: DisclosurePolicy, key: string): string | undefined {
  const value = policy[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function credentialHashForDisclosure(
  attributes: DisclosureAttribute[],
  policy: DisclosurePolicy,
): string {
  const fromPolicy =
    policyString(policy, "credentialHash") ?? policyString(policy, "schemaHash");
  if (fromPolicy) return fromPolicy;

  const attributeHash = attributes.find(
    (attribute) => typeof attribute.hash === "string" && attribute.hash,
  )?.hash;
  if (attributeHash) return attributeHash;

  throw new Error(
    "Disclosure request requires a credentialHash, schemaHash, or hashed requested attribute.",
  );
}

function parseGeneratedProof(proofData: string): ZKProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(proofData);
  } catch {
    throw new Error("Disclosure response requires a generated ZK proof JSON payload.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { circuitId?: unknown }).circuitId !== "string" ||
    typeof (parsed as { proofHash?: unknown }).proofHash !== "string" ||
    !(parsed as { proof?: unknown }).proof
  ) {
    throw new Error("Disclosure response requires a complete generated ZK proof.");
  }

  return parsed as ZKProof;
}

function verificationToDisclosureRequest(
  request: VerificationRequest,
): DisclosureRequest {
  return {
    ...request,
    requestedAttributes: request.requestedAttributes.map(
      (key) => ({ key }) as DisclosureAttribute,
    ),
    policy: {
      purpose: request.purpose,
      expiresAt: request.expiresAt,
    },
  };
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
      void address;
      const request = await apiClient.createVerificationRequest(
        {
          subjectDid: params.subjectDid,
          credentialHash: credentialHashForDisclosure(
            params.requestedAttributes,
            params.policy,
          ),
          requestedAttributes: attributeKeys(params.requestedAttributes),
          circuitId: policyString(params.policy, "circuitId") ?? "selective_disclosure",
          expiresAt:
            Math.floor(Date.now() / 1000) + Number(params.expiresIn ?? 86_400),
          purpose: params.purpose,
          requiredAttributes: params.requestedAttributes,
        } as never,
        requireIdentityAuthToken(),
      );
      return { requestId: request.id, challenge: request.id };
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
      void address;
      const result = await apiClient.respondToVerification(
        params.requestId,
        {
          consent: true,
          proof: parseGeneratedProof(params.zkProof),
        },
        requireIdentityAuthToken(),
      );
      return {
        requestId: result.requestId,
        selectedAttributes: params.selectedAttributes,
        verification: result,
        credentialIds: params.credentialIds,
      };
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
    queryFn: async () => {
      const requests = await apiClient.get<VerificationRequest[]>(
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
      );
      return requests.map(verificationToDisclosureRequest);
    },
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
    queryFn: async () => {
      const requests = await apiClient.get<VerificationRequest[]>(
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
      );
      const request = requests.find((candidate) => candidate.id === requestId);
      if (!request) {
        throw new Error(`Disclosure request ${requestId} was not found.`);
      }
      return verificationToDisclosureRequest(request);
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
    queryFn: async () => {
      params.set("limit", String(pageSize));
      const items = await apiClient.get<DisclosureHistoryEntry[]>(
        `/api/v1/verification/history?${params.toString()}`,
      );
      return {
        items,
        total: items.length,
      };
    },
    enabled: !!address,
    staleTime: 30_000,
  });
}
