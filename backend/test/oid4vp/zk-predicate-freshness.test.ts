/**
 * ZeroID — the ZK eligibility proof must be fresh (finding ZK-02).
 *
 * The eligibility circuit takes the evaluation instant as a public INPUT
 * (`currentTimestamp` in eligibility_context_proof.circom) and evaluates the age
 * and expiry predicates at it. The prover therefore picks the moment the
 * predicate is judged: forward-dating up to the credential's expiry proves
 * "would be old enough later", and backdating proves "was not yet expired
 * earlier". Both are TRUTHFUL proofs of a statement the verifier did not ask.
 *
 * These tests pin the window that turns the presentation back into the intended
 * claim — "is eligible NOW" — and pin that every unusable shape of the signal,
 * and a policy that forgets to declare the window at all, is refused rather
 * than waved through.
 */
import {
  ZK_ELIGIBILITY_FORMAT,
  verifyZkPredicate,
  type ZkPredicateVerifyDeps,
} from "@/services/oid4vp/zk-predicate";
import {
  getPresentationPolicy,
  type PresentationPolicy,
} from "@/services/oid4vp/policy-presentation";

const POLICY = getPresentationPolicy(
  "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
);
const ZK = POLICY.zk!;
const FRESHNESS = ZK.freshness;

/** Verifier clock for every case here (Unix seconds), so nothing depends on wall time. */
const NOW = 1_770_000_000;

/** Signals that satisfy every binding except, optionally, the timestamp. */
function signals(currentTimestamp: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...ZK.expectedPublicSignals,
    [ZK.residency.signal]: ZK.residency.allowed[0],
    [ZK.contextSignal]: "0xctx",
    claimsHash: "0xabc",
    [FRESHNESS.signal]: currentTimestamp,
  };
  if (currentTimestamp === undefined) delete out[FRESHNESS.signal];
  return out;
}

/**
 * The public-signal names the backend circuit registry declares for the
 * eligibility circuit (`eligibility_policy_context_v1`). The freshness signal
 * is checked against THIS list, not against the policy that names it.
 */
const DECLARED_SIGNALS = [
  "claimsHash",
  "ageThresholdYears",
  "residencyCountryCode",
  "currentTimestamp",
  "policyVersionHash",
  "contextCommitment",
];

function makeDeps(
  currentTimestamp: unknown,
  over: Partial<ZkPredicateVerifyDeps> = {},
): ZkPredicateVerifyDeps {
  return {
    verifyHolderJwt: jest.fn(async () => ({
      header: { typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" },
      payload: {
        aud: "rp",
        nonce: "n1",
        circuitId: ZK.circuitId,
        vkeyId: ZK.vkeyId,
        proof: { pi_a: 1 },
        publicSignals: signals(currentTimestamp),
      },
    })),
    verifyGroth16: jest.fn(async () => true),
    computeContextCommitment: jest.fn(async () => "0xctx"),
    declaredPublicSignals: jest.fn(() => [...DECLARED_SIGNALS]),
    now: () => NOW,
    ...over,
  };
}

const params = {
  vpToken: "tok",
  policy: POLICY,
  expectedNonce: "n1",
  expectedAudience: "rp",
};

describe("verifyZkPredicate — evaluation-time freshness (ZK-02)", () => {
  it("declares a freshness binding on the ZK eligibility policy", () => {
    expect(FRESHNESS.signal).toBe("currentTimestamp");
    expect(FRESHNESS.maxAgeSeconds).toBeGreaterThan(0);
    expect(FRESHNESS.maxSkewAheadSeconds).toBeGreaterThan(0);
    // A proof evaluated in the future is never legitimate, so the forward
    // allowance exists only for clock skew and stays far tighter than the
    // backward window.
    expect(FRESHNESS.maxSkewAheadSeconds).toBeLessThan(FRESHNESS.maxAgeSeconds);
  });

  describe("accepts an evaluation instant inside the window", () => {
    it.each([
      ["evaluated at the verifier's own clock", NOW],
      ["evaluated a moment ago", NOW - 1],
      ["at the oldest allowed instant", NOW - FRESHNESS.maxAgeSeconds],
      ["at the furthest tolerated clock skew ahead", NOW + FRESHNESS.maxSkewAheadSeconds],
    ])("%s", async (_label, ts) => {
      const res = await verifyZkPredicate(makeDeps(String(ts)), params);
      expect(res.status).toBe("ALLOWED");
      expect(res.reasons).toEqual([]);
    });
  });

  describe("refuses an evaluation instant outside the window", () => {
    it("refuses a proof older than the freshness window", async () => {
      await expect(
        verifyZkPredicate(makeDeps(String(NOW - FRESHNESS.maxAgeSeconds - 1)), params),
      ).rejects.toMatchObject({ code: "VP_TOKEN_INVALID", statusCode: 401 });
    });

    it("refuses a proof further ahead than the skew allowance", async () => {
      await expect(
        verifyZkPredicate(makeDeps(String(NOW + FRESHNESS.maxSkewAheadSeconds + 1)), params),
      ).rejects.toMatchObject({ code: "VP_TOKEN_INVALID", statusCode: 401 });
    });
  });

  describe("fails closed on an unusable timestamp signal", () => {
    it.each([
      ["absent", undefined],
      ["empty", ""],
      ["whitespace only", "   "],
      ["non-numeric", "not-a-timestamp"],
      ["negative", "-1"],
      ["fractional", "1770000000.5"],
      ["exponent notation", "1.77e9"],
      ["hexadecimal", "0x69766100"],
      ["beyond Number.MAX_SAFE_INTEGER", "9007199254740993"],
      ["a boolean", true],
      ["an object", { seconds: NOW }],
      ["an array", [String(NOW)]],
      ["null", null],
    ])("refuses a %s timestamp", async (_label, ts) => {
      await expect(verifyZkPredicate(makeDeps(ts), params)).rejects.toMatchObject({
        code: "VP_TOKEN_INVALID",
        statusCode: 401,
      });
    });
  });

  describe("refuses a policy that declares no freshness requirement", () => {
    /** Strip or corrupt the freshness binding the way a new policy might. */
    function policyWithFreshness(freshness: unknown): PresentationPolicy {
      return {
        ...POLICY,
        zk: { ...ZK, freshness } as PresentationPolicy["zk"],
      } as PresentationPolicy;
    }

    it.each([
      ["omitted", undefined],
      ["null", null],
      ["missing the signal name", { maxAgeSeconds: 300, maxSkewAheadSeconds: 30 }],
      ["carrying an empty signal name", { signal: "", maxAgeSeconds: 300, maxSkewAheadSeconds: 30 }],
      ["missing the windows", { signal: "currentTimestamp" }],
      [
        "carrying a negative window",
        { signal: "currentTimestamp", maxAgeSeconds: -1, maxSkewAheadSeconds: 30 },
      ],
      [
        "carrying a non-finite window",
        { signal: "currentTimestamp", maxAgeSeconds: 300, maxSkewAheadSeconds: Number.NaN },
      ],
      [
        "carrying a non-numeric window",
        { signal: "currentTimestamp", maxAgeSeconds: "300", maxSkewAheadSeconds: 30 },
      ],
    ])("refuses a binding %s rather than skipping the check", async (_label, freshness) => {
      await expect(
        verifyZkPredicate(makeDeps(String(NOW)), {
          ...params,
          policy: policyWithFreshness(freshness),
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
    });
  });

  describe("the freshness signal is bound to the circuit, not just to the policy", () => {
    /**
     * The signal name is policy text; the signal itself is published by the
     * circuit. Without this binding a policy could name any key at all and the
     * verifier would read whatever the holder happened to put under it — or,
     * for a name the circuit never emits, refuse every presentation for a
     * reason no operator could see. Both directions are configuration defects,
     * so both are refused the way a malformed freshness binding is: an
     * INTERNAL_ERROR 500, never a holder-facing 401 and never a DENIED verdict.
     */
    it("refuses a policy whose freshness signal the circuit does not declare", async () => {
      const policy = {
        ...POLICY,
        zk: { ...ZK, freshness: { ...FRESHNESS, signal: "wallClockSeconds" } },
      } as PresentationPolicy;
      // The holder even supplies a perfectly fresh value under that name, so
      // only the circuit binding stands between the policy and trusting it.
      const deps = makeDeps(String(NOW), {
        verifyHolderJwt: jest.fn(async () => ({
          header: { typ: ZK_ELIGIBILITY_FORMAT, alg: "ES256" },
          payload: {
            aud: "rp",
            nonce: "n1",
            circuitId: ZK.circuitId,
            vkeyId: ZK.vkeyId,
            proof: { pi_a: 1 },
            publicSignals: { ...signals(String(NOW)), wallClockSeconds: String(NOW) },
          },
        })),
      });

      await expect(verifyZkPredicate(deps, { ...params, policy })).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
        statusCode: 500,
      });
      expect(deps.verifyGroth16).not.toHaveBeenCalled();
    });

    it("refuses a circuitId the registry does not resolve, rather than treating it as covered by the policy binding", async () => {
      // The proof matches the policy's circuitId, so the earlier binding check
      // passes; what fails is that the id names no circuit this deployment
      // knows, which makes the declared-signal set unknowable. Verifying a
      // freshness window against an unknown circuit verifies nothing, so the
      // deliberate choice is to fail closed here rather than to assume the
      // earlier check already covered it.
      const deps = makeDeps(String(NOW), { declaredPublicSignals: jest.fn(() => null) });

      await expect(verifyZkPredicate(deps, params)).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
        statusCode: 500,
      });
      expect(deps.verifyGroth16).not.toHaveBeenCalled();
    });

    it("resolves the schema by the presented circuitId", async () => {
      const declaredPublicSignals = jest.fn(() => [...DECLARED_SIGNALS]);
      const res = await verifyZkPredicate(makeDeps(String(NOW), { declaredPublicSignals }), params);

      expect(declaredPublicSignals).toHaveBeenCalledWith(ZK.circuitId);
      expect(res.status).toBe("ALLOWED");
    });
  });

  describe("the forward-dating exploit is closed", () => {
    it("refuses a proof evaluated years in the future even though every other binding and the Groth16 verification succeed", async () => {
      const fiveYearsAhead = NOW + 5 * 365 * 24 * 60 * 60;
      const deps = makeDeps(String(fiveYearsAhead));

      // The presentation is otherwise impeccable: correct audience and nonce,
      // the policy's circuit + vkey, every pinned public signal, the right
      // context commitment, an allowed residency, and a proof that verifies.
      await expect(verifyZkPredicate(deps, params)).rejects.toMatchObject({
        code: "VP_TOKEN_INVALID",
        statusCode: 401,
      });

      // Refused as a binding failure — never reported as an ALLOWED (or even a
      // DENIED) eligibility evaluation, and refused before the proof is verified.
      expect(deps.verifyGroth16).not.toHaveBeenCalled();
    });

    it("refuses a captured proof replayed after the window, and its verdict is an error rather than a DENIED decision", async () => {
      const evaluatedAt = NOW;
      const replayedAt = NOW + FRESHNESS.maxAgeSeconds + 1;
      const deps = makeDeps(String(evaluatedAt), { now: () => replayedAt });

      await expect(verifyZkPredicate(deps, params)).rejects.toMatchObject({
        code: "VP_TOKEN_INVALID",
      });
      expect(deps.verifyGroth16).not.toHaveBeenCalled();
    });
  });
});
