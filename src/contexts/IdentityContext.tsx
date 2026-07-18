/**
 * IdentityContext — React context for ZeroID identity state management.
 *
 * Provides the current user's identity profile, credentials, and
 * methods for registration, credential management, and recovery.
 * Integrates with wagmi for wallet state and the ZeroID API client
 * for backend communication.
 */

"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAccount, useSignMessage } from "wagmi";

import type {
  IdentityState,
  IdentityProfile,
  DID,
  Bytes32,
  Address,
} from "@/types";
import { apiClient } from "@/lib/api/client";
import type {
  CredentialSummary,
  CredentialSummaryStatus,
} from "@/lib/credentials/summary";
import { friendlyWalletError } from "@/lib/wallet-errors";
import {
  clearIdentityAuthToken,
  createIdentityRegistrationUnavailableError,
  getIdentityAuthToken,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";
import {
  IDENTITY_SESSION_EXPIRED_EVENT,
  type IdentitySessionExpiredDetail,
} from "@/lib/identity/session";
import { createDID } from "@/lib/utils";
import { CREDENTIAL_POLL_INTERVAL_MS } from "@/config/constants";

// ============================================================================
// Context Value Type
// ============================================================================

export type IdentitySessionStatus =
  | "anonymous"
  | "sign-in-required"
  | "signing"
  | "authenticated";

export type IdentityContextState = Omit<IdentityState, "credentials"> & {
  /** Authenticated credential inventory returned by the backend. */
  credentials: CredentialSummary[];
};

export interface IdentityContextValue {
  /** Current identity state */
  identity: IdentityContextState;

  /** Register a new identity on-chain */
  registerIdentity: (recoveryHash: Bytes32) => Promise<void>;

  /** Authenticate a registered identity with a one-time wallet signature. */
  signIn: () => Promise<void>;

  /** Explicit wallet-backed session state. */
  sessionStatus: IdentitySessionStatus;

  /** Session-specific error suitable for an authentication control. */
  sessionError: string | null;

  /** Refresh the identity profile from the backend */
  refreshProfile: () => Promise<void>;

  /** Refresh the credential list from the backend */
  refreshCredentials: () => Promise<void>;

  /** Get a specific credential by its backend UUID. */
  getCredential: (credentialId: string) => CredentialSummary | undefined;

  /** Filter credentials by status */
  getCredentialsByStatus: (
    status: CredentialSummaryStatus,
  ) => CredentialSummary[];

  /** Clear identity state (e.g. on wallet disconnect) */
  clearIdentity: () => void;

  /** The current user's DID (null if not registered) */
  did: DID | null;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_IDENTITY_STATE: IdentityContextState = {
  profile: null,
  credentials: [],
  isLoading: false,
  isRegistered: false,
  error: null,
};

function getProfileDidUri(profile: IdentityProfile): string {
  return typeof profile.did === "string" ? profile.did : profile.did.uri;
}

// ============================================================================
// Context
// ============================================================================

const IdentityContext = createContext<IdentityContextValue | undefined>(
  undefined,
);

// ============================================================================
// Provider
// ============================================================================

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [state, setState] = useState<IdentityContextState>(
    DEFAULT_IDENTITY_STATE,
  );
  const [sessionStatus, setSessionStatus] =
    useState<IdentitySessionStatus>("anonymous");
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Track the address we last fetched for, to avoid stale closures
  const lastFetchedAddress = useRef<string | null>(null);
  const activeAddress = address?.toLowerCase() ?? null;
  const activeAddressRef = useRef<string | null>(activeAddress);
  activeAddressRef.current = activeAddress;

  // -------------------------------------------------------------------------
  // DID Derivation
  // -------------------------------------------------------------------------

  const did = useMemo<DID | null>(() => {
    if (!address) return null;
    const network = (process.env.NEXT_PUBLIC_CHAIN_ENV ||
      "testnet") as DID["network"];
    return createDID(address.toLowerCase(), network);
  }, [address]);

  // -------------------------------------------------------------------------
  // Fetch Identity Profile
  // -------------------------------------------------------------------------

  const fetchProfile = useCallback(async (addr: Address) => {
    try {
      const profile = await apiClient.getIdentityByAddress(addr);
      return profile;
    } catch (error) {
      // A wallet with no ZeroID yet resolves to 404 (code
      // IDENTITY_ADDRESS_NOT_FOUND). That is the normal first-run state, not a
      // failure — return null so the UI shows the "create your identity" prompt
      // instead of an error card. Duck-typed (not `instanceof ZeroIDApiError`)
      // so it still holds when the API module is mocked. Genuine errors propagate.
      const statusCode = (error as { statusCode?: number })?.statusCode;
      const code = (error as { code?: string })?.code;
      if (statusCode === 404 || code === "IDENTITY_ADDRESS_NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Fetch Credentials
  // -------------------------------------------------------------------------

  const fetchCredentials = useCallback(
    async (authToken: string): Promise<CredentialSummary[]> => {
      const result = await apiClient.listCredentials(1, 100, authToken);
      return result.items;
    },
    [],
  );

  // Any protected API surface can discover an expired/revoked bearer token.
  // The HTTP client clears it and emits this event so identity state never
  // continues to present cached protected data as current.
  useEffect(() => {
    const handleSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<IdentitySessionExpiredDetail>)
        .detail;
      setSessionStatus("sign-in-required");
      setSessionError(
        detail?.reason ??
          "Your ZeroID session expired. Sign in again to continue.",
      );
      setState((prev) =>
        prev.isRegistered ? { ...prev, credentials: [] } : prev,
      );
    };

    window.addEventListener(
      IDENTITY_SESSION_EXPIRED_EVENT,
      handleSessionExpired,
    );
    return () =>
      window.removeEventListener(
        IDENTITY_SESSION_EXPIRED_EVENT,
        handleSessionExpired,
      );
  }, []);

  // -------------------------------------------------------------------------
  // Load Identity on Wallet Connect
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isConnected || !address) {
      // Wallet disconnected — the bearer session must not outlive its wallet.
      setState(DEFAULT_IDENTITY_STATE);
      clearIdentityAuthToken();
      setSessionStatus("anonymous");
      setSessionError(null);
      lastFetchedAddress.current = null;
      return;
    }

    const normalizedAddress = address.toLowerCase();
    if (
      lastFetchedAddress.current &&
      lastFetchedAddress.current !== normalizedAddress
    ) {
      // Never carry a session or protected data across an account switch.
      clearIdentityAuthToken();
      setState(DEFAULT_IDENTITY_STATE);
      setSessionStatus("anonymous");
      setSessionError(null);
    }

    let cancelled = false;

    async function loadIdentity() {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const profile = await fetchProfile(address as Address);

        if (cancelled) return;

        if (profile) {
          const authToken = getIdentityAuthToken();
          let credentials: CredentialSummary[] = [];

          if (authToken) {
            try {
              const sessionIdentity =
                await apiClient.getCurrentIdentity(authToken);
              if (
                sessionIdentity.status !== "ACTIVE" ||
                sessionIdentity.did.toLowerCase() !==
                  getProfileDidUri(profile).toLowerCase()
              ) {
                clearIdentityAuthToken();
                setState({
                  profile,
                  credentials: [],
                  isLoading: false,
                  isRegistered: true,
                  error: null,
                });
                setSessionStatus("sign-in-required");
                setSessionError(
                  "This wallet does not match the active ZeroID session. Sign in again.",
                );
                lastFetchedAddress.current = normalizedAddress;
                return;
              }
              credentials = await fetchCredentials(authToken);
            } catch (credentialError) {
              if (cancelled) return;
              if (
                (credentialError as { statusCode?: number })?.statusCode === 401
              ) {
                setState({
                  profile,
                  credentials: [],
                  isLoading: false,
                  isRegistered: true,
                  error: null,
                });
                setSessionStatus("sign-in-required");
                setSessionError(
                  "Your ZeroID session expired. Sign in again to continue.",
                );
                lastFetchedAddress.current = normalizedAddress;
                return;
              }
              throw credentialError;
            }
          }

          if (cancelled) return;

          setState({
            profile,
            credentials,
            isLoading: false,
            isRegistered: true,
            error: null,
          });
          setSessionStatus(authToken ? "authenticated" : "sign-in-required");
          setSessionError(null);
        } else {
          clearIdentityAuthToken();
          setState({
            profile: null,
            credentials: [],
            isLoading: false,
            isRegistered: false,
            error: null,
          });
          setSessionStatus("anonymous");
          setSessionError(null);
        }

        lastFetchedAddress.current = normalizedAddress;
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            error instanceof Error ? error.message : "Failed to load identity",
        }));
      }
    }

    loadIdentity();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, fetchProfile, fetchCredentials]);

  // -------------------------------------------------------------------------
  // Credential Polling
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (
      sessionStatus !== "authenticated" ||
      !state.isRegistered ||
      !state.profile
    )
      return;

    const interval = setInterval(async () => {
      const authToken = getIdentityAuthToken();
      if (!authToken) {
        setSessionStatus("sign-in-required");
        setSessionError("Sign in to refresh your protected credentials.");
        setState((prev) => ({ ...prev, credentials: [] }));
        return;
      }
      try {
        const credentials = await fetchCredentials(authToken);
        if (getIdentityAuthToken() !== authToken) return;
        setState((prev) => ({ ...prev, credentials }));
      } catch {
        // Session 401s are handled centrally by the API client event. A
        // transient non-auth polling error leaves the last known data intact.
      }
    }, CREDENTIAL_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionStatus, state.isRegistered, state.profile, fetchCredentials]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const registerIdentity = useCallback(
    async (_recoveryHash: Bytes32) => {
      if (!did || !address) {
        throw new Error("Wallet must be connected to register");
      }

      const error = createIdentityRegistrationUnavailableError();
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      throw error;
    },
    [did, address],
  );

  const signIn = useCallback(async () => {
    if (!isConnected || !address) {
      throw new Error("Connect the registered wallet before signing in.");
    }
    if (!state.profile) {
      throw new Error("Register a ZeroID identity before signing in.");
    }

    const signingAddress = address.toLowerCase();
    setSessionStatus("signing");
    setSessionError(null);

    let session: Awaited<ReturnType<typeof apiClient.loginWithWallet>>;
    try {
      const challenge = await apiClient.createIdentityAuthChallenge(
        address as Address,
      );
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: challenge.message });
      } catch (signError) {
        throw friendlyWalletError(signError);
      }

      session = await apiClient.loginWithWallet({
        challengeId: challenge.challengeId,
        signature,
      });

      if (activeAddressRef.current !== signingAddress) {
        throw new Error(
          "Wallet account changed while signing in. Please try again.",
        );
      }
      if (
        !session.token ||
        !session.sessionId ||
        session.identity.status !== "ACTIVE" ||
        session.identity.did.toLowerCase() !==
          getProfileDidUri(state.profile).toLowerCase()
      ) {
        throw new Error("The ZeroID authentication response was invalid.");
      }
    } catch (error) {
      clearIdentityAuthToken();
      const walletStillConnected = activeAddressRef.current !== null;
      setSessionStatus(walletStillConnected ? "sign-in-required" : "anonymous");
      setSessionError(
        walletStillConnected
          ? error instanceof Error
            ? error.message
            : "ZeroID sign-in failed."
          : null,
      );
      throw error;
    }

    // Store only after the signature exchange and response binding succeed.
    // Production token storage remains memory-only by design.
    storeIdentityAuthToken(session.token);
    setSessionStatus("authenticated");
    setSessionError(null);

    try {
      const credentials = await fetchCredentials(session.token);
      if (
        activeAddressRef.current !== signingAddress ||
        getIdentityAuthToken() !== session.token
      ) {
        return;
      }
      setState((prev) => ({ ...prev, credentials, error: null }));
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 401) {
        throw error;
      }
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "Signed in, but credentials could not be refreshed.",
      }));
    }
  }, [address, fetchCredentials, isConnected, signMessageAsync, state.profile]);

  const refreshProfile = useCallback(async () => {
    if (!address) return;

    try {
      const profile = await fetchProfile(address as Address);
      setState((prev) => ({
        ...prev,
        profile,
        isRegistered: !!profile,
      }));
      if (!profile) {
        clearIdentityAuthToken();
        setSessionStatus("anonymous");
        setSessionError(null);
      } else if (!getIdentityAuthToken()) {
        setSessionStatus("sign-in-required");
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "Failed to refresh profile",
      }));
    }
  }, [address, fetchProfile]);

  const refreshCredentials = useCallback(async () => {
    if (!state.profile) return;

    const authToken = getIdentityAuthToken();
    if (!authToken) {
      setSessionStatus("sign-in-required");
      setSessionError("Sign in to refresh your protected credentials.");
      setState((prev) => ({ ...prev, credentials: [] }));
      throw new Error("Sign in to refresh your protected credentials.");
    }
    const credentials = await fetchCredentials(authToken);
    if (getIdentityAuthToken() !== authToken) return;
    setState((prev) => ({ ...prev, credentials }));
  }, [state.profile, fetchCredentials]);

  const getCredential = useCallback(
    (credentialId: string) => {
      return state.credentials.find(
        (credential) => credential.id === credentialId,
      );
    },
    [state.credentials],
  );

  const getCredentialsByStatus = useCallback(
    (status: CredentialSummaryStatus) => {
      return state.credentials.filter(
        (credential) => credential.status === status,
      );
    },
    [state.credentials],
  );

  const clearIdentity = useCallback(() => {
    setState(DEFAULT_IDENTITY_STATE);
    clearIdentityAuthToken();
    setSessionStatus("anonymous");
    setSessionError(null);
    lastFetchedAddress.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Memoised Context Value
  // -------------------------------------------------------------------------

  const value = useMemo<IdentityContextValue>(
    () => ({
      identity: state,
      registerIdentity,
      signIn,
      sessionStatus,
      sessionError,
      refreshProfile,
      refreshCredentials,
      getCredential,
      getCredentialsByStatus,
      clearIdentity,
      did,
    }),
    [
      state,
      registerIdentity,
      signIn,
      sessionStatus,
      sessionError,
      refreshProfile,
      refreshCredentials,
      getCredential,
      getCredentialsByStatus,
      clearIdentity,
      did,
    ],
  );

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Access the IdentityContext. Must be used within an `<IdentityProvider>`.
 *
 * @throws If called outside of an IdentityProvider
 */
export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) {
    throw new Error("useIdentity must be used within an <IdentityProvider>");
  }
  return ctx;
}
