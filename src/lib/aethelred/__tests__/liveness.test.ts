import {
  verifyLivenessProof,
  verifyLivenessWithAttestation,
} from "@/lib/aethelred/liveness";
import { getVerificationModule } from "@/lib/aethelred/client";
import { verifyTeeAttestationCanonical } from "@/lib/aethelred/attestation";
import { encodePublicInput } from "@/lib/aethelred/encoding";
import { ProofSystem } from "@aethelred/sdk";

jest.mock("@/lib/aethelred/client");
jest.mock("@/lib/aethelred/attestation");

const mockedGetVerificationModule =
  getVerificationModule as jest.MockedFunction<typeof getVerificationModule>;
const mockedVerifyTee = verifyTeeAttestationCanonical as jest.MockedFunction<
  typeof verifyTeeAttestationCanonical
>;

const LIVE = encodePublicInput("1");
const NOT_LIVE = encodePublicInput("0");

function mockZk(result: {
  valid: boolean;
  verificationTimeMs: number;
  error?: string;
}) {
  const verifyZKProof = jest.fn().mockResolvedValue(result);
  mockedGetVerificationModule.mockReturnValue({ verifyZKProof } as never);
  return verifyZKProof;
}

afterEach(() => jest.clearAllMocks());

describe("verifyLivenessProof", () => {
  const input = { proof: "p", publicInputs: [LIVE], verifyingKeyHash: "vk" };

  it("is live when the EZKL proof verifies and the threshold is cleared", async () => {
    const verifyZKProof = mockZk({ valid: true, verificationTimeMs: 30 });
    const r = await verifyLivenessProof(input);
    expect(verifyZKProof).toHaveBeenCalledWith(
      expect.objectContaining({
        proofSystem: ProofSystem.EZKL,
        verifyingKeyHash: "vk",
      }),
    );
    expect(r.zkVerified).toBe(true);
    expect(r.live).toBe(true);
  });

  it("is not live when the threshold is not cleared, even if the proof verifies", async () => {
    mockZk({ valid: true, verificationTimeMs: 5 });
    const r = await verifyLivenessProof({ ...input, publicInputs: [NOT_LIVE] });
    expect(r.zkVerified).toBe(true);
    expect(r.live).toBe(false);
  });

  it("is not live and surfaces the error when the proof fails", async () => {
    mockZk({ valid: false, verificationTimeMs: 1, error: "bad proof" });
    const r = await verifyLivenessProof(input);
    expect(r.live).toBe(false);
    expect(r.error).toBe("bad proof");
  });
});

describe("verifyLivenessWithAttestation", () => {
  const input = { proof: "p", publicInputs: [LIVE], verifyingKeyHash: "vk" };

  it("requires BOTH zkML and TEE when an attestation is supplied", async () => {
    mockZk({ valid: true, verificationTimeMs: 10 });
    mockedVerifyTee.mockResolvedValue({ valid: true, platform: 1 as never });
    const r = await verifyLivenessWithAttestation(
      input,
      {} as never,
      "0xenclave",
    );
    expect(r.live).toBe(true);
    expect(r.teeVerified).toBe(true);
  });

  it("is not live if the TEE attestation fails", async () => {
    mockZk({ valid: true, verificationTimeMs: 10 });
    mockedVerifyTee.mockResolvedValue({ valid: false, platform: 0 as never });
    const r = await verifyLivenessWithAttestation(input, {} as never);
    expect(r.teeVerified).toBe(false);
    expect(r.live).toBe(false);
  });
});
