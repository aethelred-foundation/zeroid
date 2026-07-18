import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/credentials",
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

const mockUseCredentials = jest.fn();
const mockVerifyCredential = jest.fn();
jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: () => mockUseCredentials(),
}));

jest.mock("@/components/credentials/CredentialCard", () => ({
  __esModule: true,
  default: ({ credential, onVerify }: any) => (
    <div data-testid={`credential-card-${credential.id}`}>
      {credential.typeLabel}
      {onVerify && (
        <button onClick={() => onVerify(credential.id)}>Validate</button>
      )}
    </div>
  ),
}));

jest.mock("@/components/credentials/CredentialList", () => ({
  __esModule: true,
  default: () => <div data-testid="credential-list">CredentialList</div>,
}));

import CredentialsPage from "../page";

const credentials = [
  {
    id: "d74ed26c-47ac-4b62-94a8-38704c53b876",
    status: "active",
    credentialType: "KYC_LEVEL_2",
    typeLabel: "KYC Level 2",
    issuerId: "issuer-record-17",
  },
  {
    id: "9b4bde84-439b-452b-a0eb-d0671988ad44",
    status: "suspended",
    credentialType: "EDUCATION",
    typeLabel: "Education",
    issuerId: "issuer-university",
  },
  {
    id: "b3b31128-f0bf-42ea-bcba-4d33c671d1bc",
    status: "expired",
    credentialType: "EMPLOYMENT",
    typeLabel: "Employment",
    issuerId: "issuer-employer",
  },
];

describe("CredentialsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCredentials.mockReturnValue({
      data: { credentials },
      isLoading: false,
      error: null,
      accessState: "ready",
      verifyCredential: mockVerifyCredential,
    });
  });

  it("renders normalized credential inventory", () => {
    render(<CredentialsPage />);
    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getAllByTestId(/credential-card-/)).toHaveLength(3);
  });

  it("states that issuance is issuer-controlled", () => {
    render(<CredentialsPage />);
    expect(
      screen.getByTestId("credential-issuance-boundary"),
    ).toHaveTextContent("Issuance is issuer-controlled");
    expect(
      screen.getByText(/holder request and issuer-approval lifecycle/i),
    ).toBeInTheDocument();
  });

  it("does not expose a holder request button or fake schema catalogue", () => {
    render(<CredentialsPage />);
    expect(
      screen.queryByRole("button", { name: "Request Credential" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Available Credential Schemas"),
    ).not.toBeInTheDocument();
  });

  it("filters by normalized type and issuer record", () => {
    render(<CredentialsPage />);
    const search = screen.getByPlaceholderText(
      "Search credentials by type, issuer...",
    );
    fireEvent.change(search, { target: { value: "issuer-university" } });

    expect(screen.getAllByTestId(/credential-card-/)).toHaveLength(1);
    expect(
      screen.getByTestId(`credential-card-${credentials[1].id}`),
    ).toHaveTextContent("Education");
  });

  it("filters by backend-derived lifecycle status", () => {
    render(<CredentialsPage />);
    fireEvent.click(screen.getByText("Suspended"));

    expect(screen.getAllByTestId(/credential-card-/)).toHaveLength(1);
    expect(
      screen.getByTestId(`credential-card-${credentials[1].id}`),
    ).toBeInTheDocument();
  });

  it("passes authenticated validation to cards in the default grid", () => {
    render(<CredentialsPage />);
    fireEvent.click(screen.getAllByText("Validate")[0]);
    expect(mockVerifyCredential).toHaveBeenCalledWith(credentials[0].id);
  });

  it("renders loading state before declaring the inventory empty", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      accessState: "ready",
      verifyCredential: mockVerifyCredential,
    });
    render(<CredentialsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading credential inventory...",
    );
    expect(screen.queryByText("No credentials found")).not.toBeInTheDocument();
  });

  it("renders the authenticated inventory error instead of an empty state", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Session expired"),
      accessState: "ready",
      verifyCredential: mockVerifyCredential,
    });
    render(<CredentialsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Credential inventory unavailable",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Session expired");
    expect(screen.queryByText("No credentials found")).not.toBeInTheDocument();
  });

  it("does not claim an empty inventory before wallet sign-in", () => {
    mockUseCredentials.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      accessState: "sign-in-required",
      verifyCredential: mockVerifyCredential,
    });
    render(<CredentialsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sign in to load credentials",
    );
    expect(screen.queryByText("No credentials found")).not.toBeInTheDocument();
  });

  it("shows an honest empty state", () => {
    mockUseCredentials.mockReturnValue({
      data: { credentials: [] },
      isLoading: false,
      error: null,
      accessState: "ready",
      verifyCredential: mockVerifyCredential,
    });
    render(<CredentialsPage />);
    expect(screen.getByText("No credentials found")).toBeInTheDocument();
    expect(
      screen.getByText("No credentials were returned for this identity"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request Credential" }),
    ).not.toBeInTheDocument();
  });

  it("switches to the list inventory view", () => {
    render(<CredentialsPage />);
    const viewButtons = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("p-2.5"));
    fireEvent.click(viewButtons[1]);
    expect(screen.getByTestId("credential-list")).toBeInTheDocument();
  });
});
