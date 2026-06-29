import {
  getPresentationPolicy,
  evaluatePresentationPolicy,
} from "@/services/oid4vp/policy-presentation";

const POLICY_ID = "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1";

const passing = {
  age_equal_or_over: { "21": true },
  resident_country: "AE",
  nationalities: ["AE"],
  sanctions_status: "CLEAR",
  risk_tier: "LOW",
};

describe("getPresentationPolicy", () => {
  it("resolves the regulated-eligibility policy and its alias", () => {
    expect(getPresentationPolicy(POLICY_ID).vct).toBe(
      "https://credentials.zeroid/regulated-eligibility/v1",
    );
    expect(getPresentationPolicy("POLICY_REGULATED_SERVICE_18PLUS_V1").policyId).toBe(POLICY_ID);
  });

  it("throws POLICY_NOT_FOUND (404) for an unknown policy", () => {
    expect(() => getPresentationPolicy("nope")).toThrow(
      expect.objectContaining({ code: "POLICY_NOT_FOUND", statusCode: 404 }),
    );
  });
});

describe("evaluatePresentationPolicy", () => {
  const policy = getPresentationPolicy(POLICY_ID);

  it("ALLOWS when every claim rule is satisfied", () => {
    const r = evaluatePresentationPolicy(policy, passing);
    expect(r.status).toBe("ALLOWED");
    expect(r.reasons).toEqual([]);
    expect(Object.values(r.satisfied).every(Boolean)).toBe(true);
  });

  it("DENIES under-age and reports the reason", () => {
    const r = evaluatePresentationPolicy(policy, { ...passing, age_equal_or_over: { "21": false } });
    expect(r.status).toBe("DENIED");
    expect(r.satisfied["age 21+"]).toBe(false);
    expect(r.reasons.join()).toContain("age 21+");
  });

  it("DENIES a disallowed residency", () => {
    expect(evaluatePresentationPolicy(policy, { ...passing, resident_country: "RU" }).status).toBe("DENIED");
  });

  it("DENIES a non-CLEAR sanctions status", () => {
    expect(evaluatePresentationPolicy(policy, { ...passing, sanctions_status: "POTENTIAL_MATCH" }).status).toBe("DENIED");
  });

  it("DENIES a risk tier outside LOW|MEDIUM", () => {
    expect(evaluatePresentationPolicy(policy, { ...passing, risk_tier: "HIGH" }).status).toBe("DENIED");
  });

  it("requires nationality to intersect the allowed set", () => {
    expect(evaluatePresentationPolicy(policy, { ...passing, nationalities: ["RU"] }).status).toBe("DENIED");
    expect(evaluatePresentationPolicy(policy, { ...passing, nationalities: ["RU", "US"] }).status).toBe("ALLOWED");
  });

  it("treats a missing claim as unsatisfied", () => {
    const { resident_country, ...withoutResidency } = passing;
    expect(evaluatePresentationPolicy(policy, withoutResidency).status).toBe("DENIED");
  });
});
