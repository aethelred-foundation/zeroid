/**
 * ZeroID — Aethelred Conformance Boundary: ZK verification
 *
 * Routes ZeroID proof verification to the canonical on-chain ZK verifier
 * (Groth16 / PLONK / EZKL over BN254) via the SDK VerificationModule, instead
 * of bespoke snarkjs runtime verification or a ZeroID-owned verifier contract.
 */

import { getVerificationModule } from "./client";

export interface ZeroIdProofInput {
  proof: string;
  publicInputs: string[];
  verifyingKeyHash: string;
}

export interface CanonicalVerifyResult {
  valid: boolean;
  verificationTimeMs: number;
  error?: string;
}

/** Verify a ZeroID proof on the canonical Aethelred ZK verifier. */
export async function verifyZkProofCanonical(
  input: ZeroIdProofInput,
): Promise<CanonicalVerifyResult> {
  const verification = getVerificationModule();
  const res = await verification.verifyZKProof({
    proof: input.proof,
    publicInputs: input.publicInputs,
    verifyingKeyHash: input.verifyingKeyHash,
  });
  return {
    valid: res.valid,
    verificationTimeMs: res.verificationTimeMs,
    error: res.error,
  };
}
