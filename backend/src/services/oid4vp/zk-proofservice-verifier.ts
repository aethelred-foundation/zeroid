/**
 * ZeroID — bridge the OpenID4VP ZK eligibility predicate to the existing
 * backend Groth16 verifier (`ZKProofService.verifyProof`, real snarkjs).
 *
 * The predicate carries *named* public signals; `verifyProof` wants the array
 * in the circuit's fixed order plus the registry `circuitName`. This adapter
 * resolves the circuit by id and reorders the signals, so the OpenID4VP path
 * runs end-to-end on the current proof system (the actual cryptographic
 * verification still depends on the registered circuit artifacts — gate W2c).
 */
import { ServiceError } from '../errors';
import type { SnarkProof, VerificationResult } from '../zkproof';
import type { ZkPredicateVerifyDeps } from './zk-predicate';

interface CircuitMapping {
  /** Key in the backend CIRCUIT_REGISTRY. */
  circuitName: string;
  /** Public-signal names in the exact order the circuit emits them. */
  publicSignalOrder: string[];
}

/** Maps a presentation `circuitId` to the backend circuit + its signal order. */
const KNOWN_CIRCUITS: Record<string, CircuitMapping> = {
  zkc_eligibility_policy_context_v1: {
    circuitName: 'eligibility_policy_context_v1',
    publicSignalOrder: [
      'claimsHash',
      'ageThresholdYears',
      'residencyCountryCode',
      'currentTimestamp',
      'policyVersionHash',
      'contextCommitment',
    ],
  },
};

/** Minimal slice of ZKProofService this adapter needs. */
export interface ProofVerifier {
  verifyProof(
    proof: SnarkProof,
    publicSignals: string[],
    circuitName: string,
  ): Promise<Pick<VerificationResult, 'valid'>>;
}

export function createZkProofServiceVerifier(
  svc: ProofVerifier,
  resolveCircuit: (circuitId: string) => CircuitMapping | undefined = (id) => KNOWN_CIRCUITS[id],
): ZkPredicateVerifyDeps['verifyGroth16'] {
  return async ({ circuitId, proof, publicSignals }) => {
    const circuit = resolveCircuit(circuitId);
    if (!circuit) {
      throw new ServiceError(`unknown ZK circuit: ${circuitId}`, 'VP_TOKEN_INVALID', 400);
    }
    const ordered = circuit.publicSignalOrder.map((name) => {
      const value = publicSignals[name];
      if (value === undefined) {
        throw new ServiceError(`missing public signal: ${name}`, 'VP_TOKEN_INVALID', 400);
      }
      return value;
    });
    const result = await svc.verifyProof(proof as SnarkProof, ordered, circuit.circuitName);
    return result.valid;
  };
}
