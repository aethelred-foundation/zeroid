/**
 * Tests for Client-Side Risk Model
 *
 * Covers: extractFeatures, forwardPass, decomposeRiskFactors, makeDecision,
 * computeRiskTrend, predictRisk.
 */

import {
  extractFeatures,
  forwardPass,
  decomposeRiskFactors,
  makeDecision,
  computeRiskTrend,
  predictRisk,
  type IdentityData,
  type RiskFactorDecomposition,
} from "@/lib/ai/risk-model";

// ============================================================================
// Helpers
// ============================================================================

/** Create an IdentityData instance with sensible defaults. */
function makeIdentityData(overrides: Partial<IdentityData> = {}): IdentityData {
  return {
    accountAgeDays: 365,
    credentialCount: 10,
    activeCredentialCount: 8,
    expiredCredentialCount: 1,
    revokedCredentialCount: 1,
    verificationCount: 20,
    failedVerificationCount: 2,
    jurisdictionCount: 3,
    crossBorderTransferCount: 5,
    averageCredentialAgeDays: 90,
    biometricEnrolled: true,
    delegationCount: 2,
    lastActivityDays: 1,
    transactionVolume: 50_000,
    uniqueVerifiers: 10,
    zkProofUsageRatio: 0.6,
    ...overrides,
  };
}

/** Create a minimal / zero identity to test edge cases. */
function makeZeroIdentityData(): IdentityData {
  return {
    accountAgeDays: 0,
    credentialCount: 0,
    activeCredentialCount: 0,
    expiredCredentialCount: 0,
    revokedCredentialCount: 0,
    verificationCount: 0,
    failedVerificationCount: 0,
    jurisdictionCount: 0,
    crossBorderTransferCount: 0,
    averageCredentialAgeDays: 0,
    biometricEnrolled: false,
    delegationCount: 0,
    lastActivityDays: 0,
    transactionVolume: 0,
    uniqueVerifiers: 0,
    zkProofUsageRatio: 0,
  };
}

/** Helper to create factor stubs for makeDecision tests. */
function makeFactors(
  overrides: Partial<RiskFactorDecomposition>[] = [],
): RiskFactorDecomposition[] {
  return overrides.map((o) => ({
    name: "Test Factor",
    contribution: 0.05,
    rawValue: 0.5,
    normalizedValue: 0.5,
    direction: "neutral" as const,
    description: "test",
    ...o,
  }));
}

// ============================================================================
// extractFeatures
// ============================================================================

describe("extractFeatures", () => {
  it("returns a Float32Array of length 16", () => {
    const features = extractFeatures(makeIdentityData());
    expect(features).toBeInstanceOf(Float32Array);
    expect(features.length).toBe(16);
  });

  it("normalizes all features to [0, 1] range", () => {
    const features = extractFeatures(makeIdentityData());
    for (let i = 0; i < features.length; i++) {
      expect(features[i]).toBeGreaterThanOrEqual(0);
      expect(features[i]).toBeLessThanOrEqual(1);
    }
  });

  it("handles zero credential count without division by zero", () => {
    const data = makeZeroIdentityData();
    const features = extractFeatures(data);
    // F2: active ratio = 0 (credentialCount is 0)
    expect(features[2]).toBe(0);
    // F3: revoked ratio = 0
    expect(features[3]).toBe(0);
    // F14: credential concentration = 1 (1/max(0,1))
    expect(features[14]).toBe(1);
  });

  it("handles zero verifications by defaulting success rate to 0.5", () => {
    const data = makeIdentityData({
      verificationCount: 0,
      failedVerificationCount: 0,
    });
    const features = extractFeatures(data);
    // F4: verification success rate = 0.5 when no verifications
    expect(features[4]).toBe(0.5);
  });

  it("computes active credential ratio correctly", () => {
    const data = makeIdentityData({
      credentialCount: 10,
      activeCredentialCount: 7,
    });
    const features = extractFeatures(data);
    expect(features[2]).toBeCloseTo(0.7, 5);
  });

  it("computes revoked credential ratio correctly", () => {
    const data = makeIdentityData({
      credentialCount: 10,
      revokedCredentialCount: 3,
    });
    const features = extractFeatures(data);
    expect(features[3]).toBeCloseTo(0.3, 5);
  });

  it("computes verification success rate correctly", () => {
    const data = makeIdentityData({
      verificationCount: 18,
      failedVerificationCount: 2,
    });
    const features = extractFeatures(data);
    // 18 / (18+2) = 0.9
    expect(features[4]).toBeCloseTo(0.9, 5);
  });

  it("sets biometric feature to 1 when enrolled, 0 otherwise", () => {
    const enrolled = extractFeatures(
      makeIdentityData({ biometricEnrolled: true }),
    );
    expect(enrolled[8]).toBe(1);

    const notEnrolled = extractFeatures(
      makeIdentityData({ biometricEnrolled: false }),
    );
    expect(notEnrolled[8]).toBe(0);
  });

  it("normalizes account age to [0, 1] with max 1825 days", () => {
    const maxAge = extractFeatures(makeIdentityData({ accountAgeDays: 1825 }));
    expect(maxAge[0]).toBeCloseTo(1, 5);

    const halfAge = extractFeatures(makeIdentityData({ accountAgeDays: 912 }));
    expect(halfAge[0]).toBeCloseTo(912 / 1825, 4);

    const overMax = extractFeatures(makeIdentityData({ accountAgeDays: 3000 }));
    expect(overMax[0]).toBe(1); // clamped
  });

  it("computes credential freshness as inverse of normalized average age", () => {
    // F7 = 1 - normalize(averageCredentialAgeDays, 0, 365)
    const data = makeIdentityData({ averageCredentialAgeDays: 180 });
    const features = extractFeatures(data);
    expect(features[7]).toBeCloseTo(1 - 180 / 365, 4);
  });

  it("computes transaction velocity normalized by account age", () => {
    // F11 = normalize(transactionVolume / max(accountAgeDays, 1), 0, 1000)
    const data = makeIdentityData({
      transactionVolume: 100_000,
      accountAgeDays: 200,
    });
    const features = extractFeatures(data);
    const velocity = 100_000 / 200;
    expect(features[11]).toBeCloseTo(velocity / 1000, 4);
  });

  it("clamps values that exceed normalization range", () => {
    const data = makeIdentityData({
      credentialCount: 100, // exceeds max of 50
      jurisdictionCount: 50, // exceeds max of 20
    });
    const features = extractFeatures(data);
    expect(features[1]).toBe(1); // clamped at 1
    expect(features[5]).toBe(1); // clamped at 1
  });

  it("computes maturity score as composite of age, creds, verifications, biometric", () => {
    const data = makeIdentityData({
      accountAgeDays: 365,
      activeCredentialCount: 5,
      verificationCount: 10,
      biometricEnrolled: true,
    });
    const features = extractFeatures(data);
    // maturity = min(365/365,1)*0.3 + min(5/5,1)*0.3 + min(10/10,1)*0.2 + 0.2 = 1.0
    expect(features[15]).toBeCloseTo(1.0, 5);
  });

  it("maturity score is 0 for completely new zero-data identity", () => {
    const features = extractFeatures(makeZeroIdentityData());
    // age=0, active=0, verify=0, bio=false => 0
    expect(features[15]).toBe(0);
  });

  it("computes credential concentration correctly", () => {
    // F14 = 1/max(activeCredentialCount, 1) when active > 0
    const data = makeIdentityData({ activeCredentialCount: 4 });
    const features = extractFeatures(data);
    expect(features[14]).toBeCloseTo(0.25, 5);
  });

  it("uses zkProofUsageRatio directly as F13", () => {
    const data = makeIdentityData({ zkProofUsageRatio: 0.85 });
    const features = extractFeatures(data);
    expect(features[13]).toBeCloseTo(0.85);
  });
});

// ============================================================================
// forwardPass
// ============================================================================

describe("forwardPass", () => {
  it("returns a number in [0, 1] range", () => {
    const features = extractFeatures(makeIdentityData());
    const score = forwardPass(features);
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns a value in [0, 1] for zero-vector input", () => {
    const features = new Float32Array(16).fill(0);
    const score = forwardPass(features);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns a value in [0, 1] for all-ones input", () => {
    const features = new Float32Array(16).fill(1);
    const score = forwardPass(features);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("is deterministic (same input produces same output)", () => {
    const features = extractFeatures(makeIdentityData());
    const score1 = forwardPass(features);
    const score2 = forwardPass(features);
    expect(score1).toBe(score2);
  });

  it("produces different scores for different inputs", () => {
    const lowRisk = extractFeatures(makeIdentityData());
    const highRisk = extractFeatures(makeZeroIdentityData());
    const scoreLow = forwardPass(lowRisk);
    const scoreHigh = forwardPass(highRisk);
    expect(scoreLow).not.toBe(scoreHigh);
  });

  it("handles extreme feature values without NaN or Infinity", () => {
    const features = new Float32Array(16).fill(0.99999);
    const score = forwardPass(features);
    expect(Number.isFinite(score)).toBe(true);
    expect(Number.isNaN(score)).toBe(false);
  });
});

// ============================================================================
// decomposeRiskFactors
// ============================================================================

describe("decomposeRiskFactors", () => {
  it("returns 16 factor decompositions (one per feature)", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    expect(factors).toHaveLength(16);
  });

  it("assigns correct feature names to each factor", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    const names = factors.map((f) => f.name);
    expect(names).toContain("Account Age");
    expect(names).toContain("Credential Count");
    expect(names).toContain("Biometric Enrollment");
    expect(names).toContain("ZK Proof Adoption");
    expect(names).toContain("Account Maturity");
  });

  it("contributions are computed via perturbation (baseScore - perturbedScore)", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);

    // Verify at least some contributions are non-zero
    const nonZeroContributions = factors.filter((f) => f.contribution !== 0);
    expect(nonZeroContributions.length).toBeGreaterThan(0);
  });

  it("rounds contributions to 3 decimal places", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    for (const f of factors) {
      const rounded = Math.round(f.contribution * 1000) / 1000;
      expect(f.contribution).toBe(rounded);
    }
  });

  it("sorts factors by absolute contribution descending", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    for (let i = 1; i < factors.length; i++) {
      expect(Math.abs(factors[i].contribution)).toBeLessThanOrEqual(
        Math.abs(factors[i - 1].contribution),
      );
    }
  });

  it("sets direction to increases_risk for risk-increasing features with value > 0.5", () => {
    // Risk-increasing features: indices 3, 5, 6, 9, 10, 11, 14
    // Force high values on risk-increasing features
    const data = makeIdentityData({
      revokedCredentialCount: 8, // high ratio
      credentialCount: 10,
      jurisdictionCount: 15, // high
      crossBorderTransferCount: 80, // high
      delegationCount: 15, // high
      lastActivityDays: 300, // high inactivity
    });
    const features = extractFeatures(data);
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);

    const revokedFactor = factors.find(
      (f) => f.name === "Revoked Credential Ratio",
    );
    if (revokedFactor && revokedFactor.rawValue > 0.5) {
      expect(revokedFactor.direction).toBe("increases_risk");
    }
  });

  it("sets direction to decreases_risk for risk-decreasing features with value > 0.5", () => {
    const data = makeIdentityData({
      accountAgeDays: 1200,
      biometricEnrolled: true,
      zkProofUsageRatio: 0.9,
    });
    const features = extractFeatures(data);
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);

    const bioFactor = factors.find((f) => f.name === "Biometric Enrollment");
    if (bioFactor && bioFactor.rawValue > 0.5) {
      expect(bioFactor.direction).toBe("decreases_risk");
    }
  });

  it("provides human-readable descriptions for each factor", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    for (const f of factors) {
      expect(typeof f.description).toBe("string");
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it("rawValue and normalizedValue match the original feature values", () => {
    const features = extractFeatures(makeIdentityData());
    const baseScore = forwardPass(features);
    const factors = decomposeRiskFactors(features, baseScore);
    // Both rawValue and normalizedValue should equal the feature value
    for (const f of factors) {
      expect(f.rawValue).toBe(f.normalizedValue);
    }
  });
});

// ============================================================================
// makeDecision
// ============================================================================

describe("makeDecision", () => {
  const emptyFactors: RiskFactorDecomposition[] = [];

  it('returns "block" for score >= 0.90', () => {
    const decision = makeDecision(0.9, emptyFactors);
    expect(decision.action).toBe("block");
    expect(decision.thresholdApplied).toBe(0.9);
    expect(decision.requiresHumanReview).toBe(true);
    expect(decision.reason).toContain("critical");
    expect(decision.suggestedActions.length).toBe(3);
  });

  it('returns "block" for score = 0.95', () => {
    const decision = makeDecision(0.95, emptyFactors);
    expect(decision.action).toBe("block");
  });

  it('returns "block" for score = 1.0', () => {
    const decision = makeDecision(1.0, emptyFactors);
    expect(decision.action).toBe("block");
  });

  it('returns "enhanced_due_diligence" for score in [0.75, 0.90)', () => {
    const decision = makeDecision(0.75, emptyFactors);
    expect(decision.action).toBe("enhanced_due_diligence");
    expect(decision.thresholdApplied).toBe(0.75);
    expect(decision.requiresHumanReview).toBe(true);
  });

  it('returns "enhanced_due_diligence" for score = 0.89', () => {
    const decision = makeDecision(0.89, emptyFactors);
    expect(decision.action).toBe("enhanced_due_diligence");
  });

  it("includes top risk factor names in EDD reason", () => {
    const factors = makeFactors([
      {
        name: "Delegation Exposure",
        direction: "increases_risk",
        contribution: 0.2,
      },
      {
        name: "Account Inactivity",
        direction: "increases_risk",
        contribution: 0.15,
      },
      {
        name: "Credential Count",
        direction: "decreases_risk",
        contribution: -0.05,
      },
    ]);
    const decision = makeDecision(0.8, factors);
    expect(decision.reason).toContain("Delegation Exposure");
    expect(decision.reason).toContain("Account Inactivity");
  });

  it('returns "review" for score in [0.50, 0.75)', () => {
    const decision = makeDecision(0.5, emptyFactors);
    expect(decision.action).toBe("review");
    expect(decision.thresholdApplied).toBe(0.5);
    expect(decision.requiresHumanReview).toBe(false);
  });

  it('returns "review" for score = 0.74', () => {
    const decision = makeDecision(0.74, emptyFactors);
    expect(decision.action).toBe("review");
  });

  it('returns "allow" for score < 0.50', () => {
    const decision = makeDecision(0.49, emptyFactors);
    expect(decision.action).toBe("allow");
    expect(decision.thresholdApplied).toBe(0.25);
    expect(decision.requiresHumanReview).toBe(false);
  });

  it('returns "allow" for score = 0.0', () => {
    const decision = makeDecision(0.0, emptyFactors);
    expect(decision.action).toBe("allow");
  });

  it('returns "allow" for score = 0.25', () => {
    const decision = makeDecision(0.25, emptyFactors);
    expect(decision.action).toBe("allow");
  });

  it("always provides suggestedActions array", () => {
    for (const score of [0.0, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      const decision = makeDecision(score, emptyFactors);
      expect(Array.isArray(decision.suggestedActions)).toBe(true);
      expect(decision.suggestedActions.length).toBeGreaterThan(0);
    }
  });

  it("EDD decision limits top risk factors to 3", () => {
    const factors = makeFactors([
      { name: "Factor A", direction: "increases_risk" },
      { name: "Factor B", direction: "increases_risk" },
      { name: "Factor C", direction: "increases_risk" },
      { name: "Factor D", direction: "increases_risk" },
      { name: "Factor E", direction: "increases_risk" },
    ]);
    const decision = makeDecision(0.8, factors);
    // Reason should mention at most 3 factor names
    const matches = decision.reason.match(/Factor [A-E]/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// computeRiskTrend
// ============================================================================

describe("computeRiskTrend", () => {
  it("returns stable with velocity 0 for fewer than 2 historical scores", () => {
    const trend = computeRiskTrend(0.5, []);
    expect(trend.direction).toBe("stable");
    expect(trend.velocity).toBe(0);
    expect(trend.projectedScore30d).toBe(0.5);
    expect(trend.historicalScores).toEqual([]);
  });

  it("returns stable for single historical score", () => {
    const history = [{ timestamp: 1000, score: 0.3 }];
    const trend = computeRiskTrend(0.3, history);
    expect(trend.direction).toBe("stable");
    expect(trend.velocity).toBe(0);
    expect(trend.projectedScore30d).toBe(0.3);
  });

  it("detects deteriorating trend (increasing scores over time)", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.2 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.3 },
      { timestamp: 1_000_000 + 60 * 86400, score: 0.4 },
      { timestamp: 1_000_000 + 90 * 86400, score: 0.5 },
    ];
    const trend = computeRiskTrend(0.5, history);
    expect(trend.direction).toBe("deteriorating");
    expect(trend.velocity).toBeGreaterThan(0.001);
  });

  it("detects improving trend (decreasing scores over time)", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.8 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.6 },
      { timestamp: 1_000_000 + 60 * 86400, score: 0.4 },
      { timestamp: 1_000_000 + 90 * 86400, score: 0.2 },
    ];
    const trend = computeRiskTrend(0.2, history);
    expect(trend.direction).toBe("improving");
    expect(trend.velocity).toBeLessThan(-0.001);
  });

  it("returns stable when velocity is within [-0.001, 0.001]", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.5 },
      { timestamp: 1_000_000 + 90 * 86400, score: 0.501 },
    ];
    const trend = computeRiskTrend(0.501, history);
    // Very small change over 90 days, velocity should be near 0
    expect(trend.direction).toBe("stable");
  });

  it("sorts historical scores by timestamp ascending", () => {
    const history = [
      { timestamp: 3_000_000, score: 0.5 },
      { timestamp: 1_000_000, score: 0.3 },
      { timestamp: 2_000_000, score: 0.4 },
    ];
    const trend = computeRiskTrend(0.5, history);
    for (let i = 1; i < trend.historicalScores.length; i++) {
      expect(trend.historicalScores[i].timestamp).toBeGreaterThan(
        trend.historicalScores[i - 1].timestamp,
      );
    }
  });

  it("projects 30-day score clamped to [0, 1]", () => {
    // Rapidly deteriorating trend that would project beyond 1
    const history = [
      { timestamp: 1_000_000, score: 0.7 },
      { timestamp: 1_000_000 + 10 * 86400, score: 0.95 },
    ];
    const trend = computeRiskTrend(0.95, history);
    expect(trend.projectedScore30d).toBeLessThanOrEqual(1);
    expect(trend.projectedScore30d).toBeGreaterThanOrEqual(0);
  });

  it("projects 30-day score clamped to 0 for rapidly improving trend", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.3 },
      { timestamp: 1_000_000 + 10 * 86400, score: 0.05 },
    ];
    const trend = computeRiskTrend(0.05, history);
    expect(trend.projectedScore30d).toBeGreaterThanOrEqual(0);
  });

  it("rounds velocity to 4 decimal places", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.3 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.4 },
    ];
    const trend = computeRiskTrend(0.4, history);
    const rounded = Math.round(trend.velocity * 10000) / 10000;
    expect(trend.velocity).toBe(rounded);
  });

  it("rounds projected score to 3 decimal places", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.3 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.4 },
      { timestamp: 1_000_000 + 60 * 86400, score: 0.5 },
    ];
    const trend = computeRiskTrend(0.5, history);
    const rounded = Math.round(trend.projectedScore30d * 1000) / 1000;
    expect(trend.projectedScore30d).toBe(rounded);
  });

  it("handles denominator === 0 when all timestamps are identical", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.3 },
      { timestamp: 1_000_000, score: 0.5 },
      { timestamp: 1_000_000, score: 0.4 },
    ];
    const trend = computeRiskTrend(0.4, history);
    // When denominator is 0, slope = 0, intercept = currentScore
    expect(trend.direction).toBe("stable");
    expect(trend.velocity).toBe(0);
    expect(Number.isFinite(trend.projectedScore30d)).toBe(true);
  });

  it("handles exactly 2 data points (minimum for regression)", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.2 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.6 },
    ];
    const trend = computeRiskTrend(0.6, history);
    expect(trend.direction).toBe("deteriorating");
    expect(trend.velocity).toBeGreaterThan(0);
  });
});

// ============================================================================
// predictRisk (end-to-end)
// ============================================================================

describe("predictRisk", () => {
  it("returns all expected fields in RiskPrediction", () => {
    const data = makeIdentityData();
    const prediction = predictRisk(data);

    expect(typeof prediction.score).toBe("number");
    expect(prediction.score).toBeGreaterThanOrEqual(0);
    expect(prediction.score).toBeLessThanOrEqual(1);
    expect(["low", "medium", "high", "critical"]).toContain(prediction.level);
    expect(typeof prediction.confidence).toBe("number");
    expect(prediction.confidence).toBeGreaterThanOrEqual(0.5);
    expect(prediction.confidence).toBeLessThanOrEqual(0.99);
    expect(Array.isArray(prediction.factors)).toBe(true);
    expect(prediction.factors).toHaveLength(16);
    expect(prediction.decision).toBeDefined();
    expect(prediction.decision.action).toBeDefined();
    expect(prediction.trend).toBeDefined();
    expect(prediction.modelInfo).toBeDefined();
  });

  it("rounds score to 3 decimal places", () => {
    const prediction = predictRisk(makeIdentityData());
    const rounded = Math.round(prediction.score * 1000) / 1000;
    expect(prediction.score).toBe(rounded);
  });

  it("rounds confidence to 3 decimal places", () => {
    const prediction = predictRisk(makeIdentityData());
    const rounded = Math.round(prediction.confidence * 1000) / 1000;
    expect(prediction.confidence).toBe(rounded);
  });

  it("confidence is higher when more features are non-zero", () => {
    const fullData = makeIdentityData();
    const sparseData = makeZeroIdentityData();

    const fullPred = predictRisk(fullData);
    const sparsePred = predictRisk(sparseData);

    expect(fullPred.confidence).toBeGreaterThan(sparsePred.confidence);
  });

  it("confidence does not exceed 0.99", () => {
    const data = makeIdentityData({
      accountAgeDays: 1000,
      credentialCount: 20,
      activeCredentialCount: 15,
      expiredCredentialCount: 3,
      revokedCredentialCount: 2,
      verificationCount: 50,
      failedVerificationCount: 5,
      jurisdictionCount: 10,
      crossBorderTransferCount: 30,
      averageCredentialAgeDays: 100,
      biometricEnrolled: true,
      delegationCount: 5,
      lastActivityDays: 10,
      transactionVolume: 200_000,
      uniqueVerifiers: 25,
      zkProofUsageRatio: 0.8,
    });
    const prediction = predictRisk(data);
    expect(prediction.confidence).toBeLessThanOrEqual(0.99);
  });

  it("returns model metadata with correct architecture", () => {
    const prediction = predictRisk(makeIdentityData());
    expect(prediction.modelInfo.version).toBe("2.1.0");
    expect(prediction.modelInfo.featureCount).toBe(16);
    expect(prediction.modelInfo.architecture).toContain("16-32-16-1");
  });

  it("level matches score thresholds", () => {
    const prediction = predictRisk(makeIdentityData());
    if (prediction.score >= 0.9) {
      expect(prediction.level).toBe("critical");
    } else if (prediction.score >= 0.75) {
      expect(prediction.level).toBe("high");
    } else if (prediction.score >= 0.5) {
      expect(prediction.level).toBe("medium");
    } else {
      expect(prediction.level).toBe("low");
    }
  });

  it("integrates with historical scores for trend", () => {
    const history = [
      { timestamp: 1_000_000, score: 0.2 },
      { timestamp: 1_000_000 + 30 * 86400, score: 0.3 },
      { timestamp: 1_000_000 + 60 * 86400, score: 0.4 },
    ];
    const prediction = predictRisk(makeIdentityData(), history);
    expect(prediction.trend.historicalScores).toHaveLength(3);
    expect(["improving", "stable", "deteriorating"]).toContain(
      prediction.trend.direction,
    );
  });

  it("defaults to empty historical scores when not provided", () => {
    const prediction = predictRisk(makeIdentityData());
    expect(prediction.trend.direction).toBe("stable");
    expect(prediction.trend.velocity).toBe(0);
  });

  it("decision action aligns with score thresholds", () => {
    const prediction = predictRisk(makeIdentityData());
    if (prediction.score >= 0.9) {
      expect(prediction.decision.action).toBe("block");
    } else if (prediction.score >= 0.75) {
      expect(prediction.decision.action).toBe("enhanced_due_diligence");
    } else if (prediction.score >= 0.5) {
      expect(prediction.decision.action).toBe("review");
    } else {
      expect(prediction.decision.action).toBe("allow");
    }
  });

  it("is deterministic for the same input", () => {
    const data = makeIdentityData();
    const p1 = predictRisk(data);
    const p2 = predictRisk(data);
    expect(p1.score).toBe(p2.score);
    expect(p1.level).toBe(p2.level);
    expect(p1.decision.action).toBe(p2.decision.action);
  });

  it("handles zero-data identity without errors", () => {
    const prediction = predictRisk(makeZeroIdentityData());
    expect(typeof prediction.score).toBe("number");
    expect(Number.isFinite(prediction.score)).toBe(true);
    expect(prediction.factors).toHaveLength(16);
  });
});
