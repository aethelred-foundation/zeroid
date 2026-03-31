/**
 * useAgentIdentity — Unit Tests
 *
 * Tests for agent lifecycle hooks: listing, detail, registration,
 * capability updates, delegation, verification, suspension, and approval queue.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
const mockToast = jest.requireMock("sonner").toast;

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

import { useAccount } from "wagmi";
import {
  useAgents,
  useAgent,
  useRegisterAgent,
  useUpdateCapabilities,
  useCreateDelegation,
  useVerifyAgent,
  useSuspendAgent,
  useApprovalQueue,
  useApproveAction,
} from "@/hooks/useAgentIdentity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockAgent = {
  id: "agent-001",
  name: "TestBot",
  description: "A test agent",
  ownerAddress: mockAddress,
  status: "active" as const,
  capabilities: [],
  delegationPolicy: {
    allowSubDelegation: false,
    maxDepth: 1,
    requireHumanApproval: true,
    approvalThreshold: 1,
    expirySeconds: 3600,
  },
  autonomyLevel: "supervised" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  verificationCount: 5,
};

// ===========================================================================
// useAgents
// ===========================================================================

describe("useAgents", () => {
  it("fetches agents for the connected address", async () => {
    mockApiClient.get.mockResolvedValue([mockAgent]);
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/agents", {
      owner: mockAddress,
    });
    expect(result.current.data).toEqual([mockAgent]);
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useAgent
// ===========================================================================

describe("useAgent", () => {
  it("fetches a single agent by id", async () => {
    mockApiClient.get.mockResolvedValue(mockAgent);
    const { result } = renderHook(() => useAgent("agent-001"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/agents/agent-001");
  });

  it("is disabled when agentId is undefined", () => {
    const { result } = renderHook(() => useAgent(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useRegisterAgent
// ===========================================================================

describe("useRegisterAgent", () => {
  it("registers agent and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(mockAgent);
    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    const config = {
      name: "TestBot",
      description: "A test agent",
      ownerAddress: mockAddress,
      capabilities: [],
      delegationPolicy: {
        allowSubDelegation: false,
        maxDepth: 1,
        requireHumanApproval: true,
        approvalThreshold: 1,
        expirySeconds: 3600,
      },
      maxAutonomyLevel: "supervised" as const,
    };

    await act(async () => {
      await result.current.mutateAsync(config);
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/agents/register",
      config,
    );
    expect(mockToast.success).toHaveBeenCalledWith("Agent registered", {
      description: expect.stringContaining("TestBot"),
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Duplicate"));
    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({} as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Agent registration failed", {
      description: "Duplicate",
    });
  });
});

// ===========================================================================
// useUpdateCapabilities
// ===========================================================================

describe("useUpdateCapabilities", () => {
  const updatedAgent = {
    ...mockAgent,
    capabilities: [
      {
        type: "credential_verify",
        scope: "*",
        grantedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };

  it("updates capabilities and shows success toast", async () => {
    mockApiClient.put.mockResolvedValue(updatedAgent);
    const { result } = renderHook(() => useUpdateCapabilities(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        agentId: "agent-001",
        capabilities: updatedAgent.capabilities as any,
      });
    });

    expect(mockApiClient.put).toHaveBeenCalledWith(
      "/api/v1/agents/agent-001/capabilities",
      {
        capabilities: updatedAgent.capabilities,
      },
    );
    expect(mockToast.success).toHaveBeenCalledWith("Capabilities updated", {
      description: expect.stringContaining("1 capability"),
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.put.mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHook(() => useUpdateCapabilities(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ agentId: "x", capabilities: [] });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Capability update failed", {
      description: "Forbidden",
    });
  });
});

// ===========================================================================
// useCreateDelegation
// ===========================================================================

describe("useCreateDelegation", () => {
  const mockDelegation = {
    id: "del-1",
    fromAgentId: "agent-001",
    toAgentId: "agent-002",
    capabilities: ["credential_verify"],
    constraints: {},
    depth: 1,
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-02-01T00:00:00Z",
    status: "active",
  };

  it("creates delegation and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(mockDelegation);
    const { result } = renderHook(() => useCreateDelegation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromAgentId: "agent-001",
        toAgentId: "agent-002",
        capabilities: ["credential_verify"] as any,
        constraints: {},
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith("Delegation created", {
      description: expect.stringContaining("Chain depth: 1"),
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Depth exceeded"));
    const { result } = renderHook(() => useCreateDelegation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          fromAgentId: "a",
          toAgentId: "b",
          capabilities: [],
          constraints: {},
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Delegation creation failed", {
      description: "Depth exceeded",
    });
  });
});

// ===========================================================================
// useVerifyAgent
// ===========================================================================

describe("useVerifyAgent", () => {
  it("shows success toast when agent verified", async () => {
    mockApiClient.post.mockResolvedValue({
      agentId: "a-1",
      challenge: "c",
      response: "r",
      verified: true,
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    const { result } = renderHook(() => useVerifyAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "a-1", challenge: "c" });
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Agent verified successfully",
    );
  });

  it("shows error toast when verification fails", async () => {
    mockApiClient.post.mockResolvedValue({ verified: false });
    const { result } = renderHook(() => useVerifyAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "a-1", challenge: "c" });
    });

    expect(mockToast.error).toHaveBeenCalledWith("Agent verification failed");
  });

  it("shows error toast on network failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Network"));
    const { result } = renderHook(() => useVerifyAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ agentId: "a-1", challenge: "c" });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Verification request failed",
      { description: "Network" },
    );
  });
});

// ===========================================================================
// useSuspendAgent
// ===========================================================================

describe("useSuspendAgent", () => {
  it("suspends agent and shows warning toast", async () => {
    const suspended = {
      ...mockAgent,
      status: "suspended",
      suspensionReason: "Policy violation",
    };
    mockApiClient.post.mockResolvedValue(suspended);
    const { result } = renderHook(() => useSuspendAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        agentId: "agent-001",
        reason: "Policy violation",
      });
    });

    expect(mockToast.warning).toHaveBeenCalledWith("Agent suspended", {
      description: expect.stringContaining("Policy violation"),
    });
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Unauthorized"));
    const { result } = renderHook(() => useSuspendAgent(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ agentId: "a", reason: "r" });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Suspension failed", {
      description: "Unauthorized",
    });
  });
});

// ===========================================================================
// useApprovalQueue
// ===========================================================================

describe("useApprovalQueue", () => {
  const mockItems = [
    {
      id: "q-1",
      agentId: "a-1",
      agentName: "Bot",
      actionType: "payment",
      actionDescription: "Send $100",
      riskScore: 70,
      requestedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-02T00:00:00Z",
    },
  ];

  it("fetches approval queue for connected address", async () => {
    mockApiClient.get.mockResolvedValue(mockItems);
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/api/v1/agents/approvals", {
      owner: mockAddress,
    });
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useApproveAction
// ===========================================================================

describe("useApproveAction", () => {
  it("approves action and shows success toast", async () => {
    mockApiClient.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ actionId: "q-1", approved: true });
    });

    expect(mockToast.success).toHaveBeenCalledWith("Action approved");
  });

  it("rejects action and shows rejection toast", async () => {
    mockApiClient.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        actionId: "q-1",
        approved: false,
        reason: "Too risky",
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith("Action rejected");
  });

  it("shows error toast on failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Expired"));
    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ actionId: "q-1", approved: true });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Approval action failed", {
      description: "Expired",
    });
  });
});
