/**
 * ZeroID — Aethelred Conformance Boundary: TEE attestation
 *
 * Routes TEE attestation verification to the canonical chain verifier
 * (DCAP-backed, hardware-agnostic across the protocol's supported platforms)
 * via the SDK VerificationModule, replacing the simulated `crates/zeroid-tee`
 * verification.
 *
 * Activation gate (W3c): the chain verifies a raw DCAP `quote` + `pcrValues`,
 * which ZeroID's contract-view attestation does not yet carry. The TEE worker
 * must surface the raw quote before call sites are switched to this path.
 */

import { TEEPlatform, type TEEAttestation } from "@aethelred/sdk";
import { getVerificationModule } from "./client";

export interface VerifyTEEResult {
  valid: boolean;
  platform: TEEPlatform;
  enclaveHash?: string;
  error?: string;
}

const PLATFORM_MAP: Record<number, TEEPlatform> = {
  0: TEEPlatform.UNSPECIFIED,
  1: TEEPlatform.INTEL_SGX,
  2: TEEPlatform.AMD_SEV,
  3: TEEPlatform.ARM_TRUSTZONE,
};

/** Map ZeroID's numeric `TEEPlatform` to the canonical SDK enum. */
export function mapTeePlatform(zeroidPlatform: number): TEEPlatform {
  return PLATFORM_MAP[zeroidPlatform] ?? TEEPlatform.UNSPECIFIED;
}

/** Verify a TEE attestation on the canonical chain verifier. */
export async function verifyTeeAttestationCanonical(
  attestation: TEEAttestation,
  expectedEnclaveHash?: string,
): Promise<VerifyTEEResult> {
  const res = await getVerificationModule().verifyTEEAttestation(
    attestation,
    expectedEnclaveHash,
  );
  return {
    valid: res.valid,
    platform: res.platform,
    enclaveHash: res.enclaveHash,
    error: res.error,
  };
}
