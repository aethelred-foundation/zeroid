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
  type ZeroIdProofInput,
  type CanonicalVerifyResult,
} from "./zk";
