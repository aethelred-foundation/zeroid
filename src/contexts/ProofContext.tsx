/**
 * ProofContext — React context for ZK proof state management.
 *
 * Manages the lifecycle of ZK proof generation, verification,
 * and proof request handling. Integrates with the ZK prover/verifier
 * modules and the ZeroID API client.
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

import type {
  ProofState,
  ZKProof,
  ProofRequest,
  ProofVerification,
  VerificationResult,
  Bytes32,
} from '@/types';
import {
  generateProof,
  type ProofProgressCallback,
} from '@/lib/zk/prover';
import { verifyProofLocally } from '@/lib/zk/verifier';
import { apiClient } from '@/lib/api/client';
import { useIdentity } from '@/contexts/IdentityContext';

// ============================================================================
// Context Value Type
// ============================================================================

export interface ProofContextValue {
  /** Current proof state */
  proofState: ProofState;

  /**
   * Generate a ZK proof for a given circuit.
   * Progress is reported via `proofState.generationProgress`.
   */
  generateZKProof: (
    circuitId: Bytes32,
    privateInputs: Record<string, string>,
    publicInputs: Record<string, string>,
  ) => Promise<ZKProof>;

  /** Verify a proof locally in the browser */
  verifyLocally: (proof: ZKProof) => Promise<ProofVerification>;

  /** Submit a proof to the backend for on-chain verification */
  submitProof: (proof: ZKProof) => Promise<ProofVerification>;

  /** Respond to a proof request (generate + submit) */
  fulfillProofRequest: (
    requestId: string,
    privateInputs: Record<string, string>,
  ) => Promise<VerificationResult>;

  /** Dismiss / clear a proof request */
  dismissRequest: (requestId: string) => void;

  /** Refresh pending proof requests from the backend */
  refreshRequests: () => Promise<void>;

  /** Clear all generated proofs from local state */
  clearProofs: () => void;

  /** Clear the current error */
  clearError: () => void;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_PROOF_STATE: ProofState = {
  pendingRequests: [],
  generatedProofs: [],
  verificationResults: [],
  isGenerating: false,
  generationProgress: 0,
  error: null,
};

// ============================================================================
// Context
// ============================================================================

const ProofContext = createContext<ProofContextValue | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

export function ProofProvider({ children }: { children: React.ReactNode }) {
  const { identity, did } = useIdentity();

  const [state, setState] = useState<ProofState>(DEFAULT_PROOF_STATE);

  // Ref to track whether a proof generation is in flight
  const generatingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Fetch Pending Proof Requests
  // -------------------------------------------------------------------------

  const refreshRequests = useCallback(async () => {
    if (!did || !identity.isRegistered) return;

    try {
      const requests = await apiClient.listProofRequests(did.hash, '');
      setState((prev) => ({ ...prev, pendingRequests: requests }));
    } catch {
      // Silently ignore — requests will be retried on next poll
    }
  }, [did, identity.isRegistered]);

  // Poll for new proof requests when the user is registered
  useEffect(() => {
    if (!identity.isRegistered || !did) return;

    // Initial fetch
    refreshRequests();

    const interval = setInterval(refreshRequests, 30_000);
    return () => clearInterval(interval);
  }, [identity.isRegistered, did, refreshRequests]);

  // Clear state when identity is cleared
  useEffect(() => {
    if (!identity.isRegistered) {
      setState(DEFAULT_PROOF_STATE);
    }
  }, [identity.isRegistered]);

  // -------------------------------------------------------------------------
  // Proof Generation
  // -------------------------------------------------------------------------

  const generateZKProof = useCallback(
    async (
      circuitId: Bytes32,
      privateInputs: Record<string, string>,
      publicInputs: Record<string, string>,
    ): Promise<ZKProof> => {
      if (generatingRef.current) {
        throw new Error('A proof is already being generated. Please wait.');
      }

      generatingRef.current = true;
      setState((prev) => ({
        ...prev,
        isGenerating: true,
        generationProgress: 0,
        error: null,
      }));

      try {
        const onProgress: ProofProgressCallback = (progress, _stage) => {
          setState((prev) => ({ ...prev, generationProgress: progress }));
        };

        const proof = await generateProof(
          circuitId,
          privateInputs,
          publicInputs,
          onProgress,
        );

        setState((prev) => ({
          ...prev,
          generatedProofs: [...prev.generatedProofs, proof],
          isGenerating: false,
          generationProgress: 100,
        }));

        return proof;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Proof generation failed';
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          generationProgress: 0,
          error: message,
        }));
        throw error;
      } finally {
        generatingRef.current = false;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Local Verification
  // -------------------------------------------------------------------------

  const verifyLocally = useCallback(
    async (proof: ZKProof): Promise<ProofVerification> => {
      try {
        const result = await verifyProofLocally(proof);

        setState((prev) => ({
          ...prev,
          verificationResults: [
            ...prev.verificationResults,
            {
              requestId: proof.id,
              verified: result.valid,
              proof,
              attributeResults: [],
              verifiedAt: result.verifiedAt,
              error: result.error,
            },
          ],
        }));

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Local verification failed';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Submit Proof to Backend
  // -------------------------------------------------------------------------

  const submitProof = useCallback(
    async (proof: ZKProof): Promise<ProofVerification> => {
      try {
        const result = await apiClient.submitProof(proof, '');

        setState((prev) => ({
          ...prev,
          verificationResults: [
            ...prev.verificationResults,
            {
              requestId: proof.id,
              verified: result.valid,
              proof,
              attributeResults: [],
              verifiedAt: result.verifiedAt,
              txHash: result.txHash,
              error: result.error,
            },
          ],
        }));

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Proof submission failed';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Fulfill a Proof Request
  // -------------------------------------------------------------------------

  const fulfillProofRequest = useCallback(
    async (
      requestId: string,
      privateInputs: Record<string, string>,
    ): Promise<VerificationResult> => {
      // Find the request
      const request = state.pendingRequests.find((r) => r.id === requestId);
      if (!request) {
        throw new Error(`Proof request not found: ${requestId}`);
      }

      // Generate the proof
      const proof = await generateZKProof(
        request.circuitId,
        privateInputs,
        request.publicInputs,
      );

      // Verify locally first
      const localResult = await verifyProofLocally(proof);
      if (!localResult.valid) {
        throw new Error(
          `Generated proof failed local verification: ${localResult.error || 'unknown reason'}`,
        );
      }

      // Submit to backend
      const result = await apiClient.respondToVerification(
        requestId,
        { consent: true, proof },
        '',
      );

      // Remove the fulfilled request from pending
      setState((prev) => ({
        ...prev,
        pendingRequests: prev.pendingRequests.filter((r) => r.id !== requestId),
        verificationResults: [...prev.verificationResults, result],
      }));

      return result;
    },
    [state.pendingRequests, generateZKProof],
  );

  // -------------------------------------------------------------------------
  // Utility Actions
  // -------------------------------------------------------------------------

  const dismissRequest = useCallback((requestId: string) => {
    setState((prev) => ({
      ...prev,
      pendingRequests: prev.pendingRequests.filter((r) => r.id !== requestId),
    }));
  }, []);

  const clearProofs = useCallback(() => {
    setState((prev) => ({
      ...prev,
      generatedProofs: [],
      verificationResults: [],
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // -------------------------------------------------------------------------
  // Memoised Context Value
  // -------------------------------------------------------------------------

  const value = useMemo<ProofContextValue>(
    () => ({
      proofState: state,
      generateZKProof,
      verifyLocally,
      submitProof,
      fulfillProofRequest,
      dismissRequest,
      refreshRequests,
      clearProofs,
      clearError,
    }),
    [
      state,
      generateZKProof,
      verifyLocally,
      submitProof,
      fulfillProofRequest,
      dismissRequest,
      refreshRequests,
      clearProofs,
      clearError,
    ],
  );

  return (
    <ProofContext.Provider value={value}>{children}</ProofContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Access the ProofContext. Must be used within a `<ProofProvider>`,
 * which itself must be inside an `<IdentityProvider>`.
 *
 * @throws If called outside of a ProofProvider
 */
export function useProofs(): ProofContextValue {
  const ctx = useContext(ProofContext);
  if (!ctx) {
    throw new Error('useProofs must be used within a <ProofProvider>');
  }
  return ctx;
}
