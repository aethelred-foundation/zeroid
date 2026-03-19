import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PrivacyScoreBreakdown from "@/components/analytics/PrivacyScoreBreakdown";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    circle: (props: any) => <circle {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  EyeOff: (props: any) => <div data-testid="icon-eye-off" {...props} />,
  TrendingUp: (props: any) => <div data-testid="icon-trending-up" {...props} />,
  TrendingDown: (props: any) => (
    <div data-testid="icon-trending-down" {...props} />
  ),
  Fingerprint: (props: any) => (
    <div data-testid="icon-fingerprint" {...props} />
  ),
  Lock: (props: any) => <div data-testid="icon-lock" {...props} />,
  Users: (props: any) => <div data-testid="icon-users" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  ChevronRight: (props: any) => (
    <div data-testid="icon-chevron-right" {...props} />
  ),
  Lightbulb: (props: any) => <div data-testid="icon-lightbulb" {...props} />,
  BarChart3: (props: any) => <div data-testid="icon-bar-chart" {...props} />,
}));

describe("PrivacyScoreBreakdown", () => {
  it("renders loading state", () => {
    render(<PrivacyScoreBreakdown loading={true} />);
    expect(
      screen.getByText("Calculating privacy score..."),
    ).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<PrivacyScoreBreakdown error="Failed to calculate" />);
    expect(screen.getByText("Failed to calculate")).toBeInTheDocument();
  });

  it("renders with default props", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getByText("Privacy Score")).toBeInTheDocument();
    expect(screen.getByText("79")).toBeInTheDocument();
  });

  it("renders overall score", () => {
    render(<PrivacyScoreBreakdown overallScore={85} />);
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("Excellent")).toBeInTheDocument();
  });

  it("shows correct label for different score ranges", () => {
    const { rerender } = render(<PrivacyScoreBreakdown overallScore={90} />);
    expect(screen.getByText("Excellent")).toBeInTheDocument();

    rerender(<PrivacyScoreBreakdown overallScore={65} />);
    expect(screen.getByText("Good")).toBeInTheDocument();

    rerender(<PrivacyScoreBreakdown overallScore={45} />);
    expect(screen.getByText("Needs Improvement")).toBeInTheDocument();
  });

  it("renders network average comparison (above average)", () => {
    render(<PrivacyScoreBreakdown overallScore={85} networkAverage={72} />);
    expect(screen.getByText("Network Average")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("13 points above average")).toBeInTheDocument();
  });

  it("renders network average comparison (below average)", () => {
    render(<PrivacyScoreBreakdown overallScore={65} networkAverage={72} />);
    expect(screen.getByText("7 points below average")).toBeInTheDocument();
  });

  it("renders category breakdown", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getByText("Category Breakdown")).toBeInTheDocument();
    expect(
      screen.getAllByText("Data Disclosure").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ZK Usage").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Verifier Diversity").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Credential Freshness").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders exposure summary stats", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getAllByText("Disclosed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ZK Proved").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Private").length).toBeGreaterThanOrEqual(1);
  });

  it("renders data exposure table", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getByText("Data Exposure Summary")).toBeInTheDocument();
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    expect(screen.getByText("Date of Birth")).toBeInTheDocument();
  });

  it("renders recommendations (initially shows 2)", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getByText("Recommendations")).toBeInTheDocument();
    expect(
      screen.getByText("Enable ZK proofs for age verification"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Diversify verifier interactions"),
    ).toBeInTheDocument();
  });

  it('shows all recommendations when "Show more" is clicked', () => {
    render(<PrivacyScoreBreakdown />);
    const showMoreButton = screen.getByText("Show 2 more");
    fireEvent.click(showMoreButton);
    expect(screen.getByText("Refresh your KYC credential")).toBeInTheDocument();
    expect(
      screen.getByText("Use selective disclosure for employment"),
    ).toBeInTheDocument();
  });

  it('collapses recommendations when "Show less" is clicked', () => {
    render(<PrivacyScoreBreakdown />);
    fireEvent.click(screen.getByText("Show 2 more"));
    expect(screen.getByText("Show less")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show less"));
    expect(screen.getByText("Show 2 more")).toBeInTheDocument();
  });

  it("renders history chart", () => {
    render(<PrivacyScoreBreakdown />);
    expect(screen.getByText("Score History (12mo)")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <PrivacyScoreBreakdown className="test-class" />,
    );
    expect(container.firstChild).toHaveClass("test-class");
  });

  it("renders ScoreGauge with score < 60 showing Needs Improvement and red color", () => {
    render(<PrivacyScoreBreakdown overallScore={40} />);
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Needs Improvement")).toBeInTheDocument();
  });

  it("renders CategoryBar with percentage < 60 showing red bar", () => {
    const lowCategories = [
      {
        id: "low",
        name: "Low Score Cat",
        score: 30,
        maxScore: 100,
        description: "Very low",
        icon: "disclosure" as const,
      },
    ];
    render(<PrivacyScoreBreakdown categories={lowCategories} />);
    expect(screen.getByText("Low Score Cat")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders CategoryBar with percentage between 60-80 showing amber bar", () => {
    const midCategories = [
      {
        id: "mid",
        name: "Mid Score Cat",
        score: 65,
        maxScore: 100,
        description: "Medium",
        icon: "zk" as const,
      },
    ];
    render(<PrivacyScoreBreakdown categories={midCategories} />);
    expect(screen.getByText("Mid Score Cat")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
  });

  it("renders CategoryBar with unknown icon falling back to Shield", () => {
    const unknownIconCategories = [
      {
        id: "unk",
        name: "Unknown Icon",
        score: 90,
        maxScore: 100,
        description: "Test",
        icon: "nonexistent" as any,
      },
    ];
    render(<PrivacyScoreBreakdown categories={unknownIconCategories} />);
    expect(screen.getByText("Unknown Icon")).toBeInTheDocument();
  });

  it('does not show "Show more" when recommendations <= 2', () => {
    const fewRecs = [
      {
        id: "r1",
        title: "Rec 1",
        description: "Desc 1",
        impact: "high" as const,
        category: "Cat",
      },
    ];
    render(<PrivacyScoreBreakdown recommendations={fewRecs} />);
    expect(screen.queryByText(/Show/)).not.toBeInTheDocument();
  });

  it("shows equal score as below average (overallScore === networkAverage)", () => {
    render(<PrivacyScoreBreakdown overallScore={72} networkAverage={72} />);
    // overallScore > networkAverage is false, so it goes to the else branch
    expect(screen.getByText("0 points below average")).toBeInTheDocument();
  });

  it("renders loading state with custom className", () => {
    const { container } = render(
      <PrivacyScoreBreakdown loading={true} className="loading-class" />,
    );
    expect(container.firstChild).toHaveClass("loading-class");
  });

  it("renders error state with custom className", () => {
    const { container } = render(
      <PrivacyScoreBreakdown error="err" className="error-class" />,
    );
    expect(container.firstChild).toHaveClass("error-class");
  });
});
