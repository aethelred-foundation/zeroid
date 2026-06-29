/**
 * ZeroID — Step 2: OpenID4VP presentation verifier (MVP).
 *
 * Orchestrates: resolve the policy -> (optional) consume the nonce -> verify the
 * SD-JWT VC presentation -> evaluate the disclosed claims against the policy ->
 * return a decision. Dependency-injected so it is unit-testable without keys or
 * a DB; the route binds the real `jose` adapter (`sd-jwt-jose.ts`).
 */
import { ServiceError } from '../errors';
import {
  evaluatePresentationPolicy,
  getPresentationPolicy,
  type PresentationPolicy,
} from './policy-presentation';
import { verifySdJwtVc, type SdJwtVerifyDeps, type VerifiedSdJwt } from './sd-jwt';
import {
  isZkEligibilityToken,
  verifyZkPredicate,
  ZK_ELIGIBILITY_FORMAT,
  type ZkPredicateVerifyDeps,
} from './zk-predicate';

export interface PresentationVerifierDeps {
  /** Resolve a presentation policy (default: getPresentationPolicy). */
  getPolicy?(policyId: string): PresentationPolicy;
  /** SD-JWT VC verification dependencies (issuer/holder sig verifiers + clock). */
  sdJwt: SdJwtVerifyDeps;
  /** ZK eligibility verification deps; required to accept `zeroid-zk-eligibility+jwt` tokens. */
  zk?: ZkPredicateVerifyDeps;
  /**
   * Optional replay guard: returns true if the nonce was issued by us and is now
   * consumed, false if unknown/replayed. When absent, replay protection relies
   * on the KB-JWT nonce binding (acceptable for the same-device MVP; the
   * cross-device flow adds a persisted nonce store).
   */
  consumeNonce?(nonce: string): Promise<boolean>;
}

export interface PresentationRequest {
  policyId: string;
  vpToken: string;
  nonce: string;
  audience: string;
  relyingAppId?: string;
}

export interface PresentationDecision {
  status: 'ALLOWED' | 'DENIED';
  policyId: string;
  vct: string;
  satisfied: Record<string, boolean>;
  reasons: string[];
  disclosedClaims: string[];
  relyingAppId?: string;
  verifiedAt: string;
}

export async function verifyPresentation(
  deps: PresentationVerifierDeps,
  req: PresentationRequest,
): Promise<PresentationDecision> {
  const resolve = deps.getPolicy ?? getPresentationPolicy;
  const policy = resolve(req.policyId);

  if (deps.consumeNonce) {
    const ok = await deps.consumeNonce(req.nonce);
    if (!ok) throw new ServiceError('nonce unknown or already used', 'VP_NONCE_INVALID', 401);
  }

  // Privacy-moat rung: a ZK eligibility predicate discloses nothing.
  if (isZkEligibilityToken(req.vpToken)) {
    if (!deps.zk) {
      throw new ServiceError('ZK eligibility presentation not supported', 'VP_TOKEN_INVALID', 400);
    }
    const zk = await verifyZkPredicate(deps.zk, {
      vpToken: req.vpToken,
      policy,
      expectedNonce: req.nonce,
      expectedAudience: req.audience,
    });
    return {
      status: zk.status,
      policyId: policy.policyId,
      vct: ZK_ELIGIBILITY_FORMAT,
      satisfied: {},
      reasons: zk.reasons,
      disclosedClaims: [],
      relyingAppId: req.relyingAppId,
      verifiedAt: new Date(deps.zk.now() * 1000).toISOString(),
    };
  }

  const verified: VerifiedSdJwt = await verifySdJwtVc(deps.sdJwt, {
    compact: req.vpToken,
    expectedNonce: req.nonce,
    expectedAudience: req.audience,
    expectedVct: policy.vct,
  });

  const evaluation = evaluatePresentationPolicy(policy, verified.claims);

  return {
    status: evaluation.status,
    policyId: policy.policyId,
    vct: verified.vct,
    satisfied: evaluation.satisfied,
    reasons: evaluation.reasons,
    disclosedClaims: Object.keys(verified.claims),
    relyingAppId: req.relyingAppId,
    verifiedAt: new Date(deps.sdJwt.now() * 1000).toISOString(),
  };
}
