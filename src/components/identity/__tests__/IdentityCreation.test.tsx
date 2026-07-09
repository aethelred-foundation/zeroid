import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import IdentityCreation from "@/components/identity/IdentityCreation";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, variants, custom, ...props }: any) => {
      if (variants && custom !== undefined) {
        if (typeof variants.enter === "function") variants.enter(custom);
        if (typeof variants.exit === "function") variants.exit(custom);
      }
      return <div {...props}>{children}</div>;
    },
    button: ({ children, onClick, disabled, ...props }: any) => (
      <button onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock("lucide-react", () => {
  const icon = (name: string) => (props: any) =>
    <div data-testid={`icon-${name}`} {...props} />;
  return {
    Wallet: icon("wallet"),
    ShieldCheck: icon("shield-check"),
    Fingerprint: icon("fingerprint"),
    Globe: icon("globe"),
    ArrowRight: icon("arrow-right"),
    ArrowLeft: icon("arrow-left"),
    CheckCircle2: icon("check"),
    Loader2: icon("loader"),
    AlertCircle: icon("alert"),
    ScanFace: icon("scan-face"),
  };
});

const mockConnect = jest.fn();
const mockConnectors = [
  { id: "metamask", name: "MetaMask" },
  { id: "walletconnect", name: "WalletConnect" },
];

const mockUseAccount = jest.fn(() => ({ address: undefined, isConnected: false }));
jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useConnect: () => ({ connectors: mockConnectors, connect: mockConnect }),
}));

const mockCreateIdentity = jest.fn().mockResolvedValue(undefined);
jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => ({ createIdentity: mockCreateIdentity }),
}));

const mockInitiateVerification = jest.fn().mockResolvedValue(undefined);
const mockUseUAEPass = jest.fn(() => ({
  initiateVerification: mockInitiateVerification,
  verificationStatus: "idle",
  error: null,
}));
jest.mock("@/hooks/useUAEPass", () => ({ useUAEPass: () => mockUseUAEPass() }));

const mockStartScan = jest.fn().mockResolvedValue(undefined);
const mockUseBiometric = jest.fn(() => ({
  startScan: mockStartScan,
  scanStatus: "idle",
  error: null,
}));
jest.mock("@/hooks/useBiometric", () => ({
  useBiometric: () => mockUseBiometric(),
}));

const connected = () =>
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
  mockUseUAEPass.mockReturnValue({
    initiateVerification: mockInitiateVerification,
    verificationStatus: "idle",
    error: null,
  });
  mockUseBiometric.mockReturnValue({
    startScan: mockStartScan,
    scanStatus: "idle",
    error: null,
  });
  mockCreateIdentity.mockResolvedValue(undefined);
  mockInitiateVerification.mockResolvedValue(undefined);
  mockStartScan.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// Default (testnet) flow — enterprise steps gated off → Connect Wallet → Register
// ═══════════════════════════════════════════════════════════════════════════
describe("IdentityCreation — default testnet flow", () => {
  it("renders only two steps (Connect Wallet + Register), enterprise steps hidden", () => {
    const { container } = render(<IdentityCreation />);
    const dots = container.querySelectorAll('[class*="w-2 h-2 rounded-full"]');
    expect(dots.length).toBe(2);
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
    expect(screen.queryByText("UAE Pass Verification")).not.toBeInTheDocument();
    expect(
      screen.queryByText("TEE Biometric Verification"),
    ).not.toBeInTheDocument();
  });

  it("renders wallet connectors and connects on click", () => {
    render(<IdentityCreation />);
    expect(screen.getByText("MetaMask")).toBeInTheDocument();
    fireEvent.click(screen.getByText("MetaMask"));
    expect(mockConnect).toHaveBeenCalledWith({ connector: mockConnectors[0] });
  });

  it("shows the connected wallet address", () => {
    connected();
    render(<IdentityCreation />);
    expect(screen.getByText("Wallet Connected")).toBeInTheDocument();
    expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
    expect(screen.queryByText("MetaMask")).not.toBeInTheDocument();
  });

  it("surfaces a wallet connect error", async () => {
    mockConnect.mockImplementation(() => {
      throw new Error("User rejected");
    });
    render(<IdentityCreation />);
    await act(async () => fireEvent.click(screen.getByText("MetaMask")));
    expect(screen.getByText("User rejected")).toBeInTheDocument();
  });

  it("falls back to a generic message on a non-Error connect failure", async () => {
    mockConnect.mockImplementation(() => {
      throw "boom";
    });
    render(<IdentityCreation />);
    await act(async () => fireEvent.click(screen.getByText("MetaMask")));
    expect(screen.getByText("Failed to connect wallet")).toBeInTheDocument();
  });

  it("Next advances to the Register step; Back returns", () => {
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Register Your Identity")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
  });

  it("Back is disabled on the first step, Next disabled on the last", () => {
    render(<IdentityCreation />);
    expect(screen.getByText("Back").closest("button")).toBeDisabled();
    fireEvent.click(screen.getByText("Next")); // → register (last)
    expect(screen.getByText("Next").closest("button")).toBeDisabled();
  });

  it("register button is disabled until a wallet is connected", () => {
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByRole("button", { name: /register identity/i }).closest("button")).toBeDisabled();
    expect(
      screen.getByText("Connect your wallet first (step 1)."),
    ).toBeInTheDocument();
  });

  it("registers the identity and shows the success state", async () => {
    connected();
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /register identity/i })),
    );
    expect(mockCreateIdentity).toHaveBeenCalled();
    expect(screen.getByText("Identity Registered")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /go to dashboard/i });
    expect(cta).toHaveAttribute("href", "/");
  });

  it("shows Registering... while the transaction is in flight", async () => {
    connected();
    let resolve: () => void;
    mockCreateIdentity.mockImplementation(
      () => new Promise<void>((r) => (resolve = r)),
    );
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    act(() => fireEvent.click(screen.getByRole("button", { name: /register identity/i })));
    expect(screen.getByText("Registering...")).toBeInTheDocument();
    await act(async () => resolve!());
  });

  it("surfaces a registration error and stays on the register step", async () => {
    connected();
    mockCreateIdentity.mockRejectedValueOnce(new Error("Transaction reverted"));
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /register identity/i })),
    );
    expect(screen.getByText("Transaction reverted")).toBeInTheDocument();
    expect(screen.queryByText("Identity Registered")).not.toBeInTheDocument();
  });

  it("falls back to a generic message on a non-Error registration failure", async () => {
    connected();
    mockCreateIdentity.mockRejectedValueOnce(null);
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /register identity/i })),
    );
    expect(screen.getByText("Identity registration failed")).toBeInTheDocument();
  });

  it("clicking a completed step indicator navigates back", () => {
    connected();
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next")); // marks step 0 complete
    const stepButtons = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("rounded-full"));
    fireEvent.click(stepButtons[0]);
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Enterprise flow — feature flags on → the UAE Pass + TEE steps appear
// ═══════════════════════════════════════════════════════════════════════════
describe("IdentityCreation — enterprise flow (flags on)", () => {
  // Flags are read at render time (literal process.env.* so Next inlines them in
  // a build), so tests just set them before rendering — no module re-import.
  beforeEach(() => {
    process.env.NEXT_PUBLIC_UAE_PASS_ENABLED = "true";
    process.env.NEXT_PUBLIC_TEE_BIOMETRIC_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_UAE_PASS_ENABLED;
    delete process.env.NEXT_PUBLIC_TEE_BIOMETRIC_ENABLED;
  });

  it("renders all four steps including the enterprise ones", () => {
    const { container } = render(<IdentityCreation />);
    const dots = container.querySelectorAll('[class*="w-2 h-2 rounded-full"]');
    expect(dots.length).toBe(4);
  });

  it("marks optional steps as skippable (Skip button + Optional label)", () => {
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next")); // → UAE Pass (optional)
    expect(screen.getByText("UAE Pass Identity Verification")).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
    expect(screen.getByText(/Optional/)).toBeInTheDocument();
  });

  it("runs the UAE Pass verification action", async () => {
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next"));
    await act(async () =>
      fireEvent.click(screen.getByText("Start UAE Pass OAuth")),
    );
    expect(mockInitiateVerification).toHaveBeenCalled();
  });

  it("runs the TEE biometric action", async () => {
    render(<IdentityCreation />);
    fireEvent.click(screen.getByText("Next")); // UAE Pass
    fireEvent.click(screen.getByText("Skip")); // → biometric
    expect(screen.getByText("Biometric Verification")).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByText("Request TEE Verification")),
    );
    expect(mockStartScan).toHaveBeenCalled();
  });
});
