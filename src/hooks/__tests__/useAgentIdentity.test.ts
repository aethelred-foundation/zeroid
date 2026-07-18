import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import {
  createAIAgent,
  getAIAgent,
  getAIAgents,
  getAgentApprovals,
  respondToAgentApproval,
  suspendAIAgent,
} from "@/lib/api/agent-passport-client";
import {
  useAgent,
  useAgents,
  useApprovalQueue,
  useApproveAction,
  useRegisterAgent,
  useSuspendAgent,
} from "@/hooks/useAgentIdentity";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(),
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(),
}));

jest.mock("@/lib/api/agent-passport-client", () => ({
  createAIAgent: jest.fn(),
  getAIAgent: jest.fn(),
  getAIAgents: jest.fn(),
  getAgentApprovals: jest.fn(),
  respondToAgentApproval: jest.fn(),
  suspendAIAgent: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

const mockedUseAccount = useAccount as jest.Mock;
const mockedToken = getIdentityAuthToken as jest.Mock;
const mockedGetAgents = getAIAgents as jest.Mock;
const mockedGetAgent = getAIAgent as jest.Mock;
const mockedCreateAgent = createAIAgent as jest.Mock;
const mockedSuspendAgent = suspendAIAgent as jest.Mock;
const mockedGetApprovals = getAgentApprovals as jest.Mock;
const mockedRespondApproval = respondToAgentApproval as jest.Mock;

const address = "0x1234567890abcdef1234567890abcdef12345678";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const agent = {
  agentId: "agent-001",
  did: "did:aethelred:agent:0123456789abcdef0123456789abcdef",
  operatorId: "identity-001",
  agentName: "Credential Verifier",
  agentDescription: "Verifies credentials for relying applications.",
  agentProtocol: "aethelred_native",
  status: "active",
  capabilities: [],
  publicKeyHash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  maxDelegationDepth: 2,
  teeAttested: false,
  createdAt: "2026-07-18T08:00:00.000Z",
  updatedAt: "2026-07-18T08:01:00.000Z",
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
  mockedUseAccount.mockReturnValue({ address, isConnected: true });
  mockedToken.mockReturnValue("identity-token");
});

describe("useAgents", () => {
  it("loads only after wallet and identity session are both available", async () => {
    mockedGetAgents.mockResolvedValue([agent]);
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.accessState).toBe("ready");
    expect(mockedGetAgents).toHaveBeenCalledWith("identity-token");
    expect(result.current.data).toEqual([agent]);
  });

  it("fails closed when the operator wallet is disconnected", () => {
    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });

    expect(result.current.accessState).toBe("wallet-required");
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetAgents).not.toHaveBeenCalled();
  });

  it("fails closed when the wallet has no authenticated identity session", () => {
    mockedToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });

    expect(result.current.accessState).toBe("sign-in-required");
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetAgents).not.toHaveBeenCalled();
  });
});

describe("agent lifecycle mutations", () => {
  it("registers the exact backend request with the current identity session", async () => {
    mockedCreateAgent.mockResolvedValue({
      agentId: agent.agentId,
      did: agent.did,
      agentName: agent.agentName,
      status: "active",
      protocol: "aethelred_native",
      capabilities: [],
      maxDelegationDepth: 2,
      createdAt: agent.createdAt,
    });
    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });
    const request = {
      agentName: agent.agentName,
      agentDescription: agent.agentDescription,
      agentProtocol: "aethelred_native" as const,
      capabilities: [
        {
          name: "credential.verify",
          description: "Verify credential presentations.",
          resourceTypes: ["credential"],
          actions: ["verify"],
          riskLevel: "medium" as const,
          requiresApproval: false,
        },
      ],
      publicKey:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----",
      maxDelegationDepth: 2,
      teeRequired: false as const,
    };

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(mockedCreateAgent).toHaveBeenCalledWith(request, "identity-token");
  });

  it("blocks registration when the identity session disappears", async () => {
    mockedToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({} as never)).rejects.toThrow(
      "authenticated ZeroID identity session",
    );
    expect(mockedCreateAgent).not.toHaveBeenCalled();
  });

  it("loads detail and performs owner suspension through real client calls", async () => {
    mockedGetAgent.mockResolvedValue(agent);
    mockedSuspendAgent.mockResolvedValue({
      agentId: agent.agentId,
      status: "suspended",
      suspendedAt: "2026-07-18T09:00:00.000Z",
      suspendedBy: agent.operatorId,
      reason: "Operator security review",
    });
    const detail = renderHook(() => useAgent(agent.agentId), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(mockedGetAgent).toHaveBeenCalledWith(
      agent.agentId,
      "identity-token",
    );

    const suspension = renderHook(() => useSuspendAgent(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await suspension.result.current.mutateAsync({
        agentId: agent.agentId,
        reason: "Operator security review",
      });
    });
    expect(mockedSuspendAgent).toHaveBeenCalledWith(
      agent.agentId,
      "Operator security review",
      "identity-token",
    );
  });
});

describe("approval queue", () => {
  it("loads and resolves a backend approval request", async () => {
    const approval = {
      requestId: "approval-001",
      agentId: agent.agentId,
    };
    mockedGetApprovals.mockResolvedValue([approval]);
    mockedRespondApproval.mockResolvedValue({
      ...approval,
      action: "credential.verify",
      status: "approved",
      respondedAt: "2026-07-18T09:00:00.000Z",
      respondedBy: agent.operatorId,
    });

    const queue = renderHook(() => useApprovalQueue(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    expect(mockedGetApprovals).toHaveBeenCalledWith("identity-token");

    const action = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await action.result.current.mutateAsync({
        requestId: approval.requestId,
        approved: true,
        note: "Approved by the owning operator.",
      });
    });
    expect(mockedRespondApproval).toHaveBeenCalledWith(
      approval.requestId,
      true,
      "Approved by the owning operator.",
      "identity-token",
    );
  });
});
