import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockApiKeysRefetch = jest.fn();
const mockCreateAPIKeyMutateAsync = jest.fn();
const mockRevokeAPIKeyMutate = jest.fn();
const mockRegisterWebhookMutateAsync = jest.fn();
const mockTestWebhookMutate = jest.fn();

const mockApiKeys = [
  {
    id: "k1",
    name: "Production - Main",
    keyPrefix: "zid_live_",
    scopes: ["credentials:read", "verification:write", "identity:read"],
    environment: "production",
    ipAllowlist: [],
    dailyQuota: 100_000,
    monthlyQuota: 3_000_000,
    rateLimit: { requestsPerSecond: 200, burstSize: 500 },
    createdAt: "2026-01-15T00:00:00.000Z",
    lastUsedAt: "2026-06-26T10:00:00.000Z",
    active: true,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
  },
  {
    id: "k2",
    name: "Sandbox - Testing",
    keyPrefix: "zid_test_",
    scopes: ["credentials:read"],
    environment: "sandbox",
    ipAllowlist: [],
    dailyQuota: 10_000,
    monthlyQuota: 100_000,
    rateLimit: { requestsPerSecond: 50, burstSize: 100 },
    createdAt: "2026-02-01T00:00:00.000Z",
    lastUsedAt: null,
    active: true,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
  },
];

const mockWebhooks = [
  {
    id: "w1",
    url: "https://api.example.com/webhooks/zeroid",
    events: ["credential.issued", "verification.completed"],
    createdAt: "2026-01-15T00:00:00.000Z",
    active: true,
    enabled: true,
    health: {
      status: "healthy",
      successRate: 99.8,
      lastDeliveryAt: "2026-06-26T10:00:00.000Z",
    },
  },
  {
    id: "w2",
    url: "https://edge.example.com/webhooks/zeroid",
    events: ["credential.revoked"],
    createdAt: "2026-01-16T00:00:00.000Z",
    active: true,
  },
];

const mockSlaReport = {
  period: "month",
  startDate: "2026-05-26T00:00:00.000Z",
  endDate: "2026-06-26T00:00:00.000Z",
  uptimePercent: 99.97,
  uptimeTarget: 99.95,
  avgResponseTimeMs: 42,
  p99ResponseTimeMs: 412,
  totalRequests: 4_100_000,
  failedRequests: 1_230,
  errorRate: 0.03,
  incidentCount: 0,
  incidents: [],
  complianceMet: true,
};

const mockUsageMetrics = {
  period: "week",
  startDate: "2026-06-19T00:00:00.000Z",
  endDate: "2026-06-26T00:00:00.000Z",
  totalAPIRequests: 93_500,
  uniqueIdentities: 0,
  credentialsIssued: 0,
  credentialsVerified: 0,
  proofsGenerated: 0,
  agentActions: 0,
  bandwidthMB: 0,
  costEstimateUSD: 0,
  breakdownByEndpoint: [
    {
      endpoint: "/api/v1/credentials/{id}/verify",
      method: "POST",
      requestCount: 48_293,
      avgResponseTimeMs: 38,
      errorCount: 5,
    },
  ],
  breakdownByDay: [
    {
      date: "2026-06-22T00:00:00.000Z",
      requests: 12_400,
      uniqueUsers: 0,
      errors: 2,
    },
    {
      date: "2026-06-23T00:00:00.000Z",
      requests: 15_200,
      uniqueUsers: 0,
      errors: 4,
    },
  ],
};

jest.mock("@/hooks/useEnterprise", () => ({
  useAPIKeys: () => ({
    data: mockApiKeys,
    isLoading: false,
    error: null,
    refetch: mockApiKeysRefetch,
  }),
  useCreateAPIKey: () => ({
    mutateAsync: mockCreateAPIKeyMutateAsync,
    isPending: false,
  }),
  useRevokeAPIKey: () => ({
    mutate: mockRevokeAPIKeyMutate,
    isPending: false,
  }),
  useRegisterWebhook: () => ({
    mutateAsync: mockRegisterWebhookMutateAsync,
    isPending: false,
  }),
  useSLAReport: () => ({
    data: mockSlaReport,
    isLoading: false,
    error: null,
  }),
  useTestWebhook: () => ({
    mutate: mockTestWebhookMutate,
    isPending: false,
  }),
  useUsageMetrics: () => ({
    data: mockUsageMetrics,
    isLoading: false,
    error: null,
  }),
  useWebhooks: () => ({
    data: mockWebhooks,
    isLoading: false,
    error: null,
  }),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) =>
        React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        }),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import EnterprisePage from "../page";

function selectTab(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("EnterprisePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAPIKeyMutateAsync.mockResolvedValue({
      ...mockApiKeys[0],
      id: "created-key",
      name: "Created production key",
      secret: "zid_live_secret_created",
    });
    mockRegisterWebhookMutateAsync.mockResolvedValue(mockWebhooks[0]);
  });

  it("renders only backend-backed enterprise capabilities", () => {
    render(<EnterprisePage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Console")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "API Keys" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Webhooks" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Team (RBAC)")).not.toBeInTheDocument();
    expect(screen.queryByText("SDK & Docs")).not.toBeInTheDocument();
    expect(screen.queryByText("OIDC Integration")).not.toBeInTheDocument();
    expect(screen.queryByText("Enterprise Billing")).not.toBeInTheDocument();
  });

  it("shows exact SLA values without estimating missing percentiles", () => {
    render(<EnterprisePage />);

    expect(screen.getByText("P99 latency")).toBeInTheDocument();
    expect(screen.getByText("412ms")).toBeInTheDocument();
    expect(screen.queryByText("P50")).not.toBeInTheDocument();
    expect(screen.queryByText("P95")).not.toBeInTheDocument();

    selectTab("SLA Report");
    expect(screen.getAllByText("99.97%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("4,100,000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1,230")).toBeInTheDocument();
    expect(screen.getByText("SLA met")).toBeInTheDocument();
  });

  it("filters API keys by the selected environment", () => {
    render(<EnterprisePage />);
    expect(screen.getByText("Production - Main")).toBeInTheDocument();
    expect(screen.queryByText("Sandbox - Testing")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Switch API key environment" }),
    );
    expect(screen.getByText("Sandbox - Testing")).toBeInTheDocument();
    expect(screen.queryByText("Production - Main")).not.toBeInTheDocument();
  });

  it("never exposes secrets returned by the API key inventory", () => {
    render(<EnterprisePage />);
    expect(screen.getByText(/zid_live_\*{12}/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy secret/i }),
    ).not.toBeInTheDocument();
  });

  it("refreshes and revokes keys through enterprise hooks", () => {
    render(<EnterprisePage />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    fireEvent.click(screen.getByTitle("Revoke API key"));

    expect(mockApiKeysRefetch).toHaveBeenCalledTimes(1);
    expect(mockRevokeAPIKeyMutate).toHaveBeenCalledWith("k1");
  });

  it("creates a key and keeps its one-time secret in an explicit confirmation", async () => {
    render(<EnterprisePage />);
    fireEvent.click(screen.getByRole("button", { name: "Create Key" }));
    fireEvent.change(
      screen.getByPlaceholderText("production identity verification"),
      { target: { value: "EDGE production verifier" } },
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create Key" }).at(-1)!,
    );

    await waitFor(() =>
      expect(mockCreateAPIKeyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "EDGE production verifier",
          environment: "production",
          scopes: ["credentials:read", "verification:write", "identity:read"],
        }),
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "API key created" }),
    ).toBeInTheDocument();
    expect(screen.getByText("zid_live_secret_created")).toBeInTheDocument();
  });

  it("copies only the newly created one-time secret", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<EnterprisePage />);
    fireEvent.click(screen.getByRole("button", { name: "Create Key" }));
    fireEvent.change(
      screen.getByPlaceholderText("production identity verification"),
      { target: { value: "EDGE production verifier" } },
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create Key" }).at(-1)!,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy secret" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("zid_live_secret_created"),
    );
  });

  it("shows unreported webhook health honestly", () => {
    render(<EnterprisePage />);
    selectTab("Webhooks");

    expect(screen.getByText("99.8% success")).toBeInTheDocument();
    expect(screen.getByText("Success rate not reported")).toBeInTheDocument();
  });

  it("registers and tests webhooks through enterprise hooks", async () => {
    render(<EnterprisePage />);
    selectTab("Webhooks");
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    fireEvent.change(
      screen.getByPlaceholderText("https://enterprise.example/hooks/zeroid"),
      { target: { value: "https://edge.example/hooks/zeroid" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Register Endpoint" }));

    await waitFor(() =>
      expect(mockRegisterWebhookMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://edge.example/hooks/zeroid",
          events: expect.arrayContaining([
            "credential.issued",
            "verification.completed",
          ]),
          active: true,
        }),
      ),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Test delivery" })[0],
    );
    expect(mockTestWebhookMutate).toHaveBeenCalledWith("w1");
  });

  it("renders usage reported by the enterprise endpoint", () => {
    render(<EnterprisePage />);
    selectTab("Usage");

    expect(screen.getByText("93,500 requests reported")).toBeInTheDocument();
    expect(
      screen.getByText("POST /api/v1/credentials/{id}/verify"),
    ).toBeInTheDocument();
    expect(screen.getByText("48,293")).toBeInTheDocument();
    expect(screen.getByText("38ms")).toBeInTheDocument();
  });
});
