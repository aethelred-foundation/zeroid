import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CredentialList from "@/components/credentials/CredentialList";
import type { CredentialSummary } from "@/lib/credentials/summary";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, layout, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target: unknown, prop: string | symbol) => {
          if (prop === "__esModule") return true;
          return (props: any) => (
            <div
              data-testid={`icon-${String(prop).toLowerCase()}`}
              {...props}
            />
          );
        },
      },
    ),
);

jest.mock("@/components/credentials/CredentialCard", () => ({
  __esModule: true,
  default: ({ credential, onVerify, onRevoke }: any) => (
    <div
      data-testid={`credential-card-${credential.id}`}
      data-holder-revoke={String(Boolean(onRevoke))}
    >
      <span>{credential.typeLabel}</span>
      {onVerify && (
        <button onClick={() => onVerify(credential.id)}>Validate</button>
      )}
    </div>
  ),
}));

jest.mock("@/hooks/useCredentials", () => ({
  useCredentials: jest.fn(),
}));

import { useCredentials } from "@/hooks/useCredentials";

const mockUseCredentials = useCredentials as jest.Mock;
const verifyCredential = jest.fn();

const baseCredential: CredentialSummary = {
  id: "d74ed26c-47ac-4b62-94a8-38704c53b876",
  credentialType: "KYC_LEVEL_2",
  typeLabel: "KYC Level 2",
  category: "kyc",
  issuerId: "issuer-aethelred",
  subjectId: "subject-1",
  claimsHash: "claims-hash-1",
  proofAvailable: true,
  status: "active",
  issuedAt: "2026-07-18T08:00:00.000Z",
  expiresAt: "2027-07-18T08:00:00.000Z",
};

const credentials: CredentialSummary[] = [
  baseCredential,
  {
    ...baseCredential,
    id: "9b4bde84-439b-452b-a0eb-d0671988ad44",
    credentialType: "EDUCATION",
    typeLabel: "Education",
    category: "education",
    issuerId: "issuer-university",
    status: "suspended",
  },
  {
    ...baseCredential,
    id: "b3b31128-f0bf-42ea-bcba-4d33c671d1bc",
    credentialType: "EMPLOYMENT",
    typeLabel: "Employment",
    category: "employment",
    issuerId: "issuer-employer",
    status: "revoked",
  },
];

describe("CredentialList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCredentials.mockReturnValue({
      credentials,
      isLoading: false,
      error: null,
      verifyCredential,
    });
  });

  it("renders loading, error, and empty states", () => {
    mockUseCredentials.mockReturnValueOnce({
      credentials: [],
      isLoading: true,
      error: null,
      verifyCredential,
    });
    const { rerender } = render(<CredentialList />);
    expect(screen.getByText("Loading credentials...")).toBeInTheDocument();

    mockUseCredentials.mockReturnValueOnce({
      credentials: [],
      isLoading: false,
      error: new Error("Network error"),
      verifyCredential,
    });
    rerender(<CredentialList />);
    expect(
      screen.getByText("Failed to load credentials: Network error"),
    ).toBeInTheDocument();

    mockUseCredentials.mockReturnValueOnce({
      credentials: [],
      isLoading: false,
      error: null,
      verifyCredential,
    });
    rerender(<CredentialList />);
    expect(
      screen.getByText("No credentials were returned for this identity."),
    ).toBeInTheDocument();
  });

  it("renders normalized credential labels and a count", () => {
    render(<CredentialList />);
    expect(
      screen.getByTestId(`credential-card-${credentials[0].id}`),
    ).toHaveTextContent("KYC Level 2");
    expect(
      screen.getByTestId(`credential-card-${credentials[1].id}`),
    ).toHaveTextContent("Education");
    expect(
      screen.getByTestId(`credential-card-${credentials[2].id}`),
    ).toHaveTextContent("Employment");
    expect(screen.getByText("3 credentials found")).toBeInTheDocument();
  });

  it("searches by normalized type and issuer record ID", () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText("Search credentials...");

    fireEvent.change(input, { target: { value: "KYC" } });
    expect(screen.getByText("1 credential found")).toBeInTheDocument();
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "issuer-university" } });
    expect(screen.getByText("1 credential found")).toBeInTheDocument();
    expect(
      screen.getByTestId(`credential-card-${credentials[1].id}`),
    ).toHaveTextContent("Education");
  });

  it("filters by backend-derived status", () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByText("Suspended"));

    expect(screen.getByText("1 credential found")).toBeInTheDocument();
    expect(
      screen.getByTestId(`credential-card-${credentials[1].id}`),
    ).toHaveTextContent("Education");
  });

  it("filters by credential category instead of a nonexistent schema type", () => {
    render(<CredentialList />);
    const select = screen.getByDisplayValue("All Categories");
    fireEvent.change(select, { target: { value: "employment" } });

    expect(screen.getByText("1 credential found")).toBeInTheDocument();
    expect(
      screen.getByTestId(`credential-card-${credentials[2].id}`),
    ).toHaveTextContent("Employment");
  });

  it("does not pass a holder revocation action to cards", () => {
    render(<CredentialList />);
    for (const card of screen.getAllByTestId(/credential-card-/)) {
      expect(card).toHaveAttribute("data-holder-revoke", "false");
    }
  });

  it("keeps authenticated server validation available", () => {
    render(<CredentialList />);
    fireEvent.click(screen.getAllByText("Validate")[0]);
    expect(verifyCredential).toHaveBeenCalledWith(baseCredential.id);
  });

  it("switches between grid and list views", () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByLabelText("List view"));
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Grid view"));
    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
  });
});
