/**
 * IdentityContext — React context for ZeroID identity state management.
 *
 * Provides the current user's identity profile, credentials, and
 * methods for registration, credential management, and recovery.
 * Integrates with wagmi for wallet state and the ZeroID API client
 * for backend communication.
 */

'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAccount } from 'wagmi';

import type {
  IdentityState,
  IdentityProfile,
  Credential,
  CredentialStatus,
  DID,
  Bytes32,
  Address,
} from '@/types';
import { apiClient } from '@/lib/api/client';
import { createDID } from '@/lib/utils';
import { CREDENTIAL_POLL_INTERVAL_MS } from '@/config/constants';

// ============================================================================
// Context Value Type
// ============================================================================

export interface IdentityContextValue {
  /** Current identity state */
  identity: IdentityState;

  /** Register a new identity on-chain */
  registerIdentity: (recoveryHash: Bytes32) => Promise<void>;

  /** Refresh the identity profile from the backend */
  refreshProfile: () => Promise<void>;

  /** Refresh the credential list from the backend */
  refreshCredentials: () => Promise<void>;

  /** Get a specific credential by hash */
  getCredential: (credentialHash: Bytes32) => Credential | undefined;

  /** Filter credentials by status */
  getCredentialsByStatus: (status: CredentialStatus) => Credential[];

  /** Clear identity state (e.g. on wallet disconnect) */
  clearIdentity: () => void;

  /** The current user's DID (null if not registered) */
  did: DID | null;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_IDENTITY_STATE: IdentityState = {
  profile: null,
  credentials: [],
  isLoading: false,
  isRegistered: false,
  error: null,
};

// ============================================================================
// Context
// ============================================================================

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();

  const [state, setState] = useState<IdentityState>(DEFAULT_IDENTITY_STATE);

  // Track the address we last fetched for, to avoid stale closures
  const lastFetchedAddress = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // DID Derivation
  // -------------------------------------------------------------------------

  const did = useMemo<DID | null>(() => {
    if (!address) return null;
    const network = (process.env.NEXT_PUBLIC_CHAIN_ENV || 'testnet') as DID['network'];
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
      // 404 means the user is not registered yet — not an error
      if (
        error instanceof Error &&
        'statusCode' in error &&
        (error as { statusCode: number }).statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Fetch Credentials
  // -------------------------------------------------------------------------

  const fetchCredentials = useCallback(
    async (didHash: Bytes32): Promise<Credential[]> => {
      try {
        const result = await apiClient.listCredentials(
          didHash,
          1,
          100,
        );
        return result.items;
      } catch {
        return [];
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Load Identity on Wallet Connect
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isConnected || !address) {
      // Wallet disconnected — clear state
      if (lastFetchedAddress.current) {
        setState(DEFAULT_IDENTITY_STATE);
        lastFetchedAddress.current = null;
      }
      return;
    }

    let cancelled = false;

    async function loadIdentity() {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const profile = await fetchProfile(address as Address);

        if (cancelled) return;

        if (profile) {
          const credentials = await fetchCredentials(profile.did.hash);

          if (cancelled) return;

          setState({
            profile,
            credentials,
            isLoading: false,
            isRegistered: true,
            error: null,
          });
        } else {
          setState({
            profile: null,
            credentials: [],
            isLoading: false,
            isRegistered: false,
            error: null,
          });
        }

        lastFetchedAddress.current = address as string;
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load identity',
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
    if (!state.isRegistered || !state.profile) return;

    const didHash = state.profile.did.hash;
    const interval = setInterval(async () => {
      try {
        const credentials = await fetchCredentials(didHash);
        setState((prev) => ({ ...prev, credentials }));
      } catch {
        // Silently ignore polling errors
      }
    }, CREDENTIAL_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.isRegistered, state.profile, fetchCredentials]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const registerIdentity = useCallback(
    async (recoveryHash: Bytes32) => {
      if (!did) {
        throw new Error('Wallet must be connected to register');
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        await apiClient.registerIdentity(
          { didUri: did.uri, recoveryHash },
        );

        // Re-fetch the profile after registration
        const profile = await fetchProfile(address as Address);

        setState({
          profile,
          credentials: [],
          isLoading: false,
          isRegistered: true,
          error: null,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
        throw error;
      }
    },
    [did, address, fetchProfile],
  );

  const refreshProfile = useCallback(async () => {
    if (!address) return;

    try {
      const profile = await fetchProfile(address as Address);
      setState((prev) => ({
        ...prev,
        profile,
        isRegistered: !!profile,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh profile',
      }));
    }
  }, [address, fetchProfile]);

  const refreshCredentials = useCallback(async () => {
    if (!state.profile) return;

    const credentials = await fetchCredentials(state.profile.did.hash);
    setState((prev) => ({ ...prev, credentials }));
  }, [state.profile, fetchCredentials]);

  const getCredential = useCallback(
    (credentialHash: Bytes32) => {
      return state.credentials.find((c) => c.hash === credentialHash);
    },
    [state.credentials],
  );

  const getCredentialsByStatus = useCallback(
    (status: CredentialStatus) => {
      return state.credentials.filter((c) => c.status === status);
    },
    [state.credentials],
  );

  const clearIdentity = useCallback(() => {
    setState(DEFAULT_IDENTITY_STATE);
    lastFetchedAddress.current = null;
  }, []);

  // -------------------------------------------------------------------------
  // Memoised Context Value
  // -------------------------------------------------------------------------

  const value = useMemo<IdentityContextValue>(
    () => ({
      identity: state,
      registerIdentity,
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
      refreshProfile,
      refreshCredentials,
      getCredential,
      getCredentialsByStatus,
      clearIdentity,
      did,
    ],
  );

  return (
    <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
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
    throw new Error('useIdentity must be used within an <IdentityProvider>');
  }
  return ctx;
}
