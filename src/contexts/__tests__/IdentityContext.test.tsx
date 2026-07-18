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
import {
  clearIdentityAuthToken,
  getIdentityAuthToken,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";
import { expireIdentitySession } from "@/lib/identity/session";
import { createDID } from "@/lib/utils";
import type { IdentityProfile, DID, Bytes32 } from "@/types";
import type {
  CredentialSummary,
  CredentialSummaryStatus,
} from "@/lib/credentials/summary";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;

const mockUseAccount = jest.fn<
  { address: string | undefined; isConnected: boolean },
  []
>();
const mockSignMessageAsync = jest.fn();
const validRecoveryHash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Bytes32;
const validPublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useSignMessage: () => ({ signMessageAsync: mockSignMessageAsync }),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    getIdentityByAddress: jest.fn(),
    listCredentials: jest.fn(),
    registerIdentity: jest.fn(),
    createIdentityAuthChallenge: jest.fn(),
    loginWithWallet: jest.fn(),
    getCurrentIdentity: jest.fn(),
  },
}));

jest.mock("@/lib/identity/registration", () => ({
  ...jest.requireActual("@/lib/identity/registration"),
  recoverRegistrationPublicKey: jest.fn(() =>
    Promise.resolve("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  ),
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
  index: number,
  status: CredentialSummaryStatus = "active",
): CredentialSummary => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  credentialType: "KYC_LEVEL_2",
  typeLabel: "KYC Level 2",
  category: "kyc",
  issuerId: "issuer-identity-id",
  subjectId: "subject-identity-id",
  claimsHash: "a".repeat(64),
  proofAvailable: true,
  status,
  issuedAt: "2023-11-14T22:13:20.000Z",
  expiresAt: "2027-01-15T08:00:00.000Z",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <IdentityProvider>{children}</IdentityProvider>;
}

function establishIdentitySession(
  profile: IdentityProfile = makeProfile(mockAddress),
): void {
  storeIdentityAuthToken("identity-token");
  (apiClient.getCurrentIdentity as jest.Mock).mockResolvedValue({
    id: "identity-1",
    did: typeof profile.did === "string" ? profile.did : profile.did.uri,
    status: "ACTIVE",
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
  mockSignMessageAsync.mockResolvedValue("0xsignature");
  (createDID as jest.Mock).mockImplementation((id: string, network: string) =>
    makeDID(id),
  );
  clearIdentityAuthToken();
  window.sessionStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  clearIdentityAuthToken();
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
    it("derives DID from connected address", async () => {
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
      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });
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
    it("fetches profile and protected credentials for a validated session", async () => {
      const profile = makeProfile(mockAddress);
      const creds = [makeCredential(1), makeCredential(2)];
      establishIdentitySession(profile);

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
      expect(result.current.sessionStatus).toBe("authenticated");
      expect(apiClient.getCurrentIdentity).toHaveBeenCalledWith(
        "identity-token",
      );
    });

    it("marks a registered wallet as sign-in-required without reading protected credentials", async () => {
      const profile = makeProfile(mockAddress);
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });

      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(result.current.identity.isRegistered).toBe(true);
      expect(result.current.identity.credentials).toEqual([]);
      expect(result.current.sessionStatus).toBe("sign-in-required");
      expect(apiClient.listCredentials).not.toHaveBeenCalled();
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
  // Wallet-backed sessions
  // =========================================================================

  describe("wallet-backed session", () => {
    it("signs the server challenge, stores the returned token in memory, and refreshes credentials", async () => {
      const profile = makeProfile(mockAddress);
      const credentials = [makeCredential(1)];
      const challengeMessage = "server-issued sign-in message";

      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.createIdentityAuthChallenge as jest.Mock).mockResolvedValue({
        challengeId: "a".repeat(64),
        message: challengeMessage,
        expiresAt: "2026-07-18T10:05:00.000Z",
      });
      (apiClient.loginWithWallet as jest.Mock).mockResolvedValue({
        identity: {
          id: "identity-1",
          did: makeDID(mockAddress).uri,
          status: "ACTIVE",
        },
        token: "wallet-session-token",
        sessionId: "session-1",
      });
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: credentials,
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
        expect(result.current.sessionStatus).toBe("sign-in-required");
      });

      await act(() => result.current.signIn());

      expect(apiClient.createIdentityAuthChallenge).toHaveBeenCalledWith(
        mockAddress,
      );
      expect(mockSignMessageAsync).toHaveBeenCalledWith({
        message: challengeMessage,
      });
      expect(apiClient.loginWithWallet).toHaveBeenCalledWith({
        challengeId: "a".repeat(64),
        signature: "0xsignature",
      });
      expect(apiClient.listCredentials).toHaveBeenCalledWith(
        1,
        100,
        "wallet-session-token",
      );
      expect(result.current.sessionStatus).toBe("authenticated");
      expect(result.current.identity.credentials).toEqual(credentials);
      expect(getIdentityAuthToken()).toBe("wallet-session-token");
      expect(
        window.sessionStorage.getItem("zeroid.identity.authToken"),
      ).toBeNull();
    });

    it("does not retain a token when wallet signing is rejected", async () => {
      const profile = makeProfile(mockAddress);
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.createIdentityAuthChallenge as jest.Mock).mockResolvedValue({
        challengeId: "b".repeat(64),
        message: "sign this",
        expiresAt: "2026-07-18T10:05:00.000Z",
      });
      mockSignMessageAsync.mockRejectedValueOnce(
        Object.assign(new Error("User rejected"), { code: 4001 }),
      );
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });
      await waitFor(() => {
        expect(result.current.sessionStatus).toBe("sign-in-required");
      });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.signIn();
        } catch (error) {
          caught = error;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect(apiClient.loginWithWallet).not.toHaveBeenCalled();
      expect(getIdentityAuthToken()).toBeUndefined();
      expect(result.current.sessionStatus).toBe("sign-in-required");
      expect(result.current.sessionError).toBeTruthy();
    });

    it("clears protected state when any API surface reports an expired session", async () => {
      const profile = makeProfile(mockAddress);
      establishIdentitySession(profile);
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [makeCredential(1)],
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
        expect(result.current.sessionStatus).toBe("authenticated");
      });

      act(() => expireIdentitySession());

      expect(getIdentityAuthToken()).toBeUndefined();
      expect(result.current.sessionStatus).toBe("sign-in-required");
      expect(result.current.identity.credentials).toEqual([]);
      expect(result.current.sessionError).toMatch(/expired/i);
    });

    it("rejects a stored session whose DID belongs to another wallet", async () => {
      const profile = makeProfile(mockAddress);
      storeIdentityAuthToken("wrong-wallet-token");
      (apiClient.getCurrentIdentity as jest.Mock).mockResolvedValue({
        id: "identity-other",
        did: "did:aethelred:testnet:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        status: "ACTIVE",
      });
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(profile);
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });
      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      expect(getIdentityAuthToken()).toBeUndefined();
      expect(result.current.sessionStatus).toBe("sign-in-required");
      expect(result.current.sessionError).toMatch(/does not match/i);
      expect(apiClient.listCredentials).not.toHaveBeenCalled();
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

    it("clears the bearer session and protected data when the wallet account changes", async () => {
      const nextAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
      const firstProfile = makeProfile(mockAddress);
      establishIdentitySession(firstProfile);
      (apiClient.getIdentityByAddress as jest.Mock).mockImplementation(
        (walletAddress: string) => Promise.resolve(makeProfile(walletAddress)),
      );
      (apiClient.listCredentials as jest.Mock).mockResolvedValue({
        items: [makeCredential(1)],
        total: 1,
        page: 1,
        pageSize: 100,
        hasMore: false,
      });
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result, rerender } = renderHook(() => useIdentity(), { wrapper });
      await waitFor(() => {
        expect(result.current.sessionStatus).toBe("authenticated");
      });

      mockUseAccount.mockReturnValue({
        address: nextAddress,
        isConnected: true,
      });
      rerender();

      await waitFor(() => {
        expect(result.current.identity.profile?.controller).toBe(nextAddress);
      });

      expect(getIdentityAuthToken()).toBeUndefined();
      expect(result.current.sessionStatus).toBe("sign-in-required");
      expect(result.current.identity.credentials).toEqual([]);
      expect(apiClient.listCredentials).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Credential polling
  // =========================================================================

  describe("credential polling", () => {
    it("polls credentials every CREDENTIAL_POLL_INTERVAL_MS when registered", async () => {
      const profile = makeProfile(mockAddress);
      establishIdentitySession(profile);
      const credsFirst = [makeCredential(1)];
      const credsSecond = [makeCredential(1), makeCredential(2)];

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
      establishIdentitySession(profile);

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
      const recoveryHash = validRecoveryHash;

      (apiClient.getIdentityByAddress as jest.Mock)
        .mockResolvedValueOnce(null) // initial fetch
        .mockResolvedValueOnce(profile); // post-registration fetch
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        identity: profile,
        token: "identity-token",
        sessionId: "session-1",
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
        did: expect.any(String),
        controller: mockAddress,
        publicKey: validPublicKey,
        recoveryHash: recoveryHash.slice(2),
        signature: "0xsignature",
        metadata: { controller: mockAddress.toLowerCase() },
      });
      expect(mockSignMessageAsync).toHaveBeenCalledWith({
        message: expect.stringContaining("Chain ID: 7332"),
      });
      expect(getIdentityAuthToken()).toBe("identity-token");
      expect(
        window.sessionStorage.getItem("zeroid.identity.authToken"),
      ).toBeNull();
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

      const recoveryHash = validRecoveryHash;

      await expect(
        act(() => result.current.registerIdentity(recoveryHash)),
      ).rejects.toThrow("Wallet must be connected to register");
    });

    it("clears the new session when the registered profile cannot be validated", async () => {
      (apiClient.getIdentityByAddress as jest.Mock).mockResolvedValue(null);
      (apiClient.registerIdentity as jest.Mock).mockResolvedValue({
        identity: makeProfile(mockAddress),
        token: "unvalidated-token",
        sessionId: "session-unvalidated",
      });
      mockUseAccount.mockReturnValue({
        address: mockAddress,
        isConnected: true,
      });

      const { result } = renderHook(() => useIdentity(), { wrapper });
      await waitFor(() => {
        expect(result.current.identity.isLoading).toBe(false);
      });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.registerIdentity(validRecoveryHash);
        } catch (error) {
          caught = error;
        }
      });

      expect(caught).toEqual(
        new Error(
          "Registration completed, but the new identity profile could not be validated. Reconnect the wallet and sign in again.",
        ),
      );
      expect(getIdentityAuthToken()).toBeUndefined();
      expect(result.current.sessionStatus).toBe("anonymous");
      expect(result.current.identity.isRegistered).toBe(false);
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

      const recoveryHash = validRecoveryHash;

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

      const recoveryHash = validRecoveryHash;

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.registerIdentity(recoveryHash);
        } catch (e) {
          caught = e;
        }
      });

      // Non-Error throwables are wrapped into a real Error by the
      // registration error mapper so the UI always has a message to show.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("string registration error");
      expect(result.current.identity.error).toBe("string registration error");
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
      establishIdentitySession(profile);
      const credsNew = [
        makeCredential(1),
        makeCredential(2),
        makeCredential(3),
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

    it("surfaces credential refresh failures instead of treating them as empty data", async () => {
      const profile = makeProfile(mockAddress);
      establishIdentitySession(profile);

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

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.refreshCredentials();
        } catch (error) {
          caught = error;
        }
      });

      expect(caught).toEqual(new Error("Cred refresh failed"));
      expect(result.current.identity.credentials).toEqual([]);
    });
  });

  // =========================================================================
  // getCredential
  // =========================================================================

  describe("getCredential", () => {
    it("returns the credential matching the backend UUID", async () => {
      const cred = makeCredential(1);
      establishIdentitySession();

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

      expect(result.current.getCredential(cred.id)).toEqual(cred);
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
        result.current.getCredential("ffffffff-ffff-4fff-8fff-ffffffffffff"),
      ).toBeUndefined();
    });
  });

  // =========================================================================
  // getCredentialsByStatus
  // =========================================================================

  describe("getCredentialsByStatus", () => {
    it("filters credentials by status", async () => {
      const activeCred = makeCredential(1, "active");
      const revokedCred = makeCredential(2, "revoked");
      const expiredCred = makeCredential(3, "expired");
      establishIdentitySession();

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

      expect(result.current.getCredentialsByStatus("active")).toEqual([
        activeCred,
      ]);
      expect(result.current.getCredentialsByStatus("revoked")).toEqual([
        revokedCred,
      ]);
      expect(result.current.getCredentialsByStatus("suspended")).toEqual([]);
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
        items: [makeCredential(1)],
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
      establishIdentitySession(profile);
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

      await waitFor(() => {
        expect(apiClient.getIdentityByAddress).toHaveBeenCalled();
      });

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
