import crypto from "crypto";
import { prisma, logger, redis } from "../../index";

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export type RiskDecision = "approve" | "review" | "reject" | "escalate";
export type RiskTrend = "improving" | "stable" | "degrading" | "volatile";

export interface IdentityRiskInput {
  identityId: string;
  documentQualityScore: number; // 0-1 (OCR confidence, tamper detection)
  biometricMatchConfidence: number; // 0-1 (face match, liveness)
  issuanceRecencyDays: number; // days since most recent credential issuance
  documentCount: number; // total documents on file
  verifiedDocumentCount: number; // successfully verified documents
  countryRiskTier: number; // 1-5 (1 = low risk, 5 = high risk)
}

export interface CredentialRiskInput {
  credentialId: string;
  issuerTrustScore: number; // 0-1 (issuer reputation)
  verificationFrequency: number; // verifications per day (rolling 30d)
  expiryDays: number; // days until credential expiry
  credentialAge: number; // days since issuance
  revokedSiblings: number; // revoked credentials from same issuer for this identity
  schemaCompliance: number; // 0-1 (how well claims match schema)
}

export interface TransactionRiskInput {
  transactionId: string;
  identityId: string;
  transactionType: string;
  valueMagnitude: number; // normalized value (0=tiny, 1=massive for user profile)
  isCrossBorder: boolean;
  counterpartyRiskScore: number; // 0-100
  historicalSimilarity: number; // 0-1 (how similar to past transactions)
  timeOfDayAnomaly: number; // 0-1 (how unusual the timing is)
  channelRisk: number; // 0-1 (API vs web vs mobile risk)
}

export interface NetworkRiskInput {
  identityId: string;
  sharedCredentialCount: number; // credentials shared with other identities
  connectionDegree: number; // graph degree centrality
  clusterCoefficient: number; // clustering coefficient in credential graph
  suspiciousNeighborCount: number; // neighbors with elevated risk
  totalNeighborCount: number;
  credentialSharingVelocity: number; // shares per day (7d rolling)
}

export interface RiskScoreBreakdown {
  categoryScores: {
    identity: number;
    credential: number;
    transaction: number;
    network: number;
  };
  weights: {
    identity: number;
    credential: number;
    transaction: number;
    network: number;
  };
  compositeScore: number;
}

export interface RiskAssessment {
  assessmentId: string;
  entityId: string;
  entityType: "identity" | "credential" | "transaction";
  compositeScore: number;
  breakdown: RiskScoreBreakdown;
  decision: RiskDecision;
  factors: RiskFactorDetail[];
  trend: RiskTrend;
  historicalScores: { timestamp: Date; score: number }[];
  jurisdiction?: string;
  regulatoryRegime?: string;
  confidence: number;
  timestamp: Date;
}

export interface RiskFactorDetail {
  name: string;
  category: string;
  rawValue: number;
  normalizedScore: number; // 0-100
  weight: number;
  impact: "increasing" | "decreasing" | "neutral";
  explanation: string;
}

export interface JurisdictionConfig {
  code: string;
  name: string;
  regulatoryRegime: string;
  weights: {
    identity: number;
    credential: number;
    transaction: number;
    network: number;
  };
  thresholds: {
    approve: number; // below this = auto-approve
    review: number; // between approve and review = manual review
    reject: number; // between review and reject = reject
    escalate: number; // above this = escalate to senior compliance
  };
  enhancedDueDiligence: boolean;
  pepScreeningRequired: boolean;
  maxCredentialAge: number; // days
}

// ---------------------------------------------------------------------------
// Default jurisdiction configurations
// ---------------------------------------------------------------------------

const JURISDICTION_CONFIGS: Map<string, JurisdictionConfig> = new Map([
  [
    "US",
    {
      code: "US",
      name: "United States",
      regulatoryRegime: "FinCEN/BSA",
      weights: {
        identity: 0.3,
        credential: 0.25,
        transaction: 0.3,
        network: 0.15,
      },
      thresholds: { approve: 25, review: 55, reject: 80, escalate: 92 },
      enhancedDueDiligence: false,
      pepScreeningRequired: true,
      maxCredentialAge: 365,
    },
  ],
  [
    "EU",
    {
      code: "EU",
      name: "European Union",
      regulatoryRegime: "AMLD6/MiCA",
      weights: {
        identity: 0.35,
        credential: 0.2,
        transaction: 0.25,
        network: 0.2,
      },
      thresholds: { approve: 20, review: 50, reject: 75, escalate: 90 },
      enhancedDueDiligence: false,
      pepScreeningRequired: true,
      maxCredentialAge: 365,
    },
  ],
  [
    "UK",
    {
      code: "UK",
      name: "United Kingdom",
      regulatoryRegime: "FCA/MLR",
      weights: {
        identity: 0.3,
        credential: 0.25,
        transaction: 0.25,
        network: 0.2,
      },
      thresholds: { approve: 22, review: 50, reject: 78, escalate: 91 },
      enhancedDueDiligence: false,
      pepScreeningRequired: true,
      maxCredentialAge: 365,
    },
  ],
  [
    "SG",
    {
      code: "SG",
      name: "Singapore",
      regulatoryRegime: "MAS/PSA",
      weights: {
        identity: 0.25,
        credential: 0.3,
        transaction: 0.25,
        network: 0.2,
      },
      thresholds: { approve: 20, review: 45, reject: 72, escalate: 88 },
      enhancedDueDiligence: false,
      pepScreeningRequired: true,
      maxCredentialAge: 730,
    },
  ],
  [
    "AE",
    {
      code: "AE",
      name: "United Arab Emirates",
      regulatoryRegime: "CBUAE/VARA",
      weights: {
        identity: 0.35,
        credential: 0.25,
        transaction: 0.25,
        network: 0.15,
      },
      thresholds: { approve: 18, review: 42, reject: 70, escalate: 85 },
      enhancedDueDiligence: true,
      pepScreeningRequired: true,
      maxCredentialAge: 365,
    },
  ],
  [
    "CH",
    {
      code: "CH",
      name: "Switzerland",
      regulatoryRegime: "FINMA/AMLA",
      weights: {
        identity: 0.3,
        credential: 0.25,
        transaction: 0.3,
        network: 0.15,
      },
      thresholds: { approve: 22, review: 48, reject: 74, escalate: 89 },
      enhancedDueDiligence: false,
      pepScreeningRequired: true,
      maxCredentialAge: 365,
    },
  ],
  [
    "DEFAULT",
    {
      code: "DEFAULT",
      name: "Default (FATF)",
      regulatoryRegime: "FATF",
      weights: {
        identity: 0.3,
        credential: 0.25,
        transaction: 0.25,
        network: 0.2,
      },
      thresholds: { approve: 25, review: 55, reject: 80, escalate: 92 },
      enhancedDueDiligence: false,
      pepScreeningRequired: false,
      maxCredentialAge: 365,
    },
  ],
]);

// ---------------------------------------------------------------------------
// Risk Scoring Service
// ---------------------------------------------------------------------------

export class RiskScoringService {
  // -------------------------------------------------------------------------
  // Comprehensive risk assessment
  // -------------------------------------------------------------------------
  async assessRisk(
    entityId: string,
    entityType: "identity" | "credential" | "transaction",
    jurisdiction?: string,
  ): Promise<RiskAssessment> {
    const assessmentId = `risk-${crypto.randomUUID()}`;
    const config = this.getJurisdictionConfig(jurisdiction);

    logger.info("risk_assessment_start", {
      assessmentId,
      entityId,
      entityType,
      jurisdiction: config.code,
    });

    const factors: RiskFactorDetail[] = [];
    let identityScore = 0;
    let credentialScore = 0;
    let transactionScore = 0;
    let networkScore = 0;

    // Compute category scores based on entity type
    if (entityType === "identity" || entityType === "transaction") {
      const identityResult = await this.computeIdentityRiskScore(entityId);
      identityScore = identityResult.score;
      factors.push(...identityResult.factors);
    }

    if (entityType === "credential" || entityType === "identity") {
      const credentialResult = await this.computeCredentialRiskScore(
        entityId,
        entityType,
      );
      credentialScore = credentialResult.score;
      factors.push(...credentialResult.factors);
    }

    if (entityType === "transaction") {
      const txResult = await this.computeTransactionRiskScore(entityId);
      transactionScore = txResult.score;
      factors.push(...txResult.factors);
    }

    const networkResult = await this.computeNetworkRiskScore(entityId);
    networkScore = networkResult.score;
    factors.push(...networkResult.factors);

    // Weighted composite score
    const compositeScore = Math.round(
      identityScore * config.weights.identity +
        credentialScore * config.weights.credential +
        transactionScore * config.weights.transaction +
        networkScore * config.weights.network,
    );

    const breakdown: RiskScoreBreakdown = {
      categoryScores: {
        identity: identityScore,
        credential: credentialScore,
        transaction: transactionScore,
        network: networkScore,
      },
      weights: config.weights,
      compositeScore,
    };

    // Decision based on jurisdiction thresholds
    const decision = this.makeDecision(compositeScore, config);

    // Historical trend analysis
    const historicalScores = await this.getHistoricalScores(entityId);
    const trend = this.analyzeTrend(historicalScores, compositeScore);

    // Confidence based on data completeness
    const confidence = this.computeConfidence(factors, entityType);

    const assessment: RiskAssessment = {
      assessmentId,
      entityId,
      entityType,
      compositeScore,
      breakdown,
      decision,
      factors,
      trend,
      historicalScores,
      jurisdiction: config.code,
      regulatoryRegime: config.regulatoryRegime,
      confidence,
      timestamp: new Date(),
    };

    // Persist for audit trail
    await this.persistAssessment(assessment);

    logger.info("risk_assessment_complete", {
      assessmentId,
      entityId,
      compositeScore,
      decision,
      trend,
      jurisdiction: config.code,
    });

    return assessment;
  }

  // -------------------------------------------------------------------------
  // Identity risk score computation
  // -------------------------------------------------------------------------
  private async computeIdentityRiskScore(
    identityId: string,
  ): Promise<{ score: number; factors: RiskFactorDetail[] }> {
    const factors: RiskFactorDetail[] = [];

    try {
      const identity = await prisma.identity.findUnique({
        where: { id: identityId },
        include: {
          credentials: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              credentialType: true,
              issuedAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!identity) {
        return {
          score: 80,
          factors: [
            {
              name: "identity_not_found",
              category: "identity",
              rawValue: 1,
              normalizedScore: 80,
              weight: 1.0,
              impact: "increasing",
              explanation: "Identity record not found in the system",
            },
          ],
        };
      }

      // Document quality (based on verified credentials)
      const totalCreds = identity.credentials.length;
      const verifiedCreds = identity.credentials.filter(
        (c: any) => c.updatedAt,
      ).length;
      const verificationRatio = totalCreds > 0 ? verifiedCreds / totalCreds : 0;

      const docQualityScore = Math.round(
        (1 - verificationRatio) * 60 + (totalCreds < 2 ? 20 : 0),
      );
      factors.push({
        name: "document_verification_ratio",
        category: "identity",
        rawValue: verificationRatio,
        normalizedScore: docQualityScore,
        weight: 0.3,
        impact: verificationRatio < 0.5 ? "increasing" : "decreasing",
        explanation: `${verifiedCreds}/${totalCreds} credentials verified (${(verificationRatio * 100).toFixed(0)}%)`,
      });

      // Issuance recency
      const mostRecent = identity.credentials
        .map((c: any) => new Date(c.issuedAt).getTime())
        .sort((a: number, b: number) => b - a)[0];

      if (mostRecent) {
        const daysSinceIssuance = (Date.now() - mostRecent) / 86_400_000;
        const recencyScore =
          daysSinceIssuance > 365
            ? 50
            : daysSinceIssuance > 180
              ? 30
              : daysSinceIssuance > 30
                ? 10
                : 5;

        factors.push({
          name: "credential_recency",
          category: "identity",
          rawValue: daysSinceIssuance,
          normalizedScore: recencyScore,
          weight: 0.2,
          impact: daysSinceIssuance > 180 ? "increasing" : "neutral",
          explanation: `Most recent credential issued ${Math.round(daysSinceIssuance)} days ago`,
        });
      }

      // Account age and maturity
      const accountAgeDays =
        (Date.now() - new Date(identity.createdAt).getTime()) / 86_400_000;
      const maturityScore =
        accountAgeDays < 7
          ? 60
          : accountAgeDays < 30
            ? 35
            : accountAgeDays < 90
              ? 15
              : 5;

      factors.push({
        name: "account_maturity",
        category: "identity",
        rawValue: accountAgeDays,
        normalizedScore: maturityScore,
        weight: 0.25,
        impact: accountAgeDays < 30 ? "increasing" : "decreasing",
        explanation: `Account age: ${Math.round(accountAgeDays)} days${accountAgeDays < 7 ? " (very new)" : ""}`,
      });

      // TEE attestation status
      const teeScore = identity.teeAttested ? 0 : 30;
      factors.push({
        name: "tee_attestation",
        category: "identity",
        rawValue: identity.teeAttested ? 1 : 0,
        normalizedScore: teeScore,
        weight: 0.25,
        impact: identity.teeAttested ? "decreasing" : "increasing",
        explanation: identity.teeAttested
          ? "Identity has valid TEE attestation"
          : "No TEE attestation — identity hardware binding unverified",
      });

      const weightedScore = factors
        .filter((f) => f.category === "identity")
        .reduce((sum, f) => sum + f.normalizedScore * f.weight, 0);
      const totalWeight = factors
        .filter((f) => f.category === "identity")
        .reduce((sum, f) => sum + f.weight, 0);

      return { score: Math.round(weightedScore / (totalWeight || 1)), factors };
    } catch (err) {
      logger.error("identity_risk_computation_error", {
        identityId,
        error: (err as Error).message,
      });
      return {
        score: 50,
        factors: [
          {
            name: "identity_data_unavailable",
            category: "identity",
            rawValue: 1,
            normalizedScore: 50,
            weight: 1.0,
            impact: "neutral",
            explanation: "Unable to compute full identity risk — partial data",
          },
        ],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Credential risk score computation
  // -------------------------------------------------------------------------
  private async computeCredentialRiskScore(
    entityId: string,
    entityType: string,
  ): Promise<{ score: number; factors: RiskFactorDetail[] }> {
    const factors: RiskFactorDetail[] = [];

    try {
      const whereClause =
        entityType === "credential"
          ? { id: entityId }
          : { subjectId: entityId, status: "ACTIVE" as const };

      const credentials = await prisma.credential.findMany({
        where: whereClause,
        select: {
          id: true,
          credentialType: true,
          issuerId: true,
          issuedAt: true,
          expiresAt: true,
          status: true,
          updatedAt: true,
          claims: true,
        },
        take: 50,
      });

      if (credentials.length === 0) {
        return {
          score: 60,
          factors: [
            {
              name: "no_credentials",
              category: "credential",
              rawValue: 0,
              normalizedScore: 60,
              weight: 1.0,
              impact: "increasing",
              explanation: "No active credentials found for this entity",
            },
          ],
        };
      }

      // Issuer trust assessment
      const issuerIds = [...new Set(credentials.map((c) => c.issuerId))];
      const issuerScores: number[] = [];

      for (const issuerId of issuerIds) {
        // Check issuer's credential revocation rate
        const issuerCreds = await prisma.credential.count({
          where: { issuerId },
        });
        const revokedCreds = await prisma.credential.count({
          where: { issuerId, status: "REVOKED" },
        });

        const revocationRate = issuerCreds > 0 ? revokedCreds / issuerCreds : 0;
        issuerScores.push(
          revocationRate > 0.1 ? 60 : revocationRate > 0.03 ? 30 : 10,
        );
      }

      const avgIssuerScore =
        issuerScores.length > 0
          ? issuerScores.reduce((a, b) => a + b, 0) / issuerScores.length
          : 50;

      factors.push({
        name: "issuer_trust",
        category: "credential",
        rawValue: avgIssuerScore / 100,
        normalizedScore: Math.round(avgIssuerScore),
        weight: 0.35,
        impact: avgIssuerScore > 40 ? "increasing" : "decreasing",
        explanation: `Average issuer trust score: ${avgIssuerScore.toFixed(0)}/100 across ${issuerIds.length} issuer(s)`,
      });

      // Expiry proximity
      const now = Date.now();
      const expiringCount = credentials.filter((c) => {
        if (!c.expiresAt) return false;
        const daysUntilExpiry =
          (new Date(c.expiresAt).getTime() - now) / 86_400_000;
        return daysUntilExpiry < 30;
      }).length;

      const expiryRatio = expiringCount / credentials.length;
      const expiryScore = Math.round(expiryRatio * 70);

      factors.push({
        name: "expiry_proximity",
        category: "credential",
        rawValue: expiryRatio,
        normalizedScore: expiryScore,
        weight: 0.25,
        impact: expiryRatio > 0.3 ? "increasing" : "neutral",
        explanation: `${expiringCount}/${credentials.length} credentials expiring within 30 days`,
      });

      // Credential diversity (single type = higher risk)
      const uniqueTypes = new Set(credentials.map((c) => c.credentialType));
      const diversityScore =
        uniqueTypes.size === 1 ? 40 : uniqueTypes.size === 2 ? 20 : 5;

      factors.push({
        name: "credential_diversity",
        category: "credential",
        rawValue: uniqueTypes.size,
        normalizedScore: diversityScore,
        weight: 0.2,
        impact: uniqueTypes.size < 2 ? "increasing" : "decreasing",
        explanation: `${uniqueTypes.size} distinct credential type(s): ${[...uniqueTypes].join(", ")}`,
      });

      // Schema compliance (all claims present)
      const schemaCompliance =
        credentials.filter(
          (c) =>
            c.claims &&
            Object.keys(c.claims as Record<string, unknown>).length > 0,
        ).length / credentials.length;
      const schemaScore = Math.round((1 - schemaCompliance) * 50);

      factors.push({
        name: "schema_compliance",
        category: "credential",
        rawValue: schemaCompliance,
        normalizedScore: schemaScore,
        weight: 0.2,
        impact: schemaCompliance < 0.8 ? "increasing" : "decreasing",
        explanation: `${(schemaCompliance * 100).toFixed(0)}% of credentials have complete claim data`,
      });

      const weightedScore = factors
        .filter((f) => f.category === "credential")
        .reduce((sum, f) => sum + f.normalizedScore * f.weight, 0);
      const totalWeight = factors
        .filter((f) => f.category === "credential")
        .reduce((sum, f) => sum + f.weight, 0);

      return { score: Math.round(weightedScore / (totalWeight || 1)), factors };
    } catch (err) {
      logger.error("credential_risk_computation_error", {
        entityId,
        error: (err as Error).message,
      });
      return { score: 50, factors: [] };
    }
  }

  // -------------------------------------------------------------------------
  // Transaction risk score computation
  // -------------------------------------------------------------------------
  private async computeTransactionRiskScore(
    transactionId: string,
  ): Promise<{ score: number; factors: RiskFactorDetail[] }> {
    const factors: RiskFactorDetail[] = [];

    // Fetch transaction-related risk signals from cache
    const cachedSignals = await redis.get(`tx:signals:${transactionId}`);
    const signals = cachedSignals
      ? (JSON.parse(cachedSignals) as TransactionRiskInput)
      : null;

    if (!signals) {
      // Generate baseline signals for unknown transactions
      factors.push({
        name: "transaction_data_unavailable",
        category: "transaction",
        rawValue: 1,
        normalizedScore: 40,
        weight: 1.0,
        impact: "increasing",
        explanation:
          "Transaction risk signals not available — baseline risk applied",
      });
      return { score: 40, factors };
    }

    // Value magnitude risk
    const valueScore =
      signals.valueMagnitude > 0.9
        ? 70
        : signals.valueMagnitude > 0.7
          ? 45
          : signals.valueMagnitude > 0.5
            ? 25
            : 10;

    factors.push({
      name: "value_magnitude",
      category: "transaction",
      rawValue: signals.valueMagnitude,
      normalizedScore: valueScore,
      weight: 0.25,
      impact: signals.valueMagnitude > 0.7 ? "increasing" : "neutral",
      explanation: `Transaction value magnitude: ${(signals.valueMagnitude * 100).toFixed(0)}th percentile for this identity`,
    });

    // Cross-border risk
    if (signals.isCrossBorder) {
      const crossBorderScore =
        35 + Math.round(signals.counterpartyRiskScore * 0.4);
      factors.push({
        name: "cross_border",
        category: "transaction",
        rawValue: 1,
        normalizedScore: crossBorderScore,
        weight: 0.2,
        impact: "increasing",
        explanation: `Cross-border transaction with counterparty risk score ${signals.counterpartyRiskScore}`,
      });
    }

    // Historical similarity
    const similarityScore = Math.round((1 - signals.historicalSimilarity) * 60);
    factors.push({
      name: "historical_similarity",
      category: "transaction",
      rawValue: signals.historicalSimilarity,
      normalizedScore: similarityScore,
      weight: 0.25,
      impact: signals.historicalSimilarity < 0.3 ? "increasing" : "decreasing",
      explanation:
        signals.historicalSimilarity < 0.3
          ? "Transaction pattern is highly unusual compared to history"
          : "Transaction pattern is consistent with historical behavior",
    });

    // Time anomaly
    const timeScore = Math.round(signals.timeOfDayAnomaly * 50);
    factors.push({
      name: "time_anomaly",
      category: "transaction",
      rawValue: signals.timeOfDayAnomaly,
      normalizedScore: timeScore,
      weight: 0.15,
      impact: signals.timeOfDayAnomaly > 0.6 ? "increasing" : "neutral",
      explanation: `Time-of-day anomaly score: ${(signals.timeOfDayAnomaly * 100).toFixed(0)}%`,
    });

    // Channel risk
    const channelScore = Math.round(signals.channelRisk * 40);
    factors.push({
      name: "channel_risk",
      category: "transaction",
      rawValue: signals.channelRisk,
      normalizedScore: channelScore,
      weight: 0.15,
      impact: signals.channelRisk > 0.5 ? "increasing" : "neutral",
      explanation: `Channel risk factor: ${(signals.channelRisk * 100).toFixed(0)}%`,
    });

    const weightedScore = factors
      .filter((f) => f.category === "transaction")
      .reduce((sum, f) => sum + f.normalizedScore * f.weight, 0);
    const totalWeight = factors
      .filter((f) => f.category === "transaction")
      .reduce((sum, f) => sum + f.weight, 0);

    return { score: Math.round(weightedScore / (totalWeight || 1)), factors };
  }

  // -------------------------------------------------------------------------
  // Network risk score (graph analysis)
  // -------------------------------------------------------------------------
  private async computeNetworkRiskScore(
    entityId: string,
  ): Promise<{ score: number; factors: RiskFactorDetail[] }> {
    const factors: RiskFactorDetail[] = [];

    // Fetch network metrics from cache (computed by background graph analysis job)
    const networkKey = `network:metrics:${entityId}`;
    const cachedMetrics = await redis.get(networkKey);

    if (!cachedMetrics) {
      factors.push({
        name: "network_data_unavailable",
        category: "network",
        rawValue: 0,
        normalizedScore: 15,
        weight: 1.0,
        impact: "neutral",
        explanation: "Network graph metrics not yet computed for this entity",
      });
      return { score: 15, factors };
    }

    const metrics = JSON.parse(cachedMetrics) as NetworkRiskInput;

    // Suspicious neighbor ratio
    if (metrics.totalNeighborCount > 0) {
      const suspiciousRatio =
        metrics.suspiciousNeighborCount / metrics.totalNeighborCount;
      const neighborScore = Math.round(suspiciousRatio * 80);

      factors.push({
        name: "suspicious_neighbors",
        category: "network",
        rawValue: suspiciousRatio,
        normalizedScore: neighborScore,
        weight: 0.35,
        impact: suspiciousRatio > 0.2 ? "increasing" : "neutral",
        explanation: `${metrics.suspiciousNeighborCount}/${metrics.totalNeighborCount} connections have elevated risk profiles`,
      });
    }

    // Degree centrality (unusually high connectivity can indicate synthetic networks)
    const degreeScore =
      metrics.connectionDegree > 100
        ? 60
        : metrics.connectionDegree > 50
          ? 35
          : metrics.connectionDegree > 20
            ? 15
            : 5;

    factors.push({
      name: "graph_centrality",
      category: "network",
      rawValue: metrics.connectionDegree,
      normalizedScore: degreeScore,
      weight: 0.25,
      impact: metrics.connectionDegree > 50 ? "increasing" : "neutral",
      explanation: `Connection degree: ${metrics.connectionDegree} (${degreeScore > 30 ? "unusually high" : "normal range"})`,
    });

    // Clustering coefficient (high clustering + high degree = sybil risk)
    const clusterScore =
      metrics.clusterCoefficient > 0.8 && metrics.connectionDegree > 30
        ? 65
        : metrics.clusterCoefficient > 0.6
          ? 30
          : 10;

    factors.push({
      name: "clustering_coefficient",
      category: "network",
      rawValue: metrics.clusterCoefficient,
      normalizedScore: clusterScore,
      weight: 0.2,
      impact: clusterScore > 40 ? "increasing" : "neutral",
      explanation: `Clustering coefficient: ${metrics.clusterCoefficient.toFixed(3)} — ${clusterScore > 40 ? "dense interconnection pattern (potential sybil)" : "normal pattern"}`,
    });

    // Credential sharing velocity
    const sharingScore =
      metrics.credentialSharingVelocity > 10
        ? 70
        : metrics.credentialSharingVelocity > 5
          ? 40
          : metrics.credentialSharingVelocity > 1
            ? 15
            : 5;

    factors.push({
      name: "sharing_velocity",
      category: "network",
      rawValue: metrics.credentialSharingVelocity,
      normalizedScore: sharingScore,
      weight: 0.2,
      impact: metrics.credentialSharingVelocity > 5 ? "increasing" : "neutral",
      explanation: `Credential sharing rate: ${metrics.credentialSharingVelocity.toFixed(1)}/day (7d rolling)`,
    });

    const weightedScore = factors
      .filter((f) => f.category === "network")
      .reduce((sum, f) => sum + f.normalizedScore * f.weight, 0);
    const totalWeight = factors
      .filter((f) => f.category === "network")
      .reduce((sum, f) => sum + f.weight, 0);

    return { score: Math.round(weightedScore / (totalWeight || 1)), factors };
  }

  // -------------------------------------------------------------------------
  // Decision engine
  // -------------------------------------------------------------------------
  private makeDecision(
    compositeScore: number,
    config: JurisdictionConfig,
  ): RiskDecision {
    if (compositeScore >= config.thresholds.escalate) return "escalate";
    if (compositeScore >= config.thresholds.reject) return "reject";
    if (compositeScore >= config.thresholds.review) return "review";
    return "approve";
  }

  // -------------------------------------------------------------------------
  // Trend analysis
  // -------------------------------------------------------------------------
  private analyzeTrend(
    historical: { timestamp: Date; score: number }[],
    currentScore: number,
  ): RiskTrend {
    if (historical.length < 3) return "stable";

    const recentScores = historical.slice(-5).map((h) => h.score);
    recentScores.push(currentScore);

    // Linear regression slope
    const n = recentScores.length;
    const xMean = (n - 1) / 2;
    const yMean = recentScores.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (recentScores[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Check volatility
    const stdDev = Math.sqrt(
      recentScores.reduce((sum, s) => sum + (s - yMean) ** 2, 0) / n,
    );

    if (stdDev > 15) return "volatile";
    if (slope > 2) return "degrading";
    if (slope < -2) return "improving";
    return "stable";
  }

  // -------------------------------------------------------------------------
  // Historical scores
  // -------------------------------------------------------------------------
  private async getHistoricalScores(
    entityId: string,
  ): Promise<{ timestamp: Date; score: number }[]> {
    const historyKey = `risk:history:${entityId}`;
    const cached = await redis.lrange(historyKey, 0, 29);

    return cached.map((entry) => {
      const parsed = JSON.parse(entry);
      return {
        timestamp: new Date(parsed.timestamp),
        score: parsed.score,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Confidence computation
  // -------------------------------------------------------------------------
  private computeConfidence(
    factors: RiskFactorDetail[],
    entityType: string,
  ): number {
    const expectedCategories = new Set(["identity", "credential", "network"]);
    if (entityType === "transaction") expectedCategories.add("transaction");

    const presentCategories = new Set(factors.map((f) => f.category));
    const coverageRatio =
      [...expectedCategories].filter((c) => presentCategories.has(c)).length /
      expectedCategories.size;

    // More factors = higher confidence (up to a point)
    const factorBonus = Math.min(factors.length / 10, 1.0) * 0.2;

    // Penalize if any categories report "unavailable"
    const unavailableCount = factors.filter((f) =>
      f.name.includes("unavailable"),
    ).length;
    const unavailablePenalty = unavailableCount * 0.1;

    return Math.max(
      0.1,
      Math.min(1.0, coverageRatio * 0.7 + factorBonus - unavailablePenalty),
    );
  }

  // -------------------------------------------------------------------------
  // Jurisdiction config management
  // -------------------------------------------------------------------------
  getJurisdictionConfig(jurisdiction?: string): JurisdictionConfig {
    if (jurisdiction) {
      const config = JURISDICTION_CONFIGS.get(jurisdiction.toUpperCase());
      if (config) return config;
    }
    return JURISDICTION_CONFIGS.get("DEFAULT")!;
  }

  getAvailableJurisdictions(): JurisdictionConfig[] {
    return Array.from(JURISDICTION_CONFIGS.values()).filter(
      (j) => j.code !== "DEFAULT",
    );
  }

  updateJurisdictionThresholds(
    code: string,
    thresholds: Partial<JurisdictionConfig["thresholds"]>,
  ): JurisdictionConfig {
    const config = JURISDICTION_CONFIGS.get(code.toUpperCase());
    if (!config) {
      throw new RiskScoringError(
        "Jurisdiction not found",
        "JURISDICTION_NOT_FOUND",
        404,
      );
    }

    Object.assign(config.thresholds, thresholds);
    JURISDICTION_CONFIGS.set(code.toUpperCase(), config);

    logger.info("jurisdiction_thresholds_updated", { code, thresholds });
    return config;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  private async persistAssessment(assessment: RiskAssessment): Promise<void> {
    try {
      // Store in audit log
      await prisma.auditLog.create({
        data: {
          identityId: assessment.entityId,
          action: "RISK_ASSESSMENT" as any,
          resourceType: "risk_assessment",
          resourceId: assessment.assessmentId,
          details: {
            compositeScore: assessment.compositeScore,
            decision: assessment.decision,
            trend: assessment.trend,
            jurisdiction: assessment.jurisdiction,
            confidence: assessment.confidence,
            categoryScores: assessment.breakdown.categoryScores,
          },
        },
      });

      // Append to historical scores
      const historyKey = `risk:history:${assessment.entityId}`;
      await redis.lpush(
        historyKey,
        JSON.stringify({
          timestamp: assessment.timestamp.toISOString(),
          score: assessment.compositeScore,
        }),
      );
      await redis.ltrim(historyKey, 0, 99); // keep last 100
      await redis.expire(historyKey, 365 * 86400);

      // Cache latest assessment
      await redis.set(
        `risk:latest:${assessment.entityId}`,
        JSON.stringify(assessment),
        "EX",
        24 * 3600,
      );
    } catch (err) {
      logger.error("risk_assessment_persist_error", {
        assessmentId: assessment.assessmentId,
        error: (err as Error).message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
export class RiskScoringError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "RiskScoringError";
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const riskScoringService = new RiskScoringService();
