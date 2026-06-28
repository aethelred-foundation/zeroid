/**
 * @jest-environment node
 */
import {
  createDisclosureEscrow,
  reconstituteDisclosure,
  shredShares,
} from "@/lib/aethelred/disclosure";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("conditional disclosure escrow", () => {
  it("round-trips: a quorum of threshold shares reconstitutes the payload", async () => {
    const payload = enc.encode("did:aethelred:alice|travel-rule-path");
    const escrow = await createDisclosureEscrow(payload, {
      threshold: 2,
      quorumSize: 3,
    });
    expect(escrow.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(escrow.shares).toHaveLength(3);

    const recovered = await reconstituteDisclosure(escrow, [
      escrow.shares[0],
      escrow.shares[2],
    ]);
    expect(dec.decode(recovered)).toBe("did:aethelred:alice|travel-rule-path");
  });

  it("fails reconstitution with fewer than threshold shares", async () => {
    const escrow = await createDisclosureEscrow(enc.encode("secret"), {
      threshold: 3,
      quorumSize: 5,
    });
    await expect(
      reconstituteDisclosure(escrow, [escrow.shares[0], escrow.shares[1]]),
    ).rejects.toThrow();
  });

  it("detects a tampered commitment", async () => {
    const escrow = await createDisclosureEscrow(enc.encode("x"), {
      threshold: 2,
      quorumSize: 2,
    });
    await expect(
      reconstituteDisclosure(
        { ...escrow, commitment: "00".repeat(32) },
        escrow.shares,
      ),
    ).rejects.toThrow(/commitment mismatch/);
  });

  it("key-shred erasure renders the payload permanently unrecoverable", async () => {
    const escrow = await createDisclosureEscrow(enc.encode("erase me"), {
      threshold: 2,
      quorumSize: 3,
    });
    shredShares(escrow.shares);
    await expect(
      reconstituteDisclosure(escrow, [escrow.shares[0], escrow.shares[1]]),
    ).rejects.toThrow();
  });
});
