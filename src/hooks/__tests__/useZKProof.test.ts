/**
 * useZKProof — Unit Tests
 *
 * Tests for ZK proof hooks: proof generation, on-chain verification,
 * cancellation, progress tracking, and proof history.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";
const mockReadContract = jest.fn();
const mockWriteContractAsync = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
  usePublicClient: jest.fn(() => ({ readContract: mockReadContract })),
  useWriteContract: jest.fn(() => ({
    writeContractAsync: mockWriteContractAsync,
  })),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
const mockToast = jest.requireMock("sonner").toast;

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

jest.mock("@/config/constants", () => ({
  ZK_VERIFIER_ADDRESS: "0xZKVerifier",
  ZK_VERIFIER_ABI: [],
  ZK_CIRCUIT_BASE_URL: "https://circuits.example.com",
}));

// Mock snarkjs
jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: jest.fn().mockResolvedValue({
      proof: {
        pi_a: [1, 2],
        pi_b: [
          [3, 4],
          [5, 6],
        ],
        pi_c: [7, 8],
      },
      publicSignals: ["42"],
    }),
    exportSolidityCallData: jest
      .fn()
      .mockResolvedValue(
        '["0x1","0x2"],[["0x3","0x4"],["0x5","0x6"]],["0x7","0x8"],["42"]',
      ),
  },
}));

// Mock fetch for WASM and zkey loading
const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

import { useAccount } from "wagmi";
import { useZKProof, useProofHistory } from "@/hooks/useZKProof";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const circuitId = `0x${"1".repeat(64)}` as const;

function makeProof() {
  return {
    id: "proof-1",
    circuitId,
    circuitName: "age_check",
    proofSystem: "groth16",
    proof: {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    },
    publicInputs: ["42"],
    publicOutputs: [],
    generatedAt: Math.floor(Date.now() / 1000),
    validityDuration: 0,
    proofHash: `0x${"2".repeat(64)}`,
    circuitType: "age_check",
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
  mockApiClient.get.mockResolvedValue([]);
  mockReadContract.mockResolvedValue(true);
  mockFetch.mockResolvedValue({
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  });
});

// ===========================================================================
// useZKProof
// ===========================================================================

describe("useZKProof", () => {
  it("exposes all expected properties", () => {
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current.generateProof).toBe("function");
    expect(typeof result.current.verifyProof).toBe("function");
    expect(typeof result.current.cancelGeneration).toBe("function");
    expect(result.current.isVerifying).toBe(false);
    expect(result.current.progress).toEqual({ stage: "idle", percent: 0 });
    expect(result.current.proofHistory).toEqual([]);
  });

  it("generates a proof successfully", async () => {
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    let proof: any;
    await act(async () => {
      proof = await result.current.generateProof(
        "age_check" as any,
        { age: 25 } as any,
      );
    });

    expect(proof).toEqual(
      expect.objectContaining({
        circuitType: "age_check",
        proof: expect.any(Object),
        publicSignals: ["42"],
      }),
    );
    expect(result.current.progress.stage).toBe("done");
    expect(result.current.progress.percent).toBe(100);
    expect(mockToast.success).toHaveBeenCalledWith(
      "Proof generated successfully",
    );
  });

  it("fetches WASM and zkey from circuit URL", async () => {
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.generateProof("age_check" as any, {} as any);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://circuits.example.com/age_check/age_check.wasm",
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://circuits.example.com/age_check/age_check.zkey",
      expect.any(Object),
    );
  });

  it("sets error progress and shows toast on generation failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.generateProof("age_check" as any, {} as any);
      } catch {}
    });

    expect(result.current.progress.stage).toBe("error");
    expect(result.current.progress.percent).toBe(0);
    expect(mockToast.error).toHaveBeenCalledWith("Proof generation failed", {
      description: "Network error",
    });
  });

  it("does not show toast on AbortError", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.generateProof("age_check" as any, {} as any);
      } catch {}
    });

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("cancelGeneration resets progress to idle", async () => {
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.cancelGeneration();
    });

    expect(result.current.progress).toEqual({ stage: "idle", percent: 0 });
  });
});

// ===========================================================================
// useProofHistory
// ===========================================================================

describe("useProofHistory", () => {
  it("fetches proof history for address", async () => {
    const mockHistory = [
      {
        id: "p-1",
        circuitType: "age_check",
        verifiedAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockApiClient.get.mockResolvedValue(mockHistory);
    const { result } = renderHook(() => useProofHistory(mockAddress), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/verification/history?type=ZK_PROOF",
    );
    expect(result.current.data).toEqual(mockHistory);
  });

  it("is disabled when address is undefined", () => {
    const { result } = renderHook(() => useProofHistory(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// verifyProof (on-chain via mutation)
// ===========================================================================

describe("verifyProof (on-chain)", () => {
  it("maps the circuit, proof tuple, and public inputs into a read-only call", async () => {
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    let isValid: boolean | undefined;
    await act(async () => {
      isValid = await result.current.verifyProof(makeProof());
    });

    expect(isValid).toBe(true);
    expect(mockReadContract).toHaveBeenCalledWith({
      address: "0xZKVerifier",
      abi: [],
      functionName: "verifyProof",
      args: [
        circuitId,
        {
          a: [1n, 2n],
          b: [
            [3n, 4n],
            [5n, 6n],
          ],
          c: [7n, 8n],
        },
        [42n],
      ],
    });
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("Proof verified on-chain");
  });

  it("returns false and never reports success when the verifier rejects a proof", async () => {
    mockReadContract.mockResolvedValue(false);
    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    let isValid: boolean | undefined;
    await act(async () => {
      isValid = await result.current.verifyProof(makeProof());
    });

    expect(isValid).toBe(false);
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalledWith(
      "Proof verified on-chain",
    );
    expect(mockToast.error).toHaveBeenCalledWith(
      "On-chain verification failed",
      { description: "The verifier contract returned false." },
    );
  });

  it("shows error toast on verification failure", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC unavailable"));

    const { result } = renderHook(() => useZKProof(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.verifyProof(makeProof());
      } catch {}
    });

    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "On-chain verification failed",
      { description: "RPC unavailable" },
    );
  });
});
