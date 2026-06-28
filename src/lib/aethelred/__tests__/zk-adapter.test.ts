import {
  zkProofToVerifyRequest,
  verifyZeroIdProofCanonical,
} from "@/lib/aethelred/zk";
import { getVerificationModule } from "@/lib/aethelred/client";
import { ProofSystem } from "@aethelred/sdk";
import { encodePublicInput } from "@/lib/aethelred/encoding";
import type { ZKProof } from "@/types";

jest.mock("@/lib/aethelred/client");
const mockedGetVerificationModule =
  getVerificationModule as jest.MockedFunction<typeof getVerificationModule>;

function makeZkProof(): ZKProof {
  return {
    id: "p1",
    circuitId: "0xcircuit",
    circuitName: "age",
    proof: {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    },
    publicInputs: ["10"],
    publicOutputs: ["1"],
    generatedAt: 1000,
    validityDuration: 0,
    proofHash: "0xhash",
  } as unknown as ZKProof;
}

describe("zkProofToVerifyRequest", () => {
  it("maps a ZeroID proof to the canonical wire request", () => {
    const req = zkProofToVerifyRequest(makeZkProof(), "VKHASH");
    expect(req.proofSystem).toBe(ProofSystem.GROTH16);
    expect(req.verifyingKeyHash).toBe("VKHASH");
    expect(req.publicInputs).toEqual([
      encodePublicInput("10"),
      encodePublicInput("1"),
    ]);
    expect(Buffer.from(req.proof, "base64").length).toBe(256);
  });
});

describe("verifyZeroIdProofCanonical", () => {
  afterEach(() => jest.clearAllMocks());

  it("verifies via the canonical module and returns a ProofVerification", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: true, verificationTimeMs: 5 });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZeroIdProofCanonical(makeZkProof(), "VKHASH");

    expect(verifyZKProof).toHaveBeenCalledWith(
      expect.objectContaining({ proofSystem: ProofSystem.GROTH16, verifyingKeyHash: "VKHASH" }),
    );
    expect(result.valid).toBe(true);
    expect(result.circuitId).toBe("0xcircuit");
    expect(result.proofHash).toBe("0xhash");
  });

  it("propagates an invalid result and its error", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: false, verificationTimeMs: 1, error: "nope" });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZeroIdProofCanonical(makeZkProof(), "VKHASH");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("nope");
  });
});
