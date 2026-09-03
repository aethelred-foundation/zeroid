import {
  zkProofToVerifyRequest,
  verifyZeroIdProofCanonical,
} from "@/lib/aethelred/zk";
import { getVerificationModule } from "@/lib/aethelred/client";
import { ProofSystem } from "@aethelred/sdk";
import { encodePublicInput } from "@/lib/aethelred/encoding";
import { CIRCUIT_IDS } from "@/config/constants";
import type { ZKProof } from "@/types";

jest.mock("@/lib/aethelred/client");
const mockedGetVerificationModule =
  getVerificationModule as jest.MockedFunction<typeof getVerificationModule>;

function makeZkProof(overrides: Partial<ZKProof> = {}): ZKProof {
  return {
    id: "p1",
    circuitId: CIRCUIT_IDS.AGE_PROOF,
    circuitName: "Age Proof",
    proof: {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    },
    // age_proof publishes [ageVerified, credentialValid] before its three
    // public inputs.
    publicInputs: ["10", "1710460800", "999"],
    publicOutputs: ["1", "1"],
    generatedAt: 1000,
    validityDuration: 0,
    proofHash: "0xhash",
    ...overrides,
  } as unknown as ZKProof;
}

describe("zkProofToVerifyRequest", () => {
  it("maps a ZeroID proof to the canonical wire request", () => {
    const req = zkProofToVerifyRequest(makeZkProof(), "VKHASH");
    expect(req.proofSystem).toBe(ProofSystem.GROTH16);
    expect(req.verifyingKeyHash).toBe("VKHASH");
    // circom order: public OUTPUTS first, then public inputs.
    expect(req.publicInputs).toEqual([
      encodePublicInput("1"),
      encodePublicInput("1"),
      encodePublicInput("10"),
      encodePublicInput("1710460800"),
      encodePublicInput("999"),
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
      expect.objectContaining({
        proofSystem: ProofSystem.GROTH16,
        verifyingKeyHash: "VKHASH",
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.circuitId).toBe(CIRCUIT_IDS.AGE_PROOF);
    expect(result.proofHash).toBe("0xhash");
  });

  it("refuses a chain-valid proof whose predicate output is 0", async () => {
    // The chain verifier answers "does this verify against the registered
    // key", not "does the predicate hold" — age_proof never asserts
    // ageVerified, so both questions have to be asked.
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: true, verificationTimeMs: 5 });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZeroIdProofCanonical(
      makeZkProof({ publicOutputs: ["0", "1"] }),
      "VKHASH",
    );

    expect(verifyZKProof).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ageVerified");
  });

  it("refuses a chain-valid proof for a circuit outside the registry", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: true, verificationTimeMs: 5 });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZeroIdProofCanonical(
      makeZkProof({ circuitId: "0xnotregistered" as ZKProof["circuitId"] }),
      "VKHASH",
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unknown circuit");
  });

  it("propagates an invalid result and its error", async () => {
    const verifyZKProof = jest.fn().mockResolvedValue({
      valid: false,
      verificationTimeMs: 1,
      error: "nope",
    });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZeroIdProofCanonical(makeZkProof(), "VKHASH");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("nope");
  });
});
