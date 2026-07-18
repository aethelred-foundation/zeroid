import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mockRefetchAgents = jest.fn();
const mockRefetchApprovals = jest.fn();
const mockRegister = jest.fn();
const mockSuspend = jest.fn();
const mockResolveApproval = jest.fn();

let mockAgentsState: Record<string, unknown>;
let mockApprovalsState: Record<string, unknown>;
let mockDetailState: Record<string, unknown>;

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/hooks/useAgentIdentity", () => ({
  useAgents: () => mockAgentsState,
  useApprovalQueue: () => mockApprovalsState,
  useAgent: () => mockDetailState,
  useRegisterAgent: () => ({
    mutateAsync: mockRegister,
    isPending: false,
    error: null,
  }),
  useSuspendAgent: () => ({
    mutateAsync: mockSuspend,
    isPending: false,
    error: null,
  }),
  useApproveAction: () => ({
    mutate: mockResolveApproval,
    isPending: false,
    variables: undefined,
  }),
}));

import AgentIdentityPage from "../page";

const agent = {
  agentId: "agent-001",
  did: "did:aethelred:agent:0123456789abcdef0123456789abcdef",
  operatorId: "identity-001",
  agentName: "Credential Verifier",
  agentDescription: "Verifies credentials for relying applications.",
  agentProtocol: "aethelred_native",
  status: "active" as const,
  capabilities: [
    {
      name: "credential.verify",
      description: "Verify a credential presentation.",
      resourceTypes: ["credential"],
      actions: ["verify"],
      riskLevel: "medium" as const,
      requiresApproval: false,
    },
  ],
  publicKeyHash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  maxDelegationDepth: 2,
  teeAttested: false,
  createdAt: "2026-07-18T08:00:00.000Z",
  updatedAt: "2026-07-18T08:01:00.000Z",
  lastActiveAt: "2026-07-18T08:01:00.000Z",
  stats: {
    totalActions: 12,
    actionsToday: 3,
    successRate: 0.75,
    averageLatencyMs: 18.5,
    anomalyCount: 1,
  },
  metadata: {},
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRegister.mockResolvedValue({ agentId: "new-agent" });
  mockSuspend.mockResolvedValue({ status: "suspended" });
  mockAgentsState = {
    accessState: "ready",
    data: [agent],
    isPending: false,
    isError: false,
    error: null,
    refetch: mockRefetchAgents,
  };
  mockApprovalsState = {
    accessState: "ready",
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: mockRefetchApprovals,
  };
  mockDetailState = {
    data: agent,
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
});

describe("AgentIdentityPage", () => {
  it("gates the registry on a connected wallet", () => {
    mockAgentsState.accessState = "wallet-required";
    render(<AgentIdentityPage />);

    expect(
      screen.getByText(/Connect your operator wallet/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Register agent/i }),
    ).toBeNull();
  });

  it("gates the registry on an authenticated identity session", () => {
    mockAgentsState.accessState = "sign-in-required";
    render(<AgentIdentityPage />);

    expect(
      screen.getByRole("link", { name: /identity sign-in/i }),
    ).toHaveAttribute("href", "/identity");
  });

  it("renders honest loading, error, and retry states", () => {
    mockAgentsState.isPending = true;
    const { rerender } = render(<AgentIdentityPage />);
    expect(screen.getByText(/Loading registered agents/i)).toBeInTheDocument();

    mockAgentsState.isPending = false;
    mockAgentsState.isError = true;
    mockAgentsState.error = new Error("Agent registry unavailable");
    rerender(<AgentIdentityPage />);
    expect(screen.getByText("Agent registry unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRefetchAgents).toHaveBeenCalled();
  });

  it("shows a real empty state without sample agents", () => {
    mockAgentsState.data = [];
    render(<AgentIdentityPage />);

    expect(screen.getByText("No registered agents")).toBeInTheDocument();
    expect(screen.queryByText("ComplianceBot-Alpha")).toBeNull();
  });

  it("renders and searches only returned agent records and statistics", async () => {
    render(<AgentIdentityPage />);

    expect(screen.getByText("Credential Verifier")).toBeInTheDocument();
    expect(screen.getByText("12 actions")).toBeInTheDocument();
    expect(screen.getByText("Anomalies")).toBeInTheDocument();
    expect(screen.queryByText("TradingAgent-Gamma")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search agents" }), {
      target: { value: "no-match" },
    });
    expect(screen.getByText(/No agents match/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Credential Verifier")).toBeNull(),
    );
  });

  it("submits the exact backend registration fields with TEE disabled", async () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Register agent" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Agent name"), {
      target: { value: "Policy Verifier" },
    });
    fireEvent.change(within(dialog).getByLabelText("Agent description"), {
      target: { value: "Verifies policy-bound credential presentations." },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Ed25519 public key (PEM)"),
      {
        target: {
          value:
            "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----",
        },
      },
    );
    fireEvent.change(within(dialog).getByLabelText("Capability name"), {
      target: { value: "credential.verify" },
    });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Verify credential presentations." },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Resource types (comma-separated)"),
      { target: { value: "credential, presentation" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText("Actions (comma-separated)"),
      {
        target: { value: "read, verify" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Register agent" }),
    );

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        agentName: "Policy Verifier",
        agentDescription: "Verifies policy-bound credential presentations.",
        agentProtocol: "aethelred_native",
        capabilities: [
          {
            name: "credential.verify",
            description: "Verify credential presentations.",
            resourceTypes: ["credential", "presentation"],
            actions: ["read", "verify"],
            riskLevel: "low",
            requiresApproval: true,
          },
        ],
        publicKey:
          "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----",
        maxDelegationDepth: 2,
        teeRequired: false,
      }),
    );
  });

  it("performs real owner suspension from the selected agent", async () => {
    render(<AgentIdentityPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Credential Verifier/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Suspend agent" }));
    fireEvent.change(screen.getByLabelText("Suspension reason"), {
      target: { value: "Operator security review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));

    await waitFor(() =>
      expect(mockSuspend).toHaveBeenCalledWith({
        agentId: agent.agentId,
        reason: "Operator security review",
      }),
    );
  });

  it("resolves the real approval queue action", () => {
    mockApprovalsState.data = [
      {
        id: "approval-001",
        requestId: "approval-001",
        agentId: agent.agentId,
        operatorId: agent.operatorId,
        action: "credential.verify",
        actionType: "credential.verify",
        actionDescription: "credential.verify on credential:cred-001",
        resourceType: "credential",
        resourceId: "cred-001",
        riskLevel: "medium",
        riskScore: 50,
        context: {},
        status: "pending",
        requestedAt: "2026-07-18T08:00:00.000Z",
        createdAt: "2026-07-18T08:00:00.000Z",
        expiresAt: "2026-07-19T08:00:00.000Z",
      },
    ];
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(mockResolveApproval).toHaveBeenCalledWith({
      requestId: "approval-001",
      approved: true,
      note: "Approved by the owning operator.",
    });
  });
});
