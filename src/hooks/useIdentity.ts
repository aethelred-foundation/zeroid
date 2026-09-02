/**
 * useIdentity — Hook for managing self-sovereign identity (DID) lifecycle.
 *
 * Handles DID creation, profile reads/updates, and controller-authorized
 * delegate transactions against the on-chain registry.
 */

import { useCallback, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSignMessage,
} from "wagmi";
import { useSafeWriteContract } from "./useSafeWriteContract";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  buildRegistrationMessage,
  clearPendingRegistration,
  deriveRegistrationArtifacts,
  getIdentityAuthToken,
  getPendingRegistration,
  getRegistrationAuthContext,
  getRegistrationDid,
  isRetryableRegistrationCode,
  recoverRegistrationPublicKey,
  storeIdentityAuthToken,
  storePendingRegistration,
  type PendingRegistration,
} from "@/lib/identity/registration";
import {
  CONTROLLER_ALREADY_BOUND_MESSAGE,
  friendlyRegistrationError,
  friendlyWalletError,
  REGISTRY_PAUSED_MESSAGE,
} from "@/lib/wallet-errors";
import {
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from "@/config/constants";
import { IdentityRegistryABI } from "@/config/abis";
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

/**
 * Where a registration attempt currently is. Surfaced so the wizard can label
 * its button honestly ("Signing…" vs "Confirming…") and so a retry after a
 * retryable API refusal is visibly "Verifying…" only.
 */
export type RegistrationStage =
  | "idle"
  | "preflight"
  | "signing"
  | "submitting"
  | "confirming"
  | "verifying"
  | "done";

const RECEIPT_TIMEOUT_MS = 90_000;

/**
 * A retryable refusal (the API's node has not seen the receipt yet) and a
 * service outage both leave the signed proof and the mined transaction
 * valid, so the pending slot is kept for a later click. Any other refusal
 * means these exact artifacts will never be accepted; clearing lets the next
 * attempt run the pre-flight again, which then reports an already-bound
 * wallet instead of paying for a ControllerAlreadyBound revert.
 */
function shouldKeepPendingRegistration(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const code = (error as { code?: string })?.code;
  if (isRetryableRegistrationCode(code)) return true;
  if (typeof statusCode === "number") return statusCode >= 500;
  // No HTTP status at all: the request never reached the API.
  return true;
}

export function useCreateIdentity() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useSafeWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [stage, setStage] = useState<RegistrationStage>("idle");

  const mutation = useMutation({
    mutationFn: async (params: CreateIdentityParams): Promise<Hash> => {
      if (!address) {
        throw new Error("Wallet must be connected to register an identity.");
      }
      if (!publicClient) {
        throw new Error(
          "No RPC client for the active network — cannot verify the registry before registering.",
        );
      }

      const registry = IDENTITY_REGISTRY_ADDRESS as Address;
      const did = getRegistrationDid(params.didDocument, address);

      // A previous attempt already signed, submitted and confirmed the
      // transaction but the API refused with a retryable code (or was down).
      // Re-POST those exact artifacts; never ask the wallet again.
      let pending = getPendingRegistration(address);

      if (!pending) {
        setStage("preflight");
        const paused = await publicClient.readContract({
          address: registry,
          abi: IdentityRegistryABI,
          functionName: "paused",
        });
        if (paused) {
          throw new Error(REGISTRY_PAUSED_MESSAGE);
        }
        const boundDidHash = await publicClient.readContract({
          address: registry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "resolveByController",
          args: [address],
        });
        if (isNonZeroDidHash(boundDidHash)) {
          throw new Error(CONTROLLER_ALREADY_BOUND_MESSAGE);
        }

        const recoveryController =
          params.recoveryAddress && params.recoveryAddress !== ZERO_ADDRESS
            ? params.recoveryAddress
            : address;
        const { didHash, recoveryHashHex, recoveryHash } =
          deriveRegistrationArtifacts(did, recoveryController);

        // A DID document key supplied by the wizard cannot prove control of
        // the connected EVM account. Always request a wallet signature and
        // derive the registration key from that exact proof.
        setStage("signing");
        const message = buildRegistrationMessage({
          did,
          controller: address,
          recoveryHash,
          ...getRegistrationAuthContext(),
        });
        let signature: Hex;
        try {
          signature = await signMessageAsync({ message });
        } catch (error) {
          throw friendlyWalletError(error);
        }
        const publicKey = await recoverRegistrationPublicKey(
          message,
          signature,
        );

        // Anchor the DID on-chain through the gas-buffered write (GAS-01:
        // eth_estimateGas under-reports registerIdentity by roughly 8x).
        setStage("submitting");
        const hash = await writeContractAsync({
          address: registry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "registerIdentity",
          args: [didHash, recoveryHashHex],
        });

        // A wallet returning a hash only means it accepted the request. The
        // API performs the authoritative verification, but the browser still
        // waits for a successful receipt with the expected event on its own
        // RPC before it reports anything, so a reverted transaction or a
        // wallet pointed at a different node is caught here first.
        setStage("confirming");
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: RECEIPT_TIMEOUT_MS,
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
        const registered = parseEventLogs({
          abi: IdentityRegistryABI,
          eventName: "IdentityRegistered",
          logs: receipt.logs.filter(
            (log) => log.address.toLowerCase() === registry.toLowerCase(),
          ),
        }).some((log) => log.args.didHash.toLowerCase() === didHash);
        if (!registered) {
          throw new Error(
            "The transaction confirmed but the registry emitted no IdentityRegistered event for this DID. No identity was created.",
          );
        }

        pending = {
          did,
          didHash,
          recoveryHash,
          publicKey,
          signature,
          txHash: hash,
          didDocument: { ...params.didDocument, id: did },
        } satisfies PendingRegistration;
        storePendingRegistration(address, pending);
      }

      // Hand the API the transaction hash only; it re-derives everything else
      // from the chain and refuses to create an identity or a session until
      // every binding holds.
      setStage("verifying");
      let registration: Awaited<ReturnType<typeof apiClient.registerIdentity>>;
      try {
        registration = await apiClient.registerIdentity({
          did: pending.did,
          controller: address,
          publicKey: pending.publicKey,
          recoveryHash: pending.recoveryHash,
          signature: pending.signature,
          txHash: pending.txHash,
          metadata: { didDocument: pending.didDocument },
        });
      } catch (error) {
        if (!shouldKeepPendingRegistration(error)) {
          clearPendingRegistration(address);
        }
        throw friendlyRegistrationError(error);
      }
      storeIdentityAuthToken(registration.token);
      clearPendingRegistration(address);
      setStage("done");

      return pending.txHash;
    },
    onSuccess: () => {
      toast.success("Identity created successfully");
      queryClient.invalidateQueries({ queryKey: ["identity"] });
    },
    onError: (err: Error) => {
      setStage("idle");
      toast.error("Failed to create identity", { description: err.message });
    },
  });

  return { ...mutation, stage };
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
    registrationStage: createMutation.stage,
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
