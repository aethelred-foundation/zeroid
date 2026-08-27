import crypto from 'crypto';
import { prisma, logger, redis } from '../../runtime';
import {
  SANCTIONS_LIST_NAMES,
  sanctionsScreeningService,
  ScreeningRequest,
  ScreeningResult as AuthoritativeScreeningResult,
} from '../compliance/sanctions-screening';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreeningResult = 'clear' | 'potential_match' | 'confirmed_match' | 'inconclusive';
export type ComplianceReportType = 'kyc' | 'aml' | 'sanctions' | 'pep' | 'travel_rule' | 'comprehensive';
export type RegulatoryFramework = 'FATF' | 'AMLD6' | 'BSA' | 'MAS_PSA' | 'VARA' | 'MiCA' | 'FCA_MLR' | 'FINMA_AMLA';
export type ComplianceAlertLevel = 'info' | 'warning' | 'violation' | 'critical';

export interface SanctionsScreeningRequest {
  identityId: string;
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  aliases?: string[];
  documentNumbers?: string[];
  jurisdiction: string;
}

export interface SanctionsScreeningResult {
  screeningId: string;
  identityId: string;
  result: ScreeningResult;
  matchScore: number;          // 0-100
  matchedLists: SanctionsListMatch[];
  pepMatches: PEPMatch[];
  adverseMedia: AdverseMediaHit[];
  riskIndicators: string[];
  screenedAt: Date;
  expiresAt: Date;
  listsChecked: string[];
  /** Screening categories for which no provider ran. */
  unavailableChecks: string[];
}

interface SanctionsListMatch {
  listName: string;
  listSource: string;        // OFAC, EU, UN, UK_HMT
  matchedName: string;
  matchConfidence: number;
  entityType: 'individual' | 'entity' | 'vessel' | 'aircraft';
  sanctions: string[];
  listedSince: Date;
  lastUpdated: Date;
  sdnId?: string;
}

interface PEPMatch {
  name: string;
  position: string;
  country: string;
  level: 'head_of_state' | 'senior_official' | 'family_member' | 'close_associate';
  active: boolean;
  matchConfidence: number;
  source: string;
}

interface AdverseMediaHit {
  headline: string;
  source: string;
  publishedAt: Date;
  relevanceScore: number;
  categories: string[];
  url: string;
}

export interface ComplianceReport {
  reportId: string;
  entityId: string;
  reportType: ComplianceReportType;
  status: 'generating' | 'complete' | 'failed';
  summary: string;
  sections: ReportSection[];
  complianceScore: number;
  gaps: ComplianceGap[];
  recommendations: string[];
  generatedAt: Date;
  validUntil: Date;
  jurisdiction: string;
  regulatoryFramework: RegulatoryFramework;
}

interface ReportSection {
  title: string;
  status: 'pass' | 'warning' | 'fail' | 'not_applicable';
  findings: string[];
  evidence: Record<string, unknown>;
}

export interface ComplianceGap {
  gapId: string;
  category: string;
  severity: ComplianceAlertLevel;
  description: string;
  regulation: string;
  remediation: string;
  deadline?: Date;
}

export interface ComplianceAlert {
  alertId: string;
  entityId: string;
  level: ComplianceAlertLevel;
  category: string;
  title: string;
  description: string;
  regulation: string;
  actionRequired: string;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

interface StoredComplianceAlert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  entityId: string | null;
  actionRequired: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AdvisorQuery {
  question: string;
  context?: {
    identityId?: string;
    jurisdiction?: string;
    regulatoryFramework?: RegulatoryFramework;
  };
}

export interface AdvisorResponse {
  queryId: string;
  question: string;
  answer: string;
  confidence: number;
  citations: { regulation: string; section: string; text: string }[];
  relatedTopics: string[];
  disclaimer: string;
  timestamp: Date;
}

export interface RegulatoryChangeImpact {
  changeId: string;
  regulation: string;
  effectiveDate: Date;
  description: string;
  impactedEntities: number;
  impactedCredentialTypes: string[];
  requiredActions: string[];
  estimatedEffort: 'low' | 'medium' | 'high' | 'critical';
  automationPossible: boolean;
}

// ---------------------------------------------------------------------------
// Compliance Advisor Service
// ---------------------------------------------------------------------------

export class ComplianceAdvisorService {
  private readonly alertTtlSeconds = 180 * 86400;

  // -------------------------------------------------------------------------
  // Sanctions & PEP screening
  // -------------------------------------------------------------------------
  async screenIdentity(request: SanctionsScreeningRequest): Promise<SanctionsScreeningResult> {
    return this.screenIdentityWithSignedLists(request);
  }

  private async screenIdentityWithSignedLists(
    request: SanctionsScreeningRequest,
  ): Promise<SanctionsScreeningResult> {
    let authoritativeResult: AuthoritativeScreeningResult;
    try {
      authoritativeResult = await sanctionsScreeningService.screenEntity(
        this.toAuthoritativeScreeningRequest(request),
      );
    } catch (err) {
      logger.error('authoritative_screening_unavailable', {
        identityId: request.identityId,
        error: (err as Error).message,
        code: (err as Error & { code?: string }).code,
      });
      throw new ComplianceAdvisorError(
        'Sanctions and PEP screening is unavailable until current signed list data is configured.',
        'PRODUCTION_SCREENING_UNAVAILABLE',
        503,
      );
    }

    const result = this.fromAuthoritativeScreeningResult(authoritativeResult);
    await this.persistScreeningResult(result, request);
    return result;
  }

  private toAuthoritativeScreeningRequest(
    request: SanctionsScreeningRequest,
  ): ScreeningRequest {
    return {
      entityId: request.identityId,
      entityType: 'individual',
      names: [
        { fullName: request.fullName, nameType: 'primary', script: 'latin' },
        ...(request.aliases ?? []).map((alias) => ({
          fullName: alias,
          nameType: 'alias' as const,
          script: 'latin' as const,
        })),
      ],
      dateOfBirth: request.dateOfBirth,
      nationality: request.nationality,
      identifiers: (request.documentNumbers ?? []).map((value) => ({
        type: 'national_id' as const,
        value,
        country: request.nationality,
      })),
      addresses: request.nationality ? [{ country: request.nationality }] : [],
      screenAgainst: [...SANCTIONS_LIST_NAMES],
    };
  }

  private fromAuthoritativeScreeningResult(
    result: AuthoritativeScreeningResult,
  ): SanctionsScreeningResult {
    const activeMatches = result.matches.filter((match) => match.status !== 'false_positive');
    const matchScore = activeMatches.length > 0
      ? Math.round(Math.max(...activeMatches.map((match) => match.matchScore)) * 100)
      : 0;

    return {
      screeningId: result.screeningId,
      identityId: result.entityId,
      result: result.overallRisk,
      matchScore,
      // PEP hits remain signed-list matches because the authoritative source
      // does not provide structured position, country, or relationship fields.
      matchedLists: activeMatches.map((match) => ({
        listName: match.listSource,
        listSource: match.listSource,
        matchedName: match.matchedName,
        matchConfidence: match.matchScore,
        entityType: 'individual',
        sanctions: match.listingDetails.programs,
        listedSince: new Date(match.listingDetails.listedDate),
        lastUpdated: new Date(result.timestamp),
        sdnId: match.listEntryId,
      })),
      pepMatches: [],
      adverseMedia: [],
      riskIndicators: activeMatches.map((match) => `${match.listSource}:${match.status}`),
      screenedAt: new Date(result.timestamp),
      expiresAt: new Date(result.nextScreeningDate),
      listsChecked: result.listsScreened,
      unavailableChecks: ['adverse_media', 'pep_profile_enrichment'],
    };
  }

  // -------------------------------------------------------------------------
  // Compliance report generation
  // -------------------------------------------------------------------------
  async generateReport(
    _entityId: string,
    _reportType: ComplianceReportType,
    _jurisdiction: string,
  ): Promise<ComplianceReport> {
    throw new ComplianceAdvisorError(
      'Compliance reports are unavailable until an approved, versioned policy and authority-reviewed report templates are configured.',
      'COMPLIANCE_REPORT_POLICY_UNCONFIGURED',
      503,
    );
  }

  // -------------------------------------------------------------------------
  // Natural language compliance advisor
  // -------------------------------------------------------------------------
  async queryComplianceAdvisor(
    _query: AdvisorQuery,
  ): Promise<AdvisorResponse> {
    throw new ComplianceAdvisorError(
      'The compliance advisor is unavailable until an authority-reviewed, versioned regulatory knowledge source is configured.',
      'COMPLIANCE_ADVISOR_KB_UNCONFIGURED',
      503,
    );
  }

  // -------------------------------------------------------------------------
  // Regulatory change impact assessment
  // -------------------------------------------------------------------------
  async assessRegulatoryChangeImpact(
    _regulation: string,
    _changes: string,
    _jurisdiction: string,
  ): Promise<RegulatoryChangeImpact> {
    throw new ComplianceAdvisorError(
      'Regulatory impact assessment is unavailable until an authoritative change feed and approved policy mapping define effective dates and affected records.',
      'REGULATORY_IMPACT_POLICY_UNCONFIGURED',
      503,
    );
  }

  async simulateRegulatoryChange(
    regulation: string,
    changes: string,
    jurisdiction: string,
  ): Promise<RegulatoryChangeImpact> {
    // Backward-compatible alias for older callers.
    return this.assessRegulatoryChangeImpact(regulation, changes, jurisdiction);
  }

  // -------------------------------------------------------------------------
  // Compliance alerts management
  // -------------------------------------------------------------------------
  async getActiveAlerts(entityId?: string): Promise<ComplianceAlert[]> {
    let rows: StoredComplianceAlert[];
    try {
      rows = await prisma.complianceAlert.findMany({
        where: {
          resolvedAt: null,
          entityId: entityId ?? { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (err) {
      throw this.complianceAlertStoreError('list', err);
    }

    return rows.map((row) => this.fromStoredComplianceAlert(row));
  }

  async acknowledgeAlert(alertId: string, actorId: string): Promise<ComplianceAlert> {
    const stored = await this.loadStoredComplianceAlert(alertId);
    if (!stored || stored.resolvedAt) {
      throw new ComplianceAdvisorError(
        'Compliance alert not found',
        'COMPLIANCE_ALERT_NOT_FOUND',
        404,
      );
    }

    if (stored.acknowledged) {
      return this.fromStoredComplianceAlert(stored);
    }

    const alert = this.fromStoredComplianceAlert(stored);
    const acknowledgedAt = new Date();
    let updated: StoredComplianceAlert;
    try {
      updated = await prisma.complianceAlert.update({
        where: { id: alertId },
        data: {
          acknowledged: true,
          acknowledgedBy: actorId,
          metadata: {
            regulation: alert.regulation,
            actionRequired: alert.actionRequired,
            acknowledgedAt: acknowledgedAt.toISOString(),
          },
        },
      });
    } catch (err) {
      throw this.complianceAlertStoreError('acknowledge', err);
    }

    const acknowledged = this.fromStoredComplianceAlert(updated);
    await this.cacheComplianceAlert(acknowledged);

    logger.info('compliance_alert_acknowledged', {
      alertId,
      actorId,
      entityId: acknowledged.entityId,
    });

    return acknowledged;
  }

  async getAlert(alertId: string): Promise<ComplianceAlert | null> {
    const stored = await this.loadStoredComplianceAlert(alertId);
    return stored ? this.fromStoredComplianceAlert(stored) : null;
  }

  async createComplianceAlert(
    entityId: string,
    level: ComplianceAlertLevel,
    category: string,
    title: string,
    description: string,
    regulation: string,
    actionRequired: string,
  ): Promise<ComplianceAlert> {
    const alertId = `calert-${crypto.randomUUID()}`;
    let stored: StoredComplianceAlert;
    try {
      stored = await prisma.complianceAlert.create({
        data: {
          id: alertId,
          alertType: category,
          severity: this.toStoredRiskLevel(level),
          title,
          description,
          entityId,
          entityType: 'identity',
          actionRequired: actionRequired.trim().length > 0,
          metadata: {
            regulation,
            actionRequired,
          },
        },
      });
    } catch (err) {
      throw this.complianceAlertStoreError('create', err);
    }

    const alert = this.fromStoredComplianceAlert(stored);
    await this.cacheComplianceAlert(alert);

    logger.warn('compliance_alert_created', {
      alertId: alert.alertId,
      entityId,
      level,
      category,
      title,
    });

    return alert;
  }

  private complianceAlertKey(alertId: string): string {
    return `compliance:alert:${alertId}`;
  }

  private async loadStoredComplianceAlert(
    alertId: string,
  ): Promise<StoredComplianceAlert | null> {
    try {
      return await prisma.complianceAlert.findUnique({
        where: { id: alertId },
      });
    } catch (err) {
      throw this.complianceAlertStoreError('load', err);
    }
  }

  private fromStoredComplianceAlert(
    stored: StoredComplianceAlert,
  ): ComplianceAlert {
    if (!stored.entityId) {
      throw new ComplianceAdvisorError(
        'Stored compliance alert has no identity target.',
        'COMPLIANCE_ALERT_DATA_INVALID',
        503,
      );
    }

    const metadata = this.parseComplianceAlertMetadata(stored.metadata);
    return {
      alertId: stored.id,
      entityId: stored.entityId,
      level: this.fromStoredRiskLevel(stored.severity),
      category: stored.alertType,
      title: stored.title,
      description: stored.description,
      regulation: metadata.regulation,
      actionRequired: metadata.actionRequired,
      createdAt: stored.createdAt,
      acknowledgedAt: stored.acknowledged
        ? metadata.acknowledgedAt
        : undefined,
      resolvedAt: stored.resolvedAt ?? undefined,
    };
  }

  private parseComplianceAlertMetadata(metadata: unknown): {
    regulation: string;
    actionRequired: string;
    acknowledgedAt?: Date;
  } {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new ComplianceAdvisorError(
        'Stored compliance alert metadata is invalid.',
        'COMPLIANCE_ALERT_DATA_INVALID',
        503,
      );
    }

    const record = metadata as Record<string, unknown>;
    if (
      typeof record.regulation !== 'string' ||
      typeof record.actionRequired !== 'string'
    ) {
      throw new ComplianceAdvisorError(
        'Stored compliance alert metadata is invalid.',
        'COMPLIANCE_ALERT_DATA_INVALID',
        503,
      );
    }

    const acknowledgedAt = record.acknowledgedAt;
    if (
      acknowledgedAt !== undefined &&
      (typeof acknowledgedAt !== 'string' ||
        !Number.isFinite(new Date(acknowledgedAt).getTime()))
    ) {
      throw new ComplianceAdvisorError(
        'Stored compliance alert acknowledgement time is invalid.',
        'COMPLIANCE_ALERT_DATA_INVALID',
        503,
      );
    }

    return {
      regulation: record.regulation,
      actionRequired: record.actionRequired,
      acknowledgedAt: acknowledgedAt
        ? new Date(acknowledgedAt)
        : undefined,
    };
  }

  private toStoredRiskLevel(
    level: ComplianceAlertLevel,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const levels: Record<
      ComplianceAlertLevel,
      'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    > = {
      info: 'LOW',
      warning: 'MEDIUM',
      violation: 'HIGH',
      critical: 'CRITICAL',
    };
    return levels[level];
  }

  private fromStoredRiskLevel(level: string): ComplianceAlertLevel {
    const levels: Record<string, ComplianceAlertLevel> = {
      LOW: 'info',
      MEDIUM: 'warning',
      HIGH: 'violation',
      CRITICAL: 'critical',
    };
    const mapped = levels[level];
    if (!mapped) {
      throw new ComplianceAdvisorError(
        'Stored compliance alert severity is invalid.',
        'COMPLIANCE_ALERT_DATA_INVALID',
        503,
      );
    }
    return mapped;
  }

  private complianceAlertStoreError(
    operation: string,
    err: unknown,
  ): ComplianceAdvisorError {
    logger.error('compliance_alert_store_error', {
      operation,
      error: (err as Error).message,
    });
    return new ComplianceAdvisorError(
      'Compliance alert storage is unavailable.',
      'COMPLIANCE_ALERT_STORE_UNAVAILABLE',
      503,
    );
  }

  private async cacheComplianceAlert(alert: ComplianceAlert): Promise<void> {
    try {
      await redis.set(
        this.complianceAlertKey(alert.alertId),
        JSON.stringify(alert),
        'EX',
        this.alertTtlSeconds,
      );
    } catch (err) {
      logger.warn('compliance_alert_cache_error', {
        alertId: alert.alertId,
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Compliance score per entity
  // -------------------------------------------------------------------------
  async computeComplianceScore(
    _entityId: string,
    _jurisdiction: string,
  ): Promise<{
    score: number;
    breakdown: Record<string, number>;
    status: 'compliant' | 'partially_compliant' | 'non_compliant';
  }> {
    throw new ComplianceAdvisorError(
      'Compliance scoring is unavailable until an approved, versioned scoring policy is configured.',
      'COMPLIANCE_SCORING_POLICY_UNCONFIGURED',
      503,
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private async persistScreeningResult(
    result: SanctionsScreeningResult,
    request: SanctionsScreeningRequest,
  ): Promise<void> {
    const sanctionsMatches = result.matchedLists.filter(
      (match) => match.listSource !== 'pep_database',
    ).length;
    const pepMatches = result.matchedLists.filter(
      (match) => match.listSource === 'pep_database',
    ).length;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.complianceScreening.create({
          data: {
            id: result.screeningId,
            entityId: result.identityId,
            entityType: 'individual',
            screeningType: 'sanctions_pep',
            queryName: request.fullName,
            queryDetails: {
              jurisdiction: request.jurisdiction,
              nationality: request.nationality ?? null,
              aliasCount: request.aliases?.length ?? 0,
              documentNumberCount: request.documentNumbers?.length ?? 0,
              unavailableChecks: result.unavailableChecks,
            },
            result: this.toStoredScreeningResult(result.result),
            matchScore: result.matchScore,
            matches: {
              signedListMatches: result.matchedLists.map((match) => ({
                ...match,
                listedSince: match.listedSince.toISOString(),
                lastUpdated: match.lastUpdated.toISOString(),
              })),
              riskIndicators: result.riskIndicators,
              unavailableChecks: result.unavailableChecks,
            },
            listsChecked: result.listsChecked,
            screenedAt: result.screenedAt,
            nextScreeningDue: result.expiresAt,
          },
        });

        await tx.auditLog.create({
          data: {
            identityId: result.identityId,
            action: 'SANCTIONS_SCREENING',
            resourceType: 'compliance_screening',
            resourceId: result.screeningId,
            details: {
              result: result.result,
              matchScore: result.matchScore,
              sanctionsMatches,
              pepMatches,
              listsChecked: result.listsChecked.length,
              unavailableChecks: result.unavailableChecks,
            },
          },
        });
      });
    } catch (err) {
      logger.error('screening_persist_error', {
        screeningId: result.screeningId,
        error: (err as Error).message,
      });
      throw new ComplianceAdvisorError(
        'Screening evidence could not be durably recorded.',
        'SCREENING_EVIDENCE_PERSISTENCE_UNAVAILABLE',
        503,
      );
    }

    try {
      await redis.set(
        `screening:latest:${result.identityId}`,
        JSON.stringify(result),
        'EX',
        7 * 86400,
      );
      await redis.set(
        `screening:${result.screeningId}`,
        JSON.stringify(result),
        'EX',
        90 * 86400,
      );
    } catch (err) {
      logger.warn('screening_cache_error', {
        screeningId: result.screeningId,
        error: (err as Error).message,
      });
    }
  }

  private toStoredScreeningResult(
    result: ScreeningResult,
  ): 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH' | 'UNDER_REVIEW' {
    const results: Record<
      ScreeningResult,
      'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH' | 'UNDER_REVIEW'
    > = {
      clear: 'CLEAR',
      potential_match: 'POTENTIAL_MATCH',
      confirmed_match: 'CONFIRMED_MATCH',
      inconclusive: 'UNDER_REVIEW',
    };
    return results[result];
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------
export class ComplianceAdvisorError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ComplianceAdvisorError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const complianceAdvisorService = new ComplianceAdvisorService();
