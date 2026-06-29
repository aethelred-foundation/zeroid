/**
 * ZeroID — AI Agent Passport v1: agent → eligibility wrapper service.
 *
 * Lets an AI agent request an eligibility proof on behalf of its controller,
 * with scope + policy checks and a recorded AgentAction. The flagship v1
 * scenario. Built with dependency injection so the orchestration is unit-
 * testable without a database; the route wires the real Prisma + eligibility
 * implementations.
 */

import {
  evaluateAgentEligibilityPolicy,
  POLICY_AGENT_ELIGIBILITY_VIEW_V1,
  type RiskTier,
  type AgentStatus,
  type CredentialStatus,
} from "./agent-passport";

export interface AgentEligibilityProofRequest {
  agentDid: string;
  controllerDid: string;
  subjectDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
  contextNonce?: string;
  /** Optional idempotency key — a repeated request returns the cached result. */
  idempotencyKey?: string;
}

/** Optional idempotency store; when present, a repeated key short-circuits. */
export interface IdempotencyStore {
  get(key: string): Promise<AgentEligibilityProofResponse | null>;
  set(key: string, value: AgentEligibilityProofResponse): Promise<void>;
}

export interface AgentPassportRecord {
  agentDid: string;
  controllerDid: string;
  agentStatus: AgentStatus;
  credentialStatus: CredentialStatus;
  scopes: string[];
  agentMaxRiskTier: RiskTier;
}

export interface ControllerRecord {
  controllerStatus: string;
  controllerKycValid: boolean;
  controllerRiskTier: RiskTier;
}

export interface EligibilityResult {
  status: "ALLOWED" | "DENIED";
  decisionId: string;
  policyId: string;
  policyVersion: string;
  proof: {
    proofId: string;
    circuitId: string;
    verificationKeyId: string;
    contextHash: string;
    verifiedAt: string;
    onchainTxHash?: string;
  };
  evaluation: {
    ageSatisfied: boolean;
    jurisdictionSatisfied: boolean;
    sanctionsStatus: "CLEAR" | "POTENTIAL_MATCH" | "CONFIRMED_MATCH";
    riskTier: RiskTier;
    credentialStatus: string;
    nonRevocationVerified: boolean;
  };
  evidence: {
    auditLogId: string;
    auditHash: string;
    regulatoryReportId?: string;
    teeAttestationId?: string;
  };
  issuedAt: string;
}

export interface RecordedAgentAction {
  agentDid: string;
  controllerDid: string;
  actionType: string;
  resourceId?: string;
  policyId: string;
  status: "ALLOWED" | "DENIED" | "FAILED";
}

/** Injected dependencies — the route binds real Prisma + eligibility impls. */
export interface AgentEligibilityDeps {
  loadAgent(agentDid: string): Promise<AgentPassportRecord | null>;
  loadController(controllerDid: string): Promise<ControllerRecord | null>;
  runEligibility(input: {
    subjectDid: string;
    credentialId: string;
    policyId: string;
    relyingAppId: string;
    contextNonce?: string;
  }): Promise<EligibilityResult>;
  recordAgentAction(action: RecordedAgentAction): Promise<string>;
  idempotencyStore?: IdempotencyStore;
}

export interface AgentEligibilityProofResponse {
  status: "ALLOWED" | "DENIED";
  decisionId: string;
  policyId: string;
  policyVersion: string;
  actor: { agentDid: string; controllerDid: string; agentScopes: string[] };
  proof: EligibilityResult["proof"];
  evaluation: EligibilityResult["evaluation"];
  evidence: EligibilityResult["evidence"] & { agentActionId: string };
  issuedAt: string;
}

export class AgentEligibilityError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "AgentEligibilityError";
  }
}

const ACTION_TYPE = "ELIGIBILITY_PROOF_REQUEST";

export async function agentEligibilityProof(
  deps: AgentEligibilityDeps,
  req: AgentEligibilityProofRequest,
): Promise<AgentEligibilityProofResponse> {
  // Idempotency: a repeated key returns the prior result without re-recording
  // an AgentAction or re-running eligibility.
  if (req.idempotencyKey && deps.idempotencyStore) {
    const cached = await deps.idempotencyStore.get(req.idempotencyKey);
    if (cached) return cached;
  }

  const agent = await deps.loadAgent(req.agentDid);
  if (!agent) {
    throw new AgentEligibilityError("agent not found", "AGENT_NOT_FOUND", 404);
  }

  // Controller binding — the agent may only act for its registered controller.
  if (agent.controllerDid !== req.controllerDid) {
    await deps.recordAgentAction({
      agentDid: req.agentDid,
      controllerDid: req.controllerDid,
      actionType: ACTION_TYPE,
      policyId: POLICY_AGENT_ELIGIBILITY_VIEW_V1,
      status: "DENIED",
    });
    throw new AgentEligibilityError(
      "agent not registered for this controller",
      "CONTROLLER_MISMATCH",
      403,
    );
  }

  const controller = await deps.loadController(req.controllerDid);
  if (!controller) {
    throw new AgentEligibilityError("controller not found", "CREDENTIAL_NOT_FOUND", 404);
  }

  const decision = evaluateAgentEligibilityPolicy({
    agentStatus: agent.agentStatus,
    credentialStatus: agent.credentialStatus,
    scopes: agent.scopes,
    agentMaxRiskTier: agent.agentMaxRiskTier,
    controllerStatus: controller.controllerStatus,
    controllerKycValid: controller.controllerKycValid,
    controllerRiskTier: controller.controllerRiskTier,
  });

  if (!decision.allowed) {
    await deps.recordAgentAction({
      agentDid: req.agentDid,
      controllerDid: req.controllerDid,
      actionType: ACTION_TYPE,
      policyId: decision.policyId,
      status: "DENIED",
    });
    const statusCode = decision.denyCode === "POLICY_CONDITIONS_NOT_MET" ? 422 : 403;
    throw new AgentEligibilityError(
      decision.reason ?? "denied",
      decision.denyCode ?? "AGENT_NOT_AUTHORIZED",
      statusCode,
    );
  }

  const result = await deps.runEligibility({
    subjectDid: req.subjectDid,
    credentialId: req.credentialId,
    policyId: req.policyId,
    relyingAppId: req.relyingAppId,
    contextNonce: req.contextNonce,
  });

  const agentActionId = await deps.recordAgentAction({
    agentDid: req.agentDid,
    controllerDid: req.controllerDid,
    actionType: ACTION_TYPE,
    resourceId: result.decisionId,
    policyId: decision.policyId,
    status: result.status === "ALLOWED" ? "ALLOWED" : "DENIED",
  });

  const response: AgentEligibilityProofResponse = {
    status: result.status,
    decisionId: result.decisionId,
    policyId: result.policyId,
    policyVersion: result.policyVersion,
    actor: {
      agentDid: agent.agentDid,
      controllerDid: agent.controllerDid,
      agentScopes: agent.scopes,
    },
    proof: result.proof,
    evaluation: result.evaluation,
    evidence: { ...result.evidence, agentActionId },
    issuedAt: result.issuedAt,
  };

  if (req.idempotencyKey && deps.idempotencyStore) {
    await deps.idempotencyStore.set(req.idempotencyKey, response);
  }

  return response;
}
