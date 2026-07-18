/**
 * useCredentials — Hook for verifiable credential management.
 *
 * Handles listing, inspecting, validating, and issuer-controlled revocation
 * of credentials. Issuance is intentionally not exposed as a holder action:
 * the backend POST endpoint is an issuer-authorized issuance operation.
 */

import { useAccount } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import {
  normalizeCredentialSummaries,
  normalizeCredentialSummary,
  type CredentialSummaryStatus,
} from "@/lib/credentials/summary";
import type { CredentialStatus } from "@/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CredentialQueryRole = "issuer" | "subject";
export type CredentialAccessState =
  | "wallet-required"
  | "sign-in-required"
  | "ready";

function toBackendStatus(
  status?: CredentialStatus | CredentialSummaryStatus,
): string | undefined {
  if (status === undefined) return undefined;

  const statusKey = String(status).toLowerCase();
  const mapped: Record<string, string> = {
    "1": "ACTIVE",
    "2": "SUSPENDED",
    "3": "REVOKED",
    "4": "EXPIRED",
    active: "ACTIVE",
    verified: "ACTIVE",
    suspended: "SUSPENDED",
    revoked: "REVOKED",
    expired: "EXPIRED",
  };

  return mapped[statusKey];
}

function normalizeValidationResult(value: unknown): { valid: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Credential validation response must be an object");
  }
  const valid = (value as Record<string, unknown>).valid;
  if (typeof valid !== "boolean") {
    throw new Error(
      'Credential validation response field "valid" must be a boolean',
    );
  }
  return { valid };
}

// ---------------------------------------------------------------------------
// List credentials for the connected wallet
// ---------------------------------------------------------------------------

export function useCredentials(
  status?: CredentialStatus | CredentialSummaryStatus,
  role: CredentialQueryRole = "subject",
) {
  const { address } = useAccount();
  const identityToken = getIdentityAuthToken();
  const accessState: CredentialAccessState = !address
    ? "wallet-required"
    : !identityToken
      ? "sign-in-required"
      : "ready";

  const params = new URLSearchParams();
  const backendStatus = toBackendStatus(status);
  if (backendStatus) params.set("status", backendStatus);
  params.set("role", role);
  // This hook exposes the returned collection, not a server-side lifetime
  // total. Request the endpoint maximum so consumers can label one bounded
  // page accurately instead of presenting the backend default page as total.
  params.set("page", "1");
  params.set("limit", "100");

  const query = useQuery({
    queryKey: ["credentials", address, status, role],
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `/api/v1/credentials?${params.toString()}`,
      );
      const credentials = normalizeCredentialSummaries(response);
      return {
        credentials,
        total: credentials.length,
      };
    },
    // Protected endpoint: only fetch once the wallet has an identity session
    // (a registration JWT). Firing before onboarding just 401s. Registration
    // stores the token and re-renders, which re-enables this query.
    enabled: accessState === "ready",
    staleTime: 15_000,
    refetchInterval: process.env.NODE_ENV === "test" ? false : 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: async (credentialId: string) => {
      if (!UUID_PATTERN.test(credentialId)) {
        throw new Error(
          "Credential validation requires a ZeroID credential UUID",
        );
      }
      return normalizeValidationResult(
        await apiClient.post<unknown>(
          `/api/v1/credentials/${credentialId}/verify`,
          {},
        ),
      );
    },
    onSuccess: ({ valid }) => {
      if (valid) {
        toast.success("Credential validation passed");
      } else {
        toast.error("Credential validation failed", {
          description: "One or more authenticated backend checks did not pass",
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Credential verification failed", {
        description: err.message,
      });
    },
  });

  return {
    ...query,
    credentials: query.data?.credentials ?? [],
    total: query.data?.total ?? 0,
    accessState,
    verifyCredential: async (credentialId: string) =>
      verifyMutation.mutateAsync(credentialId),
  };
}

// ---------------------------------------------------------------------------
// Get a single credential record from the authoritative backend
// ---------------------------------------------------------------------------

export function useCredentialDetails(credentialId: string | undefined) {
  const apiQuery = useQuery({
    queryKey: ["credential", credentialId],
    queryFn: async () =>
      normalizeCredentialSummary(
        await apiClient.get<unknown>(`/api/v1/credentials/${credentialId}`),
      ),
    enabled:
      !!credentialId &&
      UUID_PATTERN.test(credentialId) &&
      !!getIdentityAuthToken(),
    staleTime: 20_000,
  });

  return {
    ...apiQuery,
    registryAnchor: {
      available: false as const,
      reason:
        "The credential API does not supply a deployed-registry bytes32 identifier; no on-chain integrity claim can be made.",
    },
  };
}

// ---------------------------------------------------------------------------
// Revoke a credential in the ZeroID registry (issuer only)
// ---------------------------------------------------------------------------

export interface RevokeCredentialInput {
  credentialId: string;
  reason: string;
}

export function useRevokeCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ credentialId, reason }: RevokeCredentialInput) => {
      if (!UUID_PATTERN.test(credentialId)) {
        throw new Error(
          "Credential revocation requires a ZeroID credential UUID",
        );
      }
      const normalizedReason = reason.trim();
      if (normalizedReason.length < 5 || normalizedReason.length > 500) {
        throw new Error(
          "Revocation reason must be between 5 and 500 characters",
        );
      }

      const response = await apiClient.post<unknown>(
        `/api/v1/credentials/${credentialId}/revoke`,
        { reason: normalizedReason },
      );
      return normalizeCredentialSummary(response);
    },
    onSuccess: () => {
      toast.success("Credential revoked in the ZeroID registry");
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
      queryClient.invalidateQueries({ queryKey: ["credential"] });
    },
    onError: (err: Error) => {
      toast.error("Revocation failed", { description: err.message });
    },
  });
}
