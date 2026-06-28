import {
  conditionalDisclosureAbi,
  commitmentToBytes32,
  registerEscrowOnChain,
  requestDisclosureOnChain,
  approveDisclosureOnChain,
  isDisclosureAuthorizedOnChain,
  eraseEscrowOnChain,
  type DisclosureContractRunner,
} from "@/lib/aethelred/disclosure-contract";
import type { Address, Hex } from "viem";

function makeRunner() {
  return {
    address: "0xCD00000000000000000000000000000000000000" as Address,
    writeContract: jest.fn().mockResolvedValue("0xtxhash" as Hex),
    readContract: jest.fn().mockResolvedValue(true),
  };
}

const escrowId = "0xe1" as Hex;
const commitment = "0xc1" as Hex;
const nullifier = "0xn1" as Hex;
const warrant = "0xw1" as Hex;

describe("ConditionalDisclosure contract client", () => {
  it("commitmentToBytes32 ensures a 0x prefix on a hex digest", () => {
    expect(commitmentToBytes32("aabb")).toBe("0xaabb");
    expect(commitmentToBytes32("0xaabb")).toBe("0xaabb");
  });

  it("exposes a typed ABI with the expected functions", () => {
    for (const fn of [
      "registerEscrow",
      "requestDisclosure",
      "approveDisclosure",
      "isDisclosureAuthorized",
      "eraseEscrow",
    ]) {
      expect(conditionalDisclosureAbi.some((x) => x.name === fn)).toBe(true);
    }
  });

  it("registerEscrowOnChain calls registerEscrow with the right args", async () => {
    const runner = makeRunner();
    const tx = await registerEscrowOnChain(runner as DisclosureContractRunner, {
      escrowId,
      commitment,
      subjectNullifier: nullifier,
    });
    expect(runner.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: runner.address,
        functionName: "registerEscrow",
        args: [escrowId, commitment, nullifier],
      }),
    );
    expect(tx).toBe("0xtxhash");
  });

  it("requestDisclosureOnChain passes escrowId + warrant", async () => {
    const runner = makeRunner();
    await requestDisclosureOnChain(runner as DisclosureContractRunner, escrowId, warrant);
    expect(runner.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "requestDisclosure", args: [escrowId, warrant] }),
    );
  });

  it("approveDisclosureOnChain passes escrowId", async () => {
    const runner = makeRunner();
    await approveDisclosureOnChain(runner as DisclosureContractRunner, escrowId);
    expect(runner.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "approveDisclosure", args: [escrowId] }),
    );
  });

  it("isDisclosureAuthorizedOnChain reads the bool result", async () => {
    const runner = makeRunner();
    runner.readContract.mockResolvedValue(true);
    const ok = await isDisclosureAuthorizedOnChain(
      runner as DisclosureContractRunner,
      escrowId,
    );
    expect(runner.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "isDisclosureAuthorized", args: [escrowId] }),
    );
    expect(ok).toBe(true);
  });

  it("eraseEscrowOnChain calls eraseEscrow", async () => {
    const runner = makeRunner();
    await eraseEscrowOnChain(runner as DisclosureContractRunner, escrowId);
    expect(runner.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "eraseEscrow", args: [escrowId] }),
    );
  });
});
