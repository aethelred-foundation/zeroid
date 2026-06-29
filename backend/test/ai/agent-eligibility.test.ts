import {
  agentEligibilityProof,
  AgentEligibilityError,
  type AgentEligibilityDeps,
  type AgentEligibilityProofRequest,
} from "@/services/ai/agent-eligibility";

function makeDeps(over: Partial<AgentEligibilityDeps> = {}): AgentEligibilityDeps {
  return {
    loadAgent: jest.fn().mockResolvedValue({
      agentDid: "did:agent",
      controllerDid: "did:ctrl",
      agentStatus: "ACTIVE",
      credentialStatus: "ACTIVE",
      scopes: ["eligibility.read"],
      agentMaxRiskTier: "MEDIUM",
    }),
    loadController: jest.fn().mockResolvedValue({
      controllerStatus: "ACTIVE",
      controllerKycValid: true,
      controllerRiskTier: "LOW",
    }),
    runEligibility: jest.fn().mockResolvedValue({
      status: "ALLOWED",
      decisionId: "dec1",
      policyId: "POLICY_REGULATED_SERVICE_18PLUS_V1",
      policyVersion: "1.0",
      proof: { proofId: "p", circuitId: "c", verificationKeyId: "vk", contextHash: "h", verifiedAt: "t" },
      evaluation: { ageSatisfied: true, jurisdictionSatisfied: true, sanctionsStatus: "CLEAR", riskTier: "LOW", credentialStatus: "ACTIVE", nonRevocationVerified: true },
      evidence: { auditLogId: "a", auditHash: "ah" },
      issuedAt: "t",
    }),
    recordAgentAction: jest.fn().mockResolvedValue("action1"),
    ...over,
  };
}

const req: AgentEligibilityProofRequest = {
  agentDid: "did:agent",
  controllerDid: "did:ctrl",
  subjectDid: "did:ctrl",
  credentialId: "cred1",
  policyId: "POLICY_REGULATED_SERVICE_18PLUS_V1",
  relyingAppId: "app1",
};

describe("agentEligibilityProof", () => {
  it("delegates to eligibility and records an ALLOWED agent action", async () => {
    const deps = makeDeps();
    const res = await agentEligibilityProof(deps, req);

    expect(res.status).toBe("ALLOWED");
    expect(res.actor).toEqual({ agentDid: "did:agent", controllerDid: "did:ctrl", agentScopes: ["eligibility.read"] });
    expect(res.evidence.agentActionId).toBe("action1");
    expect(deps.runEligibility).toHaveBeenCalledTimes(1);
    expect(deps.recordAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "ELIGIBILITY_PROOF_REQUEST", resourceId: "dec1", status: "ALLOWED" }),
    );
  });

  it("throws AGENT_NOT_FOUND when the agent is unknown", async () => {
    const deps = makeDeps({ loadAgent: jest.fn().mockResolvedValue(null) });
    await expect(agentEligibilityProof(deps, req)).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("throws CONTROLLER_MISMATCH and records DENIED when the controller does not match", async () => {
    const deps = makeDeps();
    await expect(
      agentEligibilityProof(deps, { ...req, controllerDid: "did:other" }),
    ).rejects.toMatchObject({ code: "CONTROLLER_MISMATCH", statusCode: 403 });
    expect(deps.recordAgentAction).toHaveBeenCalledWith(expect.objectContaining({ status: "DENIED" }));
    expect(deps.runEligibility).not.toHaveBeenCalled();
  });

  it("denies with AGENT_NOT_AUTHORIZED when the eligibility.read scope is missing", async () => {
    const deps = makeDeps({
      loadAgent: jest.fn().mockResolvedValue({
        agentDid: "did:agent", controllerDid: "did:ctrl", agentStatus: "ACTIVE",
        credentialStatus: "ACTIVE", scopes: ["audit.read"], agentMaxRiskTier: "MEDIUM",
      }),
    });
    await expect(agentEligibilityProof(deps, req)).rejects.toMatchObject({ code: "AGENT_NOT_AUTHORIZED", statusCode: 403 });
    expect(deps.runEligibility).not.toHaveBeenCalled();
  });

  it("denies with POLICY_CONDITIONS_NOT_MET (422) when agent risk tier is below controller's", async () => {
    const deps = makeDeps({
      loadAgent: jest.fn().mockResolvedValue({
        agentDid: "did:agent", controllerDid: "did:ctrl", agentStatus: "ACTIVE",
        credentialStatus: "ACTIVE", scopes: ["eligibility.read"], agentMaxRiskTier: "LOW",
      }),
      loadController: jest.fn().mockResolvedValue({ controllerStatus: "ACTIVE", controllerKycValid: true, controllerRiskTier: "HIGH" }),
    });
    await expect(agentEligibilityProof(deps, req)).rejects.toMatchObject({ code: "POLICY_CONDITIONS_NOT_MET", statusCode: 422 });
  });

  it("propagates a DENIED eligibility decision and records it", async () => {
    const deps = makeDeps({
      runEligibility: jest.fn().mockResolvedValue({
        status: "DENIED", decisionId: "dec2", policyId: "POLICY_REGULATED_SERVICE_18PLUS_V1", policyVersion: "1.0",
        proof: { proofId: "p", circuitId: "c", verificationKeyId: "vk", contextHash: "h", verifiedAt: "t" },
        evaluation: { ageSatisfied: false, jurisdictionSatisfied: true, sanctionsStatus: "CLEAR", riskTier: "LOW", credentialStatus: "ACTIVE", nonRevocationVerified: true },
        evidence: { auditLogId: "a", auditHash: "ah" }, issuedAt: "t",
      }),
    });
    const res = await agentEligibilityProof(deps, req);
    expect(res.status).toBe("DENIED");
    expect(deps.recordAgentAction).toHaveBeenCalledWith(expect.objectContaining({ status: "DENIED", resourceId: "dec2" }));
  });

  it("exposes AgentEligibilityError as a typed error", () => {
    const e = new AgentEligibilityError("x", "AGENT_NOT_FOUND", 404);
    expect(e.code).toBe("AGENT_NOT_FOUND");
    expect(e.statusCode).toBe(404);
  });
});
