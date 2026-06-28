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
 * Map a full ZeroID `ZKProof` to the canonical wire request. Public signals
 * are the concatenation of public inputs and public outputs (Groth16's public
 * signal vector), each encoded as a base64 32-byte field element.
 */
export function zkProofToVerifyRequest(
  zkProof: ZKProof,
  verifyingKeyHash: string,
): CanonicalVerifyRequest {
  const publicSignals = [...zkProof.publicInputs, ...zkProof.publicOutputs];
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
 */
export async function verifyZeroIdProofCanonical(
  zkProof: ZKProof,
  verifyingKeyHash: string,
): Promise<ProofVerification> {
  const now = Math.floor(Date.now() / 1000);
  const request = zkProofToVerifyRequest(zkProof, verifyingKeyHash);
  const res = await getVerificationModule().verifyZKProof(request);
  return {
    valid: res.valid,
    proofHash: zkProof.proofHash,
    circuitId: zkProof.circuitId,
    verifiedAt: now,
    error: res.error,
  };
}
