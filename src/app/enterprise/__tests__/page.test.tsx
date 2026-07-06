import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/enterprise",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  })),
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
  useWriteContract: jest.fn(() => ({
    writeContractAsync: jest.fn(),
    isPending: false,
  })),
  useWaitForTransactionReceipt: jest.fn(() => ({ isLoading: false })),
}));

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
    metadata: { calls: "142847" },
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
    metadata: { calls: "3241" },
  },
];

const mockWebhooks = [
  {
    id: "w1",
    url: "https://api.acme-corp.com/webhooks/zeroid",
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
  uniqueIdentities: 1280,
  credentialsIssued: 3200,
  credentialsVerified: 18_400,
  proofsGenerated: 4100,
  agentActions: 0,
  bandwidthMB: 820,
  costEstimateUSD: 2847,
  breakdownByEndpoint: [
    {
      endpoint: "/api/v1/credentials/{id}/verify",
      method: "POST",
      requestCount: 48293,
      avgResponseTimeMs: 38,
      errorCount: 5,
    },
  ],
  breakdownByDay: [
    {
      date: "2026-06-22T00:00:00.000Z",
      requests: 12400,
      uniqueUsers: 140,
      errors: 2,
    },
    {
      date: "2026-06-23T00:00:00.000Z",
      requests: 15200,
      uniqueUsers: 150,
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
      get: (_target: unknown, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const {
            initial,
            animate,
            exit,
            transition,
            whileHover,
            whileTap,
            variants,
            ...rest
          } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
  useInView: () => true,
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import EnterprisePage from "../page";

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

  it("renders without crashing", () => {
    render(<EnterprisePage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<EnterprisePage />);
    expect(screen.getByText("Enterprise Admin Console")).toBeInTheDocument();
  });

  it("shows metric cards", () => {
    render(<EnterprisePage />);
    expect(screen.getByText("Uptime")).toBeInTheDocument();
    expect(screen.getByText("P95 Latency")).toBeInTheDocument();
    expect(screen.getByText("Error Rate")).toBeInTheDocument();
    expect(screen.getByText("API Calls/min")).toBeInTheDocument();
    expect(screen.getByText("Team Members")).toBeInTheDocument();
  });

  it("shows API Keys tab content by default", () => {
    render(<EnterprisePage />);
    expect(screen.getAllByText("API Keys").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Production - Main")).toBeInTheDocument();
  });

  it("switches to Webhooks tab", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const webhooksTab = tabButtons.find(
      (btn) => btn.textContent === "Webhooks",
    );
    fireEvent.click(webhooksTab!);
    expect(screen.getByText("Webhook Endpoints")).toBeInTheDocument();
  });

  it("switches to Team (RBAC) tab", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const teamTab = tabButtons.find((btn) => btn.textContent === "Team (RBAC)");
    fireEvent.click(teamTab!);
    expect(screen.getAllByText("Team Members").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("Sarah Chen")).toBeInTheDocument();
  });

  it("toggles environment between production and sandbox and back", () => {
    render(<EnterprisePage />);
    const envButton = screen.getByText("Production");
    fireEvent.click(envButton);
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    // Click again to toggle back to production
    fireEvent.click(screen.getByText("Sandbox"));
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("switches to SLA Monitor tab and shows uptime gauge", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const slaTab = tabButtons.find((btn) => btn.textContent === "SLA Monitor");
    fireEvent.click(slaTab!);
    expect(screen.getByText("Uptime (30d)")).toBeInTheDocument();
    expect(screen.getAllByText("99.97%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Latency Percentiles")).toBeInTheDocument();
    expect(screen.getAllByText("Error Rate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Within SLA")).toBeInTheDocument();
  });

  it("switches to Usage Analytics tab and shows chart and endpoints", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const usageTab = tabButtons.find(
      (btn) => btn.textContent === "Usage Analytics",
    );
    fireEvent.click(usageTab!);
    expect(screen.getByText("API Calls This Week")).toBeInTheDocument();
    expect(screen.getByText("Top Endpoints")).toBeInTheDocument();
    expect(
      screen.getByText(/\/api\/v1\/credentials\/\{id\}\/verify/),
    ).toBeInTheDocument();
  });

  it("switches to SDK & Docs tab and shows SDK downloads", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const sdkTab = tabButtons.find((btn) => btn.textContent === "SDK & Docs");
    fireEvent.click(sdkTab!);
    expect(screen.getByText("SDK Downloads")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByText("Go")).toBeInTheDocument();
    // Check OIDC section
    expect(screen.getByText("OIDC Integration")).toBeInTheDocument();
    // Check billing section
    expect(screen.getByText("Enterprise Billing")).toBeInTheDocument();
  });

  it("toggles API key visibility", () => {
    render(<EnterprisePage />);
    // API keys are shown by default with masked values containing asterisks
    const maskedKeys = screen.getAllByText(/\*{12}/);
    expect(maskedKeys.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("shown once at creation").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/zid_live_sk_/i)).not.toBeInTheDocument();
  });

  it("does not expose stored API key secrets for copying", () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    render(<EnterprisePage />);
    expect(
      screen.getAllByText("shown once at creation").length,
    ).toBeGreaterThan(0);
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("shows team RBAC permissions table", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const teamTab = tabButtons.find((btn) => btn.textContent === "Team (RBAC)");
    fireEvent.click(teamTab!);
    expect(screen.getByText("Role Permissions")).toBeInTheDocument();
    expect(screen.getByText("Manage API Keys")).toBeInTheDocument();
    expect(screen.getByText("View Credentials")).toBeInTheDocument();
    expect(screen.getByText("Invite Member")).toBeInTheDocument();
  });

  it("switches SDK language when clicking SDK buttons", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const sdkTab = tabButtons.find((btn) => btn.textContent === "SDK & Docs");
    fireEvent.click(sdkTab!);
    // Click Python SDK
    fireEvent.click(screen.getByText("Python"));
    expect(screen.getByText(/Quick Start — Python/)).toBeInTheDocument();
  });

  it("opens create key modal when clicking Create Key button", () => {
    render(<EnterprisePage />);
    fireEvent.click(screen.getByText("Create Key"));
    expect(
      screen.getByRole("dialog", { name: "Create API key" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("production identity verification"),
    ).toBeInTheDocument();
  });

  it("submits create key requests to the enterprise hook", async () => {
    render(<EnterprisePage />);
    fireEvent.click(screen.getByText("Create Key"));
    fireEvent.change(
      screen.getByPlaceholderText("production identity verification"),
      {
        target: { value: "EDGE production verifier" },
      },
    );
    fireEvent.click(screen.getAllByText("Create Key").at(-1)!);

    await waitFor(() => {
      expect(mockCreateAPIKeyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "EDGE production verifier",
          environment: "production",
          scopes: ["credentials:read", "verification:write", "identity:read"],
        }),
      );
    });
  });

  it("revokes API keys through the enterprise hook", () => {
    render(<EnterprisePage />);
    fireEvent.click(screen.getByTitle("Revoke API key"));
    expect(mockRevokeAPIKeyMutate).toHaveBeenCalledWith("k1");
  });

  it("registers webhook endpoints through the enterprise hook", async () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const webhooksTab = tabButtons.find(
      (btn) => btn.textContent === "Webhooks",
    );
    fireEvent.click(webhooksTab!);
    fireEvent.click(screen.getByText("Add Endpoint"));
    fireEvent.change(
      screen.getByPlaceholderText("https://enterprise.example/hooks/zeroid"),
      {
        target: { value: "https://edge.example/hooks/zeroid" },
      },
    );
    fireEvent.click(screen.getByText("Register Endpoint"));

    await waitFor(() => {
      expect(mockRegisterWebhookMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://edge.example/hooks/zeroid",
          events: expect.arrayContaining([
            "credential.issued",
            "verification.completed",
          ]),
          active: true,
        }),
      );
    });
  });

  it("tests webhook delivery through the enterprise hook", () => {
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const webhooksTab = tabButtons.find(
      (btn) => btn.textContent === "Webhooks",
    );
    fireEvent.click(webhooksTab!);
    fireEvent.click(screen.getByText("Test"));
    expect(mockTestWebhookMutate).toHaveBeenCalledWith("w1");
  });

  it("toggles API key visibility off again (reveal then hide)", () => {
    render(<EnterprisePage />);
    expect(screen.getAllByText(/\*{12}/).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("shown once at creation").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/zid_live_sk_/i)).not.toBeInTheDocument();
  });

  it("copies SDK snippet to clipboard and clears copied state after timeout", () => {
    jest.useFakeTimers();
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    render(<EnterprisePage />);
    const tabButtons = screen.getAllByRole("button");
    const sdkTab = tabButtons.find((btn) => btn.textContent === "SDK & Docs");
    fireEvent.click(sdkTab!);
    // Click the Copy button next to Quick Start
    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[copyButtons.length - 1]);
    expect(writeTextMock).toHaveBeenCalled();
    // Advance timer to trigger setCopiedKey(null) callback
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    jest.useRealTimers();
  });
});
