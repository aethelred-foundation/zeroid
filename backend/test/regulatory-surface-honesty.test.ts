import fs from "fs";
import path from "path";

const routeSource = fs.readFileSync(
  path.join(__dirname, "../src/routes/enterprise/compliance.ts"),
  "utf8",
);

function routeSection(startMarker: string, endMarker: string): string {
  const start = routeSource.indexOf(startMarker);
  const end = routeSource.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Unable to locate route section: ${startMarker}`);
  }
  return routeSource.slice(start, end);
}

describe("regulatory surface evidence boundaries", () => {
  it("returns configured credential policy without inventing legal requirements", () => {
    const section = routeSection(
      "// GET /enterprise/compliance/jurisdictions/:jurisdiction/requirements",
      "// GET /enterprise/compliance/regulatory-changes",
    );

    expect(section).toContain("evidenceStatus: 'configured_policy_only'");
    expect(section).toContain("externalAuthorityVerified: false");
    expect(section).toContain("'statutory_filing_deadlines'");
    expect(section).not.toContain("acceptedIssuers");
    expect(section).not.toContain("renewalBufferDays");
    expect(section).not.toContain("reportingObligations");
    expect(section).not.toContain("amlThresholds");
    expect(section).not.toContain("amountUSD");
  });

  it("fails closed when no authoritative regulatory feed is configured", () => {
    const section = routeSection(
      "// GET /enterprise/compliance/regulatory-changes",
      "// POST /enterprise/compliance/cross-border",
    );

    expect(section).toContain("res.status(501)");
    expect(section).toContain("AUTHORITATIVE_REGULATORY_FEED_UNAVAILABLE");
    expect(section).not.toContain("getRegulatoryChanges(");
    expect(section).not.toContain("res.status(200)");
  });

  it("returns recorded residency evidence without fabricated GDPR attestations", () => {
    const section = routeSection(
      "// GET /enterprise/compliance/sovereignty/status/:dataSubjectId",
      "// POST /enterprise/compliance/dsar",
    );

    expect(section).toContain("evidenceStatus: 'recorded_workflow_evidence'");
    expect(section).toContain("legalConclusionAvailable: false");
    expect(section).toContain("'gdpr_legal_conclusion'");
    expect(section).not.toContain("gdprStatus");
    expect(section).not.toContain("rightToErasure");
    expect(section).not.toContain("dataPortability");
    expect(section).not.toContain("breachNotificationProcess");
    expect(section).not.toContain("pendingTransfers");
  });
});
