import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import { jurisdictionEngine, ComplianceEvaluationRequestSchema, CrossBorderAssessmentSchema, JurisdictionCodeSchema } from '../../services/compliance/jurisdiction-engine';
import { sanctionsScreeningService, ScreeningRequestSchema, BatchScreeningRequestSchema, FalsePositiveDecisionSchema } from '../../services/compliance/sanctions-screening';
import { regulatoryReportingService, ReportTypeSchema, ExportFormatSchema } from '../../services/compliance/regulatory-reporting';
import { dataSovereigntyService, CrossBorderTransferSchema, PIASchema, BreachNotificationSchema, ConsentRecordSchema } from '../../services/compliance/data-sovereignty';
import { EnterpriseAuthenticatedRequest, requireEnterpriseContext } from '../../middleware/enterprise';
import { EnterpriseRole, OrganizationGovernanceSettings } from '../../services/enterprise/organization-service';
import { policyDecisionReceiptService, PolicyDecisionReceipt } from '../../services/enterprise/policy-receipt-service';
import { policyContextService, PolicyExecutionContext } from '../../services/enterprise/policy-context-service';
import { policyExecutionService } from '../../services/enterprise/policy-execution-service';

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
    credentials?: Array<{ issuerId: string; credentialType: string }>;
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
    const policyExecution = await policyExecutionService.applyReportingPolicy(
      context.organizationId,
      policyContext,
      req.body,
      report,
    );
    report = policyExecution.result;
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
        ...(policyExecution.trace ? { policyExecutionTrace: policyExecution.trace } : {}),
      },
      policyContextOverride: policyContext,
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
    const receipt = await createPolicyAnchoredReceipt(context, {
      receiptType: 'regulatory_report',
      policyName: 'regulatory_submission',
      decisionSummary: `report_submitted:${req.params.reportId}`,
      payload: {
        reportId: req.params.reportId,
      },
      result,
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
