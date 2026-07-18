/**
 * useIdentity — Hook for managing self-sovereign identity (DID) lifecycle.
 *
 * Handles DID creation, profile reads/updates, and controller-authorized
 * delegate transactions against the on-chain registry.
 */

import { useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useSafeWriteContract } from "./useSafeWriteContract";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  createIdentityRegistrationUnavailableError,
  getIdentityAuthToken,
} from "@/lib/identity/registration";
import {
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from "@/config/constants";
import type {
  IdentityProfile,
  DIDDocument,
  CreateIdentityParams,
  UpdateProfileParams,
  Bytes32,
} from "@/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const EMPTY_BYTES32 = `0x${"0".repeat(64)}` as Bytes32;
const MAX_DELEGATION_DURATION_SECONDS = 365n * 24n * 60n * 60n;

function isNonZeroDidHash(value: unknown): value is Bytes32 {
  return (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(value) &&
    value.toLowerCase() !== EMPTY_BYTES32
  );
}

function finiteRecordCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// On-chain DID resolution
// ---------------------------------------------------------------------------

export function useOnChainIdentity() {
  const { address } = useAccount();

  const { data: didHash, isLoading: isDIDLoading } = useReadContract({
    address: IDENTITY_REGISTRY_ADDRESS as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "resolveByController",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    didHash: didHash as string | undefined,
    isLoading: isDIDLoading,
    // Only an actual non-zero bytes32 response is registration evidence.
    hasIdentity: isNonZeroDidHash(didHash),
  };
}

// ---------------------------------------------------------------------------
// Identity profile (off-chain, API-backed)
// ---------------------------------------------------------------------------

/** True for the backend's "no identity for this address" 404. */
function isNotRegistered(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const code = (error as { code?: string })?.code;
  return statusCode === 404 || code === "IDENTITY_ADDRESS_NOT_FOUND";
}

export function useIdentityProfile() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["identity", "profile", address],
    queryFn: async (): Promise<IdentityProfile | null> => {
      try {
        return await apiClient.get<IdentityProfile>(
          `/api/v1/identity/address/${address}`,
        );
      } catch (error) {
        // A wallet with no ZeroID yet resolves to 404 — the normal first-run
        // state, not a failure. Null lets the UI show the onboarding prompt
        // instead of an error card; genuine errors still propagate.
        if (isNotRegistered(error)) return null;
        throw error;
      }
    },
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateIdentity() {
  return useMutation({
    mutationFn: async (_params: CreateIdentityParams): Promise<Hash> => {
      // Do not ask for a signature or submit an irreversible wallet
      // transaction while the API cannot independently bind the confirmed
      // registry event to the identity being persisted.
      throw createIdentityRegistrationUnavailableError();
    },
    onError: (err: Error) => {
      toast.error("Identity registration unavailable", {
        description: err.message,
      });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: (params: UpdateProfileParams) =>
      apiClient.patch(
        "/api/v1/identity/me",
        toBackendProfileUpdate(params),
        getIdentityAuthToken(),
      ),
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

function toBackendProfileUpdate(params: UpdateProfileParams): {
  displayName?: string;
  metadata?: Record<string, unknown>;
} {
  const raw = params as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  const existingMetadata = raw.metadata;
  if (
    existingMetadata &&
    typeof existingMetadata === "object" &&
    !Array.isArray(existingMetadata)
  ) {
    Object.assign(metadata, existingMetadata);
  }
  if (typeof raw.avatarUri === "string") {
    metadata.avatarUri = raw.avatarUri;
  }

  const update = {
    displayName:
      typeof params.displayName === "string" ? params.displayName : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };

  if (!update.displayName && !update.metadata) {
    throw new Error("Profile update requires a display name or metadata.");
  }

  return update;
}

// ---------------------------------------------------------------------------
// Convenience wrapper — used by pages that need a simple { identity } shape
// ---------------------------------------------------------------------------

export function useIdentity() {
  const { didHash, hasIdentity, isLoading } = useOnChainIdentity();
  const profileQuery = useIdentityProfile();
  const profile = profileQuery.data;
  const createMutation = useCreateIdentity();
  const {
    delegateControl: submitDelegateTransaction,
    revokeDelegate: submitRevokeDelegateTransaction,
  } = useDelegateControl();
  const { address } = useAccount();

  const createIdentity = useCallback(
    async (params?: Partial<CreateIdentityParams>) =>
      createMutation.mutateAsync({
        didDocumentHash: params?.didDocumentHash ?? EMPTY_BYTES32,
        recoveryAddress: params?.recoveryAddress ?? address ?? ZERO_ADDRESS,
        // No placeholder id: getRegistrationDid derives the canonical
        // address-bound DID when the document carries none.
        didDocument: params?.didDocument ?? {},
        publicKeys: params?.publicKeys ?? [],
      }),
    [address, createMutation],
  );

  const normalizedDid =
    typeof profile?.did === "string"
      ? profile.did
      : (profile?.did?.uri ?? didHash);
  const profileEvidence = profile as unknown as
    | Record<string, unknown>
    | null
    | undefined;

  const delegateControl = useCallback(
    async (delegateAddress: Address, durationSeconds: bigint) => {
      if (!isNonZeroDidHash(didHash)) {
        throw new Error(
          "A confirmed on-chain DID is required before adding a delegate.",
        );
      }
      return submitDelegateTransaction(
        didHash,
        delegateAddress,
        durationSeconds,
      );
    },
    [didHash, submitDelegateTransaction],
  );

  const revokeDelegate = useCallback(
    async (delegateAddress: Address) => {
      if (!isNonZeroDidHash(didHash)) {
        throw new Error(
          "A confirmed on-chain DID is required before revoking a delegate.",
        );
      }
      return submitRevokeDelegateTransaction(didHash, delegateAddress);
    },
    [didHash, submitRevokeDelegateTransaction],
  );

  return {
    identity: {
      did: normalizedDid,
      didHash,
      hasIdentity,
      isRegistered: hasIdentity,
      profile: profile ?? null,
      credentialCount: finiteRecordCount(profile?.credentialCount),
      verificationCount: finiteRecordCount(profile?.verificationCount),
      verificationStatus: profile?.verificationStatus,
      status: profileEvidence?.status,
      teeAttested: profileEvidence?.teeAttested,
      governmentVerified: profileEvidence?.governmentVerified,
      verificationEvidence: profileEvidence?.verificationEvidence,
      createdAt: profile?.createdAt,
    },
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
  const { writeContractAsync } = useSafeWriteContract();

  const delegateControl = useCallback(
    async (
      didHash: Bytes32,
      delegateAddress: Address,
      durationSeconds: bigint,
    ): Promise<Hash> => {
      if (!isNonZeroDidHash(didHash)) {
        throw new Error("Delegation requires a non-zero DID hash.");
      }
      if (
        durationSeconds <= 0n ||
        durationSeconds > MAX_DELEGATION_DURATION_SECONDS
      ) {
        throw new Error(
          "Delegation duration must be between 1 second and 365 days.",
        );
      }
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "addDelegate",
        args: [didHash, delegateAddress, durationSeconds],
      });
      toast.success("Delegate added");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
      return hash;
    },
    [writeContractAsync, queryClient],
  );

  const revokeDelegate = useCallback(
    async (didHash: Bytes32, delegateAddress: Address): Promise<Hash> => {
      if (!isNonZeroDidHash(didHash)) {
        throw new Error("Delegation revocation requires a non-zero DID hash.");
      }
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "revokeDelegate",
        args: [didHash, delegateAddress],
      });
      toast.success("Delegate revoked");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
      return hash;
    },
    [writeContractAsync, queryClient],
  );

  return { delegateControl, revokeDelegate };
}
