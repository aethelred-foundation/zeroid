import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const mockSetTheme = jest.fn();
jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: mockSetTheme }),
}));

const registeredIdentityState = {
  identity: {
    did: "did:aethelred:zeroid:0x1234",
    isRegistered: true,
    verificationStatus: "verified",
    credentialCount: 2,
    verificationCount: 5,
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  isLoading: false,
  error: null,
};

const mockUseIdentity = jest.fn();
jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => mockUseIdentity(),
}));

import SettingsPage from "../page";

describe("SettingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIdentity.mockReturnValue(registeredIdentityState);
  });

  it("shows only implemented settings and authoritative identity context", () => {
    render(<SettingsPage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("did:aethelred:zeroid:0x1234")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();

    expect(screen.queryByText("Delete Identity")).not.toBeInTheDocument();
    expect(screen.queryByText("Recovery Guardians")).not.toBeInTheDocument();
    expect(screen.queryByText("Aethelred Mainnet")).not.toBeInTheDocument();
  });

  it("persists a selected theme through next-themes", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("renders the identity loading state", () => {
    mockUseIdentity.mockReturnValue({
      ...registeredIdentityState,
      isLoading: true,
    });

    render(<SettingsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading registered identity context",
    );
  });

  it("renders backend identity errors without substituting profile data", () => {
    mockUseIdentity.mockReturnValue({
      ...registeredIdentityState,
      error: new Error("API unavailable"),
    });

    render(<SettingsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("API unavailable");
    expect(
      screen.queryByText("did:aethelred:zeroid:0x1234"),
    ).not.toBeInTheDocument();
  });

  it("directs an unregistered wallet to the real identity setup", () => {
    mockUseIdentity.mockReturnValue({
      ...registeredIdentityState,
      identity: {
        ...registeredIdentityState.identity,
        did: "",
        isRegistered: false,
      },
    });

    render(<SettingsPage />);
    expect(
      screen.getByText(/has no registered ZeroID identity/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open identity setup" }),
    ).toHaveAttribute("href", "/identity");
  });

  it("does not invent missing identity counts or verification status", () => {
    mockUseIdentity.mockReturnValue({
      ...registeredIdentityState,
      identity: {
        ...registeredIdentityState.identity,
        verificationStatus: undefined,
        credentialCount: undefined,
        verificationCount: undefined,
      },
    });

    render(<SettingsPage />);
    expect(screen.getAllByText("Not reported")).toHaveLength(3);
    expect(screen.queryByText("Active delegates")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
