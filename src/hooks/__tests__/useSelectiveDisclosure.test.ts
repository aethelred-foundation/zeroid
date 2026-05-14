/**
 * useSelectiveDisclosure — Unit Tests
 *
 * Tests for selective disclosure hooks: create request, build response,
 * pending disclosures, request detail, and history.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
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

import { useAccount } from "wagmi";
import {
  useCreateDisclosureRequest,
  useBuildDisclosureResponse,
  usePendingDisclosures,
  useDisclosureRequest,
  useDisclosureHistory,
} from "@/hooks/useSelectiveDisclosure";

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
// useCreateDisclosureRequest
// ===========================================================================

describe("useCreateDisclosureRequest", () => {
  it("fails closed instead of calling a stale disclosure request route", async () => {
    const { result } = renderHook(() => useCreateDisclosureRequest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          subjectDid: "did:aethelred:mainnet:0x1",
          requestedAttributes: [{ key: "name", required: true }] as any,
          policy: { minTrustLevel: 3 } as any,
          purpose: "KYC verification",
        }),
      ).rejects.toMatchObject({
        code: "DISCLOSURE_REQUEST_CREATE_UNAVAILABLE",
        statusCode: 501,
      });
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to create disclosure request",
      {
        description: expect.stringContaining(
          "Selective disclosure request creation is not exposed",
        ),
      },
    );
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("does not call the stale route when optional fields are present", async () => {
    const { result } = renderHook(() => useCreateDisclosureRequest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          subjectDid: "did:x",
          requestedAttributes: [],
          policy: {} as any,
          purpose: "test",
          expiresIn: 7200,
        });
      } catch {}
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useBuildDisclosureResponse
// ===========================================================================

describe("useBuildDisclosureResponse", () => {
  it("fails closed instead of calling a stale disclosure response route", async () => {
    const { result } = renderHook(() => useBuildDisclosureResponse(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          requestId: "req-1",
          selectedAttributes: [{ key: "name" }] as any,
          credentialIds: ["cred-1"],
          zkProof: "0xproof",
        }),
      ).rejects.toMatchObject({
        code: "DISCLOSURE_RESPONSE_UNAVAILABLE",
        statusCode: 501,
      });
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Disclosure response failed", {
      description: expect.stringContaining(
        "Selective disclosure responses are not exposed",
      ),
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("rejects even when a proof payload is present", async () => {
    const { result } = renderHook(() => useBuildDisclosureResponse(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          requestId: "req-1",
          selectedAttributes: [],
          credentialIds: [],
          zkProof: "",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Disclosure response failed", {
      description: expect.stringContaining(
        "Selective disclosure responses are not exposed",
      ),
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// usePendingDisclosures
// ===========================================================================

describe("usePendingDisclosures", () => {
  it("fails closed instead of calling a stale pending route", async () => {
    const { result } = renderHook(() => usePendingDisclosures(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "DISCLOSURE_PENDING_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => usePendingDisclosures(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useDisclosureRequest
// ===========================================================================

describe("useDisclosureRequest", () => {
  it("fails closed instead of calling a stale detail route", async () => {
    const { result } = renderHook(() => useDisclosureRequest("req-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "DISCLOSURE_DETAIL_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when requestId is undefined", () => {
    const { result } = renderHook(() => useDisclosureRequest(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useDisclosureHistory
// ===========================================================================

describe("useDisclosureHistory", () => {
  it("fails closed instead of calling a stale history route", async () => {
    const { result } = renderHook(() => useDisclosureHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "DISCLOSURE_HISTORY_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("does not call the stale route with custom pagination", async () => {
    const { result } = renderHook(() => useDisclosureHistory(3, 50), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useDisclosureHistory(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
