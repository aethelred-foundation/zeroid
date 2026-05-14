/**
 * useTEEAttestation — Unit Tests
 *
 * Tests for TEE attestation hooks: attestation status, verify attestation,
 * TEE nodes, node health, and network status.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("wagmi", () => ({
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
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
  TEE_REGISTRY_ADDRESS: "0xTEERegistry",
  TEE_REGISTRY_ABI: [],
}));

import { useReadContract } from "wagmi";
import {
  useAttestationStatus,
  useVerifyAttestation,
  useTEENodes,
  useNodeHealth,
  useTEENetworkStatus,
} from "@/hooks/useTEEAttestation";

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

beforeEach(() => {
  jest.clearAllMocks();
  (useReadContract as jest.Mock).mockReturnValue({
    data: undefined,
    isLoading: false,
  });
});

// ===========================================================================
// useAttestationStatus
// ===========================================================================

describe("useAttestationStatus", () => {
  it("does not call an unsupported attestation lookup API", () => {
    const { result } = renderHook(() => useAttestationStatus("enc-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("returns isAttested=true when on-chain status is verified", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: "verified",
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus("enc-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(true);
    expect(result.current.isExpired).toBe(false);
  });

  it("returns isExpired=true when on-chain status is expired", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: "expired",
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus("enc-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(false);
    expect(result.current.isExpired).toBe(true);
  });

  it("returns isAttested=false when no on-chain data", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus("enc-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(false);
  });

  it("does not fetch when enclaveId is undefined", () => {
    const { result } = renderHook(() => useAttestationStatus(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useVerifyAttestation
// ===========================================================================

describe("useVerifyAttestation", () => {
  it("shows success toast when attestation is valid", async () => {
    mockApiClient.post.mockResolvedValueOnce({
      challenge: "server-issued-challenge-with-minimum-length",
      reportData: "0xreportdata",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    mockApiClient.post.mockResolvedValueOnce({
      verified: true,
      attestationId: "enc-001-abcdefgh12345678",
    });
    const { result } = renderHook(() => useVerifyAttestation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        quote: "0xquote",
        expectedMrEnclave: "0xmrenc",
        expectedMrSigner: "0xmrsig",
        nonce: "0xnonce",
      } as any);
    });

    expect(mockApiClient.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/verification/tee-challenge",
      {},
    );
    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/verification/tee-attest",
      expect.objectContaining({
        enclaveType: "SGX",
        quote: "0xquote",
        challenge: "server-issued-challenge-with-minimum-length",
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith("Attestation verified", {
      description: expect.stringContaining("enc-001-abcdefgh"),
    });
  });

  it("shows error toast when attestation is invalid", async () => {
    mockApiClient.post.mockResolvedValueOnce({
      challenge: "server-issued-challenge-with-minimum-length",
      reportData: "0xreportdata",
      expiresAt: "2026-01-01T00:05:00Z",
    });
    mockApiClient.post.mockResolvedValueOnce({
      verified: false,
      attestationId: "enc-1",
    });
    const { result } = renderHook(() => useVerifyAttestation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        quote: "0x",
        expectedMrEnclave: "0x",
        expectedMrSigner: "0x",
        nonce: "0x",
      } as any);
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Attestation verification failed",
      {
        description: "The enclave could not be verified against root of trust",
      },
    );
  });

  it("shows error toast on network failure", async () => {
    mockApiClient.post.mockRejectedValueOnce(new Error("Connection refused"));
    const { result } = renderHook(() => useVerifyAttestation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          quote: "0x",
          expectedMrEnclave: "0x",
          expectedMrSigner: "0x",
          nonce: "0x",
        } as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Attestation verification error",
      { description: "Connection refused" },
    );
  });
});

// ===========================================================================
// useTEENodes
// ===========================================================================

describe("useTEENodes", () => {
  it("fails closed because node discovery is not exposed", async () => {
    const { result } = renderHook(() => useTEENodes(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("node discovery");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("uses a distinct query key when activeOnly=false", async () => {
    const { result } = renderHook(() => useTEENodes(false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useNodeHealth
// ===========================================================================

describe("useNodeHealth", () => {
  it("fails closed because node health is not exposed", async () => {
    const { result } = renderHook(() => useNodeHealth("n-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("node health");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when nodeId is undefined", () => {
    const { result } = renderHook(() => useNodeHealth(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useTEENetworkStatus
// ===========================================================================

describe("useTEENetworkStatus", () => {
  it("fails closed because network status is not exposed", async () => {
    const { result } = renderHook(() => useTEENetworkStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("network status");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});
