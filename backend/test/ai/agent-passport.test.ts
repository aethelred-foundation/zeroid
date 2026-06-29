import {
  AGENT_SCOPES,
  isValidScope,
  assertValidScopes,
  hasScope,
  riskTierAtLeast,
  evaluateAgentEligibilityPolicy,
  POLICY_AGENT_ELIGIBILITY_VIEW_V1,
  type AgentEligibilityPolicyContext,
} from "@/services/ai/agent-passport";

function ctx(
  overrides: Partial<AgentEligibilityPolicyContext> = {},
): AgentEligibilityPolicyContext {
  return {
    agentStatus: "ACTIVE",
    credentialStatus: "ACTIVE",
    scopes: ["eligibility.read"],
    agentMaxRiskTier: "MEDIUM",
    controllerStatus: "ACTIVE",
    controllerKycValid: true,
    controllerRiskTier: "LOW",
    ...overrides,
  };
}

describe("agent scopes", () => {
  it("recognises the v1 controlled scopes", () => {
    expect(AGENT_SCOPES).toEqual(
      expect.arrayContaining(["eligibility.read", "audit.read", "identity.read"]),
    );
    expect(isValidScope("eligibility.read")).toBe(true);
    expect(isValidScope("transactions.submit")).toBe(false);
  });
  it("rejects out-of-vocabulary scopes", () => {
    expect(() => assertValidScopes(["eligibility.read", "danger.write"])).toThrow();
    expect(() => assertValidScopes(["eligibility.read", "audit.read"])).not.toThrow();
  });
  it("checks scope membership", () => {
    expect(hasScope(["eligibility.read"], "eligibility.read")).toBe(true);
    expect(hasScope(["audit.read"], "eligibility.read")).toBe(false);
  });
});

describe("risk tier ordering", () => {
  it("agent maxRiskTier must be >= controller risk tier", () => {
    expect(riskTierAtLeast("MEDIUM", "LOW")).toBe(true);
    expect(riskTierAtLeast("HIGH", "HIGH")).toBe(true);
    expect(riskTierAtLeast("LOW", "MEDIUM")).toBe(false);
  });
});

describe("POLICY_AGENT_ELIGIBILITY_VIEW_V1", () => {
  it("allows when all conditions are met", () => {
    const d = evaluateAgentEligibilityPolicy(ctx());
    expect(d.allowed).toBe(true);
    expect(d.policyId).toBe(POLICY_AGENT_ELIGIBILITY_VIEW_V1);
  });

  it("denies an inactive agent (AGENT_NOT_AUTHORIZED)", () => {
    const d = evaluateAgentEligibilityPolicy(ctx({ agentStatus: "SUSPENDED" }));
    expect(d.allowed).toBe(false);
    expect(d.denyCode).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("denies an inactive credential (AGENT_NOT_AUTHORIZED)", () => {
    expect(
      evaluateAgentEligibilityPolicy(ctx({ credentialStatus: "EXPIRED" })).denyCode,
    ).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("denies a missing eligibility.read scope (AGENT_NOT_AUTHORIZED)", () => {
    expect(
      evaluateAgentEligibilityPolicy(ctx({ scopes: ["audit.read"] })).denyCode,
    ).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("denies an ineligible controller (CONTROLLER_NOT_ELIGIBLE)", () => {
    expect(
      evaluateAgentEligibilityPolicy(ctx({ controllerStatus: "SUSPENDED" })).denyCode,
    ).toBe("CONTROLLER_NOT_ELIGIBLE");
    expect(
      evaluateAgentEligibilityPolicy(ctx({ controllerKycValid: false })).denyCode,
    ).toBe("CONTROLLER_NOT_ELIGIBLE");
  });

  it("denies when agent risk tier is below the controller's (POLICY_CONDITIONS_NOT_MET)", () => {
    const d = evaluateAgentEligibilityPolicy(
      ctx({ agentMaxRiskTier: "LOW", controllerRiskTier: "HIGH" }),
    );
    expect(d.allowed).toBe(false);
    expect(d.denyCode).toBe("POLICY_CONDITIONS_NOT_MET");
  });
});
