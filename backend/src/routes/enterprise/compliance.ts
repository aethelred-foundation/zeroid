import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { jurisdictionEngine, ComplianceEvaluationRequestSchema, CrossBorderAssessmentSchema, JurisdictionCodeSchema } from '../../services/compliance/jurisdiction-engine';
import { sanctionsScreeningService, ScreeningRequestSchema, BatchScreeningRequestSchema, FalsePositiveDecisionSchema } from '../../services/compliance/sanctions-screening';
import { regulatoryReportingService, ReportTypeSchema, ExportFormatSchema } from '../../services/compliance/regulatory-reporting';
import { dataSovereigntyService, CrossBorderTransferSchema, PIASchema, BreachNotificationSchema, ConsentRecordSchema } from '../../services/compliance/data-sovereignty';
import { EnterpriseAuthenticatedRequest, requireEnterpriseContext } from '../../middleware/enterprise';
import { EnterpriseRole } from '../../services/enterprise/organization-service';
import { policyDecisionReceiptService, PolicyDecisionReceipt } from '../../services/enterprise/policy-receipt-service';

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

function getEnterpriseReceiptContext(req: Request): { organizationId: string; actorIdentityId: string } | null {
  const enterpriseReq = req as EnterpriseAuthenticatedRequest;
  const organizationId = enterpriseReq.enterpriseContext?.organizationId;
  const actorIdentityId = enterpriseReq.identity?.id;
  if (!organizationId || !actorIdentityId) {
    return null;
  }
  return { organizationId, actorIdentityId };
}

function summarizeReceipt(receipt: PolicyDecisionReceipt): Record<string, unknown> {
  return {
    id: receipt.receiptId,
    receiptType: receipt.receiptType,
    decisionSummary: receipt.decisionSummary,
    integrityHash: receipt.integrityHash,
    createdAt: receipt.createdAt,
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
// POST /enterprise/compliance/screen — Sanctions screening
// ---------------------------------------------------------------------------
router.post('/screen', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES), validate(ScreeningRequestSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const result = await sanctionsScreeningService.screenEntity(req.body);
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'sanctions_screening',
      policyName: 'sanctions_screening',
      policyVersion: 'v1',
      subjectEntityId: req.body.entityId,
      jurisdictionCodes: [],
      decisionSummary: `screening_result:${result.overallRisk}`,
      input: req.body,
      output: result,
      evidence: {
        listsScreened: result.listsScreened,
        matchCount: result.matches.length,
        confirmedMatches: result.matches.filter((match) => match.status === 'confirmed_match').length,
        potentialMatches: result.matches.filter((match) => match.status === 'pending_review').length,
      },
      metadata: {
        route: '/enterprise/compliance/screen',
      },
    });

    res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Screening completed' });
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

    const result = await sanctionsScreeningService.screenBatch(req.body);
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'sanctions_screening',
      policyName: 'batch_sanctions_screening',
      policyVersion: 'v1',
      jurisdictionCodes: [],
      decisionSummary: `batch_screening:${result.totalEntities}:${result.summary.confirmedMatch}:${result.summary.potentialMatch}`,
      input: req.body,
      output: result,
      evidence: {
        totalEntities: result.totalEntities,
        summary: result.summary,
      },
      metadata: {
        route: '/enterprise/compliance/screen/batch',
        clientId: req.body.clientId,
      },
    });
    res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Batch screening completed' });
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

    const results = await jurisdictionEngine.evaluateCompliance(req.body);
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'compliance_evaluation',
      policyName: 'jurisdiction_compliance',
      policyVersion: 'v1',
      subjectEntityId: req.body.entityId,
      jurisdictionCodes: req.body.jurisdictions ?? [],
      decisionSummary: results.map((result) => `${result.jurisdiction}:${result.overallStatus}`).join(','),
      input: req.body,
      output: results,
      evidence: results.map((result) => ({
        jurisdiction: result.jurisdiction,
        overallStatus: result.overallStatus,
        missingCredentials: result.missingCredentials,
        ruleOutcomes: result.rules.map((rule) => ({ name: rule.name, status: rule.status })),
      })),
      metadata: {
        route: '/enterprise/compliance/evaluate',
        operationType: req.body.operationType,
      },
    });
    res.status(200).json({ data: results, receipt: summarizeReceipt(receipt), message: 'Compliance evaluation completed' });
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

    let report;
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
        const receipt = await policyDecisionReceiptService.createReceipt({
          organizationId: context.organizationId,
          actorIdentityId: context.actorIdentityId,
          receiptType: 'regulatory_report',
          policyName: 'regulatory_dashboard',
          policyVersion: 'v1',
          jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
          decisionSummary: 'dashboard_generated',
          input: req.body,
          output: dashboard,
          evidence: { reportType: 'DASHBOARD' },
          metadata: {
            route: '/enterprise/compliance/report',
          },
        });
        res.status(200).json({ data: dashboard, receipt: summarizeReceipt(receipt) });
        return;
      }
      default:
        res.status(400).json({ error: 'Unsupported report type', code: 'UNSUPPORTED_REPORT_TYPE' });
        return;
    }

    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'regulatory_report',
      policyName: 'regulatory_reporting',
      policyVersion: 'v1',
      subjectEntityId: req.body.entityId ?? req.body.subject?.entityId ?? req.body.dataSubject?.entityId,
      jurisdictionCodes: [
        req.body.jurisdiction,
        req.body.filingInstitution?.jurisdiction,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
      decisionSummary: `report_generated:${parsed.data}`,
      input: req.body,
      output: report,
      evidence: {
        reportType: parsed.data,
        reportId: (report as any)?.reportId ?? null,
      },
      metadata: {
        route: '/enterprise/compliance/report',
      },
    });

    res.status(201).json({ data: report, receipt: summarizeReceipt(receipt), message: `${parsed.data} report generated` });
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
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'regulatory_report',
      policyName: 'regulatory_submission',
      policyVersion: 'v1',
      jurisdictionCodes: [],
      decisionSummary: `report_submitted:${req.params.reportId}`,
      input: {
        reportId: req.params.reportId,
      },
      output: result,
      evidence: {
        reportId: req.params.reportId,
      },
      metadata: {
        route: '/enterprise/compliance/report/:reportId/submit',
      },
    });
    res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Report submitted to regulatory authority' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_submit_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'SUBMIT_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/export — Export report
// ---------------------------------------------------------------------------
router.get('/report/:reportId/export', requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const fmt = ExportFormatSchema.safeParse(req.query.format ?? 'json');
    if (!fmt.success) {
      res.status(400).json({ error: 'Invalid export format', code: 'INVALID_FORMAT' });
      return;
    }
    const exported = await regulatoryReportingService.exportReport(req.params.reportId as string, fmt.data);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.status(200).send(exported.data);
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('report_export_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'EXPORT_ERROR' });
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
      const result = jurisdictionEngine.assessCrossBorder(jurisdictionAssessment.data);
      const receipt = await policyDecisionReceiptService.createReceipt({
        organizationId: context.organizationId,
        actorIdentityId: context.actorIdentityId,
        receiptType: 'cross_border_assessment',
        policyName: 'jurisdiction_cross_border',
        policyVersion: 'v1',
        subjectEntityId: req.body.entityId,
        jurisdictionCodes: [
          jurisdictionAssessment.data.sourceJurisdiction,
          jurisdictionAssessment.data.targetJurisdiction,
        ],
        decisionSummary: `transfer_allowed:${result.allowed}`,
        input: req.body,
        output: result,
        evidence: {
          restrictions: result.restrictions,
          transferMechanism: result.dataTransferMechanism,
        },
        metadata: {
          route: '/enterprise/compliance/cross-border',
          assessmentKind: 'jurisdiction',
        },
      });
      res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Cross-border assessment completed' });
      return;
    }

    // Data sovereignty cross-border assessment
    const transferAssessment = CrossBorderTransferSchema.safeParse(req.body);
    if (transferAssessment.success) {
      const result = dataSovereigntyService.assessCrossBorderTransfer(transferAssessment.data);
      const receipt = await policyDecisionReceiptService.createReceipt({
        organizationId: context.organizationId,
        actorIdentityId: context.actorIdentityId,
        receiptType: 'cross_border_assessment',
        policyName: 'data_sovereignty_cross_border',
        policyVersion: 'v1',
        subjectEntityId: req.body.dataSubjectId,
        jurisdictionCodes: [
          transferAssessment.data.sourceJurisdiction,
          transferAssessment.data.targetJurisdiction,
        ],
        decisionSummary: `transfer_allowed:${result.allowed}`,
        input: req.body,
        output: result,
        evidence: {
          legalBasis: result.legalBasis,
          riskLevel: result.riskLevel,
        },
        metadata: {
          route: '/enterprise/compliance/cross-border',
          assessmentKind: 'data_transfer',
        },
      });
      res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Data transfer assessment completed' });
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
      const report = await regulatoryReportingService.processErasure({ ...req.body, reportType: 'ERASURE' });
      const receipt = await policyDecisionReceiptService.createReceipt({
        organizationId: context.organizationId,
        actorIdentityId: context.actorIdentityId,
        receiptType: 'regulatory_report',
        policyName: 'data_subject_erasure',
        policyVersion: 'v1',
        subjectEntityId: req.body.requestorId,
        jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
        decisionSummary: 'erasure_request_processed',
        input: req.body,
        output: report,
        evidence: {
          requestType: 'erasure',
          reportId: (report as any).reportId ?? null,
        },
        metadata: {
          route: '/enterprise/compliance/dsar',
        },
      });
      res.status(200).json({ data: report, receipt: summarizeReceipt(receipt), message: 'Erasure request processed' });
      return;
    }

    const report = await regulatoryReportingService.fulfillDSAR({ ...req.body, reportType: 'DSAR' });
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'regulatory_report',
      policyName: 'data_subject_access',
      policyVersion: 'v1',
      subjectEntityId: req.body.requestorId,
      jurisdictionCodes: req.body.jurisdiction ? [req.body.jurisdiction] : [],
      decisionSummary: 'dsar_fulfilled',
      input: req.body,
      output: report,
      evidence: {
        requestType: requestType ?? 'access',
        reportId: (report as any).reportId ?? null,
      },
      metadata: {
        route: '/enterprise/compliance/dsar',
      },
    });
    res.status(200).json({ data: report, receipt: summarizeReceipt(receipt), message: 'DSAR fulfilled' });
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

    const result = dataSovereigntyService.conductPIA(req.body);
    const receipt = await policyDecisionReceiptService.createReceipt({
      organizationId: context.organizationId,
      actorIdentityId: context.actorIdentityId,
      receiptType: 'privacy_impact_assessment',
      policyName: 'privacy_impact_assessment',
      policyVersion: 'v1',
      subjectEntityId: req.body.dataSubjectId,
      jurisdictionCodes: req.body.jurisdictions ?? [],
      decisionSummary: `pia_risk:${result.riskLevel}`,
      input: req.body,
      output: result,
      evidence: {
        riskScore: result.riskScore,
        dpiaRequired: result.dpiaRequired,
        supervisoryConsultationRequired: result.supervisoryConsultationRequired,
      },
      metadata: {
        route: '/enterprise/compliance/pia',
      },
    });
    res.status(200).json({ data: result, receipt: summarizeReceipt(receipt), message: 'Privacy impact assessment completed' });
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
    const timeline = dataSovereigntyService.initiateBreachNotification(req.body);
    res.status(201).json({ data: timeline, message: 'Breach notification workflow initiated' });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error('breach_error', { error: error.message });
    res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code ?? 'BREACH_ERROR' });
  }
});

export default router;
