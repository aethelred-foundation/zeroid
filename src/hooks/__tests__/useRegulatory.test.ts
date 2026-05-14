/**
 * useRegulatory — Unit Tests
 *
 * Tests for regulatory hooks: jurisdictions, requirements, compliance status,
 * cross-border assessment, gap analysis, regulatory feed, and data sovereignty.
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
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
  ZeroIDApiError: class ZeroIDApiError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status: number) {
      super(message);
      this.name = "ZeroIDApiError";
      this.code = code;
      this.status = status;
    }
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

import { useAccount } from "wagmi";
import {
  useJurisdictions,
  useJurisdictionRequirements,
  useComplianceStatus,
  useCheckCrossBorder,
  useGapAnalysis,
  useRegulatoryFeed,
  useDataSovereigntyStatus,
} from "@/hooks/useRegulatory";

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
// useJurisdictions
// ===========================================================================

describe("useJurisdictions", () => {
  const mockJurisdictions = [
    {
      id: "uae",
      name: "United Arab Emirates",
      code: "AE",
      region: "mena",
      isActive: true,
    },
  ];

  it("fetches jurisdictions", async () => {
    mockApiClient.get.mockResolvedValue(mockJurisdictions);
    const { result } = renderHook(() => useJurisdictions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/jurisdictions",
    );
    expect(result.current.data).toEqual(mockJurisdictions);
  });
});

// ===========================================================================
// useJurisdictionRequirements
// ===========================================================================

describe("useJurisdictionRequirements", () => {
  it("fails closed because detailed requirements are not exposed", async () => {
    const { result } = renderHook(
      () => useJurisdictionRequirements("AE-CBUAE"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      code: "REGULATORY_REQUIREMENTS_UNAVAILABLE",
      status: 501,
    });
  });

  it("is disabled when jurisdictionId is undefined", () => {
    const { result } = renderHook(
      () => useJurisdictionRequirements(undefined),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useComplianceStatus
// ===========================================================================

describe("useComplianceStatus", () => {
  const mockStatus = {
    jurisdictionId: "AE-CBUAE",
    jurisdictionName: "UAE",
    overallStatus: "compliant",
    score: 95,
    credentialStatus: [],
    lastAssessedAt: "2026-01-01T00:00:00Z",
    nextAssessmentAt: "2026-04-01T00:00:00Z",
    blockers: [],
  };

  it("fetches compliance status for jurisdiction and address", async () => {
    mockApiClient.get.mockResolvedValue(mockStatus);
    const { result } = renderHook(() => useComplianceStatus("AE-CBUAE"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      `/api/v1/enterprise/compliance/status/${mockAddress}`,
      { jurisdiction: "AE-CBUAE" },
    );
  });

  it("is disabled when jurisdictionId is undefined", () => {
    const { result } = renderHook(() => useComplianceStatus(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useComplianceStatus("AE-CBUAE"), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useCheckCrossBorder
// ===========================================================================

describe("useCheckCrossBorder", () => {
  it("shows success toast when eligible", async () => {
    mockApiClient.post.mockResolvedValue({
      allowed: true,
      riskLevel: "low",
      restrictions: [],
      requirements: [],
      mutualRecognitionAgreements: ["UAE-EU MRA"],
    });
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromJurisdiction: "AE-CBUAE",
        toJurisdiction: "EU-GDPR",
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/cross-border",
      {
        sourceJurisdiction: "AE-CBUAE",
        targetJurisdiction: "EU-GDPR",
        entityId: "current-subject",
        dataCategories: ["personal"],
        purpose: "identity_verification",
      },
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "Cross-border transfer eligible",
      {
        description: expect.stringContaining("low"),
      },
    );
  });

  it("shows warning toast when not eligible", async () => {
    mockApiClient.post.mockResolvedValue({
      allowed: false,
      riskLevel: "prohibited",
      restrictions: ["Sanctions apply", "No bilateral agreement"],
    });
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromJurisdiction: "AE-CBUAE",
        toJurisdiction: "RESTRICTED",
      });
    });

    expect(mockToast.warning).toHaveBeenCalledWith(
      "Cross-border transfer not eligible",
      {
        description: "2 restriction(s) apply",
      },
    );
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Service down"));
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          fromJurisdiction: "a",
          toJurisdiction: "b",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Cross-border check failed", {
      description: "Service down",
    });
  });
});

// ===========================================================================
// useGapAnalysis
// ===========================================================================

describe("useGapAnalysis", () => {
  it("fails closed because gap analysis is not exposed", async () => {
    const { result } = renderHook(() => useGapAnalysis("AE-CBUAE"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      code: "REGULATORY_GAP_ANALYSIS_UNAVAILABLE",
      status: 501,
    });
  });

  it("is disabled when jurisdictionId is undefined", () => {
    const { result } = renderHook(() => useGapAnalysis(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useGapAnalysis("AE-CBUAE"), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useRegulatoryFeed
// ===========================================================================

describe("useRegulatoryFeed", () => {
  it("fails closed because the change feed is not exposed", async () => {
    const { result } = renderHook(() => useRegulatoryFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      code: "REGULATORY_FEED_UNAVAILABLE",
      status: 501,
    });
  });
});

// ===========================================================================
// useDataSovereigntyStatus
// ===========================================================================

describe("useDataSovereigntyStatus", () => {
  it("fails closed because sovereignty status is not exposed", async () => {
    const { result } = renderHook(() => useDataSovereigntyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiClient.get).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      code: "REGULATORY_DATA_SOVEREIGNTY_UNAVAILABLE",
      status: 501,
    });
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useDataSovereigntyStatus(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
