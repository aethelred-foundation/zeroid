import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GovernancePage from "../page";

const mockUseAccount = jest.fn();
const mockUseIdentity = jest.fn();
const mockUseGovernance = jest.fn();
const mockSignIn = jest.fn();
const mockCreateSchema = jest.fn();
const mockVoteOnSchema = jest.fn();
const mockRefetch = jest.fn();
const mockRefetchDetail = jest.fn();
const mockResetCreate = jest.fn();
const mockResetVote = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("@/hooks/useGovernance", () => ({
  useGovernance: (options: unknown) => mockUseGovernance(options),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/components/governance/ProposalCard", () => ({
  __esModule: true,
  default: ({ schema, onViewDetails }: any) => (
    <article>
      <span>{schema.name}</span>
      <button onClick={() => onViewDetails?.(schema.id)}>Review record</button>
    </article>
  ),
}));

jest.mock("@/components/governance/VotingPanel", () => ({
  __esModule: true,
  default: ({ schema, onVote, onVoteSubmitted }: any) => (
    <section data-testid="voting-panel">
      Voting on {schema.name}
      <button
        onClick={async () => {
          const updated = await onVote(schema.id, true);
          onVoteSubmitted?.(updated);
        }}
      >
        Submit backend vote
      </button>
    </section>
  ),
}));

jest.mock("@/components/ui/Modal", () => ({
  Modal: ({ open, title, children }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

const schema = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.0.0",
  description: "A proposed organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: { legalName: { type: "string" } },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "PROPOSED" as const,
  approvalVotes: 0,
  rejectionVotes: 0,
  voters: [],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

let governanceOverrides: Record<string, unknown>;

function governanceResult(options: any) {
  return {
    schemas: [schema],
    total: 1,
    page: 1,
    pageSize: 10,
    hasMore: false,
    selectedSchema: options?.selectedSchemaId ? schema : undefined,
    accessState: "ready",
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mockRefetch,
    isDetailLoading: false,
    detailError: null,
    refetchDetail: mockRefetchDetail,
    createSchema: mockCreateSchema,
    isCreating: false,
    createError: null,
    resetCreate: mockResetCreate,
    voteOnSchema: mockVoteOnSchema,
    isVoting: false,
    voteError: null,
    resetVote: mockResetVote,
    ...governanceOverrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  governanceOverrides = {};
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  });
  mockUseIdentity.mockReturnValue({
    identity: { isLoading: false, isRegistered: true },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: mockSignIn,
  });
  mockUseGovernance.mockImplementation(governanceResult);
  mockCreateSchema.mockResolvedValue(schema);
  mockVoteOnSchema.mockResolvedValue({ ...schema, approvalVotes: 1 });
});

describe("GovernancePage", () => {
  it("renders the honest backend governance boundary", () => {
    render(<GovernancePage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Schema Governance")).toBeInTheDocument();
    expect(
      screen.getByText("Identity governance, not token governance"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/AETH staked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delegate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/abstain/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Governance Parameters")).not.toBeInTheDocument();
    expect(screen.queryByText("Voting Period")).not.toBeInTheDocument();
    expect(screen.queryByText(/total voters/i)).not.toBeInTheDocument();
  });

  it("does not expose protected data without a wallet", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
    render(<GovernancePage />);

    expect(
      screen.getByText("Connect a wallet for governance"),
    ).toBeInTheDocument();
    expect(screen.queryByText(schema.name)).not.toBeInTheDocument();
    expect(mockUseGovernance).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("routes an unregistered wallet to identity setup", () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: false },
      sessionStatus: "anonymous",
      sessionError: null,
      signIn: mockSignIn,
    });
    render(<GovernancePage />);

    expect(screen.getByText("Register this wallet first")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open identity setup" }),
    ).toHaveAttribute("href", "/identity");
  });

  it("uses the real wallet session sign-in action", async () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: "Session expired",
      signIn: mockSignIn,
    });
    governanceOverrides = { accessState: "sign-in-required" };
    mockSignIn.mockResolvedValue(undefined);
    render(<GovernancePage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with wallet" }),
    );
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("Session expired");
  });

  it("renders list loading, error/retry, and empty states", () => {
    governanceOverrides = { isLoading: true, schemas: [] };
    const { rerender } = render(<GovernancePage />);
    expect(
      screen.getByText("Loading schema governance records..."),
    ).toBeInTheDocument();

    governanceOverrides = {
      isLoading: false,
      schemas: [],
      error: new Error("Governance unavailable"),
    };
    rerender(<GovernancePage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Governance unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalled();

    governanceOverrides = { isLoading: false, schemas: [], error: null };
    rerender(<GovernancePage />);
    expect(screen.getByText("No schema records found")).toBeInTheDocument();
  });

  it("passes real status and name filters to the governance hook", async () => {
    render(<GovernancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter schemas by name" }),
      { target: { value: "  Organization  " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() =>
      expect(mockUseGovernance).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "APPROVED",
          name: "Organization",
          page: 1,
        }),
      ),
    );
  });

  it("loads real schema detail and delegates voting to the hook", async () => {
    render(<GovernancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Review record" }));

    expect(await screen.findByTestId("voting-panel")).toHaveTextContent(
      schema.name,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Submit backend vote" }),
    );
    await waitFor(() =>
      expect(mockVoteOnSchema).toHaveBeenCalledWith(schema.id, true),
    );
  });

  it("submits the exact create-schema API input", async () => {
    render(<GovernancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create schema proposal" }),
    );

    fireEvent.change(screen.getByLabelText("Schema name"), {
      target: { value: "Verified Organization" },
    });
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: schema.description },
    });
    fireEvent.change(screen.getByLabelText("JSON schema definition"), {
      target: { value: JSON.stringify(schema.schemaDefinition) },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit schema proposal" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(mockCreateSchema).toHaveBeenCalledWith({
        name: "Verified Organization",
        version: "1.0.0",
        description: schema.description,
        schemaDefinition: schema.schemaDefinition,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /was recorded/i,
    );
  });

  it("rejects malformed schema JSON before calling the API", async () => {
    render(<GovernancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create schema proposal" }),
    );
    fireEvent.change(screen.getByLabelText("JSON schema definition"), {
      target: { value: "{" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit schema proposal" })
        .closest("form")!,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Schema definition must be valid JSON",
    );
    expect(mockCreateSchema).not.toHaveBeenCalled();
  });
});
