/**
 * ZeroID — OpenID4VP ZK eligibility predicate (the privacy-moat rung).
 *
 * Instead of disclosing claims, the Wallet presents a `zeroid-zk-eligibility+jwt`
 * vp_token: a holder-signed envelope carrying a Groth16 proof that the subject
 * satisfies the policy, plus the public signals that bind the proof to this
 * policy + request context. The verifier discloses NOTHING about the subject.
 *
 * Two classes of check:
 *  - Bindings (protocol): the proof must be for this circuit / vkey / policy
 *    version, bound to this request's nonce+audience, and evaluated close enough
 *    to now. A mismatch is an error (the Wallet presented the wrong thing).
 *  - Eligibility (outcome): residency in the allowed set, and the Groth16 proof
 *    verifying. A failure here is a DENIED decision, not an error.
 *
 * Dependency-injected: the Groth16 verification and context-commitment scheme
 * are bound to the real circuit/precompile at activation (gate W2c); tests stub
 * them. Buildable and verifiable now; the cryptographic backend rides W2c.
 */
import { ServiceError } from '../errors';
import type { PresentationPolicy, ZkFreshnessBinding } from './policy-presentation';

export const ZK_ELIGIBILITY_FORMAT = 'zeroid-zk-eligibility+jwt';

export interface ZkPredicateVerifyDeps {
  /** Verify the holder-signed envelope; returns its header + payload. Throws on bad sig. */
  verifyHolderJwt(
    compactJwt: string,
  ): Promise<{ payload: Record<string, unknown>; header: Record<string, unknown> }>;
  /** Verify a Groth16 proof against a registered verification key. */
  verifyGroth16(input: {
    circuitId: string;
    vkeyId: string;
    proof: unknown;
    publicSignals: Record<string, string>;
  }): Promise<boolean>;
  /** Compute the expected context commitment that binds a proof to nonce + audience. */
  computeContextCommitment(nonce: string, audience: string): Promise<string>;
  /**
   * Verifier clock, in Unix SECONDS (the unit the circuit's evaluation-time
   * signal uses). Injected rather than read from `Date.now()` inline so the
   * freshness window is deterministic under test.
   */
  now(): number;
}

export interface VerifiedZkPredicate {
  status: 'ALLOWED' | 'DENIED';
  circuitId: string;
  publicSignals: Record<string, string>;
  reasons: string[];
}

/**
 * Parse an untrusted public signal as a Unix-seconds instant, or `null`.
 *
 * Public signals arrive as decimal field-element strings from a JWT payload, so
 * everything about the value is attacker-controlled. Fail closed on every shape
 * that is not a plain non-negative integer inside the safe-integer range:
 * absent, empty, signed, fractional, exponent/hex notation, whitespace-only,
 * and values large enough that JavaScript arithmetic on them stops being exact.
 */
function parseUnixSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A freshness binding is usable only if it names a signal and carries two
 * non-negative, finite windows. Anything else is a policy defect, and the
 * fail-closed answer to a policy defect is to verify nothing.
 */
function isUsableFreshnessBinding(f: unknown): f is ZkFreshnessBinding {
  if (typeof f !== 'object' || f === null) return false;
  const b = f as Partial<ZkFreshnessBinding>;
  return (
    typeof b.signal === 'string' &&
    b.signal.length > 0 &&
    typeof b.maxAgeSeconds === 'number' &&
    Number.isFinite(b.maxAgeSeconds) &&
    b.maxAgeSeconds >= 0 &&
    typeof b.maxSkewAheadSeconds === 'number' &&
    Number.isFinite(b.maxSkewAheadSeconds) &&
    b.maxSkewAheadSeconds >= 0
  );
}

function decodeJwtHeader(compact: string): Record<string, unknown> | null {
  const seg = compact.split('~')[0].split('.')[0];
  try {
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** True when `vpToken` is a ZK eligibility presentation (vs an SD-JWT VC). */
export function isZkEligibilityToken(vpToken: string): boolean {
  if (vpToken.includes('~')) return false; // SD-JWT VC presentation
  return decodeJwtHeader(vpToken)?.typ === ZK_ELIGIBILITY_FORMAT;
}

export async function verifyZkPredicate(
  deps: ZkPredicateVerifyDeps,
  params: {
    vpToken: string;
    policy: PresentationPolicy;
    expectedNonce: string;
    expectedAudience: string;
  },
): Promise<VerifiedZkPredicate> {
  const zk = params.policy.zk;
  if (!zk) {
    throw new ServiceError('policy does not support ZK eligibility', 'VP_TOKEN_INVALID', 400);
  }

  const { payload, header } = await deps.verifyHolderJwt(params.vpToken);
  if (header.typ !== ZK_ELIGIBILITY_FORMAT) {
    throw new ServiceError('not a ZK eligibility token', 'VP_TOKEN_INVALID', 401);
  }
  if (payload.aud !== params.expectedAudience) {
    throw new ServiceError('audience mismatch', 'VP_TOKEN_INVALID', 401);
  }
  if (payload.nonce !== params.expectedNonce) {
    throw new ServiceError('nonce mismatch', 'VP_NONCE_INVALID', 401);
  }

  const circuitId = String(payload.circuitId ?? '');
  const vkeyId = String(payload.vkeyId ?? '');
  const publicSignals = (payload.publicSignals ?? {}) as Record<string, string>;
  const proof = payload.proof;

  // ── Bindings (protocol-level mismatch -> error) ──
  if (circuitId !== zk.circuitId || vkeyId !== zk.vkeyId) {
    throw new ServiceError('proof is for a different circuit', 'VP_VCT_MISMATCH', 400);
  }
  for (const [name, expected] of Object.entries(zk.expectedPublicSignals)) {
    if (publicSignals[name] !== expected) {
      throw new ServiceError(
        `public signal ${name} does not bind to this policy`,
        'VP_VCT_MISMATCH',
        400,
      );
    }
  }
  const expectedCtx = await deps.computeContextCommitment(params.expectedNonce, params.expectedAudience);
  if (publicSignals[zk.contextSignal] !== expectedCtx) {
    throw new ServiceError('proof not bound to this request context', 'VP_NONCE_INVALID', 401);
  }

  // Freshness is a BINDING, not an eligibility outcome. The circuit evaluates
  // the age and expiry predicates at the prover-supplied evaluation instant, so
  // a stale or future-dated proof is not a holder who failed this policy — it is
  // a truthful proof of a DIFFERENT statement ("was eligible then") than the one
  // the verifier asked ("is eligible now"). Like the nonce and context checks,
  // the answer is to refuse the presentation, not to return DENIED: reporting it
  // as an eligibility outcome would let a replayed or forward-dated proof be
  // audited as a legitimate policy evaluation.
  if (!isUsableFreshnessBinding(zk.freshness)) {
    // A policy with no freshness window would silently reopen the hole for
    // every presentation it accepts, so refuse the policy itself.
    throw new ServiceError(
      'policy ZK binding declares no proof-freshness requirement',
      'INTERNAL_ERROR',
      500,
    );
  }
  const freshness = zk.freshness;
  const evaluatedAt = parseUnixSeconds(publicSignals[freshness.signal]);
  if (evaluatedAt === null) {
    throw new ServiceError(
      `public signal ${freshness.signal} is not a valid evaluation timestamp`,
      'VP_TOKEN_INVALID',
      401,
    );
  }
  const nowSeconds = deps.now();
  if (evaluatedAt > nowSeconds + freshness.maxSkewAheadSeconds) {
    throw new ServiceError(
      'proof was evaluated in the future',
      'VP_TOKEN_INVALID',
      401,
    );
  }
  if (evaluatedAt < nowSeconds - freshness.maxAgeSeconds) {
    throw new ServiceError(
      'proof was evaluated too long ago',
      'VP_TOKEN_INVALID',
      401,
    );
  }

  // ── Eligibility outcomes (failure -> DENIED, not error) ──
  const reasons: string[] = [];
  const residency = publicSignals[zk.residency.signal];
  if (!zk.residency.allowed.includes(residency)) {
    reasons.push(`residency ${residency || '(none)'} not allowed`);
  }
  const proofOk = await deps.verifyGroth16({ circuitId, vkeyId, proof, publicSignals });
  if (!proofOk) reasons.push('eligibility proof did not verify');

  return {
    status: reasons.length === 0 ? 'ALLOWED' : 'DENIED',
    circuitId,
    publicSignals,
    reasons,
  };
}
