/**
 * Tests for useVerification hooks — creating verification requests,
 * responding to requests, selecting attributes, pending verifications,
 * verification history, and the convenience useVerification wrapper.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0xverifier000000000000000000000000000000001";

const mockUseAccount = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

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
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({ address: mockAddress });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVerification hooks", () => {
  // =========================================================================
  // useCreateVerificationRequest
  // =========================================================================

  describe("useCreateVerificationRequest", () => {
    it("fails closed instead of calling a stale request creation route", async () => {
      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            subjectDid: "did:aethelred:testnet:0xsubject",
            requiredCredentials: ["schema-1"],
            requiredAttributes: ["fullName", "nationality"],
            purpose: "KYC verification",
            expiresIn: 86400,
          } as any),
        ).rejects.toMatchObject({
          code: "VERIFICATION_REQUEST_CREATE_UNAVAILABLE",
          statusCode: 501,
        });
      });

      expect(apiClient.post).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to create verification request",
        {
          description: expect.stringContaining(
            "Verifier-created request inboxes are not exposed",
          ),
        },
      );
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("does not call the stale route even when optional fields are present", async () => {
      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            subjectDid: "did:aethelred:testnet:0xsubject",
            requiredCredentials: [],
            requiredAttributes: [],
            purpose: "Test",
          } as any);
        } catch {
          // Expected
        }
      });

      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useRespondToVerification
  // =========================================================================

  describe("useRespondToVerification", () => {
    it("fails closed instead of calling a stale response route", async () => {
      const { useRespondToVerification } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useRespondToVerification(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await expect(
          result.current.mutateAsync({
            requestId: "vreq-1",
            selectedAttributes: [
              { key: "fullName", credentialHash: "0xcred1" },
            ],
            proofData: "0xzkproof_data",
          }),
        ).rejects.toMatchObject({
          code: "VERIFICATION_REQUEST_RESPONSE_UNAVAILABLE",
          statusCode: 501,
        });
      });

      expect(apiClient.post).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Verification response failed", {
        description: expect.stringContaining(
          "Verification request responses are not exposed",
        ),
      });
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("rejects even when the proof payload is present", async () => {
      const { useRespondToVerification } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useRespondToVerification(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            requestId: "vreq-1",
            selectedAttributes: [],
            proofData: "0x",
          });
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Verification response failed", {
        description: expect.stringContaining(
          "Verification request responses are not exposed",
        ),
      });
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useSelectAttributes
  // =========================================================================

  describe("useSelectAttributes", () => {
    it("fails closed instead of calling stale request detail routes", async () => {
      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toMatchObject({
        code: "VERIFICATION_REQUEST_DETAIL_UNAVAILABLE",
        statusCode: 501,
      });
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("does not fetch when requestId is undefined", async () => {
      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes(undefined), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("does not fetch when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
    });

    it("does not call the stale credentials attributes endpoint", async () => {
      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // usePendingVerifications
  // =========================================================================

  describe("usePendingVerifications", () => {
    it("fetches pending verification requests for the address", async () => {
      const pending = [
        { id: "vreq-1", status: "pending" },
        { id: "vreq-2", status: "pending" },
      ];
      (apiClient.get as jest.Mock).mockResolvedValue(pending);

      const { usePendingVerifications } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => usePendingVerifications(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(pending);
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        "/api/v1/verification/history?result=PENDING&limit=100",
      );
    });

    it("does not fetch when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { usePendingVerifications } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => usePendingVerifications(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useVerificationHistory
  // =========================================================================

  describe("useVerificationHistory", () => {
    it("fetches verification history with default pagination", async () => {
      const historyItems = [
        { requestId: "vreq-1", verified: true, verifiedAt: 1700000000 },
      ];
      (apiClient.get as jest.Mock).mockResolvedValue(historyItems);

      const { useVerificationHistory } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerificationHistory(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({
          items: historyItems,
          total: 1,
        });
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain("/api/v1/verification/history");
      expect(url).toContain("page=1");
      expect(url).toContain("limit=20");
    });

    it("passes status filter to the query", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);

      const { useVerificationHistory } =
        await import("@/hooks/useVerification");
      renderHook(() => useVerificationHistory("completed" as any, 2, 10), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain("result=VERIFIED");
      expect(url).toContain("page=2");
      expect(url).toContain("limit=10");
    });

    it("does not fetch when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useVerificationHistory } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerificationHistory(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useVerification (convenience wrapper)
  // =========================================================================

  describe("useVerification", () => {
    it("combines history and pending data into a unified shape", async () => {
      const historyResponse = {
        items: [
          { requestId: "vreq-1", verified: true, verifiedAt: 1700000000 },
        ],
        total: 1,
      };
      const pendingResponse = [{ id: "vreq-2", status: "pending" }];

      (apiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes("result=PENDING")) return Promise.resolve(pendingResponse);
        if (url.includes("/api/v1/verification/history"))
          return Promise.resolve(historyResponse.items);
        return Promise.resolve({});
      });

      const { useVerification } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerification(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.verificationHistory).toHaveLength(1);
      });

      expect(result.current.verificationHistory).toEqual(historyResponse.items);
      expect(result.current.pendingRequests).toEqual(pendingResponse);
      expect(result.current.total).toBe(1);
    });

    it("returns empty arrays when data is not loaded", async () => {
      (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {}));

      const { useVerification } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerification(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.verificationHistory).toEqual([]);
      expect(result.current.pendingRequests).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.isLoading).toBe(true);
    });

    it("returns isLoading false when history has loaded", async () => {
      (apiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (url.includes("/api/v1/verification/history"))
          return Promise.resolve([]);
        return Promise.resolve({});
      });

      const { useVerification } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerification(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });
});
