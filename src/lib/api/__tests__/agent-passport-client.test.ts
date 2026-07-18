import { apiClient } from "@/lib/api/client";
import {
  createAIAgent,
  getAgentApprovals,
  getAIAgents,
  normalizeAIAgent,
  type RegisterAIAgentRequest,
} from "@/lib/api/agent-passport-client";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedApi = apiClient as jest.Mocked<typeof apiClient>;

const validAgent = {
  agentId: "agent-001",
  did: "did:aethelred:agent:0123456789abcdef0123456789abcdef",
  operatorId: "identity-001",
  agentName: "Credential Verifier",
  agentDescription: "Verifies credentials for relying applications.",
  agentProtocol: "aethelred_native",
  status: "active",
  capabilities: [
    {
      name: "credential.verify",
      description: "Verify a credential presentation.",
      resourceTypes: ["credential"],
      actions: ["verify"],
      riskLevel: "medium",
      requiresApproval: false,
    },
  ],
  publicKeyHash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  maxDelegationDepth: 2,
  teeAttested: false,
  createdAt: "2026-07-18T08:00:00.000Z",
  updatedAt: "2026-07-18T08:01:00.000Z",
  stats: {
    totalActions: 12,
    successRate: 0.75,
    averageLatencyMs: 18.5,
  },
  metadata: {},
};

describe("AI Agent Identity DTO normalization", () => {
  afterEach(() => jest.clearAllMocks());

  it("accepts a complete backend agent without inventing fields", () => {
    expect(normalizeAIAgent(validAgent)).toEqual(validAgent);
  });

  it("does not invent success or latency evidence for a new agent", () => {
    const normalized = normalizeAIAgent({
      ...validAgent,
      stats: { totalActions: 0 },
    });

    expect(normalized.stats).toEqual({ totalActions: 0 });
  });

  it("rejects derived statistics when no action evidence exists", () => {
    expect(() =>
      normalizeAIAgent({
        ...validAgent,
        stats: { totalActions: 0, successRate: 1, averageLatencyMs: 0 },
      }),
    ).toThrow("cannot report derived rates");
  });

  it.each([
    ["unknown lifecycle", { ...validAgent, status: "ACTIVE" }],
    ["missing owner", { ...validAgent, operatorId: undefined }],
    ["invalid timestamp", { ...validAgent, createdAt: "not-a-date" }],
    [
      "invalid capability",
      {
        ...validAgent,
        capabilities: [{ ...validAgent.capabilities[0], actions: [] }],
      },
    ],
  ])("rejects %s instead of applying a display fallback", (_, value) => {
    expect(() => normalizeAIAgent(value)).toThrow();
  });

  it("normalizes the authenticated list response", async () => {
    mockedApi.get.mockResolvedValue([validAgent]);

    await expect(getAIAgents("identity-token")).resolves.toEqual([validAgent]);
    expect(mockedApi.get).toHaveBeenCalledWith(
      "/api/v1/ai/agents",
      undefined,
      "identity-token",
    );
  });

  it("accepts durable approval evidence without a fabricated risk score", async () => {
    const approval = {
      id: "approval-001",
      requestId: "approval-001",
      agentId: validAgent.agentId,
      operatorId: validAgent.operatorId,
      action: "verify",
      actionType: "verify",
      actionDescription: "verify on credential:credential-001",
      resourceType: "credential",
      resourceId: "credential-001",
      riskLevel: "medium",
      context: {},
      status: "pending",
      requestedAt: "2026-07-18T08:00:00.000Z",
      createdAt: "2026-07-18T08:00:00.000Z",
      expiresAt: "2026-07-18T09:00:00.000Z",
    };
    mockedApi.get.mockResolvedValue([approval]);

    await expect(getAgentApprovals("identity-token")).resolves.toEqual([
      approval,
    ]);
  });

  it("sends the exact registration DTO rather than passport scope fields", async () => {
    const request: RegisterAIAgentRequest = {
      agentName: "Credential Verifier",
      agentDescription: "Verifies credentials for relying applications.",
      agentProtocol: "aethelred_native",
      capabilities:
        validAgent.capabilities as RegisterAIAgentRequest["capabilities"],
      publicKey:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----",
      maxDelegationDepth: 2,
      teeRequired: false,
    };
    mockedApi.post.mockResolvedValue({
      agentId: validAgent.agentId,
      did: validAgent.did,
      agentName: validAgent.agentName,
      status: "active",
      protocol: "aethelred_native",
      capabilities: [
        {
          name: "credential.verify",
          riskLevel: "medium",
          requiresApproval: false,
        },
      ],
      maxDelegationDepth: 2,
      createdAt: validAgent.createdAt,
    });

    await createAIAgent(request, "identity-token");

    expect(mockedApi.post).toHaveBeenCalledWith(
      "/api/v1/ai/agents",
      request,
      "identity-token",
    );
    expect(mockedApi.post).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ displayName: expect.anything() }),
      expect.anything(),
    );
  });
});
