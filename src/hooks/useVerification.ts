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
import { getIdentityAuthToken } from "@/lib/identity/registration";
import type {
  VerificationRequest,
  VerificationResponse,
  VerificationHistory,
  AttributeSelection,
  VerificationStatus,
  CreateVerificationParams,
  ZKProof,
} from "@/types";

function toBackendVerificationResult(
  status?: VerificationStatus,
): string | undefined {
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

function requireIdentityAuthToken(): string {
  const token = getIdentityAuthToken();
  if (!token) {
    throw new Error("An authenticated ZeroID identity session is required.");
  }
  return token;
}

function attributeKeys(attributes: AttributeSelection[] | string[]): string[] {
  return attributes
    .map((attribute) =>
      typeof attribute === "string" ? attribute : attribute.key,
    )
    .filter(Boolean);
}

function normalizeAttributeSelection(
  attributes: VerificationRequest["requiredAttributes"] | string[] | undefined,
): AttributeSelection[] {
  return (attributes ?? []).map((attribute) =>
    typeof attribute === "string"
      ? { key: attribute }
      : { key: attribute.key, value: attribute.value },
  );
}

function parseGeneratedProof(proofData: string): ZKProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(proofData);
  } catch {
    throw new Error(
      "Verification response requires a generated ZK proof JSON payload.",
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { circuitId?: unknown }).circuitId !== "string" ||
    typeof (parsed as { proofHash?: unknown }).proofHash !== "string" ||
    !(parsed as { proof?: unknown }).proof
  ) {
    throw new Error(
      "Verification response requires a complete generated ZK proof.",
    );
  }

  return parsed as ZKProof;
}

function buildVerificationRequestPayload(params: CreateVerificationParams) {
  const requestedAttributes = attributeKeys(params.requestedAttributes);
  if (!params.subjectDid) {
    throw new Error("Verification request requires a subject DID.");
  }
  if (!requestedAttributes.length) {
    throw new Error("Verification request requires at least one attribute.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.credentialHash ?? "")) {
    throw new Error(
      "Verification request requires the holder credential's 32-byte credentialHash commitment.",
    );
  }

  return {
    verifierDid: params.verifierDid,
    subjectDid: params.subjectDid,
    credentialHash: params.credentialHash,
    requestedAttributes,
    circuitId: String(params.circuitId ?? "selective_disclosure"),
    expiresAt:
      Math.floor(Date.now() / 1000) +
      Number(params.expiresIn ?? params.ttlSeconds ?? 86_400),
    purpose: params.purpose ?? "Selective disclosure verification",
    requiredCredentials: params.requiredCredentials,
    requiredAttributes: params.requiredAttributes,
  };
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
      void address;
      const request = await apiClient.createVerificationRequest(
        buildVerificationRequestPayload(params) as never,
        requireIdentityAuthToken(),
      );
      return { requestId: request.id };
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
      void address;
      return apiClient.respondToVerification(
        params.requestId,
        {
          consent: true,
          proof: parseGeneratedProof(params.proofData),
        },
        requireIdentityAuthToken(),
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

export function useDeclineVerification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) =>
      apiClient.respondToVerification(
        requestId,
        { consent: false },
        requireIdentityAuthToken(),
      ),
    onSuccess: () => {
      toast.success("Verification request declined");
      queryClient.invalidateQueries({ queryKey: ["verificationHistory"] });
      queryClient.invalidateQueries({ queryKey: ["pendingVerifications"] });
    },
    onError: (err: Error) => {
      toast.error("Failed to decline verification request", {
        description: err.message,
      });
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
      const requests = await apiClient.get<VerificationRequest[]>(
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
      );
      const request = requests.find((candidate) => candidate.id === requestId);
      if (!request) {
        throw new Error(`Verification request ${requestId} was not found.`);
      }
      const availableAttributes = normalizeAttributeSelection(
        request.requiredAttributes ?? request.requestedAttributes,
      );
      return {
        request,
        availableAttributes,
        requiredAttributes: request.requiredAttributes,
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
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
      ),
    // Protected: needs an identity session (registration JWT); skip until then.
    enabled: !!address && !!getIdentityAuthToken(),
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
    // Protected: needs an identity session (registration JWT); skip until then.
    enabled: !!address && !!getIdentityAuthToken(),
    staleTime: 15_000,
  });
}
