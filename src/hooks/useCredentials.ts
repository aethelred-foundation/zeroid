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

// ---------------------------------------------------------------------------
// List credentials for the connected wallet
// ---------------------------------------------------------------------------

export function useCredentials(status?: CredentialStatus) {
  const { address } = useAccount();

  const params = new URLSearchParams();
  if (status) params.set("status", status);

  return useQuery({
    queryKey: ["credentials", address, status],
    queryFn: () =>
      apiClient.get<{ credentials: Credential[]; total: number }>(
        `/v1/credentials/${address}?${params.toString()}`,
      ),
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Get single credential detail (off-chain + on-chain hash check)
// ---------------------------------------------------------------------------

export function useCredentialDetails(credentialId: string | undefined) {
  const { data: onChainHash, isLoading: isHashLoading } = useReadContract({
    address: CREDENTIAL_REGISTRY_ADDRESS as Address,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "credentialHash",
    args: credentialId ? [credentialId] : undefined,
    query: { enabled: !!credentialId },
  });

  const apiQuery = useQuery({
    queryKey: ["credential", credentialId],
    queryFn: () =>
      apiClient.get<CredentialDetails>(
        `/v1/credentials/detail/${credentialId}`,
      ),
    enabled: !!credentialId,
    staleTime: 20_000,
  });

  return {
    ...apiQuery,
    onChainHash: onChainHash as string | undefined,
    isHashLoading,
    isIntegrityValid:
      apiQuery.data && onChainHash
        ? apiQuery.data.contentHash === onChainHash
        : undefined,
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
      const response = await apiClient.post<{ credentialId: string }>(
        "/v1/credentials/request",
        {
          holderAddress: address,
          issuerDid: request.issuerDid,
          schemaId: request.schemaId,
          claims: request.claims,
          proofOfEligibility: request.proofOfEligibility,
        },
      );
      return response;
    },
    onSuccess: (data) => {
      toast.success("Credential requested", {
        description: `Request ${data.credentialId.slice(0, 12)}... submitted to issuer`,
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
        args: [credentialId],
      });

      // Notify API to update cached status
      await apiClient.post(`/v1/credentials/${credentialId}/revoke`, {
        txHash: hash,
        revokerAddress: address,
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
