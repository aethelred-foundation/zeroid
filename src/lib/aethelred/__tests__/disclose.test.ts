/**
 * @jest-environment node
 */
import { discloseIdentityPath } from "@/lib/aethelred/disclose";
import type { Address, Hex } from "viem";

describe("discloseIdentityPath (end-to-end)", () => {
  it("encrypts + key-splits off-chain and anchors the commitment on-chain", async () => {
    const runner = {
      address: "0xCD00000000000000000000000000000000000000" as Address,
      writeContract: jest.fn().mockResolvedValue("0xtx" as Hex),
      readContract: jest.fn(),
    };

    const result = await discloseIdentityPath(
      runner as never,
      "0xe1" as Hex,
      "0xn1" as Hex,
      new TextEncoder().encode("did:aethelred:alice|path"),
      { threshold: 2, quorumSize: 3 },
    );

    expect(result.escrow.shares).toHaveLength(3);
    expect(result.txHash).toBe("0xtx");
    expect(result.escrow.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(runner.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "registerEscrow",
        args: ["0xe1", `0x${result.escrow.commitment}`, "0xn1"],
      }),
    );
  });
});
