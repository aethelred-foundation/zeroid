import { logger } from '../../runtime';

export type RiskDecision = 'approve' | 'review' | 'reject' | 'escalate';
export type RiskTrend = 'improving' | 'stable' | 'degrading' | 'volatile';

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
  entityType: 'identity' | 'credential' | 'transaction';
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
  normalizedScore: number;
  weight: number;
  impact: 'increasing' | 'decreasing' | 'neutral';
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
    approve: number;
    review: number;
    reject: number;
    escalate: number;
  };
  enhancedDueDiligence: boolean;
  pepScreeningRequired: boolean;
  maxCredentialAge: number;
}

const JURISDICTION_CONFIGS: ReadonlyMap<string, JurisdictionConfig> = new Map([
  [
    'US',
    {
      code: 'US',
      name: 'United States',
      regulatoryRegime: 'FinCEN/BSA',
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
    'EU',
    {
      code: 'EU',
      name: 'European Union',
      regulatoryRegime: 'AMLD6/MiCA',
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
    'UK',
    {
      code: 'UK',
      name: 'United Kingdom',
      regulatoryRegime: 'FCA/MLR',
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
    'SG',
    {
      code: 'SG',
      name: 'Singapore',
      regulatoryRegime: 'MAS/PSA',
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
    'AE',
    {
      code: 'AE',
      name: 'United Arab Emirates',
      regulatoryRegime: 'CBUAE/VARA',
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
    'CH',
    {
      code: 'CH',
      name: 'Switzerland',
      regulatoryRegime: 'FINMA/AMLA',
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
    'DEFAULT',
    {
      code: 'DEFAULT',
      name: 'Default (FATF)',
      regulatoryRegime: 'FATF',
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

/**
 * Risk decisions are intentionally unavailable until the durable data model can
 * bind an immutable assessment to an enterprise tenant and to authoritative
 * credential signature, status, expiry, and revocation evidence in one atomic
 * transaction with its audit entry. Timestamps and cache entries are not proof
 * that a credential was verified.
 */
export function riskAssessmentUnavailableError(): RiskScoringError {
  return new RiskScoringError(
    'Risk assessment is unavailable until tenant-scoped durable credential verification and audit evidence is implemented',
    'RISK_ASSESSMENT_EVIDENCE_UNAVAILABLE',
    503,
  );
}

export class RiskScoringService {
  async assessRisk(
    _entityId: string,
    _entityType: 'identity' | 'credential' | 'transaction',
    _jurisdiction?: string,
  ): Promise<RiskAssessment> {
    throw riskAssessmentUnavailableError();
  }

  getJurisdictionConfig(jurisdiction?: string): JurisdictionConfig {
    if (jurisdiction) {
      const config = JURISDICTION_CONFIGS.get(jurisdiction.toUpperCase());
      if (config) return structuredClone(config);
    }

    return structuredClone(JURISDICTION_CONFIGS.get('DEFAULT')!);
  }

  getAvailableJurisdictions(): JurisdictionConfig[] {
    return Array.from(JURISDICTION_CONFIGS.values())
      .filter((jurisdiction) => jurisdiction.code !== 'DEFAULT')
      .map((jurisdiction) => structuredClone(jurisdiction));
  }

  updateJurisdictionThresholds(
    _code: string,
    _thresholds: Partial<JurisdictionConfig['thresholds']>,
  ): never {
    logger.warn('risk_threshold_update_rejected', {
      reason: 'Risk scoring is disabled and jurisdiction policy is immutable',
    });
    throw new RiskScoringError(
      'Risk scoring policy is immutable while risk assessment is unavailable',
      'RISK_POLICY_IMMUTABLE',
      503,
    );
  }
}

export class RiskScoringError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'RiskScoringError';
  }
}

export const riskScoringService = new RiskScoringService();
