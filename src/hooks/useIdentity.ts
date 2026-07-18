/**
 * useIdentity — Hook for managing self-sovereign identity (DID) lifecycle.
 *
 * Handles DID creation, profile reads/updates, and controller-authorized
 * delegate transactions against the on-chain registry.
 */

import { useCallback } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSignMessage,
} from "wagmi";
import { useSafeWriteContract } from "./useSafeWriteContract";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash, keccak256, toBytes } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  buildRegistrationMessage,
  getIdentityAuthToken,
  getRegistrationAuthContext,
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
  const queryClient = useQueryClient();
  const { writeContractAsync } = useSafeWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { address } = useAccount();
  const publicClient = usePublicClient();

  return useMutation({
    mutationFn: async (params: CreateIdentityParams): Promise<Hash> => {
      const did = getRegistrationDid(params.didDocument, address);
      if (!address) {
        throw new Error("Wallet must be connected to register an identity.");
      }

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

      // A DID document key supplied by the wizard cannot prove control of the
      // connected EVM account. Always request a wallet signature and derive
      // the registration key from that exact proof.
      const message = buildRegistrationMessage({
        did,
        controller: address,
        recoveryHash,
        ...getRegistrationAuthContext(),
      });
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message });
      } catch (error) {
        // Surface signing failures as guidance (e.g. personal_sign reaching
        // the node because a non-signing provider owns window.ethereum).
        throw friendlyWalletError(error);
      }
      const publicKey = await recoverRegistrationPublicKey(message, signature);

      // Anchor the DID on-chain: registerIdentity(didHash, recoveryHash).
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS as Address,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "registerIdentity",
        args: [didHash, recoveryHashHex],
      });

      // A wallet returning a hash only means it ACCEPTED the request — it says
      // nothing about where (or whether) the transaction landed. Require the
      // receipt on THIS app's configured RPC, with success status, before the
      // backend learns about the identity or the user is told it is anchored.
      // This closes two real failure modes: a reverted transaction, and a
      // wallet whose RPC for chain 7332 points at a different node than ours
      // (the hash then never appears here and we must not claim success).
      if (!publicClient) {
        throw new Error(
          "No RPC client for the active network — cannot confirm the registration transaction.",
        );
      }
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 90_000,
        });
      } catch {
        throw new Error(
          `The registration transaction (${hash}) was not confirmed on this network's RPC. ` +
            "If your wallet talks to a different node for this chain, point it at the same RPC as this app and retry.",
        );
      }
      if (receipt.status !== "success") {
        throw new Error(
          "The registration transaction was rejected on-chain. No identity was created.",
        );
      }

      // Persist full DID document via API. The stored document carries the
      // DERIVED did — never a caller-supplied placeholder id.
      let registration: Awaited<ReturnType<typeof apiClient.registerIdentity>>;
      try {
        registration = await apiClient.registerIdentity({
          did,
          controller: address,
          publicKey,
          recoveryHash,
          signature,
          metadata: {
            controller: address.toLowerCase(),
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
