/**
 * ZeroID — AI Agent Passport v1: agent → eligibility wrapper service.
 *
 * This module retains the public request/response types needed by partner
 * integrations, but proof orchestration is deliberately unavailable. Database
 * credential state is not agent authentication: the operation must first be
 * bound to a durable, one-time agent challenge and a relying-party challenge.
 * It must then produce and verify a signed-witness Groth16 proof and persist
 * the authorization, challenge consumption, and proof evidence atomically.
 */

import type { RiskTier, AgentStatus, CredentialStatus } from "./agent-passport";
import { ServiceError, type AnyServiceErrorCode } from "../errors";
import type { IdempotencyStore } from "../idempotency";

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
  idempotencyStore?: IdempotencyStore<AgentEligibilityProofResponse>;
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

export class AgentEligibilityError extends ServiceError {
  constructor(message: string, code: AnyServiceErrorCode, statusCode: number) {
    super(message, code, statusCode);
    this.name = "AgentEligibilityError";
  }
}

export const AGENT_ELIGIBILITY_UNAVAILABLE_CODE =
  "AGENT_ELIGIBILITY_PROOF_UNAVAILABLE";

export const AGENT_ELIGIBILITY_UNAVAILABLE_MESSAGE =
  "Agent eligibility proof issuance is unavailable until requests use durable one-time agent and relying-party challenges, a signed credential witness, audited Groth16 generation and verification, and transactionally persisted evidence";

export function agentEligibilityUnavailableError(): AgentEligibilityError {
  return new AgentEligibilityError(
    AGENT_ELIGIBILITY_UNAVAILABLE_MESSAGE,
    AGENT_ELIGIBILITY_UNAVAILABLE_CODE,
    503,
  );
}

export async function agentEligibilityProof(
  _deps: AgentEligibilityDeps,
  _req: AgentEligibilityProofRequest,
): Promise<never> {
  throw agentEligibilityUnavailableError();
}
