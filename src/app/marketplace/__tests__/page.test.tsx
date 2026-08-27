import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MarketplacePage from "../page";

const mockListSchemas = jest.fn();
const mockSignIn = jest.fn();
const mockUseAccount = jest.fn();
const mockUseIdentityContext = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentityContext(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    listSchemas: (...args: unknown[]) => mockListSchemas(...args),
  },
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const approvedSchema = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.2.0",
  description: "An approved organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: {
      legalName: { type: "string" },
      registrationNumber: { type: "string" },
    },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "APPROVED" as const,
  approvalVotes: 4,
  rejectionVotes: 1,
  voters: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

const populatedPage = {
  items: [approvedSchema],
  total: 1,
  page: 1,
  pageSize: 12,
  hasMore: false,
};

function renderMarketplace() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplacePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  });
  mockUseIdentityContext.mockReturnValue({
    identity: { isLoading: false, isRegistered: true },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: mockSignIn,
  });
  mockListSchemas.mockResolvedValue(populatedPage);
});

describe("MarketplacePage approved schema registry", () => {
  it("renders the production-facing registry boundary", async () => {
    renderMarketplace();

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Approved Schema Registry")).toBeInTheDocument();
    expect(screen.getByText("Registry discovery only")).toBeInTheDocument();
    expect(screen.queryByText("Issuer Leaderboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Request Credential")).not.toBeInTheDocument();

    await screen.findByText("Verified Organization");
  });

  it("does not query protected registry data without a wallet", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });

    renderMarketplace();

    expect(
      screen.getByText("Connect a wallet to view approved schemas"),
    ).toBeInTheDocument();
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("directs an unregistered wallet to real identity setup", () => {
    mockUseIdentityContext.mockReturnValue({
      identity: { isLoading: false, isRegistered: false },
      sessionStatus: "anonymous",
      sessionError: null,
      signIn: mockSignIn,
    });

    renderMarketplace();

    expect(
      screen.getByText("Register this wallet with ZeroID first"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open identity setup" }),
    ).toHaveAttribute("href", "/identity");
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("uses the real wallet sign-in action before querying", async () => {
    mockUseIdentityContext.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: "Session expired",
      signIn: mockSignIn,
    });
    mockSignIn.mockResolvedValue(undefined);

    renderMarketplace();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with wallet" }),
    );

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("Session expired");
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("shows an authenticated loading state", () => {
    mockListSchemas.mockReturnValue(new Promise(() => undefined));

    renderMarketplace();

    expect(
      screen.getByText("Loading approved governance schemas..."),
    ).toBeInTheDocument();
  });

  it("renders only fields returned by the approved governance registry", async () => {
    renderMarketplace();

    expect(
      await screen.findByText("Verified Organization"),
    ).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByText("4 approve / 1 reject")).toBeInTheDocument();
    expect(screen.getByText("legalName")).toBeInTheDocument();
    expect(screen.getByText("registrationNumber")).toBeInTheDocument();
    expect(screen.getByText(approvedSchema.proposedBy)).toBeInTheDocument();
    expect(mockListSchemas).toHaveBeenCalledWith(1, 12, {
      status: "APPROVED",
      name: undefined,
    });
    expect(screen.queryByText(/trust score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stake:/i)).not.toBeInTheDocument();
  });

  it("applies the backend-supported name filter and resets to page one", async () => {
    renderMarketplace();
    await screen.findByText("Verified Organization");

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "Filter approved schemas by name",
      }),
      { target: { value: "  Organization  " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() =>
      expect(mockListSchemas).toHaveBeenLastCalledWith(1, 12, {
        status: "APPROVED",
        name: "Organization",
      }),
    );
    expect(
      await screen.findByText("1 approved schema matching “Organization”"),
    ).toBeInTheDocument();
  });

  it("shows the honest empty approved-registry state", async () => {
    mockListSchemas.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 12,
      hasMore: false,
    });

    renderMarketplace();

    expect(
      await screen.findByText("No approved schemas are published"),
    ).toBeInTheDocument();
  });

  it("shows registry errors and supports an explicit retry", async () => {
    mockListSchemas
      .mockRejectedValueOnce(new Error("Registry response contract failed"))
      .mockResolvedValueOnce(populatedPage);

    renderMarketplace();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Registry response contract failed",
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Verified Organization"),
    ).toBeInTheDocument();
    expect(mockListSchemas).toHaveBeenCalledTimes(2);
  });

  it("requests the next real registry page", async () => {
    mockListSchemas.mockResolvedValue({
      ...populatedPage,
      total: 13,
      hasMore: true,
    });

    renderMarketplace();
    await screen.findByText("Verified Organization");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(mockListSchemas).toHaveBeenLastCalledWith(2, 12, {
        status: "APPROVED",
        name: undefined,
      }),
    );
  });
});
