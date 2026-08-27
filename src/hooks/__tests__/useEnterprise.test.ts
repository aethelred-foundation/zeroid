/**
 * useEnterprise — Unit Tests
 *
 * Tests for enterprise hooks: API keys, webhooks, SLA reports, usage metrics.
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
    statusCode: number;

    constructor(message: string, code: string, statusCode: number) {
      super(message);
      this.name = "ZeroIDApiError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

import { useAccount } from "wagmi";
import {
  useAPIKeys,
  useCreateAPIKey,
  useRevokeAPIKey,
  useWebhooks,
  useRegisterWebhook,
  useTestWebhook,
  useSLAReport,
  useUsageMetrics,
} from "@/hooks/useEnterprise";

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
// useAPIKeys
// ===========================================================================

describe("useAPIKeys", () => {
  it("fetches API keys for connected address", async () => {
    mockApiClient.get.mockResolvedValue([{ id: "key-1", name: "Production" }]);
    const { result } = renderHook(() => useAPIKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/api-keys",
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useAPIKeys(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useCreateAPIKey
// ===========================================================================

describe("useCreateAPIKey", () => {
  const mockCreateResult = {
    apiKey: "zid_live_abc123",
    apiKeyId: "key-1",
    expiresAt: "2026-04-01T00:00:00Z",
  };

  it("creates API key and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(mockCreateResult);
    const { result } = renderHook(() => useCreateAPIKey(), {
      wrapper: createWrapper(),
    });

    const config = {
      name: "Production",
      scopes: ["identity:read", "credentials:read"] as any,
      environment: "production" as const,
      expiresInDays: 90,
      ipAllowlist: ["203.0.113.10/32"],
      dailyQuota: 10000,
      monthlyQuota: 1_000_000,
      rateLimit: {
        requestsPerSecond: 100,
        burstSize: 200,
      },
      metadata: { tier: "enterprise" },
    };

    await act(async () => {
      await result.current.mutateAsync(config);
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/enterprise/api-keys",
      config,
    );
    expect(mockToast.success).toHaveBeenCalledWith("API key created", {
      description: expect.stringContaining("Production"),
      duration: 10_000,
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Limit reached"));
    const { result } = renderHook(() => useCreateAPIKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: "X",
          scopes: [],
          environment: "sandbox",
        } as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("API key creation failed", {
      description: "Limit reached",
    });
  });
});

// ===========================================================================
// useRevokeAPIKey
// ===========================================================================

describe("useRevokeAPIKey", () => {
  it("revokes API key and shows success toast", async () => {
    mockApiClient.del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRevokeAPIKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("key-1");
    });

    expect(mockApiClient.del).toHaveBeenCalledWith(
      "/api/v1/enterprise/api-keys/key-1",
      { reason: "Revoked by client" },
    );
    expect(mockToast.success).toHaveBeenCalledWith("API key revoked");
  });

  it("shows error toast on failure", async () => {
    mockApiClient.del.mockRejectedValue(new Error("Not found"));
    const { result } = renderHook(() => useRevokeAPIKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync("key-x");
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Key revocation failed", {
      description: "Not found",
    });
  });
});

// ===========================================================================
// useWebhooks
// ===========================================================================

describe("useWebhooks", () => {
  it("fetches webhooks for connected address", async () => {
    mockApiClient.get.mockResolvedValue([
      { id: "wh-1", url: "https://example.com/hook" },
    ]);
    const { result } = renderHook(() => useWebhooks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/webhooks",
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useWebhooks(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useRegisterWebhook
// ===========================================================================

describe("useRegisterWebhook", () => {
  const mockWebhook = {
    id: "wh-1",
    url: "https://example.com/hook",
    events: ["identity.registered", "credential.issued"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    active: true,
    health: {
      status: "healthy",
      successRate: 100,
      totalDeliveries: 0,
      failedDeliveries: 0,
    },
  };

  it("registers webhook and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(mockWebhook);
    const { result } = renderHook(() => useRegisterWebhook(), {
      wrapper: createWrapper(),
    });

    const config = {
      url: "https://example.com/hook",
      events: ["identity.registered", "credential.issued"] as any,
      active: true,
      description: "Production events",
      headers: { "x-customer-id": "acme" },
    };

    await act(async () => {
      await result.current.mutateAsync(config);
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/enterprise/webhooks",
      {
        url: "https://example.com/hook",
        events: ["identity.registered", "credential.issued"],
        secret: undefined,
        description: "Production events",
        active: true,
        metadata: {},
        batchDelivery: false,
        batchIntervalMs: 5_000,
        headers: { "x-customer-id": "acme" },
      },
    );
    expect(mockToast.success).toHaveBeenCalledWith("Webhook registered", {
      description: expect.stringContaining("2 event type(s)"),
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Invalid URL"));
    const { result } = renderHook(() => useRegisterWebhook(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          url: "bad",
          events: [],
          enabled: true,
        } as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Webhook registration failed",
      { description: "Invalid URL" },
    );
  });
});

// ===========================================================================
// useTestWebhook
// ===========================================================================

describe("useTestWebhook", () => {
  it("posts to backend webhook test delivery and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue({
      deliveryId: "del-1",
      delivered: true,
      statusCode: 204,
      responseTimeMs: 72,
    });
    const { result } = renderHook(() => useTestWebhook(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("wh-1");
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/enterprise/webhooks/wh-1/test",
      {},
    );
    expect(mockToast.success).toHaveBeenCalledWith("Webhook test delivered", {
      description: "Status 204, 72ms",
    });
  });

  it("shows failed-delivery toast when backend test attempt reaches endpoint but fails", async () => {
    mockApiClient.post.mockResolvedValue({
      deliveryId: "del-2",
      delivered: false,
      statusCode: 500,
      responseTimeMs: 91,
      error: "Receiver returned 500",
    });
    const { result } = renderHook(() => useTestWebhook(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("wh-2");
    });

    expect(mockToast.error).toHaveBeenCalledWith("Webhook test failed", {
      description: "Receiver returned 500",
    });
  });

  it("shows request error toast when backend test API fails", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Webhook disabled"));
    const { result } = renderHook(() => useTestWebhook(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync("wh-disabled");
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Webhook test request failed",
      {
        description: "Webhook disabled",
      },
    );
  });
});

// ===========================================================================
// useSLAReport
// ===========================================================================

describe("useSLAReport", () => {
  const mockSLAReport = {
    periodStart: "2026-01-01T00:00:00Z",
    periodEnd: "2026-02-01T00:00:00Z",
    generatedAt: "2026-02-01T00:00:00Z",
    components: [
      {
        component: "api_gateway",
        uptimeTarget: 99.9,
        uptimeActual: 99.99,
        latencyP99Actual: 180,
        totalRequests: 1000,
        totalErrors: 2,
      },
    ],
    violations: [],
    overallCompliance: true,
  };

  it("fetches SLA report with default period", async () => {
    mockApiClient.get.mockResolvedValue(mockSLAReport);
    const { result } = renderHook(() => useSLAReport(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/sla/report",
      { period: 30 },
    );
    expect(result.current.data).toMatchObject({
      period: "month",
      uptimePercent: 99.99,
      totalRequests: 1000,
      failedRequests: 2,
      complianceMet: true,
    });
  });

  it("accepts custom period", async () => {
    mockApiClient.get.mockResolvedValue(mockSLAReport);
    const { result } = renderHook(() => useSLAReport("quarter"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/sla/report",
      { period: 90 },
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useSLAReport(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useUsageMetrics
// ===========================================================================

describe("useUsageMetrics", () => {
  const mockAnalytics = {
    totalRequests: 50000,
    totalErrors: 10,
    averageLatencyMs: 45,
    endpointBreakdown: {
      "GET /api/v1/credentials": {
        count: 25000,
        errors: 5,
        avgLatencyMs: 32,
      },
    },
    dailyUsage: [{ date: "2026-01-01", requests: 1000, errors: 1 }],
  };

  it("fetches usage metrics with default period", async () => {
    mockApiClient.get.mockResolvedValue(mockAnalytics);
    const { result } = renderHook(() => useUsageMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/enterprise/usage", {
      period: 30,
    });
    expect(result.current.data).toMatchObject({
      period: "month",
      totalAPIRequests: 50000,
      breakdownByEndpoint: [
        {
          endpoint: "/api/v1/credentials",
          method: "GET",
          requestCount: 25000,
          avgResponseTimeMs: 32,
          errorCount: 5,
        },
      ],
    });
  });

  it("accepts custom period", async () => {
    mockApiClient.get.mockResolvedValue(mockAnalytics);
    const { result } = renderHook(() => useUsageMetrics("week"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/enterprise/usage", {
      period: 7,
    });
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useUsageMetrics(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
