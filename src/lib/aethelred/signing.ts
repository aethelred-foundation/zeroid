/**
 * ZeroID — Aethelred Conformance Boundary: PQC hybrid signing
 *
 * Augments ZeroID's classical wallet ECDSA signature with a post-quantum
 * ML-DSA-65 signature (defense-in-depth hybrid) using the canonical SDK PQC
 * provider. ZeroID never re-implements either primitive: ECDSA comes from the
 * wallet, ML-DSA-65 from the injected `PQCProvider`.
 *
 * Activation gate (W4c): a real ML-DSA-65 backend must be injected via
 * `configurePQCProvider`; until then signing falls back to classical ECDSA.
 */

import {
  configurePQCProvider,
  getPQCProvider,
  hasConfiguredPQCProvider,
  toHex,
  type PQCProvider,
  type SignatureAlgorithm,
} from "@aethelred/sdk/crypto";

/** Canonical PQC signature algorithm (security level 3, paired with ML-KEM-768). */
export const PQC_SIGNATURE_ALGORITHM: SignatureAlgorithm = "ML-DSA-65";

export interface HybridSignature {
  /** Hybrid (classical + PQC) or classical-only. */
  scheme: "hybrid-mldsa65-ecdsa" | "ecdsa";
  /** Classical ECDSA signature (hex) — produced by ZeroID's wallet. */
  classical: string;
  /** ML-DSA-65 signature (hex) — present only for the hybrid scheme. */
  pqc?: string;
}

/** Whether PQC hybrid signing is enabled. */
export function isPqcSigningEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PQC_SIGNING === "true";
}

/**
 * Produce a signature envelope. Hybrid (ECDSA + ML-DSA-65) when PQC is enabled,
 * a backend is configured, and a PQC secret key is supplied; otherwise the
 * classical ECDSA signature alone.
 */
export async function signHybrid(
  message: Uint8Array,
  classicalSignature: string,
  pqcSecretKey?: Uint8Array,
): Promise<HybridSignature> {
  if (isPqcSigningEnabled() && hasConfiguredPQCProvider() && pqcSecretKey) {
    const signature = await getPQCProvider().sign(
      message,
      pqcSecretKey,
      PQC_SIGNATURE_ALGORITHM,
    );
    return {
      scheme: "hybrid-mldsa65-ecdsa",
      classical: classicalSignature,
      pqc: toHex(signature),
    };
  }
  return { scheme: "ecdsa", classical: classicalSignature };
}

export { configurePQCProvider, hasConfiguredPQCProvider };
export type { PQCProvider };
