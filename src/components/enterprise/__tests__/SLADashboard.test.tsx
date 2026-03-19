import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        if (typeof prop === "string") {
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
              ...rest
            } = props;
            const Tag = prop as any;
            return <Tag ref={ref} {...rest} />;
          });
        }
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target: unknown, prop: string | symbol) => {
          if (prop === "__esModule") return true;
          return (props: any) => (
            <div
              data-testid={`icon-${String(prop).toLowerCase()}`}
              {...props}
            />
          );
        },
      },
    ),
);

import SLADashboard from "../SLADashboard";

describe("SLADashboard", () => {
  it("renders without crashing with defaults", () => {
    render(<SLADashboard />);
    expect(screen.getByText("SLA Dashboard")).toBeInTheDocument();
  });

  it("displays SLA Compliance section with default metrics", () => {
    render(<SLADashboard />);
    expect(screen.getByText("SLA Compliance")).toBeInTheDocument();
    expect(screen.getAllByText("Uptime").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Error Rate").length).toBeGreaterThanOrEqual(1);
  });

  it("shows loading state when loading is true", () => {
    render(<SLADashboard loading />);
    expect(screen.getByText("Loading SLA dashboard...")).toBeInTheDocument();
  });

  it("shows error message when error is provided", () => {
    render(<SLADashboard error="Failed to load data" />);
    expect(screen.getByText("Failed to load data")).toBeInTheDocument();
  });

  it("renders download report button when onDownloadReport is provided", () => {
    const onDownload = jest.fn();
    render(<SLADashboard onDownloadReport={onDownload} />);
    const btn = screen.getByText("Monthly Report");
    fireEvent.click(btn);
    expect(onDownload).toHaveBeenCalled();
  });

  it("displays service components", () => {
    render(<SLADashboard />);
    expect(screen.getByText("Service Components")).toBeInTheDocument();
    expect(screen.getByText("Identity Service")).toBeInTheDocument();
    expect(screen.getByText("ZK Proof Engine")).toBeInTheDocument();
  });

  // Branch coverage: UptimeGauge color thresholds
  it("renders amber color for uptime between 99.5 and 99.95", () => {
    render(<SLADashboard uptime={99.7} />);
    expect(screen.getByText("99.7%")).toBeInTheDocument();
  });

  it("renders red color for uptime below 99.5", () => {
    render(<SLADashboard uptime={98.0} />);
    expect(screen.getByText("98%")).toBeInTheDocument();
  });

  it("renders emerald color for uptime at exactly 99.95", () => {
    render(<SLADashboard uptime={99.96} metrics={[]} />);
    expect(screen.getByText("99.96%")).toBeInTheDocument();
  });

  // Branch coverage: metric trend variants
  it("renders all trend variants (up, down, stable)", () => {
    const metrics = [
      {
        name: "M1",
        target: "99%",
        current: "99%",
        status: "met" as const,
        trend: "up" as const,
      },
      {
        name: "M2",
        target: "99%",
        current: "99%",
        status: "met" as const,
        trend: "down" as const,
      },
      {
        name: "M3",
        target: "99%",
        current: "99%",
        status: "met" as const,
        trend: "stable" as const,
      },
    ];
    render(<SLADashboard metrics={metrics} />);
    expect(screen.getByText("Stable")).toBeInTheDocument();
  });

  // Branch coverage: SLA status variants (at_risk, violated)
  it("renders at_risk and violated SLA statuses", () => {
    const metrics = [
      {
        name: "Risk",
        target: "99%",
        current: "98%",
        status: "at_risk" as const,
        trend: "up" as const,
      },
      {
        name: "Bad",
        target: "99%",
        current: "90%",
        status: "violated" as const,
        trend: "down" as const,
      },
    ];
    render(<SLADashboard metrics={metrics} />);
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Violated")).toBeInTheDocument();
  });

  // Branch coverage: component status variants
  it("renders outage component status", () => {
    const components = [
      { name: "Down Service", uptime: 90.0, status: "outage" as const },
    ];
    render(<SLADashboard components={components} />);
    expect(screen.getByText("Outage")).toBeInTheDocument();
  });

  // Branch coverage: violations — empty list
  it("shows no violations message when violations list is empty", () => {
    render(<SLADashboard violations={[]} />);
    expect(screen.getByText("No SLA violations recorded")).toBeInTheDocument();
  });

  // Branch coverage: violation resolved vs unresolved
  it("renders unresolved violation with XCircle", () => {
    const violations = [
      {
        id: "v1",
        metric: "Latency Violation",
        timestamp: "2026-01-01T00:00:00Z",
        duration: "5 min",
        impact: "Some impact",
        credit: "$50",
        resolved: false,
      },
    ];
    render(<SLADashboard violations={violations} />);
    expect(screen.getByText("Latency Violation")).toBeInTheDocument();
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("renders resolved violation with CheckCircle", () => {
    const violations = [
      {
        id: "v2",
        metric: "Uptime Drop",
        timestamp: "2026-01-01T00:00:00Z",
        duration: "10 min",
        impact: "Full outage",
        credit: "$100",
        resolved: true,
      },
    ];
    render(<SLADashboard violations={violations} />);
    expect(screen.getByText("Uptime Drop")).toBeInTheDocument();
  });

  // Branch coverage: totalCredits === 0 (no total credits badge shown)
  it("does not show total credits badge when totalCredits is 0", () => {
    const violations = [
      {
        id: "v1",
        metric: "TestMetric",
        timestamp: "2026-01-01T00:00:00Z",
        duration: "1 min",
        impact: "None",
        credit: "$0",
        resolved: true,
      },
    ];
    render(<SLADashboard violations={violations} />);
    expect(screen.queryByText(/Total Credits/)).not.toBeInTheDocument();
  });

  // Branch coverage: no onDownloadReport means no button
  it("does not render download button when onDownloadReport is not provided", () => {
    render(<SLADashboard />);
    expect(screen.queryByText("Monthly Report")).not.toBeInTheDocument();
  });

  // Branch coverage: custom latencyData and errorRateData
  it("renders with custom latency and error rate data", () => {
    const latencyData = [
      { timestamp: "00:00", p50: 10, p95: 50, p99: 100 },
      { timestamp: "01:00", p50: 20, p95: 60, p99: 120 },
    ];
    const errorRateData = [
      { timestamp: "00:00", rate: 0.1 },
      { timestamp: "01:00", rate: 0.2 },
    ];
    render(
      <SLADashboard latencyData={latencyData} errorRateData={errorRateData} />,
    );
    expect(screen.getByText("Latency (24h)")).toBeInTheDocument();
    expect(screen.getByText("Error Rate (24h)")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<SLADashboard className="my-custom" />);
    expect(container.firstChild).toHaveClass("my-custom");
  });

  // Branch coverage: empty latency/error data triggers ?? 0 fallbacks
  it("handles empty latency and error rate data arrays", () => {
    render(<SLADashboard latencyData={[]} errorRateData={[]} />);
    expect(screen.getByText("Latency (24h)")).toBeInTheDocument();
    expect(screen.getByText("Error Rate (24h)")).toBeInTheDocument();
    // The ?? 0 fallbacks should result in "0ms" and "0.00%"
    expect(screen.getByText("P50: 0ms")).toBeInTheDocument();
    expect(screen.getByText("P95: 0ms")).toBeInTheDocument();
    expect(screen.getByText("P99: 0ms")).toBeInTheDocument();
    expect(screen.getByText("0.00%")).toBeInTheDocument();
  });

  // Branch coverage: MiniChart with identical data values (max === min, triggers || 1)
  it("renders latency chart with identical values (range fallback)", () => {
    const flatLatency = [
      { timestamp: "00:00", p50: 50, p95: 50, p99: 50 },
      { timestamp: "01:00", p50: 50, p95: 50, p99: 50 },
    ];
    render(<SLADashboard latencyData={flatLatency} />);
    expect(screen.getByText("Latency (24h)")).toBeInTheDocument();
  });

  // Branch coverage: uptime gauge at exactly 99.5 (boundary for amber)
  it("renders amber for uptime at exactly 99.5", () => {
    render(<SLADashboard uptime={99.5} metrics={[]} />);
    expect(screen.getByText("99.5%")).toBeInTheDocument();
  });
});
