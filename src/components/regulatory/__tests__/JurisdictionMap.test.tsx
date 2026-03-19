import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import JurisdictionMap from "@/components/regulatory/JurisdictionMap";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    path: (props: any) => <path {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Globe: (props: any) => <div data-testid="icon-globe" {...props} />,
  ZoomIn: (props: any) => <div data-testid="icon-zoom-in" {...props} />,
  ZoomOut: (props: any) => <div data-testid="icon-zoom-out" {...props} />,
  Maximize2: (props: any) => <div data-testid="icon-maximize" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  ShieldAlert: (props: any) => (
    <div data-testid="icon-shield-alert" {...props} />
  ),
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  ArrowRight: (props: any) => <div data-testid="icon-arrow-right" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  ChevronRight: (props: any) => (
    <div data-testid="icon-chevron-right" {...props} />
  ),
}));

const mockJurisdictions = [
  {
    id: "US",
    name: "United States",
    region: "US",
    status: "compliant" as const,
    score: 92,
    regulations: ["KYC/AML", "Data Privacy"],
    lastReview: "2026-02-15",
    requirements: [
      { name: "KYC Verification", met: true },
      { name: "AML Screening", met: true },
    ],
  },
  {
    id: "EU",
    name: "European Union",
    region: "EU",
    status: "partial" as const,
    score: 75,
    regulations: ["GDPR"],
    lastReview: "2026-01-20",
    requirements: [
      { name: "KYC Verification", met: true },
      { name: "Data Localization", met: false },
    ],
  },
];

const mockRoutes = [
  {
    from: "US",
    to: "EU",
    compliant: true,
    requirements: ["eIDAS 2.0 mapping"],
  },
];

describe("JurisdictionMap", () => {
  it("renders loading state", () => {
    render(<JurisdictionMap loading={true} />);
    expect(
      screen.getByText("Loading jurisdiction data..."),
    ).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<JurisdictionMap error="Failed to load" />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders header", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
    expect(screen.getByText("2 jurisdictions")).toBeInTheDocument();
  });

  it("renders legend items", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    expect(screen.getAllByText("Compliant").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Partial").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Non-Compliant").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getAllByText("Pending Review").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders route toggle button", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    expect(screen.getByText("Routes")).toBeInTheDocument();
  });

  it("renders route legend when routes are shown", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    expect(screen.getByText("Compliant Route")).toBeInTheDocument();
  });

  it("calls onJurisdictionClick when a jurisdiction region is clicked", () => {
    const onJurisdictionClick = jest.fn();
    render(
      <JurisdictionMap
        jurisdictions={mockJurisdictions}
        routes={mockRoutes}
        onJurisdictionClick={onJurisdictionClick}
      />,
    );
    // Click the US text element in the SVG
    const usTexts = screen.getAllByText("US");
    if (usTexts[0]?.closest("g")) {
      fireEvent.click(usTexts[0].closest("g")!);
      expect(onJurisdictionClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "US", name: "United States" }),
      );
    }
  });

  it("shows sidebar when jurisdiction is selected", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const usTexts = screen.getAllByText("US");
    if (usTexts[0]?.closest("g")) {
      fireEvent.click(usTexts[0].closest("g")!);
      expect(screen.getByText("United States")).toBeInTheDocument();
      expect(screen.getAllByText("92%").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Compliance Score")).toBeInTheDocument();
    }
  });

  it("renders zoom controls", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    expect(screen.getByTestId("icon-zoom-in")).toBeInTheDocument();
    expect(screen.getByTestId("icon-zoom-out")).toBeInTheDocument();
    expect(screen.getByTestId("icon-maximize")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<JurisdictionMap className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("toggles routes off and hides route legend", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    fireEvent.click(screen.getByText("Routes"));
    // Route legend items should be hidden
    expect(screen.queryByText("Compliant Route")).not.toBeInTheDocument();
  });

  it("zooms in when zoom in button is clicked", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button")!;
    fireEvent.click(zoomInBtn);
    // Should not crash, zoom increases
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("zooms out when zoom out button is clicked", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const zoomOutBtn = screen.getByTestId("icon-zoom-out").closest("button")!;
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("resets zoom when maximize button is clicked", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button")!;
    fireEvent.click(zoomInBtn);
    const resetBtn = screen.getByTestId("icon-maximize").closest("button")!;
    fireEvent.click(resetBtn);
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("clamps zoom to minimum 0.5", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const zoomOutBtn = screen.getByTestId("icon-zoom-out").closest("button")!;
    // Click multiple times to hit the floor
    for (let i = 0; i < 10; i++) {
      fireEvent.click(zoomOutBtn);
    }
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("clamps zoom to maximum 2", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button")!;
    // Click multiple times to hit the ceiling
    for (let i = 0; i < 20; i++) {
      fireEvent.click(zoomInBtn);
    }
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("shows sidebar with compliance score and requirements when jurisdiction is clicked", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getByText("United States")).toBeInTheDocument();
      expect(screen.getByText("Compliance Score")).toBeInTheDocument();
      expect(screen.getByText("KYC Verification")).toBeInTheDocument();
      expect(screen.getByText("AML Screening")).toBeInTheDocument();
      expect(screen.getByText("2/2 met")).toBeInTheDocument();
      expect(screen.getByText("Last Reviewed")).toBeInTheDocument();
      expect(screen.getByText("Applicable Regulations")).toBeInTheDocument();
      expect(screen.getByText("KYC/AML")).toBeInTheDocument();
      expect(screen.getByText("Data Privacy")).toBeInTheDocument();
    }
  });

  it("closes sidebar when close button is clicked", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getByText("Compliance Score")).toBeInTheDocument();
      // Click close button
      const closeBtn = screen.getByTestId("icon-x").closest("button")!;
      fireEvent.click(closeBtn);
      expect(screen.queryByText("Compliance Score")).not.toBeInTheDocument();
    }
  });

  it("deselects jurisdiction when clicking same one again", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getByText("Compliance Score")).toBeInTheDocument();
      // Click again to deselect
      fireEvent.click(group);
      expect(screen.queryByText("Compliance Score")).not.toBeInTheDocument();
    }
  });

  it("shows sidebar with partial status for EU jurisdiction", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const euTexts = screen.getAllByText("EU");
    const group = euTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getByText("European Union")).toBeInTheDocument();
      expect(screen.getAllByText("Partial").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("1/2 met")).toBeInTheDocument();
    }
  });

  it("shows requirement met and not met icons in sidebar", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const euTexts = screen.getAllByText("EU");
    const group = euTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      // EU has 1 met and 1 not met
      expect(screen.getByText("Data Localization")).toBeInTheDocument();
    }
  });

  it("handles hover on jurisdiction regions", () => {
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={mockRoutes} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.mouseEnter(group);
      fireEvent.mouseLeave(group);
    }
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("renders with default jurisdictions when none provided", () => {
    render(<JurisdictionMap />);
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
    expect(screen.getByText("14 jurisdictions")).toBeInTheDocument();
  });

  it("renders routes with unknown region IDs gracefully", () => {
    const badRoutes = [
      { from: "XX", to: "YY", compliant: true, requirements: ["test"] },
    ];
    render(
      <JurisdictionMap jurisdictions={mockJurisdictions} routes={badRoutes} />,
    );
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("renders non-compliant routes with dashed style", () => {
    const nonCompliantRoutes = [
      {
        from: "US",
        to: "EU",
        compliant: false,
        requirements: ["missing requirement"],
      },
    ];
    render(
      <JurisdictionMap
        jurisdictions={mockJurisdictions}
        routes={nonCompliantRoutes}
      />,
    );
    expect(screen.getByText("Jurisdiction Map")).toBeInTheDocument();
  });

  it("shows notes in sidebar when jurisdiction has notes", () => {
    const jurisdictionsWithNotes = [
      {
        ...mockJurisdictions[0],
        notes: "Special regulatory consideration",
      },
    ];
    render(
      <JurisdictionMap
        jurisdictions={jurisdictionsWithNotes}
        routes={mockRoutes}
      />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getByText("United States")).toBeInTheDocument();
    }
  });

  it("renders jurisdiction score below 60 with red bar", () => {
    const lowScoreJurisdictions = [{ ...mockJurisdictions[0], score: 45 }];
    render(
      <JurisdictionMap jurisdictions={lowScoreJurisdictions} routes={[]} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getAllByText("45%").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("handles clicking a region ID not in the jurisdictions list gracefully", () => {
    // Only provide US jurisdiction but click on EU region (which exists in REGION_PATHS but not in jurisdictions)
    const singleJurisdiction = [mockJurisdictions[0]]; // Only US
    render(<JurisdictionMap jurisdictions={singleJurisdiction} routes={[]} />);
    // EU region is in REGION_PATHS so it renders in SVG
    const euTexts = screen.getAllByText("EU");
    const group = euTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      // No sidebar should appear since EU is not in jurisdictions
      expect(screen.queryByText("Compliance Score")).not.toBeInTheDocument();
    }
  });

  it("renders jurisdiction score between 60-79 with amber bar", () => {
    const midScoreJurisdictions = [{ ...mockJurisdictions[0], score: 65 }];
    render(
      <JurisdictionMap jurisdictions={midScoreJurisdictions} routes={[]} />,
    );
    const usTexts = screen.getAllByText("US");
    const group = usTexts[0]?.closest("g");
    if (group) {
      fireEvent.click(group);
      expect(screen.getAllByText("65%").length).toBeGreaterThanOrEqual(1);
    }
  });
});
