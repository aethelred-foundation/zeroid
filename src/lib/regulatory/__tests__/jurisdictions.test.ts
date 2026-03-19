/**
 * Jurisdictions Data & Utilities — Unit Tests
 *
 * Comprehensive tests for the jurisdictions module covering:
 * - JURISDICTIONS record (all 9 jurisdictions, structure validation)
 * - CROSS_BORDER_MATRIX (pairwise compatibility, symmetry)
 * - getAllJurisdictionIds (completeness)
 * - getJurisdictionsByRegion (all 4 regions)
 * - getCrossBorderCompatibility (existing, non-existing, same pair)
 * - getJurisdictionsRequiringSchema (mandatory/optional, missing schemas)
 * - getStrictestRetentionDays (single, multiple, edge cases)
 * - getHighestKYCLevel (single, multiple, edge cases)
 */

import {
  JURISDICTIONS,
  CROSS_BORDER_MATRIX,
  getAllJurisdictionIds,
  getJurisdictionsByRegion,
  getCrossBorderCompatibility,
  getJurisdictionsRequiringSchema,
  getStrictestRetentionDays,
  getHighestKYCLevel,
} from "@/lib/regulatory/jurisdictions";
import type { JurisdictionId } from "@/lib/regulatory/jurisdictions";

// ---------------------------------------------------------------------------
// JURISDICTIONS record
// ---------------------------------------------------------------------------

describe("JURISDICTIONS", () => {
  const ALL_IDS: JurisdictionId[] = [
    "uae",
    "eu",
    "us",
    "sg",
    "uk",
    "bh",
    "sa",
    "hk",
    "jp",
  ];

  it("contains exactly 9 jurisdictions", () => {
    expect(Object.keys(JURISDICTIONS)).toHaveLength(9);
  });

  it.each(ALL_IDS)('contains jurisdiction "%s"', (id) => {
    expect(JURISDICTIONS[id]).toBeDefined();
    expect(JURISDICTIONS[id].id).toBe(id);
  });

  it.each(ALL_IDS)('jurisdiction "%s" has required structural fields', (id) => {
    const j = JURISDICTIONS[id];
    expect(j.name).toBeTruthy();
    expect(j.code).toBeTruthy();
    expect(["mena", "eu", "americas", "apac"]).toContain(j.region);
    expect(j.regulatoryAuthority).toBeTruthy();
    expect(j.authorityAcronym).toBeTruthy();
    expect(j.authorityUrl).toMatch(/^https?:\/\//);
    expect(j.frameworks.length).toBeGreaterThan(0);
    expect(j.requiredCredentials.length).toBeGreaterThan(0);
    expect(j.dataRetentionDays).toBeGreaterThan(0);
    expect(j.consentRequirements.length).toBeGreaterThan(0);
    expect(j.reportingObligations.length).toBeGreaterThan(0);
    expect(j.kycLevel).toBeGreaterThanOrEqual(1);
    expect(j.specialConditions.length).toBeGreaterThan(0);
  });

  it.each(ALL_IDS)('jurisdiction "%s" scoring weights sum to ~1.0', (id) => {
    const w = JURISDICTIONS[id].scoringWeights;
    const sum =
      w.credentialCoverage +
      w.credentialFreshness +
      w.consentCompliance +
      w.reportingCompliance +
      w.dataResidency;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it.each(ALL_IDS)(
    'jurisdiction "%s" credential requirements have valid structure',
    (id) => {
      for (const cred of JURISDICTIONS[id].requiredCredentials) {
        expect(cred.schemaId).toBeTruthy();
        expect(cred.schemaName).toBeTruthy();
        expect(typeof cred.mandatory).toBe("boolean");
        expect(cred.validityPeriodDays).toBeGreaterThan(0);
        expect(Array.isArray(cred.acceptedIssuers)).toBe(true);
        expect(cred.renewalBufferDays).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('UAE has region "mena"', () => {
    expect(JURISDICTIONS.uae.region).toBe("mena");
  });

  it('EU has region "eu"', () => {
    expect(JURISDICTIONS.eu.region).toBe("eu");
  });

  it('US has region "americas"', () => {
    expect(JURISDICTIONS.us.region).toBe("americas");
  });

  it('Singapore has region "apac"', () => {
    expect(JURISDICTIONS.sg.region).toBe("apac");
  });

  it('UK has region "eu"', () => {
    expect(JURISDICTIONS.uk.region).toBe("eu");
  });

  it("Saudi Arabia has the highest retention days (3650)", () => {
    expect(JURISDICTIONS.sa.dataRetentionDays).toBe(3650);
  });

  it("Bahrain has kycLevel 2 (lower than others)", () => {
    expect(JURISDICTIONS.bh.kycLevel).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CROSS_BORDER_MATRIX
// ---------------------------------------------------------------------------

describe("CROSS_BORDER_MATRIX", () => {
  it("has entries for all 9 jurisdictions", () => {
    const ids = getAllJurisdictionIds();
    for (const id of ids) {
      expect(CROSS_BORDER_MATRIX[id]).toBeDefined();
    }
  });

  it("GCC countries have high compatibility (>=90)", () => {
    expect(CROSS_BORDER_MATRIX.uae.bh?.score).toBeGreaterThanOrEqual(90);
    expect(CROSS_BORDER_MATRIX.uae.sa?.score).toBeGreaterThanOrEqual(90);
    expect(CROSS_BORDER_MATRIX.bh.uae?.score).toBeGreaterThanOrEqual(90);
    expect(CROSS_BORDER_MATRIX.bh.sa?.score).toBeGreaterThanOrEqual(90);
    expect(CROSS_BORDER_MATRIX.sa.uae?.score).toBeGreaterThanOrEqual(90);
    expect(CROSS_BORDER_MATRIX.sa.bh?.score).toBeGreaterThanOrEqual(90);
  });

  it("EU-Japan have high compatibility due to adequacy decision", () => {
    expect(CROSS_BORDER_MATRIX.eu.jp?.score).toBeGreaterThanOrEqual(85);
    expect(CROSS_BORDER_MATRIX.jp.eu?.score).toBeGreaterThanOrEqual(85);
  });

  it("compatibility entries have valid score range (0-100)", () => {
    for (const fromId of getAllJurisdictionIds()) {
      const entries = CROSS_BORDER_MATRIX[fromId];
      for (const toId of Object.keys(entries) as JurisdictionId[]) {
        const compat = entries[toId];
        if (compat) {
          expect(compat.score).toBeGreaterThanOrEqual(0);
          expect(compat.score).toBeLessThanOrEqual(100);
          expect(Array.isArray(compat.restrictions)).toBe(true);
          expect(Array.isArray(compat.bilateralAgreements)).toBe(true);
          expect(Array.isArray(compat.additionalRequirements)).toBe(true);
        }
      }
    }
  });

  it("does not have self-referencing entries", () => {
    for (const id of getAllJurisdictionIds()) {
      expect(CROSS_BORDER_MATRIX[id][id]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// getAllJurisdictionIds
// ---------------------------------------------------------------------------

describe("getAllJurisdictionIds", () => {
  it("returns all 9 jurisdiction IDs", () => {
    const ids = getAllJurisdictionIds();
    expect(ids).toHaveLength(9);
    expect(ids).toContain("uae");
    expect(ids).toContain("eu");
    expect(ids).toContain("us");
    expect(ids).toContain("sg");
    expect(ids).toContain("uk");
    expect(ids).toContain("bh");
    expect(ids).toContain("sa");
    expect(ids).toContain("hk");
    expect(ids).toContain("jp");
  });

  it("returns strings (not objects)", () => {
    const ids = getAllJurisdictionIds();
    ids.forEach((id) => {
      expect(typeof id).toBe("string");
    });
  });
});

// ---------------------------------------------------------------------------
// getJurisdictionsByRegion
// ---------------------------------------------------------------------------

describe("getJurisdictionsByRegion", () => {
  it("returns MENA jurisdictions (uae, bh, sa)", () => {
    const mena = getJurisdictionsByRegion("mena");
    const ids = mena.map((j) => j.id);
    expect(ids).toContain("uae");
    expect(ids).toContain("bh");
    expect(ids).toContain("sa");
    expect(ids).toHaveLength(3);
  });

  it("returns EU jurisdictions (eu, uk)", () => {
    const eu = getJurisdictionsByRegion("eu");
    const ids = eu.map((j) => j.id);
    expect(ids).toContain("eu");
    expect(ids).toContain("uk");
    expect(ids).toHaveLength(2);
  });

  it("returns Americas jurisdictions (us)", () => {
    const americas = getJurisdictionsByRegion("americas");
    const ids = americas.map((j) => j.id);
    expect(ids).toContain("us");
    expect(ids).toHaveLength(1);
  });

  it("returns APAC jurisdictions (sg, hk, jp)", () => {
    const apac = getJurisdictionsByRegion("apac");
    const ids = apac.map((j) => j.id);
    expect(ids).toContain("sg");
    expect(ids).toContain("hk");
    expect(ids).toContain("jp");
    expect(ids).toHaveLength(3);
  });

  it("returns empty array for non-existent region", () => {
    const result = getJurisdictionsByRegion("africa" as any);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getCrossBorderCompatibility
// ---------------------------------------------------------------------------

describe("getCrossBorderCompatibility", () => {
  it("returns compatibility for UAE->EU", () => {
    const compat = getCrossBorderCompatibility("uae", "eu");
    expect(compat).not.toBeNull();
    expect(compat!.score).toBe(65);
    expect(compat!.restrictions.length).toBeGreaterThan(0);
  });

  it("returns compatibility for US->UK", () => {
    const compat = getCrossBorderCompatibility("us", "uk");
    expect(compat).not.toBeNull();
    expect(compat!.score).toBe(85);
  });

  it("returns null for same jurisdiction (no self-entry)", () => {
    const compat = getCrossBorderCompatibility("uae", "uae");
    expect(compat).toBeNull();
  });

  it("returns null for non-existing pair", () => {
    // CROSS_BORDER_MATRIX has entries for all pairs, but check behavior
    const compat = getCrossBorderCompatibility(
      "invalid" as JurisdictionId,
      "uae",
    );
    expect(compat).toBeNull();
  });

  it("returns bilateral agreements when present", () => {
    const compat = getCrossBorderCompatibility("uae", "sg");
    expect(compat).not.toBeNull();
    expect(compat!.bilateralAgreements).toContain("UAE-Singapore CEPA");
  });

  it("returns additional requirements when present", () => {
    const compat = getCrossBorderCompatibility("eu", "uae");
    expect(compat).not.toBeNull();
    expect(compat!.additionalRequirements).toContain(
      "Standard Contractual Clauses",
    );
  });
});

// ---------------------------------------------------------------------------
// getJurisdictionsRequiringSchema
// ---------------------------------------------------------------------------

describe("getJurisdictionsRequiringSchema", () => {
  it('returns all jurisdictions requiring "gov_id" schema', () => {
    const result = getJurisdictionsRequiringSchema("gov_id");
    // All 9 jurisdictions require gov_id
    expect(result.length).toBe(9);
  });

  it('returns all jurisdictions requiring "kyc_aml" schema', () => {
    const result = getJurisdictionsRequiringSchema("kyc_aml");
    expect(result.length).toBe(9);
  });

  it("returns only jurisdictions where schema is mandatory when mandatoryOnly=true", () => {
    // "residency" is mandatory in some but not all (EU has mandatory: false)
    const all = getJurisdictionsRequiringSchema("residency");
    const mandatory = getJurisdictionsRequiringSchema("residency", true);

    expect(mandatory.length).toBeLessThanOrEqual(all.length);
    mandatory.forEach((j) => {
      const cred = j.requiredCredentials.find(
        (r) => r.schemaId === "residency",
      );
      expect(cred?.mandatory).toBe(true);
    });
  });

  it("returns empty for non-existent schema", () => {
    const result = getJurisdictionsRequiringSchema("nonexistent_schema");
    expect(result).toHaveLength(0);
  });

  it("includes non-mandatory results when mandatoryOnly=false (default)", () => {
    const result = getJurisdictionsRequiringSchema("eidas_qualified");
    // Only EU has eIDAS qualified, and it is mandatory: false
    expect(result.length).toBeGreaterThanOrEqual(1);
    const eu = result.find((j) => j.id === "eu");
    expect(eu).toBeDefined();
  });

  it("excludes non-mandatory results when mandatoryOnly=true", () => {
    const result = getJurisdictionsRequiringSchema("eidas_qualified", true);
    // eIDAS qualified is not mandatory anywhere
    expect(result).toHaveLength(0);
  });

  it('finds US-specific "ssn_verification" schema', () => {
    const result = getJurisdictionsRequiringSchema("ssn_verification");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("us");
  });

  it('finds US-specific "ofac_screen" schema', () => {
    const result = getJurisdictionsRequiringSchema("ofac_screen");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("us");
  });

  it('finds SA-specific "absher_verification" schema', () => {
    const result = getJurisdictionsRequiringSchema("absher_verification");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("sa");
  });

  it('finds HK "professional_investor" schema', () => {
    const result = getJurisdictionsRequiringSchema("professional_investor");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hk");
  });
});

// ---------------------------------------------------------------------------
// getStrictestRetentionDays
// ---------------------------------------------------------------------------

describe("getStrictestRetentionDays", () => {
  it("returns the max retention days for a single jurisdiction", () => {
    expect(getStrictestRetentionDays(["uae"])).toBe(1825);
  });

  it("returns the max across multiple jurisdictions", () => {
    // SA = 3650, UAE = 1825
    expect(getStrictestRetentionDays(["uae", "sa"])).toBe(3650);
  });

  it("returns SA retention as strictest among all jurisdictions", () => {
    const allIds = getAllJurisdictionIds();
    expect(getStrictestRetentionDays(allIds)).toBe(3650);
  });

  it("returns HK retention (2190) correctly", () => {
    expect(getStrictestRetentionDays(["hk"])).toBe(2190);
  });

  it("returns JP retention (2555) correctly", () => {
    expect(getStrictestRetentionDays(["jp"])).toBe(2555);
  });

  it("returns -Infinity for empty array", () => {
    // Math.max(...[]) returns -Infinity
    expect(getStrictestRetentionDays([])).toBe(-Infinity);
  });

  it("handles unknown jurisdiction ID gracefully (defaults to 0)", () => {
    const result = getStrictestRetentionDays(["unknown" as JurisdictionId]);
    expect(result).toBe(0);
  });

  it("picks correct max when mixing known and unknown", () => {
    const result = getStrictestRetentionDays([
      "unknown" as JurisdictionId,
      "uae",
    ]);
    expect(result).toBe(1825);
  });
});

// ---------------------------------------------------------------------------
// getHighestKYCLevel
// ---------------------------------------------------------------------------

describe("getHighestKYCLevel", () => {
  it("returns KYC level for a single jurisdiction", () => {
    expect(getHighestKYCLevel(["bh"])).toBe(2);
  });

  it("returns the max KYC level across multiple jurisdictions", () => {
    // BH = 2, UAE = 3
    expect(getHighestKYCLevel(["bh", "uae"])).toBe(3);
  });

  it("returns 3 for most jurisdictions", () => {
    expect(getHighestKYCLevel(["uae"])).toBe(3);
    expect(getHighestKYCLevel(["eu"])).toBe(3);
    expect(getHighestKYCLevel(["us"])).toBe(3);
    expect(getHighestKYCLevel(["sg"])).toBe(3);
    expect(getHighestKYCLevel(["uk"])).toBe(3);
    expect(getHighestKYCLevel(["sa"])).toBe(3);
    expect(getHighestKYCLevel(["hk"])).toBe(3);
    expect(getHighestKYCLevel(["jp"])).toBe(3);
  });

  it("returns BH KYC level 2 when only BH is provided", () => {
    expect(getHighestKYCLevel(["bh"])).toBe(2);
  });

  it("returns -Infinity for empty array", () => {
    expect(getHighestKYCLevel([])).toBe(-Infinity);
  });

  it("handles unknown jurisdiction ID gracefully (defaults to 0)", () => {
    expect(getHighestKYCLevel(["unknown" as JurisdictionId])).toBe(0);
  });

  it("picks correct max when mixing known and unknown", () => {
    expect(getHighestKYCLevel(["unknown" as JurisdictionId, "bh"])).toBe(2);
  });

  it("returns 3 when all jurisdictions are included", () => {
    const allIds = getAllJurisdictionIds();
    expect(getHighestKYCLevel(allIds)).toBe(3);
  });
});
