import fs from "fs";
import path from "path";

const routeSource = fs.readFileSync(
  path.join(__dirname, "../src/routes/enterprise/compliance.ts"),
  "utf8",
);
const reportingSource = fs.readFileSync(
  path.join(
    __dirname,
    "../src/services/compliance/regulatory-reporting.ts",
  ),
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
  it("does not turn caller-supplied credentials into compliance evidence", () => {
    const statusSection = routeSection(
      "// GET /enterprise/compliance/status/:entityId",
      "// POST /enterprise/compliance/evaluate",
    );
    const evaluationSection = routeSection(
      "// POST /enterprise/compliance/evaluate",
      "// POST /enterprise/compliance/report",
    );

    expect(statusSection).toContain("res.status(503)");
    expect(statusSection).toContain(
      "AUTHORITATIVE_CREDENTIAL_EVIDENCE_UNAVAILABLE",
    );
    expect(statusSection).not.toContain("getComplianceStatus(");

    expect(evaluationSection).toContain("res.status(503)");
    expect(evaluationSection).toContain(
      "AUTHORITATIVE_CREDENTIAL_VALIDATION_UNAVAILABLE",
    );
    expect(evaluationSection).not.toContain("evaluateCompliance(");
    expect(evaluationSection).not.toContain("createPolicyAnchoredReceipt(");
    expect(evaluationSection).not.toContain("res.status(200)");
  });

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

  it("retires the mounted regulatory reporting lifecycle until durable connectors exist", () => {
    const generationSection = routeSection(
      "// POST /enterprise/compliance/report — Generate regulatory report",
      "// POST /enterprise/compliance/report/:reportId/submit",
    );
    const submissionSection = routeSection(
      "// POST /enterprise/compliance/report/:reportId/submit",
      "// POST /enterprise/compliance/report/:reportId/amend",
    );
    const amendmentSection = routeSection(
      "// POST /enterprise/compliance/report/:reportId/amend",
      "// GET /enterprise/compliance/report/:reportId/export",
    );
    const exportSection = routeSection(
      "// GET /enterprise/compliance/report/:reportId/export",
      "// GET /enterprise/compliance/report/:reportId/manifest",
    );

    expect(generationSection).toContain("res.status(503)");
    expect(generationSection).toContain(
      "REGULATORY_REPORTING_BACKEND_UNAVAILABLE",
    );
    expect(submissionSection).toContain("res.status(503)");
    expect(submissionSection).toContain("REPORT_SUBMISSION_CONNECTOR_REQUIRED");
    expect(amendmentSection).toContain("res.status(503)");
    expect(amendmentSection).toContain(
      "REGULATORY_REPORT_TRANSACTIONAL_STORE_REQUIRED",
    );
    expect(exportSection).toContain("res.status(501)");
    expect(exportSection).toContain("PDF_EXPORT_RENDERER_UNAVAILABLE");
    expect(exportSection).toContain("res.status(503)");
    expect(exportSection).toContain(
      "REGULATORY_REPORT_EXPORT_BACKEND_UNAVAILABLE",
    );

    for (const section of [
      generationSection,
      submissionSection,
      amendmentSection,
      exportSection,
    ]) {
      expect(section).not.toContain("createPolicyAnchoredReceipt(");
      expect(section).not.toContain("regulatoryReportingService");
      expect(section).not.toContain("res.status(200)");
      expect(section).not.toContain("res.status(201)");
    }
  });

  it("retires manifests, submission packages, verification, and evidence exports", () => {
    const manifestSection = routeSection(
      "// GET /enterprise/compliance/report/:reportId/manifest",
      "// GET /enterprise/compliance/report/:reportId/submission-package",
    );
    const packageSection = routeSection(
      "// GET /enterprise/compliance/report/:reportId/submission-package",
      "// POST /enterprise/compliance/report/submission-package/verify",
    );
    const verificationSection = routeSection(
      "// POST /enterprise/compliance/report/submission-package/verify",
      "// POST /enterprise/compliance/report/:reportId/acknowledge",
    );
    const evidenceSection = routeSection(
      "// GET /enterprise/compliance/report/:reportId/evidence",
      "// GET /enterprise/compliance/jurisdictions",
    );

    expect(manifestSection).toContain("REGULATORY_REPORT_MANIFEST_UNAVAILABLE");
    expect(packageSection).toContain("REGULATORY_SUBMISSION_PACKAGE_UNAVAILABLE");
    expect(verificationSection).toContain(
      "REGULATORY_SUBMISSION_VERIFICATION_UNAVAILABLE",
    );
    expect(evidenceSection).toContain("REGULATORY_REPORT_EVIDENCE_UNAVAILABLE");

    for (const section of [
      manifestSection,
      packageSection,
      verificationSection,
      evidenceSection,
    ]) {
      expect(section).toContain("res.status(503)");
      expect(section).not.toContain("regulatoryReportingService");
      expect(section).not.toContain("createPolicyAnchoredReceipt(");
      expect(section).not.toContain("res.status(200)");
    }

    expect(routeSource).not.toContain("buildRegulatorySubmissionBundle(");
    expect(routeSource).not.toContain("verifyRegulatorySubmissionBundle(");
    expect(routeSource).not.toContain("recordReportEvidenceEvent(");
    expect(routeSource).not.toContain("recordAuthorityManifestEvent(");
  });

  it("does not accept operator-declared regulator acknowledgements", () => {
    const section = routeSection(
      "// POST /enterprise/compliance/report/:reportId/acknowledge",
      "// GET /enterprise/compliance/report/:reportId/evidence",
    );

    expect(section).toContain("res.status(503)");
    expect(section).toContain(
      "REGULATOR_ACKNOWLEDGEMENT_CONNECTOR_UNAVAILABLE",
    );
    expect(section).not.toContain("recordAuthorityManifestEvent(");
    expect(section).not.toContain("recordReportEvidenceEvent(");
    expect(section).not.toContain("createPolicyAnchoredReceipt(");
    expect(section).not.toContain("res.status(200)");
  });

  it("does not approve caller-declared cross-border transfers", () => {
    const section = routeSection(
      "// POST /enterprise/compliance/cross-border",
      "// GET /enterprise/compliance/sovereignty/status/:dataSubjectId",
    );

    expect(section).toContain("res.status(503)");
    expect(section).toContain("CROSS_BORDER_APPROVAL_CONNECTOR_UNAVAILABLE");
    expect(section).not.toContain("assessCrossBorder(");
    expect(section).not.toContain("assessCrossBorderTransfer(");
    expect(section).not.toContain("createPolicyAnchoredReceipt(");
    expect(section).not.toContain("res.status(200)");
  });

  it("does not expose globally keyed data-sovereignty records", () => {
    const section = routeSection(
      "// GET /enterprise/compliance/sovereignty/status/:dataSubjectId",
      "// POST /enterprise/compliance/dsar",
    );

    expect(section).toContain("res.status(503)");
    expect(section).toContain(
      "TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED",
    );
    expect(section).not.toContain("getRetentionStatus(");
    expect(section).not.toContain("getConsents(");
    expect(section).not.toContain("res.status(200)");
  });

  it("does not claim DSAR fulfillment or erasure without data connectors", () => {
    const section = routeSection(
      "// POST /enterprise/compliance/dsar",
      "// POST /enterprise/compliance/consent",
    );

    expect(section).toContain("res.status(503)");
    expect(section).toContain("DATA_SUBJECT_RIGHTS_CONNECTOR_REQUIRED");
    expect(section).not.toContain("fulfillDSAR(");
    expect(section).not.toContain("processErasure(");
    expect(section).not.toContain("createPolicyAnchoredReceipt(");
    expect(section).not.toContain("res.status(200)");
    expect(reportingSource).not.toContain("local_deterministic_connector");
    expect(reportingSource).not.toContain("recordCount:");
  });

  it("does not mutate consent, PIA, or breach state in a global store", () => {
    const consentSection = routeSection(
      "// POST /enterprise/compliance/consent",
      "// POST /enterprise/compliance/pia",
    );
    const piaSection = routeSection(
      "// POST /enterprise/compliance/pia",
      "// POST /enterprise/compliance/breach",
    );
    const breachSection = routeSection(
      "// POST /enterprise/compliance/breach",
      "export default router",
    );

    for (const section of [consentSection, piaSection, breachSection]) {
      expect(section).toContain("res.status(503)");
      expect(section).toContain(
        "TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED",
      );
      expect(section).not.toContain("createPolicyAnchoredReceipt(");
    }
    expect(consentSection).not.toContain("recordConsent(");
    expect(piaSection).not.toContain("conductPIA(");
    expect(breachSection).not.toContain("initiateBreachNotification(");
  });

  it("does not emit fake PDF bytes or connectorless submissions", () => {
    expect(reportingSource).toContain("PDF_EXPORT_RENDERER_UNAVAILABLE");
    expect(reportingSource).toContain("REPORT_SUBMISSION_CONNECTOR_REQUIRED");
    expect(reportingSource).toContain("REGULATORY_REPORT_STORE_REQUIRED");
    expect(reportingSource).not.toContain(
      "Buffer.from(JSON.stringify(report)).toString('base64')",
    );
    expect(reportingSource).not.toContain(
      "Non-production connectorless filing reference",
    );
  });
});
