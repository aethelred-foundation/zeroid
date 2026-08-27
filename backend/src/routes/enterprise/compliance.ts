import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import {
  jurisdictionEngine,
  ComplianceEvaluationRequestSchema,
  JurisdictionCodeSchema,
} from '../../services/compliance/jurisdiction-engine';
import {
  ScreeningRequestSchema,
  BatchScreeningRequestSchema,
  FalsePositiveDecisionSchema,
} from '../../services/compliance/sanctions-screening';
import {
  PIASchema,
  BreachNotificationSchema,
  ConsentRecordSchema,
} from '../../services/compliance/data-sovereignty';
import {
  EnterpriseAuthenticatedRequest,
  requireEnterpriseContext,
} from '../../middleware/enterprise';
import { EnterpriseRole } from '../../services/enterprise/organization-service';
import { policyDecisionReceiptService } from '../../services/enterprise/policy-receipt-service';

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
const ENTERPRISE_COMPLIANCE_READ_ROLES: EnterpriseRole[] = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
];
const ENTERPRISE_COMPLIANCE_WRITE_ROLES: EnterpriseRole[] = [
  'operator',
  'admin',
  'compliance_officer',
];
const ENTERPRISE_COMPLIANCE_REVIEW_ROLES: EnterpriseRole[] = [
  'admin',
  'compliance_officer',
  'auditor',
];
const ReportAcknowledgementRequestSchema = z.object({
  stage: z.enum(['submitted', 'amended', 'exported']),
  acknowledgementId: z.string().min(2),
  acknowledgedAt: z.string().datetime().optional(),
  deliveryChannel: z.enum(['portal_upload', 'sftp', 'api', 'email']).optional(),
  destination: z.string().min(2).optional(),
});
const JurisdictionRequirementsParamsSchema = z.object({
  jurisdiction: JurisdictionCodeSchema,
});
const JurisdictionRequirementsQuerySchema = z.object({
  operationType: ComplianceEvaluationRequestSchema.shape.operationType
    .optional()
    .default('onboarding'),
});
const RegulatoryChangesQuerySchema = z.object({
  jurisdiction: JurisdictionCodeSchema.optional(),
  since: z.string().datetime().optional(),
});
const DataSovereigntyStatusParamsSchema = z.object({
  dataSubjectId: z.string().min(1),
});

function labelCredentialType(credentialType: string): string {
  return credentialType
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Middleware: validate request targets with Zod schemas
// ---------------------------------------------------------------------------
type ValidationSchemas = {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
};

function isZodSchema(value: unknown): value is z.ZodSchema {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { safeParse?: unknown }).safeParse === 'function',
  );
}

function validate(schemaOrSchemas: z.ZodSchema | ValidationSchemas) {
  return (req: Request, res: Response, next: () => void) => {
    const schemas = isZodSchema(schemaOrSchemas)
      ? { body: schemaOrSchemas }
      : schemaOrSchemas;
    const errors: Array<{ target: string; error: z.ZodError }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) req.body = result.data;
      else errors.push({ target: 'body', error: result.error });
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) (req as Request).query = result.data;
      else errors.push({ target: 'query', error: result.error });
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) req.params = result.data;
      else errors.push({ target: 'params', error: result.error });
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.map(({ target, error }) => ({
          target,
          issues: error.flatten(),
        })),
      });
      return;
    }

    next();
  };
}

function getEnterpriseReceiptContext(req: Request): {
  organizationId: string;
  actorIdentityId: string;
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
  };
}

async function requireReceiptContext(
  req: Request,
  res: Response,
): Promise<{ organizationId: string; actorIdentityId: string } | null> {
  const context = getEnterpriseReceiptContext(req);
  if (!context) {
    res.status(401).json({
      error: 'Authenticated enterprise context required',
      code: 'ENTERPRISE_AUTH_REQUIRED',
    });
    return null;
  }
  return context;
}

function sendSanctionsScreeningUnavailable(res: Response): void {
  res.status(503).json({
    error:
      'Sanctions screening requires authoritative provenance-bound identity evidence and an immutable tenant-scoped database.',
    code: 'AUTHORITATIVE_SANCTIONS_SCREENING_UNAVAILABLE',
  });
}

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts — List compliance decision receipts
// ---------------------------------------------------------------------------
router.get(
  '/receipts',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const limit = Number(req.query.limit ?? 25);
    const receipts = await policyDecisionReceiptService.listReceipts(
      context.organizationId,
      limit,
    );
    res.status(200).json({ data: receipts });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId — Fetch compliance decision receipt
// ---------------------------------------------------------------------------
router.get(
  '/receipts/:receiptId',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const receipt = await policyDecisionReceiptService.getReceipt(
      req.params.receiptId as string,
    );
    if (!receipt || receipt.organizationId !== context.organizationId) {
      res.status(404).json({
        error: 'Receipt not found',
        code: 'COMPLIANCE_RECEIPT_NOT_FOUND',
      });
      return;
    }

    res.status(200).json({ data: receipt });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId/verify — Verify receipt integrity
// ---------------------------------------------------------------------------
router.get(
  '/receipts/:receiptId/verify',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const verification = await policyDecisionReceiptService.verifyReceipt(
      req.params.receiptId as string,
    );
    if (
      !verification.receipt ||
      verification.receipt.organizationId !== context.organizationId
    ) {
      res.status(404).json({
        error: 'Receipt not found',
        code: 'COMPLIANCE_RECEIPT_NOT_FOUND',
      });
      return;
    }

    res.status(200).json({ data: verification });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/receipts/:receiptId/export — Export receipt evidence bundle
// ---------------------------------------------------------------------------
router.get(
  '/receipts/:receiptId/export',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    const exported = await policyDecisionReceiptService.exportReceipt(
      req.params.receiptId as string,
    );
    if (
      !exported ||
      exported.receipt.organizationId !== context.organizationId
    ) {
      res.status(404).json({
        error: 'Receipt not found',
        code: 'COMPLIANCE_RECEIPT_NOT_FOUND',
      });
      return;
    }

    res.status(200).json({ data: exported });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen — Sanctions screening
// ---------------------------------------------------------------------------
router.post(
  '/screen',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  validate({ body: ScreeningRequestSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    sendSanctionsScreeningUnavailable(res);
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/batch — Batch screening
// ---------------------------------------------------------------------------
router.post(
  '/screen/batch',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  validate({ body: BatchScreeningRequestSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    sendSanctionsScreeningUnavailable(res);
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/resolve — Resolve false positive
// ---------------------------------------------------------------------------
router.post(
  '/screen/resolve',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  validate({ body: FalsePositiveDecisionSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const context = await requireReceiptContext(req, res);
    if (!context) return;

    sendSanctionsScreeningUnavailable(res);
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/status/:entityId — Compliance status
// ---------------------------------------------------------------------------
router.get(
  '/status/:entityId',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const jurisdiction = req.query.jurisdiction as string | undefined;
      const context = await requireReceiptContext(req, res);
      if (!context) return;

      if (jurisdiction) {
        const parsed = JurisdictionCodeSchema.safeParse(jurisdiction);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid jurisdiction code',
            code: 'INVALID_JURISDICTION',
          });
          return;
        }
        res.status(503).json({
          error:
            'Authoritative credential verification and revocation-status connectors are not configured.',
          code: 'AUTHORITATIVE_CREDENTIAL_EVIDENCE_UNAVAILABLE',
        });
        return;
      }

      sendSanctionsScreeningUnavailable(res);
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('compliance_status_error', { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? 'STATUS_ERROR' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/evaluate — Evaluate compliance for entity
// ---------------------------------------------------------------------------
router.post(
  '/evaluate',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  validate({ body: ComplianceEvaluationRequestSchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Compliance evaluation requires authoritative issuer, signature, schema, expiry, and revocation-status verification.',
      code: 'AUTHORITATIVE_CREDENTIAL_VALIDATION_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report — Generate regulatory report
// ---------------------------------------------------------------------------
router.post(
  '/report',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory report generation requires a transactional tenant-scoped database and object store.',
      code: 'REGULATORY_REPORTING_BACKEND_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/submit — Submit report
// ---------------------------------------------------------------------------
router.post(
  '/report/:reportId/submit',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory submissions require a configured authority delivery and acknowledgement connector.',
      code: 'REPORT_SUBMISSION_CONNECTOR_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/amend — Amend report
// ---------------------------------------------------------------------------
router.post(
  '/report/:reportId/amend',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory report amendments require a transactional tenant-scoped database and object store.',
      code: 'REGULATORY_REPORT_TRANSACTIONAL_STORE_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/export — Export report
// ---------------------------------------------------------------------------
router.get(
  '/report/:reportId/export',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (req: Request, res: Response): void => {
    if (req.query.format === 'pdf') {
      res.status(501).json({
        error:
          'Regulatory PDF export requires an authority-approved PDF renderer and durable object store.',
        code: 'PDF_EXPORT_RENDERER_UNAVAILABLE',
      });
      return;
    }

    res.status(503).json({
      error:
        'Regulatory JSON, XML, and CSV exports require a transactional tenant-scoped database and durable object store.',
      code: 'REGULATORY_REPORT_EXPORT_BACKEND_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/manifest — Export authority submission manifest
// ---------------------------------------------------------------------------
router.get(
  '/report/:reportId/manifest',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Authority manifests require transactional report storage and an authoritative submission connector.',
      code: 'REGULATORY_REPORT_MANIFEST_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/submission-package — Export a sealed regulator submission bundle
// ---------------------------------------------------------------------------
router.get(
  '/report/:reportId/submission-package',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory submission packages require transactional tenant-scoped storage, authority profiles, and approved renderers.',
      code: 'REGULATORY_SUBMISSION_PACKAGE_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/submission-package/verify — Verify a sealed regulator submission bundle
// ---------------------------------------------------------------------------
router.post(
  '/report/submission-package/verify',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory submission verification requires an authoritative key registry and durable package evidence store.',
      code: 'REGULATORY_SUBMISSION_VERIFICATION_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/acknowledge — Persist regulator acknowledgement
// ---------------------------------------------------------------------------
router.post(
  '/report/:reportId/acknowledge',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  validate({ body: ReportAcknowledgementRequestSchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulator acknowledgements must be verified by an authoritative delivery connector before they can be recorded.',
      code: 'REGULATOR_ACKNOWLEDGEMENT_CONNECTOR_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/evidence — Export regulator-ready filing package
// ---------------------------------------------------------------------------
router.get(
  '/report/:reportId/evidence',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Regulatory filing evidence requires transactional tenant-scoped storage and an authoritative submission connector.',
      code: 'REGULATORY_REPORT_EVIDENCE_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/jurisdictions — List supported jurisdictions
// ---------------------------------------------------------------------------
router.get(
  '/jurisdictions',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  (_req: Request, res: Response): void => {
    try {
      const jurisdictions = jurisdictionEngine.listJurisdictions();
      res.status(200).json({ data: jurisdictions });
    } catch (err) {
      const error = err as Error;
      logger.error('jurisdictions_list_error', { error: error.message });
      res
        .status(500)
        .json({ error: error.message, code: 'JURISDICTION_ERROR' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/jurisdictions/:jurisdiction/requirements — Read required credentials and policy metadata
// ---------------------------------------------------------------------------
router.get(
  '/jurisdictions/:jurisdiction/requirements',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  validate({
    params: JurisdictionRequirementsParamsSchema,
    query: JurisdictionRequirementsQuerySchema,
  }),
  (req: Request, res: Response): void => {
    try {
      const { jurisdiction } = req.params;
      const { operationType } = req.query as z.infer<
        typeof JurisdictionRequirementsQuerySchema
      >;
      const jurisdictionMeta = jurisdictionEngine
        .listJurisdictions()
        .find((candidate) => candidate.code === jurisdiction);

      if (!jurisdictionMeta) {
        res.status(404).json({
          error: 'Jurisdiction not found',
          code: 'JURISDICTION_NOT_FOUND',
        });
        return;
      }

      const requiredCredentials = jurisdictionEngine.getRequiredCredentials(
        jurisdiction as z.infer<typeof JurisdictionCodeSchema>,
        operationType,
      );
      const retentionPolicy = jurisdictionEngine.getDataRetentionPolicy(
        jurisdiction as z.infer<typeof JurisdictionCodeSchema>,
      );

      res.status(200).json({
        data: {
          jurisdictionId: jurisdictionMeta.code,
          operationType,
          evidenceStatus: 'configured_policy_only',
          policySource: {
            kind: 'internal_configuration',
            externalAuthorityVerified: false,
          },
          requiredCredentials: requiredCredentials.map((credentialType) => ({
            credentialType,
            label: labelCredentialType(credentialType),
            mandatory: true,
          })),
          retentionPolicy: {
            retentionDays: retentionPolicy.retentionDays,
            dataResidencyRequired: retentionPolicy.dataResidencyRequired,
            consentModel: retentionPolicy.consentModel,
          },
          regulatoryBodyLabel: jurisdictionMeta.regulatoryBody,
          unavailableCapabilities: [
            'accepted_issuer_verification',
            'statutory_filing_deadlines',
            'reporting_obligation_verification',
            'aml_threshold_legal_determination',
          ],
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('jurisdiction_requirements_error', {
        error: error.message,
      });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? 'JURISDICTION_REQUIREMENTS_ERROR',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/regulatory-changes — List published jurisdiction changes
// ---------------------------------------------------------------------------
router.get(
  '/regulatory-changes',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  validate({ query: RegulatoryChangesQuerySchema }),
  (_req: Request, res: Response): void => {
    res.status(501).json({
      error:
        'An authoritative, source-attributed regulatory feed is not configured.',
      code: 'AUTHORITATIVE_REGULATORY_FEED_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/cross-border — Cross-border transfer assessment
// ---------------------------------------------------------------------------
router.post(
  '/cross-border',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Cross-border transfer decisions require an authoritative legal-basis, safeguard, and approval connector.',
      code: 'CROSS_BORDER_APPROVAL_CONNECTOR_UNAVAILABLE',
    });
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/sovereignty/status/:dataSubjectId — Data residency and privacy workflow status
// ---------------------------------------------------------------------------
router.get(
  '/sovereignty/status/:dataSubjectId',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_READ_ROLES),
  validate({ params: DataSovereigntyStatusParamsSchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Data-sovereignty evidence is unavailable until it is stored in a durable tenant-scoped system.',
      code: 'TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/dsar — Data subject access request
// ---------------------------------------------------------------------------
router.post(
  '/dsar',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Data-subject access and erasure workflows require verified subject authentication and authoritative data-system connectors.',
      code: 'DATA_SUBJECT_RIGHTS_CONNECTOR_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/consent — Record consent
// ---------------------------------------------------------------------------
router.post(
  '/consent',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  validate({ body: ConsentRecordSchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Consent evidence cannot be recorded without a durable tenant-scoped store and authenticated data-subject proof.',
      code: 'TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/pia — Privacy impact assessment
// ---------------------------------------------------------------------------
router.post(
  '/pia',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_WRITE_ROLES),
  validate({ body: PIASchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Privacy impact assessments require durable tenant-scoped evidence and an approved policy authority.',
      code: 'TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED',
    });
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/breach — Breach notification
// ---------------------------------------------------------------------------
router.post(
  '/breach',
  requireEnterpriseContext(ENTERPRISE_COMPLIANCE_REVIEW_ROLES),
  validate({ body: BreachNotificationSchema }),
  (_req: Request, res: Response): void => {
    res.status(503).json({
      error:
        'Breach workflows require durable tenant-scoped evidence and authoritative notification connectors.',
      code: 'TENANT_SCOPED_DATA_SOVEREIGNTY_STORE_REQUIRED',
    });
  },
);

export default router;
