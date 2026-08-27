import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CredentialCard from "../CredentialCard";
import type { CredentialSummary } from "@/lib/credentials/summary";

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
            layout,
            ...rest
          } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        }),
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
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

const credential: CredentialSummary = {
  id: "d74ed26c-47ac-4b62-94a8-38704c53b876",
  credentialType: "KYC_LEVEL_2",
  typeLabel: "KYC Level 2",
  category: "kyc",
  issuerId: "issuer-record-17",
  subjectId: "subject-record-8",
  claimsHash:
    "3f3bd8d3d60d1412f98f8f366f0bbbea21c10ac40db80a9e28fa8911223e7f4b",
  proofAvailable: true,
  status: "active",
  issuedAt: "2026-07-18T08:00:00.000Z",
  expiresAt: "2027-07-18T08:00:00.000Z",
};

describe("CredentialCard", () => {
  it("renders the normalized type, status, category, and issuer record", () => {
    render(<CredentialCard credential={credential} />);

    expect(screen.getByText("KYC Level 2")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("kyc")).toBeInTheDocument();
    expect(screen.getByText("Issuer issuer-record-17")).toBeInTheDocument();
  });

  it("shows exact backend identifiers without calling the claims hash on-chain", () => {
    render(<CredentialCard credential={credential} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Credential ID")).toBeInTheDocument();
    expect(screen.getByText(credential.id)).toBeInTheDocument();
    expect(screen.getByText("Claims commitment")).toBeInTheDocument();
    expect(screen.getByText(credential.claimsHash)).toBeInTheDocument();
    expect(screen.queryByText(/on-chain/i)).not.toBeInTheDocument();
  });

  it("offers server-side validation for active credentials", () => {
    const onVerify = jest.fn();
    render(<CredentialCard credential={credential} onVerify={onVerify} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("Validate"));

    expect(onVerify).toHaveBeenCalledWith(credential.id);
  });

  it("never exposes a holder-side revoke action", () => {
    render(<CredentialCard credential={credential} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  });

  it.each([
    ["suspended", "Suspended"],
    ["revoked", "Revoked"],
    ["expired", "Expired"],
    ["unknown", "Unknown"],
  ] as const)("renders %s status honestly", (status, label) => {
    render(<CredentialCard credential={{ ...credential, status }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("does not offer validation for a revoked credential", () => {
    render(
      <CredentialCard
        credential={{ ...credential, status: "revoked" }}
        onVerify={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.queryByText("Validate")).not.toBeInTheDocument();
  });

  it("shows an honest no-expiry value", () => {
    render(<CredentialCard credential={{ ...credential, expiresAt: null }} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("No Expiry")).toBeInTheDocument();
  });

  it("warns when the backend expiry is within 30 days", () => {
    const expiresAt = new Date(
      Date.now() + 15 * 24 * 60 * 60 * 1000,
    ).toISOString();
    render(<CredentialCard credential={{ ...credential, expiresAt }} />);

    expect(screen.getByText(/Expires/)).toBeInTheDocument();
  });
});
