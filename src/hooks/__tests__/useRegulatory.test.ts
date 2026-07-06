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
    expect(result.current.data?.[0]).toMatchObject({
      id: "uae",
      name: "United Arab Emirates",
      code: "AE",
      region: "mena",
      isActive: true,
    });
  });
});

// ===========================================================================
// useJurisdictionRequirements
// ===========================================================================

describe("useJurisdictionRequirements", () => {
  it("fetches backend jurisdiction requirements", async () => {
    mockApiClient.get.mockResolvedValue({
      jurisdictionId: "AE-CBUAE",
      requiredCredentials: [
        {
          schemaId: "emirates_id",
          schemaName: "Emirates ID",
          mandatory: true,
          validityPeriodDays: 1825,
          acceptedIssuers: ["Central Bank of UAE"],
          renewalBufferDays: 90,
        },
      ],
      dataRetentionDays: 1825,
      consentRequirements: [],
      reportingObligations: [],
      kycLevel: 3,
      amlThresholds: [],
      updateFrequency: "quarterly",
    });
    const { result } = renderHook(
      () => useJurisdictionRequirements("AE-CBUAE"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/jurisdictions/AE-CBUAE/requirements",
    );
    expect(result.current.data?.requiredCredentials[0]).toMatchObject({
      schemaId: "emirates_id",
      schemaName: "Emirates ID",
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
  it("derives gap analysis from backend compliance status", async () => {
    mockApiClient.get.mockResolvedValue({
      jurisdiction: "AE-CBUAE",
      overallStatus: "partial",
      missingCredentials: ["source_of_funds"],
      expiringCredentials: [
        {
          credentialType: "passport",
          expiresAt: "2026-07-01T00:00:00Z",
          daysRemaining: 15,
        },
      ],
      rules: [
        {
          name: "KYC Completeness",
          status: "fail",
          detail: "Missing source_of_funds",
        },
      ],
      lastEvaluated: "2026-01-01T00:00:00Z",
      nextReviewDate: "2026-04-01T00:00:00Z",
    });
    const { result } = renderHook(() => useGapAnalysis("AE-CBUAE"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      `/api/v1/enterprise/compliance/status/${mockAddress}`,
      { jurisdiction: "AE-CBUAE" },
    );
    expect(result.current.data).toMatchObject({
      jurisdictionId: "AE-CBUAE",
      totalRequired: 2,
      totalMet: 0,
    });
    expect(result.current.data?.gaps.map((gap) => gap.requirement)).toEqual([
      "Source Of Funds",
      "Passport",
    ]);
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
  it("fetches and maps backend regulatory changes", async () => {
    mockApiClient.get.mockResolvedValue([
      {
        id: "chg-1",
        jurisdiction: "AE-CBUAE",
        changeType: "new_requirement",
        title: "Enhanced due diligence update",
        description: "Source of funds evidence is required.",
        effectiveDate: "2026-08-01T00:00:00Z",
        publishedAt: "2026-06-01T00:00:00Z",
        impactedEntities: ["institution"],
      },
    ]);
    const { result } = renderHook(() => useRegulatoryFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/regulatory-changes",
    );
    expect(result.current.data?.[0]).toMatchObject({
      id: "chg-1",
      category: "new_regulation",
      severity: "high",
      impactsIdentity: true,
    });
  });
});

// ===========================================================================
// useDataSovereigntyStatus
// ===========================================================================

describe("useDataSovereigntyStatus", () => {
  it("fetches backend data sovereignty status", async () => {
    mockApiClient.get.mockResolvedValue({
      compliantRegions: ["me-central-1"],
      nonCompliantRegions: [],
      dataResidencyMap: [
        {
          dataType: "personal",
          currentRegion: "me-central-1",
          requiredRegion: "me-central-1",
          compliant: true,
          migrationRequired: false,
        },
      ],
      gdprStatus: {
        dataProcessingAgreement: false,
        dataProtectionOfficer: false,
        privacyImpactAssessment: false,
        consentManagement: true,
        rightToErasure: true,
        dataPortability: true,
        breachNotificationProcess: true,
        overallCompliant: true,
      },
      pendingTransfers: 0,
    });
    const { result } = renderHook(() => useDataSovereigntyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      `/api/v1/enterprise/compliance/sovereignty/status/${mockAddress}`,
    );
    expect(result.current.data).toMatchObject({
      compliantRegions: ["me-central-1"],
      pendingTransfers: 0,
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
