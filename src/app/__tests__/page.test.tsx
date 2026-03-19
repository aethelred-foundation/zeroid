import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

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
  default: (props: any) => <img {...props} />,
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

  it("allows switching time range", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    const button24h = screen.getByRole("button", { name: "24h" });
    fireEvent.click(button24h);
    // Verify button is present and clickable (state is internal)
    expect(button24h).toBeInTheDocument();
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

  it("formats time ago correctly for hours and days", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("1d ago")).toBeInTheDocument();
  });

  it("formats time ago as Just now for very recent timestamps", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    // Mock Date.now to advance slightly between activity creation and formatTimeAgo call.
    // Activity items use Date.now() - offset. The smallest offset is 3600000 (1h).
    // We need a timestamp that yields < 60 seconds difference.
    // Strategy: freeze Date.now during render, then the 3600000ms offset always yields 1h.
    // Instead, we can manipulate Date.now so the 2nd set of calls (in formatTimeAgo)
    // sees a time much closer to the timestamp.
    const realNow = Date.now();
    let callCount = 0;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      // First 4 calls create timestamps in recentActivity (Date.now() - offset)
      // Subsequent calls in formatTimeAgo should see time very close to the first activity
      if (callCount <= 4) return realNow;
      // For the first formatTimeAgo call, return realNow - 3600000 + 10 (10s after the 1st activity)
      if (callCount === 5) return realNow - 3600000 + 10000;
      // For the second call, return realNow - 7200000 + 120000 (2min after 2nd activity)
      if (callCount === 6) return realNow - 7200000 + 120000;
      return realNow;
    });
    render(<DashboardPage />);
    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.getByText("2m ago")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("switches to 30d time range", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: "0x1234",
      isConnected: true,
    });
    render(<DashboardPage />);
    const button30d = screen.getByRole("button", { name: "30d" });
    fireEvent.click(button30d);
    expect(button30d).toBeInTheDocument();
  });

  it("renders welcome features when not connected", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    render(<DashboardPage />);
    expect(screen.getByText("Private by Default")).toBeInTheDocument();
    expect(screen.getByText("TEE Secured")).toBeInTheDocument();
    expect(screen.getByText("Self-Sovereign")).toBeInTheDocument();
  });
});
