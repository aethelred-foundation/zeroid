import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/cross-chain",
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

import CrossChainPage from "../page";

describe("CrossChainPage", () => {
  it("renders without crashing", () => {
    render(<CrossChainPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<CrossChainPage />);
    expect(screen.getByText("Cross-Chain Identity Bridge")).toBeInTheDocument();
  });

  it("shows metric cards", () => {
    render(<CrossChainPage />);
    expect(
      screen.getAllByText("Supported Chains").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Avg Bridge Time")).toBeInTheDocument();
    expect(screen.getByText("Bridge TVL")).toBeInTheDocument();
    expect(screen.getByText("$29.1M")).toBeInTheDocument();
  });

  it("displays supported chains in the sidebar", () => {
    render(<CrossChainPage />);
    expect(screen.getAllByText("Aethelred").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ethereum").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Polygon").length).toBeGreaterThanOrEqual(1);
  });

  it("switches tabs when clicking on tab buttons", () => {
    render(<CrossChainPage />);
    // Default tab is 'bridge'
    expect(screen.getByText("Bridge Credentials")).toBeInTheDocument();

    // Click on 'Bridged Credentials' tab button (the button element)
    const tabButtons = screen.getAllByRole("button");
    const bridgedCredTab = tabButtons.find((btn) =>
      btn.textContent?.includes("Bridged Credentials"),
    );
    fireEvent.click(bridgedCredTab!);
    expect(screen.getByText("KYC Identity Verification")).toBeInTheDocument();

    // Click on 'History' tab
    fireEvent.click(screen.getByText("History"));
    expect(
      screen.getByText("Cross-Chain Verification History"),
    ).toBeInTheDocument();
  });

  it("changes source chain via dropdown", () => {
    render(<CrossChainPage />);
    const selects = screen.getAllByRole("combobox");
    // Source chain select is the first one
    fireEvent.change(selects[0], { target: { value: "polygon" } });
    expect((selects[0] as HTMLSelectElement).value).toBe("polygon");
  });

  it("changes destination chain via dropdown", () => {
    render(<CrossChainPage />);
    const selects = screen.getAllByRole("combobox");
    // Destination chain select is the second one
    fireEvent.change(selects[1], { target: { value: "arbitrum" } });
    expect((selects[1] as HTMLSelectElement).value).toBe("arbitrum");
  });

  it("has a swap button that can be clicked without error", () => {
    render(<CrossChainPage />);
    const allButtons = screen.getAllByRole("button");
    // Find the swap button (it has no text content, just an icon)
    const swapButton = allButtons.find(
      (btn) => !btn.textContent || btn.textContent.trim() === "",
    );
    expect(swapButton).toBeTruthy();
    fireEvent.click(swapButton!);
    // After click, page should still be rendered
    expect(screen.getByText("Cross-Chain Identity Bridge")).toBeInTheDocument();
  });

  it("toggles credential selection and enables/disables bridge button", () => {
    render(<CrossChainPage />);
    const checkbox = screen.getByLabelText("KYC Identity Verification");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    // Bridge button should now mention "1 Credential"
    expect(screen.getByText(/Bridge 1 Credential$/)).toBeInTheDocument();
    // Toggle off
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("starts bridge process when bridge button is clicked with credentials selected", () => {
    jest.useFakeTimers();
    render(<CrossChainPage />);
    // Select a credential
    const checkbox = screen.getByLabelText("KYC Identity Verification");
    fireEvent.click(checkbox);
    // Click bridge button
    const bridgeButton = screen.getByText(/Bridge 1 Credential/);
    fireEvent.click(bridgeButton);
    // Should show bridge progress
    expect(screen.getByText("Bridge Progress")).toBeInTheDocument();
    expect(screen.getByText("Bridging...")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows history tab with bridge status indicators", () => {
    render(<CrossChainPage />);
    fireEvent.click(screen.getByText("History"));
    // Check for in-progress status
    expect(screen.getByText("in-progress")).toBeInTheDocument();
    // Check for completed status
    expect(screen.getAllByText("completed").length).toBe(4);
  });

  it("completes bridge process through all steps and finishes", async () => {
    jest.useFakeTimers();
    const { act } = require("@testing-library/react");
    render(<CrossChainPage />);
    // Select a credential
    const checkbox = screen.getByLabelText("KYC Identity Verification");
    fireEvent.click(checkbox);
    // Start bridge
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));
    expect(screen.getByText("Bridge Progress")).toBeInTheDocument();

    // Advance through all steps (each interval tick is 2000ms, 5 ticks to reach step 5)
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
    }
    // After step reaches 5, a setTimeout of 2000ms is scheduled to set bridgeInProgress=false
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    // Bridge progress should be gone now
    expect(screen.queryByText("Bridge Progress")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it('bridge button shows plural "Credentials" for multiple selections', () => {
    render(<CrossChainPage />);
    fireEvent.click(screen.getByLabelText("KYC Identity Verification"));
    fireEvent.click(screen.getByLabelText("Age Verification (18+)"));
    expect(screen.getByText(/Bridge 2 Credentials/)).toBeInTheDocument();
  });

  it("bridge button is disabled when no credentials are selected", () => {
    render(<CrossChainPage />);
    const bridgeButton = screen
      .getByText(/Bridge 0 Credential/)
      .closest("button");
    expect(bridgeButton).toBeDisabled();
  });
});
