/**
 * ZeroID — AI Agent Passport v1: scopes vocabulary + policy core.
 *
 * Pure (no I/O) implementation of the consultant's AI Agent Identity v1:
 * a controlled read-only scope vocabulary and `POLICY_AGENT_ELIGIBILITY_VIEW_V1`,
 * which makes an agent's powers a layered trust object bounded by BOTH the
 * agent's own credential AND the controller's KYC/policy status.
 *
 * This module is deliberately DB-free so the policy is unit-testable in
 * isolation; the route/service map persisted rows into the context type.
 */

/** v1 controlled scope vocabulary (read-only only). */
export const AGENT_SCOPES = [
  "eligibility.read",
  "audit.read",
  "identity.read",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export function isValidScope(scope: string): scope is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(scope);
}

/** Throw if any scope is outside the controlled vocabulary. */
export function assertValidScopes(scopes: string[]): void {
  const invalid = scopes.filter((s) => !isValidScope(s));
  if (invalid.length > 0) {
    throw new Error(`invalid agent scopes: ${invalid.join(", ")}`);
  }
}

export function hasScope(scopes: string[], scope: AgentScope): boolean {
  return scopes.includes(scope);
}

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const RISK_RANK: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/** True when `have` is at least as high a risk tier as `need`. */
export function riskTierAtLeast(have: RiskTier, need: RiskTier): boolean {
  return RISK_RANK[have] >= RISK_RANK[need];
}

export const POLICY_AGENT_ELIGIBILITY_VIEW_V1 =
  "POLICY_AGENT_ELIGIBILITY_VIEW_V1";

export type AgentStatus = "ACTIVE" | "SUSPENDED" | "REVOKED" | "PENDING_APPROVAL";
export type CredentialStatus = "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";

export interface AgentEligibilityPolicyContext {
  agentStatus: AgentStatus;
  credentialStatus: CredentialStatus;
  scopes: string[];
  agentMaxRiskTier: RiskTier;
  controllerStatus: string;
  controllerKycValid: boolean;
  controllerRiskTier: RiskTier;
}

export type PolicyDenyCode =
  | "AGENT_NOT_AUTHORIZED"
  | "CONTROLLER_NOT_ELIGIBLE"
  | "POLICY_CONDITIONS_NOT_MET";

export interface PolicyDecision {
  allowed: boolean;
  policyId: string;
  reason?: string;
  denyCode?: PolicyDenyCode;
}

/**
 * Evaluate POLICY_AGENT_ELIGIBILITY_VIEW_V1. The agent may request an
 * eligibility proof on behalf of its controller only if its own credential is
 * in good standing AND scoped for it, AND the controller is itself eligible,
 * AND the agent's risk ceiling covers the controller's risk tier.
 */
export function evaluateAgentEligibilityPolicy(
  ctx: AgentEligibilityPolicyContext,
): PolicyDecision {
  const policyId = POLICY_AGENT_ELIGIBILITY_VIEW_V1;

  if (ctx.agentStatus !== "ACTIVE") {
    return { allowed: false, policyId, denyCode: "AGENT_NOT_AUTHORIZED", reason: "agent not active" };
  }
  if (ctx.credentialStatus !== "ACTIVE") {
    return { allowed: false, policyId, denyCode: "AGENT_NOT_AUTHORIZED", reason: "agent credential not active" };
  }
  if (!hasScope(ctx.scopes, "eligibility.read")) {
    return { allowed: false, policyId, denyCode: "AGENT_NOT_AUTHORIZED", reason: "missing eligibility.read scope" };
  }
  if (ctx.controllerStatus !== "ACTIVE") {
    return { allowed: false, policyId, denyCode: "CONTROLLER_NOT_ELIGIBLE", reason: "controller not active" };
  }
  if (!ctx.controllerKycValid) {
    return { allowed: false, policyId, denyCode: "CONTROLLER_NOT_ELIGIBLE", reason: "controller KYC not valid" };
  }
  if (!riskTierAtLeast(ctx.agentMaxRiskTier, ctx.controllerRiskTier)) {
    return { allowed: false, policyId, denyCode: "POLICY_CONDITIONS_NOT_MET", reason: "agent max risk tier below controller risk tier" };
  }
  return { allowed: true, policyId };
}
