import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        if (typeof prop === "string") {
          return React.forwardRef((props: any, ref: any) => {
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
          });
        }
      },
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

// Mock @/types to provide the types the component needs
jest.mock("@/types", () => ({}));

import CredentialCard from "../CredentialCard";

const mockCredential = {
  id: "cred-1",
  name: "Government ID",
  status: "verified" as const,
  schemaType: "identity",
  issuer: "Aethelred Authority",
  issuedAt: "2025-01-15",
  expiresAt: "2027-01-15",
  attributes: [
    { key: "Full Name", value: "John Doe" },
    { key: "Nationality", value: "US" },
  ],
};

describe("CredentialCard", () => {
  it("renders without crashing", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    expect(screen.getByText("Government ID")).toBeInTheDocument();
  });

  it("displays credential name and status", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    expect(screen.getByText("Government ID")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("displays issuer and schema type", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    expect(screen.getByText("Aethelred Authority")).toBeInTheDocument();
    expect(screen.getByText("identity")).toBeInTheDocument();
  });

  it("expands to show attributes when clicked", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    // Attributes should not be visible initially
    expect(screen.queryByText("Full Name")).not.toBeInTheDocument();
    // Click to expand
    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("shows Revoke button for verified credentials when onRevoke is provided", () => {
    const onRevoke = jest.fn();
    render(
      <CredentialCard credential={mockCredential as any} onRevoke={onRevoke} />,
    );
    // Expand card first
    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);
    const revokeBtn = screen.getByText("Revoke");
    fireEvent.click(revokeBtn);
    expect(onRevoke).toHaveBeenCalledWith("cred-1");
  });

  it("shows Verify button for non-verified credentials when onVerify is provided", () => {
    const onVerify = jest.fn();
    const pendingCredential = { ...mockCredential, status: "pending" as const };
    render(
      <CredentialCard
        credential={pendingCredential as any}
        onVerify={onVerify}
      />,
    );
    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);
    const verifyBtn = screen.getByText("Verify");
    fireEvent.click(verifyBtn);
    expect(onVerify).toHaveBeenCalledWith("cred-1");
  });

  it("renders pending status correctly", () => {
    const pendingCredential = { ...mockCredential, status: "pending" as const };
    render(<CredentialCard credential={pendingCredential as any} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders revoked status correctly", () => {
    const revokedCredential = { ...mockCredential, status: "revoked" as const };
    render(<CredentialCard credential={revokedCredential as any} />);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("renders expired status correctly", () => {
    const expiredCredential = { ...mockCredential, status: "expired" as const };
    render(<CredentialCard credential={expiredCredential as any} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("renders unverified status correctly", () => {
    const unverifiedCredential = {
      ...mockCredential,
      status: "unverified" as const,
    };
    render(<CredentialCard credential={unverifiedCredential as any} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("falls back to unverified status for unknown status", () => {
    const unknownCredential = {
      ...mockCredential,
      status: "some-unknown" as any,
    };
    render(<CredentialCard credential={unknownCredential as any} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("falls back to FileText icon for unknown schema type", () => {
    const customSchema = { ...mockCredential, schemaType: "custom-schema" };
    render(<CredentialCard credential={customSchema as any} />);
    expect(screen.getByText("custom-schema")).toBeInTheDocument();
  });

  it("renders organization schema icon", () => {
    const orgCredential = { ...mockCredential, schemaType: "organization" };
    render(<CredentialCard credential={orgCredential as any} />);
    expect(screen.getByText("organization")).toBeInTheDocument();
  });

  it("renders document schema icon", () => {
    const docCredential = { ...mockCredential, schemaType: "document" };
    render(<CredentialCard credential={docCredential as any} />);
    expect(screen.getByText("document")).toBeInTheDocument();
  });

  it("shows expiring soon warning when credential expires within 30 days", () => {
    const nearFuture = new Date();
    nearFuture.setDate(nearFuture.getDate() + 15);
    const expiringSoonCredential = {
      ...mockCredential,
      expiresAt: nearFuture.toISOString(),
    };
    render(<CredentialCard credential={expiringSoonCredential as any} />);
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
  });

  it("does not show expiring soon warning when credential is far from expiry", () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    const farCredential = {
      ...mockCredential,
      expiresAt: farFuture.toISOString(),
    };
    render(<CredentialCard credential={farCredential as any} />);
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
  });

  it("does not show expiring soon warning when no expiresAt", () => {
    const noExpiry = { ...mockCredential, expiresAt: undefined };
    render(<CredentialCard credential={noExpiry as any} />);
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
  });

  it("does not show expiring soon for already expired credentials", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const expiredCredential = {
      ...mockCredential,
      expiresAt: pastDate.toISOString(),
    };
    render(<CredentialCard credential={expiredCredential as any} />);
    // isExpiringSoon returns false for already-expired
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
  });

  it("shows No Expiry when expiresAt is not set in expanded view", () => {
    const noExpiry = { ...mockCredential, expiresAt: undefined };
    render(<CredentialCard credential={noExpiry as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("No Expiry")).toBeInTheDocument();
  });

  it("shows N/A when issuedAt is not set in expanded view", () => {
    const noIssued = { ...mockCredential, issuedAt: undefined };
    render(<CredentialCard credential={noIssued as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("does not show attributes section when attributes is empty", () => {
    const noAttrs = { ...mockCredential, attributes: [] };
    render(<CredentialCard credential={noAttrs as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
  });

  it("does not show attributes section when attributes is undefined", () => {
    const noAttrs = { ...mockCredential, attributes: undefined };
    render(<CredentialCard credential={noAttrs as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
  });

  it("does not show Revoke when onRevoke is not provided", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  });

  it("does not show Verify when onVerify is not provided", () => {
    const pendingCredential = { ...mockCredential, status: "pending" as const };
    render(<CredentialCard credential={pendingCredential as any} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
  });

  it("does not show Revoke for non-verified credentials even if onRevoke provided", () => {
    const onRevoke = jest.fn();
    const pendingCredential = { ...mockCredential, status: "pending" as const };
    render(
      <CredentialCard
        credential={pendingCredential as any}
        onRevoke={onRevoke}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  });

  it("does not show Verify for already-verified credentials even if onVerify provided", () => {
    const onVerify = jest.fn();
    render(
      <CredentialCard credential={mockCredential as any} onVerify={onVerify} />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
  });

  it("collapses when clicking the button again", () => {
    render(<CredentialCard credential={mockCredential as any} />);
    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("Full Name")).not.toBeInTheDocument();
  });
});
