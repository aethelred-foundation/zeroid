import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { jurisdictionEngine, ComplianceEvaluationRequestSchema, CrossBorderAssessmentSchema, JurisdictionCodeSchema, CrossBorderResult } from '../../services/compliance/jurisdiction-engine';
import { sanctionsScreeningService, ScreeningRequestSchema, BatchScreeningRequestSchema, FalsePositiveDecisionSchema } from '../../services/compliance/sanctions-screening';
import { regulatoryReportingService, ReportTypeSchema, ExportFormatSchema, GeneratedReport, ReportEvidenceEvent } from '../../services/compliance/regulatory-reporting';
import { dataSovereigntyService, CrossBorderTransferSchema, PIASchema, BreachNotificationSchema, ConsentRecordSchema, TransferAssessmentResult, PIAResult, BreachTimeline } from '../../services/compliance/data-sovereignty';
import { EnterpriseAuthenticatedRequest, requireEnterpriseContext } from '../../middleware/enterprise';
import { EnterpriseRole, OrganizationGovernanceSettings } from '../../services/enterprise/organization-service';
import { policyDecisionReceiptService, PolicyDecisionReceipt } from '../../services/enterprise/policy-receipt-service';
import { policyContextService, PolicyExecutionContext } from '../../services/enterprise/policy-context-service';
import { policyExecutionService, PolicyExecutionTrace } from '../../services/enterprise/policy-execution-service';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'compliance-routes' },
  transports: [new transports.Console()],
});

const router = Router();
const ENTERPRISE_COMPLIANCE_READ_ROLES: EnterpriseRole[] = ['viewer', 'operator', 'admin', 'compliance_officer', 'auditor'];
const ENTERPRISE_COMPLIANCE_WRITE_ROLES: EnterpriseRole[] = ['operator', 'admin', 'compliance_officer'];
const ENTERPRISE_COMPLIANCE_REVIEW_ROLES: EnterpriseRole[] = ['admin', 'compliance_officer', 'auditor'];
const ReportAmendmentRequestSchema = z.object({
  reason: z.string().min(5),
  changes: z.record(z.unknown()),
});
const ReportExportHandoffQuerySchema = z.object({
  destination: z.string().min(2).optional(),
  deliveryChannel: z.enum(['portal_upload', 'sftp', 'api', 'email']).optional(),
  acknowledgementId: z.string().min(2).optional(),
});

// ---------------------------------------------------------------------------
// Middleware: validate request body with Zod schema
// ---------------------------------------------------------------------------
function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: () => void) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function getEnterpriseReceiptContext(
  req: Request,
): {
  organizationId: string;
  actorIdentityId: string;
  governanceSettings?: OrganizationGovernanceSettings;
} | null {
  const enterpriseReq = req as EnterpriseAuthenticatedRequest;
  const organizationId = enterpriseReq.enterpriseContext?.organizationId;
  const actorIdentityId = enterpriseReq.identity?.id;
  if (!organizationId || !actorIdentityId) {
    return null;
  }
  return {
    organizationId,
    actorIdentityId,
    governanceSettings: enterpriseReq.enterpriseContext?.governanceSettings,
  };
}

function summarizeReceipt(receipt: PolicyDecisionReceipt): Record<string, unknown> {
  return {
    id: receipt.receiptId,
    receiptType: receipt.receiptType,
    policyName: receipt.policyName,
    policyVersion: receipt.policyVersion,
    policyDefinitionId: receipt.policyDefinitionId,
    policyReference: receipt.policyReference,
    policyExceptionCount: receipt.policyExceptionCount,
    decisionSummary: receipt.decisionSummary,
    integrityHash: receipt.integrityHash,
    createdAt: receipt.createdAt,
  };
}

function buildCredentialEvidenceUsage(
  jurisdictions: string[],
  operationType: string,
  credentials: Array<{ credentialId?: string; issuerId: string; credentialType: string }>,
): Array<{
  credentialId: string;
  issuerId: string;
  credentialType: string;
  operationType: string;
  rulePaths: Array<{
    jurisdiction: string;
    rulePath: string;
    status: 'satisfied' | 'supplemental';
  }>;
}> {
  return credentials
    .filter((credential) => typeof credential.credentialId === 'string' && credential.credentialId.length > 0)
    .map((credential) => ({
      credentialId: credential.credentialId!,
      issuerId: credential.issuerId,
      credentialType: credential.credentialType,
      operationType,
      rulePaths: jurisdictions.map((jurisdiction) => {
        const requiredCredentials = jurisdictionEngine.getRequiredCredentials(
          jurisdiction as z.infer<typeof JurisdictionCodeSchema>,
          operationType as z.infer<typeof ComplianceEvaluationRequestSchema>['operationType'],
        );
        return {
          jurisdiction,
          rulePath: `required_credential:${credential.credentialType}`,
          status: requiredCredentials.includes(credential.credentialType) ? 'satisfied' as const : 'supplemental' as const,
        };
      }),
    }));
}

type ObligationEvidenceUsageSnapshot = {
  domain: 'cross_border' | 'reporting' | 'privacy';
  obligationType: string;
  rulePath: string;
  status: 'satisfied' | 'escalated';
  detail?: string;
  sourceJurisdiction?: string;
  targetJurisdiction?: string;
  jurisdiction?: string;
  reportType?: string;
};

type ReportLifecycleSnapshot = {
  action: 'generated' | 'submitted' | 'amended' | 'exported';
  reportId: string;
  reportType: string;
  version: number;
  status: string;
  filingJurisdiction: string;
  authority?: string;
  filingReference?: string | null;
  deadlineField?: 'filingDeadline' | 'responseDeadline';
  deadline?: string;
  submittedAt?: string | null;
  amendmentCount?: number;
  amendmentReason?: string;
  amendedAt?: string;
  exportFormat?: string;
  exportFilename?: string;
  exportRequestedAt?: string;
  amendmentHistory?: Array<{
    version: number;
    amendedAt: string;
    reason: string;
  }>;
  deliveryChannel?: string;
  deliveryDestination?: string;
  deliveryAcknowledgementId?: string;
  deliveryAcknowledgedAt?: string;
};

type RegulatoryAuthorityProfileSnapshot = {
  authority: string;
  authorityClass:
    | 'financial_intelligence_unit'
    | 'market_regulator'
    | 'data_protection_authority'
    | 'audit_supervisor'
    | 'general_regulator';
  packageProfile: 'aml_filing' | 'privacy_rights' | 'audit_package' | 'general_reporting';
  jurisdiction: string;
  reportType: string;
  preferredDeliveryChannels: Array<'portal_upload' | 'api' | 'sftp' | 'email'>;
  acknowledgementExpected: boolean;
  supportsAmendments: boolean;
  supportsExports: boolean;
};

type ReportFilingDeadlineSnapshot = {
  field: 'filingDeadline' | 'responseDeadline';
  value: string;
  status: 'pending' | 'met' | 'overdue';
  evaluatedAt: string;
  remainingHours?: number;
  submittedOnTime?: boolean;
};

type ReportEvidenceEventSnapshot = {
  eventId?: string;
  action: 'generated' | 'submitted' | 'amended' | 'exported';
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
};

type ReportFilingPackageSnapshot = {
  packageVersion: 'zeroid.regulatory_filing_package.v1';
  reportId: string;
  reportType: string;
  version: number;
  status: string;
  filingJurisdiction: string;
  authorityProfile?: RegulatoryAuthorityProfileSnapshot;
  deadline?: ReportFilingDeadlineSnapshot;
  lifecycle: {
    generatedAt: string;
    submittedAt?: string | null;
    filingReference?: string | null;
    amendmentCount: number;
    latestAmendment?: {
      version: number;
      amendedAt: string;
      reason: string;
    };
    lastExportedAt?: string;
    lastExportFormat?: string;
    lastExportFilename?: string;
    lastDeliveryChannel?: string;
    lastDeliveryDestination?: string;
    lastDeliveryAcknowledgementId?: string;
    lastDeliveryAcknowledgedAt?: string;
  };
  evidenceTrail: ReportEvidenceEventSnapshot[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function pushUniqueObligation(
  obligations: ObligationEvidenceUsageSnapshot[],
  obligation: ObligationEvidenceUsageSnapshot,
): void {
  const key = [
    obligation.domain,
    obligation.obligationType,
    obligation.rulePath,
    obligation.status,
    obligation.sourceJurisdiction ?? '',
    obligation.targetJurisdiction ?? '',
    obligation.jurisdiction ?? '',
    obligation.reportType ?? '',
    obligation.detail ?? '',
  ].join('::');
  if (!obligations.some((entry) => [
    entry.domain,
    entry.obligationType,
    entry.rulePath,
    entry.status,
    entry.sourceJurisdiction ?? '',
    entry.targetJurisdiction ?? '',
    entry.jurisdiction ?? '',
    entry.reportType ?? '',
    entry.detail ?? '',
  ].join('::') === key)) {
    obligations.push(obligation);
  }
}

function isTransferAssessmentResult(
  result: CrossBorderResult | TransferAssessmentResult,
): result is TransferAssessmentResult {
  return 'requiredSafeguards' in result && 'conditions' in result && 'regulatoryNotifications' in result;
}

function isJurisdictionCrossBorderResult(
  result: CrossBorderResult | TransferAssessmentResult,
): result is CrossBorderResult {
  return 'acceptedCredentials' in result && 'additionalRequired' in result && 'restrictions' in result;
}

function buildCrossBorderObligationUsage(
  sourceJurisdiction: string,
  targetJurisdiction: string,
  baseResult: CrossBorderResult | TransferAssessmentResult,
  adjustedResult: (CrossBorderResult | TransferAssessmentResult) & { policyDecision?: string },
  trace?: PolicyExecutionTrace,
): ObligationEvidenceUsageSnapshot[] {
  const obligations: ObligationEvidenceUsageSnapshot[] = [];

  if (isTransferAssessmentResult(adjustedResult) && isTransferAssessmentResult(baseResult)) {
    if (typeof adjustedResult.legalBasis === 'string' && adjustedResult.legalBasis.length > 0) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'legal_basis',
        rulePath: `legal_basis:${adjustedResult.legalBasis}`,
        status: 'satisfied',
        detail: adjustedResult.legalBasis,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }

    const baseSafeguards = new Set(baseResult.requiredSafeguards);
    for (const safeguard of adjustedResult.requiredSafeguards) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'required_safeguard',
        rulePath: `required_safeguard:${safeguard}`,
        status: baseSafeguards.has(safeguard) ? 'satisfied' : 'escalated',
        detail: safeguard,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }

    const baseConditions = new Set(baseResult.conditions);
    for (const condition of adjustedResult.conditions) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'transfer_condition',
        rulePath: `transfer_condition:${condition}`,
        status: baseConditions.has(condition) ? 'satisfied' : 'escalated',
        detail: condition,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }

    const baseNotifications = new Set(baseResult.regulatoryNotifications);
    for (const notification of adjustedResult.regulatoryNotifications) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'regulatory_notification',
        rulePath: `regulatory_notification:${notification}`,
        status: baseNotifications.has(notification) ? 'satisfied' : 'escalated',
        detail: notification,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }
  }

  if (isJurisdictionCrossBorderResult(adjustedResult) && isJurisdictionCrossBorderResult(baseResult)) {
    pushUniqueObligation(obligations, {
      domain: 'cross_border',
      obligationType: 'transfer_mechanism',
      rulePath: `transfer_mechanism:${adjustedResult.dataTransferMechanism}`,
      status: 'satisfied',
      detail: adjustedResult.dataTransferMechanism,
      sourceJurisdiction,
      targetJurisdiction,
    });

    const baseRestrictions = new Set(baseResult.restrictions);
    for (const restriction of adjustedResult.restrictions) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'restriction',
        rulePath: `restriction:${restriction}`,
        status: baseRestrictions.has(restriction) ? 'satisfied' : 'escalated',
        detail: restriction,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }

    const baseAdditionalRequired = new Set(baseResult.additionalRequired);
    for (const credentialType of adjustedResult.additionalRequired) {
      pushUniqueObligation(obligations, {
        domain: 'cross_border',
        obligationType: 'required_credential',
        rulePath: `required_credential:${credentialType}`,
        status: baseAdditionalRequired.has(credentialType) ? 'satisfied' : 'escalated',
        detail: credentialType,
        sourceJurisdiction,
        targetJurisdiction,
      });
    }
  }

  const crossBorderChanges = trace?.crossBorderAdjustments
    ?.filter((adjustment) => adjustment.source === sourceJurisdiction && adjustment.target === targetJurisdiction)
    .flatMap((adjustment) => adjustment.changes)
    ?? [];

  for (const change of crossBorderChanges) {
    const [prefix, rawValue] = change.split(':', 2);
    if (!rawValue) {
      continue;
    }

    switch (prefix) {
      case 'prohibited_pair':
        pushUniqueObligation(obligations, {
          domain: 'cross_border',
          obligationType: 'jurisdiction_pair',
          rulePath: `jurisdiction_pair:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          sourceJurisdiction,
          targetJurisdiction,
        });
        break;
      case 'disallowed_categories':
        for (const category of rawValue.split('|').filter((value) => value.length > 0)) {
          pushUniqueObligation(obligations, {
            domain: 'cross_border',
            obligationType: 'data_category_restriction',
            rulePath: `data_category_restriction:${category}`,
            status: 'escalated',
            detail: category,
            sourceJurisdiction,
            targetJurisdiction,
          });
        }
        break;
      case 'legal_basis':
        pushUniqueObligation(obligations, {
          domain: 'cross_border',
          obligationType: 'legal_basis',
          rulePath: `legal_basis:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          sourceJurisdiction,
          targetJurisdiction,
        });
        break;
      case 'blocked_mechanism':
        pushUniqueObligation(obligations, {
          domain: 'cross_border',
          obligationType: 'transfer_mechanism',
          rulePath: `transfer_mechanism:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          sourceJurisdiction,
          targetJurisdiction,
        });
        break;
      case 'risk_review':
        pushUniqueObligation(obligations, {
          domain: 'cross_border',
          obligationType: 'risk_review',
          rulePath: `risk_review:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          sourceJurisdiction,
          targetJurisdiction,
        });
        break;
      case 'required_safeguards':
        for (const safeguard of rawValue.split('|').filter((value) => value.length > 0)) {
          pushUniqueObligation(obligations, {
            domain: 'cross_border',
            obligationType: 'required_safeguard',
            rulePath: `required_safeguard:${safeguard}`,
            status: 'escalated',
            detail: safeguard,
            sourceJurisdiction,
            targetJurisdiction,
          });
        }
        break;
    }
  }

  if (typeof adjustedResult.policyDecision === 'string' && adjustedResult.policyDecision !== 'allow') {
    pushUniqueObligation(obligations, {
      domain: 'cross_border',
      obligationType: 'policy_decision',
      rulePath: `policy_decision:${adjustedResult.policyDecision}`,
      status: 'escalated',
      detail: adjustedResult.policyDecision,
      sourceJurisdiction,
      targetJurisdiction,
    });
  }

  return obligations;
}

function extractReportDeadline(report: GeneratedReport): { field: 'filingDeadline' | 'responseDeadline'; value: string } | undefined {
  const content = asRecord(report.content);
  if (typeof content.filingDeadline === 'string' && content.filingDeadline.length > 0) {
    return {
      field: 'filingDeadline',
      value: content.filingDeadline,
    };
  }
  if (typeof content.responseDeadline === 'string' && content.responseDeadline.length > 0) {
    return {
      field: 'responseDeadline',
      value: content.responseDeadline,
    };
  }
  return undefined;
}

function buildReportingObligationUsage(
  baseReport: GeneratedReport,
  adjustedReport: GeneratedReport & { policyDecision?: string },
  trace?: PolicyExecutionTrace,
): ObligationEvidenceUsageSnapshot[] {
  const obligations: ObligationEvidenceUsageSnapshot[] = [];
  const reportType = String(adjustedReport.reportType ?? baseReport.reportType ?? 'UNKNOWN');
  const jurisdiction = String(adjustedReport.filingJurisdiction ?? baseReport.filingJurisdiction ?? '');
  const authority = resolveRegulatoryAuthority(reportType, jurisdiction);

  if (jurisdiction.length > 0) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'filing_jurisdiction',
      rulePath: `filing_jurisdiction:${jurisdiction}`,
      status: 'satisfied',
      detail: jurisdiction,
      jurisdiction,
      reportType,
    });
  }

  if (authority) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'regulatory_authority',
      rulePath: `regulatory_authority:${authority}`,
      status: 'satisfied',
      detail: authority,
      jurisdiction,
      reportType,
    });
  }

  const deadline = extractReportDeadline(adjustedReport) ?? extractReportDeadline(baseReport);
  if (deadline) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'deadline',
      rulePath: `deadline:${deadline.field}`,
      status: 'satisfied',
      detail: deadline.value,
      jurisdiction,
      reportType,
    });
  }

  const reportingChanges = trace?.reportingAdjustments
    ?.filter((adjustment) => adjustment.reportType === reportType)
    .flatMap((adjustment) => adjustment.changes)
    ?? [];

  for (const change of reportingChanges) {
    const [prefix, rawValue] = change.split(':', 2);
    if (!rawValue) {
      continue;
    }

    switch (prefix) {
      case 'pending_review':
        pushUniqueObligation(obligations, {
          domain: 'reporting',
          obligationType: 'review_gate',
          rulePath: `review_gate:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          jurisdiction,
          reportType,
        });
        break;
      case 'missing_fields':
        for (const field of rawValue.split('|').filter((value) => value.length > 0)) {
          pushUniqueObligation(obligations, {
            domain: 'reporting',
            obligationType: 'required_field',
            rulePath: `required_field:${field}`,
            status: 'escalated',
            detail: field,
            jurisdiction,
            reportType,
          });
        }
        break;
      case 'priority_review':
        pushUniqueObligation(obligations, {
          domain: 'reporting',
          obligationType: 'priority_review',
          rulePath: `priority_review:${rawValue}`,
          status: 'escalated',
          detail: rawValue,
          jurisdiction,
          reportType,
        });
        break;
    }
  }

  if (typeof adjustedReport.policyDecision === 'string' && adjustedReport.policyDecision !== 'allow') {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'policy_decision',
      rulePath: `policy_decision:${adjustedReport.policyDecision}`,
      status: 'escalated',
      detail: adjustedReport.policyDecision,
      jurisdiction,
      reportType,
    });
  }

  if (adjustedReport.status !== baseReport.status) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'status_transition',
      rulePath: `status_transition:${baseReport.status}->${adjustedReport.status}`,
      status: 'escalated',
      detail: `${baseReport.status}->${adjustedReport.status}`,
      jurisdiction,
      reportType,
    });
  }

  return obligations;
}

function resolveRegulatoryAuthority(reportType: string, jurisdiction: string): string | null {
  if (reportType === 'STR' && jurisdiction.startsWith('AE-')) {
    return 'UAE FIU';
  }

  const authorities: Record<string, string> = {
    'AE-CBUAE': 'Central Bank of UAE',
    'AE-SCA': 'Securities & Commodities Authority',
    'AE-ADGM': 'FSRA',
    'AE-DIFC': 'DFSA',
    'EU-EIDAS': 'EU Supervisory Authority',
    'EU-GDPR': 'Data Protection Authority',
    'EU-MICA': 'EBA/ESMA',
    'US-FINCEN': 'FinCEN',
    'US-SEC': 'SEC',
    'US-NY': 'NYDFS',
    'US-CA': 'CPPA',
    'US-TX': 'Texas Department of Banking',
    'US-FL': 'OFR',
    'SG-MAS': 'MAS',
    'UK-FCA': 'FCA',
    'BH-CBB': 'CBB',
    'SA-SAMA': 'SAMA',
    all: 'Multi-jurisdiction Audit Authority',
  };

  return authorities[jurisdiction] ?? null;
}

function buildRegulatoryAuthorityProfile(
  reportType: string,
  jurisdiction: string,
): RegulatoryAuthorityProfileSnapshot | undefined {
  const authority = resolveRegulatoryAuthority(reportType, jurisdiction);
  if (!authority) {
    return undefined;
  }

  if (reportType === 'SAR' || reportType === 'CTR' || reportType === 'STR') {
    return {
      authority,
      authorityClass: reportType === 'STR' ? 'financial_intelligence_unit' : 'market_regulator',
      packageProfile: 'aml_filing',
      jurisdiction,
      reportType,
      preferredDeliveryChannels: ['portal_upload', 'api', 'sftp'],
      acknowledgementExpected: true,
      supportsAmendments: true,
      supportsExports: true,
    };
  }

  if (reportType === 'DSAR' || reportType === 'ERASURE') {
    return {
      authority,
      authorityClass: 'data_protection_authority',
      packageProfile: 'privacy_rights',
      jurisdiction,
      reportType,
      preferredDeliveryChannels: ['portal_upload', 'email', 'api'],
      acknowledgementExpected: true,
      supportsAmendments: true,
      supportsExports: true,
    };
  }

  if (reportType === 'AUDIT') {
    return {
      authority,
      authorityClass: 'audit_supervisor',
      packageProfile: 'audit_package',
      jurisdiction,
      reportType,
      preferredDeliveryChannels: ['portal_upload', 'sftp', 'api'],
      acknowledgementExpected: true,
      supportsAmendments: true,
      supportsExports: true,
    };
  }

  return {
    authority,
    authorityClass: 'general_regulator',
    packageProfile: 'general_reporting',
    jurisdiction,
    reportType,
    preferredDeliveryChannels: ['portal_upload', 'api', 'email'],
    acknowledgementExpected: true,
    supportsAmendments: true,
    supportsExports: true,
  };
}

function normalizeReportEvidenceEvent(
  event: ReportEvidenceEvent | ReportEvidenceEventSnapshot,
): ReportEvidenceEventSnapshot {
  return {
    ...(typeof event.eventId === 'string' && event.eventId.length > 0 ? { eventId: event.eventId } : {}),
    action: event.action,
    recordedAt: event.recordedAt,
    ...(typeof event.receiptId === 'string' && event.receiptId.length > 0 ? { receiptId: event.receiptId } : {}),
    ...(typeof event.actorIdentityId === 'string' && event.actorIdentityId.length > 0
      ? { actorIdentityId: event.actorIdentityId }
      : {}),
    policyName: event.policyName,
    ...(typeof event.policyVersion === 'string' && event.policyVersion.length > 0 ? { policyVersion: event.policyVersion } : {}),
    ...(typeof event.decisionSummary === 'string' && event.decisionSummary.length > 0
      ? { decisionSummary: event.decisionSummary }
      : {}),
    ...(typeof event.authority === 'string' && event.authority.length > 0 ? { authority: event.authority } : {}),
    ...(event.filingReference === null || (typeof event.filingReference === 'string' && event.filingReference.length > 0)
      ? { filingReference: event.filingReference as string | null }
      : {}),
    version: event.version,
    ...(typeof event.amendmentReason === 'string' && event.amendmentReason.length > 0
      ? { amendmentReason: event.amendmentReason }
      : {}),
    ...(typeof event.exportFormat === 'string' && event.exportFormat.length > 0 ? { exportFormat: event.exportFormat } : {}),
    ...(typeof event.exportFilename === 'string' && event.exportFilename.length > 0
      ? { exportFilename: event.exportFilename }
      : {}),
    ...(typeof event.deliveryChannel === 'string' && event.deliveryChannel.length > 0
      ? { deliveryChannel: event.deliveryChannel }
      : {}),
    ...(typeof event.deliveryDestination === 'string' && event.deliveryDestination.length > 0
      ? { deliveryDestination: event.deliveryDestination }
      : {}),
    ...(typeof event.deliveryAcknowledgementId === 'string' && event.deliveryAcknowledgementId.length > 0
      ? { deliveryAcknowledgementId: event.deliveryAcknowledgementId }
      : {}),
    ...(typeof event.deliveryAcknowledgedAt === 'string' && event.deliveryAcknowledgedAt.length > 0
      ? { deliveryAcknowledgedAt: event.deliveryAcknowledgedAt }
      : {}),
  };
}

function buildReportFilingDeadline(
  report: GeneratedReport,
  evaluatedAt: string,
): ReportFilingDeadlineSnapshot | undefined {
  const deadline = extractReportDeadline(report);
  if (!deadline) {
    return undefined;
  }

  const deadlineTime = new Date(deadline.value).getTime();
  const evaluatedTime = new Date(evaluatedAt).getTime();
  const submittedTime = report.submittedAt ? new Date(report.submittedAt).getTime() : null;

  if (submittedTime !== null) {
    return {
      field: deadline.field,
      value: deadline.value,
      status: submittedTime <= deadlineTime ? 'met' : 'overdue',
      evaluatedAt,
      submittedOnTime: submittedTime <= deadlineTime,
    };
  }

  return {
    field: deadline.field,
    value: deadline.value,
    status: evaluatedTime <= deadlineTime ? 'pending' : 'overdue',
    evaluatedAt,
    remainingHours: Math.ceil((deadlineTime - evaluatedTime) / (1000 * 60 * 60)),
  };
}

function buildReportFilingPackage(
  report: GeneratedReport,
  evidenceTrail: Array<ReportEvidenceEvent | ReportEvidenceEventSnapshot>,
  evaluatedAt: string,
): ReportFilingPackageSnapshot {
  const authorityProfile = buildRegulatoryAuthorityProfile(report.reportType, report.filingJurisdiction);
  const deadline = buildReportFilingDeadline(report, evaluatedAt);
  const normalizedTrail = evidenceTrail
    .map((event) => normalizeReportEvidenceEvent(event))
    .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
  const latestExport = [...normalizedTrail].reverse().find((event) => event.action === 'exported');
  const latestAmendment = report.amendments[report.amendments.length - 1];

  return {
    packageVersion: 'zeroid.regulatory_filing_package.v1',
    reportId: report.reportId,
    reportType: report.reportType,
    version: report.version,
    status: report.status,
    filingJurisdiction: report.filingJurisdiction,
    ...(authorityProfile ? { authorityProfile } : {}),
    ...(deadline ? { deadline } : {}),
    lifecycle: {
      generatedAt: report.generatedAt,
      ...(report.submittedAt !== undefined ? { submittedAt: report.submittedAt } : {}),
      ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
      amendmentCount: report.amendments.length,
      ...(latestAmendment
        ? {
          latestAmendment: {
            version: latestAmendment.version,
            amendedAt: latestAmendment.amendedAt,
            reason: latestAmendment.reason,
          },
        }
        : {}),
      ...(latestExport?.recordedAt ? { lastExportedAt: latestExport.recordedAt } : {}),
      ...(latestExport?.exportFormat ? { lastExportFormat: latestExport.exportFormat } : {}),
      ...(latestExport?.exportFilename ? { lastExportFilename: latestExport.exportFilename } : {}),
      ...(latestExport?.deliveryChannel ? { lastDeliveryChannel: latestExport.deliveryChannel } : {}),
      ...(latestExport?.deliveryDestination ? { lastDeliveryDestination: latestExport.deliveryDestination } : {}),
      ...(latestExport?.deliveryAcknowledgementId
        ? { lastDeliveryAcknowledgementId: latestExport.deliveryAcknowledgementId }
        : {}),
      ...(latestExport?.deliveryAcknowledgedAt
        ? { lastDeliveryAcknowledgedAt: latestExport.deliveryAcknowledgedAt }
        : {}),
    },
    evidenceTrail: normalizedTrail,
  };
}

async function recordReportEvidenceEvent(
  report: GeneratedReport,
  event: Omit<ReportEvidenceEvent, 'eventId' | 'recordedAt'>,
): Promise<void> {
  regulatoryReportingService.recordEvidenceEvent(report.reportId, event);
}

function buildReportSubmissionObligationUsage(
  report: GeneratedReport,
  submission: { filingReference: string; submittedAt: string },
): ObligationEvidenceUsageSnapshot[] {
  const obligations = buildReportingObligationUsage(report, report);
  const authority = resolveRegulatoryAuthority(report.reportType, report.filingJurisdiction);
  const deadline = extractReportDeadline(report);

  if (authority) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'submission_authority',
      rulePath: `submission_authority:${authority}`,
      status: 'satisfied',
      detail: authority,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'filing_reference',
    rulePath: `filing_reference:${submission.filingReference}`,
    status: 'satisfied',
    detail: submission.filingReference,
    jurisdiction: report.filingJurisdiction,
    reportType: report.reportType,
  });

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'submission_timestamp',
    rulePath: 'submission_timestamp',
    status: 'satisfied',
    detail: submission.submittedAt,
    jurisdiction: report.filingJurisdiction,
    reportType: report.reportType,
  });

  if (deadline) {
    const submittedOnTime = new Date(submission.submittedAt).getTime() <= new Date(deadline.value).getTime();
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'submission_sla',
      rulePath: `submission_sla:${deadline.field}`,
      status: submittedOnTime ? 'satisfied' : 'escalated',
      detail: `${submission.submittedAt}|${deadline.value}`,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  return obligations;
}

function buildReportLifecycleSnapshot(
  action: ReportLifecycleSnapshot['action'],
  report: GeneratedReport,
  extras: Partial<Omit<ReportLifecycleSnapshot, 'action' | 'reportId' | 'reportType' | 'version' | 'status' | 'filingJurisdiction'>> = {},
): ReportLifecycleSnapshot {
  const authority = resolveRegulatoryAuthority(report.reportType, report.filingJurisdiction);
  const deadline = extractReportDeadline(report);

  return {
    action,
    reportId: report.reportId,
    reportType: report.reportType,
    version: report.version,
    status: report.status,
    filingJurisdiction: report.filingJurisdiction,
    ...(authority ? { authority } : {}),
    ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
    ...(deadline ? { deadlineField: deadline.field, deadline: deadline.value } : {}),
    ...(report.submittedAt !== undefined ? { submittedAt: report.submittedAt } : {}),
    ...(report.amendments ? { amendmentCount: report.amendments.length } : {}),
    ...(Array.isArray(report.amendments) && report.amendments.length > 0
      ? {
        amendmentHistory: report.amendments.map((amendment) => ({
          version: amendment.version,
          amendedAt: amendment.amendedAt,
          reason: amendment.reason,
        })),
      }
      : {}),
    ...extras,
  };
}

function buildReportAmendmentObligationUsage(
  amendedReport: GeneratedReport,
  amendment: { reason: string; changes: Record<string, unknown> },
): ObligationEvidenceUsageSnapshot[] {
  const obligations = buildReportingObligationUsage(amendedReport, amendedReport);
  const authority = resolveRegulatoryAuthority(amendedReport.reportType, amendedReport.filingJurisdiction);
  const latestAmendment = amendedReport.amendments[amendedReport.amendments.length - 1];

  if (authority) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'amendment_authority',
      rulePath: `amendment_authority:${authority}`,
      status: 'satisfied',
      detail: authority,
      jurisdiction: amendedReport.filingJurisdiction,
      reportType: amendedReport.reportType,
    });
  }

  if (amendedReport.filingReference) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'filing_reference',
      rulePath: `filing_reference:${amendedReport.filingReference}`,
      status: 'satisfied',
      detail: amendedReport.filingReference,
      jurisdiction: amendedReport.filingJurisdiction,
      reportType: amendedReport.reportType,
    });
  }

  if (latestAmendment) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'amendment_version',
      rulePath: `amendment_version:${latestAmendment.version}`,
      status: 'satisfied',
      detail: String(latestAmendment.version),
      jurisdiction: amendedReport.filingJurisdiction,
      reportType: amendedReport.reportType,
    });
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'amendment_timestamp',
      rulePath: 'amendment_timestamp',
      status: 'satisfied',
      detail: latestAmendment.amendedAt,
      jurisdiction: amendedReport.filingJurisdiction,
      reportType: amendedReport.reportType,
    });
  }

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'amendment_reason',
    rulePath: `amendment_reason:${amendment.reason}`,
    status: 'satisfied',
    detail: amendment.reason,
    jurisdiction: amendedReport.filingJurisdiction,
    reportType: amendedReport.reportType,
  });

  for (const field of Object.keys(amendment.changes)) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'amended_field',
      rulePath: `amended_field:${field}`,
      status: 'satisfied',
      detail: field,
      jurisdiction: amendedReport.filingJurisdiction,
      reportType: amendedReport.reportType,
    });
  }

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'status_transition',
    rulePath: `status_transition:${amendedReport.status}`,
    status: 'satisfied',
    detail: amendedReport.status,
    jurisdiction: amendedReport.filingJurisdiction,
    reportType: amendedReport.reportType,
  });

  return obligations;
}

function buildReportExportObligationUsage(
  report: GeneratedReport,
  format: string,
  filename: string,
  exportedAt: string,
  handoff?: {
    destination?: string;
    deliveryChannel?: string;
    acknowledgementId?: string;
    acknowledgedAt?: string;
  },
): ObligationEvidenceUsageSnapshot[] {
  const obligations = buildReportingObligationUsage(report, report);
  const authority = resolveRegulatoryAuthority(report.reportType, report.filingJurisdiction);

  if (authority) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'export_authority',
      rulePath: `export_authority:${authority}`,
      status: 'satisfied',
      detail: authority,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'export_format',
    rulePath: `export_format:${format}`,
    status: 'satisfied',
    detail: format,
    jurisdiction: report.filingJurisdiction,
    reportType: report.reportType,
  });

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'export_filename',
    rulePath: `export_filename:${filename}`,
    status: 'satisfied',
    detail: filename,
    jurisdiction: report.filingJurisdiction,
    reportType: report.reportType,
  });

  pushUniqueObligation(obligations, {
    domain: 'reporting',
    obligationType: 'export_timestamp',
    rulePath: 'export_timestamp',
    status: 'satisfied',
    detail: exportedAt,
    jurisdiction: report.filingJurisdiction,
    reportType: report.reportType,
  });

  if (report.filingReference) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'filing_reference',
      rulePath: `filing_reference:${report.filingReference}`,
      status: 'satisfied',
      detail: report.filingReference,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  if (handoff?.deliveryChannel) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'delivery_channel',
      rulePath: `delivery_channel:${handoff.deliveryChannel}`,
      status: 'satisfied',
      detail: handoff.deliveryChannel,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  if (handoff?.destination) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'delivery_destination',
      rulePath: `delivery_destination:${handoff.destination}`,
      status: 'satisfied',
      detail: handoff.destination,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  if (handoff?.acknowledgementId) {
    pushUniqueObligation(obligations, {
      domain: 'reporting',
      obligationType: 'delivery_acknowledgement',
      rulePath: `delivery_acknowledgement:${handoff.acknowledgementId}`,
      status: 'satisfied',
      detail: handoff.acknowledgementId,
      jurisdiction: report.filingJurisdiction,
      reportType: report.reportType,
    });
  }

  return obligations;
}

function isPiaResult(value: unknown): value is PIAResult {
  return Boolean(value) && typeof value === 'object' && 'riskScore' in (value as Record<string, unknown>);
}

function isBreachTimeline(value: unknown): value is BreachTimeline {
  return Boolean(value) && typeof value === 'object' && 'regulatoryDeadlines' in (value as Record<string, unknown>);
}

function buildPrivacyObligationUsage(
  operation: 'dsar' | 'erasure' | 'pia' | 'breach',
  jurisdictionCodes: string[],
  baseResult: GeneratedReport | PIAResult | BreachTimeline,
  adjustedResult: (GeneratedReport | PIAResult | BreachTimeline) & { policyDecision?: string },
  trace?: PolicyExecutionTrace,
): ObligationEvidenceUsageSnapshot[] {
  const obligations: ObligationEvidenceUsageSnapshot[] = [];
  const primaryJurisdiction = jurisdictionCodes[0];

  if ((operation === 'dsar' || operation === 'erasure') && !isPiaResult(adjustedResult) && !isBreachTimeline(adjustedResult)) {
    const baseReport = baseResult as GeneratedReport;
    const report = adjustedResult as GeneratedReport & { policyDecision?: string };

    if (primaryJurisdiction) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'request_jurisdiction',
        rulePath: `request_jurisdiction:${primaryJurisdiction}`,
        status: 'satisfied',
        detail: primaryJurisdiction,
        jurisdiction: primaryJurisdiction,
        reportType: report.reportType,
      });
    }

    const deadline = extractReportDeadline(report) ?? extractReportDeadline(baseReport);
    if (deadline) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'response_deadline',
        rulePath: `response_deadline:${deadline.field}`,
        status: 'satisfied',
        detail: deadline.value,
        jurisdiction: primaryJurisdiction,
        reportType: report.reportType,
      });
    }

    const privacyChanges = trace?.privacyAdjustments
      ?.filter((adjustment) => adjustment.operation === operation)
      .flatMap((adjustment) => adjustment.changes)
      ?? [];

    for (const change of privacyChanges) {
      const [prefix, rawValue] = change.split(':', 2);
      if (!rawValue) {
        continue;
      }

      switch (prefix) {
        case 'request_type_review':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'request_review',
            rulePath: `request_review:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: primaryJurisdiction,
            reportType: report.reportType,
          });
          break;
        case 'missing_categories':
          for (const category of rawValue.split('|').filter((value) => value.length > 0)) {
            pushUniqueObligation(obligations, {
              domain: 'privacy',
              obligationType: 'required_data_category',
              rulePath: `required_data_category:${category}`,
              status: 'escalated',
              detail: category,
              jurisdiction: primaryJurisdiction,
              reportType: report.reportType,
            });
          }
          break;
        case 'missing_retention_overrides':
          for (const category of rawValue.split('|').filter((value) => value.length > 0)) {
            pushUniqueObligation(obligations, {
              domain: 'privacy',
              obligationType: 'retention_override',
              rulePath: `retention_override:${category}`,
              status: 'escalated',
              detail: category,
              jurisdiction: primaryJurisdiction,
              reportType: report.reportType,
            });
          }
          break;
      }
    }

    if (typeof report.policyDecision === 'string' && report.policyDecision !== 'allow') {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'policy_decision',
        rulePath: `policy_decision:${report.policyDecision}`,
        status: 'escalated',
        detail: report.policyDecision,
        jurisdiction: primaryJurisdiction,
        reportType: report.reportType,
      });
    }

    if (report.status !== baseReport.status) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'status_transition',
        rulePath: `status_transition:${baseReport.status}->${report.status}`,
        status: 'escalated',
        detail: `${baseReport.status}->${report.status}`,
        jurisdiction: primaryJurisdiction,
        reportType: report.reportType,
      });
    }

    return obligations;
  }

  if (operation === 'pia' && isPiaResult(baseResult) && isPiaResult(adjustedResult)) {
    if (adjustedResult.dpiaRequired) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'dpia_required',
        rulePath: 'dpia_required:true',
        status: 'satisfied',
        detail: 'true',
        jurisdiction: primaryJurisdiction,
      });
    }

    if (adjustedResult.dpaRequired) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'processor_dpa',
        rulePath: 'processor_dpa:true',
        status: baseResult.dpaRequired ? 'satisfied' : 'escalated',
        detail: 'true',
        jurisdiction: primaryJurisdiction,
      });
    }

    if (adjustedResult.supervisoryConsultationRequired) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'supervisory_consultation',
        rulePath: `supervisory_consultation:${adjustedResult.riskLevel}`,
        status: baseResult.supervisoryConsultationRequired ? 'satisfied' : 'escalated',
        detail: adjustedResult.riskLevel,
        jurisdiction: primaryJurisdiction,
      });
    }

    const privacyChanges = trace?.privacyAdjustments
      ?.filter((adjustment) => adjustment.operation === 'pia')
      .flatMap((adjustment) => adjustment.changes)
      ?? [];

    for (const change of privacyChanges) {
      const [prefix, rawValue] = change.split(':', 2);
      if (!rawValue) {
        continue;
      }

      switch (prefix) {
        case 'supervisory_consultation':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'supervisory_consultation',
            rulePath: `supervisory_consultation:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: primaryJurisdiction,
          });
          break;
        case 'missing_dpa':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'processor_dpa',
            rulePath: `processor_dpa:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: primaryJurisdiction,
          });
          break;
        case 'cross_border_pia':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'cross_border_review',
            rulePath: `cross_border_review:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: primaryJurisdiction,
          });
          break;
      }
    }

    if (typeof adjustedResult.policyDecision === 'string' && adjustedResult.policyDecision !== 'allow') {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'policy_decision',
        rulePath: `policy_decision:${adjustedResult.policyDecision}`,
        status: 'escalated',
        detail: adjustedResult.policyDecision,
        jurisdiction: primaryJurisdiction,
      });
    }

    return obligations;
  }

  if (operation === 'breach' && isBreachTimeline(baseResult) && isBreachTimeline(adjustedResult)) {
    const baseDeadlines = new Map(baseResult.regulatoryDeadlines.map((deadline) => [deadline.jurisdiction, deadline]));
    for (const deadline of adjustedResult.regulatoryDeadlines) {
      const baseDeadline = baseDeadlines.get(deadline.jurisdiction);
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'regulatory_deadline',
        rulePath: `regulatory_deadline:${deadline.jurisdiction}`,
        status: baseDeadline && baseDeadline.deadlineHours === deadline.deadlineHours ? 'satisfied' : 'escalated',
        detail: deadline.deadline,
        jurisdiction: deadline.jurisdiction,
      });
    }

    if (adjustedResult.dataSubjectNotificationRequired) {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'subject_notification',
        rulePath: `subject_notification:${adjustedResult.dataSubjectDeadlineHours}`,
        status: baseResult.dataSubjectNotificationRequired ? 'satisfied' : 'escalated',
        detail: String(adjustedResult.dataSubjectDeadlineHours),
        jurisdiction: primaryJurisdiction,
      });
    }

    const privacyChanges = trace?.privacyAdjustments
      ?.filter((adjustment) => adjustment.operation === 'breach')
      .flatMap((adjustment) => adjustment.changes)
      ?? [];

    for (const change of privacyChanges) {
      const [prefix, rawValue] = change.split(':', 2);
      if (!rawValue) {
        continue;
      }

      switch (prefix) {
        case 'subject_notification':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'subject_notification',
            rulePath: `subject_notification:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: primaryJurisdiction,
          });
          break;
        case 'accelerated_deadline':
          pushUniqueObligation(obligations, {
            domain: 'privacy',
            obligationType: 'regulatory_deadline',
            rulePath: `regulatory_deadline:${rawValue}`,
            status: 'escalated',
            detail: rawValue,
            jurisdiction: rawValue,
          });
          break;
      }
    }

    if (typeof adjustedResult.policyDecision === 'string' && adjustedResult.policyDecision !== 'allow') {
      pushUniqueObligation(obligations, {
        domain: 'privacy',
        obligationType: 'policy_decision',
        rulePath: `policy_decision:${adjustedResult.policyDecision}`,
        status: 'escalated',
        detail: adjustedResult.policyDecision,
        jurisdiction: primaryJurisdiction,
      });
    }
  }

  return obligations;
}

function parseReportExportHandoff(
  query: Record<string, unknown>,
): {
  destination?: string;
  deliveryChannel?: 'portal_upload' | 'sftp' | 'api' | 'email';
  acknowledgementId?: string;
  acknowledgedAt?: string;
} | null {
  const parsed = ReportExportHandoffQuerySchema.safeParse({
    destination: typeof query.destination === 'string' ? query.destination : undefined,
    deliveryChannel: typeof query.deliveryChannel === 'string' ? query.deliveryChannel : undefined,
    acknowledgementId: typeof query.acknowledgementId === 'string' ? query.acknowledgementId : undefined,
  });

  if (!parsed.success) {
    return null;
  }

  if (
    parsed.data.destination === undefined
    && parsed.data.deliveryChannel === undefined
    && parsed.data.acknowledgementId === undefined
  ) {
    return {};
  }

  return {
    ...(parsed.data.destination ? { destination: parsed.data.destination } : {}),
    ...(parsed.data.deliveryChannel ? { deliveryChannel: parsed.data.deliveryChannel } : {}),
    ...(parsed.data.acknowledgementId
      ? {
        acknowledgementId: parsed.data.acknowledgementId,
        acknowledgedAt: new Date().toISOString(),
      }
      : {}),
  };
}

async function requireReceiptContext(req: Request, res: Response): Promise<{ organizationId: string; actorIdentityId: string } | null> {
  const context = getEnterpriseReceiptContext(req);
  if (!context) {
    res.status(401).json({ error: 'Authenticated enterprise context required', code: 'ENTERPRISE_AUTH_REQUIRED' });
    return null;
  }
  return context;
}

async function createPolicyAnchoredReceipt(
  context: {
    organizationId: string;
    actorIdentityId: string;
    governanceSettings?: OrganizationGovernanceSettings;
  },
  input: {
    receiptType: PolicyDecisionReceipt['receiptType'];
    policyName: string;
    jurisdictionCodes?: string[];
    subjectEntityId?: string;
    decisionSummary: string;
    payload: unknown;
    result: unknown;
    evidence?: unknown;
    metadata?: Record<string, unknown>;
    credentials?: Array<{ credentialId?: string; issuerId: string; credentialType: string }>;
    policyContextOverride?: PolicyExecutionContext;
  },
): Promise<PolicyDecisionReceipt> {
  const policyContext = input.policyContextOverride ?? await policyContextService.resolvePolicyContext(
    input.policyName,
    context.organizationId,
    {
      jurisdictionCodes: input.jurisdictionCodes ?? [],
      credentials: input.credentials,
      subjectEntityId: input.subjectEntityId,
    },
  );

  return policyDecisionReceiptService.createReceipt({
    organizationId: context.organizationId,
    actorIdentityId: context.actorIdentityId,
    receiptType: input.receiptType,
    policyName: policyContext.policyName,
    policyVersion: policyContext.policyVersion,
    policyDefinitionId: policyContext.policyDefinitionId,
    policyReference: policyContext.policyReference,
    policyApprovedByIdentityId: policyContext.policyApprovalContext?.approvedByIdentityId ?? undefined,
    policyEffectiveFrom: policyContext.policyApprovalContext?.effectiveFrom,
    policyExpiresAt: policyContext.policyApprovalContext?.expiresAt,
    policyGovernancePackId: policyContext.policyApprovalContext?.governancePackId,
    policyGovernancePackVersion: policyContext.policyApprovalContext?.governancePackVersion,
    policyGovernancePackLabel: policyContext.policyApprovalContext?.governancePackLabel,
    policyGovernanceProfileId: policyContext.policyApprovalContext?.governanceProfileId,
    policyGovernanceProfileLabel: policyContext.policyApprovalContext?.governanceProfileLabel,
    policyGovernanceRationale: policyContext.policyApprovalContext?.governanceProfileRationale,
    subjectEntityId: input.subjectEntityId,
    policyExceptionIds: policyContext.exceptionContext?.exceptions.map((exception) => exception.exceptionId) ?? [],
    jurisdictionCodes: input.jurisdictionCodes ?? [],
    decisionSummary: input.decisionSummary,
    input: input.payload,
    output: input.result,
    evidence: input.evidence,
    metadata: {
      policyFamily: policyContext.policyFamily,
      ...(policyContext.policyApprovalContext ? { policyApprovalContext: policyContext.policyApprovalContext } : {}),
      ...(policyContext.policyLifecycleContext ? { policyLifecycleContext: policyContext.policyLifecycleContext } : {}),
      ...(context.governanceSettings ? {
        organizationGovernanceContext: {
          ...(context.governanceSettings.defaultPack
            ? { defaultPack: context.governanceSettings.defaultPack }
            : {}),
          ...(context.governanceSettings.familyPacks
            ? { familyPacks: context.governanceSettings.familyPacks }
            : {}),
          ...(context.governanceSettings.lastUpdatedAt
            ? { lastUpdatedAt: context.governanceSettings.lastUpdatedAt }
            : {}),
          ...(context.governanceSettings.lastUpdatedByIdentityId
            ? { lastUpdatedByIdentityId: context.governanceSettings.lastUpdatedByIdentityId }
            : {}),
          ...(context.governanceSettings.changeHistory && context.governanceSettings.changeHistory.length > 0
            ? { changeHistory: context.governanceSettings.changeHistory.slice(-5) }
            : {}),
          ...(policyContext.policyApprovalContext?.governancePackId
            ? {
              activePack: {
                id: policyContext.policyApprovalContext.governancePackId,
                version: policyContext.policyApprovalContext.governancePackVersion,
                label: policyContext.policyApprovalContext.governancePackLabel,
                policyFamily: policyContext.policyFamily,
              },
            }
            : {}),
        },
      } : {}),
      ...(policyContext.trustContext ? { trustContext: policyContext.trustContext } : {}),
      ...(input.credentials && input.credentials.length > 0 ? {
        credentialEvidenceRefs: input.credentials
          .filter((credential) => typeof credential.credentialId === 'string' && credential.credentialId.length > 0)
          .map((credential) => ({
            credentialId: credential.credentialId,
            issuerId: credential.issuerId,
            credentialType: credential.credentialType,
          })),
      } : {}),
      ...(policyContext.exceptionContext ? { exceptionContext: policyContext.exceptionContext } : {}),
      ...(input.metadata ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts — List compliance decision receipts
// ---------------------------------------------------------------------------
router.get('/receipts', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  const context = await requireReceiptContext(req, res);
  if (!context) return;

  const limit = Number(req.query.limit ?? 25);
  const receipts = await policyDecisionReceiptService.listReceipts(context.organizationId, limit);
  res.status(200).json({ data: receipts });
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId — Fetch compliance decision receipt
// ---------------------------------------------------------------------------
router.get('/receipts/:receiptId', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  const context = await requireReceiptContext(req, res);
  if (!context) return;

  const receipt = await policyDecisionReceiptService.getReceipt(req.params.receiptId as string);
  if (!receipt || receipt.organizationId !== context.organizationId) {
    res.status(404).json({ error: 'Receipt not found', code: 'COMPLIANCE_RECEIPT_NOT_FOUND' });
    return;
  }

  res.status(200).json({ data: receipt });
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId/verify — Verify receipt integrity
// ---------------------------------------------------------------------------
router.get('/receipts/:receiptId/verify', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  const context = await requireReceiptContext(req, res);
  if (!context) return;

  const verification = await policyDecisionReceiptService.verifyReceipt(req.params.receiptId as string);
  if (!verification.receipt || verification.receipt.organizationId !== context.organizationId) {
    res.status(404).json({ error: 'Receipt not found', code: 'COMPLIANCE_RECEIPT_NOT_FOUND' });
    return;
  }

  res.status(200).json({ data: verification });
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId/export — Export receipt evidence bundle
// ---------------------------------------------------------------------------
router.get('/receipts/:receiptId/export', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  const context = await requireReceiptContext(req, res);
  if (!context) return;

  const exported = await policyDecisionReceiptService.exportReceipt(req.params.receiptId as string);
  if (!exported || exported.receipt.organizationId !== context.organizationId) {
    res.status(404).json({ error: 'Receipt not found', code: 'COMPLIANCE_RECEIPT_NOT_FOUND' });
    return;
  }

  res.status(200).json({ data: exported });
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen — Sanctions screening
// ---------------------------------------------------------------------------
router.post('/screen', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(ScreeningRequestSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const policyContext = await policyContextService.resolvePolicyContext(
      'sanctions_screening',
      context.organizationId,
      {
        subjectEntityId: req.body.entityId,
      },
    );
    const baseResult = await sanctionsScreeningService.screenEntity(req.body);
    const policyExecution = await policyExecutionService.applyScreeningPolicy(
      context.organizationId,
      policyContext,
      req.body,
      baseResult,
    );
    const result = policyExecution.result;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'sanctions_screening',
      policyName: 'sanctions_screening',
      subjectEntityId: req.body.entityId,
      decisionSummary: `screening_result:${result.overallRisk}`,
      payload: req.body,
      result,
      evidence: {
        listsScreened: result.listsScreened,
        matchCount: result.matches.length,
        confirmedMatches: result.matches.filter((match) => match.status === 'confirmed_match').length,
        potentialMatches: result.matches.filter((match) => match.status === 'pending_review').length,
      },
      metadata: {
        route: '/enterprise/compliance/screen',
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });

    res.status(200).json({
      data: result,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'Screening completed',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('screening_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'SCREENING_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/batch — Batch screening
// ---------------------------------------------------------------------------
router.post('/screen/batch', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(BatchScreeningRequestSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const policyContext = await policyContextService.resolvePolicyContext(
      'batch_sanctions_screening',
      context.organizationId,
    );
    const baseResult = await sanctionsScreeningService.screenBatch(req.body);
    const policyExecution = await policyExecutionService.applyBatchScreeningPolicy(
      context.organizationId,
      policyContext,
      req.body,
      baseResult,
    );
    const result = policyExecution.result;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'sanctions_screening',
      policyName: 'batch_sanctions_screening',
      decisionSummary: `batch_screening:${result.totalEntities}:${result.summary.confirmedMatch}:${result.summary.potentialMatch}`,
      payload: req.body,
      result,
      evidence: {
        totalEntities: result.totalEntities,
        summary: result.summary,
      },
      metadata: {
        route: '/enterprise/compliance/screen/batch',
        clientId: req.body.clientId,
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    res.status(200).json({
      data: result,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'Batch screening completed',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('batch_screening_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'BATCH_SCREENING_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/resolve — Resolve false positive
// ---------------------------------------------------------------------------
router.post('/screen/resolve', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES), validate(FalsePositiveDecisionSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    await sanctionsScreeningService.resolveMatch(req.body);
    res.status(200).json({ message: 'Match resolution recorded' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('resolve_match_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'RESOLVE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/status/:entityId — Compliance status
// ---------------------------------------------------------------------------
router.get('/status/:entityId', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const { entityId } = req.params;
    const jurisdiction = req.query.jurisdiction as string | undefined;

    if (jurisdiction) {
      const parsed = JurisdictionCodeSchema.safeParse(jurisdiction);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid jurisdiction code', code: 'INVALID_JURISDICTION' });
        return;
      }
      const status = jurisdictionEngine.getComplianceStatus(entityId as string, parsed.data);
      if (!status) {
        res.status(404).json({ error: 'No compliance status found', code: 'NOT_FOUND' });
        return;
      }
      res.status(200).json({ data: status });
      return;
    }

    // Return screening history
    const screenings = sanctionsScreeningService.getEntityScreenings(entityId as string);
    res.status(200).json({ data: { entityId, screenings } });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('compliance_status_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'STATUS_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/evaluate — Evaluate compliance for entity
// ---------------------------------------------------------------------------
router.post('/evaluate', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(ComplianceEvaluationRequestSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const credentialInputs = (req.body.credentials ?? []).map((credential: Record<string, unknown>) => ({
      credentialId: typeof credential.credentialId === 'string' ? credential.credentialId : undefined,
      issuerId: String(credential.issuerId ?? ''),
      credentialType: String(credential.credentialType ?? ''),
    }));
    const policyContext = await policyContextService.resolvePolicyContext(
      'jurisdiction_compliance',
      context.organizationId,
      {
        jurisdictionCodes: req.body.jurisdictions ?? [],
        credentials: credentialInputs,
        subjectEntityId: req.body.entityId,
      },
    );

    const baseResults = await jurisdictionEngine.evaluateCompliance(req.body);
    const policyExecution = await policyExecutionService.applyCompliancePolicy(
      context.organizationId,
      policyContext,
      req.body,
      baseResults,
    );
    const results = policyExecution.results;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'compliance_evaluation',
      policyName: 'jurisdiction_compliance',
      subjectEntityId: req.body.entityId,
      jurisdictionCodes: req.body.jurisdictions ?? [],
      decisionSummary: results.map((result) => `${result.jurisdiction}:${result.overallStatus}`).join(','),
      payload: req.body,
      result: results,
      evidence: results.map((result) => ({
        jurisdiction: result.jurisdiction,
        overallStatus: result.overallStatus,
        missingCredentials: result.missingCredentials,
        ruleOutcomes: result.rules.map((rule) => ({ name: rule.name, status: rule.status })),
      })),
      credentials: credentialInputs,
      metadata: {
        route: '/enterprise/compliance/evaluate',
        operationType: req.body.operationType,
        ...(credentialInputs.length > 0 ? {
          credentialEvidenceUsage: buildCredentialEvidenceUsage(
            req.body.jurisdictions ?? [],
            req.body.operationType,
            credentialInputs,
          ),
        } : {}),
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    res.status(200).json({
      data: results,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'Compliance evaluation completed',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('compliance_evaluation_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'EVALUATION_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report — Generate regulatory report
// ---------------------------------------------------------------------------
router.post('/report', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const { reportType } = req.body;
    const parsed = ReportTypeSchema.safeParse(reportType);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid report type', code: 'INVALID_REPORT_TYPE' });
      return;
    }

    let report: GeneratedReport;
    switch (parsed.data) {
      case 'SAR':
        report = await regulatoryReportingService.generateSAR(req.body);
        break;
      case 'CTR':
        report = await regulatoryReportingService.generateCTR(req.body);
        break;
      case 'STR':
        report = await regulatoryReportingService.generateSTR(req.body);
        break;
      case 'DSAR':
        report = await regulatoryReportingService.fulfillDSAR(req.body);
        break;
      case 'ERASURE':
        report = await regulatoryReportingService.processErasure(req.body);
        break;
      case 'AUDIT':
        report = await regulatoryReportingService.generateAuditPackage(
          req.body.jurisdiction ?? 'all',
          req.body.dateRange ?? { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), end: new Date().toISOString() },
        );
        break;
      case 'DASHBOARD': {
        const dashboard = regulatoryReportingService.getDashboardData();
        const policyContext = await policyContextService.resolvePolicyContext(
          'regulatory_dashboard',
          context.organizationId,
          {
            jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
          },
        );
        const receipt = await createPolicyAnchoredReceipt(context, {
          receiptType: 'regulatory_report',
          policyName: 'regulatory_dashboard',
          jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
          decisionSummary: 'dashboard_generated',
          payload: req.body,
          result: dashboard,
          evidence: { reportType: 'DASHBOARD' },
          metadata: {
            route: '/enterprise/compliance/report',
          },
          policyContextOverride: policyContext,
        });
        res.status(200).json({ data: dashboard, receipt: summarizeReceipt(receipt) });
        return;
      }
      default:
        res.status(400).json({ error: 'Unsupported report type', code: 'UNSUPPORTED_REPORT_TYPE' });
        return;
    }

    const policyContext = await policyContextService.resolvePolicyContext(
      'regulatory_reporting',
      context.organizationId,
      {
        jurisdictionCodes: [
          req.body.jurisdiction,
          req.body.filingInstitution?.jurisdiction,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        subjectEntityId: req.body.entityId ?? req.body.subject?.entityId ?? req.body.dataSubject?.entityId,
      },
    );
    const baseReport = report;
    const policyExecution = await policyExecutionService.applyReportingPolicy(
      context.organizationId,
      policyContext,
      req.body,
      baseReport,
    );
    report = policyExecution.result;
    const reportEventRecordedAt = new Date().toISOString();
    const reportAuthority = resolveRegulatoryAuthority(report.reportType, report.filingJurisdiction);
    const generatedEventPreview: ReportEvidenceEventSnapshot = {
      action: 'generated',
      recordedAt: reportEventRecordedAt,
      policyName: 'regulatory_reporting',
      decisionSummary: `report_generated:${parsed.data}`,
      ...(reportAuthority ? { authority: reportAuthority } : {}),
      ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
      version: report.version,
    };
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'regulatory_report',
      policyName: 'regulatory_reporting',
      subjectEntityId: req.body.entityId ?? req.body.subject?.entityId ?? req.body.dataSubject?.entityId,
      jurisdictionCodes: [
        req.body.jurisdiction,
        req.body.filingInstitution?.jurisdiction,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
      decisionSummary: `report_generated:${parsed.data}`,
      payload: req.body,
      result: report,
      evidence: {
        reportType: parsed.data,
        reportId: (report as any)?.reportId ?? null,
      },
      metadata: {
        route: '/enterprise/compliance/report',
        reportLifecycle: buildReportLifecycleSnapshot('generated', report),
        reportFilingPackage: buildReportFilingPackage(
          report,
          [...(report.evidenceTrail ?? []), generatedEventPreview],
          reportEventRecordedAt,
        ),
        obligationEvidenceUsage: buildReportingObligationUsage(
          baseReport,
          report,
          policyExecution.trace,
        ),
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    await recordReportEvidenceEvent(report, {
      action: 'generated',
      receiptId: receipt.receiptId,
      actorIdentityId: context.actorIdentityId,
      policyName: receipt.policyName,
      policyVersion: receipt.policyVersion,
      decisionSummary: receipt.decisionSummary,
      ...(reportAuthority ? { authority: reportAuthority } : {}),
      ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
      version: report.version,
    });

    res.status(201).json({
      data: report,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: `${parsed.data} report generated`,
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_generation_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'REPORT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/submit — Submit report
// ---------------------------------------------------------------------------
router.post('/report/:reportId/submit', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const result = await regulatoryReportingService.submitReport(req.params.reportId as string);
    const submittedReport = regulatoryReportingService.getReport(req.params.reportId as string);
    const submissionRecordedAt = new Date().toISOString();
    const submissionAuthority = submittedReport
      ? resolveRegulatoryAuthority(submittedReport.reportType, submittedReport.filingJurisdiction)
      : null;
    const submittedEventPreview: ReportEvidenceEventSnapshot | undefined = submittedReport
      ? {
        action: 'submitted',
        recordedAt: submissionRecordedAt,
        policyName: 'regulatory_submission',
        decisionSummary: `report_submitted:${req.params.reportId}`,
        ...(submissionAuthority ? { authority: submissionAuthority } : {}),
        filingReference: result.filingReference,
        version: submittedReport.version,
      }
      : undefined;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'regulatory_report',
      policyName: 'regulatory_submission',
      jurisdictionCodes: submittedReport?.filingJurisdiction ? [submittedReport.filingJurisdiction] : [],
      decisionSummary: `report_submitted:${req.params.reportId}`,
      payload: {
        reportId: req.params.reportId,
      },
      result,
      evidence: {
        reportId: req.params.reportId,
        filingReference: result.filingReference,
        submittedAt: result.submittedAt,
      },
      metadata: {
        route: '/enterprise/compliance/report/:reportId/submit',
        ...(submittedReport ? {
          reportLifecycle: buildReportLifecycleSnapshot('submitted', submittedReport, {
            filingReference: result.filingReference,
            submittedAt: result.submittedAt,
          }),
        } : {}),
        ...(submittedReport && submittedEventPreview ? {
          reportFilingPackage: buildReportFilingPackage(
            submittedReport,
            [...(submittedReport.evidenceTrail ?? []), submittedEventPreview],
            submissionRecordedAt,
          ),
        } : {}),
        ...(submittedReport ? {
          obligationEvidenceUsage: buildReportSubmissionObligationUsage(
            submittedReport,
            result,
          ),
        } : {}),
      },
    });
    if (submittedReport) {
      await recordReportEvidenceEvent(submittedReport, {
        action: 'submitted',
        receiptId: receipt.receiptId,
        actorIdentityId: context.actorIdentityId,
        policyName: receipt.policyName,
        policyVersion: receipt.policyVersion,
        decisionSummary: receipt.decisionSummary,
        ...(submissionAuthority ? { authority: submissionAuthority } : {}),
        filingReference: result.filingReference,
        version: submittedReport.version,
      });
    }
    res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Report submitted to regulatory authority' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_submit_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'SUBMIT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/amend — Amend report
// ---------------------------------------------------------------------------
router.post(
  '/report/:reportId/amend',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  validate(ReportAmendmentRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await requireReceiptContext(req, res);
      if (!context) return;

      const amendedReport = await regulatoryReportingService.amendReport(
        req.params.reportId as string,
        req.body.reason,
        req.body.changes,
      );
      const amendmentRecordedAt = new Date().toISOString();
      const amendmentAuthority = resolveRegulatoryAuthority(amendedReport.reportType, amendedReport.filingJurisdiction);
      const amendedEventPreview: ReportEvidenceEventSnapshot = {
        action: 'amended',
        recordedAt: amendmentRecordedAt,
        policyName: 'regulatory_amendment',
        decisionSummary: `report_amended:${req.params.reportId}:v${amendedReport.version}`,
        ...(amendmentAuthority ? { authority: amendmentAuthority } : {}),
        ...(amendedReport.filingReference !== undefined ? { filingReference: amendedReport.filingReference } : {}),
        version: amendedReport.version,
        amendmentReason: req.body.reason,
      };

      const receipt = await createPolicyAnchoredReceipt(context, {
        receiptType: 'regulatory_report',
        policyName: 'regulatory_amendment',
        jurisdictionCodes: amendedReport.filingJurisdiction ? [amendedReport.filingJurisdiction] : [],
        decisionSummary: `report_amended:${req.params.reportId}:v${amendedReport.version}`,
        payload: {
          reportId: req.params.reportId,
          reason: req.body.reason,
          changes: req.body.changes,
        },
        result: amendedReport,
        evidence: {
          reportId: req.params.reportId,
          version: amendedReport.version,
          filingReference: amendedReport.filingReference,
          amendmentCount: amendedReport.amendments.length,
        },
        metadata: {
          route: '/enterprise/compliance/report/:reportId/amend',
          reportLifecycle: buildReportLifecycleSnapshot('amended', amendedReport, {
            filingReference: amendedReport.filingReference,
            amendmentReason: req.body.reason,
            amendedAt: amendedReport.amendments[amendedReport.amendments.length - 1]?.amendedAt,
          }),
          reportFilingPackage: buildReportFilingPackage(
            amendedReport,
            [...(amendedReport.evidenceTrail ?? []), amendedEventPreview],
            amendmentRecordedAt,
          ),
          obligationEvidenceUsage: buildReportAmendmentObligationUsage(
            amendedReport,
            {
              reason: req.body.reason,
              changes: req.body.changes,
            },
          ),
        },
      });
      await recordReportEvidenceEvent(amendedReport, {
        action: 'amended',
        receiptId: receipt.receiptId,
        actorIdentityId: context.actorIdentityId,
        policyName: receipt.policyName,
        policyVersion: receipt.policyVersion,
        decisionSummary: receipt.decisionSummary,
        ...(amendmentAuthority ? { authority: amendmentAuthority } : {}),
        ...(amendedReport.filingReference !== undefined ? { filingReference: amendedReport.filingReference } : {}),
        version: amendedReport.version,
        amendmentReason: req.body.reason,
      });

      res.status(200).json({
        data: amendedReport,
        receipt: summarizeReceipt(receipt),
        message: 'Report amended',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('report_amend_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'AMEND_ERROR' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/export — Export report
// ---------------------------------------------------------------------------
router.get('/report/:reportId/export', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const fmt = ExportFormatSchema.safeParse(req.query.format ?? 'json');
    if (!fmt.success) {
      res.status(400).json({ error: 'Invalid export format', code: 'INVALID_FORMAT' });
      return;
    }
    const handoff = parseReportExportHandoff(req.query as Record<string, unknown>);
    if (handoff === null) {
      res.status(400).json({ error: 'Invalid export handoff parameters', code: 'INVALID_EXPORT_HANDOFF' });
      return;
    }
    const exported = await regulatoryReportingService.exportReport(req.params.reportId as string, fmt.data);
    const report = regulatoryReportingService.getReport(req.params.reportId as string);
    const exportedAt = new Date().toISOString();
    const exportAuthority = report ? resolveRegulatoryAuthority(report.reportType, report.filingJurisdiction) : null;
    const exportedEventPreview: ReportEvidenceEventSnapshot | undefined = report
      ? {
        action: 'exported',
        recordedAt: exportedAt,
        policyName: 'regulatory_export',
        decisionSummary: `report_exported:${req.params.reportId}:${fmt.data}`,
        ...(exportAuthority ? { authority: exportAuthority } : {}),
        ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
        version: report.version,
        exportFormat: fmt.data,
        exportFilename: exported.filename,
        ...(handoff?.deliveryChannel ? { deliveryChannel: handoff.deliveryChannel } : {}),
        ...(handoff?.destination ? { deliveryDestination: handoff.destination } : {}),
        ...(handoff?.acknowledgementId ? { deliveryAcknowledgementId: handoff.acknowledgementId } : {}),
        ...(handoff?.acknowledgedAt ? { deliveryAcknowledgedAt: handoff.acknowledgedAt } : {}),
      }
      : undefined;
    const receipt = report
      ? await createPolicyAnchoredReceipt(context, {
        receiptType: 'regulatory_report',
        policyName: 'regulatory_export',
        jurisdictionCodes: report.filingJurisdiction ? [report.filingJurisdiction] : [],
        decisionSummary: `report_exported:${req.params.reportId}:${fmt.data}`,
        payload: {
          reportId: req.params.reportId,
          format: fmt.data,
        },
        result: {
          filename: exported.filename,
          contentType: exported.contentType,
        },
        evidence: {
          reportId: req.params.reportId,
          reportType: report.reportType,
          version: report.version,
          format: fmt.data,
          filename: exported.filename,
          filingReference: report.filingReference,
          exportedAt,
        },
        metadata: {
          route: '/enterprise/compliance/report/:reportId/export',
          reportLifecycle: buildReportLifecycleSnapshot('exported', report, {
            exportFormat: fmt.data,
            exportFilename: exported.filename,
            exportRequestedAt: exportedAt,
            ...(handoff?.deliveryChannel ? { deliveryChannel: handoff.deliveryChannel } : {}),
            ...(handoff?.destination ? { deliveryDestination: handoff.destination } : {}),
            ...(handoff?.acknowledgementId ? { deliveryAcknowledgementId: handoff.acknowledgementId } : {}),
            ...(handoff?.acknowledgedAt ? { deliveryAcknowledgedAt: handoff.acknowledgedAt } : {}),
          }),
          ...(exportedEventPreview ? {
            reportFilingPackage: buildReportFilingPackage(
              report,
              [...(report.evidenceTrail ?? []), exportedEventPreview],
              exportedAt,
            ),
          } : {}),
          obligationEvidenceUsage: buildReportExportObligationUsage(
            report,
            fmt.data,
            exported.filename,
            exportedAt,
            handoff ?? undefined,
          ),
        },
      })
      : null;
    if (report && receipt) {
      await recordReportEvidenceEvent(report, {
        action: 'exported',
        receiptId: receipt.receiptId,
        actorIdentityId: context.actorIdentityId,
        policyName: receipt.policyName,
        policyVersion: receipt.policyVersion,
        decisionSummary: receipt.decisionSummary,
        ...(exportAuthority ? { authority: exportAuthority } : {}),
        ...(report.filingReference !== undefined ? { filingReference: report.filingReference } : {}),
        version: report.version,
        exportFormat: fmt.data,
        exportFilename: exported.filename,
        ...(handoff?.deliveryChannel ? { deliveryChannel: handoff.deliveryChannel } : {}),
        ...(handoff?.destination ? { deliveryDestination: handoff.destination } : {}),
        ...(handoff?.acknowledgementId ? { deliveryAcknowledgementId: handoff.acknowledgementId } : {}),
        ...(handoff?.acknowledgedAt ? { deliveryAcknowledgedAt: handoff.acknowledgedAt } : {}),
      });
    }
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    if (receipt) {
      res.setHeader('X-ZeroID-Receipt-Id', receipt.receiptId);
      res.setHeader('X-ZeroID-Receipt-Hash', receipt.integrityHash);
    }
    res.status(200).send(exported.data);
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_export_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'EXPORT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/evidence — Export regulator-ready filing package
// ---------------------------------------------------------------------------
router.get('/report/:reportId/evidence', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const report = regulatoryReportingService.getReport(req.params.reportId as string);
    if (!report) {
      res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
      return;
    }

    const evidenceTrail = regulatoryReportingService.getEvidenceTrail(req.params.reportId as string);
    const evaluatedAt = new Date().toISOString();

    res.status(200).json({
      data: {
        report,
        filingPackage: buildReportFilingPackage(report, evidenceTrail, evaluatedAt),
      },
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_evidence_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'REPORT_EVIDENCE_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/jurisdictions — List supported jurisdictions
// ---------------------------------------------------------------------------
router.get('/jurisdictions', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), (_req: Request, res: Response): void => {
  try {
    const jurisdictions = jurisdictionEngine.listJurisdictions();
    res.status(200).json({ data: jurisdictions });
  } catch (err) {
    const error = err as Error;
    logger.error('jurisdictions_list_error', { error: error.message });
    res.status(500).json({ error: error.message, code: 'JURISDICTION_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/cross-border — Cross-border transfer assessment
// ---------------------------------------------------------------------------
router.post('/cross-border', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    // Compliance cross-border assessment (jurisdiction level)
    const jurisdictionAssessment = CrossBorderAssessmentSchema.safeParse(req.body);
    if (jurisdictionAssessment.success) {
      const policyContext = await policyContextService.resolvePolicyContext(
        'jurisdiction_cross_border',
        context.organizationId,
        {
          jurisdictionCodes: [
            jurisdictionAssessment.data.sourceJurisdiction,
            jurisdictionAssessment.data.targetJurisdiction,
          ],
          subjectEntityId: req.body.entityId,
        },
      );
      const baseResult = jurisdictionEngine.assessCrossBorder(jurisdictionAssessment.data);
      const policyExecution = await policyExecutionService.applyCrossBorderPolicy(
        context.organizationId,
        policyContext,
        jurisdictionAssessment.data,
        baseResult,
      );
      const result = policyExecution.result;
      const receipt = await createPolicyAnchoredReceipt(context, {
        receiptType: 'cross_border_assessment',
        policyName: 'jurisdiction_cross_border',
        subjectEntityId: req.body.entityId,
        jurisdictionCodes: [
          jurisdictionAssessment.data.sourceJurisdiction,
          jurisdictionAssessment.data.targetJurisdiction,
        ],
        decisionSummary: `transfer_allowed:${result.allowed}`,
        payload: req.body,
        result,
        evidence: {
          restrictions: result.restrictions,
          transferMechanism: result.dataTransferMechanism,
        },
        metadata: {
          route: '/enterprise/compliance/cross-border',
          assessmentKind: 'jurisdiction',
          obligationEvidenceUsage: buildCrossBorderObligationUsage(
            jurisdictionAssessment.data.sourceJurisdiction,
            jurisdictionAssessment.data.targetJurisdiction,
            baseResult,
            result,
            policyExecution.trace,
          ),
          ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
        },
        policyContextOverride: policyContext,
      });
      res.status(200).json({
        data: result,
        receipt: summarizeReceipt(receipt),
        ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
        message: 'Cross-border assessment completed',
      });
      return;
    }

    // Data sovereignty cross-border assessment
    const transferAssessment = CrossBorderTransferSchema.safeParse(req.body);
    if (transferAssessment.success) {
      const policyContext = await policyContextService.resolvePolicyContext(
        'data_sovereignty_cross_border',
        context.organizationId,
        {
          jurisdictionCodes: [
            transferAssessment.data.sourceJurisdiction,
            transferAssessment.data.targetJurisdiction,
          ],
          subjectEntityId: req.body.dataSubjectId,
        },
      );
      const baseResult = dataSovereigntyService.assessCrossBorderTransfer(transferAssessment.data);
      const policyExecution = await policyExecutionService.applyCrossBorderPolicy(
        context.organizationId,
        policyContext,
        transferAssessment.data,
        baseResult,
      );
      const result = policyExecution.result;
      const receipt = await createPolicyAnchoredReceipt(context, {
        receiptType: 'cross_border_assessment',
        policyName: 'data_sovereignty_cross_border',
        subjectEntityId: req.body.dataSubjectId,
        jurisdictionCodes: [
          transferAssessment.data.sourceJurisdiction,
          transferAssessment.data.targetJurisdiction,
        ],
        decisionSummary: `transfer_allowed:${result.allowed}`,
        payload: req.body,
        result,
        evidence: {
          legalBasis: result.legalBasis,
          riskLevel: result.riskLevel,
        },
        metadata: {
          route: '/enterprise/compliance/cross-border',
          assessmentKind: 'data_transfer',
          obligationEvidenceUsage: buildCrossBorderObligationUsage(
            transferAssessment.data.sourceJurisdiction,
            transferAssessment.data.targetJurisdiction,
            baseResult,
            result,
            policyExecution.trace,
          ),
          ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
        },
        policyContextOverride: policyContext,
      });
      res.status(200).json({
        data: result,
        receipt: summarizeReceipt(receipt),
        ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
        message: 'Data transfer assessment completed',
      });
      return;
    }

    res.status(400).json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: jurisdictionAssessment.error.flatten(),
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('cross_border_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'CROSS_BORDER_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/dsar — Data subject access request
// ---------------------------------------------------------------------------
router.post('/dsar', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const { requestType } = req.body;

    if (requestType === 'erasure' || req.body.reportType === 'ERASURE') {
      const policyContext = await policyContextService.resolvePolicyContext(
        'data_subject_erasure',
        context.organizationId,
        {
          jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
          subjectEntityId: req.body.requestorId,
        },
      );
      const baseReport = await regulatoryReportingService.processErasure({ ...req.body, reportType: 'ERASURE' });
      const policyExecution = await policyExecutionService.applyPrivacyWorkflowPolicy(
        context.organizationId,
        policyContext,
        'erasure',
        req.body,
        baseReport,
      );
      const report = policyExecution.result;
      const receipt = await createPolicyAnchoredReceipt(context, {
        receiptType: 'regulatory_report',
        policyName: 'data_subject_erasure',
        subjectEntityId: req.body.requestorId,
        jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
        decisionSummary: 'erasure_request_processed',
        payload: req.body,
        result: report,
        evidence: {
          requestType: 'erasure',
          reportId: (report as any).reportId ?? null,
        },
        metadata: {
          route: '/enterprise/compliance/dsar',
          obligationEvidenceUsage: buildPrivacyObligationUsage(
            'erasure',
            req.body.jurisdiction ? [req.body.jurisdiction] : [],
            baseReport,
            report,
            policyExecution.trace,
          ),
          ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
        },
        policyContextOverride: policyContext,
      });
      res.status(200).json({
        data: report,
        receipt: summarizeReceipt(receipt),
        ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
        message: 'Erasure request processed',
      });
      return;
    }

    const policyContext = await policyContextService.resolvePolicyContext(
      'data_subject_access',
      context.organizationId,
      {
        jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
        subjectEntityId: req.body.requestorId,
      },
    );
    const baseReport = await regulatoryReportingService.fulfillDSAR({ ...req.body, reportType: 'DSAR' });
    const policyExecution = await policyExecutionService.applyPrivacyWorkflowPolicy(
      context.organizationId,
      policyContext,
      'dsar',
      req.body,
      baseReport,
    );
    const report = policyExecution.result;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'regulatory_report',
      policyName: 'data_subject_access',
      subjectEntityId: req.body.requestorId,
      jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
      decisionSummary: 'dsar_fulfilled',
      payload: req.body,
      result: report,
      evidence: {
        requestType: requestType ?? 'access',
        reportId: (report as any).reportId ?? null,
      },
      metadata: {
        route: '/enterprise/compliance/dsar',
        obligationEvidenceUsage: buildPrivacyObligationUsage(
          'dsar',
          req.body.jurisdiction ? [req.body.jurisdiction] : [],
          baseReport,
          report,
          policyExecution.trace,
        ),
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    res.status(200).json({
      data: report,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'DSAR fulfilled',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('dsar_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'DSAR_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/consent — Record consent
// ---------------------------------------------------------------------------
router.post('/consent', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(ConsentRecordSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = dataSovereigntyService.recordConsent(req.body);
    res.status(201).json({ data: result, message: 'Consent recorded' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('consent_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'CONSENT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/pia — Privacy impact assessment
// ---------------------------------------------------------------------------
router.post('/pia', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(PIASchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const policyContext = await policyContextService.resolvePolicyContext(
      'privacy_impact_assessment',
      context.organizationId,
      {
        jurisdictionCodes: req.body.jurisdictions ?? [],
        subjectEntityId: req.body.dataSubjectId,
      },
    );
    const baseResult = dataSovereigntyService.conductPIA(req.body);
    const policyExecution = await policyExecutionService.applyPrivacyWorkflowPolicy(
      context.organizationId,
      policyContext,
      'pia',
      req.body,
      baseResult,
    );
    const result = policyExecution.result;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'privacy_impact_assessment',
      policyName: 'privacy_impact_assessment',
      subjectEntityId: req.body.dataSubjectId,
      jurisdictionCodes: req.body.jurisdictions ?? [],
      decisionSummary: `pia_risk:${result.riskLevel}`,
      payload: req.body,
      result,
      evidence: {
        riskScore: result.riskScore,
        dpiaRequired: result.dpiaRequired,
        supervisoryConsultationRequired: result.supervisoryConsultationRequired,
      },
      metadata: {
        route: '/enterprise/compliance/pia',
        obligationEvidenceUsage: buildPrivacyObligationUsage(
          'pia',
          req.body.jurisdictions ?? [],
          baseResult,
          result,
          policyExecution.trace,
        ),
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    res.status(200).json({
      data: result,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'Privacy impact assessment completed',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('pia_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'PIA_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/breach — Breach notification
// ---------------------------------------------------------------------------
router.post('/breach', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES), validate(BreachNotificationSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const policyContext = await policyContextService.resolvePolicyContext(
      'data_breach_notification',
      context.organizationId,
      {
        jurisdictionCodes: req.body.jurisdictions ?? [],
      },
    );
    const baseTimeline = dataSovereigntyService.initiateBreachNotification(req.body);
    const policyExecution = await policyExecutionService.applyPrivacyWorkflowPolicy(
      context.organizationId,
      policyContext,
      'breach',
      req.body,
      baseTimeline,
    );
    const timeline = policyExecution.result;
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'breach_notification',
      policyName: 'data_breach_notification',
      jurisdictionCodes: req.body.jurisdictions ?? [],
      decisionSummary: `breach_workflow:${req.body.severity}:${timeline.dataSubjectNotificationRequired}`,
      payload: req.body,
      result: timeline,
      evidence: {
        breachId: timeline.breachId,
        regulatoryDeadlineCount: timeline.regulatoryDeadlines.length,
        dataSubjectNotificationRequired: timeline.dataSubjectNotificationRequired,
        dataSubjectDeadlineHours: timeline.dataSubjectDeadlineHours,
      },
      metadata: {
        route: '/enterprise/compliance/breach',
        obligationEvidenceUsage: buildPrivacyObligationUsage(
          'breach',
          req.body.jurisdictions ?? [],
          baseTimeline,
          timeline,
          policyExecution.trace,
        ),
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
    });
    res.status(201).json({
      data: timeline,
      receipt: summarizeReceipt(receipt),
      ...(policyExecution.trace ? { policyTrace: policyExecution.trace } : {}),
      message: 'Breach notification workflow initiated',
    });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('breach_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'BREACH_ERROR' });
  }
});

export default router;
