/**
 * Tests for useIdentity hooks — on-chain reads, API-backed profile,
 * identity creation/update mutations, delegate control, and the
 * convenience useIdentity wrapper.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  clearIdentityAuthToken,
  getIdentityAuthToken,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";
import {
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from "@/config/constants";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";
const mockTxHash =
  "0xtxhash000000000000000000000000000000000000000000000000000000001";

const mockUseAccount = jest.fn();
const mockUseReadContract = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockUseWriteContract = jest.fn();
const mockSignMessageAsync = jest.fn();
const mockWaitForTransactionReceipt = jest.fn();
const mockUsePublicClient = jest.fn();
const validRecoveryHash =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const validPublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  usePublicClient: () => mockUsePublicClient(),
  useReadContract: (args: unknown) => mockUseReadContract(args),
  useWriteContract: () => mockUseWriteContract(),
  useSignMessage: () => ({ signMessageAsync: mockSignMessageAsync }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    registerIdentity: jest.fn(),
  },
}));

jest.mock("@/lib/identity/registration", () => ({
  ...jest.requireActual("@/lib/identity/registration"),
  recoverRegistrationPublicKey: jest.fn(() =>
    Promise.resolve("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  ),
}));

jest.mock("@/config/constants", () => ({
  IDENTITY_REGISTRY_ADDRESS: "0xRegistryAddress",
  IDENTITY_REGISTRY_ABI: [{ type: "function", name: "resolveByController" }],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockUseAccount.mockReturnValue({ address: mockAddress });
  mockUseWriteContract.mockReturnValue({
    writeContractAsync: mockWriteContractAsync,
  });
  mockUseReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockWriteContractAsync.mockResolvedValue(mockTxHash);
  mockSignMessageAsync.mockResolvedValue("0xsignature");
  mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mockUsePublicClient.mockReturnValue({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  });
  clearIdentityAuthToken();
  window.sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests — must import after mocks are set up
// ---------------------------------------------------------------------------

describe("useIdentity hooks", () => {
  // =========================================================================
  // useOnChainIdentity
  // =========================================================================

  describe("useOnChainIdentity", () => {
    it("reads the controller→DID hash from the registry (resolveByController)", async () => {
      const didHashValue = `0x${"1".repeat(64)}`;

      // Single read: resolveByController. Must use the deployed getter name.
      mockUseReadContract.mockReturnValue({
        data: didHashValue,
        isLoading: false,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(mockUseReadContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "resolveByController" }),
      );
      expect(result.current.didHash).toBe(didHashValue);
      // No enumerable delegate getter exists, so no authoritative list is
      // returned from this hook.
      expect(result.current).not.toHaveProperty("delegates");
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasIdentity).toBe(true);
    });

    it("returns hasIdentity false when didHash is empty", async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it("returns hasIdentity false when didHash is 0x", async () => {
      mockUseReadContract.mockReturnValue({ data: "0x", isLoading: false });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it("does not accept a malformed registry response as an identity", async () => {
      mockUseReadContract.mockReturnValue({
        data: "0xnot-a-bytes32",
        isLoading: false,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it("returns hasIdentity false for the zero hash (unregistered wallet)", async () => {
      // resolveByController returns bytes32(0) for a wallet with no identity —
      // truthy and !== "0x", so it must not count as having an identity.
      mockUseReadContract.mockReturnValue({
        data: `0x${"0".repeat(64)}`,
        isLoading: false,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it("reflects loading state", async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("disables contract reads when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      // useReadContract should have been called with enabled: false via args being undefined
      const calls = mockUseReadContract.mock.calls;
      for (const call of calls) {
        expect(call[0].args).toBeUndefined();
      }
    });

    it("does not fabricate an empty delegate list", async () => {
      mockUseReadContract.mockReturnValue({
        data: `0x${"3".repeat(64)}`,
        isLoading: false,
      });

      const { useOnChainIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current).not.toHaveProperty("delegates");
    });
  });

  // =========================================================================
  // useIdentityProfile
  // =========================================================================

  describe("useIdentityProfile", () => {
    it("fetches profile from API when address is available", async () => {
      const profile = {
        did: "did:aethelred:testnet:0xabc",
        displayName: "Alice",
      };
      (apiClient.get as jest.Mock).mockResolvedValue(profile);

      const { useIdentityProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(profile);
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/v1/identity/address/${mockAddress}`,
      );
    });

    it("does not fetch when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useIdentityProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      // Query should not fire
      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("resolves to null (not an error) when the wallet is not registered (404)", async () => {
      // The backend answers 404 IDENTITY_ADDRESS_NOT_FOUND for a wallet with
      // no ZeroID — the normal first-run state. It must surface as a null
      // profile so the UI shows onboarding, not the error card.
      const notFound = Object.assign(
        new Error("Identity not found for address"),
        {
          statusCode: 404,
          code: "IDENTITY_ADDRESS_NOT_FOUND",
        },
      );
      (apiClient.get as jest.Mock).mockRejectedValue(notFound);

      const { useIdentityProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("still surfaces genuine (non-404) errors", async () => {
      const boom = Object.assign(new Error("Network failure"), {
        statusCode: 500,
      });
      (apiClient.get as jest.Mock).mockRejectedValue(boom);

      const { useIdentityProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect((result.current.error as Error).message).toBe("Network failure");
    });
  });

  // =========================================================================
  // useCreateIdentity
  // =========================================================================

  describe("useCreateIdentity", () => {
    it("registers identity on-chain and via API, then shows toast", async () => {
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        token: "identity-token",
        sessionId: "session-1",
        identity: {},
      });

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          didDocumentHash: validRecoveryHash,
          recoveryAddress: "0xrecovery",
          // Canonical address-bound DID, mixed-case address on purpose.
          didDocument: {
            id: "did:aethelred:testnet:0x1234567890ABCDEF1234567890abcdef12345678",
          },
          publicKeys: [validPublicKey],
        } as any);
      });

      // On-chain args are DERIVED bytes32 hashes, not the placeholder/address:
      // registerIdentity(keccak256(did), keccak256(did#recovery:controller)).
      const { keccak256, toBytes } = require("viem");
      const expectedDid = `did:aethelred:testnet:${mockAddress}`;
      const expectedDidHash = keccak256(toBytes(expectedDid));
      // recoveryAddress "0xrecovery" was supplied, so it is the recovery
      // controller (lowercased) — not the wallet address.
      const expectedRecoveryHex = keccak256(
        toBytes(`${expectedDid}#recovery:0xrecovery`),
      );
      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "registerIdentity",
          args: [expectedDidHash, expectedRecoveryHex],
        }),
      );

      // The DID passes through normalized, and the backend gets the same
      // recovery digest without the 0x prefix.
      expect(apiClient.registerIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          did: expectedDid,
          controller: mockAddress,
          publicKey: validPublicKey,
          recoveryHash: expectedRecoveryHex.slice(2),
          signature: "0xsignature",
        }),
      );
      expect(mockSignMessageAsync).toHaveBeenCalledTimes(1);
      expect(mockSignMessageAsync).toHaveBeenCalledWith({
        message: expect.stringContaining(`DID: ${expectedDid}`),
      });
      expect(getIdentityAuthToken()).toBe("identity-token");
      expect(
        window.sessionStorage.getItem("zeroid.identity.authToken"),
      ).toBeNull();

      expect(toast.success).toHaveBeenCalledWith(
        "Identity created successfully",
      );
    });

    it("never registers a placeholder DID — derives the wallet DID instead", async () => {
      // The wizard once passed { id: "did:aethelred:pending" }, which a loose
      // pattern accepted verbatim: the backend stored a literal "pending"
      // identity that squatted the DID for every wallet (409 on retry) while
      // the address lookup 404'd. Placeholders must fall through to address
      // derivation, and the stored didDocument must carry the derived id.
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        token: "identity-token",
        sessionId: "session-1",
        identity: {},
      });

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          didDocumentHash: validRecoveryHash,
          recoveryAddress: "0xrecovery",
          didDocument: { id: "did:aethelred:pending" },
          publicKeys: [validPublicKey],
        } as any);
      });

      const expectedDid = `did:aethelred:testnet:${mockAddress}`;
      expect(apiClient.registerIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          did: expectedDid,
          metadata: expect.objectContaining({
            didDocument: expect.objectContaining({ id: expectedDid }),
          }),
        }),
      );
    });

    it("waits for the tx receipt before telling the backend", async () => {
      // The wallet handing back a hash is NOT proof the transaction landed on
      // this app's chain — a wallet pointed at a different RPC for the same
      // chain id broadcasts elsewhere and the hash never appears here. The
      // backend must not learn about an identity until the receipt confirms.
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        token: "identity-token",
        sessionId: "session-1",
        identity: {},
      });

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          didDocumentHash: validRecoveryHash,
          recoveryAddress: "0xrecovery",
          didDocument: { id: "did:aethelred:pending" },
          publicKeys: [validPublicKey],
        } as any);
      });

      expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ hash: mockTxHash }),
      );
      // Ordering: the receipt resolved before the API persisted the DID.
      const receiptOrder =
        mockWaitForTransactionReceipt.mock.invocationCallOrder[0];
      const apiOrder = (apiClient.registerIdentity as jest.Mock).mock
        .invocationCallOrder[0];
      expect(receiptOrder).toBeLessThan(apiOrder);
    });

    it("does not register with the backend when the receipt never arrives", async () => {
      mockWaitForTransactionReceipt.mockRejectedValue(
        new Error("Timed out while waiting for transaction"),
      );

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            didDocumentHash: validRecoveryHash,
            recoveryAddress: "0xrecovery",
            didDocument: { id: "did:aethelred:pending" },
            publicKeys: [validPublicKey],
          } as any),
        ).rejects.toThrow(/not confirmed on this network's RPC/);
      });

      expect(apiClient.registerIdentity).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it("does not register with the backend when the tx reverted", async () => {
      mockWaitForTransactionReceipt.mockResolvedValue({ status: "reverted" });

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            didDocumentHash: validRecoveryHash,
            recoveryAddress: "0xrecovery",
            didDocument: { id: "did:aethelred:pending" },
            publicKeys: [validPublicKey],
          } as any),
        ).rejects.toThrow(/rejected on-chain/);
      });

      expect(apiClient.registerIdentity).not.toHaveBeenCalled();
    });

    it("shows error toast on failure", async () => {
      mockWriteContractAsync.mockRejectedValue(
        new Error("User rejected transaction"),
      );

      const { useCreateIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            didDocumentHash: validRecoveryHash,
            recoveryAddress: "0xrecovery",
            didDocument: {},
            publicKeys: [validPublicKey],
          } as any);
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Failed to create identity", {
        description: "User rejected transaction",
      });
    });
  });

  // =========================================================================
  // useUpdateProfile
  // =========================================================================

  describe("useUpdateProfile", () => {
    it("updates profile via API PATCH and shows success toast", async () => {
      storeIdentityAuthToken("identity-token");
      (apiClient.patch as jest.Mock).mockResolvedValue({ success: true });

      const { useUpdateProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          displayName: "Bob",
          avatarUri: "https://example.com/avatar.png",
        } as any);
      });

      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/v1/identity/me",
        {
          displayName: "Bob",
          metadata: { avatarUri: "https://example.com/avatar.png" },
        },
        "identity-token",
      );

      expect(toast.success).toHaveBeenCalledWith("Profile updated");
    });

    it("shows error toast on update failure", async () => {
      (apiClient.patch as jest.Mock).mockRejectedValue(
        new Error("Unauthorized"),
      );

      const { useUpdateProfile } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({ displayName: "Bob" } as any);
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Profile update failed", {
        description: "Unauthorized",
      });
    });
  });

  // =========================================================================
  // useDelegateControl
  // =========================================================================

  describe("useDelegateControl", () => {
    it("adds a delegate on-chain", async () => {
      const { useDelegateControl } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });
      const didHash = `0x${"1".repeat(64)}` as `0x${string}`;

      let hash: string | undefined;
      await act(async () => {
        hash = await result.current.delegateControl(
          didHash,
          "0xdelegate1" as `0x${string}`,
          BigInt(86400),
        );
      });

      expect(hash).toBe(mockTxHash);
      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "addDelegate",
          args: [didHash, "0xdelegate1", BigInt(86400)],
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("Delegate added");
    });

    it("revokes a delegate on-chain", async () => {
      const { useDelegateControl } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });
      const didHash = `0x${"2".repeat(64)}` as `0x${string}`;

      let hash: string | undefined;
      await act(async () => {
        hash = await result.current.revokeDelegate(
          didHash,
          "0xdelegate1" as `0x${string}`,
        );
      });

      expect(hash).toBe(mockTxHash);
      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "revokeDelegate",
          args: [didHash, "0xdelegate1"],
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("Delegate revoked");
    });

    it("rejects delegation without a non-zero DID hash", async () => {
      const { useDelegateControl } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });

      await expect(
        result.current.delegateControl(
          `0x${"0".repeat(64)}` as `0x${string}`,
          "0xdelegate1" as `0x${string}`,
          60n,
        ),
      ).rejects.toThrow("non-zero DID hash");
      expect(mockWriteContractAsync).not.toHaveBeenCalled();
    });

    it("enforces the contract delegation-duration bounds client-side", async () => {
      const { useDelegateControl } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });
      const didHash = `0x${"5".repeat(64)}` as `0x${string}`;

      await expect(
        result.current.delegateControl(
          didHash,
          "0xdelegate1" as `0x${string}`,
          365n * 24n * 60n * 60n + 1n,
        ),
      ).rejects.toThrow("between 1 second and 365 days");
      expect(mockWriteContractAsync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useIdentity (convenience wrapper)
  // =========================================================================

  describe("useIdentity (wrapper)", () => {
    it("combines on-chain and profile data", async () => {
      const didHashValue = `0x${"4".repeat(64)}`;
      const profile = {
        did: "did:aethelred:testnet:0xabc",
        displayName: "Combined",
      };

      mockUseReadContract.mockReturnValue({
        data: didHashValue,
        isLoading: false,
      }); // resolveByController

      (apiClient.get as jest.Mock).mockResolvedValue(profile);

      const { useIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.identity.profile).toEqual(profile);
      });

      expect(result.current.identity.didHash).toBe(didHashValue);
      expect(result.current.identity.hasIdentity).toBe(true);
      expect(result.current.identity.isRegistered).toBe(true);
      // The contract has no enumerable getter, so the wrapper must not expose
      // an invented empty delegate list as authoritative state.
      expect(result.current).not.toHaveProperty("delegates");
      expect(typeof result.current.createIdentity).toBe("function");
      expect(typeof result.current.revokeDelegate).toBe("function");
    });

    it("returns isLoading true when either on-chain or profile is loading", async () => {
      mockUseReadContract.mockReturnValue({ data: undefined, isLoading: true });
      (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves

      const { useIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("returns profile as null when not loaded", async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { useIdentity } = await import("@/hooks/useIdentity");
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.identity.profile).toBeNull();
    });
  });
});
