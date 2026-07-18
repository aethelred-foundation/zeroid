/**
 * useAnalytics — Unit Tests
 *
 * Tests for API-backed privacy analytics derived from credentials and durable
 * verification records.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";
const credentialId = "d74ed26c-47ac-4b62-94a8-38704c53b876";

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
  usePrivacyScore,
  useCredentialUsageAnalytics,
  useVerifierAnalytics,
  useDataExposureTimeline,
  usePrivacyRecommendations,
  useExportAnalyticsReport,
} from "@/hooks/useAnalytics";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const credentials = [
  {
    id: credentialId,
    credentialType: "KYC_LEVEL_2",
    issuerId: "issuer-record-17",
    subjectId: "subject-record-8",
    claimsHash:
      "3f3bd8d3d60d1412f98f8f366f0bbbea21c10ac40db80a9e28fa8911223e7f4b",
    proof: { type: "DataIntegrityProof" },
    issuedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2027-06-01T00:00:00.000Z",
    status: "ACTIVE",
  },
];

const history = [
  {
    id: "hist-1",
    verificationType: "ZK_PROOF",
    result: "VERIFIED",
    requestedAt: "2026-06-20T10:00:00.000Z",
    credentialId,
    verifierId: "did:aethelred:verifier:edge",
  },
  {
    id: "hist-2",
    verificationType: "CREDENTIAL_CHECK",
    result: "VERIFIED",
    requestedAt: "2026-06-21T10:00:00.000Z",
    credentialId,
    verifierId: "did:aethelred:verifier:presight",
  },
];

const requestGroups = {
  PENDING: [
    {
      id: "req-1",
      verifierDid: "did:aethelred:verifier:edge",
      verifierName: "EDGE",
      credentialId,
      requestedAttributes: ["ageOver18", "nationality"],
      circuitId: "age-proof",
      purpose: "facility_access",
      userConsent: true,
      createdAt: 1_782_000_000,
    },
  ],
  VERIFIED: [
    {
      id: "req-2",
      verifierDid: "did:aethelred:verifier:presight",
      verifierName: "Presight",
      credentialId,
      requestedAttributes: [
        "fullName",
        "dateOfBirth",
        "passport",
        "nationality",
      ],
      purpose: "model_governance",
      userConsent: false,
      createdAt: 1_782_086_400,
    },
  ],
  FAILED: [],
  EXPIRED: [],
};

function mockAnalyticsSources() {
  mockApiClient.get.mockImplementation((path: string) => {
    if (path === "/api/v1/credentials?role=subject") {
      return Promise.resolve(credentials);
    }
    if (path === "/api/v1/verification/history?limit=100") {
      return Promise.resolve(history);
    }
    const status = Object.keys(requestGroups).find((key) =>
      path.includes(`result=${key}`),
    ) as keyof typeof requestGroups | undefined;
    if (status) {
      return Promise.resolve(requestGroups[status]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
  mockAnalyticsSources();
  URL.createObjectURL = jest.fn(() => "blob:zeroid-analytics");
  HTMLAnchorElement.prototype.click = jest.fn();
});

describe("usePrivacyScore", () => {
  it("derives privacy score from durable credential and verification APIs", async () => {
    const { result } = renderHook(() => usePrivacyScore(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/credentials?role=subject",
    );
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/verification/history?limit=100",
    );
    expect(result.current.data?.overallScore ?? 0).toBeGreaterThan(0);
    expect(result.current.data?.breakdown.zkProofAdoption).toBeGreaterThan(0);
    expect(result.current.data?.calculationBasis).toContain(
      "no network percentile",
    );
    expect(result.current.data).not.toHaveProperty("percentileRank");
  });

  it("reports the score as unavailable when no dated requests were returned", async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/credentials?role=subject") {
        return Promise.resolve(credentials);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => usePrivacyScore("all"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      overallScore: null,
      grade: null,
      recordCount: 0,
    });
    expect(result.current.data?.calculationBasis).toContain(
      "no network percentile",
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => usePrivacyScore(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCredentialUsageAnalytics", () => {
  it("builds credential usage analytics for the selected period", async () => {
    const { result } = renderHook(() => useCredentialUsageAnalytics("30d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      period: "30d",
      totalPresentations: 2,
      uniqueVerifiers: 2,
      zkProofPresentations: 1,
    });
    expect(result.current.data?.byCredentialType[0]).toMatchObject({
      credentialTypeLabel: "KYC Level 2",
      credentialId,
      presentationCount: 2,
    });
  });

  it("fails closed when the credential API returns the legacy UI shape", async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/credentials?role=subject") {
        return Promise.resolve([
          {
            id: credentialId,
            hash: "0xlegacy",
            schemaName: "Legacy credential",
            status: "verified",
          },
        ]);
      }
      if (path === "/api/v1/verification/history?limit=100") {
        return Promise.resolve(history);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useCredentialUsageAnalytics("30d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      name: "CredentialResponseContractError",
    });
  });

  it("excludes records with missing or malformed timestamps instead of moving them to now", async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path === "/api/v1/credentials?role=subject") {
        return Promise.resolve(credentials);
      }
      if (path === "/api/v1/verification/history?limit=100") {
        return Promise.resolve([
          {
            ...history[0],
            id: "valid-history",
            requestedAt: "2020-01-01T00:00:00.000Z",
          },
          {
            ...history[0],
            id: "invalid-history",
            requestedAt: "not-a-date",
            completedAt: "also-not-a-date",
          },
          {
            ...history[0],
            id: "undated-history",
            requestedAt: undefined,
          },
        ]);
      }
      if (path.includes("result=PENDING")) {
        return Promise.resolve([
          {
            ...requestGroups.PENDING[0],
            id: "valid-request",
            createdAt: "2020-01-02T00:00:00.000Z",
            circuitId: undefined,
          },
          {
            ...requestGroups.PENDING[0],
            id: "invalid-request",
            createdAt: "not-a-date",
          },
          {
            ...requestGroups.PENDING[0],
            id: "undated-request",
            createdAt: undefined,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useCredentialUsageAnalytics("all"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      totalPresentations: 1,
      selectiveDisclosurePresentations: 1,
      privacyPreservingRatio: 100,
    });
    expect(result.current.data?.byDay).toHaveLength(2);
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useCredentialUsageAnalytics(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useVerifierAnalytics", () => {
  it("builds verifier and purpose analytics without a fabricated trust score", async () => {
    const { result } = renderHook(() => useVerifierAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalVerifiers).toBe(2);
    expect(result.current.data?.requestsByPurpose[0]).toMatchObject({
      count: 1,
    });
    expect(result.current.data?.verifiers[0]).not.toHaveProperty("trustScore");
    expect(result.current.data?.verifiers[0]).toHaveProperty(
      "zkProofRequestObserved",
    );
  });
});

describe("useDataExposureTimeline", () => {
  it("builds exposure events without a fabricated risk score", async () => {
    const { result } = renderHook(() => useDataExposureTimeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.entries).toHaveLength(2);
    expect(result.current.data?.uniqueAttributesExposed).toBeGreaterThan(0);
    expect(result.current.data?.fullDisclosureEvents).toBe(1);
    expect(result.current.data).not.toHaveProperty("highRiskExposures");
    expect(result.current.data?.entries[0]).not.toHaveProperty("riskScore");
  });
});

describe("usePrivacyRecommendations", () => {
  it("derives recommendations from exposure and consent gaps", async () => {
    const { result } = renderHook(() => usePrivacyRecommendations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBeGreaterThan(0);
    expect(result.current.data?.[0].implementationSteps.length).toBeGreaterThan(
      0,
    );
  });
});

describe("useExportAnalyticsReport", () => {
  it("exports a generated analytics report without a stale backend export route", async () => {
    const { result } = renderHook(() => useExportAnalyticsReport(), {
      wrapper: createWrapper(),
    });

    let exported;
    await act(async () => {
      exported = await result.current.mutateAsync({
        format: "json",
        period: "30d",
      });
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(
      "Analytics report exported",
      expect.objectContaining({
        description: expect.stringContaining("JSON report"),
      }),
    );
    expect(exported).toMatchObject({
      format: "json",
      downloadUrl: "blob:zeroid-analytics",
    });
  });

  it("shows error toast on source API failure", async () => {
    mockApiClient.get.mockRejectedValue(new Error("Analytics sources offline"));
    const { result } = renderHook(() => useExportAnalyticsReport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ format: "csv" });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Export failed", {
      description: "Analytics sources offline",
    });
  });
});
