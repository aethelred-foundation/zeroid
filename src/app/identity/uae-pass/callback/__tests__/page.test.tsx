import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const completeVerification = jest.fn();
const mockUseUAEPass = jest.fn(() => ({
  completeVerification,
  verificationStatus: "pending",
  verification: null,
  error: null,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/hooks/useUAEPass", () => ({
  useUAEPass: () => mockUseUAEPass(),
}));

import UAEPassCallbackPage from "../page";

describe("UAEPassCallbackPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.pushState({}, "", "/identity/uae-pass/callback");
    mockUseUAEPass.mockReturnValue({
      completeVerification,
      verificationStatus: "pending",
      verification: null,
      error: null,
    });
  });

  it("fails closed when the provider callback is missing code or state", () => {
    render(<UAEPassCallbackPage />);

    expect(screen.getByText("Callback context missing")).toBeInTheDocument();
    expect(completeVerification).not.toHaveBeenCalled();
  });

  it("submits the returned authorization code and state to backend completion", async () => {
    window.history.pushState(
      {},
      "",
      "/identity/uae-pass/callback?code=auth-code&state=state-token",
    );

    render(<UAEPassCallbackPage />);

    expect(
      screen.getByText("Completing backend verification"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(completeVerification).toHaveBeenCalledTimes(1);
      expect(completeVerification).toHaveBeenCalledWith({
        code: "auth-code",
        state: "state-token",
      });
    });
  });

  it("shows provider evidence when backend verification succeeds", () => {
    window.history.pushState(
      {},
      "",
      "/identity/uae-pass/callback?code=auth-code&state=state-token",
    );
    mockUseUAEPass.mockReturnValue({
      completeVerification,
      verificationStatus: "verified",
      verification: {
        provider: "UAE_PASS",
        referenceId: "uaepass-ref-42",
        verified: true,
      },
      error: null,
    });

    render(<UAEPassCallbackPage />);

    expect(
      screen.getByText("Government verification complete"),
    ).toBeInTheDocument();
    expect(screen.getByText(/uaepass-ref-42/)).toBeInTheDocument();
  });
});
