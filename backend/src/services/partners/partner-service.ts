/**
 * ZeroID — Partner integration surface (Wallet, Cruzible).
 *
 * Makes ZeroID the "identity spine": Wallet (custody) and Cruzible (staking)
 * call these orchestrators to check eligibility, run agent compliance scans,
 * initiate warrant-bound conditional disclosure, and fetch evidence — all by
 * REUSING existing ZeroID logic (the human `eligibilityProofHandler`, the AI
 * Agent Passport, the conditional-disclosure escrow), never re-implementing it.
 *
 * Dependency-injected so the orchestration is unit-testable without a DB; the
 * route binds the real implementations.
 */

import type {
  EligibilityResult,
  AgentEligibilityProofRequest,
  AgentEligibilityProofResponse,
} from '../ai/agent-eligibility';

export interface PartnerIdentity {
  id: string;
  did: string;
}

export interface WalletEligibilityInput {
  ownerDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
}

export interface PoolEligibilityInput {
  poolId: string;
  stakerDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
}

export interface PoolAgentScanInput {
  poolId: string;
  agentDid: string;
  controllerDid: string;
  subjectDid: string;
  credentialId: string;
  policyId: string;
  relyingAppId: string;
}

export interface WalletDisclosureInput {
  decisionId: string;
  warrantHash: string;
}

export interface PartnerEligibilityResult {
  eligible: boolean;
  decision: EligibilityResult;
}

export interface DisclosureRequestEnvelope {
  escrowId: string;
  warrantHash: string;
  status: 'REQUESTED';
}

/** Injected dependencies — the route wires the real implementations. */
export interface PartnerDeps {
  resolveIdentity(did: string): Promise<PartnerIdentity | null>;
  /** Reuse the human eligibility logic in-process for `identity`. */
  runEligibility(
    identity: PartnerIdentity,
    input: { subjectDid: string; credentialId: string; policyId: string; relyingAppId: string },
  ): Promise<EligibilityResult>;
  /** Reuse the AI Agent Passport eligibility wrapper. */
  runAgentScan(req: AgentEligibilityProofRequest): Promise<AgentEligibilityProofResponse>;
  /** Record a warrant-bound conditional-disclosure request; returns the escrow id. */
  recordDisclosureRequest(input: { decisionId: string; warrantHash: string }): Promise<string>;
  /** Fetch an evidence bundle for a decision/proof id. */
  getEvidence(decisionId: string): Promise<unknown | null>;
}

export class PartnerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'PartnerError';
  }
}

/** Wallet: is this account owner eligible (custody onboarding / policy-gated ops)? */
export async function walletEligibility(
  deps: PartnerDeps,
  input: WalletEligibilityInput,
): Promise<PartnerEligibilityResult> {
  const identity = await deps.resolveIdentity(input.ownerDid);
  if (!identity) {
    throw new PartnerError('account owner identity not found', 'OWNER_NOT_FOUND', 404);
  }
  const decision = await deps.runEligibility(identity, {
    subjectDid: input.ownerDid,
    credentialId: input.credentialId,
    policyId: input.policyId,
    relyingAppId: input.relyingAppId,
  });
  return { eligible: decision.status === 'ALLOWED', decision };
}

/** Cruzible: is this staker eligible for a given pool under the pool's policy? */
export async function poolEligibility(
  deps: PartnerDeps,
  input: PoolEligibilityInput,
): Promise<PartnerEligibilityResult & { poolId: string }> {
  const identity = await deps.resolveIdentity(input.stakerDid);
  if (!identity) {
    throw new PartnerError('staker identity not found', 'STAKER_NOT_FOUND', 404);
  }
  const decision = await deps.runEligibility(identity, {
    subjectDid: input.stakerDid,
    credentialId: input.credentialId,
    policyId: input.policyId,
    relyingAppId: input.relyingAppId,
  });
  return { poolId: input.poolId, eligible: decision.status === 'ALLOWED', decision };
}

/** Cruzible: run an AI-agent compliance scan over a pool (AI Agent Passport). */
export async function poolAgentScan(
  deps: PartnerDeps,
  input: PoolAgentScanInput,
): Promise<AgentEligibilityProofResponse & { poolId: string }> {
  const result = await deps.runAgentScan({
    agentDid: input.agentDid,
    controllerDid: input.controllerDid,
    subjectDid: input.subjectDid,
    credentialId: input.credentialId,
    policyId: input.policyId,
    relyingAppId: input.relyingAppId,
  });
  return { ...result, poolId: input.poolId };
}

/** Wallet: initiate a warrant-bound conditional-disclosure request (quorum acts off-chain). */
export async function initiateWalletDisclosure(
  deps: PartnerDeps,
  input: WalletDisclosureInput,
): Promise<DisclosureRequestEnvelope> {
  const escrowId = await deps.recordDisclosureRequest({
    decisionId: input.decisionId,
    warrantHash: input.warrantHash,
  });
  return { escrowId, warrantHash: input.warrantHash, status: 'REQUESTED' };
}

/** Wallet: fetch an evidence bundle (Digital Seal / decision evidence). */
export async function getPartnerEvidence(
  deps: PartnerDeps,
  decisionId: string,
): Promise<unknown> {
  const evidence = await deps.getEvidence(decisionId);
  if (!evidence) {
    throw new PartnerError('evidence not found', 'EVIDENCE_NOT_FOUND', 404);
  }
  return evidence;
}
