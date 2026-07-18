import {
  FEATURE_READINESS,
  getFeatureReadiness,
  readinessBadgeClass,
  readinessDotClass,
} from "../readiness";

describe("feature readiness registry", () => {
  it("labels the hero eligibility workflow as configured until production ZK artifacts are pinned", () => {
    const readiness = getFeatureReadiness("/eligibility");

    expect(readiness.status).toBe("Configured");
    expect(readiness.evidence).toContain("compiled ZK artifacts");
  });

  it("keeps future-facing modules out of Live status", () => {
    expect(getFeatureReadiness("/cross-chain").status).toBe("Preview");
    expect(getFeatureReadiness("/agent-identity").status).toBe("Preview");
    expect(getFeatureReadiness("/ai-compliance").status).toBe("Preview");
  });

  it("registers the dashboard without demo telemetry evidence", () => {
    const readiness = getFeatureReadiness("/");

    expect(readiness.status).toBe("Configured");
    expect(readiness.evidence).toContain("bounded credential and verification");
    expect(readiness.evidence).not.toContain("demo telemetry");
  });

  it("has explicit evidence for every registered surface", () => {
    for (const readiness of Object.values(FEATURE_READINESS)) {
      expect(readiness.evidence.length).toBeGreaterThan(24);
      expect(readinessDotClass(readiness.status)).toMatch(/^bg-/);
      expect(readinessBadgeClass(readiness.status)).toContain("border");
    }
  });
});
