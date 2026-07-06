/**
 * useAICompliance — Unit Tests
 *
 * Tests for all AI compliance hooks: screening, risk assessment, advisor,
 * alerts, report generation, and regulatory change impact assessment.
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
  useScreenIdentity,
  useRiskAssessment,
  useRefreshRiskAssessment,
  useComplianceAdvisor,
  useComplianceAlerts,
  useAcknowledgeAlert,
  useGenerateReport,
  useAssessRegChangeImpact,
  useSimulateRegChange,
} from "@/hooks/useAICompliance";

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
// useScreenIdentity
// ===========================================================================

describe("useScreenIdentity", () => {
  const cleanResult = {
    screeningId: "scr-1",
    identityId: "id-1",
    result: "clear",
    matchScore: 0,
    matchedLists: [],
    pepMatches: [],
    adverseMedia: [],
    riskIndicators: [],
    screenedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-02-01T00:00:00Z",
    listsChecked: ["ofac_sdn"],
  };

  const flaggedResult = {
    ...cleanResult,
    result: "potential_match",
    matchScore: 95,
    matchedLists: [
      {
        listName: "OFAC SDN",
        listSource: "OFAC",
        matchedName: "Entity A",
        matchConfidence: 0.95,
        entityType: "individual",
        sanctions: ["asset_freeze"],
        listedSince: "2025-01-01T00:00:00Z",
        lastUpdated: "2026-01-01T00:00:00Z",
      },
    ],
  };

  it("calls API with the screening identity payload", async () => {
    mockApiClient.post.mockResolvedValue(cleanResult);
    const { result } = renderHook(() => useScreenIdentity(), {
      wrapper: createWrapper(),
    });
    const input = {
      identityId: "550e8400-e29b-41d4-a716-446655440000",
      fullName: "Example Person",
      jurisdiction: "US",
      nationality: "US",
    };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/screen",
      input,
    );
  });

  it("shows success toast when no matches found", async () => {
    mockApiClient.post.mockResolvedValue(cleanResult);
    const { result } = renderHook(() => useScreenIdentity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        identityId: "id-1",
        fullName: "Example Person",
        jurisdiction: "US",
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Screening complete — no matches found",
    );
  });

  it("shows warning toast when matches found", async () => {
    mockApiClient.post.mockResolvedValue(flaggedResult);
    const { result } = renderHook(() => useScreenIdentity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        identityId: "id-1",
        fullName: "Entity A",
        jurisdiction: "US",
      });
    });

    expect(mockToast.warning).toHaveBeenCalledWith(
      "Screening flagged potential matches",
      {
        description: "1 match(es) found — review required",
      },
    );
  });

  it("shows warning toast when pepHit is true and sanctionsHit is false", async () => {
    const pepResult = {
      ...cleanResult,
      result: "potential_match",
      matchScore: 90,
      pepMatches: [
        {
          name: "PEP Entity",
          position: "Senior Official",
          country: "UK",
          level: "senior_official",
          active: true,
          matchConfidence: 0.9,
          source: "PEP_DB",
        },
      ],
    };
    mockApiClient.post.mockResolvedValue(pepResult);
    const { result } = renderHook(() => useScreenIdentity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        identityId: "id-1",
        fullName: "PEP Entity",
        jurisdiction: "UK",
      });
    });

    expect(mockToast.warning).toHaveBeenCalledWith(
      "Screening flagged potential matches",
      {
        description: "1 match(es) found — review required",
      },
    );
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Server error"));
    const { result } = renderHook(() => useScreenIdentity(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          identityId: "id-1",
          fullName: "Example Person",
          jurisdiction: "US",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Screening failed", {
      description: "Server error",
    });
  });
});

// ===========================================================================
// useRiskAssessment
// ===========================================================================

describe("useRiskAssessment", () => {
  const mockRiskResponse = {
    riskAssessment: {
      assessmentId: "risk-1",
      entityId: "id-1",
      entityType: "identity",
      compositeScore: 25,
      decision: "approve",
      factors: [],
      trend: "stable",
      confidence: 0.9,
      timestamp: "2026-01-01T00:00:00Z",
    },
    complianceScore: {
      entityId: "id-1",
      jurisdiction: "US",
      overallScore: 92,
      rating: "excellent",
      components: {},
      computedAt: "2026-01-01T00:00:00Z",
    },
  };

  it("fetches risk assessment for given identityId", async () => {
    mockApiClient.get.mockResolvedValue(mockRiskResponse);
    const { result } = renderHook(() => useRiskAssessment("id-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/risk/id-1",
    );
    expect(result.current.data).toEqual(mockRiskResponse);
  });

  it("is disabled when identityId is undefined", () => {
    const { result } = renderHook(() => useRiskAssessment(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useRefreshRiskAssessment
// ===========================================================================

describe("useRefreshRiskAssessment", () => {
  const mockRiskResponse = {
    riskAssessment: {
      assessmentId: "risk-2",
      entityId: "id-1",
      entityType: "identity",
      compositeScore: 42,
      decision: "review",
      factors: [],
      trend: "stable",
      confidence: 0.88,
      timestamp: "2026-01-01T00:00:00Z",
    },
    complianceScore: {
      entityId: "id-1",
      jurisdiction: "US",
      overallScore: 80,
      rating: "good",
      components: {},
      computedAt: "2026-01-01T00:00:00Z",
    },
  };

  it("fetches latest risk and shows success toast with score", async () => {
    mockApiClient.get.mockResolvedValue(mockRiskResponse);
    const { result } = renderHook(() => useRefreshRiskAssessment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("id-1");
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/risk/id-1",
    );
    expect(mockToast.success).toHaveBeenCalledWith("Risk assessment updated", {
      description: "Score: 42 (review)",
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.get.mockRejectedValue(new Error("Timeout"));
    const { result } = renderHook(() => useRefreshRiskAssessment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync("id-1");
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Risk refresh failed", {
      description: "Timeout",
    });
  });
});

// ===========================================================================
// useComplianceAdvisor
// ===========================================================================

describe("useComplianceAdvisor", () => {
  const mockResponse = {
    queryId: "query-1",
    question: "What are UAE KYC rules?",
    answer: "According to UAE VASP regulations...",
    confidence: 0.9,
    timestamp: "2026-01-01T00:00:00Z",
    citations: [{ regulation: "UAE VASP", section: "3.1", text: "CDD" }],
    relatedTopics: ["CDD"],
    disclaimer: "For compliance review only.",
  };

  it("sends message and returns response", async () => {
    mockApiClient.post.mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useComplianceAdvisor(), {
      wrapper: createWrapper(),
    });

    let response: unknown;
    await act(async () => {
      response = await result.current.sendMessage("What are UAE KYC rules?");
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/advisor/query",
      {
        question: "What are UAE KYC rules?",
        context: {},
      },
    );
    expect(response).toEqual(mockResponse);
  });

  it("exposes isLoading and error state", () => {
    const { result } = renderHook(() => useComplianceAdvisor(), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Advisor unavailable"));
    const { result } = renderHook(() => useComplianceAdvisor(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.sendMessage("test");
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Advisor request failed", {
      description: "Advisor unavailable",
    });
  });
});

// ===========================================================================
// useComplianceAlerts
// ===========================================================================

describe("useComplianceAlerts", () => {
  const mockAlertsResponse = {
    alerts: [
      {
        alertId: "a-1",
        entityId: "id-1",
        level: "warning",
        category: "sanctions",
        title: "Alert 1",
        description: "desc",
        regulation: "FATF",
        actionRequired: "Review",
        createdAt: "2026-01-01T00:00:00Z",
        source: "compliance",
      },
    ],
    total: 1,
    complianceAlertCount: 1,
    fraudAlertCount: 0,
  };

  it("fetches alerts for connected address", async () => {
    mockApiClient.get.mockResolvedValue(mockAlertsResponse);
    const { result } = renderHook(() => useComplianceAlerts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/alerts",
    );
    expect(result.current.data).toEqual(mockAlertsResponse);
  });

  it("is disabled when address is not connected", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useComplianceAlerts(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useAcknowledgeAlert
// ===========================================================================

describe("useAcknowledgeAlert", () => {
  it("posts acknowledge and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAcknowledgeAlert(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("alert-123");
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/alerts/alert-123/acknowledge",
      {},
    );
    expect(mockToast.success).toHaveBeenCalledWith("Alert acknowledged");
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Not found"));
    const { result } = renderHook(() => useAcknowledgeAlert(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync("alert-123");
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to acknowledge alert",
      { description: "Not found" },
    );
  });
});

// ===========================================================================
// useGenerateReport
// ===========================================================================

describe("useGenerateReport", () => {
  const mockReport = {
    reportId: "rpt-1",
    entityId: "550e8400-e29b-41d4-a716-446655440000",
    reportType: "kyc",
    status: "complete",
    summary: "KYC complete",
    sections: [],
    complianceScore: 92,
    gaps: [],
    recommendations: [],
    generatedAt: "2026-01-01T00:00:00Z",
    validUntil: "2026-02-01T00:00:00Z",
    jurisdiction: "US",
    regulatoryFramework: "FATF",
  };

  it("generates report and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(mockReport);
    const { result } = renderHook(() => useGenerateReport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityId: "550e8400-e29b-41d4-a716-446655440000",
        reportType: "kyc",
        jurisdiction: "US",
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/report",
      {
        entityId: "550e8400-e29b-41d4-a716-446655440000",
        reportType: "kyc",
        jurisdiction: "US",
      },
    );
    expect(mockToast.success).toHaveBeenCalledWith("Report generated", {
      description: "kyc report complete",
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Generation error"));
    const { result } = renderHook(() => useGenerateReport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          entityId: "550e8400-e29b-41d4-a716-446655440000",
          reportType: "aml",
          jurisdiction: "US",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Report generation failed", {
      description: "Generation error",
    });
  });
});

// ===========================================================================
// useAssessRegChangeImpact
// ===========================================================================

describe("useAssessRegChangeImpact", () => {
  const simHighEffort = {
    changeId: "change-1",
    regulation: "MiCA",
    effectiveDate: "2026-05-01T00:00:00Z",
    description: "Raise transfer screening requirements",
    impactedEntities: 100,
    impactedCredentialTypes: ["KYC_LEVEL_2"],
    requiredActions: ["Update KYC"],
    estimatedEffort: "high",
    automationPossible: true,
  };

  const simLowEffort = {
    ...simHighEffort,
    impactedEntities: 10,
    requiredActions: [],
    estimatedEffort: "low",
  };

  it("shows warning toast when high remediation effort is detected", async () => {
    mockApiClient.post.mockResolvedValue(simHighEffort);
    const { result } = renderHook(() => useAssessRegChangeImpact(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        regulation: "MiCA",
        changes: "Raise transfer screening requirements",
        jurisdiction: "EU",
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/impact-assessment",
      {
        regulation: "MiCA",
        changes: "Raise transfer screening requirements",
        jurisdiction: "EU",
      },
    );
    expect(mockToast.warning).toHaveBeenCalledWith(
      "Impact assessment complete",
      {
        description: "100 impacted entity(ies); 1 action(s) required",
      },
    );
  });

  it("shows success toast when effort is low", async () => {
    mockApiClient.post.mockResolvedValue(simLowEffort);
    const { result } = renderHook(() => useAssessRegChangeImpact(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        regulation: "MiCA",
        changes: "Lower manual review thresholds",
        jurisdiction: "EU",
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Impact assessment complete — no new gaps detected",
    );
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Sim failed"));
    const { result } = renderHook(() => useAssessRegChangeImpact(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          regulation: "MiCA",
          changes: "Invalid simulation request",
          jurisdiction: "EU",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Impact assessment failed", {
      description: "Sim failed",
    });
  });

  it("keeps the legacy simulation hook as a compatibility alias", async () => {
    mockApiClient.post.mockResolvedValue(simLowEffort);
    const { result } = renderHook(() => useSimulateRegChange(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        regulation: "MiCA",
        changes: "Lower manual review thresholds",
        jurisdiction: "EU",
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/compliance/impact-assessment",
      {
        regulation: "MiCA",
        changes: "Lower manual review thresholds",
        jurisdiction: "EU",
      },
    );
  });
});
