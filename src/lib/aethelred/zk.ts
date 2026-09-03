/**
 * ZeroID — Aethelred Conformance Boundary: ZK verification
 *
 * Routes ZeroID proof verification to the canonical on-chain ZK verifier
 * (Groth16 / PLONK / EZKL over BN254) via the SDK VerificationModule, instead
 * of bespoke snarkjs runtime verification or a ZeroID-owned verifier contract.
 */

import { ProofSystem } from "@aethelred/sdk";
import { getVerificationModule } from "./client";
import {
  encodePublicInput,
  serializeGroth16ProofUncompressed,
} from "./encoding";
import { CIRCUITS } from "@/config/constants";
import { checkPredicateOutputs, orderPublicSignals } from "@/lib/zk/signals";
import type { ZKProof, ProofVerification } from "@/types";

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

/** Canonical ZK verification request (mirrors the SDK VerifyZKProofRequest). */
export interface CanonicalVerifyRequest {
  proof: string;
  publicInputs: string[];
  verifyingKeyHash: string;
  proofSystem: ProofSystem;
}

/**
 * Map a full ZeroID `ZKProof` to the canonical wire request. Public signals are
 * Groth16's public-signal vector in the order circom emits it — public OUTPUTS
 * first, then public inputs — each encoded as a base64 32-byte field element.
 */
export function zkProofToVerifyRequest(
  zkProof: ZKProof,
  verifyingKeyHash: string,
): CanonicalVerifyRequest {
  const publicSignals = orderPublicSignals(zkProof);
  return {
    proof: serializeGroth16ProofUncompressed(zkProof.proof),
    publicInputs: publicSignals.map(encodePublicInput),
    verifyingKeyHash,
    proofSystem: ProofSystem.GROTH16,
  };
}

/**
 * Verify a full ZeroID `ZKProof` on the canonical Aethelred verifier and
 * return ZeroID's `ProofVerification` shape — a drop-in replacement for the
 * bespoke `verifyProofLocally` (snarkjs) path.
 *
 * The chain verifier answers "does this proof verify against the registered
 * key", which is not the same question as "does the predicate hold": these
 * circuits publish their outcome as a public output rather than asserting it,
 * so a proof carrying `ageVerified = 0` verifies on-chain too. The predicate is
 * enforced here as well, so both verification paths refuse the same proofs.
 */
export async function verifyZeroIdProofCanonical(
  zkProof: ZKProof,
  verifyingKeyHash: string,
): Promise<ProofVerification> {
  const now = Math.floor(Date.now() / 1000);
  const request = zkProofToVerifyRequest(zkProof, verifyingKeyHash);
  const res = await getVerificationModule().verifyZKProof(request);
  if (!res.valid) {
    return {
      valid: false,
      proofHash: zkProof.proofHash,
      circuitId: zkProof.circuitId,
      verifiedAt: now,
      error: res.error,
    };
  }

  const predicate = checkPredicateOutputs(zkProof, CIRCUITS[zkProof.circuitId]);
  return {
    valid: predicate.satisfied,
    proofHash: zkProof.proofHash,
    circuitId: zkProof.circuitId,
    verifiedAt: now,
    error: predicate.satisfied
      ? res.error
      : (predicate.reason ?? "Proof predicate not satisfied"),
  };
}
