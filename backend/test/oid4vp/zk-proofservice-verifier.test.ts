import { createZkProofServiceVerifier } from "@/services/oid4vp/zk-proofservice-verifier";

const circuitId = "zkc_eligibility_policy_context_v1";
const proof = { pi_a: ["1"], pi_b: [["1"]], pi_c: ["1"], protocol: "groth16", curve: "bn128" };
const signals: Record<string, string> = {
  claimsHash: "h",
  ageThresholdYears: "21",
  residencyCountryCode: "AE",
  currentTimestamp: "1",
  policyVersionHash: "pv",
  contextCommitment: "ctx",
};

describe("createZkProofServiceVerifier", () => {
  it("maps named public signals to the circuit-ordered array and the registry circuitName", async () => {
    const verifyProof = jest.fn().mockResolvedValue({ valid: true });
    const verify = createZkProofServiceVerifier({ verifyProof });
    const ok = await verify({ circuitId, vkeyId: "v", proof, publicSignals: signals });
    expect(ok).toBe(true);
    expect(verifyProof).toHaveBeenCalledWith(
      proof,
      ["h", "21", "AE", "1", "pv", "ctx"], // public-signal order pinned by the circuit
      "eligibility_policy_context_v1",
    );
  });

  it("returns false when the proof does not verify", async () => {
    const verify = createZkProofServiceVerifier({ verifyProof: jest.fn().mockResolvedValue({ valid: false }) });
    expect(await verify({ circuitId, vkeyId: "v", proof, publicSignals: signals })).toBe(false);
  });

  it("throws on an unknown circuit", async () => {
    const verify = createZkProofServiceVerifier({ verifyProof: jest.fn() });
    await expect(
      verify({ circuitId: "other", vkeyId: "v", proof, publicSignals: signals }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws when a required public signal is missing", async () => {
    const verify = createZkProofServiceVerifier({ verifyProof: jest.fn() });
    const { contextCommitment, ...partial } = signals;
    await expect(
      verify({ circuitId, vkeyId: "v", proof, publicSignals: partial }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
