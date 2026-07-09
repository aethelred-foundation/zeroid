/**
 * useCredentials — Hook for verifiable credential management.
 *
 * Handles requesting, listing, inspecting, and revoking credentials.
 * Credential status transitions: pending -> verified -> (expired | revoked).
 */

import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { createDID } from "@/lib/utils";
import {
  CREDENTIAL_REGISTRY_ADDRESS,
  CREDENTIAL_REGISTRY_ABI,
} from "@/config/constants";
import type {
  Credential,
  CredentialStatus,
  CredentialRequest,
  CredentialDetails,
} from "@/types";

type LegacyCredentialRequest = Partial<CredentialRequest> & {
  schemaType?: string;
  documents?: unknown[];
  subjectDid?: string;
  credentialType?: string;
  organizationId?: string;
  expiresAt?: string | Date;
  issuerProof?: unknown;
};

const BACKEND_CREDENTIAL_TYPES = new Set([
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVERS_LICENSE",
  "PROOF_OF_ADDRESS",
  "KYC_LEVEL_1",
  "KYC_LEVEL_2",
  "KYC_LEVEL_3",
  "ACCREDITED_INVESTOR",
  "PROFESSIONAL_LICENSE",
  "EDUCATION",
  "EMPLOYMENT",
  "CUSTOM",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toBackendStatus(status?: CredentialStatus): string | undefined {
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

  return mapped[statusKey] ?? String(status).toUpperCase();
}

function toSubjectDid(address: string): string {
  const network = (process.env.NEXT_PUBLIC_CHAIN_ENV || "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet";
  return createDID(address.toLowerCase(), network).uri;
}

function toCredentialType(value?: string): string {
  const normalized = value?.trim().toUpperCase().replace(/[-\s]/g, "_");
  return normalized && BACKEND_CREDENTIAL_TYPES.has(normalized)
    ? normalized
    : "CUSTOM";
}

// ---------------------------------------------------------------------------
// List credentials for the connected wallet
// ---------------------------------------------------------------------------

export function useCredentials(status?: CredentialStatus) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const requestMutation = useRequestCredential();
  const revokeMutation = useRevokeCredential();

  const params = new URLSearchParams();
  const backendStatus = toBackendStatus(status);
  if (backendStatus) params.set("status", backendStatus);
  params.set("role", "subject");

  const query = useQuery({
    queryKey: ["credentials", address, status],
    queryFn: async () => {
      const credentials = await apiClient.get<Credential[]>(
        `/api/v1/credentials?${params.toString()}`,
      );
      return {
        credentials,
        total: credentials.length,
      };
    },
    // Protected endpoint: only fetch once the wallet has an identity session
    // (a registration JWT). Firing before onboarding just 401s. Registration
    // stores the token and re-renders, which re-enables this query.
    enabled: !!address && !!getIdentityAuthToken(),
    staleTime: 15_000,
    refetchInterval: process.env.NODE_ENV === "test" ? false : 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: async (credentialId: string) =>
      apiClient.post(`/api/v1/credentials/${credentialId}/verify`, {}),
    onSuccess: () => {
      toast.success("Credential verified");
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
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
    requestCredential: async (request: LegacyCredentialRequest) =>
      requestMutation.mutateAsync({
        issuerDid: request.issuerDid ?? "did:aethelred:issuer:default",
        schemaId: request.schemaId ?? request.schemaType ?? "identity",
        claims: request.claims ?? { documents: request.documents ?? [] },
        proofOfEligibility: request.proofOfEligibility,
        subjectDid: request.subjectDid,
        credentialType: request.credentialType,
        organizationId: request.organizationId,
        expiresAt: request.expiresAt,
        issuerProof: request.issuerProof,
      } as CredentialRequest),
    revokeCredential: async (credentialId: string) =>
      revokeMutation.mutateAsync(credentialId),
    verifyCredential: async (credentialId: string) =>
      verifyMutation.mutateAsync(credentialId),
  };
}

// ---------------------------------------------------------------------------
// Get single credential detail (off-chain + on-chain hash check)
// ---------------------------------------------------------------------------

export function useCredentialDetails(credentialId: string | undefined) {
  const { data: onChainCredential, isLoading: isHashLoading } = useReadContract(
    {
      address: CREDENTIAL_REGISTRY_ADDRESS as Address,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "getCredential",
      args: credentialId ? [credentialId as `0x${string}`] : undefined,
      query: { enabled: !!credentialId },
    },
  );

  const apiQuery = useQuery({
    queryKey: ["credential", credentialId],
    queryFn: () =>
      apiClient.get<CredentialDetails>(`/api/v1/credentials/${credentialId}`),
    enabled: !!credentialId,
    staleTime: 20_000,
  });

  return {
    ...apiQuery,
    onChainHash: onChainCredential as unknown,
    isHashLoading,
    isIntegrityValid: (() => {
      if (!apiQuery.data || !onChainCredential) return undefined;
      if (typeof onChainCredential === "string") {
        return apiQuery.data.contentHash === onChainCredential;
      }
      return (
        apiQuery.data.schemaHash ===
        (onChainCredential as { schemaHash?: string }).schemaHash
      );
    })(),
  };
}

// ---------------------------------------------------------------------------
// Request a new credential from an issuer
// ---------------------------------------------------------------------------

export function useRequestCredential() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (request: CredentialRequest) => {
      const legacyRequest = request as LegacyCredentialRequest;
      const subjectDid =
        legacyRequest.subjectDid ?? (address ? toSubjectDid(address) : null);
      if (!subjectDid) {
        throw new Error(
          "Wallet must be connected before requesting credentials",
        );
      }

      const schemaId =
        legacyRequest.schemaId && UUID_PATTERN.test(legacyRequest.schemaId)
          ? legacyRequest.schemaId
          : undefined;

      const response = await apiClient.post<
        Credential & { credentialId?: string }
      >("/api/v1/credentials", {
        credentialType: toCredentialType(
          legacyRequest.credentialType ??
            legacyRequest.schemaType ??
            legacyRequest.schemaId,
        ),
        organizationId: legacyRequest.organizationId,
        subjectDid,
        claims: legacyRequest.claims,
        expiresAt:
          legacyRequest.expiresAt instanceof Date
            ? legacyRequest.expiresAt.toISOString()
            : legacyRequest.expiresAt,
        schemaId,
        issuerProof: legacyRequest.issuerProof,
      });
      return response;
    },
    onSuccess: (data) => {
      const credentialId = data.credentialId ?? data.id ?? data.hash;
      toast.success("Credential requested", {
        description: `Request ${String(credentialId).slice(0, 12)}... submitted to issuer`,
      });
      queryClient.invalidateQueries({ queryKey: ["credentials", address] });
    },
    onError: (err: Error) => {
      toast.error("Credential request failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Revoke a credential on-chain
// ---------------------------------------------------------------------------

export function useRevokeCredential() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (credentialId: string): Promise<Hash> => {
      const hash = await writeContractAsync({
        address: CREDENTIAL_REGISTRY_ADDRESS as Address,
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "revokeCredential",
        args: [credentialId as `0x${string}`],
      });

      // Notify API to update cached status
      await apiClient.post(`/api/v1/credentials/${credentialId}/revoke`, {
        reason: `Revoked by controller ${address ?? "unknown"} after on-chain transaction ${hash}`,
      });

      return hash;
    },
    onSuccess: () => {
      toast.success("Credential revoked");
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
      queryClient.invalidateQueries({ queryKey: ["credential"] });
    },
    onError: (err: Error) => {
      toast.error("Revocation failed", { description: err.message });
    },
  });
}
