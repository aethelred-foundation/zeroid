/**
 * ZeroID — Client-Side ZK Proof Verification
 *
 * Provides local (browser-side) verification of Groth16 proofs using
 * snarkjs. This allows the frontend to optimistically validate proofs
 * before submitting them on-chain, giving instant user feedback.
 *
 * On-chain verification via the ZKVerifier contract remains the
 * authoritative source of truth.
 */

import type {
  Bytes32,
  Groth16Proof,
  ZKProof,
  ProofVerification,
} from '@/types';
import { CIRCUITS } from '@/config/constants';
import { withTimeout } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/** Verification key JSON structure as exported by snarkjs */
interface VerificationKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  vk_alphabeta_12: string[][][];
  IC: string[][];
}

// ============================================================================
// Verification Key Cache
// ============================================================================

const vkeyCache = new Map<string, VerificationKey>();

/**
 * Fetch and cache a verification key for a circuit.
 *
 * @param circuitId - The circuit identifier
 * @returns The parsed verification key
 * @throws If the circuit is unknown or the key fails to load
 */
async function fetchVerificationKey(circuitId: Bytes32): Promise<VerificationKey> {
  const cached = vkeyCache.get(circuitId);
  if (cached) return cached;

  const circuit = CIRCUITS[circuitId];
  if (!circuit) {
    throw new Error(`Unknown circuit: ${circuitId}`);
  }

  const response = await fetch(circuit.vkeyPath);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch verification key for circuit ${circuit.name}: HTTP ${response.status}`,
    );
  }

  const vkey: VerificationKey = await response.json();
  vkeyCache.set(circuitId, vkey);
  return vkey;
}

/**
 * Clear the verification key cache.
 */
export function clearVerificationKeyCache(): void {
  vkeyCache.clear();
}

// ============================================================================
// Client-Side Verification
// ============================================================================

/**
 * Verify a Groth16 proof locally in the browser using snarkjs.
 *
 * This is a client-side optimistic check. The proof should still be
 * verified on-chain via the ZKVerifier contract for authoritative
 * confirmation.
 *
 * @param zkProof - The complete ZK proof to verify
 * @returns A `ProofVerification` result
 *
 * @example
 * ```ts
 * const result = await verifyProofLocally(proof);
 * if (result.valid) {
 *   // Proceed to submit on-chain
 * }
 * ```
 */
export async function verifyProofLocally(
  zkProof: ZKProof,
): Promise<ProofVerification> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Check proof validity duration
    if (
      zkProof.validityDuration > 0 &&
      now > zkProof.generatedAt + zkProof.validityDuration
    ) {
      return {
        valid: false,
        proofHash: zkProof.proofHash,
        circuitId: zkProof.circuitId,
        verifiedAt: now,
        error: 'Proof has expired',
      };
    }

    // Load dependencies
    const [snarkjs, vkey] = await Promise.all([
      loadSnarkjs(),
      fetchVerificationKey(zkProof.circuitId),
    ]);

    // Convert our Groth16Proof into the format snarkjs expects
    const snarkjsProof = toSnarkjsProof(zkProof.proof);

    // Combine public inputs and outputs for verification
    const publicSignals = [...zkProof.publicInputs, ...zkProof.publicOutputs];

    // Run verification with a timeout
    const isValid = await withTimeout(
      snarkjs.groth16.verify(vkey, publicSignals, snarkjsProof) as Promise<boolean>,
      10_000,
      'Local proof verification timed out',
    );

    return {
      valid: isValid,
      proofHash: zkProof.proofHash,
      circuitId: zkProof.circuitId,
      verifiedAt: now,
      error: isValid ? undefined : 'Proof verification failed',
    };
  } catch (error) {
    return {
      valid: false,
      proofHash: zkProof.proofHash,
      circuitId: zkProof.circuitId,
      verifiedAt: now,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Verify a raw Groth16 proof against a specific circuit and public signals.
 * Lower-level than `verifyProofLocally` — use when you have the raw
 * components rather than a full `ZKProof` object.
 *
 * @param circuitId - The circuit identifier
 * @param proof - Raw Groth16 proof
 * @param publicSignals - Array of public input/output signals
 * @returns `true` if the proof is valid
 */
export async function verifyRawProof(
  circuitId: Bytes32,
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  const snarkjs = await loadSnarkjs();
  const vkey = await fetchVerificationKey(circuitId);
  const snarkjsProof = toSnarkjsProof(proof);

  return snarkjs.groth16.verify(vkey, publicSignals, snarkjsProof) as Promise<boolean>;
}

/**
 * Batch-verify multiple proofs. Returns results in the same order
 * as the input array. Individual proof failures do not prevent
 * other proofs from being verified.
 *
 * @param proofs - Array of ZK proofs to verify
 * @returns Array of verification results
 */
export async function verifyProofBatch(
  proofs: ZKProof[],
): Promise<ProofVerification[]> {
  return Promise.all(proofs.map((proof) => verifyProofLocally(proof)));
}

/**
 * Check whether a proof's public outputs indicate a successful
 * verification (e.g., ageVerified = 1, credentialValid = 1).
 *
 * @param zkProof - The proof to inspect
 * @returns `true` if all public outputs are truthy (non-zero)
 */
export function areOutputsTruthy(zkProof: ZKProof): boolean {
  return zkProof.publicOutputs.every(
    (output) => output !== '0' && output !== '',
  );
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert our `Groth16Proof` structure to the format snarkjs expects.
 */
function toSnarkjsProof(proof: Groth16Proof): {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
} {
  return {
    pi_a: [proof.a[0], proof.a[1], '1'],
    pi_b: [
      [proof.b[0][0], proof.b[0][1]],
      [proof.b[1][0], proof.b[1][1]],
      ['1', '0'],
    ],
    pi_c: [proof.c[0], proof.c[1], '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

/**
 * Dynamically import snarkjs to avoid bundling it in the initial chunk.
 */
async function loadSnarkjs(): Promise<typeof import('snarkjs')> {
  return import('snarkjs');
}
