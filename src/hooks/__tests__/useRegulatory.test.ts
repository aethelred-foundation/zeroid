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
      "/api/v1/regulatory/jurisdictions",
    );
    expect(result.current.data).toEqual(mockJurisdictions);
  });
});

// ===========================================================================
// useJurisdictionRequirements
// ===========================================================================

describe("useJurisdictionRequirements", () => {
  const mockReqs = {
    jurisdictionId: "uae",
    requiredCredentials: [],
    dataRetentionDays: 365,
    consentRequirements: [],
    reportingObligations: [],
    kycLevel: 3,
    amlThresholds: [],
    updateFrequency: "monthly",
  };

  it("fetches requirements for a jurisdiction", async () => {
    mockApiClient.get.mockResolvedValue(mockReqs);
    const { result } = renderHook(() => useJurisdictionRequirements("uae"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/regulatory/jurisdictions/uae/requirements",
    );
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
    jurisdictionId: "uae",
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
    const { result } = renderHook(() => useComplianceStatus("uae"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/regulatory/compliance/uae",
      { owner: mockAddress },
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
    const { result } = renderHook(() => useComplianceStatus("uae"), {
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
      fromJurisdiction: "uae",
      toJurisdiction: "eu",
      eligible: true,
      riskLevel: "low",
      requiredActions: [],
      additionalCredentials: [],
      estimatedProcessingDays: 2,
      restrictions: [],
      bilateralAgreements: ["UAE-EU MRA"],
    });
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromJurisdiction: "uae",
        toJurisdiction: "eu",
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Cross-border transfer eligible",
      {
        description: expect.stringContaining("low"),
      },
    );
  });

  it("shows warning toast when not eligible", async () => {
    mockApiClient.post.mockResolvedValue({
      fromJurisdiction: "uae",
      toJurisdiction: "restricted",
      eligible: false,
      riskLevel: "prohibited",
      requiredActions: [],
      additionalCredentials: [],
      estimatedProcessingDays: 0,
      restrictions: ["Sanctions apply", "No bilateral agreement"],
      bilateralAgreements: [],
    });
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromJurisdiction: "uae",
        toJurisdiction: "restricted",
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
  const mockGap = {
    jurisdictionId: "uae",
    totalRequired: 10,
    totalMet: 8,
    gaps: [],
    remediationPriority: [],
    estimatedRemediationDays: 14,
  };

  it("fetches gap analysis for jurisdiction and address", async () => {
    mockApiClient.get.mockResolvedValue(mockGap);
    const { result } = renderHook(() => useGapAnalysis("uae"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/regulatory/gap-analysis/uae",
      { owner: mockAddress },
    );
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
    const { result } = renderHook(() => useGapAnalysis("uae"), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useRegulatoryFeed
// ===========================================================================

describe("useRegulatoryFeed", () => {
  const mockFeed = [
    {
      id: "update-1",
      jurisdictionId: "uae",
      jurisdictionName: "UAE",
      title: "New VASP regulation",
      summary: "Updated KYC requirements",
      category: "new_regulation",
      severity: "high",
      effectiveDate: "2026-06-01T00:00:00Z",
      publishedAt: "2026-01-01T00:00:00Z",
      sourceUrl: "https://example.com",
      impactsIdentity: true,
    },
  ];

  it("fetches regulatory feed", async () => {
    mockApiClient.get.mockResolvedValue(mockFeed);
    const { result } = renderHook(() => useRegulatoryFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/regulatory/feed");
    expect(result.current.data).toEqual(mockFeed);
  });
});

// ===========================================================================
// useDataSovereigntyStatus
// ===========================================================================

describe("useDataSovereigntyStatus", () => {
  const mockSov = {
    compliantRegions: ["mena", "eu"],
    nonCompliantRegions: [],
    dataResidencyMap: [],
    gdprStatus: {
      dataProcessingAgreement: true,
      dataProtectionOfficer: true,
      privacyImpactAssessment: true,
      consentManagement: true,
      rightToErasure: true,
      dataPortability: true,
      breachNotificationProcess: true,
      overallCompliant: true,
    },
    pendingTransfers: 0,
  };

  it("fetches sovereignty status for connected address", async () => {
    mockApiClient.get.mockResolvedValue(mockSov);
    const { result } = renderHook(() => useDataSovereigntyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/regulatory/data-sovereignty",
      { owner: mockAddress },
    );
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
