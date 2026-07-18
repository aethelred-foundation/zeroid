import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/identity",
  useSearchParams: () => new URLSearchParams(),
}));

const mockUseAccount = jest.fn();
jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

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

jest.mock("@/components/identity/IdentityCard", () => ({
  __esModule: true,
  default: () => <div data-testid="identity-card">Identity Card</div>,
}));

jest.mock("@/components/identity/IdentityCreation", () => ({
  __esModule: true,
  default: () => <div data-testid="identity-creation">Identity Creation</div>,
}));

const mockUseIdentity = jest.fn();
jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { toast } from "sonner";
import IdentityPage from "../page";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const DID = `did:aethelred:testnet:${ADDRESS}`;
const DID_HASH = `0x${"1".repeat(64)}`;

function registeredIdentity(overrides: Record<string, unknown> = {}) {
  const profile = {
    did: DID,
    controller: ADDRESS,
    status: "ACTIVE",
    createdAt: "2026-07-17T08:00:00.000Z",
    credentialCount: 5,
    verificationCount: 12,
    teeAttested: true,
    governmentVerified: false,
  };

  return {
    identity: {
      did: DID,
      didHash: DID_HASH,
      hasIdentity: true,
      isRegistered: true,
      profile,
      credentialCount: 5,
      verificationCount: 12,
      createdAt: profile.createdAt,
      ...overrides,
    },
    isLoading: false,
    error: null,
    createIdentity: jest.fn(),
    registerOnChain: jest.fn(),
    delegateControl: jest.fn(),
    revokeDelegate: jest.fn(),
  };
}

describe("IdentityPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAccount.mockReturnValue({
      address: ADDRESS,
      isConnected: true,
    });
    mockUseIdentity.mockReturnValue(registeredIdentity());
  });

  it("asks for a controller wallet before loading identity data", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
    render(<IdentityPage />);

    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
    expect(screen.queryByText("Identity record")).not.toBeInTheDocument();
  });

  it("does not show onboarding while evidence is still loading", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: true,
      error: null,
    });
    render(<IdentityPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading identity evidence",
    );
    expect(screen.queryByText("Create Your Identity")).not.toBeInTheDocument();
  });

  it("fails closed when identity evidence cannot be loaded", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      error: new Error("Registry RPC unavailable"),
    });
    render(<IdentityPage />);

    expect(
      screen.getByText("Identity Evidence Unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Registry RPC unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Create Your Identity")).not.toBeInTheDocument();
  });

  it("offers registration only after both profile and registry evidence are absent", () => {
    mockUseIdentity.mockReturnValue({
      identity: {
        did: undefined,
        didHash: `0x${"0".repeat(64)}`,
        hasIdentity: false,
        isRegistered: false,
        profile: null,
      },
      isLoading: false,
      error: null,
    });
    render(<IdentityPage />);

    expect(screen.getByText("Create Your Identity")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create ZeroID" }));
    expect(screen.getByTestId("identity-creation")).toBeInTheDocument();
  });

  it("renders only returned identity record values", () => {
    render(<IdentityPage />);

    expect(screen.getByTestId("identity-card")).toBeInTheDocument();
    expect(screen.getByText(DID)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.getByText("On-chain registration confirmed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Current evidence returned")).toBeInTheDocument();
    expect(screen.getByText("No current evidence")).toBeInTheDocument();
  });

  it("does not expose the former no-op or fabricated controls", () => {
    render(<IdentityPage />);

    expect(screen.queryByText("Identity Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Add Delegate")).not.toBeInTheDocument();
    expect(screen.queryByText("Recovery Guardians")).not.toBeInTheDocument();
    expect(screen.queryByText("Guardian 1")).not.toBeInTheDocument();
    expect(screen.queryByText("3 of 5 guardians")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Update Recovery Configuration"),
    ).not.toBeInTheDocument();
  });

  it("does not invent counts, dates, statuses, or an on-chain anchor", () => {
    mockUseIdentity.mockReturnValue(
      registeredIdentity({
        didHash: undefined,
        hasIdentity: false,
        credentialCount: undefined,
        verificationCount: undefined,
        createdAt: "not-a-date",
        profile: { did: DID },
      }),
    );
    render(<IdentityPage />);

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(4);
    expect(
      screen.getByText("On-chain registration not confirmed"),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: "Open controller in Aethelred Explorer",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a durable API profile visible when the registry read has no anchor", () => {
    mockUseIdentity.mockReturnValue(
      registeredIdentity({
        didHash: undefined,
        hasIdentity: false,
      }),
    );
    render(<IdentityPage />);

    expect(screen.getByText("Identity record")).toBeInTheDocument();
    expect(screen.queryByText("Create Your Identity")).not.toBeInTheDocument();
    expect(
      screen.getByText("On-chain registration not confirmed"),
    ).toBeInTheDocument();
  });

  it("copies the returned DID and links only confirmed anchors to the active explorer", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IdentityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Copy DID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DID));
    expect(toast.success).toHaveBeenCalledWith("DID copied to clipboard");
    expect(
      screen.getByRole("link", {
        name: "Open controller in Aethelred Explorer",
      }),
    ).toHaveAttribute(
      "href",
      `https://explorer-testnet.aethelred.network/address/${ADDRESS}`,
    );
  });

  it("reports clipboard failure without claiming the DID was copied", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("blocked"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IdentityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Copy DID" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("DID could not be copied"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
