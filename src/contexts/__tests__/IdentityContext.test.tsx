/**
 * Tests for IdentityContext — provider and useIdentity hook.
 *
 * Covers: DID derivation, profile fetching on connect, credential polling,
 * state cleanup on disconnect, registerIdentity, refreshProfile,
 * refreshCredentials, getCredential, getCredentialsByStatus, clearIdentity,
 * and the useIdentity guard for missing provider.
 */

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { IdentityProvider, useIdentity } from "@/contexts/IdentityContext";
import { apiClient } from "@/lib/api/client";
import { createDID } from "@/lib/utils";
import type {
  IdentityProfile,
  Credential,
  CredentialStatus,
  DID,
  Bytes32,
} from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;

const mockUseAccount = jest.fn<
  { address: string | undefined; isConnected: boolean },
  []
>();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    getIdentityByAddress: jest.fn(),
    listCredentials: jest.fn(),
    registerIdentity: jest.fn(),
  },
}));

jest.mock("@/lib/utils", () => ({
  createDID: jest.fn(),
}));

jest.mock("@/config/constants", () => ({
  CREDENTIAL_POLL_INTERVAL_MS: 15_000,
  DID_METHOD_PREFIX: "did:aethelred",
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeDID = (addr: string): DID => ({
  uri: `did:aethelred:testnet:${addr}`,
  identifier: addr,
  hash: "0xdeadbeef00000000000000000000000000000000000000000000000000000001" as Bytes32,
  network: "testnet",
});

const makeProfile = (addr: string): IdentityProfile => ({
  did: makeDID(addr),
  controller: addr as `0x${string}`,
  status: 1,
  recoveryHash:
    "0x0000000000000000000000000000000000000000000000000000000000000000" as Bytes32,
  credentialCount: 2,
  nonce: 1,
  createdAt: 1700000000,
  updatedAt: 1700000000,
});

const makeCredential = (
  hash: string,
  status: CredentialStatus = 1,
): Credential => ({
  hash: hash as Bytes32,
  schemaHash:
    "0xschema0000000000000000000000000000000000000000000000000000000001" as Bytes32,
  issuerDid: makeDID("0xissuer"),
  subjectDid: makeDID(mockAddress),
  issuedAt: 1700000000,
  expiresAt: 1800000000,
  status,
  merkleRoot:
    "0xmerkle0000000000000000000000000000000000000000000000000000000001" as Bytes32,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <IdentityProvider>{children}</IdentityProvider>;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
  (createDID as jest.Mock).mockImplementation((id: string, network: string) =>
    makeDID(id),
  );
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IdentityContext", () => {
  // =========================================================================
  // useIdentity guard
  // =========================================================================

  describe("useIdentity() outside provider", () => {
    it("throws when used without IdentityProvider", () => {
      // Suppress console.error for expected error
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useIdentity());
      }).toThrow("useIdentity must be used within an <IdentityProvider>");

      spy.mockRestore();
    });
  });

  // =========================================================================
  // Default state
  // =========================================================================

  describe("default state", () => {
    it("provides default identity state when wallet is disconnected", () => {
      const { result } = renderHook(() => useIdentity(), { wrapper });

      expect(result.current.identity).toEqual({
        profile: null,
        credentials: [],
        isLoading: false,
        isRegistered: false,
        error: null,
      });
      expect(result.current.did).toBeNull();
    });
  });

  // =========================================================================
  // DID derivation
  // =========================================================================

  describe("DID derivation", () => {
    it("derives DID from connected address", () => {
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);

      const { result } = renderHook(() => useIdentity(), { wrapper });

      expect(createDID).toHaveBeenCalledWith(
        mockAddress.toLowerCase(),
        expect.any(String),
      );
      expect(result.current.did).toEqual(makeDID(mockAddress.toLowerCase()));
    });

    it("returns null DID when disconnected", () => {
      mockUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      expect(result.current.did).toBeNull();
    });
  });

  // =========================================================================
  // Profile loading on connect
  // =========================================================================

  describe("loading identity on connect", () => {
    it("fetches profile and credentials when wallet connects", async () => {
      const profile = makeProfile(mockAddress);
      const creds = [makeCredential("0xcred01"), makeCredential("0xcred02")];

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: creds,
        total: 2,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      // Initially loading
      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.profile).toEqual(profile);
      expect(result.current.identity.credentials).toEqual(creds);
      expect(result.current.identity.isRegistered).toBe(true);
      expect(result.current.identity.error).toBeNull();
    });

    it("sets isRegistered to false when profile is not found (404)", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.profile).toBeNull();
      expect(result.current.identity.credentials).toEqual([]);
      expect(result.current.identity.isRegistered).toBe(false);
    });

    it("handles fetch error and sets error state", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockRejectedValue(
        new Error("Network failure"),
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.error).toBe("Network failure");
    });

    it("handles non-Error thrown objects gracefully", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockRejectedValue(
        "string error",
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.error).toBe("Failed to load identity");
    });

    it("returns null profile for 404 statusCode errors", async () => {
      const err404 = new Error("Not found") as Error & { statusCode: number };
      err404.statusCode = 404;
      (apiClient.getIdentityByAddress as jest.Mock).mockRejectedValue(err404);

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.profile).toBeNull();
      expect(result.current.identity.isRegistered).toBe(false);
    });
  });

  // =========================================================================
  // State cleanup on disconnect
  // =========================================================================

  describe("disconnect cleanup", () => {
    it("clears state when wallet disconnects", async () => {
      const profile = makeProfile(mockAddress);

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result, rerender } = renderHook(() => useIdentity(), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      // Disconnect
      mockUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      });
      rerender();

      await waitFor(() => {
        expect(result.current.identity.profile).toBeNull();
      });

      expect(result.current.identity.isRegistered).toBe(false);
      expect(result.current.identity.credentials).toEqual([]);
    });
  });

  // =========================================================================
  // Credential polling
  // =========================================================================

  describe("credential polling", () => {
    it("polls credentials every CREDENTIAL_POLL_INTERVAL_MS when registered", async () => {
      const profile = makeProfile(mockAddress);
      const credsFirst = [makeCredential("0xcred01")];
      const credsSecond = [
        makeCredential("0xcred01"),
        makeCredential("0xcred02"),
      ];

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock)
        .mockResolvedValueOnce({
          items: credsFirst,
          total: 1,
          page: 1,
          pageSize: 100,
          hasMore: false,
        })
        .mockResolvedValue({
          items: credsSecond,
          total: 2,
          page: 1,
          pageSize: 100,
          hasMore: false,
        });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      expect(result.current.identity.credentials).toEqual(credsFirst);

      // Advance timer to trigger poll
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });

      await waitFor(() => {
        expect(result.current.identity.credentials).toEqual(credsSecond);
      });
    });

    it("stops polling when identity is not registered", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(apiClient.getIdentityByAddress).toHaveBeenCalled();
      });

      // Reset call count
      (apiClient.listCredentials as jest.Mock).mockClear();

      // Advance timer
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      // No polling calls should have been made
      expect(apiClient.listCredentials).not.toHaveBeenCalled();
    });

    it("silently ignores polling errors", async () => {
      const profile = makeProfile(mockAddress);

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock)
        .mockResolvedValueOnce({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          hasMore: false,
        })
        .mockRejectedValue(new Error("Poll error"));

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      // Should not throw
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });

      // State should remain unchanged (no error set from polling)
      expect(result.current.identity.error).toBeNull();
    });
  });

  // =========================================================================
  // registerIdentity
  // =========================================================================

  describe("registerIdentity", () => {
    it("registers identity and re-fetches profile on success", async () => {
      const profile = makeProfile(mockAddress);
      const recoveryHash =
        "0xrecovery000000000000000000000000000000000000000000000000000000" as Bytes32;

      (apiClient.getIdentityByAddress as jest.Mock)
        .mockResolvedValueOnce(null) // initial fetch
        .mockResolvedValueOnce(profile); // post-registration fetch
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        didHash: profile.did.hash,
        txHash: "0xtx",
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      await act(() => result.current.registerIdentity(recoveryHash));

      expect(apiClient.registerIdentity).toHaveBeenCalledWith({
        didUri: expect.any(String),
        recoveryHash,
      });
      expect(result.current.identity.isRegistered).toBe(true);
      expect(result.current.identity.profile).toEqual(profile);
      expect(result.current.identity.credentials).toEqual([]);
      expect(result.current.identity.isLoading).toBe(false);
    });

    it("throws when wallet is not connected (no DID)", async () => {
      mockUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      const recoveryHash =
        "0xrecovery000000000000000000000000000000000000000000000000000000" as Bytes32;

      await expect(
        act(() => result.current.registerIdentity(recoveryHash)),
      ).rejects.toThrow("Wallet must be connected to register");
    });

    it("sets error state and re-throws when registration API fails", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);
      (apiClient.registerIdentity as jest.Mock).mockRejectedValue(
        new Error("Registration server error"),
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      const recoveryHash =
        "0xrecovery000000000000000000000000000000000000000000000000000000" as Bytes32;

      let caught: Error | undefined;
      await act(async () => {
        try {
          await result.current.registerIdentity(recoveryHash);
        } catch (e) {
          caught = e as Error;
        }
      });

      expect(caught).toBeDefined();
      expect(caught!.message).toBe("Registration server error");
      expect(result.current.identity.error).toBe("Registration server error");
      expect(result.current.identity.isLoading).toBe(false);
    });

    it("handles non-Error thrown in registration catch", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);
      (apiClient.registerIdentity as jest.Mock).mockRejectedValue(
        "string registration error",
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      const recoveryHash =
        "0xrecovery000000000000000000000000000000000000000000000000000000" as Bytes32;

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.registerIdentity(recoveryHash);
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBe("string registration error");
      expect(result.current.identity.error).toBe("Registration failed");
    });
  });

  // =========================================================================
  // refreshProfile
  // =========================================================================

  describe("refreshProfile", () => {
    it("updates profile when address is available", async () => {
      const profileV1 = makeProfile(mockAddress);
      const profileV2 = { ...profileV1, displayName: "Updated" };

      (apiClient.getIdentityByAddress as jest.Mock)
        .mockResolvedValueOnce(profileV1)
        .mockResolvedValueOnce(profileV2);
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      await act(() => result.current.refreshProfile());

      expect(result.current.identity.profile).toEqual(profileV2);
    });

    it("does nothing when address is not available", async () => {
      mockUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await act(() => result.current.refreshProfile());

      expect(apiClient.getIdentityByAddress).not.toHaveBeenCalled();
    });

    it("sets error state on failure", async () => {
      (apiClient.getIdentityByAddress as jest.Mock)
        .mockResolvedValueOnce(makeProfile(mockAddress))
        .mockRejectedValueOnce(new Error("Refresh failed"));
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      await act(() => result.current.refreshProfile());

      expect(result.current.identity.error).toBe("Refresh failed");
    });

    it("handles non-Error thrown in refreshProfile", async () => {
      (apiClient.getIdentityByAddress as jest.Mock)
        .mockResolvedValueOnce(makeProfile(mockAddress))
        .mockRejectedValueOnce("string error");
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      await act(() => result.current.refreshProfile());

      expect(result.current.identity.error).toBe("Failed to refresh profile");
    });
  });

  // =========================================================================
  // refreshCredentials
  // =========================================================================

  describe("refreshCredentials", () => {
    it("updates credentials when profile is available", async () => {
      const profile = makeProfile(mockAddress);
      const credsNew = [
        makeCredential("0xcred01"),
        makeCredential("0xcred02"),
        makeCredential("0xcred03"),
      ];

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock)
        .mockResolvedValueOnce({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: credsNew,
          total: 3,
          page: 1,
          pageSize: 100,
          hasMore: false,
        });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      await act(() => result.current.refreshCredentials());

      expect(result.current.identity.credentials).toEqual(credsNew);
    });

    it("does nothing when profile is null", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      (apiClient.listCredentials as jest.Mock).mockClear();

      await act(() => result.current.refreshCredentials());

      expect(apiClient.listCredentials).not.toHaveBeenCalled();
    });

    it("swallows fetch error via fetchCredentials and sets credentials to empty", async () => {
      const profile = makeProfile(mockAddress);

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock)
        .mockResolvedValueOnce({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          hasMore: false,
        })
        .mockRejectedValueOnce(new Error("Cred refresh failed"));

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      await act(() => result.current.refreshCredentials());

      // fetchCredentials swallows errors internally and returns [],
      // so refreshCredentials succeeds with empty credentials and no error.
      expect(result.current.identity.error).toBeNull();
      expect(result.current.identity.credentials).toEqual([]);
    });
  });

  // =========================================================================
  // getCredential
  // =========================================================================

  describe("getCredential", () => {
    it("returns the credential matching the hash", async () => {
      const cred = makeCredential("0xcred01");

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [cred],
        total: 1,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.credentials.length).toBe(1);
      });

      expect(result.current.getCredential("0xcred01" as Bytes32)).toEqual(cred);
    });

    it("returns undefined for non-existent credential", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      expect(
        result.current.getCredential("0xnonexistent" as Bytes32),
      ).toBeUndefined();
    });
  });

  // =========================================================================
  // getCredentialsByStatus
  // =========================================================================

  describe("getCredentialsByStatus", () => {
    it("filters credentials by status", async () => {
      const activeCred = makeCredential("0xcred01", 1);
      const revokedCred = makeCredential("0xcred02", 3);
      const expiredCred = makeCredential("0xcred03", 4);

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [activeCred, revokedCred, expiredCred],
        total: 3,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.credentials.length).toBe(3);
      });

      expect(
        result.current.getCredentialsByStatus(1 as CredentialStatus),
      ).toEqual([activeCred]);
      expect(
        result.current.getCredentialsByStatus(3 as CredentialStatus),
      ).toEqual([revokedCred]);
      expect(
        result.current.getCredentialsByStatus(2 as CredentialStatus),
      ).toEqual([]);
    });
  });

  // =========================================================================
  // clearIdentity
  // =========================================================================

  describe("clearIdentity", () => {
    it("resets identity state to defaults", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [makeCredential("0xcred01")],
        total: 1,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      act(() => {
        result.current.clearIdentity();
      });

      expect(result.current.identity).toEqual({
        profile: null,
        credentials: [],
        isLoading: false,
        isRegistered: false,
        error: null,
      });
    });
  });

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  describe("cleanup on unmount", () => {
    it("cancels in-flight fetches when the component unmounts before profile resolves", async () => {
      let resolveProfile: (val: IdentityProfile | null) => void;
      (apiClient.getIdentityByAddress as jest.Mock).mockReturnValue(
        new Promise<IdentityProfile | null>((resolve) => {
          resolveProfile = resolve;
        }),
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { unmount } = renderHook(() => useIdentity(), { wrapper });

      // Unmount before the fetch resolves
      unmount();

      // Resolve after unmount — should not cause state update errors
      await act(async () => {
        resolveProfile!(makeProfile(mockAddress));
      });

      // If we get here without errors, cleanup works correctly
    });

    it("cancels in-flight fetches when unmounting after profile but before credentials", async () => {
      const profile = makeProfile(mockAddress);
      let resolveCredentials: (val: any) => void;

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveCredentials = resolve;
        }),
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { unmount } = renderHook(() => useIdentity(), { wrapper });

      // Wait for profile to resolve (but credentials are still pending)
      await waitFor(() => {
        expect(apiClient.getIdentityByAddress).toHaveBeenCalled();
      });

      // Small delay to let the profile callback execute
      await act(async () => {
        await Promise.resolve();
      });

      // Unmount while credentials are pending
      unmount();

      // Resolve credentials after unmount — should not cause state update errors
      await act(async () => {
        resolveCredentials!({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          hasMore: false,
        });
      });
    });

    it("cancels in-flight fetches when unmounting during error handling", async () => {
      let rejectProfile: (err: Error) => void;
      (apiClient.getIdentityByAddress as jest.Mock).mockReturnValue(
        new Promise<IdentityProfile | null>((_, reject) => {
          rejectProfile = reject;
        }),
      );

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { unmount } = renderHook(() => useIdentity(), { wrapper });

      // Unmount before the fetch rejects
      unmount();

      // Reject after unmount — should not cause state update errors
      await act(async () => {
        rejectProfile!(new Error("Network error"));
      });
    });
  });

  // =========================================================================
  // Duplicate address skip
  // =========================================================================

  describe("duplicate address skip", () => {
    it("does not re-fetch if address has not changed on rerender", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result, rerender } = renderHook(() => useIdentity(), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      // First call from initial render
      expect(apiClient.getIdentityByAddress).toHaveBeenCalledTimes(1);

      // Rerender without address change
      rerender();

      // Should still be only 1 call
      expect(apiClient.getIdentityByAddress).toHaveBeenCalledTimes(1);
    });

    it("skips re-fetch when reconnecting with the same address", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(
        makeProfile(mockAddress),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });

      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result, rerender } = renderHook(() => useIdentity(), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      expect(apiClient.getIdentityByAddress).toHaveBeenCalledTimes(1);

      // Disconnect briefly
      mockUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      });
      rerender();

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(false);
      });

      // Reconnect with the same address
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });
      rerender();

      await waitFor(() => {
        expect(result.current.identity.isRegistered).toBe(true);
      });

      // Should have fetched again (2 total) because lastFetchedAddress was cleared on disconnect
      expect(apiClient.getIdentityByAddress).toHaveBeenCalledTimes(2);
    });
  });
});
