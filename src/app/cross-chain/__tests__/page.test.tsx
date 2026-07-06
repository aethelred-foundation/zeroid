import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

jest.mock("@/hooks/useCrossChain", () => ({
  useSupportedChains: jest.fn(),
  useBridgedCredentials: jest.fn(),
  useBridgeFeeEstimate: jest.fn(),
  useBridgeCredential: jest.fn(),
}));

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: jest.fn(),
}));

import {
  useBridgeCredential,
  useBridgeFeeEstimate,
  useBridgedCredentials,
  useSupportedChains,
} from "@/hooks/useCrossChain";
import { useCredentials } from "@/hooks/useCredentials";
import CrossChainPage from "../page";

const mockUseSupportedChains = useSupportedChains as jest.Mock;
const mockUseBridgedCredentials = useBridgedCredentials as jest.Mock;
const mockUseBridgeFeeEstimate = useBridgeFeeEstimate as jest.Mock;
const mockUseBridgeCredential = useBridgeCredential as jest.Mock;
const mockUseCredentials = useCredentials as jest.Mock;
const mockBridgeMutateAsync = jest.fn();

const supportedChainRows = [
  {
    chainId: 1,
    name: "Ethereum",
    shortName: "eth",
    network: "mainnet",
    bridgeContractAddress: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://etherscan.io",
    avgBlockTimeMs: 12_000,
    requiredConfirmations: 12,
    isActive: false,
    supportedCredentialTypes: ["kyc", "identity"],
    bridgeFeeBaseBps: 35,
  },
  {
    chainId: 137,
    name: "Polygon",
    shortName: "pol",
    network: "mainnet",
    bridgeContractAddress: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://polygonscan.com",
    avgBlockTimeMs: 2_100,
    requiredConfirmations: 128,
    isActive: false,
    supportedCredentialTypes: ["kyc", "identity"],
    bridgeFeeBaseBps: 20,
  },
  {
    chainId: 42161,
    name: "Arbitrum One",
    shortName: "arb",
    network: "mainnet",
    bridgeContractAddress: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://arbiscan.io",
    avgBlockTimeMs: 250,
    requiredConfirmations: 20,
    isActive: false,
    supportedCredentialTypes: ["kyc", "identity"],
    bridgeFeeBaseBps: 25,
  },
];

describe("CrossChainPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBridgeMutateAsync.mockResolvedValue({
      id: "bridge-1",
      credentialId: "cred-kyc",
      credentialSchemaName: "KYC Identity Verification",
      sourceChainId: 1,
      destinationChainId: 137,
      sourceChainName: "Ethereum",
      destinationChainName: "Polygon",
      status: "pending",
      priority: "standard",
      initiatedAt: "2026-06-26T00:00:00.000Z",
      estimatedCompletionAt: "2026-06-26T00:10:00.000Z",
      fee: {
        baseFee: "0.001020",
        priorityFee: "0.000000",
        totalFee: "0.001020",
        feeCurrency: "ETH",
        feeUSD: 3.26,
      },
      sourceConfirmations: 0,
      requiredConfirmations: 128,
    });
    mockUseSupportedChains.mockReturnValue({
      data: supportedChainRows,
      isLoading: false,
      isError: false,
    });
    mockUseCredentials.mockReturnValue({
      credentials: [
        {
          id: "cred-kyc",
          hash: "0xabc",
          schemaHash: "0xschema",
          schemaName: "KYC Identity Verification",
          issuerDid: "did:aethelred:issuer:zeroid",
          subjectDid: "did:aethelred:subject:demo",
          issuedAt: 1_700_000_000,
          expiresAt: 2_000_000_000,
          status: "verified",
          merkleRoot: "0xroot",
        },
        {
          id: "cred-age",
          hash: "0xdef",
          schemaHash: "0xschema2",
          schemaName: "Age Verification (18+)",
          issuerDid: "did:aethelred:issuer:zeroid",
          subjectDid: "did:aethelred:subject:demo",
          issuedAt: 1_700_000_000,
          expiresAt: 2_000_000_000,
          status: "verified",
          merkleRoot: "0xroot2",
        },
      ],
      total: 2,
      isLoading: false,
      isError: false,
    });
    mockUseBridgedCredentials.mockReturnValue({
      data: [
        {
          credentialId: "cred-kyc",
          originalChainId: 1,
          bridgedChainId: 137,
          originalChainName: "Ethereum",
          bridgedChainName: "Polygon",
          schemaName: "KYC Identity Verification",
          bridgedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
          expiresAt: "2030-01-01T00:00:00.000Z",
          status: "active",
          bridgeTxId: "bridge-cred-kyc-137",
          lastSyncedAt: "2026-06-26T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    });
    mockUseBridgeFeeEstimate.mockReturnValue({
      data: {
        credentialId: "cred-kyc",
        destinationChainId: 137,
        estimates: {
          standard: {
            baseFee: "0.001020",
            priorityFee: "0.000000",
            totalFee: "0.001020",
            feeCurrency: "ETH",
            feeUSD: 3.26,
          },
          fast: {
            baseFee: "0.001020",
            priorityFee: "0.000816",
            totalFee: "0.001836",
            feeCurrency: "ETH",
            feeUSD: 5.88,
          },
          instant: {
            baseFee: "0.001020",
            priorityFee: "0.002244",
            totalFee: "0.003264",
            feeCurrency: "ETH",
            feeUSD: 10.44,
          },
        },
        estimatedTimes: {
          standard: 868.8,
          fast: 448.8,
          instant: 313.8,
        },
        validUntil: "2026-06-26T00:05:00.000Z",
      },
      isLoading: false,
      isError: false,
    });
    mockUseBridgeCredential.mockReturnValue({
      mutateAsync: mockBridgeMutateAsync,
      isPending: false,
      isError: false,
    });
  });

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
    expect(screen.getAllByText("Standard Fee").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Relayer Status")).toBeInTheDocument();
    expect(screen.getAllByText("0.001020 ETH").length).toBeGreaterThanOrEqual(1);
  });

  it("displays supported chains in the sidebar", () => {
    render(<CrossChainPage />);
    expect(screen.getAllByText("Ethereum").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Polygon").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Arbitrum One").length).toBeGreaterThanOrEqual(1);
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
    fireEvent.change(selects[0], { target: { value: "137" } });
    expect((selects[0] as HTMLSelectElement).value).toBe("137");
  });

  it("changes destination chain via dropdown", () => {
    render(<CrossChainPage />);
    const selects = screen.getAllByRole("combobox");
    // Destination chain select is the second one
    fireEvent.change(selects[1], { target: { value: "42161" } });
    expect((selects[1] as HTMLSelectElement).value).toBe("42161");
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
    const checkbox = screen.getByLabelText(/KYC Identity Verification/);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    // Bridge button should now mention "1 Credential"
    expect(screen.getByText(/Bridge 1 Credential$/)).toBeInTheDocument();
    // Toggle off
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("submits bridge requests through the cross-chain mutation", async () => {
    render(<CrossChainPage />);
    const checkbox = screen.getByLabelText(/KYC Identity Verification/);
    fireEvent.click(checkbox);
    const bridgeButton = screen.getByText(/Bridge 1 Credential/);
    fireEvent.click(bridgeButton);

    await waitFor(() =>
      expect(mockBridgeMutateAsync).toHaveBeenCalledWith({
        credentialId: "cred-kyc",
        destinationChainId: 137,
        priority: "standard",
        preservePrivacy: true,
      }),
    );
    expect(
      await screen.findByText(/Bridge accepted for Polygon/),
    ).toBeInTheDocument();
  });

  it("shows history tab with bridge status indicators", () => {
    render(<CrossChainPage />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText(/Bridge ID: bridge-cred-kyc/)).toBeInTheDocument();
  });

  it("shows relayer configuration errors instead of fake bridge progress", async () => {
    mockBridgeMutateAsync.mockRejectedValueOnce(
      new Error("Cross-chain bridge relayer endpoint is not configured."),
    );
    render(<CrossChainPage />);
    const checkbox = screen.getByLabelText(/KYC Identity Verification/);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText(/Bridge 1 Credential/));

    expect(
      await screen.findByText(
        "Cross-chain bridge relayer endpoint is not configured.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Bridge Submission Status")).toBeInTheDocument();
  });

  it('bridge button shows plural "Credentials" for multiple selections', () => {
    render(<CrossChainPage />);
    fireEvent.click(screen.getByLabelText(/KYC Identity Verification/));
    fireEvent.click(screen.getByLabelText(/Age Verification \(18\+\)/));
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
