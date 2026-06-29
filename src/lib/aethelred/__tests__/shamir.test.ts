import { splitSecret, combineShares } from "@/lib/aethelred/shamir";

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

describe("Shamir GF(256) secret sharing", () => {
  it("reconstructs the secret from exactly threshold shares", () => {
    const secret = new Uint8Array([1, 2, 3, 42, 255, 0, 128]);
    const shares = splitSecret(secret, 3, 5);
    expect(shares).toHaveLength(5);
    const recon = combineShares([shares[0], shares[2], shares[4]]);
    expect(Array.from(recon)).toEqual(Array.from(secret));
  });

  it("reconstructs from any subset of threshold shares (subsets agree)", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, 3, 6);
    const a = combineShares([shares[0], shares[1], shares[2]]);
    const b = combineShares([shares[3], shares[4], shares[5]]);
    expect(Array.from(a)).toEqual(Array.from(secret));
    expect(Array.from(b)).toEqual(Array.from(secret));
  });

  it("does NOT reconstruct from fewer than threshold shares", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, 3, 5);
    const recon = combineShares([shares[0], shares[1]]); // 2 < 3
    expect(Array.from(recon)).not.toEqual(Array.from(secret));
  });

  it("supports 2-of-2 and 5-of-5 edge thresholds", () => {
    const secret = randomBytes(16);
    expect(Array.from(combineShares(splitSecret(secret, 2, 2)))).toEqual(
      Array.from(secret),
    );
    expect(Array.from(combineShares(splitSecret(secret, 5, 5)))).toEqual(
      Array.from(secret),
    );
  });

  it("rejects invalid threshold/share parameters", () => {
    expect(() => splitSecret(new Uint8Array([1]), 1, 3)).toThrow();
    expect(() => splitSecret(new Uint8Array([1]), 4, 3)).toThrow();
    expect(() => splitSecret(new Uint8Array([1]), 2, 256)).toThrow();
  });

  it("rejects an empty secret", () => {
    expect(() => splitSecret(new Uint8Array([]), 2, 3)).toThrow(/empty/);
  });

  it("combineShares rejects no shares, duplicate/invalid indices, and length mismatch", () => {
    const shares = splitSecret(new Uint8Array([1, 2, 3]), 2, 4);
    expect(() => combineShares([])).toThrow(/no shares/);
    expect(() => combineShares([shares[0], shares[0]])).toThrow(/duplicate/);
    expect(() => combineShares([{ x: 0, y: new Uint8Array(3) }, shares[1]])).toThrow(/invalid share index/);
    expect(() =>
      combineShares([shares[0], { x: 9, y: new Uint8Array(2) }]),
    ).toThrow(/inconsistent share length/);
  });

  it("property: reconstructs across many random secrets/thresholds/subsets", () => {
    for (let iter = 0; iter < 60; iter++) {
      const n = 2 + Math.floor(Math.random() * 8); // 2..9 shares
      const t = 2 + Math.floor(Math.random() * (n - 1)); // 2..n threshold
      const len = 1 + Math.floor(Math.random() * 48);
      const secret = randomBytes(len);
      const shares = splitSecret(secret, t, n);

      // a random subset of exactly t distinct shares reconstructs
      const pool = [...shares];
      const subset: typeof shares = [];
      for (let k = 0; k < t; k++) {
        subset.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      expect(Array.from(combineShares(subset))).toEqual(Array.from(secret));
    }
  });
});
