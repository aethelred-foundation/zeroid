import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/regulatory",
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

jest.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <div data-testid="connect-button">Connect</div>,
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

import RegulatoryPage from "../page";

describe("RegulatoryPage", () => {
  it("renders without crashing", () => {
    render(<RegulatoryPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<RegulatoryPage />);
    expect(
      screen.getByText("Multi-Jurisdiction Regulatory Dashboard"),
    ).toBeInTheDocument();
  });

  it("shows metric cards", () => {
    render(<RegulatoryPage />);
    expect(screen.getByText("Jurisdictions")).toBeInTheDocument();
    expect(screen.getByText("Compliant")).toBeInTheDocument();
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Avg Score")).toBeInTheDocument();
  });

  it("shows jurisdiction map by default", () => {
    render(<RegulatoryPage />);
    expect(
      screen.getByText("Compliance Status by Jurisdiction"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("United States").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getAllByText("United Arab Emirates").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("switches to Credential Gaps tab", () => {
    render(<RegulatoryPage />);
    fireEvent.click(screen.getByText("Credential Gaps"));
    expect(screen.getByText("Credential Gap Analysis")).toBeInTheDocument();
  });

  it("shows regulatory change feed in sidebar", () => {
    render(<RegulatoryPage />);
    expect(screen.getByText("Regulatory Change Feed")).toBeInTheDocument();
    expect(
      screen.getByText("MiCA enters full enforcement"),
    ).toBeInTheDocument();
  });

  it("shows data sovereignty status in sidebar", () => {
    render(<RegulatoryPage />);
    expect(screen.getByText("Data Sovereignty Status")).toBeInTheDocument();
  });

  it("selects a jurisdiction and shows detail panel", () => {
    render(<RegulatoryPage />);
    // Click on United States jurisdiction card
    const usButton = screen.getAllByText("US");
    // Find the button element among them (the jurisdiction card)
    const jurisdictionCard = usButton.find((el) => el.closest("button"));
    fireEvent.click(jurisdictionCard!.closest("button")!);
    // Detail panel should show
    expect(screen.getByText("SEC / FinCEN")).toBeInTheDocument();
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("94/100")).toBeInTheDocument();
  });

  it("shows jurisdiction detail with GDPR and eIDAS indicators for EU", () => {
    render(<RegulatoryPage />);
    // Click EU jurisdiction card
    const euButtons = screen.getAllByText("EU");
    const jurisdictionCard = euButtons.find((el) => el.closest("button"));
    fireEvent.click(jurisdictionCard!.closest("button")!);
    // EU detail panel should show with GDPR and eIDAS
    expect(screen.getByText("MiCA / eIDAS 2.0")).toBeInTheDocument();
    expect(screen.getByText("91/100")).toBeInTheDocument();
    expect(screen.getByText("GDPR")).toBeInTheDocument();
    expect(screen.getByText("eIDAS")).toBeInTheDocument();
  });

  it("switches to Cross-Border Checker tab and shows routes", () => {
    render(<RegulatoryPage />);
    fireEvent.click(screen.getByText("Cross-Border Checker"));
    expect(
      screen.getByText("Cross-Border Transfer Compliance Checker"),
    ).toBeInTheDocument();
    // Check cross-border routes are rendered
    expect(
      screen.getByText("Bilateral MOU active. Standard KYC sufficient."),
    ).toBeInTheDocument();
  });

  it("switches to Mutual Recognition tab and shows matrix", () => {
    render(<RegulatoryPage />);
    const mutualButtons = screen.getAllByText("Mutual Recognition");
    // Click the tab button (the first one is the tab)
    const tabBtn = mutualButtons.find((el) => el.closest("button"));
    fireEvent.click(tabBtn!.closest("button")!);
    expect(screen.getByText("Mutual Recognition Matrix")).toBeInTheDocument();
    // Table should be rendered
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(1);
  });

  it("filters jurisdictions by search query", () => {
    render(<RegulatoryPage />);
    const searchInput = screen.getByPlaceholderText("Search jurisdictions...");
    fireEvent.change(searchInput, { target: { value: "Japan" } });
    expect(screen.getByText("Japan")).toBeInTheDocument();
    // Brazil should not be in the map grid since it doesn't match "Japan"
    expect(screen.queryByText("Brazil")).not.toBeInTheDocument();
  });

  it("shows privacy framework compliance indicators", () => {
    render(<RegulatoryPage />);
    expect(
      screen.getByText("Privacy Framework Compliance"),
    ).toBeInTheDocument();
    expect(screen.getByText("GDPR Compliant")).toBeInTheDocument();
    expect(screen.getByText("eIDAS Compatible")).toBeInTheDocument();
  });

  it("changes From select in the Cross-Border Checker tab", () => {
    render(<RegulatoryPage />);
    fireEvent.click(screen.getByText("Cross-Border Checker"));
    // The "From" label and "To" label identify the selects
    const fromLabel = screen.getByText("From");
    const fromSelect = fromLabel.parentElement!.querySelector("select")!;
    fireEvent.change(fromSelect, { target: { value: "SG" } });
    expect(fromSelect.value).toBe("SG");
  });

  it("changes To select in the Cross-Border Checker tab", () => {
    render(<RegulatoryPage />);
    fireEvent.click(screen.getByText("Cross-Border Checker"));
    const toLabel = screen.getByText("To");
    const toSelect = toLabel.parentElement!.querySelector("select")!;
    fireEvent.change(toSelect, { target: { value: "JP" } });
    expect(toSelect.value).toBe("JP");
  });

  it("deselects a jurisdiction when clicking the same one again", () => {
    render(<RegulatoryPage />);
    // Find the US jurisdiction card button — "United States" appears in map card + sidebar
    const usElements = screen.getAllByText("United States");
    const usBtn = usElements
      .find((el) => el.closest("button"))!
      .closest("button")!;
    // Select
    fireEvent.click(usBtn);
    expect(screen.getByText("94/100")).toBeInTheDocument();
    // Deselect by clicking same button again (re-query)
    const usElements2 = screen.getAllByText("United States");
    const usBtn2 = usElements2
      .find((el) => el.closest("button"))!
      .closest("button")!;
    fireEvent.click(usBtn2);
    expect(
      screen.getByText("Select a jurisdiction to view details"),
    ).toBeInTheDocument();
  });

  it("selects a jurisdiction with no mutual recognition (Brazil) and score < 80", () => {
    render(<RegulatoryPage />);
    // BR is the uppercase ID shown in the card
    const brButtons = screen.getAllByText("BR");
    const brCard = brButtons.find((el) => el.closest("button"));
    fireEvent.click(brCard!.closest("button")!);
    // Brazil has mutualRecognition: [] so "None established" should appear
    expect(screen.getByText("None established")).toBeInTheDocument();
    expect(screen.getByText("72/100")).toBeInTheDocument();
  });

  it("selects a jurisdiction with score between 80-89 (amber) and gaps > 0", () => {
    render(<RegulatoryPage />);
    // Japan has score=86, gaps=3
    const jpButtons = screen.getAllByText("JP");
    const jpCard = jpButtons.find((el) => el.closest("button"));
    fireEvent.click(jpCard!.closest("button")!);
    expect(screen.getByText("86/100")).toBeInTheDocument();
  });

  it("selects a jurisdiction with score < 80 (India)", () => {
    render(<RegulatoryPage />);
    // India has score=68
    const inButtons = screen.getAllByText("IN");
    const inCard = inButtons.find((el) => el.closest("button"));
    fireEvent.click(inCard!.closest("button")!);
    expect(screen.getByText("68/100")).toBeInTheDocument();
  });

  it("filters jurisdictions by region", () => {
    render(<RegulatoryPage />);
    const searchInput = screen.getByPlaceholderText("Search jurisdictions...");
    fireEvent.change(searchInput, { target: { value: "Oceania" } });
    expect(screen.getByText("Australia")).toBeInTheDocument();
  });
});
