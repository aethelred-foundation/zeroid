import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/verification",
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

const mockUseVerification = jest.fn();
jest.mock("@/hooks/useVerification", () => ({
  useVerification: () => mockUseVerification(),
}));

jest.mock("@/hooks/useZKProof", () => ({
  useZKProof: () => ({
    proofHistory: [],
  }),
}));

jest.mock("@/components/verification/VerificationFlow", () => ({
  __esModule: true,
  default: () => <div data-testid="verification-flow">Verification Flow</div>,
}));

jest.mock("@/components/verification/SelectiveDisclosureBuilder", () => ({
  __esModule: true,
  default: () => (
    <div data-testid="selective-disclosure">Selective Disclosure Builder</div>
  ),
}));

jest.mock("@/components/zkp/ProofVisualization", () => ({
  __esModule: true,
  default: ({ proofId, onClose }: any) => (
    <div data-testid="proof-visualization">
      Proof: {proofId} <button onClick={onClose}>Close</button>
    </div>
  ),
}));

jest.mock("@/components/ui/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

import VerificationPage from "../page";

const defaultVerificationData = {
  verificationHistory: [
    {
      id: "v1",
      proofType: "Age",
      verifier: "Cruzible",
      status: "verified",
      timestamp: "2025-03-01",
    },
    {
      id: "v2",
      proofType: "KYC",
      verifier: "NoblePay",
      status: "pending",
      timestamp: "2025-03-02",
    },
  ],
  pendingRequests: [
    { id: "r1", type: "Age Verification", requester: "Cruzible" },
  ],
};

describe("VerificationPage", () => {
  beforeEach(() => {
    mockUseVerification.mockReturnValue(defaultVerificationData);
  });

  it("renders without crashing", () => {
    render(<VerificationPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<VerificationPage />);
    expect(screen.getByText("Verification")).toBeInTheDocument();
  });

  it("shows pending requests badge", () => {
    render(<VerificationPage />);
    expect(screen.getByText(/1 pending request/)).toBeInTheDocument();
  });

  it("shows generate proof tab by default with verification flow", () => {
    render(<VerificationPage />);
    expect(screen.getByTestId("verification-flow")).toBeInTheDocument();
    expect(screen.getByText("How ZK Proofs Work")).toBeInTheDocument();
  });

  it("switches to Respond to Request tab", () => {
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("Respond to Request"));
    expect(screen.getByTestId("selective-disclosure")).toBeInTheDocument();
  });

  it("switches to History tab and shows verification history", () => {
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("Verification History")).toBeInTheDocument();
    expect(screen.getByText("Age Proof")).toBeInTheDocument();
    expect(screen.getByText("KYC Proof")).toBeInTheDocument();
  });

  it("clicking a verification in history shows proof visualization", () => {
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    fireEvent.click(screen.getByText("Age Proof"));
    expect(screen.getByTestId("proof-visualization")).toBeInTheDocument();
    expect(screen.getByText("Proof: v1")).toBeInTheDocument();
  });

  it("closing proof visualization hides it", () => {
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    fireEvent.click(screen.getByText("Age Proof"));
    expect(screen.getByTestId("proof-visualization")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("proof-visualization")).not.toBeInTheDocument();
  });

  it('shows plural "requests" when pendingRequests > 1', () => {
    mockUseVerification.mockReturnValue({
      ...defaultVerificationData,
      pendingRequests: [
        { id: "r1", type: "Age Verification", requester: "Cruzible" },
        { id: "r2", type: "KYC Verification", requester: "NoblePay" },
      ],
    });
    render(<VerificationPage />);
    expect(screen.getByText(/2 pending requests/)).toBeInTheDocument();
  });

  it("hides pending requests badge when no pending requests", () => {
    mockUseVerification.mockReturnValue({
      ...defaultVerificationData,
      pendingRequests: [],
    });
    render(<VerificationPage />);
    expect(screen.queryByText(/pending request/)).not.toBeInTheDocument();
  });

  it("shows empty state when verification history is empty", () => {
    mockUseVerification.mockReturnValue({
      verificationHistory: [],
      pendingRequests: [],
    });
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("No verifications yet")).toBeInTheDocument();
    expect(
      screen.getByText("Generate your first ZK proof to get started"),
    ).toBeInTheDocument();
  });

  it("shows empty state when verification history is null", () => {
    mockUseVerification.mockReturnValue({
      verificationHistory: null,
      pendingRequests: null,
    });
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("No verifications yet")).toBeInTheDocument();
  });

  it("renders revoked status styling for history items", () => {
    mockUseVerification.mockReturnValue({
      verificationHistory: [
        {
          id: "v1",
          proofType: "Age",
          verifier: "Cruzible",
          status: "verified",
          timestamp: "2025-03-01",
        },
        {
          id: "v2",
          proofType: "KYC",
          verifier: "NoblePay",
          status: "pending",
          timestamp: "2025-03-02",
        },
        {
          id: "v3",
          proofType: "AML",
          verifier: "Exchange",
          status: "revoked",
          timestamp: "2025-03-03",
        },
      ],
      pendingRequests: [],
    });
    render(<VerificationPage />);
    fireEvent.click(screen.getByText("History"));
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBe(3);
    expect(badges[2]).toHaveTextContent("revoked");
  });
});
