import React from "react";
import { render, screen, within } from "@testing-library/react";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt = "", priority: _priority, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} {...props} />;
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, tag: string) =>
        React.forwardRef(function MockMotion(
          { children, initial, animate, transition, variants, ...props }: any,
          ref: React.ForwardedRef<HTMLElement>,
        ) {
          return React.createElement(tag, { ...props, ref }, children);
        }),
    },
  ),
}));

jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: jest.fn(),
}));

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: jest.fn(),
}));

jest.mock("@/hooks/useVerification", () => ({
  useVerificationHistory: jest.fn(),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/components/ui/MetricCard", () => ({
  MetricCard: ({
    label,
    value,
    subtitle,
  }: {
    label: string;
    value: string | number;
    subtitle?: string;
  }) => (
    <div data-testid="metric-card" data-value={String(value)}>
      <span>{label}</span>
      <span>{value}</span>
      {subtitle && <small>{subtitle}</small>}
    </div>
  ),
}));

import { useAccount } from "wagmi";
import { useCredentials } from "@/hooks/useCredentials";
import { useIdentity } from "@/hooks/useIdentity";
import { useVerificationHistory } from "@/hooks/useVerification";
import DashboardPage from "../page";

const mockUseAccount = useAccount as jest.Mock;
const mockUseCredentials = useCredentials as jest.Mock;
const mockUseIdentity = useIdentity as jest.Mock;
const mockUseVerificationHistory = useVerificationHistory as jest.Mock;

const credentialRecords = [
  {
    id: "credential-1",
    typeLabel: "KYC Level 2",
    issuerId: "issuer-record-1",
    status: "active",
    issuedAt: "2026-07-18T08:00:00.000Z",
  },
  {
    id: "credential-2",
    typeLabel: "Employment",
    issuerId: "issuer-record-2",
    status: "revoked",
    issuedAt: "2026-07-17T08:00:00.000Z",
  },
];

const verificationRecords = [
  {
    id: "verification-1",
    verificationType: "CREDENTIAL_CHECK",
    result: "VERIFIED",
    requestedAt: "2026-07-18T09:00:00.000Z",
    completedAt: "2026-07-18T09:01:00.000Z",
    verifierId: "verifier-record-1",
  },
];

function setReadyMocks() {
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
    status: "connected",
    isReconnecting: false,
  });
  mockUseIdentity.mockReturnValue({
    identity: {
      did: "did:aethelred:testnet:0x1234",
      hasIdentity: true,
      profile: {
        did: "did:aethelred:testnet:0x1234",
        status: "ACTIVE",
        teeAttested: true,
        governmentVerified: false,
        createdAt: "2026-07-01T10:00:00.000Z",
      },
    },
    isLoading: false,
    error: null,
  });
  mockUseCredentials.mockReturnValue({
    data: { credentials: credentialRecords, total: credentialRecords.length },
    accessState: "ready",
    isLoading: false,
    isSuccess: true,
    error: null,
  });
  mockUseVerificationHistory.mockReturnValue({
    data: { items: verificationRecords, total: verificationRecords.length },
    isLoading: false,
    isSuccess: true,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setReadyMocks();
});

describe("DashboardPage", () => {
  it("renders returned-record evidence without total or today claims", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Credential records returned")).toBeInTheDocument();
    expect(
      screen.getByText("Verification records returned"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Total Credentials")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Verifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Verifications Today")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("metric-card")).toHaveLength(4);
  });

  it("derives metrics only from the returned pages", () => {
    render(<DashboardPage />);
    const metrics = screen.getAllByTestId("metric-card");

    expect(metrics.map((metric) => metric.getAttribute("data-value"))).toEqual([
      "2",
      "1",
      "1",
      "1",
    ]);
    expect(screen.getAllByText("Current 100-record page")).toHaveLength(2);
  });

  it("uses the actual verification-history response fields", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Credential Check record")).toBeInTheDocument();
    expect(
      screen.getByText("Verifier record: verifier-record-1"),
    ).toBeInTheDocument();
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
    expect(mockUseVerificationHistory).toHaveBeenCalledWith(undefined, 1, 100);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("marks an invalid verification timestamp unavailable", () => {
    mockUseVerificationHistory.mockReturnValue({
      data: {
        items: [
          {
            ...verificationRecords[0],
            requestedAt: "not-a-date",
            completedAt: null,
          },
        ],
        total: 1,
      },
      isLoading: false,
      isSuccess: true,
      error: null,
    });

    render(<DashboardPage />);

    expect(screen.getByText("Timestamp unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Dated verification records").parentElement,
    ).toHaveAttribute("data-value", "0");
  });

  it("does not substitute zero metrics when identity sign-in is unavailable", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      accessState: "sign-in-required",
      isLoading: false,
      isSuccess: false,
      error: null,
    });
    mockUseVerificationHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      error: null,
    });

    render(<DashboardPage />);

    expect(
      screen.getByText("Authenticated identity session required"),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("metric-card")).toHaveLength(0);
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });

  it("distinguishes protected-source loading from an empty response", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      accessState: "ready",
      isLoading: true,
      isSuccess: false,
      error: null,
    });
    mockUseVerificationHistory.mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
      error: null,
    });

    render(<DashboardPage />);

    expect(
      screen.getByText("Loading protected records..."),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("metric-card")).toHaveLength(0);
  });

  it("renders endpoint errors instead of empty-state claims", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      accessState: "ready",
      isLoading: false,
      isSuccess: false,
      error: new Error("Credential API offline"),
    });
    mockUseVerificationHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      error: new Error("Verification API offline"),
    });

    render(<DashboardPage />);

    expect(
      screen.getByText("Protected record evidence unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Credential API offline/)).toBeInTheDocument();
    expect(screen.getByText(/Verification API offline/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("metric-card")).toHaveLength(0);
  });

  it("shows zero only after both endpoints successfully return empty pages", () => {
    mockUseCredentials.mockReturnValue({
      data: { credentials: [], total: 0 },
      accessState: "ready",
      isLoading: false,
      isSuccess: true,
      error: null,
    });
    mockUseVerificationHistory.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isSuccess: true,
      error: null,
    });

    render(<DashboardPage />);

    expect(screen.getAllByTestId("metric-card")).toHaveLength(4);
    expect(
      screen.getByText("Both protected endpoints returned empty record pages."),
    ).toBeInTheDocument();
  });

  it("shows backend and registry identity evidence without invented counts", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Identity evidence")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Verified evidence returned")).toBeInTheDocument();
    expect(
      screen.getByText("No verified evidence returned"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Credentials")).not.toBeInTheDocument();
    expect(screen.queryByText("Verifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Unverified")).not.toBeInTheDocument();
  });

  it("shows identity loading, failure, and unregistered states honestly", () => {
    mockUseIdentity.mockReturnValue({
      identity: { did: undefined, hasIdentity: false, profile: null },
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<DashboardPage />);
    expect(
      screen.getByText("Loading identity evidence..."),
    ).toBeInTheDocument();

    mockUseIdentity.mockReturnValue({
      identity: { did: undefined, hasIdentity: false, profile: null },
      isLoading: false,
      error: new Error("Identity API offline"),
    });
    rerender(<DashboardPage />);
    expect(
      screen.getByText("Identity evidence unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Identity API offline")).toBeInTheDocument();

    mockUseIdentity.mockReturnValue({
      identity: { did: undefined, hasIdentity: false, profile: null },
      isLoading: false,
      error: null,
    });
    rerender(<DashboardPage />);
    expect(
      screen.getByText(/No backend identity profile or registry DID/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create ZeroID/i }),
    ).toHaveAttribute("href", "/identity");
  });

  it("uses working core links and removes the unsupported holder request CTA", () => {
    render(<DashboardPage />);
    const quickActions = screen.getByRole("region", { name: "Quick actions" });

    expect(
      within(quickActions).getByRole("link", { name: /Manage Identity/i }),
    ).toHaveAttribute("href", "/identity");
    expect(
      within(quickActions).getByRole("link", { name: /View Credentials/i }),
    ).toHaveAttribute("href", "/credentials");
    expect(
      within(quickActions).getByRole("link", {
        name: /Run Eligibility Proof/i,
      }),
    ).toHaveAttribute("href", "/eligibility");
    expect(
      within(quickActions).getByRole("link", { name: /View Audit Records/i }),
    ).toHaveAttribute("href", "/audit");
    expect(screen.queryByText("Request Credential")).not.toBeInTheDocument();
    expect(screen.queryByText("Register AI Agent")).not.toBeInTheDocument();
  });

  it("shows a precise disconnected welcome state", () => {
    mockUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
      status: "disconnected",
      isReconnecting: false,
    });

    render(<DashboardPage />);

    expect(screen.getByText("Welcome to ZeroID")).toBeInTheDocument();
    expect(screen.getByText("Returned evidence")).toBeInTheDocument();
    expect(
      screen.queryByText("Credentials anchored on the Aethelred network"),
    ).not.toBeInTheDocument();
  });

  it("shows wallet reconnecting before choosing a connected or disconnected state", () => {
    mockUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
      status: "reconnecting",
      isReconnecting: true,
    });

    render(<DashboardPage />);

    expect(
      screen.getByText("Checking wallet connection..."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Welcome to ZeroID")).not.toBeInTheDocument();
  });

  it("shows readiness evidence without demo telemetry", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Dashboard readiness")).toBeInTheDocument();
    expect(
      screen.getByText(/bounded credential and verification records/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/demo telemetry/i)).not.toBeInTheDocument();
  });
});
