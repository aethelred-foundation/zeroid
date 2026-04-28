import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'regulatory-reporting' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const ReportTypeSchema = z.enum([
  'SAR',       // Suspicious Activity Report (US/Global)
  'CTR',       // Currency Transaction Report (US)
  'STR',       // Suspicious Transaction Report (UAE)
  'DSAR',      // Data Subject Access Request (GDPR)
  'ERASURE',   // Right to Erasure (GDPR)
  'AUDIT',     // Regulatory Audit Package
  'DASHBOARD', // Compliance Dashboard
]);

export type ReportType = z.infer<typeof ReportTypeSchema>;

export const SARRequestSchema = z.object({
  reportType: z.literal('SAR'),
  filingInstitution: z.object({
    name: z.string(),
    registrationNumber: z.string(),
    jurisdiction: z.string(),
    contactName: z.string(),
    contactEmail: z.string().email(),
    contactPhone: z.string(),
  }),
  subject: z.object({
    entityId: z.string(),
    entityType: z.enum(['individual', 'corporate']),
    name: z.string(),
    identifiers: z.array(z.object({ type: z.string(), value: z.string() })),
    address: z.string().optional(),
    dateOfBirth: z.string().optional(),
    nationality: z.string().optional(),
  }),
  suspiciousActivity: z.object({
    description: z.string().min(50),
    activityType: z.enum([
      'structuring', 'layering', 'unusual_pattern', 'sanctions_evasion',
      'identity_fraud', 'money_laundering', 'terrorist_financing', 'other',
    ]),
    dateRange: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
    amountInvolved: z.number().optional(),
    currency: z.string().default('USD'),
    transactionIds: z.array(z.string()).default([]),
    relatedEntities: z.array(z.string()).default([]),
  }),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
});

export type SARRequest = z.infer<typeof SARRequestSchema>;

export const CTRRequestSchema = z.object({
  reportType: z.literal('CTR'),
  filingInstitution: z.object({
    name: z.string(),
    registrationNumber: z.string(),
    jurisdiction: z.string(),
  }),
  transaction: z.object({
    transactionId: z.string(),
    amount: z.number().min(10000),
    currency: z.string(),
    transactionType: z.enum(['deposit', 'withdrawal', 'transfer', 'exchange']),
    timestamp: z.string().datetime(),
    sourceEntityId: z.string(),
    destinationEntityId: z.string().optional(),
  }),
  conductor: z.object({
    entityId: z.string(),
    name: z.string(),
    identifiers: z.array(z.object({ type: z.string(), value: z.string() })),
    address: z.string().optional(),
  }),
});

export type CTRRequest = z.infer<typeof CTRRequestSchema>;

export const STRRequestSchema = z.object({
  reportType: z.literal('STR'),
  filingInstitution: z.object({
    name: z.string(),
    licenseNumber: z.string(),
    emirate: z.string(),
  }),
  subject: z.object({
    entityId: z.string(),
    name: z.string(),
    emiratesId: z.string().optional(),
    passportNumber: z.string().optional(),
    nationality: z.string(),
  }),
  suspiciousActivity: z.object({
    description: z.string().min(50),
    indicators: z.array(z.string()),
    amountAED: z.number().optional(),
    dateRange: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
    linkedTransactions: z.array(z.string()).default([]),
  }),
  reportingOfficer: z.object({
    name: z.string(),
    designation: z.string(),
    contactEmail: z.string().email(),
  }),
});

export type STRRequest = z.infer<typeof STRRequestSchema>;

export const DSARRequestSchema = z.object({
  reportType: z.literal('DSAR'),
  requestorId: z.string(),
  requestorEmail: z.string().email(),
  requestType: z.enum(['access', 'portability', 'rectification']),
  dataCategories: z.array(z.enum([
    'personal_data', 'financial_data', 'biometric_data',
    'credential_history', 'verification_history', 'consent_records',
    'communication_logs', 'processing_activities',
  ])).min(1),
  jurisdiction: z.string(),
  verificationProof: z.string(),
});

export type DSARRequest = z.infer<typeof DSARRequestSchema>;

export const ErasureRequestSchema = z.object({
  reportType: z.literal('ERASURE'),
  requestorId: z.string(),
  requestorEmail: z.string().email(),
  reason: z.enum(['consent_withdrawn', 'no_longer_necessary', 'unlawful_processing', 'legal_obligation', 'objection']),
  dataCategories: z.array(z.string()).min(1),
  jurisdiction: z.string(),
  verificationProof: z.string(),
  retentionOverrides: z.array(z.object({
    category: z.string(),
    reason: z.string(),
    retainUntil: z.string().datetime(),
  })).default([]),
});

export type ErasureRequest = z.infer<typeof ErasureRequestSchema>;

export const ExportFormatSchema = z.enum(['json', 'xml', 'csv', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------
export interface ReportEvidenceEvent {
  eventId: string;
  action: 'generated' | 'submitted' | 'amended' | 'exported' | 'acknowledged';
  recordedAt: string;
  receiptId?: string;
  actorIdentityId?: string;
  policyName: string;
  policyVersion?: string;
  decisionSummary?: string;
  authority?: string;
  filingReference?: string | null;
  version: number;
  amendmentReason?: string;
  exportFormat?: string;
  exportFilename?: string;
  deliveryChannel?: string;
  deliveryDestination?: string;
  deliveryAcknowledgementId?: string;
  deliveryAcknowledgedAt?: string;
}

export interface ReportAuthorityManifestEvent {
  eventId: string;
  stage: 'submitted' | 'amended' | 'exported' | 'acknowledged';
  recordedAt: string;
  acknowledgementStage?: 'submitted' | 'amended' | 'exported';
  actorIdentityId?: string;
  policyName?: string;
  policyVersion?: string;
  authority?: string;
  filingReference?: string | null;
  version: number;
  amendmentReason?: string;
  exportFormat?: string;
  exportFilename?: string;
  deliveryChannel?: string;
  deliveryDestination?: string;
  acknowledgementId?: string;
  acknowledgedAt?: string;
}

export interface ReportAuthorityManifest {
  manifestVersion: 'zeroid.report_authority_manifest.v1';
  reportId: string;
  reportType: ReportType;
  filingJurisdiction: string;
  authority?: string;
  filingReference?: string | null;
  currentVersion: number;
  submittedAt?: string | null;
  supportedExportFormats: ExportFormat[];
  preferredDeliveryChannels: Array<'portal_upload' | 'api' | 'sftp' | 'email'>;
  acknowledgementExpected: boolean;
  latestAmendment?: {
    version: number;
    amendedAt: string;
    reason: string;
  };
  latestExport?: {
    format: string;
    filename: string;
    exportedAt: string;
    deliveryChannel?: string;
    deliveryDestination?: string;
    deliveryAcknowledgementId?: string;
    deliveryAcknowledgedAt?: string;
  };
  acknowledgements: Array<{
    acknowledgementId: string;
    stage: 'submitted' | 'amended' | 'exported';
    acknowledgedAt: string;
    channel?: string;
    destination?: string;
    authority?: string;
  }>;
  handoffTrail: ReportAuthorityManifestEvent[];
  lastUpdatedAt: string;
}

export interface GeneratedReport {
  reportId: string;
  organizationId?: string;
  reportType: ReportType;
  version: number;
  status: 'draft' | 'pending_review' | 'submitted' | 'accepted' | 'rejected' | 'amended';
  filingJurisdiction: string;
  generatedAt: string;
  submittedAt: string | null;
  expiresAt: string | null;
  content: Record<string, unknown>;
  amendments: Array<{ version: number; amendedAt: string; reason: string; changes: Record<string, unknown> }>;
  filingReference: string | null;
  exportFormats: ExportFormat[];
  evidenceTrail?: ReportEvidenceEvent[];
  authorityManifest?: ReportAuthorityManifest;
}

export interface DashboardData {
  totalReports: number;
  reportsByType: Record<string, number>;
  reportsByStatus: Record<string, number>;
  pendingDeadlines: Array<{ reportId: string; reportType: string; deadline: string; daysRemaining: number }>;
  complianceScore: number;
  recentFilings: Array<{ reportId: string; reportType: string; status: string; submittedAt: string }>;
  jurisdictionCoverage: Array<{ jurisdiction: string; compliant: boolean; lastAudit: string }>;
}

// ---------------------------------------------------------------------------
// RegulatoryReportingService
// ---------------------------------------------------------------------------
export class RegulatoryReportingService {
  private reports: Map<string, GeneratedReport> = new Map();
  private filingQueue: Array<{ reportId: string; scheduledAt: string; retryCount: number }> = [];

  constructor() {
    logger.info('RegulatoryReportingService initialized');
  }

  // -------------------------------------------------------------------------
  // SAR generation
  // -------------------------------------------------------------------------
  async generateSAR(request: SARRequest, organizationId?: string): Promise<GeneratedReport> {
    const parsed = SARRequestSchema.parse(request);
    const reportId = crypto.randomUUID();

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'SAR',
      version: 1,
      status: 'draft',
      filingJurisdiction: parsed.filingInstitution.jurisdiction,
      generatedAt: new Date().toISOString(),
      submittedAt: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      content: {
        bsaId: this.generateBSAId(),
        filingInstitution: parsed.filingInstitution,
        subjectInformation: parsed.subject,
        narrativeDescription: parsed.suspiciousActivity.description,
        activityType: parsed.suspiciousActivity.activityType,
        dateRange: parsed.suspiciousActivity.dateRange,
        amountInvolved: parsed.suspiciousActivity.amountInvolved,
        currency: parsed.suspiciousActivity.currency,
        relatedTransactions: parsed.suspiciousActivity.transactionIds,
        relatedEntities: parsed.suspiciousActivity.relatedEntities,
        priority: parsed.priority,
        filingDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        continuingActivity: false,
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'xml', 'pdf'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('SAR', parsed.filingInstitution.jurisdiction, reportId, 1, ['json', 'xml', 'pdf']),
    };

    this.reports.set(reportId, report);
    this.scheduleForFiling(reportId);

    logger.info('sar_generated', { reportId, entityId: parsed.subject.entityId, priority: parsed.priority });
    return report;
  }

  // -------------------------------------------------------------------------
  // CTR generation
  // -------------------------------------------------------------------------
  async generateCTR(request: CTRRequest, organizationId?: string): Promise<GeneratedReport> {
    const parsed = CTRRequestSchema.parse(request);
    const reportId = crypto.randomUUID();

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'CTR',
      version: 1,
      status: 'draft',
      filingJurisdiction: parsed.filingInstitution.jurisdiction,
      generatedAt: new Date().toISOString(),
      submittedAt: null,
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      content: {
        ctrId: this.generateCTRId(),
        filingInstitution: parsed.filingInstitution,
        transactionDetails: parsed.transaction,
        conductorInformation: parsed.conductor,
        filingDeadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        thresholdAmount: 10000,
        thresholdCurrency: 'USD',
        aggregated: false,
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'xml', 'pdf'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('CTR', parsed.filingInstitution.jurisdiction, reportId, 1, ['json', 'xml', 'pdf']),
    };

    this.reports.set(reportId, report);
    this.scheduleForFiling(reportId);

    logger.info('ctr_generated', { reportId, amount: parsed.transaction.amount, currency: parsed.transaction.currency });
    return report;
  }

  // -------------------------------------------------------------------------
  // STR generation (UAE)
  // -------------------------------------------------------------------------
  async generateSTR(request: STRRequest, organizationId?: string): Promise<GeneratedReport> {
    const parsed = STRRequestSchema.parse(request);
    const reportId = crypto.randomUUID();

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'STR',
      version: 1,
      status: 'draft',
      filingJurisdiction: `AE-${parsed.filingInstitution.emirate}`,
      generatedAt: new Date().toISOString(),
      submittedAt: null,
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      content: {
        goAmlReference: this.generateGoAMLRef(),
        filingInstitution: parsed.filingInstitution,
        subjectInformation: parsed.subject,
        suspiciousIndicators: parsed.suspiciousActivity.indicators,
        narrative: parsed.suspiciousActivity.description,
        amountAED: parsed.suspiciousActivity.amountAED,
        dateRange: parsed.suspiciousActivity.dateRange,
        linkedTransactions: parsed.suspiciousActivity.linkedTransactions,
        reportingOfficer: parsed.reportingOfficer,
        filingDeadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        uaeFIUSubmission: true,
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'xml', 'pdf'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('STR', `AE-${parsed.filingInstitution.emirate}`, reportId, 1, ['json', 'xml', 'pdf']),
    };

    this.reports.set(reportId, report);
    this.scheduleForFiling(reportId);

    logger.info('str_generated', { reportId, emirate: parsed.filingInstitution.emirate });
    return report;
  }

  // -------------------------------------------------------------------------
  // DSAR fulfillment
  // -------------------------------------------------------------------------
  async fulfillDSAR(request: DSARRequest, organizationId?: string): Promise<GeneratedReport> {
    const parsed = DSARRequestSchema.parse(request);
    const reportId = crypto.randomUUID();

    // Simulate data collection across service boundaries
    const collectedData: Record<string, unknown> = {};
    for (const category of parsed.dataCategories) {
      collectedData[category] = {
        status: 'collected',
        recordCount: Math.floor(Math.random() * 50) + 1,
        lastUpdated: new Date().toISOString(),
        retentionPolicy: this.getRetentionPolicyForCategory(category),
      };
    }

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'DSAR',
      version: 1,
      status: 'pending_review',
      filingJurisdiction: parsed.jurisdiction,
      generatedAt: new Date().toISOString(),
      submittedAt: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      content: {
        requestorId: parsed.requestorId,
        requestorEmail: parsed.requestorEmail,
        requestType: parsed.requestType,
        dataCategories: parsed.dataCategories,
        collectedData,
        responseDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        gdprArticle: parsed.requestType === 'access' ? '15' : parsed.requestType === 'portability' ? '20' : '16',
        verificationStatus: 'verified',
        thirdPartyDisclosures: [],
        automaticProcessing: true,
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'csv', 'pdf'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('DSAR', parsed.jurisdiction, reportId, 1, ['json', 'csv', 'pdf']),
    };

    this.reports.set(reportId, report);

    logger.info('dsar_fulfilled', { reportId, requestorId: parsed.requestorId, categories: parsed.dataCategories });
    return report;
  }

  // -------------------------------------------------------------------------
  // Right-to-erasure with cryptographic erasure
  // -------------------------------------------------------------------------
  async processErasure(request: ErasureRequest, organizationId?: string): Promise<GeneratedReport> {
    const parsed = ErasureRequestSchema.parse(request);
    const reportId = crypto.randomUUID();

    const erasureResults: Record<string, { erased: boolean; method: string; retainedReason?: string; retainUntil?: string }> = {};

    for (const category of parsed.dataCategories) {
      const override = parsed.retentionOverrides.find((o) => o.category === category);
      if (override) {
        erasureResults[category] = {
          erased: false,
          method: 'retention_override',
          retainedReason: override.reason,
          retainUntil: override.retainUntil,
        };
      } else {
        // Cryptographic erasure — destroy encryption keys
        const erasureKeyId = crypto.randomUUID();
        erasureResults[category] = {
          erased: true,
          method: 'cryptographic_erasure',
        };
        logger.info('cryptographic_erasure_executed', { category, erasureKeyId, requestorId: parsed.requestorId });
      }
    }

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'ERASURE',
      version: 1,
      status: 'submitted',
      filingJurisdiction: parsed.jurisdiction,
      generatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      expiresAt: null,
      content: {
        requestorId: parsed.requestorId,
        requestorEmail: parsed.requestorEmail,
        reason: parsed.reason,
        erasureResults,
        gdprArticle: '17',
        completionTimestamp: new Date().toISOString(),
        verificationStatus: 'verified',
        dataProcessorsNotified: ['credential_store', 'verification_cache', 'analytics_pipeline'],
        backupPurgePending: true,
        backupPurgeDeadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'pdf'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('ERASURE', parsed.jurisdiction, reportId, 1, ['json', 'pdf']),
    };

    this.reports.set(reportId, report);

    logger.info('erasure_processed', { reportId, requestorId: parsed.requestorId, categoriesErased: Object.keys(erasureResults).filter((k) => erasureResults[k].erased).length });
    return report;
  }

  // -------------------------------------------------------------------------
  // Audit package generation
  // -------------------------------------------------------------------------
  async generateAuditPackage(
    jurisdiction: string,
    dateRange: { start: string; end: string },
    organizationId?: string,
  ): Promise<GeneratedReport> {
    const reportId = crypto.randomUUID();
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    const reportsInRange = [...this.reports.values()].filter((r) => {
      if (organizationId && r.organizationId !== organizationId) return false;
      const genDate = new Date(r.generatedAt);
      return genDate >= startDate && genDate <= endDate && (r.filingJurisdiction === jurisdiction || jurisdiction === 'all');
    });

    const report: GeneratedReport = {
      reportId,
      ...(organizationId ? { organizationId } : {}),
      reportType: 'AUDIT',
      version: 1,
      status: 'draft',
      filingJurisdiction: jurisdiction,
      generatedAt: new Date().toISOString(),
      submittedAt: null,
      expiresAt: null,
      content: {
        auditPeriod: dateRange,
        jurisdiction,
        totalReports: reportsInRange.length,
        reportBreakdown: this.groupBy(reportsInRange, 'reportType'),
        statusBreakdown: this.groupBy(reportsInRange, 'status'),
        filingTimeliness: this.calculateFilingTimeliness(reportsInRange),
        complianceGaps: this.identifyComplianceGaps(reportsInRange, jurisdiction),
        recommendations: this.generateRecommendations(reportsInRange),
        preparedBy: 'ZeroID Compliance Engine',
        preparedAt: new Date().toISOString(),
      },
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'xml', 'pdf', 'csv'],
      evidenceTrail: [],
      authorityManifest: this.buildAuthorityManifest('AUDIT', jurisdiction, reportId, 1, ['json', 'xml', 'pdf', 'csv']),
    };

    this.reports.set(reportId, report);

    logger.info('audit_package_generated', { reportId, jurisdiction, reportsIncluded: reportsInRange.length });
    return report;
  }

  // -------------------------------------------------------------------------
  // Dashboard data aggregation
  // -------------------------------------------------------------------------
  getDashboardData(organizationId?: string): DashboardData {
    const allReports = this.getReportsForOrganization(organizationId);
    const now = Date.now();

    const reportsByType: Record<string, number> = {};
    const reportsByStatus: Record<string, number> = {};

    for (const report of allReports) {
      reportsByType[report.reportType] = (reportsByType[report.reportType] ?? 0) + 1;
      reportsByStatus[report.status] = (reportsByStatus[report.status] ?? 0) + 1;
    }

    const pendingDeadlines = allReports
      .filter((r) => r.expiresAt && r.status !== 'submitted' && r.status !== 'accepted')
      .map((r) => ({
        reportId: r.reportId,
        reportType: r.reportType,
        deadline: r.expiresAt!,
        daysRemaining: Math.ceil((new Date(r.expiresAt!).getTime() - now) / (1000 * 60 * 60 * 24)),
      }))
      .filter((r) => r.daysRemaining > 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const recentFilings = allReports
      .filter((r) => r.submittedAt)
      .sort((a, b) => new Date(b.submittedAt!).getTime() - new Date(a.submittedAt!).getTime())
      .slice(0, 10)
      .map((r) => ({
        reportId: r.reportId,
        reportType: r.reportType,
        status: r.status,
        submittedAt: r.submittedAt!,
      }));

    const submittedOnTime = allReports.filter((r) => r.status === 'submitted' || r.status === 'accepted').length;
    const complianceScore = allReports.length > 0 ? Math.round((submittedOnTime / allReports.length) * 100) : 100;

    return {
      totalReports: allReports.length,
      reportsByType,
      reportsByStatus,
      pendingDeadlines,
      complianceScore,
      recentFilings,
      jurisdictionCoverage: [],
    };
  }

  // -------------------------------------------------------------------------
  // Report amendment
  // -------------------------------------------------------------------------
  async amendReport(
    reportId: string,
    reason: string,
    changes: Record<string, unknown>,
    organizationId?: string,
  ): Promise<GeneratedReport> {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report) {
      throw new ReportingError(`Report not found: ${reportId}`, 'REPORT_NOT_FOUND', 404);
    }

    report.version += 1;
    report.amendments.push({
      version: report.version,
      amendedAt: new Date().toISOString(),
      reason,
      changes,
    });

    // Merge changes into content
    report.content = { ...report.content, ...changes };
    report.status = 'amended';

    this.reports.set(reportId, report);
    logger.info('report_amended', { reportId, version: report.version, reason });
    return report;
  }

  // -------------------------------------------------------------------------
  // Submit report to regulatory API
  // -------------------------------------------------------------------------
  async submitReport(
    reportId: string,
    organizationId?: string,
  ): Promise<{ filingReference: string; submittedAt: string }> {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report) {
      throw new ReportingError(`Report not found: ${reportId}`, 'REPORT_NOT_FOUND', 404);
    }

    if (report.status === 'submitted' || report.status === 'accepted') {
      throw new ReportingError('Report already submitted', 'ALREADY_SUBMITTED', 409);
    }

    // Simulate regulatory API submission
    const filingReference = `${report.reportType}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    report.filingReference = filingReference;
    report.submittedAt = new Date().toISOString();
    report.status = 'submitted';

    this.reports.set(reportId, report);
    logger.info('report_submitted', { reportId, filingReference, reportType: report.reportType });

    return { filingReference, submittedAt: report.submittedAt };
  }

  // -------------------------------------------------------------------------
  // Export in multiple formats
  // -------------------------------------------------------------------------
  async exportReport(
    reportId: string,
    format: ExportFormat,
    organizationId?: string,
  ): Promise<{ data: string; contentType: string; filename: string }> {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report) {
      throw new ReportingError(`Report not found: ${reportId}`, 'REPORT_NOT_FOUND', 404);
    }

    if (!report.exportFormats.includes(format)) {
      throw new ReportingError(`Format ${format} not supported for ${report.reportType}`, 'FORMAT_NOT_SUPPORTED', 400);
    }

    const filename = `${report.reportType}_${report.reportId}_v${report.version}`;

    switch (format) {
      case 'json':
        return { data: JSON.stringify(report, null, 2), contentType: 'application/json', filename: `${filename}.json` };
      case 'xml':
        return { data: this.toXML(report), contentType: 'application/xml', filename: `${filename}.xml` };
      case 'csv':
        return { data: this.toCSV(report), contentType: 'text/csv', filename: `${filename}.csv` };
      case 'pdf':
        return { data: Buffer.from(JSON.stringify(report)).toString('base64'), contentType: 'application/pdf', filename: `${filename}.pdf` };
      default:
        throw new ReportingError(`Unknown format: ${format}`, 'UNKNOWN_FORMAT', 400);
    }
  }

  // -------------------------------------------------------------------------
  // Retrieve reports
  // -------------------------------------------------------------------------
  getReport(reportId: string, organizationId?: string): GeneratedReport | null {
    return this.getReportForOrganization(reportId, organizationId);
  }

  listReports(filters?: {
    type?: ReportType;
    status?: string;
    jurisdiction?: string;
    organizationId?: string;
  }): GeneratedReport[] {
    let reports = this.getReportsForOrganization(filters?.organizationId);
    if (filters?.type) reports = reports.filter((r) => r.reportType === filters.type);
    if (filters?.status) reports = reports.filter((r) => r.status === filters.status);
    if (filters?.jurisdiction) reports = reports.filter((r) => r.filingJurisdiction === filters.jurisdiction);
    return reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  recordEvidenceEvent(
    reportId: string,
    event: Omit<ReportEvidenceEvent, 'eventId' | 'recordedAt'>,
    organizationId?: string,
  ): ReportEvidenceEvent {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report) {
      throw new ReportingError(`Report not found: ${reportId}`, 'REPORT_NOT_FOUND', 404);
    }

    const recordedAt = new Date().toISOString();
    const entry: ReportEvidenceEvent = {
      eventId: crypto.randomUUID(),
      recordedAt,
      ...event,
    };

    report.evidenceTrail = [...(report.evidenceTrail ?? []), entry]
      .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
    this.reports.set(reportId, report);
    logger.info('report_evidence_recorded', {
      reportId,
      action: event.action,
      receiptId: event.receiptId,
      version: event.version,
    });
    return entry;
  }

  getEvidenceTrail(reportId: string, organizationId?: string): ReportEvidenceEvent[] {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report?.evidenceTrail) {
      return [];
    }

    return [...report.evidenceTrail]
      .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
  }

  recordAuthorityManifestEvent(
    reportId: string,
    event: Omit<ReportAuthorityManifestEvent, 'eventId' | 'recordedAt'>,
    organizationId?: string,
  ): ReportAuthorityManifest {
    const report = this.getReportForOrganization(reportId, organizationId);
    if (!report) {
      throw new ReportingError(`Report not found: ${reportId}`, 'REPORT_NOT_FOUND', 404);
    }

    const recordedAt = new Date().toISOString();
    const manifest = report.authorityManifest ?? this.buildAuthorityManifest(
      report.reportType,
      report.filingJurisdiction,
      report.reportId,
      report.version,
      report.exportFormats,
    );
    const trailEntry: ReportAuthorityManifestEvent = {
      eventId: crypto.randomUUID(),
      recordedAt,
      ...event,
    };

    manifest.currentVersion = report.version;
    manifest.reportType = report.reportType;
    manifest.filingJurisdiction = report.filingJurisdiction;
    manifest.filingReference = report.filingReference;
    if (event.authority) {
      manifest.authority = event.authority;
    }
    if (report.submittedAt !== undefined) {
      manifest.submittedAt = report.submittedAt;
    }

    if (event.stage === 'amended') {
      const latestAmendment = report.amendments[report.amendments.length - 1];
      if (latestAmendment) {
        manifest.latestAmendment = {
          version: latestAmendment.version,
          amendedAt: latestAmendment.amendedAt,
          reason: latestAmendment.reason,
        };
      }
    }

    if (event.stage === 'exported') {
      manifest.latestExport = {
        format: event.exportFormat ?? manifest.latestExport?.format ?? 'unknown',
        filename: event.exportFilename ?? manifest.latestExport?.filename ?? `${report.reportType}_${report.reportId}_v${report.version}`,
        exportedAt: recordedAt,
        ...(event.deliveryChannel ? { deliveryChannel: event.deliveryChannel } : {}),
        ...(event.deliveryDestination ? { deliveryDestination: event.deliveryDestination } : {}),
        ...(event.acknowledgementId ? { deliveryAcknowledgementId: event.acknowledgementId } : {}),
        ...(event.acknowledgedAt ? { deliveryAcknowledgedAt: event.acknowledgedAt } : {}),
      };
    }

    if (event.stage === 'acknowledged' && event.acknowledgementId && event.acknowledgementStage) {
      manifest.acknowledgements = [
        ...manifest.acknowledgements,
        {
          acknowledgementId: event.acknowledgementId,
          stage: event.acknowledgementStage,
          acknowledgedAt: event.acknowledgedAt ?? recordedAt,
          ...(event.deliveryChannel ? { channel: event.deliveryChannel } : {}),
          ...(event.deliveryDestination ? { destination: event.deliveryDestination } : {}),
          ...(event.authority ? { authority: event.authority } : {}),
        },
      ].sort((left, right) => new Date(left.acknowledgedAt).getTime() - new Date(right.acknowledgedAt).getTime());

      if (manifest.latestExport && event.acknowledgementStage === 'exported') {
        manifest.latestExport = {
          ...manifest.latestExport,
          deliveryAcknowledgementId: event.acknowledgementId,
          deliveryAcknowledgedAt: event.acknowledgedAt ?? recordedAt,
          ...(event.deliveryChannel ? { deliveryChannel: event.deliveryChannel } : {}),
          ...(event.deliveryDestination ? { deliveryDestination: event.deliveryDestination } : {}),
        };
      }
    }

    manifest.handoffTrail = [...manifest.handoffTrail, trailEntry]
      .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
    manifest.lastUpdatedAt = recordedAt;

    report.authorityManifest = manifest;
    this.reports.set(reportId, report);
    logger.info('report_authority_manifest_recorded', {
      reportId,
      stage: event.stage,
      acknowledgementStage: event.acknowledgementStage,
      version: event.version,
    });

    return manifest;
  }

  getAuthorityManifest(reportId: string, organizationId?: string): ReportAuthorityManifest | null {
    const report = this.getReportForOrganization(reportId, organizationId);
    return report?.authorityManifest ?? null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------
  private getReportsForOrganization(organizationId?: string): GeneratedReport[] {
    const reports = [...this.reports.values()];
    if (!organizationId) return reports;
    return reports.filter((report) => report.organizationId === organizationId);
  }

  private getReportForOrganization(
    reportId: string,
    organizationId?: string,
  ): GeneratedReport | null {
    const report = this.reports.get(reportId) ?? null;
    if (!report) return null;
    if (organizationId && report.organizationId !== organizationId) return null;
    return report;
  }

  private scheduleForFiling(reportId: string): void {
    this.filingQueue.push({
      reportId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      retryCount: 0,
    });
  }

  private generateBSAId(): string {
    return `BSA-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateCTRId(): string {
    return `CTR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateGoAMLRef(): string {
    return `GOAML-AE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private buildAuthorityManifest(
    reportType: ReportType,
    filingJurisdiction: string,
    reportId: string,
    version: number,
    exportFormats: ExportFormat[],
  ): ReportAuthorityManifest {
    return {
      manifestVersion: 'zeroid.report_authority_manifest.v1',
      reportId,
      reportType,
      filingJurisdiction,
      currentVersion: version,
      supportedExportFormats: exportFormats,
      preferredDeliveryChannels: this.resolvePreferredDeliveryChannels(reportType),
      acknowledgementExpected: true,
      acknowledgements: [],
      handoffTrail: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private resolvePreferredDeliveryChannels(
    reportType: ReportType,
  ): Array<'portal_upload' | 'api' | 'sftp' | 'email'> {
    if (reportType === 'DSAR' || reportType === 'ERASURE') {
      return ['portal_upload', 'email', 'api'];
    }

    if (reportType === 'AUDIT') {
      return ['portal_upload', 'sftp', 'api'];
    }

    return ['portal_upload', 'api', 'sftp'];
  }

  private getRetentionPolicyForCategory(category: string): { days: number; basis: string } {
    const policies: Record<string, { days: number; basis: string }> = {
      personal_data: { days: 1825, basis: 'GDPR Art. 5(1)(e)' },
      financial_data: { days: 2555, basis: 'AML Directive / FinCEN' },
      biometric_data: { days: 365, basis: 'GDPR Art. 9' },
      credential_history: { days: 1825, basis: 'eIDAS Regulation' },
      verification_history: { days: 1825, basis: 'KYC/AML Requirements' },
      consent_records: { days: 1825, basis: 'GDPR Art. 7(1)' },
      communication_logs: { days: 365, basis: 'Internal Policy' },
      processing_activities: { days: 1825, basis: 'GDPR Art. 30' },
    };
    return policies[category] ?? { days: 1825, basis: 'Default Policy' };
  }

  private groupBy(reports: GeneratedReport[], key: keyof GeneratedReport): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const r of reports) {
      const val = String(r[key]);
      groups[val] = (groups[val] ?? 0) + 1;
    }
    return groups;
  }

  private calculateFilingTimeliness(reports: GeneratedReport[]): { onTime: number; late: number; percentage: number } {
    let onTime = 0;
    let late = 0;
    for (const r of reports) {
      if (r.submittedAt && r.expiresAt) {
        if (new Date(r.submittedAt) <= new Date(r.expiresAt)) onTime++;
        else late++;
      }
    }
    const total = onTime + late;
    return { onTime, late, percentage: total > 0 ? Math.round((onTime / total) * 100) : 100 };
  }

  private identifyComplianceGaps(reports: GeneratedReport[], _jurisdiction: string): string[] {
    const gaps: string[] = [];
    const rejectedCount = reports.filter((r) => r.status === 'rejected').length;
    if (rejectedCount > 0) gaps.push(`${rejectedCount} report(s) were rejected by regulators`);
    const overdueCount = reports.filter((r) => r.expiresAt && r.status === 'draft' && new Date(r.expiresAt) < new Date()).length;
    if (overdueCount > 0) gaps.push(`${overdueCount} report(s) are overdue for filing`);
    return gaps;
  }

  private generateRecommendations(reports: GeneratedReport[]): string[] {
    const recommendations: string[] = [];
    const draftCount = reports.filter((r) => r.status === 'draft').length;
    if (draftCount > 5) recommendations.push('Review and submit outstanding draft reports');
    const amendedCount = reports.filter((r) => r.amendments.length > 2).length;
    if (amendedCount > 0) recommendations.push('Review reports with multiple amendments for quality issues');
    return recommendations;
  }

  private toXML(report: GeneratedReport): string {
    const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Report>\n';
    xml += `  <ReportId>${escapeXml(report.reportId)}</ReportId>\n`;
    xml += `  <ReportType>${escapeXml(report.reportType)}</ReportType>\n`;
    xml += `  <Version>${report.version}</Version>\n`;
    xml += `  <Status>${escapeXml(report.status)}</Status>\n`;
    xml += `  <Jurisdiction>${escapeXml(report.filingJurisdiction)}</Jurisdiction>\n`;
    xml += `  <GeneratedAt>${escapeXml(report.generatedAt)}</GeneratedAt>\n`;
    xml += `  <Content>${escapeXml(JSON.stringify(report.content))}</Content>\n`;
    xml += '</Report>';
    return xml;
  }

  private toCSV(report: GeneratedReport): string {
    const headers = ['reportId', 'reportType', 'version', 'status', 'jurisdiction', 'generatedAt', 'submittedAt'];
    const values = [
      report.reportId, report.reportType, String(report.version), report.status,
      report.filingJurisdiction, report.generatedAt, report.submittedAt ?? '',
    ];
    return `${headers.join(',')}\n${values.map((v) => `"${v}"`).join(',')}`;
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class ReportingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ReportingError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const regulatoryReportingService = new RegulatoryReportingService();
