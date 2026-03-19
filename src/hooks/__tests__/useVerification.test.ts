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
    it("creates a verification request and shows success toast", async () => {
      const response = { requestId: "vreq-0123456789ab" };
      (apiClient.post as jest.Mock).mockResolvedValue(response);

      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          subjectDid: "did:aethelred:testnet:0xsubject",
          requiredCredentials: ["schema-1"],
          requiredAttributes: ["fullName", "nationality"],
          purpose: "KYC verification",
          expiresIn: 86400,
        } as any);
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        "/v1/verification/request",
        expect.objectContaining({
          verifierAddress: mockAddress,
          subjectDid: "did:aethelred:testnet:0xsubject",
          requiredCredentials: ["schema-1"],
          requiredAttributes: ["fullName", "nationality"],
          purpose: "KYC verification",
          expiresIn: 86400,
        }),
      );

      expect(toast.success).toHaveBeenCalledWith(
        "Verification request created",
        { description: expect.stringContaining("vreq-0123456") },
      );
    });

    it("uses default expiresIn when not provided", async () => {
      const response = { requestId: "vreq-default" };
      (apiClient.post as jest.Mock).mockResolvedValue(response);

      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          subjectDid: "did:aethelred:testnet:0xsubject",
          requiredCredentials: ["schema-1"],
          requiredAttributes: ["fullName"],
          purpose: "Quick check",
        } as any);
      });

      const postArgs = (apiClient.post as jest.Mock).mock.calls[0][1];
      expect(postArgs.expiresIn).toBe(86400);
    });

    it("shows error toast on failure", async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(
        new Error("Rate limit exceeded"),
      );

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

      expect(toast.error).toHaveBeenCalledWith(
        "Failed to create verification request",
        { description: "Rate limit exceeded" },
      );
    });

    it("passes callbackUrl when provided", async () => {
      const response = { requestId: "vreq-callback" };
      (apiClient.post as jest.Mock).mockResolvedValue(response);

      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          subjectDid: "did:aethelred:testnet:0xsubject",
          requiredCredentials: [],
          requiredAttributes: [],
          purpose: "Test",
          callbackUrl: "https://example.com/callback",
        } as any);
      });

      const postArgs = (apiClient.post as jest.Mock).mock.calls[0][1];
      expect(postArgs.callbackUrl).toBe("https://example.com/callback");
    });
  });

  // =========================================================================
  // useRespondToVerification
  // =========================================================================

  describe("useRespondToVerification", () => {
    it("submits a verification response and shows success toast", async () => {
      const verificationResponse = {
        requestId: "vreq-1",
        status: "completed",
        verified: true,
      };
      (apiClient.post as jest.Mock).mockResolvedValue(verificationResponse);

      const { useRespondToVerification } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useRespondToVerification(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          requestId: "vreq-1",
          selectedAttributes: [{ key: "fullName", credentialHash: "0xcred1" }] as any,
          proofData: "0xzkproof_data",
        });
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        "/v1/verification/vreq-1/respond",
        expect.objectContaining({
          holderAddress: mockAddress,
          selectedAttributes: [{ key: "fullName", credentialHash: "0xcred1" }],
          zkProof: "0xzkproof_data",
        }),
      );

      expect(toast.success).toHaveBeenCalledWith(
        "Verification response submitted",
      );
    });

    it("shows error toast on response failure", async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(
        new Error("Proof expired"),
      );

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
        description: "Proof expired",
      });
    });
  });

  // =========================================================================
  // useSelectAttributes
  // =========================================================================

  describe("useSelectAttributes", () => {
    it("fetches verification request and matching user attributes", async () => {
      const verificationRequest = {
        id: "vreq-1",
        requiredCredentials: ["schema-1"],
        requestedAttributes: ["fullName", "nationality"],
        credentialHash: "schema-1",
      };
      const userAttributes = [
        { key: "fullName", value: "Alice", credentialHash: "0xcred1" },
        { key: "nationality", value: "US", credentialHash: "0xcred1" },
      ];

      (apiClient.get as jest.Mock)
        .mockResolvedValueOnce(verificationRequest)
        .mockResolvedValueOnce(userAttributes);

      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(result.current.data?.request).toEqual(verificationRequest);
      expect(result.current.data?.availableAttributes).toEqual(userAttributes);
      expect(result.current.data?.requiredAttributes).toEqual([
        "fullName",
        "nationality",
      ]);
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

    it("passes schemaIds to the credentials attributes endpoint", async () => {
      const verificationRequest = {
        id: "vreq-1",
        requiredCredentials: ["schema-a", "schema-b"],
        requiredAttributes: ["fullName"],
      };
      (apiClient.get as jest.Mock)
        .mockResolvedValueOnce(verificationRequest)
        .mockResolvedValueOnce([]);

      const { useSelectAttributes } = await import("@/hooks/useVerification");
      renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledTimes(2);
      });

      const secondCallUrl = (apiClient.get as jest.Mock).mock.calls[1][0];
      expect(secondCallUrl).toContain(
        `/v1/credentials/${mockAddress}/attributes`,
      );
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
        `/v1/verification/pending/${mockAddress}`,
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
      const historyResponse = {
        items: [
          { requestId: "vreq-1", verified: true, verifiedAt: 1700000000 },
        ],
        total: 1,
      };
      (apiClient.get as jest.Mock).mockResolvedValue(historyResponse);

      const { useVerificationHistory } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useVerificationHistory(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(historyResponse);
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain(`/v1/verification/history/${mockAddress}`);
      expect(url).toContain("page=1");
      expect(url).toContain("pageSize=20");
    });

    it("passes status filter to the query", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });

      const { useVerificationHistory } =
        await import("@/hooks/useVerification");
      renderHook(() => useVerificationHistory("completed" as any, 2, 10), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain("status=completed");
      expect(url).toContain("page=2");
      expect(url).toContain("pageSize=10");
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
        if (url.includes("/history/")) return Promise.resolve(historyResponse);
        if (url.includes("/pending/")) return Promise.resolve(pendingResponse);
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
        if (url.includes("/history/"))
          return Promise.resolve({ items: [], total: 0 });
        if (url.includes("/pending/")) return Promise.resolve([]);
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
