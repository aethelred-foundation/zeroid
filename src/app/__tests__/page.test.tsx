import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock wagmi
jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  })),
}));

// Mock next/image
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt = "", priority: _priority, ...props }: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} {...props} />;
  },
}));

// Mock next/link
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: any, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const {
            initial,
            animate,
            exit,
            transition,
            whileHover,
            whileTap,
            variants,
            layout,
            layoutId,
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

// Mock hooks
jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: jest.fn(() => ({
    identity: { did: "did:aethelred:0x1234", displayName: "Test User" },
    isLoading: false,
    error: null,
  })),
}));

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: jest.fn(() => ({
    data: {
      credentials: [
        { id: "1", status: "active" },
        { id: "2", status: "active" },
      ],
    },
    isLoading: false,
  })),
}));

jest.mock("@/hooks/useVerification", () => ({
  useVerification: jest.fn(() => ({
    verificationHistory: [{ id: "1", timestamp: new Date().toISOString() }],
    isLoading: false,
  })),
}));

// Mock components
jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: any) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/components/ui/MetricCard", () => ({
  MetricCard: ({ label, value }: any) => (
    <div data-testid="metric-card">
      {label}: {value}
    </div>
  ),
}));

jest.mock("@/components/ui/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

jest.mock("@/components/identity/IdentityCard", () => ({
  __esModule: true,
  default: () => <div data-testid="identity-card">IdentityCard</div>,
}));

import DashboardPage from "../page";
import { useAccount } from "wagmi";

describe("DashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing when connected", () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays Dashboard heading when connected", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Your identity at a glance")).toBeInTheDocument();
  });

  it("shows welcome page when not connected", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Welcome to ZeroID")).toBeInTheDocument();
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
  });

  it("renders metric cards when connected", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    const metricCards = screen.getAllByTestId("metric-card");
    expect(metricCards.length).toBe(4);
  });

  it("does not render the decorative time-range selector (it filtered nothing)", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    expect(
      screen.queryByRole("button", { name: "24h" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "30d" }),
    ).not.toBeInTheDocument();
  });

  it("does not render fabricated network or score panels", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    expect(screen.queryByText("TEE Network")).not.toBeInTheDocument();
    expect(screen.queryByText("Privacy Score")).not.toBeInTheDocument();
    expect(screen.queryByText("SGX Enclaves")).not.toBeInTheDocument();
  });

  it("handles empty credentials data", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useCredentials } = require("@/hooks/useCredentials");
    useCredentials.mockReturnValue({ data: null, isLoading: false });
    render(<DashboardPage />);
    // stats.totalCredentials should be 0 when data is null
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("handles null credentials array", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useCredentials } = require("@/hooks/useCredentials");
    useCredentials.mockReturnValue({
      data: { credentials: null },
      isLoading: false,
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("handles mixed credential statuses", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useCredentials } = require("@/hooks/useCredentials");
    useCredentials.mockReturnValue({
      data: {
        credentials: [
          { id: "1", status: "active" },
          { id: "2", status: "expired" },
          { id: "3", status: "revoked" },
        ],
      },
      isLoading: false,
    });
    render(<DashboardPage />);
    // Active credentials should be 1 out of 3
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("handles null verificationHistory", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useVerification } = require("@/hooks/useVerification");
    useVerification.mockReturnValue({
      verificationHistory: null,
      isLoading: false,
    });
    render(<DashboardPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("derives recent activity from real credentials and verifications", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useCredentials } = require("@/hooks/useCredentials");
    useCredentials.mockReturnValue({
      data: {
        credentials: [
          {
            id: "c1",
            status: "active",
            typeLabel: "KYC Credential",
            issuerId: "aethelred-registry-record",
            issuedAt: new Date(Date.now() - 3600000).toISOString(),
          },
        ],
      },
      isLoading: false,
    });
    const { useVerification } = require("@/hooks/useVerification");
    useVerification.mockReturnValue({
      verificationHistory: [
        {
          id: "v1",
          proofType: "age",
          verifier: "EDGE data room",
          status: "completed",
          timestamp: new Date(Date.now() - 7200000).toISOString(),
        },
      ],
      isLoading: false,
    });
    render(<DashboardPage />);
    expect(screen.getByText("KYC Credential")).toBeInTheDocument();
    expect(
      screen.getByText("Issuer record: aethelred-registry-record"),
    ).toBeInTheDocument();
    expect(screen.getByText("age verification")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
  });

  it("shows an honest empty state when the account has no activity", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    const { useCredentials } = require("@/hooks/useCredentials");
    useCredentials.mockReturnValue({
      data: { credentials: [] },
      isLoading: false,
    });
    const { useVerification } = require("@/hooks/useVerification");
    useVerification.mockReturnValue({
      verificationHistory: [],
      isLoading: false,
    });
    render(<DashboardPage />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    // None of the old sample records may reappear.
    expect(
      screen.queryByText("Age Verification Credential"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Credit Tier Credential Renewed"),
    ).not.toBeInTheDocument();
  });

  it("renders welcome features when not connected", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Private by Default")).toBeInTheDocument();
    expect(screen.getByText("On-Chain Anchored")).toBeInTheDocument();
    expect(screen.getByText("Self-Sovereign")).toBeInTheDocument();
  });
});
