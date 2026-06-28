/**
 * ZeroID — Aethelred Conformance Boundary: EZKL zkML liveness (Phase 2)
 *
 * Verifiable AI liveness on the canonical EZKL rail: verify a zero-knowledge
 * liveness inference on-chain (`proofSystem: EZKL`), optionally bind it to a
 * hardware DCAP attestation, and yield a single liveness decision. The proof
 * itself is produced by the EZKL pipeline (Phase 2b, gated on the toolchain);
 * this module is the verification + decision layer.
 *
 * Liveness output convention (consultant Doc 2): `publicInputs[0]` carries the
 * "liveness threshold clear" flag — field element `1` means live. The exact
 * index derives from the registered Circuit's output schema.
 */

import { ProofSystem, type TEEAttestation } from "@aethelred/sdk";
import { getVerificationModule } from "./client";
import { verifyTeeAttestationCanonical } from "./attestation";
import { encodePublicInput } from "./encoding";

/** Index of the liveness-threshold-clear flag in the public signal vector. */
const THRESHOLD_CLEAR_INDEX = 0;
/** Encoded field element `1` (threshold cleared). */
const THRESHOLD_CLEAR = encodePublicInput("1");

export interface LivenessProofInput {
  /** Base64 EZKL proof bytes. */
  proof: string;
  /** Public signals (base64 field elements); index 0 = threshold-clear flag. */
  publicInputs: string[];
  /** On-chain-registered EZKL verifying-key hash (base64). */
  verifyingKeyHash: string;
}

export interface LivenessVerification {
  /** Liveness decision: zk-verified AND threshold cleared. */
  live: boolean;
  /** Whether the zkML proof verified on-chain. */
  zkVerified: boolean;
  verificationTimeMs: number;
  error?: string;
}

export interface FullLivenessVerification extends LivenessVerification {
  /** Whether the DCAP attestation verified (false when none supplied). */
  teeVerified: boolean;
}

function thresholdCleared(publicInputs: string[]): boolean {
  return publicInputs[THRESHOLD_CLEAR_INDEX] === THRESHOLD_CLEAR;
}

/** Verify an EZKL zkML liveness proof on the canonical chain verifier. */
export async function verifyLivenessProof(
  input: LivenessProofInput,
): Promise<LivenessVerification> {
  const res = await getVerificationModule().verifyZKProof({
    proof: input.proof,
    publicInputs: input.publicInputs,
    verifyingKeyHash: input.verifyingKeyHash,
    proofSystem: ProofSystem.EZKL,
  });
  return {
    live: res.valid && thresholdCleared(input.publicInputs),
    zkVerified: res.valid,
    verificationTimeMs: res.verificationTimeMs,
    error: res.error,
  };
}

/**
 * Verify liveness with hardware binding: the zkML proof AND (when supplied) a
 * DCAP attestation that the inference ran in an approved enclave. When an
 * attestation is provided, `live` requires both — the full institutional claim.
 */
export async function verifyLivenessWithAttestation(
  input: LivenessProofInput,
  attestation?: TEEAttestation,
  expectedEnclaveHash?: string,
): Promise<FullLivenessVerification> {
  const zk = await verifyLivenessProof(input);
  if (!attestation) {
    return { ...zk, teeVerified: false };
  }
  const tee = await verifyTeeAttestationCanonical(attestation, expectedEnclaveHash);
  return {
    ...zk,
    teeVerified: tee.valid,
    live: zk.live && tee.valid,
  };
}
