import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import PrivacyScoreBreakdown from "@/components/analytics/PrivacyScoreBreakdown";

jest.mock("framer-motion", () => ({
  motion: {
    circle: (props: any) => <circle {...props} />,
  },
}));

jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target: unknown, name: string | symbol) => {
          if (name === "__esModule") return true;
          return (props: any) => (
            <span
              data-testid={`icon-${String(name).toLowerCase()}`}
              {...props}
            />
          );
        },
      },
    ),
);

const categories = [
  {
    id: "zk",
    name: "ZK request adoption",
    score: 50,
    maxScore: 100,
    description: "Calculated from returned request fields.",
    icon: "zk" as const,
  },
];

const exposures = [
  {
    attribute: "nationality",
    disclosed: true,
    zkProved: false,
    disclosureCount: 2,
  },
  {
    attribute: "ageOver18",
    disclosed: false,
    zkProved: true,
    disclosureCount: 0,
  },
];

const recommendations = [
  {
    id: "r1",
    title: "Review direct disclosures",
    description: "A direct disclosure was returned by the tenant API.",
    impact: "high" as const,
    category: "exposure",
  },
  {
    id: "r2",
    title: "Review consent",
    description: "Consent evidence was missing.",
    impact: "medium" as const,
    category: "consent",
  },
  {
    id: "r3",
    title: "Maintain review cadence",
    description: "Continue reviewing tenant records.",
    impact: "low" as const,
    category: "operations",
  },
];

describe("PrivacyScoreBreakdown", () => {
  it("renders loading and error states", () => {
    const { rerender } = render(<PrivacyScoreBreakdown loading />);
    expect(
      screen.getByText("Calculating tenant privacy score..."),
    ).toBeInTheDocument();

    rerender(<PrivacyScoreBreakdown error="Calculation failed" />);
    expect(screen.getByText("Calculation failed")).toBeInTheDocument();
  });

  it("uses an explicit unavailable state instead of fake defaults", () => {
    render(<PrivacyScoreBreakdown />);

    expect(screen.getByText("Tenant Privacy Score")).toBeInTheDocument();
    expect(screen.getByText(/Score unavailable/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No calculated category data/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No exposure records supplied/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("79")).not.toBeInTheDocument();
    expect(screen.queryByText(/Network Average/i)).not.toBeInTheDocument();
  });

  it("renders a supplied tenant score with its calculation basis", () => {
    render(
      <PrivacyScoreBreakdown
        overallScore={75}
        calculationBasis="Calculated from four returned tenant requests."
      />,
    );

    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("Tenant score")).toBeInTheDocument();
    expect(
      screen.getByText("Calculated from four returned tenant requests."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/above average/i)).not.toBeInTheDocument();
  });

  it("renders only supplied category and exposure data", () => {
    render(
      <PrivacyScoreBreakdown
        overallScore={75}
        categories={categories}
        exposures={exposures}
      />,
    );

    expect(screen.getByText("ZK request adoption")).toBeInTheDocument();
    expect(screen.getByText("50/100")).toBeInTheDocument();
    expect(screen.getByText("nationality")).toBeInTheDocument();
    expect(screen.getByText("ageOver18")).toBeInTheDocument();
    expect(screen.getByText("2 disclosure(s)")).toBeInTheDocument();
  });

  it("renders tenant-only history without a network line", () => {
    render(
      <PrivacyScoreBreakdown
        overallScore={75}
        history={[{ date: "2026-06", score: 75 }]}
      />,
    );

    expect(screen.getByText("Tenant Score History")).toBeInTheDocument();
    expect(screen.getByText("No network comparison")).toBeInTheDocument();
    expect(screen.queryByText("Network Avg")).not.toBeInTheDocument();
  });

  it("expands supplied rule-based recommendations", () => {
    render(
      <PrivacyScoreBreakdown
        overallScore={75}
        recommendations={recommendations}
      />,
    );

    expect(screen.getByText("Review direct disclosures")).toBeInTheDocument();
    expect(
      screen.queryByText("Maintain review cadence"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByText("Maintain review cadence")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(
      screen.queryByText("Maintain review cadence"),
    ).not.toBeInTheDocument();
  });

  it("preserves a custom class in every terminal state", () => {
    const { container, rerender } = render(
      <PrivacyScoreBreakdown className="custom-state" />,
    );
    expect(container.firstChild).toHaveClass("custom-state");

    rerender(<PrivacyScoreBreakdown loading className="custom-state" />);
    expect(container.firstChild).toHaveClass("custom-state");

    rerender(<PrivacyScoreBreakdown error="failed" className="custom-state" />);
    expect(container.firstChild).toHaveClass("custom-state");
  });
});
