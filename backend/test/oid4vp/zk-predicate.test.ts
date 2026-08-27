import {
  ZK_ELIGIBILITY_FORMAT,
  isZkEligibilityToken,
  verifyZkPredicate,
  type ZkPredicateVerifyDeps,
} from "@/services/oid4vp/zk-predicate";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

const POLICY = getPresentationPolicy(
  "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
);

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const craftToken = (header: object, payload: object) => `${b64u(header)}.${b64u(payload)}.sig`;

// Derived from the policy's own bindings so the test never hard-codes magic values.
const VALID_SIGNALS: Record<string, string> = {
  ...POLICY.zk!.expectedPublicSignals,
  [POLICY.zk!.residency.signal]: POLICY.zk!.residency.allowed[0],
  [POLICY.zk!.contextSignal]: "0xctx",
  claimsHash: "0xabc",
  currentTimestamp: "1770000000",
};

function makeDeps(over: Partial<ZkPredicateVerifyDeps> = {}): ZkPredicateVerifyDeps {
  return {
    verifyHolderJwt: jest.fn(async () => ({
      header: { typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" },
      payload: {
        aud: "rp",
        nonce: "n1",
        circuitId: POLICY.zk!.circuitId,
        vkeyId: POLICY.zk!.vkeyId,
        proof: { pi_a: 1 },
        publicSignals: VALID_SIGNALS,
      },
    })),
    verifyGroth16: jest.fn(async () => true),
    computeContextCommitment: jest.fn(async () => "0xctx"),
    now: () => 1_770_000_100,
    ...over,
  };
}

const params = { vpToken: "tok", policy: POLICY, expectedNonce: "n1", expectedAudience: "rp" };

describe("isZkEligibilityToken", () => {
  it("detects a ZK eligibility token by header typ", () => {
    expect(isZkEligibilityToken(craftToken({ typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" }, {}))).toBe(true);
  });
  it("is false for an SD-JWT VC or another typ", () => {
    expect(isZkEligibilityToken("jwt~disclosure~kb")).toBe(false);
    expect(isZkEligibilityToken(craftToken({ typ: "dc+sd-jwt" }, {}))).toBe(false);
  });
});

describe("verifyZkPredicate", () => {
  it("ALLOWS when the proof verifies and all bindings + residency hold, disclosing nothing", async () => {
    const res = await verifyZkPredicate(makeDeps(), params);
    expect(res.status).toBe("ALLOWED");
    expect(res.reasons).toEqual([]);
  });

  it("DENIES when the Groth16 proof does not verify", async () => {
    const res = await verifyZkPredicate(makeDeps({ verifyGroth16: jest.fn(async () => false) }), params);
    expect(res.status).toBe("DENIED");
    expect(res.reasons.join(" ")).toMatch(/proof/i);
  });

  it("DENIES when residency is outside the allowed set", async () => {
    const deps = makeDeps({
      verifyHolderJwt: jest.fn(async () => ({
        header: { typ: ZK_ELIGIBILITY_FORMAT },
        payload: {
          aud: "rp", nonce: "n1", circuitId: POLICY.zk!.circuitId, vkeyId: POLICY.zk!.vkeyId,
          proof: {}, publicSignals: { ...VALID_SIGNALS, [POLICY.zk!.residency.signal]: "GB" },
        },
      })),
    });
    const res = await verifyZkPredicate(deps, params);
    expect(res.status).toBe("DENIED");
  });

  it("throws VP_VCT_MISMATCH when the proof is for a different circuit", async () => {
    const deps = makeDeps({
      verifyHolderJwt: jest.fn(async () => ({
        header: { typ: ZK_ELIGIBILITY_FORMAT },
        payload: {
          aud: "rp", nonce: "n1", circuitId: "other-circuit", vkeyId: POLICY.zk!.vkeyId,
          proof: {}, publicSignals: VALID_SIGNALS,
        },
      })),
    });
    await expect(verifyZkPredicate(deps, params)).rejects.toMatchObject({ code: "VP_VCT_MISMATCH" });
  });

  it("throws VP_NONCE_INVALID on nonce or context-commitment mismatch", async () => {
    await expect(
      verifyZkPredicate(makeDeps(), { ...params, expectedNonce: "wrong" }),
    ).rejects.toMatchObject({ code: "VP_NONCE_INVALID" });
    await expect(
      verifyZkPredicate(makeDeps({ computeContextCommitment: jest.fn(async () => "0xDIFFERENT") }), params),
    ).rejects.toMatchObject({ code: "VP_NONCE_INVALID" });
  });
});
