/**
 * useIdentity — Hook for managing self-sovereign identity (DID) lifecycle.
 *
 * Handles DID creation, profile reads/updates, delegate control,
 * and recovery via on-chain registry + API layer.
 */

import { useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useSignMessage,
  useWriteContract,
} from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash, keccak256, toBytes } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  buildRegistrationMessage,
  extractRegistrationPublicKey,
  getIdentityAuthToken,
  getRegistrationDid,
  recoverRegistrationPublicKey,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";
import {
  friendlyRegistrationError,
  friendlyWalletError,
} from "@/lib/wallet-errors";
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
    functionName: "resolveByController",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return {
    didHash: didHash as string | undefined,
    // ZeroID.sol has no enumerable delegate getter (only isValidDelegate);
    // the delegate list is sourced from the backend/events, not this read.
    delegates: [] as DelegateRecord[],
    isLoading: isDIDLoading,
    // resolveByController returns bytes32(0) for an unregistered wallet — the
    // zero hash is truthy and !== "0x", so it must be excluded explicitly.
    hasIdentity: !!didHash && didHash !== "0x" && didHash !== EMPTY_BYTES32,
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
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: CreateIdentityParams): Promise<Hash> => {
      const did = getRegistrationDid(params.didDocument, address);

      // Derive the on-chain arguments from the DID itself. The contract's
      // registerIdentity(bytes32 didHash, bytes32 recoveryHash) reverts on a
      // zero didHash, so the didHash MUST be the real keccak of the DID — not
      // the placeholder EMPTY_BYTES32 the wizard passes — and the second arg
      // MUST be a bytes32 recovery hash, not the recovery ADDRESS.
      const didHash = keccak256(toBytes(did));
      const recoveryController =
        params.recoveryAddress && params.recoveryAddress !== ZERO_ADDRESS
          ? params.recoveryAddress
          : (address ?? ZERO_ADDRESS);
      const recoveryHashHex = keccak256(
        toBytes(`${did}#recovery:${recoveryController.toLowerCase()}`),
      );
      // Backend recovery hash is the same digest without the 0x prefix
      // (its schema is a bare 64-char hex SHA-256-shaped string).
      const recoveryHash = recoveryHashHex.slice(2);

      let publicKey = extractRegistrationPublicKey(params.publicKeys);

      if (!publicKey) {
        if (!address) {
          throw new Error("Wallet must be connected to register an identity.");
        }
        const message = buildRegistrationMessage({
          did,
          controller: address,
          recoveryHash,
        });
        let signature: `0x${string}`;
        try {
          signature = await signMessageAsync({ message });
        } catch (error) {
          // Surface signing failures as guidance (e.g. personal_sign reaching
          // the node because a non-signing provider owns window.ethereum).
          throw friendlyWalletError(error);
        }
        publicKey = await recoverRegistrationPublicKey(message, signature);
      }

      // Anchor the DID on-chain: registerIdentity(didHash, recoveryHash).
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "registerIdentity",
        args: [didHash, recoveryHashHex],
      });

      // Persist full DID document via API. The stored document carries the
      // DERIVED did — never a caller-supplied placeholder id.
      let registration: Awaited<ReturnType<typeof apiClient.registerIdentity>>;
      try {
        registration = await apiClient.registerIdentity({
          did,
          publicKey,
          recoveryHash,
          metadata: {
            controller: address?.toLowerCase(),
            txHash: hash,
            didHash,
            didDocument: { ...params.didDocument, id: did },
          },
        });
      } catch (error) {
        throw friendlyRegistrationError(error);
      }
      storeIdentityAuthToken(registration.token);

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
