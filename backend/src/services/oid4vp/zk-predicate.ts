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
 *    version, and bound to this request's nonce+audience. A mismatch is an error
 *    (the Wallet presented the wrong thing).
 *  - Eligibility (outcome): residency in the allowed set, and the Groth16 proof
 *    verifying. A failure here is a DENIED decision, not an error.
 *
 * Dependency-injected: the Groth16 verification and context-commitment scheme
 * are bound to the real circuit/precompile at activation (gate W2c); tests stub
 * them. Buildable and verifiable now; the cryptographic backend rides W2c.
 */
import { ServiceError } from '../errors';
import type { PresentationPolicy } from './policy-presentation';

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
  now(): number;
}

export interface VerifiedZkPredicate {
  status: 'ALLOWED' | 'DENIED';
  circuitId: string;
  publicSignals: Record<string, string>;
  reasons: string[];
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
