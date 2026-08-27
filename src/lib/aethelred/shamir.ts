/**
 * ZeroID — Aethelred Conformance Boundary: Shamir Secret Sharing (GF(256))
 *
 * The cryptographic core of the FATF travel-rule "asymmetric key-split escrow":
 * a disclosure key is split into `shares` pieces such that any `threshold` of
 * them reconstruct it, and fewer reveal nothing. Shares are held by the
 * compliance quorum; reconstitution requires a warrant-authorised quorum.
 *
 * GF(256) with the AES irreducible polynomial 0x11B and generator 3.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by generator 3 = xtime(x) ^ x
    const xtime = ((x << 1) & 0xff) ^ (x & 0x80 ? 0x1b : 0);
    x = xtime ^ x;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

export interface Share {
  /** Share index (x-coordinate), 1..255. */
  x: number;
  /** Share value per secret byte. */
  y: Uint8Array;
}

/** Split a secret into `shares` pieces; any `threshold` reconstruct it. */
export function splitSecret(
  secret: Uint8Array,
  threshold: number,
  shares: number,
): Share[] {
  if (threshold < 2 || shares < threshold || shares > 255) {
    throw new Error(
      "invalid threshold/shares (need 2<=threshold<=shares<=255)",
    );
  }
  if (secret.length === 0) {
    throw new Error("splitSecret: empty secret");
  }
  const out: Share[] = [];
  for (let x = 1; x <= shares; x++) {
    out.push({ x, y: new Uint8Array(secret.length) });
  }
  const randomCoeffs = new Uint8Array(threshold - 1);
  for (let i = 0; i < secret.length; i++) {
    crypto.getRandomValues(randomCoeffs);
    for (const share of out) {
      // Horner evaluation of the degree-(threshold-1) polynomial at x=share.x,
      // with constant term = secret byte.
      let y = randomCoeffs[threshold - 2] ?? 0;
      for (let k = threshold - 3; k >= 0; k--) {
        y = gfMul(y, share.x) ^ randomCoeffs[k];
      }
      y = gfMul(y, share.x) ^ secret[i];
      share.y[i] = y;
    }
  }
  return out;
}

/** Reconstruct the secret from `threshold` (or more) shares via Lagrange at 0. */
export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length === 0) {
    throw new Error("combineShares: no shares provided");
  }
  const len = shares[0].y.length;
  const seenX = new Set<number>();
  for (const share of shares) {
    if (!Number.isInteger(share.x) || share.x < 1 || share.x > 255) {
      throw new Error(
        `combineShares: invalid share index ${share.x} (must be 1..255)`,
      );
    }
    if (seenX.has(share.x)) {
      // Duplicate x-coordinates make the Lagrange denominator (x_j ^ x_m) zero.
      throw new Error(`combineShares: duplicate share index ${share.x}`);
    }
    seenX.add(share.x);
    if (share.y.length !== len) {
      throw new Error("combineShares: inconsistent share length");
    }
  }
  const secret = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (let j = 0; j < shares.length; j++) {
      // Lagrange basis at 0: prod_{m!=j} x_m / (x_j ^ x_m)
      let num = 1;
      let den = 1;
      for (let m = 0; m < shares.length; m++) {
        if (m === j) continue;
        num = gfMul(num, shares[m].x);
        den = gfMul(den, shares[j].x ^ shares[m].x);
      }
      acc ^= gfMul(shares[j].y[i], gfDiv(num, den));
    }
    secret[i] = acc;
  }
  return secret;
}
