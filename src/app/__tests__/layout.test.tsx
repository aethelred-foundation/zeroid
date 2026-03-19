import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/font/google
jest.mock("next/font/google", () => ({
  Sora: () => ({ variable: "--font-sora" }),
  DM_Sans: () => ({ variable: "--font-dm-sans" }),
  JetBrains_Mono: () => ({ variable: "--font-mono" }),
}));

// Mock wagmi
jest.mock("wagmi", () => ({
  WagmiProvider: ({ children }: any) => (
    <div data-testid="wagmi-provider">{children}</div>
  ),
}));

// Mock @tanstack/react-query
jest.mock("@tanstack/react-query", () => ({
  QueryClient: jest.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: any) => (
    <div data-testid="query-provider">{children}</div>
  ),
}));

// Mock @rainbow-me/rainbowkit
jest.mock("@rainbow-me/rainbowkit", () => ({
  RainbowKitProvider: ({ children }: any) => (
    <div data-testid="rainbowkit-provider">{children}</div>
  ),
  darkTheme: () => ({}),
}));

// Mock @rainbow-me/rainbowkit/styles.css
jest.mock("@rainbow-me/rainbowkit/styles.css", () => ({}));

// Mock next-themes
jest.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => (
    <div data-testid="theme-provider">{children}</div>
  ),
}));

// Mock sonner
jest.mock("sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

// Mock config/wagmi
jest.mock("@/config/wagmi", () => ({
  wagmiConfig: {},
}));

// Mock contexts
jest.mock("@/contexts/IdentityContext", () => ({
  IdentityProvider: ({ children }: any) => (
    <div data-testid="identity-provider">{children}</div>
  ),
}));

jest.mock("@/contexts/ProofContext", () => ({
  ProofProvider: ({ children }: any) => (
    <div data-testid="proof-provider">{children}</div>
  ),
}));

// Mock CSS
jest.mock("@/styles/globals.css", () => ({}));

import RootLayout from "../layout";

describe("RootLayout", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <RootLayout>
        <div data-testid="child-content">Hello</div>
      </RootLayout>,
    );
    expect(container).toBeTruthy();
  });

  it("renders child content", () => {
    render(
      <RootLayout>
        <div data-testid="child-content">Hello</div>
      </RootLayout>,
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("wraps children with providers", () => {
    render(
      <RootLayout>
        <div>Content</div>
      </RootLayout>,
    );
    expect(screen.getByTestId("wagmi-provider")).toBeInTheDocument();
    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("rainbowkit-provider")).toBeInTheDocument();
    expect(screen.getByTestId("identity-provider")).toBeInTheDocument();
    expect(screen.getByTestId("proof-provider")).toBeInTheDocument();
  });

  it("renders the Toaster component", () => {
    render(
      <RootLayout>
        <div>Content</div>
      </RootLayout>,
    );
    expect(screen.getByTestId("toaster")).toBeInTheDocument();
  });
});
