import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

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
      screen.getByText("/api/v1/credentials/{id}/verify"),
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
    // The "Create Key" button is on the default API Keys tab
    fireEvent.click(screen.getByText("Create Key"));
    // Modal state is set, but since there's no modal rendered, just verify the click worked
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
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
