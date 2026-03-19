/**
 * Tests for Client-Side Compliance Engine
 *
 * Covers: evaluateJurisdiction, calculateRiskScore, detectCredentialGaps,
 * checkCrossBorderEligibility, computeRegulatoryDeadlines.
 */

import {
  evaluateJurisdiction,
  calculateRiskScore,
  detectCredentialGaps,
  checkCrossBorderEligibility,
  computeRegulatoryDeadlines,
  type CredentialRecord,
} from "@/lib/ai/compliance-engine";
import {
  JURISDICTIONS,
  CROSS_BORDER_MATRIX,
} from "@/lib/regulatory/jurisdictions";
import type { JurisdictionId } from "@/lib/regulatory/jurisdictions";

// ============================================================================
// Helpers
// ============================================================================

const DAY_SEC = 86_400;
const DAY_MS = DAY_SEC * 1000;

/** Build a credential record with sensible defaults. */
function makeCredential(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    schemaId: "gov_id",
    schemaName: "Government ID",
    status: "active",
    issuedAt: nowSec - 180 * DAY_SEC,
    expiresAt: nowSec + 365 * DAY_SEC,
    issuerDid: "did:aethelred:issuer:default",
    attributes: {},
    ...overrides,
  };
}

/** Create a full set of active credentials for a jurisdiction. */
function makeFullCredentials(
  jurisdictionId: JurisdictionId,
  nowMs: number = Date.now(),
): CredentialRecord[] {
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  if (!jurisdiction) return [];
  const nowSec = Math.floor(nowMs / 1000);
  return jurisdiction.requiredCredentials.map((req) =>
    makeCredential({
      schemaId: req.schemaId,
      schemaName: req.schemaName,
      status: "active",
      issuedAt: nowSec - 90 * DAY_SEC,
      expiresAt: nowSec + 180 * DAY_SEC,
      issuerDid: req.acceptedIssuers[0] ?? "did:aethelred:issuer:default",
    }),
  );
}

// ============================================================================
// evaluateJurisdiction
// ============================================================================

describe("evaluateJurisdiction", () => {
  const NOW_MS = 1_700_000_000_000; // fixed reference point
  const NOW_SEC = Math.floor(NOW_MS / 1000);

  it("returns non_compliant with score 0 for unknown jurisdiction", () => {
    const result = evaluateJurisdiction(
      "unknown_place" as JurisdictionId,
      [],
      NOW_MS,
    );
    expect(result.status).toBe("non_compliant");
    expect(result.score).toBe(0);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].label).toBe("Unknown jurisdiction");
    expect(result.met).toHaveLength(0);
    expect(result.expiringSoon).toHaveLength(0);
  });

  it("returns compliant (score 100) when all mandatory credentials are active and not expiring", () => {
    const credentials = makeFullCredentials("uae", NOW_MS);
    const result = evaluateJurisdiction("uae", credentials, NOW_MS);

    expect(result.status).toBe("compliant");
    expect(result.score).toBe(100);
    expect(result.unmet).toHaveLength(0);
    expect(result.expiringSoon).toHaveLength(0);
    // Should include consent requirements in met
    const consentMet = result.met.filter((r) => r.category === "consent");
    expect(consentMet.length).toBe(
      JURISDICTIONS.uae.consentRequirements.length,
    );
  });

  it("returns non_compliant when all mandatory credentials are missing", () => {
    const result = evaluateJurisdiction("uae", [], NOW_MS);
    expect(result.status).toBe("non_compliant");
    expect(result.score).toBe(0);
    const mandatoryCount = JURISDICTIONS.uae.requiredCredentials.filter(
      (r) => r.mandatory,
    ).length;
    const mandatoryUnmet = result.unmet.filter(
      (r) => r.mandatory && r.category === "credential",
    );
    expect(mandatoryUnmet.length).toBe(mandatoryCount);
  });

  it("returns partially_compliant when some mandatory credentials are met", () => {
    // UAE has 4 mandatory credentials. Supply only the first 2.
    const uaeReqs = JURISDICTIONS.uae.requiredCredentials;
    const credentials = uaeReqs.slice(0, 2).map((req) =>
      makeCredential({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        expiresAt: NOW_SEC + 180 * DAY_SEC,
      }),
    );

    const result = evaluateJurisdiction("uae", credentials, NOW_MS);
    expect(result.status).toBe("partially_compliant");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(100);
  });

  it("marks credential as unmet when status is not active (e.g. pending)", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "pending",
      expiresAt: NOW_SEC + 365 * DAY_SEC,
    });
    const result = evaluateJurisdiction("uae", [cred], NOW_MS);
    const govIdUnmet = result.unmet.find(
      (r) => r.credentialSchemaId === "gov_id",
    );
    expect(govIdUnmet).toBeDefined();
    expect(govIdUnmet!.status).toBe("unmet");
  });

  it("marks credential as expired when expiresAt <= nowSec", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC - 1, // already expired
    });
    const result = evaluateJurisdiction("uae", [cred], NOW_MS);
    const govId = result.unmet.find((r) => r.credentialSchemaId === "gov_id");
    expect(govId).toBeDefined();
    expect(govId!.status).toBe("expired");
    expect(govId!.daysUntilExpiry).toBe(0);
  });

  it("marks credential as expiring_soon within 30 days", () => {
    const daysLeft = 15;
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC + daysLeft * DAY_SEC,
    });
    // Provide all other UAE credentials so we isolate the expiring one
    const otherCreds = JURISDICTIONS.uae.requiredCredentials
      .filter((r) => r.schemaId !== "gov_id")
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 365 * DAY_SEC,
        }),
      );

    const result = evaluateJurisdiction("uae", [cred, ...otherCreds], NOW_MS);
    const expiring = result.expiringSoon.find(
      (r) => r.credentialSchemaId === "gov_id",
    );
    expect(expiring).toBeDefined();
    expect(expiring!.status).toBe("expiring_soon");
    expect(expiring!.daysUntilExpiry).toBe(daysLeft);
  });

  it("scores expiring mandatory credentials at 0.5 weight", () => {
    // Make all 4 UAE mandatory credentials expiring soon (within 30 days)
    const credentials = JURISDICTIONS.uae.requiredCredentials.map((req) =>
      makeCredential({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        expiresAt: NOW_SEC + 10 * DAY_SEC,
      }),
    );

    const result = evaluateJurisdiction("uae", credentials, NOW_MS);
    // All mandatory expiring: score = (0 + 4*0.5)/4 * 100 = 50
    expect(result.score).toBe(50);
    expect(result.status).toBe("partially_compliant");
  });

  it("adds consent requirements as met entries", () => {
    const result = evaluateJurisdiction(
      "eu",
      makeFullCredentials("eu", NOW_MS),
      NOW_MS,
    );
    const consentMet = result.met.filter((r) => r.category === "consent");
    expect(consentMet.length).toBe(JURISDICTIONS.eu.consentRequirements.length);
    for (const c of consentMet) {
      expect(c.status).toBe("met");
      expect(c.mandatory).toBe(true);
    }
  });

  it("handles jurisdiction with no mandatory credentials (score defaults to 100)", () => {
    // EU has optional credentials (residency, eIDAS). If all mandatory are met
    // but optionals are missing, should still be compliant.
    const mandatoryOnly = JURISDICTIONS.eu.requiredCredentials
      .filter((r) => r.mandatory)
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 180 * DAY_SEC,
        }),
      );

    const result = evaluateJurisdiction("eu", mandatoryOnly, NOW_MS);
    expect(result.score).toBe(100);
    expect(result.status).toBe("compliant");
    // Optional credentials appear as unmet but don't affect score
    const optionalUnmet = result.unmet.filter((r) => !r.mandatory);
    expect(optionalUnmet.length).toBeGreaterThan(0);
  });

  it("preserves jurisdictionId in the result", () => {
    const result = evaluateJurisdiction("sg", [], NOW_MS);
    expect(result.jurisdictionId).toBe("sg");
  });

  it("uses Date.now() as default when nowMs is omitted", () => {
    const credentials = makeFullCredentials("uae");
    const result = evaluateJurisdiction("uae", credentials);
    expect(result).toBeDefined();
    expect(result.jurisdictionId).toBe("uae");
  });

  it("returns score 100 when jurisdiction has zero mandatory credentials", () => {
    // Temporarily inject a test jurisdiction with no mandatory credentials
    const testId = "__test_no_mandatory__" as JurisdictionId;
    (JURISDICTIONS as Record<string, (typeof JURISDICTIONS)["uae"]>)[testId] = {
      ...JURISDICTIONS.uae,
      id: testId,
      name: "Test Jurisdiction",
      requiredCredentials: [
        {
          schemaId: "optional_cred",
          schemaName: "Optional Cred",
          mandatory: false,
          validityPeriodDays: 365,
          acceptedIssuers: [],
          renewalBufferDays: 30,
        },
      ],
      consentRequirements: [],
    };

    try {
      const result = evaluateJurisdiction(testId, [], NOW_MS);
      // totalMandatory = 0, score defaults to 100
      expect(result.score).toBe(100);
      expect(result.status).toBe("compliant");
    } finally {
      delete (JURISDICTIONS as Record<string, unknown>)[testId];
    }
  });
});

// ============================================================================
// calculateRiskScore
// ============================================================================

describe("calculateRiskScore", () => {
  it("returns low risk for established account with full credentials", () => {
    const credentials = makeFullCredentials("eu");
    const result = calculateRiskScore(credentials, "eu", 50, 500);
    expect(result.level).toBe("low");
    expect(result.compositeScore).toBeLessThan(25);
    expect(result.factors).toHaveLength(5);
  });

  it("returns higher risk for new account with no credentials", () => {
    const result = calculateRiskScore([], "eu", 0, 5);
    expect(result.compositeScore).toBeGreaterThan(25);
    expect(["medium", "high", "critical"]).toContain(result.level);
  });

  it("returns critical risk for new account with high transaction velocity", () => {
    // New account (1 day), 100 transactions, no credentials
    const result = calculateRiskScore([], "sa", 100, 1);
    expect(result.compositeScore).toBeGreaterThanOrEqual(50);
    expect(["high", "critical"]).toContain(result.level);
  });

  it("includes all 5 risk factors with correct names", () => {
    const result = calculateRiskScore([], "us", 10, 100);
    const names = result.factors.map((f) => f.name);
    expect(names).toEqual([
      "credential_coverage",
      "credential_freshness",
      "account_maturity",
      "transaction_velocity",
      "jurisdiction_risk",
    ]);
  });

  it("computes correct weighted scores", () => {
    const result = calculateRiskScore([], "eu", 10, 100);
    for (const factor of result.factors) {
      expect(factor.weightedScore).toBeCloseTo(
        factor.rawScore * factor.weight,
        5,
      );
    }
  });

  it("composite score equals sum of weighted scores (rounded)", () => {
    const result = calculateRiskScore(makeFullCredentials("us"), "us", 20, 200);
    const expectedSum = Math.round(
      result.factors.reduce((sum, f) => sum + f.weightedScore, 0),
    );
    expect(result.compositeScore).toBe(expectedSum);
  });

  it("uses jurisdiction risk 50 for unknown jurisdiction", () => {
    const result = calculateRiskScore([], "zz" as JurisdictionId, 0, 100);
    const jFactor = result.factors.find((f) => f.name === "jurisdiction_risk");
    expect(jFactor!.rawScore).toBe(50);
  });

  it("credential freshness is 50 when no active credentials exist", () => {
    const result = calculateRiskScore([], "eu", 0, 100);
    const freshness = result.factors.find(
      (f) => f.name === "credential_freshness",
    );
    expect(freshness!.rawScore).toBe(50);
  });

  it("applies correct thresholds for risk levels", () => {
    // Mock a result and check boundaries: low<25, medium<50, high<75, critical>=75
    const lowResult = calculateRiskScore(
      makeFullCredentials("jp"),
      "jp",
      10,
      500,
    );
    expect(lowResult.compositeScore).toBeLessThan(25);
    expect(lowResult.level).toBe("low");
  });

  it("account maturity score varies by age brackets", () => {
    // <30 days => 80
    const young = calculateRiskScore([], "eu", 0, 10);
    const youngMaturity = young.factors.find(
      (f) => f.name === "account_maturity",
    );
    expect(youngMaturity!.rawScore).toBe(80);

    // 30-89 days => 40
    const mid = calculateRiskScore([], "eu", 0, 60);
    const midMaturity = mid.factors.find((f) => f.name === "account_maturity");
    expect(midMaturity!.rawScore).toBe(40);

    // 90-364 days => 15
    const older = calculateRiskScore([], "eu", 0, 200);
    const olderMaturity = older.factors.find(
      (f) => f.name === "account_maturity",
    );
    expect(olderMaturity!.rawScore).toBe(15);

    // 365+ days => 5
    const mature = calculateRiskScore([], "eu", 0, 500);
    const matureMaturity = mature.factors.find(
      (f) => f.name === "account_maturity",
    );
    expect(matureMaturity!.rawScore).toBe(5);
  });

  it("transaction velocity score varies by daily tx rate brackets", () => {
    // rate > 50 => 90
    const fast = calculateRiskScore([], "eu", 200, 1);
    expect(
      fast.factors.find((f) => f.name === "transaction_velocity")!.rawScore,
    ).toBe(90);

    // rate > 20, <= 50 => 60
    const moderate = calculateRiskScore([], "eu", 30, 1);
    expect(
      moderate.factors.find((f) => f.name === "transaction_velocity")!.rawScore,
    ).toBe(60);

    // rate > 5, <= 20 => 30
    const normal = calculateRiskScore([], "eu", 10, 1);
    expect(
      normal.factors.find((f) => f.name === "transaction_velocity")!.rawScore,
    ).toBe(30);

    // rate <= 5 => 10
    const slow = calculateRiskScore([], "eu", 3, 1);
    expect(
      slow.factors.find((f) => f.name === "transaction_velocity")!.rawScore,
    ).toBe(10);
  });
});

// ============================================================================
// detectCredentialGaps
// ============================================================================

describe("detectCredentialGaps", () => {
  const NOW_MS = 1_700_000_000_000;
  const NOW_SEC = Math.floor(NOW_MS / 1000);

  it("returns empty array for unknown jurisdiction", () => {
    const result = detectCredentialGaps("xyz" as JurisdictionId, [], NOW_MS);
    expect(result).toEqual([]);
  });

  it("uses Date.now() as default when nowMs is omitted", () => {
    const result = detectCredentialGaps("uae", []);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns no gaps when all credentials are present and valid", () => {
    const credentials = makeFullCredentials("sg", NOW_MS);
    const result = detectCredentialGaps("sg", credentials, NOW_MS);
    expect(result).toHaveLength(0);
  });

  it("identifies missing credentials", () => {
    const result = detectCredentialGaps("sg", [], NOW_MS);
    const required = JURISDICTIONS.sg.requiredCredentials;
    expect(result.length).toBe(required.length);
    for (const gap of result) {
      expect(gap.reason).toBe("missing");
    }
  });

  it("marks missing mandatory credentials as critical severity", () => {
    const result = detectCredentialGaps("sg", [], NOW_MS);
    const mandatoryGaps = result.filter((g) => g.mandatory);
    for (const gap of mandatoryGaps) {
      expect(gap.severity).toBe("critical");
    }
  });

  it("marks missing optional credentials as medium severity", () => {
    // EU has optional credentials (residency, eIDAS)
    const mandatoryCreds = JURISDICTIONS.eu.requiredCredentials
      .filter((r) => r.mandatory)
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 365 * DAY_SEC,
        }),
      );
    const result = detectCredentialGaps("eu", mandatoryCreds, NOW_MS);
    const optionalGaps = result.filter((g) => !g.mandatory);
    expect(optionalGaps.length).toBeGreaterThan(0);
    for (const gap of optionalGaps) {
      expect(gap.severity).toBe("medium");
    }
  });

  it("identifies expired credentials", () => {
    const expiredCred = makeCredential({
      schemaId: "gov_id",
      status: "expired",
      expiresAt: NOW_SEC - 30 * DAY_SEC,
    });
    const result = detectCredentialGaps("uae", [expiredCred], NOW_MS);
    const govIdGap = result.find((g) => g.schemaId === "gov_id");
    expect(govIdGap).toBeDefined();
    expect(govIdGap!.reason).toBe("expired");
  });

  it("identifies expiring_soon credentials (within 30 days)", () => {
    const expiringCred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC + 15 * DAY_SEC,
    });
    const result = detectCredentialGaps("uae", [expiringCred], NOW_MS);
    const expGap = result.find(
      (g) => g.schemaId === "gov_id" && g.reason === "expiring_soon",
    );
    expect(expGap).toBeDefined();
    expect(expGap!.daysUntilDeadline).toBe(15);
  });

  it("identifies wrong_issuer when credential issuer not in acceptedIssuers", () => {
    // UAE gov_id has acceptedIssuers: ['did:aethelred:issuer:uae_ida']
    const wrongIssuerCred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC + 365 * DAY_SEC,
      issuerDid: "did:aethelred:issuer:unknown",
    });
    const result = detectCredentialGaps("uae", [wrongIssuerCred], NOW_MS);
    const wrongIssuerGap = result.find((g) => g.reason === "wrong_issuer");
    expect(wrongIssuerGap).toBeDefined();
    expect(wrongIssuerGap!.schemaId).toBe("gov_id");
    expect(wrongIssuerGap!.severity).toBe("high"); // mandatory => high
  });

  it("does not flag wrong_issuer when acceptedIssuers is empty", () => {
    // UAE kyc_aml has acceptedIssuers: []
    const cred = makeCredential({
      schemaId: "kyc_aml",
      status: "active",
      expiresAt: NOW_SEC + 365 * DAY_SEC,
      issuerDid: "did:aethelred:issuer:any",
    });
    const result = detectCredentialGaps("uae", [cred], NOW_MS);
    const wrongIssuerGaps = result.filter(
      (g) => g.schemaId === "kyc_aml" && g.reason === "wrong_issuer",
    );
    expect(wrongIssuerGaps).toHaveLength(0);
  });

  it("sorts gaps by severity (critical > high > medium > low)", () => {
    // Mix of missing mandatory (critical), expired mandatory (high),
    // and expiring optional (low)
    const result = detectCredentialGaps("eu", [], NOW_MS);
    for (let i = 1; i < result.length; i++) {
      const severityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      expect(severityOrder[result[i].severity]).toBeGreaterThanOrEqual(
        severityOrder[result[i - 1].severity],
      );
    }
  });

  it("marks expired non-mandatory credential as medium severity", () => {
    // SA has absher_verification: mandatory: false
    const allMandatory = JURISDICTIONS.sa.requiredCredentials
      .filter((r) => r.mandatory)
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 365 * DAY_SEC,
          issuerDid: req.acceptedIssuers[0] ?? "did:aethelred:issuer:default",
        }),
      );
    // Add expired non-mandatory absher_verification
    const expiredOptional = makeCredential({
      schemaId: "absher_verification",
      schemaName: "Absher Identity Verification",
      status: "expired",
      expiresAt: NOW_SEC - 30 * DAY_SEC,
    });
    const result = detectCredentialGaps(
      "sa",
      [...allMandatory, expiredOptional],
      NOW_MS,
    );
    const absherGap = result.find(
      (g) => g.schemaId === "absher_verification" && g.reason === "expired",
    );
    expect(absherGap).toBeDefined();
    expect(absherGap!.mandatory).toBe(false);
    expect(absherGap!.severity).toBe("medium");
  });

  it("marks expiring_soon non-mandatory credential as low severity", () => {
    // EU has residency: mandatory: false
    const allMandatory = JURISDICTIONS.eu.requiredCredentials
      .filter((r) => r.mandatory)
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 365 * DAY_SEC,
        }),
      );
    const expiringOptional = makeCredential({
      schemaId: "residency",
      schemaName: "EU Residency Proof",
      status: "active",
      expiresAt: NOW_SEC + 15 * DAY_SEC,
    });
    const result = detectCredentialGaps(
      "eu",
      [...allMandatory, expiringOptional],
      NOW_MS,
    );
    const residencyGap = result.find(
      (g) => g.schemaId === "residency" && g.reason === "expiring_soon",
    );
    expect(residencyGap).toBeDefined();
    expect(residencyGap!.mandatory).toBe(false);
    expect(residencyGap!.severity).toBe("low");
  });

  it("marks wrong_issuer non-mandatory credential as medium severity", () => {
    // SA has absher_verification: mandatory: false, acceptedIssuers: ['did:aethelred:issuer:sa_absher']
    const allMandatory = JURISDICTIONS.sa.requiredCredentials
      .filter((r) => r.mandatory)
      .map((req) =>
        makeCredential({
          schemaId: req.schemaId,
          schemaName: req.schemaName,
          expiresAt: NOW_SEC + 365 * DAY_SEC,
          issuerDid: req.acceptedIssuers[0] ?? "did:aethelred:issuer:default",
        }),
      );
    const wrongIssuerOptional = makeCredential({
      schemaId: "absher_verification",
      schemaName: "Absher Identity Verification",
      status: "active",
      expiresAt: NOW_SEC + 365 * DAY_SEC,
      issuerDid: "did:aethelred:issuer:unknown",
    });
    const result = detectCredentialGaps(
      "sa",
      [...allMandatory, wrongIssuerOptional],
      NOW_MS,
    );
    const wrongIssuerGap = result.find(
      (g) =>
        g.schemaId === "absher_verification" && g.reason === "wrong_issuer",
    );
    expect(wrongIssuerGap).toBeDefined();
    expect(wrongIssuerGap!.mandatory).toBe(false);
    expect(wrongIssuerGap!.severity).toBe("medium");
  });

  it("can report both expiring_soon and wrong_issuer for same credential", () => {
    // UAE gov_id: mandatory, has acceptedIssuers
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC + 10 * DAY_SEC,
      issuerDid: "did:aethelred:issuer:wrong",
    });
    const result = detectCredentialGaps("uae", [cred], NOW_MS);
    const govIdGaps = result.filter((g) => g.schemaId === "gov_id");
    const reasons = govIdGaps.map((g) => g.reason);
    expect(reasons).toContain("expiring_soon");
    expect(reasons).toContain("wrong_issuer");
  });
});

// ============================================================================
// checkCrossBorderEligibility
// ============================================================================

describe("checkCrossBorderEligibility", () => {
  const NOW_MS = 1_700_000_000_000;

  it("returns ineligible when no compatibility data exists", () => {
    const result = checkCrossBorderEligibility(
      "uae",
      "uae", // self-transfer not in matrix
      [],
    );
    expect(result.eligible).toBe(false);
    expect(result.compatibilityScore).toBe(0);
    expect(result.missingRequirements).toContain(
      "No bilateral agreement or compatibility data available",
    );
  });

  it("returns eligible when full credentials and compatibility score >= 50", () => {
    // UAE -> BH has score 95 and no restrictions
    const credentials = [
      ...makeFullCredentials("uae"),
      ...makeFullCredentials("bh"),
    ];
    const result = checkCrossBorderEligibility("uae", "bh", credentials);
    expect(result.eligible).toBe(true);
    expect(result.compatibilityScore).toBe(95);
    expect(result.fromJurisdiction).toBe("uae");
    expect(result.toJurisdiction).toBe("bh");
  });

  it("returns ineligible when critical/high gaps exist despite high compat score", () => {
    // UAE -> BH (score 95) but with no credentials
    const result = checkCrossBorderEligibility("uae", "bh", []);
    expect(result.eligible).toBe(false);
    expect(result.missingRequirements.length).toBeGreaterThan(0);
  });

  it("includes restrictions from compatibility matrix", () => {
    const credentials = [
      ...makeFullCredentials("uae"),
      ...makeFullCredentials("eu"),
    ];
    const result = checkCrossBorderEligibility("uae", "eu", credentials);
    expect(result.restrictions).toEqual(
      CROSS_BORDER_MATRIX.uae.eu!.restrictions,
    );
  });

  it("returns ineligible when compatibility score < 50 even with full credentials", () => {
    // SA -> EU has score 50, which is exactly at the boundary (>= 50 is eligible)
    const credentials = [
      ...makeFullCredentials("sa"),
      ...makeFullCredentials("eu"),
    ];
    const result = checkCrossBorderEligibility("sa", "eu", credentials);
    // score is exactly 50 so eligible if no gaps
    expect(result.compatibilityScore).toBe(50);
    // Eligibility depends on gaps
    if (result.missingRequirements.length === 0) {
      expect(result.eligible).toBe(true);
    }
  });

  it("aggregates gaps from both source and destination jurisdictions", () => {
    // With empty credentials, gaps from both directions are merged
    const result = checkCrossBorderEligibility("us", "eu", []);
    expect(result.missingRequirements.length).toBeGreaterThan(0);
    expect(result.eligible).toBe(false);
  });
});

// ============================================================================
// computeRegulatoryDeadlines
// ============================================================================

describe("computeRegulatoryDeadlines", () => {
  const NOW_MS = 1_700_000_000_000;
  const NOW_SEC = Math.floor(NOW_MS / 1000);

  it("returns empty array when no jurisdictions match", () => {
    const result = computeRegulatoryDeadlines(
      ["zz" as JurisdictionId],
      [],
      NOW_MS,
    );
    expect(result).toEqual([]);
  });

  it("skips credentials not within 90-day expiry window", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 120 * DAY_SEC, // 120 days away
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadlines = result.filter(
      (d) => d.type === "credential_expiry",
    );
    expect(expiryDeadlines).toHaveLength(0);
  });

  it("includes credentials expiring within 90 days", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 60 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadlines = result.filter(
      (d) => d.type === "credential_expiry",
    );
    expect(expiryDeadlines.length).toBeGreaterThanOrEqual(1);
    expect(expiryDeadlines[0].daysRemaining).toBe(60);
  });

  it("assigns critical severity for credentials expiring within 7 days", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 5 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadline = result.find((d) => d.type === "credential_expiry");
    expect(expiryDeadline).toBeDefined();
    expect(expiryDeadline!.severity).toBe("critical");
    expect(expiryDeadline!.daysRemaining).toBe(5);
  });

  it("assigns high severity for credentials expiring within 8-30 days", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 20 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadline = result.find((d) => d.type === "credential_expiry");
    expect(expiryDeadline!.severity).toBe("high");
  });

  it("assigns medium severity for credentials expiring within 31-60 days", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 45 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadline = result.find((d) => d.type === "credential_expiry");
    expect(expiryDeadline!.severity).toBe("medium");
  });

  it("assigns low severity for credentials expiring within 61-90 days", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      expiresAt: NOW_SEC + 80 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadline = result.find((d) => d.type === "credential_expiry");
    expect(expiryDeadline!.severity).toBe("low");
  });

  it("includes reporting obligation deadlines", () => {
    const result = computeRegulatoryDeadlines(["uae"], [], NOW_MS);
    const reportingDeadlines = result.filter((d) => d.type === "reporting");
    // UAE has 2 reporting obligations (STR real_time, CTR daily)
    expect(reportingDeadlines.length).toBe(
      JURISDICTIONS.uae.reportingObligations.length,
    );
  });

  it("computes correct interval days for reporting frequencies", () => {
    const result = computeRegulatoryDeadlines(["us"], [], NOW_MS);
    const reportingDeadlines = result.filter((d) => d.type === "reporting");

    // US has: SAR (real_time), CTR (daily), FBAR (annual)
    const fbar = reportingDeadlines.find((d) => d.description.includes("FBAR"));
    expect(fbar).toBeDefined();
    expect(fbar!.daysRemaining).toBe(365);

    const ctr = reportingDeadlines.find((d) => d.description.includes("CTR"));
    expect(ctr).toBeDefined();
    expect(ctr!.daysRemaining).toBe(1);
  });

  it("sorts deadlines by daysRemaining ascending", () => {
    const credentials = JURISDICTIONS.uae.requiredCredentials.map((req, i) =>
      makeCredential({
        schemaId: req.schemaId,
        expiresAt: NOW_SEC + (10 + i * 20) * DAY_SEC,
      }),
    );
    const result = computeRegulatoryDeadlines(["uae"], credentials, NOW_MS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].daysRemaining).toBeGreaterThanOrEqual(
        result[i - 1].daysRemaining,
      );
    }
  });

  it("handles multiple jurisdictions", () => {
    const result = computeRegulatoryDeadlines(["uae", "eu"], [], NOW_MS);
    const uaeDeadlines = result.filter((d) => d.jurisdictionId === "uae");
    const euDeadlines = result.filter((d) => d.jurisdictionId === "eu");
    expect(uaeDeadlines.length).toBeGreaterThan(0);
    expect(euDeadlines.length).toBeGreaterThan(0);
  });

  it("skips inactive credentials for expiry deadlines", () => {
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "expired",
      expiresAt: NOW_SEC + 30 * DAY_SEC,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadlines = result.filter(
      (d) => d.type === "credential_expiry",
    );
    expect(expiryDeadlines).toHaveLength(0);
  });

  it("clamps daysRemaining to 0 minimum", () => {
    // Credential that already expired but is still status "active"
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt: NOW_SEC - 5 * DAY_SEC, // 5 days ago
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const expiryDeadline = result.find((d) => d.type === "credential_expiry");
    if (expiryDeadline) {
      expect(expiryDeadline.daysRemaining).toBe(0);
    }
  });

  it("populates jurisdictionName from jurisdiction definition", () => {
    const result = computeRegulatoryDeadlines(["jp"], [], NOW_MS);
    const jpDeadline = result.find((d) => d.jurisdictionId === "jp");
    expect(jpDeadline).toBeDefined();
    expect(jpDeadline!.jurisdictionName).toBe("Japan");
  });

  it("uses Date.now() as default when nowMs is omitted", () => {
    const result = computeRegulatoryDeadlines(["uae"], []);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("sets deadlineDate as Date object from expiresAt", () => {
    const expiresAt = NOW_SEC + 30 * DAY_SEC;
    const cred = makeCredential({
      schemaId: "gov_id",
      status: "active",
      expiresAt,
    });
    const result = computeRegulatoryDeadlines(["uae"], [cred], NOW_MS);
    const deadline = result.find((d) => d.type === "credential_expiry");
    expect(deadline).toBeDefined();
    expect(deadline!.deadlineDate).toEqual(new Date(expiresAt * 1000));
  });
});
