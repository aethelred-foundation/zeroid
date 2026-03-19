/**
 * Tests for ProofContext — provider and useProofs hook.
 *
 * Covers: generateZKProof, verifyLocally, submitProof, fulfillProofRequest,
 * dismissRequest, clearProofs, clearError, proof request polling, state
 * cleanup when identity is cleared, and the useProofs guard for missing provider.
 */

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ProofProvider, useProofs } from "@/contexts/ProofContext";
import { apiClient } from "@/lib/api/client";
import { generateProof } from "@/lib/zk/prover";
import { verifyProofLocally } from "@/lib/zk/verifier";
import type {
  ZKProof,
  ProofRequest,
  ProofVerification,
  VerificationResult,
  Bytes32,
  DID,
} from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock IdentityContext — ProofProvider calls useIdentity() internally
const mockIdentity = {
  identity: {
    profile: null as Record<string, unknown> | null,
    credentials: [],
    isLoading: false,
    isRegistered: false,
    error: null,
  },
  did: null as DID | null,
  registerIdentity: jest.fn(),
  refreshProfile: jest.fn(),
  refreshCredentials: jest.fn(),
  getCredential: jest.fn(),
  getCredentialsByStatus: jest.fn(),
  clearIdentity: jest.fn(),
};

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockIdentity,
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    listProofRequests: jest.fn(),
    submitProof: jest.fn(),
    respondToVerification: jest.fn(),
  },
}));

jest.mock("@/lib/zk/prover", () => ({
  generateProof: jest.fn(),
}));

jest.mock("@/lib/zk/verifier", () => ({
  verifyProofLocally: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockDID: DID = {
  uri: "did:aethelred:testnet:0xabc",
  identifier: "0xabc",
  hash: "0xdeadbeef00000000000000000000000000000000000000000000000000000001" as Bytes32,
  network: "testnet",
};

const mockCircuitId =
  "0xage0000000000000000000000000000000000000000000000000000000000001" as Bytes32;

const makeZKProof = (id = "proof-1"): ZKProof => ({
  id,
  circuitId: mockCircuitId,
  circuitName: "Age Proof",
  proofSystem: "groth16" as any,
  proof: {
    a: ["1", "2"],
    b: [
      ["3", "4"],
      ["5", "6"],
    ],
    c: ["7", "8"],
  },
  publicInputs: ["18", "1700000000"],
  publicOutputs: ["1", "1"],
  generatedAt: 1700000000,
  validityDuration: 86400,
  proofHash:
    "0xproof000000000000000000000000000000000000000000000000000000000001" as Bytes32,
});

const makeProofRequest = (id = "req-1"): ProofRequest => ({
  id,
  circuitId: mockCircuitId,
  circuitName: "Age Proof",
  publicInputs: { ageThresholdYears: "18", currentTimestamp: "1700000000" },
  verifierDid: mockDID,
  purpose: "Age verification",
  expiresAt: 1800000000,
  fulfilled: false,
  createdAt: 1700000000,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <ProofProvider>{children}</ProofProvider>;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  // Default: not registered
  mockIdentity.identity = {
    profile: null,
    credentials: [],
    isLoading: false,
    isRegistered: false,
    error: null,
  };
  mockIdentity.did = null;
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProofContext", () => {
  // =========================================================================
  // useProofs guard
  // =========================================================================

  describe("useProofs() outside provider", () => {
    it("throws when used without ProofProvider", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useProofs());
      }).toThrow("useProofs must be used within a <ProofProvider>");

      spy.mockRestore();
    });
  });

  // =========================================================================
  // Default state
  // =========================================================================

  describe("default state", () => {
    it("provides default proof state", () => {
      const { result } = renderHook(() => useProofs(), { wrapper });

      expect(result.current.proofState).toEqual({
        pendingRequests: [],
        generatedProofs: [],
        verificationResults: [],
        isGenerating: false,
        generationProgress: 0,
        error: null,
      });
    });
  });

  // =========================================================================
  // Proof request polling
  // =========================================================================

  describe("proof request polling", () => {
    it("polls for proof requests when registered", async () => {
      const requests = [makeProofRequest("req-1"), makeProofRequest("req-2")];
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue(requests);

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.proofState.pendingRequests).toEqual(requests);
      });

      // Reset and advance to trigger another poll
      (apiClient.listProofRequests as jest.Mock).mockClear();
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([]);

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      expect(apiClient.listProofRequests).toHaveBeenCalled();
    });

    it("does not poll when identity is not registered", async () => {
      mockIdentity.identity.isRegistered = false;
      mockIdentity.did = null;

      renderHook(() => useProofs(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect(apiClient.listProofRequests).not.toHaveBeenCalled();
    });

    it("silently handles poll errors", async () => {
      (apiClient.listProofRequests as jest.Mock).mockRejectedValue(
        new Error("Poll error"),
      );

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      // No error should be set from poll failures
      expect(result.current.proofState.error).toBeNull();
    });
  });

  // =========================================================================
  // State cleanup when identity is cleared
  // =========================================================================

  describe("state cleanup", () => {
    it("clears proof state when identity.isRegistered becomes false", async () => {
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([
        makeProofRequest(),
      ]);

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result, rerender } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      // Simulate identity cleared
      mockIdentity.identity.isRegistered = false;
      rerender();

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests).toEqual([]);
        expect(result.current.proofState.generatedProofs).toEqual([]);
        expect(result.current.proofState.verificationResults).toEqual([]);
      });
    });
  });

  // =========================================================================
  // generateZKProof
  // =========================================================================

  describe("generateZKProof", () => {
    it("generates a proof and updates state", async () => {
      const proof = makeZKProof();
      (generateProof as jest.Mock).mockResolvedValue(proof);

      const { result } = renderHook(() => useProofs(), { wrapper });

      let resolvedProof: ZKProof | undefined;
      await act(async () => {
        resolvedProof = await result.current.generateZKProof(
          mockCircuitId,
          { dateOfBirth: "946684800" },
          { ageThresholdYears: "18" },
        );
      });

      expect(resolvedProof).toEqual(proof);
      expect(result.current.proofState.generatedProofs).toContainEqual(proof);
      expect(result.current.proofState.isGenerating).toBe(false);
      expect(result.current.proofState.generationProgress).toBe(100);
    });

    it("sets error state on generation failure", async () => {
      (generateProof as jest.Mock).mockRejectedValue(
        new Error("Witness computation failed"),
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.generateZKProof(
            mockCircuitId,
            { dateOfBirth: "946684800" },
            { ageThresholdYears: "18" },
          );
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Witness computation failed");
      expect(result.current.proofState.isGenerating).toBe(false);
      expect(result.current.proofState.generationProgress).toBe(0);
      expect(result.current.proofState.error).toBe(
        "Witness computation failed",
      );
    });

    it("prevents concurrent proof generation", async () => {
      let resolveProof: (p: ZKProof) => void;
      (generateProof as jest.Mock).mockReturnValue(
        new Promise<ZKProof>((resolve) => {
          resolveProof = resolve;
        }),
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      // Start first generation (don't await)
      const firstGeneration = act(() =>
        result.current.generateZKProof(
          mockCircuitId,
          { dateOfBirth: "946684800" },
          { ageThresholdYears: "18" },
        ),
      );

      // Attempt second generation while first is in-flight
      await expect(
        act(() =>
          result.current.generateZKProof(
            mockCircuitId,
            { dateOfBirth: "946684800" },
            { ageThresholdYears: "18" },
          ),
        ),
      ).rejects.toThrow("A proof is already being generated");

      // Clean up
      await act(async () => {
        resolveProof!(makeZKProof());
      });
      await firstGeneration;
    });

    it("reports progress via onProgress callback in generateProof", async () => {
      (generateProof as jest.Mock).mockImplementation(
        async (_cid, _priv, _pub, onProgress) => {
          onProgress?.(50, "computing");
          return makeZKProof();
        },
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      await act(async () => {
        await result.current.generateZKProof(
          mockCircuitId,
          { dateOfBirth: "946684800" },
          { ageThresholdYears: "18" },
        );
      });

      // After completion, progress should be 100
      expect(result.current.proofState.generationProgress).toBe(100);
    });

    it("handles non-Error thrown values", async () => {
      (generateProof as jest.Mock).mockRejectedValue("string error");

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.generateZKProof(mockCircuitId, {}, {});
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBe("string error");
      expect(result.current.proofState.error).toBe("Proof generation failed");
    });
  });

  // =========================================================================
  // verifyLocally
  // =========================================================================

  describe("verifyLocally", () => {
    it("verifies proof locally and stores result", async () => {
      const proof = makeZKProof();
      const verificationResult: ProofVerification = {
        valid: true,
        proofHash: proof.proofHash,
        circuitId: proof.circuitId,
        verifiedAt: 1700000000,
      };

      (verifyProofLocally as jest.Mock).mockResolvedValue(verificationResult);

      const { result } = renderHook(() => useProofs(), { wrapper });

      let verification: ProofVerification | undefined;
      await act(async () => {
        verification = await result.current.verifyLocally(proof);
      });

      expect(verification).toEqual(verificationResult);
      expect(result.current.proofState.verificationResults.length).toBe(1);
      expect(result.current.proofState.verificationResults[0].verified).toBe(
        true,
      );
    });

    it("handles verification failure", async () => {
      const proof = makeZKProof();
      (verifyProofLocally as jest.Mock).mockRejectedValue(
        new Error("Verification module error"),
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.verifyLocally(proof);
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Verification module error");
      expect(result.current.proofState.error).toBe("Verification module error");
    });

    it("handles non-Error thrown values in local verify", async () => {
      const proof = makeZKProof();
      (verifyProofLocally as jest.Mock).mockRejectedValue(42);

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.verifyLocally(proof);
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBe(42);
      expect(result.current.proofState.error).toBe("Local verification failed");
    });
  });

  // =========================================================================
  // submitProof
  // =========================================================================

  describe("submitProof", () => {
    it("submits proof to backend and stores result", async () => {
      const proof = makeZKProof();
      const backendResult: ProofVerification = {
        valid: true,
        proofHash: proof.proofHash,
        circuitId: proof.circuitId,
        verifiedAt: 1700000000,
        txHash: "0xtx123",
      };

      (apiClient.submitProof as jest.Mock).mockResolvedValue(backendResult);

      const { result } = renderHook(() => useProofs(), { wrapper });

      let submission: ProofVerification | undefined;
      await act(async () => {
        submission = await result.current.submitProof(proof);
      });

      expect(submission).toEqual(backendResult);
      expect(result.current.proofState.verificationResults.length).toBe(1);
    });

    it("sets error on submission failure", async () => {
      const proof = makeZKProof();
      (apiClient.submitProof as jest.Mock).mockRejectedValue(
        new Error("Backend rejected proof"),
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.submitProof(proof);
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Backend rejected proof");
      expect(result.current.proofState.error).toBe("Backend rejected proof");
    });

    it("handles non-Error submission failure", async () => {
      const proof = makeZKProof();
      (apiClient.submitProof as jest.Mock).mockRejectedValue("network down");

      const { result } = renderHook(() => useProofs(), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.submitProof(proof);
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBe("network down");
      expect(result.current.proofState.error).toBe("Proof submission failed");
    });
  });

  // =========================================================================
  // fulfillProofRequest
  // =========================================================================

  describe("fulfillProofRequest", () => {
    it("generates proof, verifies locally, and submits response", async () => {
      const request = makeProofRequest("req-1");
      const proof = makeZKProof();
      const verifyResult: VerificationResult = {
        requestId: "req-1",
        verified: true,
        proof,
        attributeResults: [],
        verifiedAt: 1700000000,
      };

      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([request]);
      (generateProof as jest.Mock).mockResolvedValue(proof);
      (verifyProofLocally as jest.Mock).mockResolvedValue({ valid: true });
      (apiClient.respondToVerification as jest.Mock).mockResolvedValue(
        verifyResult,
      );

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      // Wait for requests to load
      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      let fulfillResult: VerificationResult | undefined;
      await act(async () => {
        fulfillResult = await result.current.fulfillProofRequest("req-1", {
          dateOfBirth: "946684800",
        });
      });

      expect(fulfillResult).toEqual(verifyResult);
      // Fulfilled request should be removed from pending
      expect(result.current.proofState.pendingRequests).toEqual([]);
    });

    it("throws when proof request is not found", async () => {
      const { result } = renderHook(() => useProofs(), { wrapper });

      await expect(
        act(() =>
          result.current.fulfillProofRequest("nonexistent", {
            dateOfBirth: "946684800",
          }),
        ),
      ).rejects.toThrow("Proof request not found: nonexistent");
    });

    it("throws when local verification fails", async () => {
      const request = makeProofRequest("req-1");
      const proof = makeZKProof();

      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([request]);
      (generateProof as jest.Mock).mockResolvedValue(proof);
      (verifyProofLocally as jest.Mock).mockResolvedValue({
        valid: false,
        error: "Invalid witness",
      });

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      await expect(
        act(() =>
          result.current.fulfillProofRequest("req-1", {
            dateOfBirth: "946684800",
          }),
        ),
      ).rejects.toThrow("Generated proof failed local verification");
    });

    it('uses "unknown reason" when local verification fails without error message', async () => {
      const request = makeProofRequest("req-2");
      const proof = makeZKProof();

      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([request]);
      (generateProof as jest.Mock).mockResolvedValue(proof);
      (verifyProofLocally as jest.Mock).mockResolvedValue({
        valid: false,
        // no error property
      });

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      await expect(
        act(() =>
          result.current.fulfillProofRequest("req-2", {
            dateOfBirth: "946684800",
          }),
        ),
      ).rejects.toThrow("unknown reason");
    });
  });

  // =========================================================================
  // dismissRequest
  // =========================================================================

  describe("dismissRequest", () => {
    it("removes a request from pending list", async () => {
      const requests = [makeProofRequest("req-1"), makeProofRequest("req-2")];
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue(requests);

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(2);
      });

      act(() => {
        result.current.dismissRequest("req-1");
      });

      expect(result.current.proofState.pendingRequests).toHaveLength(1);
      expect(result.current.proofState.pendingRequests[0].id).toBe("req-2");
    });

    it("is a no-op when request ID is not found", async () => {
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue([
        makeProofRequest("req-1"),
      ]);

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      act(() => {
        result.current.dismissRequest("nonexistent");
      });

      expect(result.current.proofState.pendingRequests).toHaveLength(1);
    });
  });

  // =========================================================================
  // clearProofs
  // =========================================================================

  describe("clearProofs", () => {
    it("clears generated proofs and verification results", async () => {
      const proof = makeZKProof();
      (generateProof as jest.Mock).mockResolvedValue(proof);

      const { result } = renderHook(() => useProofs(), { wrapper });

      await act(async () => {
        await result.current.generateZKProof(mockCircuitId, {}, {});
      });

      expect(result.current.proofState.generatedProofs.length).toBe(1);

      act(() => {
        result.current.clearProofs();
      });

      expect(result.current.proofState.generatedProofs).toEqual([]);
      expect(result.current.proofState.verificationResults).toEqual([]);
    });
  });

  // =========================================================================
  // clearError
  // =========================================================================

  describe("clearError", () => {
    it("clears the error from state", async () => {
      (generateProof as jest.Mock).mockRejectedValue(
        new Error("Something went wrong"),
      );

      const { result } = renderHook(() => useProofs(), { wrapper });

      await act(async () => {
        try {
          await result.current.generateZKProof(mockCircuitId, {}, {});
        } catch {
          // expected
        }
      });

      expect(result.current.proofState.error).toBe("Something went wrong");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.proofState.error).toBeNull();
    });
  });

  // =========================================================================
  // refreshRequests
  // =========================================================================

  describe("refreshRequests", () => {
    it("manually refreshes pending requests", async () => {
      const requests = [makeProofRequest("req-fresh")];
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue(requests);

      mockIdentity.identity.isRegistered = true;
      mockIdentity.did = mockDID;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await waitFor(() => {
        expect(result.current.proofState.pendingRequests.length).toBe(1);
      });

      const newRequests = [
        makeProofRequest("req-fresh"),
        makeProofRequest("req-fresh-2"),
      ];
      (apiClient.listProofRequests as jest.Mock).mockResolvedValue(newRequests);

      await act(() => result.current.refreshRequests());

      expect(result.current.proofState.pendingRequests).toEqual(newRequests);
    });

    it("does nothing when not registered", async () => {
      mockIdentity.identity.isRegistered = false;
      mockIdentity.did = null;

      const { result } = renderHook(() => useProofs(), { wrapper });

      await act(() => result.current.refreshRequests());

      expect(apiClient.listProofRequests).not.toHaveBeenCalled();
    });
  });
});
