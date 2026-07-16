import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("lucide-react", () => ({
  Wallet: (props: Record<string, unknown>) => (
    <span data-testid="icon-wallet" {...props} />
  ),
  ChevronDown: (props: Record<string, unknown>) => (
    <span data-testid="icon-chevron-down" {...props} />
  ),
  BadgeCheck: (props: Record<string, unknown>) => (
    <span data-testid="icon-badge-check" {...props} />
  ),
  AlertCircle: (props: Record<string, unknown>) => (
    <span data-testid="icon-alert-circle" {...props} />
  ),
}));

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSwitchChain = jest.fn();
let mockAccountState: Record<string, unknown>;
let mockConnectState: Record<string, unknown>;
let mockChainId: number;
let mockBalanceState: Record<string, unknown>;

jest.mock("wagmi", () => ({
  useAccount: () => mockAccountState,
  useConnect: () => mockConnectState,
  useDisconnect: () => ({ disconnect: mockDisconnect }),
  useSwitchChain: () => ({ switchChain: mockSwitchChain }),
  useChainId: () => mockChainId,
  useBalance: () => mockBalanceState,
}));

import { WalletButton } from "@/components/ui/WalletButton";
import { activeChain } from "@/config/chains";

describe("WalletButton", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSwitchChain.mockClear();
    mockAccountState = {
      address: undefined,
      isConnected: false,
      isConnecting: false,
    };
    mockConnectState = {
      connectors: [
        { uid: "injected", name: "Browser Wallet" },
        { uid: "coinbase", name: "Coinbase Wallet" },
      ],
      connect: mockConnect,
      isPending: false,
    };
    mockChainId = activeChain.id;
    mockBalanceState = { data: undefined };
  });

  it("renders loading skeleton when connecting", () => {
    mockAccountState = { ...mockAccountState, isConnecting: true };
    const { container } = render(<WalletButton />);
    const skeleton = container.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
  });

  it("orders EIP-6963 wallets Aethelred-first, hides the generic fallback, and marks the first-party wallet", () => {
    mockConnectState = {
      connectors: [
        { uid: "w0", id: "injected", name: "Injected" },
        { uid: "w1", id: "io.metamask", name: "MetaMask", icon: "data:image/svg+xml,fox" },
        {
          uid: "w2",
          id: "org.aethelred.wallet",
          name: "Aethelred Wallet",
          icon: "data:image/svg+xml,cube",
        },
      ],
      connect: mockConnect,
      isPending: false,
    };

    render(<WalletButton />);
    fireEvent.click(screen.getByText("Connect"));

    const entries = screen.getAllByRole("button").slice(1); // drop the Connect toggle
    expect(entries.map((b) => b.textContent)).toEqual([
      "Aethelred WalletRecommended",
      "MetaMaskWallet",
    ]);
    expect(screen.queryByText("Injected")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Aethelred Wallet"));
    expect(mockConnect).toHaveBeenCalledWith({
      connector: expect.objectContaining({ id: "org.aethelred.wallet" }),
    });
  });

  it("opens connector menu and connects with selected wallet", () => {
    render(<WalletButton />);

    fireEvent.click(screen.getByText("Connect"));
    expect(screen.getByText("Browser Wallet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Browser Wallet"));
    expect(mockConnect).toHaveBeenCalledWith({
      connector: { uid: "injected", name: "Browser Wallet" },
    });
  });

  it("renders account info when connected", () => {
    mockAccountState = {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      isConnected: true,
      isConnecting: false,
    };
    mockBalanceState = {
      data: {
        value: 1500000000000000000n,
        decimals: 18,
        symbol: "ETH",
      },
    };

    render(<WalletButton />);

    expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
    expect(screen.getByText(activeChain.name)).toBeInTheDocument();
    expect(screen.getByText("1.5 ETH")).toBeInTheDocument();
  });

  it("shows Wrong Network and switches to active chain", () => {
    mockAccountState = {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      isConnected: true,
      isConnecting: false,
    };
    mockChainId = 999999;

    render(<WalletButton />);

    const wrongNetwork = screen.getByText("Wrong Network");
    expect(wrongNetwork).toBeInTheDocument();
    fireEvent.click(wrongNetwork);
    expect(mockSwitchChain).toHaveBeenCalledWith({ chainId: activeChain.id });
  });

  it("disconnects when account button is clicked", () => {
    mockAccountState = {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      isConnected: true,
      isConnecting: false,
    };

    render(<WalletButton />);
    fireEvent.click(screen.getByTitle("Disconnect wallet"));
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("applies custom className", () => {
    const { container } = render(<WalletButton className="custom-wallet" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("custom-wallet");
  });
});
