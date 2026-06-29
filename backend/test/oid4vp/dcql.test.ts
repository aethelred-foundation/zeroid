import { compilePolicyToDcql, SD_JWT_VC_FORMAT } from "@/services/oid4vp/dcql";
import { ZK_ELIGIBILITY_FORMAT } from "@/services/oid4vp/zk-predicate";
import { getPresentationPolicy } from "@/services/oid4vp/policy-presentation";

describe("compilePolicyToDcql", () => {
  const policy = getPresentationPolicy(
    "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
  );

  it("includes an SD-JWT VC credential query for the policy vct + required claim paths", () => {
    const q = compilePolicyToDcql(policy);
    const sd = q.credentials.find((c) => c.format === SD_JWT_VC_FORMAT)!;
    expect(sd.meta.vct_values).toEqual([policy.vct]);
    expect(sd.claims).toEqual(policy.claims.map((c) => ({ path: c.path })));
    expect(sd.claims).toContainEqual({ path: ["age_equal_or_over", "21"] });
  });

  it("advertises the ZK eligibility alternative when the policy has a zk binding", () => {
    const q = compilePolicyToDcql(policy);
    const zk = q.credentials.find((c) => c.format === ZK_ELIGIBILITY_FORMAT)!;
    expect(zk).toBeDefined();
    expect(zk.meta.circuit_id).toBe(policy.zk!.circuitId);
    expect(zk.meta.vkey_id).toBe(policy.zk!.vkeyId);
    // EITHER the SD-JWT OR the ZK credential satisfies the request
    expect(q.credential_sets).toEqual([{ options: [["eligibility"], ["eligibility_zk"]] }]);
  });

  it("omits the ZK alternative for a policy without a zk binding", () => {
    const q = compilePolicyToDcql({ ...policy, zk: undefined });
    expect(q.credentials).toHaveLength(1);
    expect(q.credentials[0].format).toBe(SD_JWT_VC_FORMAT);
    expect(q.credential_sets).toBeUndefined();
  });
});
