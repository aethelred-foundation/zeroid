/**
 * ZeroID — Aethelred Conformance Boundary (public surface)
 *
 * All canonical chain access (verification, seals, attestation, signing)
 * flows through this module. This is the reusable conformance template for
 * the other Aethelred dApps (Cruzible, TerraQura, NoblePay, Shiora).
 */

export {
  getAethelredClient,
  getVerificationModule,
  getSealsModule,
  resetAethelredClient,
} from "./client";

export {
  verifyZkProofCanonical,
  zkProofToVerifyRequest,
  verifyZeroIdProofCanonical,
  type ZeroIdProofInput,
  type CanonicalVerifyResult,
  type CanonicalVerifyRequest,
} from "./zk";

export {
  fieldElementToBytes,
  toBase64,
  encodePublicInput,
  serializeGroth16ProofUncompressed,
  type RawGroth16Proof,
} from "./encoding";

export { getVerifyingKeyHash, resetVkeyRegistry } from "./vkeys";
export { isCanonicalVerifyEnabled, verifyProofPreferCanonical } from "./verify";

export {
  mapTeePlatform,
  verifyTeeAttestationCanonical,
  type VerifyTEEResult,
} from "./attestation";

export {
  createDigitalSeal,
  verifyDigitalSeal,
  getDigitalSeal,
} from "./seals";

export {
  verifyLivenessProof,
  verifyLivenessWithAttestation,
  type LivenessProofInput,
  type LivenessVerification,
  type FullLivenessVerification,
} from "./liveness";

export {
  createDisclosureEscrow,
  reconstituteDisclosure,
  shredShares,
  type DisclosurePolicy,
  type DisclosureEscrow,
} from "./disclosure";

export { splitSecret, combineShares, type Share } from "./shamir";

export {
  conditionalDisclosureAbi,
  commitmentToBytes32,
  registerEscrowOnChain,
  requestDisclosureOnChain,
  approveDisclosureOnChain,
  isDisclosureAuthorizedOnChain,
  eraseEscrowOnChain,
  type DisclosureContractRunner,
  type RegisterEscrowParams,
} from "./disclosure-contract";

export {
  isPqcSigningEnabled,
  signHybrid,
  configurePQCProvider,
  hasConfiguredPQCProvider,
  PQC_SIGNATURE_ALGORITHM,
  type HybridSignature,
  type PQCProvider,
} from "./signing";

// React hooks are intentionally NOT re-exported here: they are client-only
// (`"use client"`). Import them directly from "@/lib/aethelred/react".
