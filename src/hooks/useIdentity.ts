/**
 * useIdentity — Hook for managing self-sovereign identity (DID) lifecycle.
 *
 * Handles DID creation, profile reads/updates, delegate control,
 * and recovery via on-chain registry + API layer.
 */

import { useCallback } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from "@/config/constants";
import type {
  IdentityProfile,
  DIDDocument,
  DelegateRecord,
  CreateIdentityParams,
  UpdateProfileParams,
  Bytes32,
} from "@/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const EMPTY_BYTES32 = `0x${"0".repeat(64)}` as Bytes32;

// ---------------------------------------------------------------------------
// On-chain DID resolution
// ---------------------------------------------------------------------------

export function useOnChainIdentity() {
  const { address } = useAccount();

  const { data: didHash, isLoading: isDIDLoading } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "identityOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: delegates, isLoading: isDelegatesLoading } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getDelegates",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    didHash: didHash as string | undefined,
    delegates: (delegates as DelegateRecord[]) ?? [],
    isLoading: isDIDLoading || isDelegatesLoading,
    hasIdentity: !!didHash && didHash !== "0x",
  };
}

// ---------------------------------------------------------------------------
// Identity profile (off-chain, API-backed)
// ---------------------------------------------------------------------------

export function useIdentityProfile() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["identity", "profile", address],
    queryFn: () =>
      apiClient.get<IdentityProfile>(`/v1/identity/${address}/profile`),
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateIdentity() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: CreateIdentityParams): Promise<Hash> => {
      // Register DID document hash on-chain
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "registerIdentity",
        args: [params.didDocumentHash, params.recoveryAddress],
      });

      // Persist full DID document via API
      await apiClient.post("/v1/identity/register", {
        ownerAddress: address,
        txHash: hash,
        didDocument: params.didDocument,
        publicKeys: params.publicKeys,
      });

      return hash;
    },
    onSuccess: () => {
      toast.success("Identity created successfully");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
    },
    onError: (err: Error) => {
      toast.error("Failed to create identity", { description: err.message });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: (params: UpdateProfileParams) =>
      apiClient.put(`/v1/identity/${address}/profile`, params),
    onSuccess: () => {
      toast.success("Profile updated");
      queryClient.invalidateQueries({
        queryKey: ["identity", "profile", address],
      });
    },
    onError: (err: Error) => {
      toast.error("Profile update failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need a simple { identity } shape
// ---------------------------------------------------------------------------

export function useIdentity() {
  const { didHash, hasIdentity, delegates, isLoading } = useOnChainIdentity();
  const profileQuery = useIdentityProfile();
  const profile = profileQuery.data;
  const createMutation = useCreateIdentity();
  const { delegateControl, revokeDelegate } = useDelegateControl();
  const { address } = useAccount();

  const createIdentity = useCallback(
    async (params?: Partial<CreateIdentityParams>) =>
      createMutation.mutateAsync({
        didDocumentHash: params?.didDocumentHash ?? EMPTY_BYTES32,
        recoveryAddress: params?.recoveryAddress ?? address ?? ZERO_ADDRESS,
        didDocument: params?.didDocument ?? { id: "did:aethelred:pending" },
        publicKeys: params?.publicKeys ?? [],
      }),
    [address, createMutation],
  );

  const normalizedDid =
    typeof profile?.did === "string"
      ? profile.did
      : (profile?.did?.uri ?? didHash);

  return {
    identity: {
      did: normalizedDid,
      didHash,
      hasIdentity,
      delegates,
      isRegistered: hasIdentity,
      profile: profile ?? null,
      credentialCount: profile?.credentialCount ?? 0,
      verificationCount: profile?.verificationCount ?? 0,
      verificationStatus: profile?.verificationStatus ?? "unverified",
      createdAt: profile?.createdAt,
    },
    delegates,
    isLoading: isLoading || profileQuery.isLoading,
    error: profileQuery.error as Error | null,
    createIdentity,
    registerOnChain: createIdentity,
    delegateControl,
    revokeDelegate,
  };
}

export function useDelegateControl() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  const delegateControl = useCallback(
    async (delegateAddress: Address, expirySeconds: bigint): Promise<Hash> => {
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "addDelegate",
        args: [delegateAddress, expirySeconds],
      });
      toast.success("Delegate added");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
      return hash;
    },
    [writeContractAsync, queryClient],
  );

  const revokeDelegate = useCallback(
    async (delegateAddress: Address): Promise<Hash> => {
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "revokeDelegate",
        args: [delegateAddress],
      });
      toast.success("Delegate revoked");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
      return hash;
    },
    [writeContractAsync, queryClient],
  );

  return { delegateControl, revokeDelegate };
}
