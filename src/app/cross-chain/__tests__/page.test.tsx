import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) =>
        React.forwardRef((props: any, ref: any) => {
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
        }),
    },
  ),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/hooks/useCrossChain", () => ({
  useCrossChainCapabilities: jest.fn(),
  useSupportedChains: jest.fn(),
}));

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: jest.fn(),
}));

import {
  useCrossChainCapabilities,
  useSupportedChains,
} from "@/hooks/useCrossChain";
import { useCredentials } from "@/hooks/useCredentials";
import CrossChainPage from "../page";

const mockUseCrossChainCapabilities = useCrossChainCapabilities as jest.Mock;
const mockUseSupportedChains = useSupportedChains as jest.Mock;
const mockUseCredentials = useCredentials as jest.Mock;

const realCredentials = [
  {
    id: "cred-live-kyc",
    hash: "0xabc",
    schemaHash: "0xschema",
    schemaName: "Live KYC Credential",
    issuerDid: { uri: "did:aethelred:testnet:issuer" },
    subjectDid: { uri: "did:aethelred:testnet:holder" },
    issuedAt: 1_700_000_000,
    expiresAt: 2_000_000_000,
    status: "verified",
    merkleRoot: "0xroot",
  },
  {
    id: "cred-live-residency",
    hash: "0xdef",
    schemaHash: "0xschema2",
    schemaName: "Live Residency Credential",
    issuer: "Verified UAE Issuer",
    issuerDid: { uri: "did:aethelred:testnet:uae-issuer" },
    subjectDid: { uri: "did:aethelred:testnet:holder" },
    issuedAt: 1_700_000_000,
    expiresAt: 2_000_000_000,
    status: "active",
    merkleRoot: "0xroot2",
  },
];

const destinationDefinitions = [
  {
    chainId: 1,
    name: "Ethereum",
    shortName: "eth",
    network: "mainnet",
    explorerUrl: "https://etherscan.io",
    isActive: false,
  },
  {
    chainId: 137,
    name: "Polygon",
    shortName: "pol",
    network: "mainnet",
    explorerUrl: "https://polygonscan.com",
    isActive: false,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCrossChainCapabilities.mockReturnValue({
    bridgeContractConfigured: true,
    relayerConfigured: false,
    destinationVerificationConfigured: false,
    infrastructureReady: false,
    missingCapabilities: ["Relayer service", "Destination-chain verification"],
  });
  mockUseSupportedChains.mockReturnValue({
    data: destinationDefinitions,
    isLoading: false,
    isError: false,
  });
  mockUseCredentials.mockReturnValue({
    credentials: realCredentials,
    total: realCredentials.length,
    isLoading: false,
    isError: false,
  });
});

describe("CrossChainPage truth-in-product gating", () => {
  it("renders an explicit unavailable state until all capabilities exist", () => {
    render(<CrossChainPage />);

    expect(screen.getByTestId("cross-chain-unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Cross-chain transfers are unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Missing: Relayer service, Destination-chain verification.",
      ),
    ).toBeInTheDocument();
  });

  it("shows only credentials returned by the real inventory hook", () => {
    render(<CrossChainPage />);

    expect(screen.getByText("Live KYC Credential")).toBeInTheDocument();
    expect(screen.getByText("Live Residency Credential")).toBeInTheDocument();
    expect(screen.getByText(/Verified UAE Issuer/)).toBeInTheDocument();
    expect(
      screen.queryByText("Age Verification (18+)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("AML Certificate")).not.toBeInTheDocument();
  });

  it("does not substitute demo credentials for an empty inventory", () => {
    mockUseCredentials.mockReturnValue({
      credentials: [],
      total: 0,
      isLoading: false,
      isError: false,
    });

    render(<CrossChainPage />);

    expect(
      screen.getByText(/No credentials were returned for this subject/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("KYC Identity Verification"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Accredited Investor Attestation"),
    ).not.toBeInTheDocument();
  });

  it("shows an honest inventory error without fallback records", () => {
    mockUseCredentials.mockReturnValue({
      credentials: [],
      total: 0,
      isLoading: false,
      isError: true,
    });

    render(<CrossChainPage />);

    expect(
      screen.getByText(/Credential inventory is unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/has not inserted fallback credentials/),
    ).toBeInTheDocument();
  });

  it("does not render bridge, verification, selection, or fee controls", () => {
    render(<CrossChainPage />);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /bridge|verify/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Standard Fee")).not.toBeInTheDocument();
    expect(screen.queryByText("Bridge Fee")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("labels destination definitions unavailable rather than operational", () => {
    render(<CrossChainPage />);

    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("Polygon")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(
        /listed network is not proof that bridge service is operational/i,
      ),
    ).toBeInTheDocument();
  });

  it("remains read-only even when infrastructure configuration is detected", () => {
    mockUseCrossChainCapabilities.mockReturnValue({
      bridgeContractConfigured: true,
      relayerConfigured: true,
      destinationVerificationConfigured: true,
      infrastructureReady: true,
      missingCapabilities: [],
    });
    mockUseSupportedChains.mockReturnValue({
      data: destinationDefinitions.map((chain) => ({
        ...chain,
        isActive: true,
      })),
      isLoading: false,
      isError: false,
    });

    render(<CrossChainPage />);

    expect(screen.getByTestId("cross-chain-configured")).toBeInTheDocument();
    expect(
      screen.getByText("Cross-chain infrastructure configured"),
    ).toBeInTheDocument();
    expect(screen.getByText(/client remains read-only/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /bridge|verify/i }),
    ).not.toBeInTheDocument();
  });
});
