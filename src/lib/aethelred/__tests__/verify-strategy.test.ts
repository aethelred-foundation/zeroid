import { getVerifyingKeyHash, resetVkeyRegistry } from "@/lib/aethelred/vkeys";
import {
  isCanonicalVerifyEnabled,
  verifyProofPreferCanonical,
} from "@/lib/aethelred/verify";
import { verifyZeroIdProofCanonical } from "@/lib/aethelred/zk";
import type { ZKProof, ProofVerification } from "@/types";

jest.mock("@/lib/aethelred/zk");
const mockedCanonical = verifyZeroIdProofCanonical as jest.MockedFunction<
  typeof verifyZeroIdProofCanonical
>;

const ENV = process.env;
beforeEach(() => {
  jest.resetModules();
  resetVkeyRegistry();
  process.env = { ...ENV };
});
afterEach(() => {
  process.env = ENV;
  jest.clearAllMocks();
});

const zkProof = { circuitId: "0xage", proofHash: "0xh" } as unknown as ZKProof;
const fallbackResult: ProofVerification = {
  valid: true,
  proofHash: "0xh",
  circuitId: "0xage",
  verifiedAt: 1,
};
const fallback = jest.fn().mockResolvedValue(fallbackResult);

describe("getVerifyingKeyHash", () => {
  it("returns the registered hash from the env registry", () => {
    process.env.NEXT_PUBLIC_AETHELRED_VKEYS = JSON.stringify({
      "0xage": "VK64",
    });
    expect(getVerifyingKeyHash("0xage")).toBe("VK64");
  });
  it("returns null when the circuit is unregistered", () => {
    process.env.NEXT_PUBLIC_AETHELRED_VKEYS = JSON.stringify({});
    expect(getVerifyingKeyHash("0xage")).toBeNull();
  });
  it("returns null on malformed registry JSON", () => {
    process.env.NEXT_PUBLIC_AETHELRED_VKEYS = "{not json";
    expect(getVerifyingKeyHash("0xage")).toBeNull();
  });
});

describe("verifyProofPreferCanonical", () => {
  it("uses the bespoke fallback when the flag is off", async () => {
    delete process.env.NEXT_PUBLIC_CANONICAL_VERIFY;
    expect(isCanonicalVerifyEnabled()).toBe(false);
    const r = await verifyProofPreferCanonical(zkProof, fallback);
    expect(fallback).toHaveBeenCalledWith(zkProof);
    expect(mockedCanonical).not.toHaveBeenCalled();
    expect(r).toBe(fallbackResult);
  });

  it("uses canonical when enabled and the vkey is registered", async () => {
    process.env.NEXT_PUBLIC_CANONICAL_VERIFY = "true";
    process.env.NEXT_PUBLIC_AETHELRED_VKEYS = JSON.stringify({
      "0xage": "VK64",
    });
    mockedCanonical.mockResolvedValue({ ...fallbackResult, valid: true });
    await verifyProofPreferCanonical(zkProof, fallback);
    expect(mockedCanonical).toHaveBeenCalledWith(zkProof, "VK64");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when enabled but the vkey is not registered", async () => {
    process.env.NEXT_PUBLIC_CANONICAL_VERIFY = "true";
    process.env.NEXT_PUBLIC_AETHELRED_VKEYS = JSON.stringify({});
    await verifyProofPreferCanonical(zkProof, fallback);
    expect(fallback).toHaveBeenCalledWith(zkProof);
    expect(mockedCanonical).not.toHaveBeenCalled();
  });
});
