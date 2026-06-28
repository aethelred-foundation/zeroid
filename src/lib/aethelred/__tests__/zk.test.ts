import { verifyZkProofCanonical } from "@/lib/aethelred/zk";
import { getVerificationModule } from "@/lib/aethelred/client";

jest.mock("@/lib/aethelred/client");

const mockedGetVerificationModule =
  getVerificationModule as jest.MockedFunction<typeof getVerificationModule>;

describe("verifyZkProofCanonical", () => {
  afterEach(() => jest.clearAllMocks());

  it("maps ZeroID proof input to the SDK request and returns the result", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: true, verificationTimeMs: 12 });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZkProofCanonical({
      proof: "0xabc",
      publicInputs: ["1", "0"],
      verifyingKeyHash: "0xvk",
    });

    expect(verifyZKProof).toHaveBeenCalledWith({
      proof: "0xabc",
      publicInputs: ["1", "0"],
      verifyingKeyHash: "0xvk",
    });
    expect(result.valid).toBe(true);
    expect(result.verificationTimeMs).toBe(12);
  });

  it("propagates an invalid result with its error", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: false, verificationTimeMs: 3, error: "bad proof" });
    mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZkProofCanonical({
      proof: "0x00",
      publicInputs: [],
      verifyingKeyHash: "0xvk",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("bad proof");
  });
});
