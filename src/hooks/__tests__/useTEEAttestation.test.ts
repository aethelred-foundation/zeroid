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
    getAttestation: jest.fn(),
    listTEENodes: jest.fn(),
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

jest.mock("@/lib/tee/attestation", () => ({
  getPlatformLabel: jest.fn((platform: number) =>
    platform === 1 ? "Intel SGX" : "Unknown",
  ),
  selectBestNode: jest.fn((nodes: any[]) =>
    nodes.find((node) => node.isOnline && node.attestation.isValid) ?? null,
  ),
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

const enclaveHash =
  `0x${"a".repeat(64)}` as `0x${string}`;

function makeNode(overrides: Record<string, any> = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  return {
    id: "n-1",
    operator: "0x0000000000000000000000000000000000000001",
    platform: 1,
    name: "SGX UAE Primary",
    region: "UAE-AbuDhabi",
    isOnline: true,
    uptimePercent: 99.98,
    verificationsProcessed: 1200,
    avgLatencyMs: 84,
    attestation: {
      enclaveHash,
      platform: 1,
      attestedAt: expiresAt - 600,
      expiresAt,
      reportDataHash: `0x${"b".repeat(64)}`,
      nodeOperator: "0x0000000000000000000000000000000000000001",
      isValid: true,
      attestationType: "remote",
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useReadContract as jest.Mock).mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockApiClient.getAttestation.mockResolvedValue({
    isValid: false,
    expiresAt: Math.floor(Date.now() / 1000) + 3_600,
  });
});

// ===========================================================================
// useAttestationStatus
// ===========================================================================

describe("useAttestationStatus", () => {
  it("enriches valid enclave hashes from the TEE attestation service", async () => {
    mockApiClient.getAttestation.mockResolvedValue({
      ...makeNode().attestation,
      isValid: true,
    });

    const { result } = renderHook(() => useAttestationStatus(enclaveHash), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "isAttestationValid",
        args: [enclaveHash],
      }),
    );
    expect(mockApiClient.getAttestation).toHaveBeenCalledWith(enclaveHash);
    expect(result.current.isAttested).toBe(true);
  });

  it("returns isAttested=true when the on-chain validity check returns true", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: true,
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus(enclaveHash), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(true);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.onChainStatus).toBe(true);
  });

  it("returns isAttested=false when the on-chain validity check returns false", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: false,
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus(enclaveHash), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(false);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.onChainStatus).toBe(false);
  });

  it("returns isAttested=false when no on-chain data", () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    const { result } = renderHook(() => useAttestationStatus(enclaveHash), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAttested).toBe(false);
  });

  it("does not fetch when enclaveId is undefined", () => {
    const { result } = renderHook(() => useAttestationStatus(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.getAttestation).not.toHaveBeenCalled();
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
  it("loads active attested TEE nodes through the API client", async () => {
    const expiredNode = makeNode({
      id: "expired",
      attestation: {
        ...makeNode().attestation,
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      },
    });
    mockApiClient.listTEENodes.mockResolvedValue([
      makeNode(),
      makeNode({ id: "offline", isOnline: false }),
      expiredNode,
    ]);

    const { result } = renderHook(() => useTEENodes(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe("n-1");
    expect(mockApiClient.listTEENodes).toHaveBeenCalledTimes(1);
  });

  it("returns the full discovered fleet when activeOnly=false", async () => {
    mockApiClient.listTEENodes.mockResolvedValue([
      makeNode(),
      makeNode({ id: "offline", isOnline: false }),
    ]);

    const { result } = renderHook(() => useTEENodes(false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });
});

// ===========================================================================
// useNodeHealth
// ===========================================================================

describe("useNodeHealth", () => {
  it("derives node health from live TEE discovery", async () => {
    mockApiClient.listTEENodes.mockResolvedValue([makeNode()]);

    const { result } = renderHook(() => useNodeHealth("n-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      id: "n-1",
      type: "Intel SGX",
      status: "active",
      health: "healthy",
      uptime: 99.98,
      region: "UAE-AbuDhabi",
    });
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
  it("summarizes the discovered TEE network", async () => {
    mockApiClient.listTEENodes.mockResolvedValue([
      makeNode(),
      makeNode({ id: "degraded", uptimePercent: 91 }),
      makeNode({ id: "offline", isOnline: false }),
    ]);

    const { result } = renderHook(() => useTEENetworkStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      status: "degraded",
      totalNodes: 3,
      onlineNodes: 2,
      healthyNodes: 1,
      degradedNodes: 1,
      offlineNodes: 1,
      totalVerificationsProcessed: 3600,
    });
  });
});
