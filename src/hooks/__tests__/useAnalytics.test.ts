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
  useNetworkBenchmarks,
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
    id: "cred-1",
    hash: "cred-1",
    schemaHash: "schema-1",
    schemaName: "KYC Credential",
    schemaType: "kyc",
    issuerDid: { uri: "did:aethelred:issuer:cbuae" },
    subjectDid: { uri: "did:aethelred:subject:1" },
    issuedAt: 1_780_000_000,
    expiresAt: 1_820_000_000,
    status: "verified",
    merkleRoot: "0xabc",
  },
];

const history = [
  {
    id: "hist-1",
    verificationType: "ZK_PROOF",
    result: "VERIFIED",
    requestedAt: "2026-06-20T10:00:00.000Z",
    credentialId: "cred-1",
    verifierId: "did:aethelred:verifier:edge",
  },
  {
    id: "hist-2",
    verificationType: "CREDENTIAL_CHECK",
    result: "VERIFIED",
    requestedAt: "2026-06-21T10:00:00.000Z",
    credentialId: "cred-1",
    verifierId: "did:aethelred:verifier:presight",
  },
];

const requestGroups = {
  PENDING: [
    {
      id: "req-1",
      verifierDid: "did:aethelred:verifier:edge",
      verifierName: "EDGE",
      credentialHash: "cred-1",
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
      credentialHash: "cred-1",
      requestedAttributes: ["fullName", "dateOfBirth", "passport", "nationality"],
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
    expect(result.current.data?.overallScore).toBeGreaterThan(0);
    expect(result.current.data?.breakdown.zkProofAdoption).toBeGreaterThan(0);
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
      schemaName: "KYC Credential",
      presentationCount: 2,
    });
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
  it("builds verifier trust and purpose analytics", async () => {
    const { result } = renderHook(() => useVerifierAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalVerifiers).toBe(2);
    expect(result.current.data?.requestsByPurpose[0]).toMatchObject({
      count: 1,
    });
  });
});

describe("useDataExposureTimeline", () => {
  it("builds exposure events and risk summary", async () => {
    const { result } = renderHook(() => useDataExposureTimeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.entries).toHaveLength(2);
    expect(result.current.data?.uniqueAttributesExposed).toBeGreaterThan(0);
  });
});

describe("useNetworkBenchmarks", () => {
  it("builds benchmark metrics from the analytics snapshot", async () => {
    const { result } = renderHook(() => useNetworkBenchmarks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sampleSize).toBeGreaterThan(0);
    expect(result.current.data?.benchmarks.map((metric) => metric.metric)).toEqual(
      ["privacyPreservingRatio", "verifierDiversity", "attributeExposure"],
    );
  });
});

describe("usePrivacyRecommendations", () => {
  it("derives recommendations from exposure and consent gaps", async () => {
    const { result } = renderHook(() => usePrivacyRecommendations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBeGreaterThan(0);
    expect(result.current.data?.[0].implementationSteps.length).toBeGreaterThan(0);
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
