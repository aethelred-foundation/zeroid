/**
 * ZeroID — Aethelred Conformance Boundary: conditional disclosure escrow
 *
 * FATF travel-rule "asymmetric key-split escrow". A disclosure payload (e.g. a
 * cross-border identity path) is AEAD-encrypted; the key is Shamir-split among
 * a compliance quorum; only a `sha256(ciphertext)` commitment is anchored
 * on-chain as a Digital Seal (zero PII). Disclosure requires a warrant-
 * authorised quorum of `threshold` shares. Destroying the shares (key-shred)
 * renders the on-chain commitment permanently un-linkable — satisfying
 * GDPR / ADGM DPR-2021 erasure on an immutable ledger.
 *
 * Complements ZeroID's on-chain `ThresholdCredential` (the quorum authority)
 * and uses the boundary's `createDigitalSeal` to anchor the commitment.
 */

import { splitSecret, combineShares, type Share } from "./shamir";

export interface DisclosurePolicy {
  /** Shares required to reconstitute (the quorum threshold). */
  threshold: number;
  /** Total shares distributed to the compliance quorum. */
  quorumSize: number;
}

export interface DisclosureEscrow {
  /** sha256(ciphertext) hex — the only value anchored on-chain (the Seal commitment). */
  commitment: string;
  /** AEAD ciphertext of the disclosure payload. */
  ciphertext: Uint8Array;
  /** AES-GCM nonce. */
  iv: Uint8Array;
  /** Key shares for the compliance quorum. */
  shares: Share[];
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Create an escrow: encrypt the payload, split the key, commit the ciphertext. */
export async function createDisclosureEscrow(
  payload: Uint8Array,
  policy: DisclosurePolicy,
): Promise<DisclosureEscrow> {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      payload as BufferSource,
    ),
  );

  const commitment = await sha256Hex(ciphertext);
  const shares = splitSecret(keyBytes, policy.threshold, policy.quorumSize);
  return { commitment, ciphertext, iv, shares };
}

/** Reconstitute the payload from a warrant-authorised quorum of shares. */
export async function reconstituteDisclosure(
  escrow: Pick<DisclosureEscrow, "commitment" | "ciphertext" | "iv">,
  shares: Share[],
): Promise<Uint8Array> {
  const recomputed = await sha256Hex(escrow.ciphertext);
  if (recomputed !== escrow.commitment) {
    throw new Error("disclosure commitment mismatch");
  }
  const keyBytes = combineShares(shares);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: escrow.iv as BufferSource },
        key,
        escrow.ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new Error(
      "disclosure reconstitution failed: insufficient or invalid quorum shares",
    );
  }
}

/** Key-shred erasure: zero the share material so the payload can never be recovered. */
export function shredShares(shares: Share[]): void {
  for (const share of shares) share.y.fill(0);
}
