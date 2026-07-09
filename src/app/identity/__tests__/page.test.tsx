import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/identity",
  useSearchParams: () => new URLSearchParams(),
}));

const mockUseAccount = jest.fn(() => ({
  address: "0x1234567890abcdef1234567890abcdef12345678",
  isConnected: true,
}));

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
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

const mockUseIdentity = jest.fn(() => ({
  identity: {
    did: "did:aethelred:zeroid:0x1234",
    status: "Active",
    createdAt: "2025-01-01",
    credentialCount: 5,
    verificationCount: 12,
    registrationBlock: "4,521,089",
  },
  delegates: [],
  isLoading: false,
  createIdentity: jest.fn(),
  revokeDelegate: jest.fn(),
}));

jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("@/components/identity/IdentityCard", () => ({
  __esModule: true,
  default: () => <div data-testid="identity-card">Identity Card</div>,
}));

jest.mock("@/components/identity/IdentityCreation", () => ({
  __esModule: true,
  default: () => <div data-testid="identity-creation">Identity Creation</div>,
}));

jest.mock("@/components/ui/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import IdentityPage from "../page";

describe("IdentityPage", () => {
  beforeEach(() => {
    mockUseAccount.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      isConnected: true,
    });
    mockUseIdentity.mockReturnValue({
      identity: {
        did: "did:aethelred:zeroid:0x1234",
        status: "Active",
        createdAt: "2025-01-01",
        credentialCount: 5,
        verificationCount: 12,
        registrationBlock: "4,521,089",
      },
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
  });

  it("renders without crashing", () => {
    render(<IdentityPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading when identity exists", () => {
    render(<IdentityPage />);
    expect(screen.getByText("Identity")).toBeInTheDocument();
  });

  it("shows connect wallet message when not connected", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
    render(<IdentityPage />);
    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
  });

  it("shows create identity prompt when no identity exists", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    expect(screen.getByText("Create Your Identity")).toBeInTheDocument();
  });

  it("renders identity card and tabs when identity exists", () => {
    render(<IdentityPage />);
    expect(screen.getByTestId("identity-card")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Delegates")).toBeInTheDocument();
    expect(screen.getByText("Recovery")).toBeInTheDocument();
  });

  it("switches to delegates tab", () => {
    render(<IdentityPage />);
    fireEvent.click(screen.getByText("Delegates"));
    expect(screen.getByText("No delegates configured")).toBeInTheDocument();
  });

  it("copies DID to clipboard when copy button is clicked", () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    const { toast } = require("sonner");
    render(<IdentityPage />);
    // Find the copy button near the DID display
    const copyButtons = screen.getAllByRole("button");
    // The copy button is inside the DID section - find button that triggers copyDID
    const didSection = screen.getByText("did:aethelred:zeroid:0x1234");
    const copyBtn = didSection.parentElement?.querySelector("button");
    fireEvent.click(copyBtn!);
    expect(writeTextMock).toHaveBeenCalledWith("did:aethelred:zeroid:0x1234");
    expect(toast.success).toHaveBeenCalledWith("DID copied to clipboard");
  });

  it("shows identity creation component when Create ZeroID is clicked", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    const createBtn = screen.getByText("Create ZeroID");
    fireEvent.click(createBtn);
    expect(screen.getByTestId("identity-creation")).toBeInTheDocument();
  });

  it("switches to recovery tab and shows guardians", () => {
    render(<IdentityPage />);
    fireEvent.click(screen.getByText("Recovery"));
    expect(screen.getByText("Social Recovery Configured")).toBeInTheDocument();
    expect(screen.getByText("Recovery Guardians")).toBeInTheDocument();
    expect(screen.getByText("Guardian 1")).toBeInTheDocument();
    expect(screen.getByText("Guardian 5")).toBeInTheDocument();
    expect(
      screen.getByText("Update Recovery Configuration"),
    ).toBeInTheDocument();
  });

  it("shows delegates list when delegates exist", () => {
    const mockRevokeDelegate = jest.fn();
    mockUseIdentity.mockReturnValue({
      identity: {
        did: "did:aethelred:zeroid:0x1234",
        status: "Active",
        createdAt: "2025-01-01",
        credentialCount: 5,
        verificationCount: 12,
        registrationBlock: "4,521,089",
      },
      delegates: [
        {
          address: "0xabcdef1234567890abcdef1234567890abcdef12",
          permissions: ["issue", "verify"],
        },
      ],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: mockRevokeDelegate,
    });
    render(<IdentityPage />);
    fireEvent.click(screen.getByText("Delegates"));
    expect(screen.getByText("0xabcd...ef12")).toBeInTheDocument();
    expect(screen.getByText("issue, verify")).toBeInTheDocument();
    // Click revoke
    fireEvent.click(screen.getByText("Revoke"));
    expect(mockRevokeDelegate).toHaveBeenCalledWith(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("displays identity overview details", () => {
    render(<IdentityPage />);
    expect(screen.getByText("Decentralized Identifier")).toBeInTheDocument();
    expect(screen.getByText("did:aethelred:zeroid:0x1234")).toBeInTheDocument();
    expect(screen.getByText("On-chain Anchored")).toBeInTheDocument();
    // The overview shows only real identity fields — no sample attestation rows.
    expect(screen.queryByText("TEE Attestation")).not.toBeInTheDocument();
    expect(screen.queryByText("Intel SGX")).not.toBeInTheDocument();
    expect(screen.queryByText("Just now")).not.toBeInTheDocument();
  });

  it("shows fallback values when identity fields are missing", () => {
    mockUseIdentity.mockReturnValue({
      identity: {
        did: null,
        // no status, createdAt, credentialCount, verificationCount, registrationBlock
      },
      delegates: null,
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    // DID fallback is an honest em dash, not a sample DID
    expect(screen.getByText("—")).toBeInTheDocument();
    // createdAt fallback
    expect(screen.getByText("N/A")).toBeInTheDocument();
    // credentialCount and verificationCount fallbacks (0)
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
    // no invented registration block number
    expect(screen.queryByText(/4,521,089/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Identity registered on the Aethelred L1"),
    ).toBeInTheDocument();
  });

  it("does not copy DID when identity.did is falsy", () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    mockUseIdentity.mockReturnValue({
      identity: { did: null },
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    const didSection = screen.getByText("—");
    const copyBtn = didSection.parentElement?.querySelector("button");
    fireEvent.click(copyBtn!);
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("shows empty delegates state when delegates is null", () => {
    mockUseIdentity.mockReturnValue({
      identity: {
        did: "did:aethelred:zeroid:0x1234",
        status: "Active",
        createdAt: "2025-01-01",
      },
      delegates: null,
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    fireEvent.click(screen.getByText("Delegates"));
    expect(screen.getByText("No delegates configured")).toBeInTheDocument();
  });

  it("renders overview detail items showing badge vs text correctly", () => {
    // Status renders a badge only for a genuinely verified identity; other
    // states render as plain text.
    mockUseIdentity.mockReturnValue({
      identity: {
        did: "did:aethelred:zeroid:0x1234",
        verificationStatus: "verified",
        createdAt: "2025-01-01",
        credentialCount: 5,
        verificationCount: 12,
      },
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    render(<IdentityPage />);
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);

    // An unverified identity shows its real status as text, not a badge.
    mockUseIdentity.mockReturnValue({
      identity: {
        did: "did:aethelred:zeroid:0x1234",
        verificationStatus: "unverified",
        createdAt: "2025-01-01",
        credentialCount: 0,
        verificationCount: 0,
      },
      delegates: [],
      isLoading: false,
      createIdentity: jest.fn(),
      revokeDelegate: jest.fn(),
    });
    const { getByText } = render(<IdentityPage />);
    expect(getByText("unverified")).toBeInTheDocument();
  });
});
