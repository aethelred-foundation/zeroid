import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/font/google
jest.mock("next/font/google", () => ({
  Sora: () => ({ variable: "--font-sora" }),
  DM_Sans: () => ({ variable: "--font-dm-sans" }),
  JetBrains_Mono: () => ({ variable: "--font-mono" }),
}));

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(
    new Headers({
      "x-nonce": "test-csp-nonce",
    }),
  ),
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
  let consoleErrorSpy: jest.SpyInstance;
  const QueryClientMock = jest.requireMock("@tanstack/react-query")
    .QueryClient as jest.Mock;

  beforeEach(() => {
    QueryClientMock.mockClear();
    const originalConsoleError = console.error;
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (
          typeof message === "string" &&
          message.includes("validateDOMNesting")
        ) {
          return;
        }
        originalConsoleError(message, ...args);
      });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  async function renderLayout(children: React.ReactNode) {
    return render(await RootLayout({ children }));
  }

  it("renders without crashing", async () => {
    const { container } = await renderLayout(
      <div data-testid="child-content">Hello</div>,
    );
    expect(container).toBeTruthy();
  });

  it("renders child content", async () => {
    await renderLayout(<div data-testid="child-content">Hello</div>);
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("wraps children with providers", async () => {
    await renderLayout(<div>Content</div>);
    expect(screen.getByTestId("wagmi-provider")).toBeInTheDocument();
    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("identity-provider")).toBeInTheDocument();
    expect(screen.getByTestId("proof-provider")).toBeInTheDocument();
  });

  it("renders the Toaster component", async () => {
    await renderLayout(<div>Content</div>);
    expect(screen.getByTestId("toaster")).toBeInTheDocument();
  });

  it("disables automatic retries for non-idempotent mutations", async () => {
    await renderLayout(<div>Content</div>);

    expect(QueryClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultOptions: expect.objectContaining({
          mutations: { retry: 0 },
        }),
      }),
    );
  });
});
