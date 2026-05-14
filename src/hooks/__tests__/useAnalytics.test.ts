/**
 * useAnalytics — Unit Tests
 *
 * Tests for privacy-preserving analytics hooks: privacy score,
 * credential usage, verifier analytics, exposure timeline,
 * benchmarks, recommendations, and export.
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
  usePrivacyScore,
  useCredentialUsageAnalytics,
  useVerifierAnalytics,
  useDataExposureTimeline,
  useNetworkBenchmarks,
  usePrivacyRecommendations,
  useExportAnalyticsReport,
} from "@/hooks/useAnalytics";

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
// usePrivacyScore
// ===========================================================================

describe("usePrivacyScore", () => {
  it("fails closed instead of calling a stale privacy score route", async () => {
    const { result } = renderHook(() => usePrivacyScore(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_PRIVACY_SCORE_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
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

// ===========================================================================
// useCredentialUsageAnalytics
// ===========================================================================

describe("useCredentialUsageAnalytics", () => {
  it("fails closed instead of calling a stale usage analytics route", async () => {
    const { result } = renderHook(() => useCredentialUsageAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_CREDENTIAL_USAGE_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("does not call the stale route with a custom period", async () => {
    const { result } = renderHook(() => useCredentialUsageAnalytics("90d"), {
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
    const { result } = renderHook(() => useCredentialUsageAnalytics(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useVerifierAnalytics
// ===========================================================================

describe("useVerifierAnalytics", () => {
  it("fails closed instead of calling a stale verifier analytics route", async () => {
    const { result } = renderHook(() => useVerifierAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_VERIFIERS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useVerifierAnalytics(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useDataExposureTimeline
// ===========================================================================

describe("useDataExposureTimeline", () => {
  it("fails closed instead of calling a stale exposure analytics route", async () => {
    const { result } = renderHook(() => useDataExposureTimeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_EXPOSURE_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useDataExposureTimeline(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useNetworkBenchmarks
// ===========================================================================

describe("useNetworkBenchmarks", () => {
  it("fails closed instead of calling a stale benchmark route", async () => {
    const { result } = renderHook(() => useNetworkBenchmarks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_BENCHMARKS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useNetworkBenchmarks(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// usePrivacyRecommendations
// ===========================================================================

describe("usePrivacyRecommendations", () => {
  it("fails closed instead of calling a stale recommendation route", async () => {
    const { result } = renderHook(() => usePrivacyRecommendations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "ANALYTICS_RECOMMENDATIONS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => usePrivacyRecommendations(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useExportAnalyticsReport
// ===========================================================================

describe("useExportAnalyticsReport", () => {
  it("fails closed instead of calling a stale analytics export route", async () => {
    const { result } = renderHook(() => useExportAnalyticsReport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ format: "pdf", period: "30d" }),
      ).rejects.toMatchObject({
        code: "ANALYTICS_EXPORT_UNAVAILABLE",
        statusCode: 501,
      });
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Export failed", {
      description: "Analytics report export is not exposed by the backend API.",
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("shows error toast on unsupported export", async () => {
    const { result } = renderHook(() => useExportAnalyticsReport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ format: "json" });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Export failed", {
      description: "Analytics report export is not exposed by the backend API.",
    });
  });
});
