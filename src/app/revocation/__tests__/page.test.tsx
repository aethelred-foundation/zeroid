import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/revocation",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) =>
        React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, ...rest } = props;
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

const mockRevokeCredential = jest.fn();
const mockUseCredentials = jest.fn();

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: (...args: unknown[]) => mockUseCredentials(...args),
  useRevokeCredential: () => ({ mutateAsync: mockRevokeCredential }),
}));

jest.mock("@/components/ui/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

jest.mock("@/components/ui/Modal", () => ({
  Modal: ({ open, children, title, onClose }: any) =>
    open ? (
      <div data-testid="modal" role="dialog">
        <h2>{title}</h2>
        {children}
        <button data-testid="modal-close-btn" onClick={onClose}>
          X
        </button>
      </div>
    ) : null,
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import RevocationPage from "../page";

const activeCredentialId = "d74ed26c-47ac-4b62-94a8-38704c53b876";
const credentials = [
  {
    id: activeCredentialId,
    typeLabel: "KYC Level 2",
    status: "active",
    issuedAt: "2026-07-18T08:00:00.000Z",
    expiresAt: "2027-07-18T08:00:00.000Z",
  },
  {
    id: "9b4bde84-439b-452b-a0eb-d0671988ad44",
    typeLabel: "Employment",
    status: "revoked",
    issuedAt: "2026-01-18T08:00:00.000Z",
    expiresAt: null,
  },
];

describe("RevocationPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCredentials.mockReturnValue({
      data: { credentials },
      isLoading: false,
    });
  });

  it("queries the authenticated issuer inventory, not holder inventory", () => {
    render(<RevocationPage />);
    expect(mockUseCredentials).toHaveBeenCalledWith(undefined, "issuer");
  });

  it("states the registry boundary without claiming an on-chain transaction", () => {
    render(<RevocationPage />);
    expect(
      screen.getByText("Issuer-only registry revocation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not claim an on-chain transaction/i),
    ).toBeInTheDocument();
  });

  it("lists issuer-owned active and revoked credentials", () => {
    render(<RevocationPage />);
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
    expect(screen.getByText("Employment")).toBeInTheDocument();
    expect(screen.getByText(/Previously Revoked/)).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("revoked");
  });

  it("filters issuer credentials by normalized type label", () => {
    render(<RevocationPage />);
    fireEvent.change(
      screen.getByPlaceholderText("Search credentials issued by you..."),
      { target: { value: "KYC" } },
    );
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
  });

  it("requires an audit reason and submits an API registry revocation", async () => {
    mockRevokeCredential.mockResolvedValue(undefined);
    render(<RevocationPage />);
    fireEvent.click(screen.getByText("Revoke"));

    const confirm = screen.getByText("Confirm Revoke");
    expect(confirm).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText(
        "Explain why this credential is no longer valid",
      ),
      { target: { value: "Source record was withdrawn by the authority" } },
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockRevokeCredential).toHaveBeenCalledWith({
        credentialId: activeCredentialId,
        reason: "Source record was withdrawn by the authority",
      }),
    );
  });

  it("leaves API failure reporting to the mutation without a duplicate toast", async () => {
    const { toast } = require("sonner");
    mockRevokeCredential.mockRejectedValue(new Error("forbidden"));
    render(<RevocationPage />);
    fireEvent.click(screen.getByText("Revoke"));
    fireEvent.change(
      screen.getByPlaceholderText(
        "Explain why this credential is no longer valid",
      ),
      { target: { value: "Credential was issued in error" } },
    );
    fireEvent.click(screen.getByText("Confirm Revoke"));

    await waitFor(() => expect(mockRevokeCredential).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not fabricate a revocation timestamp absent from the DTO", () => {
    render(<RevocationPage />);
    expect(
      screen.getByText("Revocation recorded in the ZeroID registry"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  });

  it("handles an absent credential response", () => {
    mockUseCredentials.mockReturnValue({ data: undefined, isLoading: false });
    render(<RevocationPage />);
    expect(screen.getByText("Active Credentials (0)")).toBeInTheDocument();
    expect(
      screen.getByText("No active credentials to revoke"),
    ).toBeInTheDocument();
  });
});
