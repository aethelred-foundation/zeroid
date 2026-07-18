/**
 * ZeroID — Partner integration surface (Wallet, Cruzible).
 *
 * Makes ZeroID the "identity spine": Wallet (custody) and Cruzible (staking)
 * call these orchestrators to check eligibility, initiate warrant-bound
 * conditional disclosure, and fetch evidence. Human eligibility delegates to
 * the authoritative backend and propagates its unavailable status. Agent scans
 * and eligibility evidence retrieval remain explicitly unavailable until their
 * challenge authentication and durable proof-evidence contracts exist.
 *
 * Dependency-injected so the orchestration is unit-testable without a DB; the
 * route binds the real implementations.
 */

import {
  agentEligibilityUnavailableError,
  type EligibilityResult,
} from '../ai/agent-eligibility';
import { ServiceError, type AnyServiceErrorCode } from '../errors';

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

export interface DisclosureRequestEnvelope {
  escrowId: string;
  warrantHash: string;
  status: 'REQUESTED';
}

/** Injected dependencies — the route wires the real implementations. */
export interface PartnerDeps {
  /** Immutable caller identity supplied by authentication middleware. */
  principal: PartnerIdentity;
  resolveIdentity(did: string): Promise<PartnerIdentity | null>;
  /** Reuse the human eligibility logic in-process for `identity`. */
  runEligibility(
    identity: PartnerIdentity,
    input: {
      subjectDid: string;
      credentialId: string;
      policyId: string;
      relyingAppId: string;
    },
  ): Promise<EligibilityResult>;
}

function requirePrincipalDid(
  deps: PartnerDeps,
  claimedDid: string,
  role: string,
): void {
  if (deps.principal.did !== claimedDid) {
    throw new PartnerError(
      `authenticated identity is not the claimed ${role}`,
      'PARTNER_PRINCIPAL_MISMATCH',
      403,
    );
  }
}

export class PartnerError extends ServiceError {
  constructor(message: string, code: AnyServiceErrorCode, statusCode: number) {
    super(message, code, statusCode);
    this.name = 'PartnerError';
  }
}

export const PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_CODE =
  'PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE';

export const PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_MESSAGE =
  'Partner eligibility evidence is unavailable until it is loaded from a verified Groth16 receipt with a consumed relying-party challenge and durable subject-bound audit evidence';

export function partnerEligibilityEvidenceUnavailableError(): PartnerError {
  return new PartnerError(
    PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_MESSAGE,
    PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE_CODE,
    503,
  );
}

export const PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_CODE =
  'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE';

export const PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_MESSAGE =
  'Partner eligibility is unavailable until the relying party issues and atomically consumes a durable one-time challenge bound to a verified signed-witness Groth16 proof';

export function partnerEligibilityChallengeUnavailableError(): PartnerError {
  return new PartnerError(
    PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_MESSAGE,
    PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE_CODE,
    503,
  );
}

/** Wallet: is this account owner eligible (custody onboarding / policy-gated ops)? */
export async function walletEligibility(
  deps: PartnerDeps,
  input: WalletEligibilityInput,
): Promise<never> {
  requirePrincipalDid(deps, input.ownerDid, 'account owner');
  const identity = await deps.resolveIdentity(input.ownerDid);
  if (!identity) {
    throw new PartnerError(
      'account owner identity not found',
      'OWNER_NOT_FOUND',
      404,
    );
  }
  await deps.runEligibility(identity, {
    subjectDid: input.ownerDid,
    credentialId: input.credentialId,
    policyId: input.policyId,
    relyingAppId: input.relyingAppId,
  });
  throw partnerEligibilityChallengeUnavailableError();
}

/** Cruzible: is this staker eligible for a given pool under the pool's policy? */
export async function poolEligibility(
  deps: PartnerDeps,
  input: PoolEligibilityInput,
): Promise<never> {
  requirePrincipalDid(deps, input.stakerDid, 'staker');
  const identity = await deps.resolveIdentity(input.stakerDid);
  if (!identity) {
    throw new PartnerError(
      'staker identity not found',
      'STAKER_NOT_FOUND',
      404,
    );
  }
  await deps.runEligibility(identity, {
    subjectDid: input.stakerDid,
    credentialId: input.credentialId,
    policyId: input.policyId,
    relyingAppId: input.relyingAppId,
  });
  throw partnerEligibilityChallengeUnavailableError();
}

/** Cruzible: run an AI-agent compliance scan over a pool (AI Agent Passport). */
export async function poolAgentScan(
  _deps: PartnerDeps,
  _input: PoolAgentScanInput,
): Promise<never> {
  throw agentEligibilityUnavailableError();
}

/** Wallet: initiate a warrant-bound conditional-disclosure request (quorum acts off-chain). */
export async function initiateWalletDisclosure(
  _deps: PartnerDeps,
  _input: WalletDisclosureInput,
): Promise<DisclosureRequestEnvelope> {
  throw new PartnerError(
    'conditional disclosure is unavailable until a persisted quorum escrow is configured',
    'DISCLOSURE_UNAVAILABLE',
    501,
  );
}

/** Wallet: fetch an evidence bundle (Digital Seal / decision evidence). */
export async function getPartnerEvidence(
  _deps: PartnerDeps,
  _decisionId: string,
): Promise<never> {
  throw partnerEligibilityEvidenceUnavailableError();
}
