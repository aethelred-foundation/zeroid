import {
  getAIAgents,
  createAIAgent,
  AGENT_SCOPES,
  type CreateAIAgentRequest,
} from "@/lib/api/agent-passport-client";
import { apiClient } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

describe("agent passport client", () => {
  afterEach(() => jest.clearAllMocks());

  it("exposes the v1 read-only scope vocabulary", () => {
    expect(AGENT_SCOPES).toEqual(["eligibility.read", "audit.read", "identity.read"]);
  });

  it("getAIAgents GETs /api/v1/ai/agents with the auth token", async () => {
    (apiClient.get as jest.Mock).mockResolvedValue([
      { agentDid: "did:agent", displayName: "Copilot", status: "ACTIVE", scopes: ["eligibility.read"], maxRiskTier: "LOW" },
    ]);
    const agents = await getAIAgents("tok");
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/ai/agents", undefined, "tok");
    expect(agents).toHaveLength(1);
    expect(agents[0].agentDid).toBe("did:agent");
  });

  it("createAIAgent POSTs the registration body", async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ agentDid: "did:agent", status: "ACTIVE" });
    const body: CreateAIAgentRequest = {
      displayName: "Compliance Copilot v1",
      scopes: ["eligibility.read"],
      maxRiskTier: "MEDIUM",
    };
    await createAIAgent(body, "tok");
    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/ai/agents", body, "tok");
  });
});
