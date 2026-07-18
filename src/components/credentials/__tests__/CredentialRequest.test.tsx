import React from "react";
import { render, screen } from "@testing-library/react";

import CredentialRequest from "@/components/credentials/CredentialRequest";

jest.mock("lucide-react", () => ({
  Building2: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="icon-building" {...props} />
  ),
  KeyRound: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="icon-key" {...props} />
  ),
  Server: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="icon-server" {...props} />
  ),
  ShieldAlert: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="icon-alert" {...props} />
  ),
}));

describe("CredentialRequest", () => {
  it("fails closed instead of exposing the incomplete document flow", () => {
    render(<CredentialRequest />);

    expect(
      screen.getByTestId("credential-request-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Holder requests are not enabled"),
    ).toBeInTheDocument();
    expect(screen.getByText("Accredited issuer")).toBeInTheDocument();
    expect(screen.getByText("Issuer-controlled proof")).toBeInTheDocument();
    expect(screen.getByText("Private document workflow")).toBeInTheDocument();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Submit for Verification"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Credential Requested")).not.toBeInTheDocument();
  });

  it("states that files and TEE verification are unavailable until deployment", () => {
    render(<CredentialRequest />);

    expect(
      screen.getByText(/will not collect documents or claim TEE verification/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/encrypted document escrow/i)).toBeInTheDocument();
  });
});
