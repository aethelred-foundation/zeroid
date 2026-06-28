/**
 * ZeroID — Aethelred Conformance Boundary: verification strategy
 *
 * Prefers the canonical on-chain verifier when (a) enabled via
 * `NEXT_PUBLIC_CANONICAL_VERIFY` and (b) the circuit's verifying key is
 * registered on-chain. Otherwise falls back to the caller-supplied bespoke
 * verifier. This is the strangler-fig seam: the bespoke snarkjs path is
 * retained as the fallback until the W2c live-node equivalence gate passes.
 */

import type { ZKProof, ProofVerification } from "@/types";
import { verifyZeroIdProofCanonical } from "./zk";
import { getVerifyingKeyHash } from "./vkeys";

/** Whether canonical on-chain verification is enabled. */
export function isCanonicalVerifyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CANONICAL_VERIFY === "true";
}

/**
 * Verify a proof, preferring the canonical verifier when available, falling
 * back to `fallback` (the bespoke verifier) otherwise.
 */
export async function verifyProofPreferCanonical(
  zkProof: ZKProof,
  fallback: (proof: ZKProof) => Promise<ProofVerification>,
): Promise<ProofVerification> {
  if (isCanonicalVerifyEnabled()) {
    const verifyingKeyHash = getVerifyingKeyHash(zkProof.circuitId);
    if (verifyingKeyHash) {
      return verifyZeroIdProofCanonical(zkProof, verifyingKeyHash);
    }
  }
  return fallback(zkProof);
}
