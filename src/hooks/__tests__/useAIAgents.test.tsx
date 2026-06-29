import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAIAgents, useCreateAIAgent } from "@/hooks/useAIAgents";
import * as client from "@/lib/api/agent-passport-client";

jest.mock("@/lib/api/agent-passport-client");

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => jest.clearAllMocks());

describe("useAIAgents", () => {
  it("loads the controller's agents", async () => {
    (client.getAIAgents as jest.Mock).mockResolvedValue([
      { agentDid: "did:agent", displayName: "Copilot", status: "ACTIVE", scopes: ["eligibility.read"], maxRiskTier: "LOW" },
    ]);
    const { result } = renderHook(() => useAIAgents("tok"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(client.getAIAgents).toHaveBeenCalledWith("tok");
  });
});

describe("useCreateAIAgent", () => {
  it("registers an agent and resolves with the response", async () => {
    (client.createAIAgent as jest.Mock).mockResolvedValue({
      agentDid: "did:agent",
      controllerDid: "did:ctrl",
      credentialId: "cred1",
      status: "ACTIVE",
      scopes: ["eligibility.read"],
      maxRiskTier: "MEDIUM",
    });
    const { result } = renderHook(() => useCreateAIAgent("tok"), { wrapper: makeWrapper() });
    const res = await result.current.mutateAsync({
      displayName: "Compliance Copilot v1",
      scopes: ["eligibility.read"],
      maxRiskTier: "MEDIUM",
    });
    expect(res.agentDid).toBe("did:agent");
    expect(client.createAIAgent).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Compliance Copilot v1" }),
      "tok",
    );
  });
});
