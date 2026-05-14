/**
 * useCrossChain — Unit Tests
 *
 * Tests for cross-chain hooks: supported chains, bridge credential,
 * bridge status, bridged credentials, fee estimation, and cross-chain verification.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";
const mockWriteContractAsync = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
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
  ZeroIDApiError: class ZeroIDApiError extends Error {
    code: string;
    statusCode: number;

    constructor(message: string, code: string, statusCode: number) {
      super(message);
      this.name = "ZeroIDApiError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

jest.mock("@/config/constants", () => ({
  CONTRACT_ADDRESSES: {
    credentialRegistry: "0xContractAddress",
  },
}));

import { useAccount } from "wagmi";
import {
  useSupportedChains,
  useBridgeCredential,
  useBridgeStatus,
  useBridgedCredentials,
  useBridgeFeeEstimate,
  useVerifyBridgedCredential,
} from "@/hooks/useCrossChain";

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
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
});

// ===========================================================================
// useSupportedChains
// ===========================================================================

describe("useSupportedChains", () => {
  it("fails closed instead of calling a stale bridge chain route", async () => {
    const { result } = renderHook(() => useSupportedChains(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "BRIDGE_CHAIN_DISCOVERY_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useBridgeCredential
// ===========================================================================

describe("useBridgeCredential", () => {
  it("fails closed before submitting any bridge transaction", async () => {
    const { result } = renderHook(() => useBridgeCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          credentialId: "cred-1",
          destinationChainId: 137,
          priority: "standard" as const,
          preservePrivacy: true,
        }),
      ).rejects.toMatchObject({
        code: "BRIDGE_INITIATE_UNAVAILABLE",
        statusCode: 501,
      });
    });

    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Bridge initiation failed", {
      description: expect.stringContaining("not exposed"),
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("does not submit a transaction when recipientAddress is provided", async () => {
    const customRecipient = "0xCustomRecipient" as any;
    const { result } = renderHook(() => useBridgeCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          credentialId: "cred-1",
          destinationChainId: 137,
          recipientAddress: customRecipient,
          priority: "standard" as const,
          preservePrivacy: true,
        });
      } catch {
        // Expected
      }
    });

    expect(mockWriteContractAsync).not.toHaveBeenCalled();
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("shows error toast on failure", async () => {
    const { result } = renderHook(() => useBridgeCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          credentialId: "c",
          destinationChainId: 1,
          priority: "standard" as const,
          preservePrivacy: false,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Bridge initiation failed", {
      description: expect.stringContaining("not exposed"),
    });
    expect(mockWriteContractAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useBridgeStatus
// ===========================================================================

describe("useBridgeStatus", () => {
  it("fails closed instead of calling a stale status route", async () => {
    const { result } = renderHook(() => useBridgeStatus("bridge-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "BRIDGE_STATUS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when bridgeId is undefined", () => {
    const { result } = renderHook(() => useBridgeStatus(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("does not poll a stale in-progress bridge status route", async () => {
    const { result } = renderHook(() => useBridgeStatus("bridge-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useBridgedCredentials
// ===========================================================================

describe("useBridgedCredentials", () => {
  it("fails closed instead of calling a stale bridged credentials route", async () => {
    const { result } = renderHook(() => useBridgedCredentials(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "BRIDGE_CREDENTIALS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useBridgedCredentials(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useBridgeFeeEstimate
// ===========================================================================

describe("useBridgeFeeEstimate", () => {
  it("fails closed instead of calling a stale fee estimate route", async () => {
    const { result } = renderHook(() => useBridgeFeeEstimate("c-1", 137), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "BRIDGE_FEE_ESTIMATE_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when credentialId is undefined", () => {
    const { result } = renderHook(() => useBridgeFeeEstimate(undefined, 137), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when destinationChainId is undefined", () => {
    const { result } = renderHook(
      () => useBridgeFeeEstimate("c-1", undefined),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useVerifyBridgedCredential
// ===========================================================================

describe("useVerifyBridgedCredential", () => {
  it("fails closed instead of calling a stale bridge verification route", async () => {
    const { result } = renderHook(() => useVerifyBridgedCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ credentialId: "c-1", chainId: 137 }),
      ).rejects.toMatchObject({
        code: "BRIDGE_VERIFY_UNAVAILABLE",
        statusCode: 501,
      });
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Cross-chain verification failed",
      { description: expect.stringContaining("not exposed") },
    );
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("does not treat unsupported verification as a negative credential result", async () => {
    const { result } = renderHook(() => useVerifyBridgedCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ credentialId: "c-1", chainId: 137 });
      } catch {
        // Expected
      }
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Cross-chain verification failed",
      { description: expect.stringContaining("not exposed") },
    );
  });

  it("shows error toast on unsupported verification", async () => {
    const { result } = renderHook(() => useVerifyBridgedCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ credentialId: "c", chainId: 1 });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Cross-chain verification failed",
      { description: expect.stringContaining("not exposed") },
    );
  });
});
