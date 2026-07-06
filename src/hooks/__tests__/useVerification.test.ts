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
    createVerificationRequest: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    respondToVerification: jest.fn(),
  },
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(() => "identity-token"),
}));
const mockGetIdentityAuthToken = jest.requireMock(
  "@/lib/identity/registration",
).getIdentityAuthToken;

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

function makeProof() {
  return {
    id: "proof-1",
    circuitId: "0xcircuit",
    circuitName: "selective_disclosure",
    proofSystem: "groth16",
    proof: {
      a: ["0x1", "0x2"],
      b: [
        ["0x3", "0x4"],
        ["0x5", "0x6"],
      ],
      c: ["0x7", "0x8"],
    },
    publicInputs: ["0x1"],
    publicOutputs: ["0x1"],
    generatedAt: 1700000000,
    validityDuration: 300,
    proofHash: "0xproofhash",
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdentityAuthToken.mockReturnValue("identity-token");
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
    it("creates a durable backend verification request", async () => {
      (apiClient.createVerificationRequest as jest.Mock).mockResolvedValue({
        id: "vreq-1",
      });
      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      let created: { requestId: string } | undefined;
      await act(async () => {
        created = await result.current.mutateAsync({
          subjectDid: "did:aethelred:testnet:0xsubject",
          credentialHash: "0xcredential",
          circuitId: "selective_disclosure",
          requestedAttributes: ["fullName", "nationality"],
          purpose: "KYC verification",
          expiresIn: 86400,
        } as any);
      });

      expect(created).toEqual({ requestId: "vreq-1" });
      expect(apiClient.createVerificationRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectDid: "did:aethelred:testnet:0xsubject",
          credentialHash: "0xcredential",
          circuitId: "selective_disclosure",
          requestedAttributes: ["fullName", "nationality"],
          purpose: "KYC verification",
        }),
        "identity-token",
      );
      expect(toast.success).toHaveBeenCalledWith(
        "Verification request created",
        { description: expect.stringContaining("vreq-1") },
      );
    });

    it("fails before calling the backend when auth is unavailable", async () => {
      mockGetIdentityAuthToken.mockReturnValue(undefined);
      const { useCreateVerificationRequest } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useCreateVerificationRequest(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            subjectDid: "did:aethelred:testnet:0xsubject",
            credentialHash: "0xcredential",
            requestedAttributes: ["fullName"],
          } as any);
        } catch {
          // Expected
        }
      });

      expect(apiClient.createVerificationRequest).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to create verification request",
        {
          description:
            "An authenticated ZeroID identity session is required.",
        },
      );
    });
  });

  // =========================================================================
  // useRespondToVerification
  // =========================================================================

  describe("useRespondToVerification", () => {
    it("submits generated proof responses through the API client", async () => {
      (apiClient.respondToVerification as jest.Mock).mockResolvedValue({
        requestId: "vreq-1",
        verified: true,
        attributeResults: [],
        verifiedAt: 1700000000,
      });
      const { useRespondToVerification } =
        await import("@/hooks/useVerification");
      const { result } = renderHook(() => useRespondToVerification(), {
        wrapper: createQueryWrapper(),
      });

      let response: any;
      await act(async () => {
        response = await result.current.mutateAsync({
          requestId: "vreq-1",
          selectedAttributes: [{ key: "fullName", value: "Ada" }],
          proofData: JSON.stringify(makeProof()),
        });
      });

      expect(response.verified).toBe(true);
      expect(apiClient.respondToVerification).toHaveBeenCalledWith(
        "vreq-1",
        {
          consent: true,
          proof: expect.objectContaining({ id: "proof-1" }),
        },
        "identity-token",
      );
      expect(toast.success).toHaveBeenCalledWith(
        "Verification response submitted",
      );
    });

    it("rejects malformed proof data before calling the backend", async () => {
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
        description:
          "Verification response requires a generated ZK proof JSON payload.",
      });
      expect(apiClient.respondToVerification).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useSelectAttributes
  // =========================================================================

  describe("useSelectAttributes", () => {
    it("loads request detail from pending verification requests", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([
        {
          id: "vreq-1",
          requestedAttributes: ["fullName", "nationality"],
          requiredAttributes: ["fullName", "nationality"],
        },
      ]);
      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toMatchObject({
        request: { id: "vreq-1" },
        availableAttributes: [{ key: "fullName" }, { key: "nationality" }],
      });
      expect(apiClient.get).toHaveBeenCalledWith(
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
      );
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

    it("fails when the request is not in the pending inbox", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);
      const { useSelectAttributes } = await import("@/hooks/useVerification");
      const { result } = renderHook(() => useSelectAttributes("vreq-1"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(String(result.current.error)).toContain(
        "Verification request vreq-1 was not found",
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
        "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
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
        if (url.includes("result=PENDING"))
          return Promise.resolve(pendingResponse);
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
