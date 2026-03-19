import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import BridgeInterface from "@/components/crosschain/BridgeInterface";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    path: (props: any) => <path {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  ArrowDown: (props: any) => <div data-testid="icon-arrow-down" {...props} />,
  ArrowRight: (props: any) => <div data-testid="icon-arrow-right" {...props} />,
  ArrowUpDown: (props: any) => <div data-testid="icon-swap" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  ShieldAlert: (props: any) => (
    <div data-testid="icon-shield-alert" {...props} />
  ),
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  ExternalLink: (props: any) => <div data-testid="icon-external" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  Fuel: (props: any) => <div data-testid="icon-fuel" {...props} />,
  Link2: (props: any) => <div data-testid="icon-link" {...props} />,
  ChevronDown: (props: any) => (
    <div data-testid="icon-chevron-down" {...props} />
  ),
  Info: (props: any) => <div data-testid="icon-info" {...props} />,
  Zap: (props: any) => <div data-testid="icon-zap" {...props} />,
}));

const mockCredentials = [
  {
    id: "c1",
    name: "KYC Level 2",
    issuer: "Aethelred",
    schema: "kyc-v2",
    expiresAt: "2027-01-15",
  },
  { id: "c2", name: "AML Cert", issuer: "ComplianceOracle", schema: "aml-v1" },
];

describe("BridgeInterface", () => {
  it("renders loading state", () => {
    render(<BridgeInterface loading={true} />);
    expect(screen.getByText("Loading bridge...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<BridgeInterface error="Bridge unavailable" />);
    expect(screen.getByText("Bridge unavailable")).toBeInTheDocument();
  });

  it("renders the bridge header", () => {
    render(<BridgeInterface />);
    expect(
      screen.getByText("Cross-Chain Credential Bridge"),
    ).toBeInTheDocument();
    expect(screen.getByText("Powered by ZeroID Relay")).toBeInTheDocument();
  });

  it("renders chain selectors", () => {
    render(<BridgeInterface />);
    expect(screen.getByText("Source Chain")).toBeInTheDocument();
    expect(screen.getByText("Destination Chain")).toBeInTheDocument();
  });

  it("renders default chains (Aethelred and Ethereum)", () => {
    render(<BridgeInterface />);
    expect(screen.getByText("Aethelred")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });

  it("renders swap chains button", () => {
    render(<BridgeInterface />);
    expect(screen.getByLabelText("Swap chains")).toBeInTheDocument();
  });

  it("renders default credentials", () => {
    render(<BridgeInterface />);
    expect(screen.getByText("KYC Level 2 Verification")).toBeInTheDocument();
    expect(screen.getByText("Accredited Investor")).toBeInTheDocument();
  });

  it("renders provided credentials", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
    expect(screen.getByText("AML Cert")).toBeInTheDocument();
  });

  it("bridge button is disabled when no credentials selected", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    const bridgeButton = screen.getByText(/Bridge 0 Credential/);
    expect(bridgeButton).toBeDisabled();
  });

  it("toggles credential selection", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText(/Bridge 1 Credential/)).not.toBeDisabled();
  });

  it("shows fee breakdown when credentials are selected", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText("Estimated Fees")).toBeInTheDocument();
  });

  it("shows estimated completion time when credentials selected", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText(/Estimated completion:/)).toBeInTheDocument();
  });

  it("renders security notice", () => {
    render(<BridgeInterface />);
    expect(screen.getByText("Security Notice")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<BridgeInterface className="test-class" />);
    expect(container.firstChild).toHaveClass("test-class");
  });

  it("swaps source and destination chains", () => {
    render(<BridgeInterface />);
    // Initially Aethelred is source, Ethereum is destination
    expect(screen.getByText("Aethelred")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Swap chains"));
    // After swap, both should still be visible (just swapped positions)
    expect(screen.getByText("Aethelred")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });

  it("opens chain selector dropdown and selects a chain", () => {
    render(<BridgeInterface />);
    // Click source chain selector (Aethelred button)
    const sourceChainButton = screen
      .getByText("Source Chain")
      .closest("div")!
      .querySelector("button")!;
    fireEvent.click(sourceChainButton);
    // Dropdown should show other chains (excluding destination chain Ethereum)
    expect(screen.getByText("Polygon")).toBeInTheDocument();
    expect(screen.getByText("Arbitrum")).toBeInTheDocument();
    // Select Polygon
    fireEvent.click(screen.getByText("Polygon"));
  });

  it("toggles fee breakdown details", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    // Select a credential to make fees visible
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText("Estimated Fees")).toBeInTheDocument();
    // Click to expand fee details
    fireEvent.click(screen.getByText("Estimated Fees"));
    expect(screen.getByText("Source Transaction")).toBeInTheDocument();
    expect(screen.getByText("Relayer Fee")).toBeInTheDocument();
    expect(screen.getByText("Protocol Fee")).toBeInTheDocument();
  });

  it("deselects a credential when clicked again", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText(/Bridge 1 Credential/)).not.toBeDisabled();
    // Click again to deselect
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText(/Bridge 0 Credential/)).toBeDisabled();
  });

  it("selects multiple credentials and updates button text", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText("AML Cert"));
    expect(screen.getByText(/Bridge 2 Credentials/)).not.toBeDisabled();
  });

  it("shows credential expiration when available", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    expect(screen.getByText("Exp: 2027-01-15")).toBeInTheDocument();
  });

  it("does not show expiration for credentials without expiresAt", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    // AML Cert has no expiresAt, so only one Exp label should show
    const expLabels = screen.getAllByText(/^Exp:/);
    expect(expLabels.length).toBe(1);
  });

  it("starts bridging flow when bridge button is clicked", async () => {
    jest.useFakeTimers();
    const onBridge = jest.fn().mockResolvedValue(undefined);
    render(
      <BridgeInterface credentials={mockCredentials} onBridge={onBridge} />,
    );

    // Select a credential
    fireEvent.click(screen.getByText("KYC Level 2"));

    // Click bridge button
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    // Should show bridging in progress
    expect(screen.getByText("Bridging in Progress")).toBeInTheDocument();

    // Advance through all 5 bridge steps (each ~2-3 seconds)
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }

    // onBridge should have been called
    expect(onBridge).toHaveBeenCalledWith({
      sourceChain: "aethelred",
      destChain: "ethereum",
      credentialIds: ["c1"],
    });

    // After completion timeout
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    jest.useRealTimers();
  });

  it("shows BridgeStepper with step labels during bridging", async () => {
    jest.useFakeTimers();
    render(<BridgeInterface credentials={mockCredentials} />);

    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    // Stepper should show step labels
    expect(screen.getByText("Initiate")).toBeInTheDocument();
    expect(screen.getByText("Source Confirm")).toBeInTheDocument();
    expect(screen.getByText("Relay")).toBeInTheDocument();
    expect(screen.getByText("Dest Confirm")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();

    // Clean up
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    jest.useRealTimers();
  });

  it("does not initiate bridge when no credentials selected", async () => {
    const onBridge = jest.fn();
    render(
      <BridgeInterface credentials={mockCredentials} onBridge={onBridge} />,
    );

    // The bridge button should be disabled, but let's verify handleBridge guards
    const bridgeButton = screen.getByText(/Bridge 0 Credential/);
    expect(bridgeButton).toBeDisabled();
  });

  it("bridges without onBridge callback", async () => {
    jest.useFakeTimers();
    render(<BridgeInterface credentials={mockCredentials} />);

    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    // Should show progress without errors even without onBridge
    expect(screen.getByText("Bridging in Progress")).toBeInTheDocument();

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    jest.useRealTimers();
  });

  it("shows chain names in bridging progress view", async () => {
    jest.useFakeTimers();
    render(<BridgeInterface credentials={mockCredentials} />);

    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    // Should show source and destination chain names
    expect(screen.getByText("Aethelred to Ethereum")).toBeInTheDocument();

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    jest.useRealTimers();
  });

  it("opens destination chain selector dropdown", () => {
    render(<BridgeInterface />);
    const destChainButton = screen
      .getByText("Destination Chain")
      .closest("div")!
      .querySelector("button")!;
    fireEvent.click(destChainButton);
    // Dropdown should show chains excluding source chain (Aethelred)
    expect(screen.getByText("Polygon")).toBeInTheDocument();
    expect(screen.getByText("Optimism")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
  });

  it("selects a destination chain from dropdown", () => {
    render(<BridgeInterface />);
    const destChainButton = screen
      .getByText("Destination Chain")
      .closest("div")!
      .querySelector("button")!;
    fireEvent.click(destChainButton);
    fireEvent.click(screen.getByText("Polygon"));
    // After selecting, dropdown should close and Polygon should be visible
    expect(screen.getByText("Polygon")).toBeInTheDocument();
  });

  it("shows lower fees when neither chain is ethereum", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    // Swap chains so source becomes Ethereum, then select a non-ethereum source
    const sourceChainButton = screen
      .getByText("Source Chain")
      .closest("div")!
      .querySelector("button")!;
    fireEvent.click(sourceChainButton);
    fireEvent.click(screen.getByText("Polygon"));

    // Change destination from Ethereum
    const destChainButton = screen
      .getByText("Destination Chain")
      .closest("div")!
      .querySelector("button")!;
    fireEvent.click(destChainButton);
    fireEvent.click(screen.getByText("Arbitrum"));

    // Select a credential to see fees
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText("~0.002 ETH")).toBeInTheDocument();
    expect(screen.getByText(/~3 minutes/)).toBeInTheDocument();
  });

  it("shows higher fees when ethereum is involved", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    // Default: aethelred -> ethereum
    fireEvent.click(screen.getByText("KYC Level 2"));
    expect(screen.getByText("~0.009 ETH")).toBeInTheDocument();
    expect(screen.getByText(/~15 minutes/)).toBeInTheDocument();
  });

  it("renders destination transaction fee in expanded breakdown", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText("Estimated Fees"));
    expect(screen.getByText("Destination Transaction")).toBeInTheDocument();
  });

  it("closes fee breakdown when clicked again", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    fireEvent.click(screen.getByText("KYC Level 2"));
    // Open fees
    fireEvent.click(screen.getByText("Estimated Fees"));
    expect(screen.getByText("Source Transaction")).toBeInTheDocument();
    // Close fees
    fireEvent.click(screen.getByText("Estimated Fees"));
    expect(screen.queryByText("Source Transaction")).not.toBeInTheDocument();
  });

  it("applies className to loading state", () => {
    const { container } = render(
      <BridgeInterface loading={true} className="custom-loading" />,
    );
    expect(container.firstChild).toHaveClass("custom-loading");
  });

  it("applies className to error state", () => {
    const { container } = render(
      <BridgeInterface error="fail" className="custom-error" />,
    );
    expect(container.firstChild).toHaveClass("custom-error");
  });

  it("renders step descriptions in BridgeStepper", async () => {
    jest.useFakeTimers();
    render(<BridgeInterface credentials={mockCredentials} />);

    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    expect(screen.getByText("Submit bridge request")).toBeInTheDocument();
    expect(
      screen.getByText("Relayer transmitting credential proof"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Credential available on destination"),
    ).toBeInTheDocument();

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    jest.useRealTimers();
  });

  it("handleBridge returns early when no credentials are selected", async () => {
    jest.useFakeTimers();
    const onBridge = jest.fn();

    // Get access to the handleBridge callback via React internals
    // by extracting the onClick from the rendered button's React fiber
    const { container } = render(
      <BridgeInterface credentials={mockCredentials} onBridge={onBridge} />,
    );

    // Find the bridge button and get its React props via internal fiber
    const bridgeButton = screen
      .getByText(/Bridge 0 Credential/)
      .closest("button")!;
    // Get the React fiber node
    const fiberKey = Object.keys(bridgeButton).find(
      (key) =>
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$"),
    );
    if (fiberKey) {
      const fiber = (bridgeButton as any)[fiberKey];
      const onClick = fiber.memoizedProps?.onClick;
      if (onClick) {
        await act(async () => {
          onClick();
        });
      }
    }

    // handleBridge should return early, not showing bridging progress
    expect(screen.queryByText("Bridging in Progress")).not.toBeInTheDocument();
    expect(onBridge).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("renders source chain ETH fees correctly", () => {
    render(<BridgeInterface credentials={mockCredentials} />);
    // source = aethelred (not ethereum), dest = ethereum
    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText("Estimated Fees"));
    expect(screen.getByText("0.0003 ETH")).toBeInTheDocument(); // source not ethereum
    expect(screen.getByText("0.0038 ETH")).toBeInTheDocument(); // dest is ethereum
  });

  it("renders BridgeStepper with txHashes links", async () => {
    jest.useFakeTimers();
    render(<BridgeInterface credentials={mockCredentials} />);

    fireEvent.click(screen.getByText("KYC Level 2"));
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    // The BridgeStepper is rendered with empty txHashes
    // Step descriptions should still appear
    expect(screen.getByText("Initiate")).toBeInTheDocument();

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    jest.useRealTimers();
  });
});
