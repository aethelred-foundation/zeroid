/**
 * ZeroID — Aethelred Conformance Boundary: canonical ZK wire encoding
 *
 * Converts snarkjs/Circom Groth16 proof material (decimal field-element
 * strings) into the canonical Aethelred wire format consumed by the chain's
 * ZK verification precompile, as defined by:
 *   - aethelred `proto/aethelred/verify/v1/verify.proto` (ZKMLProof)
 *   - aethelred `sdk/spec/openapi.yaml` (VerifyZKProofRequest)
 *
 * Wire format: every BN254 field element is a fixed 32-byte big-endian value;
 * `proof`, each `publicInput`, and `verifyingKeyHash` are base64-encoded bytes.
 *
 * CAVEAT (resolved in W2c against a live node): the G2 Fp2 limb order and point
 * compression below use the snarkjs convention. The chain's arkworks
 * `CanonicalDeserialize` may expect swapped Fp2 limbs and/or compressed points.
 * This serialization is structurally correct (256 uncompressed bytes) but its
 * byte-exact acceptance MUST be confirmed by a live-node equivalence test
 * before the bespoke snarkjs path is removed.
 */

const FIELD_BYTES = 32;

/** Encode a non-negative decimal field element as a 32-byte big-endian array. */
export function fieldElementToBytes(decimal: string): Uint8Array {
  let v = BigInt(decimal);
  if (v < 0n) {
    throw new Error(`field element must be non-negative: ${decimal}`);
  }
  const out = new Uint8Array(FIELD_BYTES);
  for (let i = FIELD_BYTES - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new Error(`field element exceeds 32 bytes: ${decimal}`);
  }
  return out;
}

/** Base64-encode a byte array (Node Buffer or browser btoa). */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Encode a single public signal as base64 of a 32-byte big-endian element. */
export function encodePublicInput(decimal: string): string {
  return toBase64(fieldElementToBytes(decimal));
}

export interface RawGroth16Proof {
  /** Point A on G1: [x, y] */
  a: [string, string];
  /** Point B on G2: [[x.c0, x.c1], [y.c0, y.c1]] */
  b: [[string, string], [string, string]];
  /** Point C on G1: [x, y] */
  c: [string, string];
}

/**
 * Serialize a Groth16 proof as base64 of 256 uncompressed bytes:
 * G1(A)=64 ‖ G2(B)=128 ‖ G1(C)=64, each coordinate a 32-byte BE field element.
 */
export function serializeGroth16ProofUncompressed(
  proof: RawGroth16Proof,
): string {
  const elements: string[] = [
    proof.a[0],
    proof.a[1],
    proof.b[0][0],
    proof.b[0][1],
    proof.b[1][0],
    proof.b[1][1],
    proof.c[0],
    proof.c[1],
  ];
  const out = new Uint8Array(elements.length * FIELD_BYTES);
  elements.forEach((el, i) => out.set(fieldElementToBytes(el), i * FIELD_BYTES));
  return toBase64(out);
}
