/**
 * ZeroID — ZK eligibility verification adapter (jose + node crypto).
 *
 * Provides the real dependencies for `verifyZkPredicate`:
 *  - `verifyHolderJwt`: verifies the holder-signed `zeroid-zk-eligibility+jwt`
 *    envelope (the key travels in the header `jwk`, PoP-style).
 *  - `computeContextCommitment`: a deterministic SHA-256 binding of nonce +
 *    audience. The circuit MUST commit to the same scheme — that equivalence is
 *    the W2c activation concern.
 *  - `verifyGroth16`: the genuinely chain-gated piece. Defaults to a 501 until a
 *    real proof verifier (registered vkey + precompile) is injected at gate W2c.
 *  - `declaredPublicSignals`: the circuit registry's public-signal schema, so a
 *    policy cannot name a freshness signal the circuit does not publish.
 *    Defaults to "unknown circuit", which refuses.
 */
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose';
import { createHash } from 'node:crypto';
import { ServiceError } from '../errors';
import type { ZkPredicateVerifyDeps } from './zk-predicate';

export interface JoseZkOptions {
  /** Real Groth16 verifier (gate W2c). Defaults to a gated stub that returns 501. */
  verifyGroth16?: ZkPredicateVerifyDeps['verifyGroth16'];
  /**
   * Circuit public-signal schema lookup, backed by the backend circuit
   * registry. Defaults to "no circuit is known", which refuses every ZK
   * presentation: this adapter owns no registry, and answering the question
   * with a guess would defeat the check that the policy's freshness signal is
   * one the circuit really publishes.
   */
  declaredPublicSignals?: ZkPredicateVerifyDeps['declaredPublicSignals'];
}

export function createJoseZkDeps(opts: JoseZkOptions = {}): ZkPredicateVerifyDeps {
  return {
    async verifyHolderJwt(compact) {
      let header: Record<string, unknown>;
      try {
        header = decodeProtectedHeader(compact) as Record<string, unknown>;
      } catch {
        throw new ServiceError('malformed ZK envelope', 'VP_TOKEN_INVALID', 401);
      }
      const jwk = header.jwk as JWK | undefined;
      if (!jwk || typeof jwk !== 'object') {
        throw new ServiceError('ZK envelope is missing the header jwk', 'VP_TOKEN_INVALID', 401);
      }
      const key = await importJWK(jwk, (header.alg as string) ?? (jwk.alg as string) ?? 'ES256');
      try {
        const { payload, protectedHeader } = await jwtVerify(compact, key);
        return {
          payload: payload as Record<string, unknown>,
          header: protectedHeader as Record<string, unknown>,
        };
      } catch {
        throw new ServiceError('ZK envelope signature invalid', 'VP_TOKEN_INVALID', 401);
      }
    },

    async verifyGroth16(input) {
      if (opts.verifyGroth16) return opts.verifyGroth16(input);
      throw new ServiceError(
        'ZK proof verification not configured (gate W2c: register vkey + precompile)',
        'VP_TOKEN_INVALID',
        501,
      );
    },

    declaredPublicSignals(circuitId) {
      return opts.declaredPublicSignals ? opts.declaredPublicSignals(circuitId) : null;
    },

    async computeContextCommitment(nonce, audience) {
      return '0x' + createHash('sha256').update(`${nonce}|${audience}`).digest('hex');
    },

    now: () => Math.floor(Date.now() / 1000),
  };
}
