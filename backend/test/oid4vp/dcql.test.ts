import { compilePolicyToDcql, SD_JWT_VC_FORMAT } from "@/services/oid4vp/dcql";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

describe("compilePolicyToDcql", () => {
  const policy = getPresentationPolicy(
    "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
  );

  it("produces a single SD-JWT VC credential query for the policy vct", () => {
    const q = compilePolicyToDcql(policy);
    expect(q.credentials).toHaveLength(1);
    const cred = q.credentials[0];
    expect(cred.format).toBe(SD_JWT_VC_FORMAT);
    expect(cred.meta.vct_values).toEqual([policy.vct]);
  });

  it("requests exactly the claim paths the policy requires", () => {
    const q = compilePolicyToDcql(policy);
    expect(q.credentials[0].claims).toEqual(policy.claims.map((c) => ({ path: c.path })));
    // spot-check the nested age path is preserved
    expect(q.credentials[0].claims).toContainEqual({ path: ["age_equal_or_over", "21"] });
  });
});
