/**
 * Client-Side Compliance Engine
 *
 * Performs jurisdiction rule evaluation, risk score calculation, compliance
 * status computation, credential gap detection, cross-border eligibility
 * checks, and regulatory deadline computation entirely on the client
 * for UI responsiveness. Server-side validation remains authoritative.
 */

import {
  JURISDICTIONS,
  CROSS_BORDER_MATRIX,
  type JurisdictionDefinition,
  type JurisdictionId,
} from "@/lib/regulatory/jurisdictions";

// ============================================================================
// Types
// ============================================================================

export interface CredentialRecord {
  schemaId: string;
  schemaName: string;
  status: "active" | "expired" | "revoked" | "pending";
  issuedAt: number;
  expiresAt: number;
  issuerDid: string;
  attributes: Record<string, string>;
}

export interface ComplianceEvaluation {
  jurisdictionId: JurisdictionId;
  status: "compliant" | "partially_compliant" | "non_compliant";
  score: number;
  met: EvaluatedRequirement[];
  unmet: EvaluatedRequirement[];
  expiringSoon: EvaluatedRequirement[];
}

export interface EvaluatedRequirement {
  requirementId: string;
  label: string;
  category: "credential" | "consent" | "reporting" | "data_residency";
  mandatory: boolean;
  status: "met" | "unmet" | "expiring_soon" | "expired";
  credentialSchemaId?: string;
  daysUntilExpiry?: number;
}

export interface RiskScoreResult {
  compositeScore: number;
  level: "low" | "medium" | "high" | "critical";
  factors: RiskFactorResult[];
}

export interface RiskFactorResult {
  name: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  description: string;
}

export interface CrossBorderEligibility {
  eligible: boolean;
  fromJurisdiction: JurisdictionId;
  toJurisdiction: JurisdictionId;
  compatibilityScore: number;
  missingRequirements: string[];
  restrictions: string[];
}

export interface CredentialGap {
  schemaId: string;
  schemaName: string;
  mandatory: boolean;
  reason: "missing" | "expired" | "expiring_soon" | "wrong_issuer";
  severity: "critical" | "high" | "medium" | "low";
  daysUntilDeadline?: number;
}

export interface RegulatoryDeadline {
  jurisdictionId: JurisdictionId;
  jurisdictionName: string;
  type: "credential_expiry" | "reporting" | "renewal" | "compliance_review";
  description: string;
  deadlineDate: Date;
  daysRemaining: number;
  severity: "critical" | "high" | "medium" | "low";
}

// ============================================================================
// Constants
// ============================================================================

const EXPIRING_SOON_DAYS = 30;
const RISK_THRESHOLDS = { low: 25, medium: 50, high: 75 };

// ============================================================================
// Jurisdiction Rule Evaluation
// ============================================================================

/**
 * Evaluate an identity's compliance against a specific jurisdiction's rules.
 */
export function evaluateJurisdiction(
  jurisdictionId: JurisdictionId,
  credentials: CredentialRecord[],
  nowMs: number = Date.now(),
): ComplianceEvaluation {
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  if (!jurisdiction) {
    return {
      jurisdictionId,
      status: "non_compliant",
      score: 0,
      met: [],
      unmet: [
        {
          requirementId: "jurisdiction",
          label: "Unknown jurisdiction",
          category: "credential",
          mandatory: true,
          status: "unmet",
        },
      ],
      expiringSoon: [],
    };
  }

  const nowSec = Math.floor(nowMs / 1000);
  const met: EvaluatedRequirement[] = [];
  const unmet: EvaluatedRequirement[] = [];
  const expiringSoon: EvaluatedRequirement[] = [];

  for (const req of jurisdiction.requiredCredentials) {
    const matching = credentials.find(
      (c) => c.schemaId === req.schemaId && c.status === "active",
    );

    if (!matching) {
      unmet.push({
        requirementId: req.schemaId,
        label: req.schemaName,
        category: "credential",
        mandatory: req.mandatory,
        status: "unmet",
        credentialSchemaId: req.schemaId,
      });
      continue;
    }

    const daysUntilExpiry = Math.floor((matching.expiresAt - nowSec) / 86400);

    if (matching.expiresAt <= nowSec) {
      unmet.push({
        requirementId: req.schemaId,
        label: req.schemaName,
        category: "credential",
        mandatory: req.mandatory,
        status: "expired",
        credentialSchemaId: req.schemaId,
        daysUntilExpiry: 0,
      });
    } else if (daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      expiringSoon.push({
        requirementId: req.schemaId,
        label: req.schemaName,
        category: "credential",
        mandatory: req.mandatory,
        status: "expiring_soon",
        credentialSchemaId: req.schemaId,
        daysUntilExpiry,
      });
    } else {
      met.push({
        requirementId: req.schemaId,
        label: req.schemaName,
        category: "credential",
        mandatory: req.mandatory,
        status: "met",
        credentialSchemaId: req.schemaId,
        daysUntilExpiry,
      });
    }
  }

  // Add consent requirements evaluation
  for (const consent of jurisdiction.consentRequirements) {
    met.push({
      requirementId: `consent_${consent.purpose}`,
      label: `Consent: ${consent.purpose}`,
      category: "consent",
      mandatory: true,
      status: "met", // Client-side assumes consent was given; server validates
    });
  }

  const totalMandatory = jurisdiction.requiredCredentials.filter(
    (r) => r.mandatory,
  ).length;
  const mandatoryMet = met.filter(
    (r) => r.mandatory && r.category === "credential",
  ).length;
  const mandatoryExpiring = expiringSoon.filter((r) => r.mandatory).length;

  const score =
    totalMandatory > 0
      ? Math.round(
          ((mandatoryMet + mandatoryExpiring * 0.5) / totalMandatory) * 100,
        )
      : 100;

  let status: ComplianceEvaluation["status"] = "compliant";
  if (score < 50) {
    status = "non_compliant";
  } else if (score < 100) {
    status = "partially_compliant";
  }

  return { jurisdictionId, status, score, met, unmet, expiringSoon };
}

// ============================================================================
// Risk Score Calculation
// ============================================================================

/**
 * Calculate a composite risk score from credential and identity data.
 * This runs client-side for immediate UI feedback.
 */
export function calculateRiskScore(
  credentials: CredentialRecord[],
  jurisdictionId: JurisdictionId,
  transactionCount: number,
  accountAgeDays: number,
): RiskScoreResult {
  const factors: RiskFactorResult[] = [];

  // Factor 1: Credential coverage (weight 0.30)
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  const totalRequired = jurisdiction?.requiredCredentials.length ?? 1;
  const activeCredentials = credentials.filter(
    (c) => c.status === "active",
  ).length;
  const coverageRatio = Math.min(
    activeCredentials / Math.max(totalRequired, 1),
    1,
  );
  const credentialScore = (1 - coverageRatio) * 100;
  factors.push({
    name: "credential_coverage",
    rawScore: credentialScore,
    weight: 0.3,
    weightedScore: credentialScore * 0.3,
    description: `${activeCredentials}/${totalRequired} required credentials active`,
  });

  // Factor 2: Credential freshness (weight 0.20)
  const nowSec = Math.floor(Date.now() / 1000);
  const expiringCount = credentials.filter(
    (c) =>
      c.status === "active" &&
      (c.expiresAt - nowSec) / 86400 < EXPIRING_SOON_DAYS,
  ).length;
  const freshnessScore =
    activeCredentials > 0 ? (expiringCount / activeCredentials) * 100 : 50;
  factors.push({
    name: "credential_freshness",
    rawScore: freshnessScore,
    weight: 0.2,
    weightedScore: freshnessScore * 0.2,
    description: `${expiringCount} credential(s) expiring within ${EXPIRING_SOON_DAYS} days`,
  });

  // Factor 3: Account maturity (weight 0.15)
  const maturityScore =
    accountAgeDays < 30
      ? 80
      : accountAgeDays < 90
        ? 40
        : accountAgeDays < 365
          ? 15
          : 5;
  factors.push({
    name: "account_maturity",
    rawScore: maturityScore,
    weight: 0.15,
    weightedScore: maturityScore * 0.15,
    description: `Account age: ${accountAgeDays} day(s)`,
  });

  // Factor 4: Transaction velocity (weight 0.20)
  const dailyTxRate = transactionCount / Math.max(accountAgeDays, 1);
  const velocityScore =
    dailyTxRate > 50 ? 90 : dailyTxRate > 20 ? 60 : dailyTxRate > 5 ? 30 : 10;
  factors.push({
    name: "transaction_velocity",
    rawScore: velocityScore,
    weight: 0.2,
    weightedScore: velocityScore * 0.2,
    description: `${dailyTxRate.toFixed(1)} tx/day average`,
  });

  // Factor 5: Jurisdiction risk (weight 0.15)
  const jurisdictionRiskMap: Record<string, number> = {
    uae: 20,
    eu: 10,
    us: 15,
    sg: 10,
    uk: 12,
    bh: 25,
    sa: 30,
    hk: 15,
    jp: 10,
  };
  const jRisk = jurisdictionRiskMap[jurisdictionId] ?? 50;
  factors.push({
    name: "jurisdiction_risk",
    rawScore: jRisk,
    weight: 0.15,
    weightedScore: jRisk * 0.15,
    description: `Jurisdiction baseline risk for ${jurisdictionId.toUpperCase()}`,
  });

  const compositeScore = Math.round(
    factors.reduce((sum, f) => sum + f.weightedScore, 0),
  );

  let level: RiskScoreResult["level"] = "low";
  if (compositeScore >= RISK_THRESHOLDS.high) level = "critical";
  else if (compositeScore >= RISK_THRESHOLDS.medium) level = "high";
  else if (compositeScore >= RISK_THRESHOLDS.low) level = "medium";

  return { compositeScore, level, factors };
}

// ============================================================================
// Credential Gap Detection
// ============================================================================

/**
 * Identify missing, expired, or soon-expiring credentials for a jurisdiction.
 */
export function detectCredentialGaps(
  jurisdictionId: JurisdictionId,
  credentials: CredentialRecord[],
  nowMs: number = Date.now(),
): CredentialGap[] {
  const jurisdiction = JURISDICTIONS[jurisdictionId];
  if (!jurisdiction) return [];

  const nowSec = Math.floor(nowMs / 1000);
  const gaps: CredentialGap[] = [];

  for (const req of jurisdiction.requiredCredentials) {
    const matching = credentials.find((c) => c.schemaId === req.schemaId);

    if (!matching) {
      gaps.push({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        mandatory: req.mandatory,
        reason: "missing",
        severity: req.mandatory ? "critical" : "medium",
      });
      continue;
    }

    if (matching.status === "expired" || matching.expiresAt <= nowSec) {
      gaps.push({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        mandatory: req.mandatory,
        reason: "expired",
        severity: req.mandatory ? "high" : "medium",
      });
      continue;
    }

    const daysUntilExpiry = Math.floor((matching.expiresAt - nowSec) / 86400);
    if (daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      gaps.push({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        mandatory: req.mandatory,
        reason: "expiring_soon",
        severity: req.mandatory ? "high" : "low",
        daysUntilDeadline: daysUntilExpiry,
      });
    }

    // Check issuer allowlist
    if (
      req.acceptedIssuers.length > 0 &&
      !req.acceptedIssuers.includes(matching.issuerDid)
    ) {
      gaps.push({
        schemaId: req.schemaId,
        schemaName: req.schemaName,
        mandatory: req.mandatory,
        reason: "wrong_issuer",
        severity: req.mandatory ? "high" : "medium",
      });
    }
  }

  return gaps.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ============================================================================
// Cross-Border Eligibility
// ============================================================================

/**
 * Evaluate whether credentials are sufficient for a cross-border transfer.
 */
export function checkCrossBorderEligibility(
  fromJurisdiction: JurisdictionId,
  toJurisdiction: JurisdictionId,
  credentials: CredentialRecord[],
): CrossBorderEligibility {
  const compatibility = CROSS_BORDER_MATRIX[fromJurisdiction]?.[toJurisdiction];

  if (!compatibility) {
    return {
      eligible: false,
      fromJurisdiction,
      toJurisdiction,
      compatibilityScore: 0,
      missingRequirements: [
        "No bilateral agreement or compatibility data available",
      ],
      restrictions: [
        "Cross-border transfer not supported between these jurisdictions",
      ],
    };
  }

  const fromGaps = detectCredentialGaps(fromJurisdiction, credentials);
  const toGaps = detectCredentialGaps(toJurisdiction, credentials);

  const criticalGaps = [...fromGaps, ...toGaps].filter(
    (g) => g.severity === "critical" || g.severity === "high",
  );

  const missingRequirements = criticalGaps.map(
    (g) => `${g.schemaName} (${g.reason}) — required by jurisdiction`,
  );

  const eligible = criticalGaps.length === 0 && compatibility.score >= 50;

  return {
    eligible,
    fromJurisdiction,
    toJurisdiction,
    compatibilityScore: compatibility.score,
    missingRequirements,
    restrictions: compatibility.restrictions,
  };
}

// ============================================================================
// Regulatory Deadline Computation
// ============================================================================

/**
 * Compute upcoming regulatory deadlines based on credentials and jurisdiction rules.
 */
export function computeRegulatoryDeadlines(
  jurisdictionIds: JurisdictionId[],
  credentials: CredentialRecord[],
  nowMs: number = Date.now(),
): RegulatoryDeadline[] {
  const nowSec = Math.floor(nowMs / 1000);
  const deadlines: RegulatoryDeadline[] = [];

  for (const jId of jurisdictionIds) {
    const jurisdiction = JURISDICTIONS[jId];
    if (!jurisdiction) continue;

    // Credential expiry deadlines
    for (const req of jurisdiction.requiredCredentials) {
      const cred = credentials.find(
        (c) => c.schemaId === req.schemaId && c.status === "active",
      );
      if (!cred) continue;

      const daysRemaining = Math.floor((cred.expiresAt - nowSec) / 86400);
      if (daysRemaining <= 90) {
        const severity: RegulatoryDeadline["severity"] =
          daysRemaining <= 7
            ? "critical"
            : daysRemaining <= 30
              ? "high"
              : daysRemaining <= 60
                ? "medium"
                : "low";

        deadlines.push({
          jurisdictionId: jId,
          jurisdictionName: jurisdiction.name,
          type: "credential_expiry",
          description: `${req.schemaName} credential expires`,
          deadlineDate: new Date(cred.expiresAt * 1000),
          daysRemaining: Math.max(daysRemaining, 0),
          severity,
        });
      }
    }

    // Reporting obligation deadlines
    for (const obligation of jurisdiction.reportingObligations) {
      const frequencyDays: Record<string, number> = {
        daily: 1,
        weekly: 7,
        monthly: 30,
        quarterly: 90,
        annual: 365,
      };
      const intervalDays = frequencyDays[obligation.frequency] ?? 30;
      const nextDeadline = new Date(nowMs + intervalDays * 86400 * 1000);

      deadlines.push({
        jurisdictionId: jId,
        jurisdictionName: jurisdiction.name,
        type: "reporting",
        description: `${obligation.type} reporting due to ${obligation.authority}`,
        deadlineDate: nextDeadline,
        daysRemaining: intervalDays,
        severity: intervalDays <= 7 ? "high" : "medium",
      });
    }
  }

  return deadlines.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
