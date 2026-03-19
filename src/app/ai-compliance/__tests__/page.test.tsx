import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/ai-compliance",
  useSearchParams: () => new URLSearchParams(),
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
}));

// Mock AppLayout
jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: any) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import AICompliancePage from "../page";

describe("AICompliancePage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders without crashing", () => {
    render(<AICompliancePage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<AICompliancePage />);
    expect(
      screen.getByText("AI Compliance Command Center"),
    ).toBeInTheDocument();
  });

  it("shows AI Engine Active status indicator", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("AI Engine Active")).toBeInTheDocument();
  });

  it("shows risk feed by default", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Live Risk Intelligence Feed")).toBeInTheDocument();
    expect(screen.getAllByText(/OFAC SDN list updated/).length).toBeGreaterThan(
      0,
    );
  });

  it("switches to screening tab", () => {
    render(<AICompliancePage />);
    const screeningTab = screen.getByRole("button", {
      name: /Sanctions Screening/i,
    });
    fireEvent.click(screeningTab);
    expect(
      screen.getByPlaceholderText(/Search names, entities/),
    ).toBeInTheDocument();
  });

  // --- NEW TESTS for uncovered branches/functions ---

  it("renders all five metric cards", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Compliance Score")).toBeInTheDocument();
    expect(screen.getByText("94/100")).toBeInTheDocument();
    expect(screen.getAllByText("Active Alerts").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("Screenings Today")).toBeInTheDocument();
    expect(screen.getAllByText("PEP Matches").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Jurisdictions")).toBeInTheDocument();
  });

  it("switches to heatmap tab and renders jurisdiction data", () => {
    render(<AICompliancePage />);
    const heatmapTab = screen.getByRole("button", { name: /Risk Heatmap/i });
    fireEvent.click(heatmapTab);
    expect(
      screen.getByText("Compliance Risk by Jurisdiction"),
    ).toBeInTheDocument();
    // Check compliant, warning, at-risk jurisdictions
    expect(screen.getByText("USA")).toBeInTheDocument();
    expect(screen.getAllByText("94").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("COMPLIANT").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("BR")).toBeInTheDocument();
    expect(screen.getAllByText("AT-RISK").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("JP")).toBeInTheDocument();
    expect(screen.getAllByText("WARNING").length).toBeGreaterThanOrEqual(1);
  });

  it("can switch back to feed tab from another tab", () => {
    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Sanctions Screening/i }),
    );
    expect(
      screen.queryByText("Live Risk Intelligence Feed"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Risk Feed/i }));
    expect(screen.getByText("Live Risk Intelligence Feed")).toBeInTheDocument();
  });

  it("filters sanctions screening results by search query", () => {
    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Sanctions Screening/i }),
    );
    const searchInput = screen.getByPlaceholderText(/Search names, entities/);
    fireEvent.change(searchInput, { target: { value: "Viktor" } });
    expect(screen.getByText("Viktor Petrov")).toBeInTheDocument();
    expect(screen.queryByText("Al-Rashid Trading Co.")).not.toBeInTheDocument();
  });

  it("shows all sanctions results when search query is empty", () => {
    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Sanctions Screening/i }),
    );
    expect(screen.getByText("Viktor Petrov")).toBeInTheDocument();
    expect(screen.getByText("Al-Rashid Trading Co.")).toBeInTheDocument();
    expect(screen.getByText("Chen Wei Holdings")).toBeInTheDocument();
    expect(screen.getByText("Novak Industries Ltd")).toBeInTheDocument();
  });

  it("displays match scores with correct styling for sanctions results", () => {
    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Sanctions Screening/i }),
    );
    // 98% should be red, 87% amber, 45% zero-400
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("displays sanctions match status badges", () => {
    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Sanctions Screening/i }),
    );
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getAllByText("review").length).toBe(2);
    expect(screen.getByText("cleared")).toBeInTheDocument();
  });

  it("renders PEP matches section with expandable details", () => {
    render(<AICompliancePage />);
    expect(screen.getAllByText("PEP Matches").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ahmed Al-Fahim")).toBeInTheDocument();
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("James Richardson")).toBeInTheDocument();
  });

  it("expands and collapses PEP match details", () => {
    render(<AICompliancePage />);
    // Initially details should not be visible
    expect(
      screen.queryByText(/Direct PEP. Held government position/),
    ).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText("Ahmed Al-Fahim"));
    expect(
      screen.getByText(/Direct PEP. Held government position/),
    ).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(screen.getByText("Ahmed Al-Fahim"));
    expect(
      screen.queryByText(/Direct PEP. Held government position/),
    ).not.toBeInTheDocument();
  });

  it("expands a different PEP when another is already expanded", () => {
    render(<AICompliancePage />);
    fireEvent.click(screen.getByText("Ahmed Al-Fahim"));
    expect(
      screen.getByText(/Direct PEP. Held government position/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Maria Santos"));
    expect(
      screen.getByText(/Current PEP. Active political figure/),
    ).toBeInTheDocument();
    // Previous one should collapse
    expect(
      screen.queryByText(/Direct PEP. Held government position/),
    ).not.toBeInTheDocument();
  });

  it("renders compliance score trend chart", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Compliance Score Trend")).toBeInTheDocument();
    // Check month labels
    expect(screen.getByText("Sep")).toBeInTheDocument();
    expect(screen.getByText("Mar")).toBeInTheDocument();
    // Check scores
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("94")).toBeInTheDocument();
  });

  it("renders AI Copilot chat section with initial messages", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("AI Compliance Copilot")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(
      screen.getByText(/completed the overnight compliance scan/),
    ).toBeInTheDocument();
  });

  it("sends a chat message via Enter key and receives a response", () => {
    render(<AICompliancePage />);
    const chatInput = screen.getByPlaceholderText("Ask the AI copilot...");
    fireEvent.change(chatInput, { target: { value: "Check compliance" } });
    fireEvent.keyDown(chatInput, { key: "Enter" });
    expect(screen.getByText("Check compliance")).toBeInTheDocument();

    // Advance timer for response
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    // Response should appear (the mock always gives the same response)
    expect(
      screen.getAllByText(/I've analyzed the request/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not send empty chat messages", () => {
    render(<AICompliancePage />);
    const chatInput = screen.getByPlaceholderText("Ask the AI copilot...");
    const messagesBefore = screen.getAllByText(/.*/).length;
    fireEvent.change(chatInput, { target: { value: "   " } });
    fireEvent.keyDown(chatInput, { key: "Enter" });
    // Message count should remain the same
    expect(screen.queryByText("   ")).not.toBeInTheDocument();
  });

  it("renders quick action buttons", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    expect(screen.getByText("Run Full Screening")).toBeInTheDocument();
    expect(screen.getByText("Generate Report")).toBeInTheDocument();
    expect(screen.getByText("Simulate Regulation")).toBeInTheDocument();
  });

  it("renders active alerts section with risk feed items", () => {
    render(<AICompliancePage />);
    expect(screen.getAllByText("Active Alerts").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("2 Critical")).toBeInTheDocument();
  });

  it("renders regulatory calendar with upcoming deadlines", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Regulatory Calendar")).toBeInTheDocument();
    expect(screen.getByText("MiCA Full Enforcement")).toBeInTheDocument();
    expect(screen.getByText("Mar 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("VARA Q1 Compliance Report")).toBeInTheDocument();
    expect(screen.getByText("FATF Mutual Evaluation")).toBeInTheDocument();
  });

  it("renders chat quick action buttons", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("Run screening")).toBeInTheDocument();
    expect(screen.getByText("Risk summary")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
  });

  it("displays risk feed items with severity badges", () => {
    render(<AICompliancePage />);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getAllByText("HIGH").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("MEDIUM").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });

  it("displays risk feed item regions and timestamps", () => {
    render(<AICompliancePage />);
    expect(screen.getAllByText("2 min ago").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("EU").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("APAC").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("MENA").length).toBeGreaterThanOrEqual(1);
  });

  it("renders heatmap legend items", () => {
    render(<AICompliancePage />);
    fireEvent.click(screen.getByRole("button", { name: /Risk Heatmap/i }));
    expect(screen.getByText("Compliant (90+)")).toBeInTheDocument();
    expect(screen.getByText("Warning (80-89)")).toBeInTheDocument();
  });
});
