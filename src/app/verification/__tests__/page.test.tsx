import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const mockUseAccount = jest.fn();
jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const mockUseIdentity = jest.fn();
jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentity(),
}));

const mockUsePendingVerifications = jest.fn();
const mockUseVerificationHistory = jest.fn();
const mockUseDeclineVerification = jest.fn();
jest.mock("@/hooks/useVerification", () => ({
  usePendingVerifications: () => mockUsePendingVerifications(),
  useVerificationHistory: () => mockUseVerificationHistory(),
  useDeclineVerification: () => mockUseDeclineVerification(),
}));

import VerificationPage from "../page";

const pendingRefetch = jest.fn();
const historyRefetch = jest.fn();
const declineMutate = jest.fn();
const signIn = jest.fn().mockResolvedValue(undefined);

const pendingRequest = {
  id: "request-1",
  verifierDid: "did:aethelred:testnet:verifier",
  subjectDid: "did:aethelred:testnet:subject",
  credentialHash: `0x${"1".repeat(64)}`,
  requestedAttributes: ["age", "residency"],
  circuitId: `0x${"2".repeat(64)}`,
  status: "pending",
  createdAt: 1_767_225_600,
  expiresAt: 1_785_715_200,
  purpose: "Regulated onboarding",
  userConsent: false,
};

const historyRecords = [
  {
    requestId: "history-verified",
    verified: true,
    attributeResults: [],
    verifiedAt: 1_767_225_600,
  },
  {
    requestId: "history-pending",
    verified: false,
    attributeResults: [],
    verifiedAt: 1_767_225_600,
    error: "PENDING",
  },
];

function queryState<T>(data: T, refetch: jest.Mock) {
  return {
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch,
  };
}

describe("VerificationPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAccount.mockReturnValue({ isConnected: true });
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "authenticated",
      sessionError: null,
      signIn,
    });
    mockUsePendingVerifications.mockReturnValue(
      queryState([pendingRequest], pendingRefetch),
    );
    mockUseVerificationHistory.mockReturnValue(
      queryState({ items: historyRecords, total: 2 }, historyRefetch),
    );
    mockUseDeclineVerification.mockReturnValue({
      mutate: declineMutate,
      isPending: false,
      variables: undefined,
      error: null,
    });
  });

  it("renders authenticated server records by default", () => {
    render(<VerificationPage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Verification" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Regulated onboarding")).toBeInTheDocument();
    expect(
      screen.getByText("did:aethelred:testnet:verifier"),
    ).toBeInTheDocument();
    expect(screen.getByText("age, residency")).toBeInTheDocument();
  });

  it("fails closed when artifact and deployment evidence is unavailable", () => {
    render(<VerificationPage />);

    expect(
      screen.getByRole("heading", { name: "Proof response is unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No trusted manifest exposed")).toBeInTheDocument();
    expect(screen.getByText("No pinned evidence exposed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Proof response unavailable" }),
    ).toBeDisabled();
  });

  it("allows a holder to durably decline without proof artifacts", () => {
    render(<VerificationPage />);

    fireEvent.click(screen.getByRole("button", { name: "Decline request" }));
    expect(declineMutate).toHaveBeenCalledWith("request-1");
  });

  it("does not expose static circuit support or unconditional privacy claims", () => {
    render(<VerificationPage />);

    expect(screen.queryByText("Supported Proofs")).not.toBeInTheDocument();
    expect(screen.queryByText("Verify On-chain")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Zero Knowledge Guarantee"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Generate Proof")).not.toBeInTheDocument();
  });

  it("formats Unix-second timestamps as real dates instead of 1970", () => {
    render(<VerificationPage />);

    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it("switches to recorded history without inventing proof types or verifiers", () => {
    render(<VerificationPage />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    expect(screen.getByText("history-verified")).toBeInTheDocument();
    expect(screen.getByText("history-pending")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getAllByText("Verification record")).toHaveLength(2);
    expect(screen.queryByText(/Unknown verifier/)).not.toBeInTheDocument();
  });

  it("shows an API-specific empty state for pending requests", () => {
    mockUsePendingVerifications.mockReturnValue(queryState([], pendingRefetch));
    render(<VerificationPage />);

    expect(
      screen.getByText("No pending requests returned"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/did not return a pending verification request/),
    ).toBeInTheDocument();
  });

  it("shows an API-specific empty state for history", () => {
    mockUseVerificationHistory.mockReturnValue(
      queryState({ items: [], total: 0 }, historyRefetch),
    );
    render(<VerificationPage />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    expect(
      screen.getByText("No verification records returned"),
    ).toBeInTheDocument();
  });

  it("renders loading and request errors truthfully", () => {
    mockUsePendingVerifications.mockReturnValue({
      ...queryState([], pendingRefetch),
      isLoading: true,
    });
    const { rerender } = render(<VerificationPage />);
    expect(
      screen.getByText("Loading authenticated verification records..."),
    ).toBeInTheDocument();

    mockUsePendingVerifications.mockReturnValue({
      ...queryState([], pendingRefetch),
      error: new Error("Verification service unavailable"),
      isLoading: false,
    });
    rerender(<VerificationPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verification service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pendingRefetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes only the active record source", () => {
    render(<VerificationPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh verification records" }),
    );
    expect(pendingRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh verification records" }),
    );
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

  it("does not query protected content in the disconnected UI", () => {
    mockUseAccount.mockReturnValue({ isConnected: false });
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: false },
      sessionStatus: "anonymous",
      sessionError: null,
      signIn,
    });
    render(<VerificationPage />);

    expect(screen.getByText("Connect your wallet")).toBeInTheDocument();
    expect(screen.queryByText("Regulated onboarding")).not.toBeInTheDocument();
  });

  it("directs an unregistered wallet to identity setup", () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: false },
      sessionStatus: "sign-in-required",
      sessionError: null,
      signIn,
    });
    render(<VerificationPage />);

    expect(screen.getByText("Register this wallet first")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open identity setup" }),
    ).toHaveAttribute("href", "/identity");
  });

  it("requires the one-time wallet sign-in before showing records", () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: null,
      signIn,
    });
    render(<VerificationPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with wallet" }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Regulated onboarding")).not.toBeInTheDocument();
  });
});
