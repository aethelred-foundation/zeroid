import { Router, Response } from 'express';
import { z } from 'zod';
import { logger, prisma } from '../../runtime';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import {
  EnterpriseAuthenticatedRequest,
  requireEnterpriseContext,
} from '../../middleware/enterprise';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validation';
import { EnterpriseRole } from '../../services/enterprise/organization-service';
import {
  complianceAdvisorService,
  ComplianceAdvisorError,
} from '../../services/ai/compliance-advisor';
import {
  riskScoringService,
  RiskScoringError,
} from '../../services/ai/risk-scoring';
import {
  fraudDetectionService,
  FraudDetectionError,
} from '../../services/ai/fraud-detection';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ScreenIdentitySchema = z.object({
  identityId: z.string().uuid(),
  fullName: z.string().min(2).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nationality: z.string().min(2).max(3).optional(),
  aliases: z.array(z.string().min(1).max(200)).max(20).optional(),
  documentNumbers: z.array(z.string().min(1).max(50)).max(10).optional(),
  jurisdiction: z.string().min(2).max(10),
});

const GenerateReportSchema = z.object({
  entityId: z.string().uuid(),
  reportType: z.enum(['kyc', 'aml', 'sanctions', 'pep', 'travel_rule', 'comprehensive']),
  jurisdiction: z.string().min(2).max(10),
});

const RiskAssessmentParamsSchema = z.object({
  identityId: z.string().uuid(),
});

const AlertParamsSchema = z.object({
  alertId: z.string().min(1).max(120),
});

const RiskAssessmentQuerySchema = z.object({
  jurisdiction: z.string().min(2).max(10).optional(),
  entityType: z.enum(['identity', 'credential', 'transaction']).default('identity'),
});

const AdvisorQuerySchema = z.object({
  question: z.string().min(5).max(1000),
  context: z.object({
    identityId: z.string().uuid().optional(),
    jurisdiction: z.string().min(2).max(10).optional(),
    regulatoryFramework: z.enum([
      'FATF', 'AMLD6', 'BSA', 'MAS_PSA', 'VARA', 'MiCA', 'FCA_MLR', 'FINMA_AMLA',
    ]).optional(),
  }).optional(),
});

const AlertsQuerySchema = z.object({
  entityId: z.string().uuid().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const RegulatoryImpactAssessmentSchema = z.object({
  regulation: z.string().min(3).max(200),
  changes: z.string().min(10).max(5000),
  jurisdiction: z.string().min(2).max(10),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();
const COMPLIANCE_READ_ROLES: EnterpriseRole[] = [
  'viewer',
  'operator',
  'admin',
  'compliance_officer',
  'auditor',
];
const COMPLIANCE_WRITE_ROLES: EnterpriseRole[] = [
  'operator',
  'admin',
  'compliance_officer',
];

// All AI compliance routes require authentication
router.use(authMiddleware);
router.use(apiRateLimiter);

function getOrganizationId(
  req: AuthenticatedRequest,
  res: Response,
): string | null {
  const organizationId = (req as EnterpriseAuthenticatedRequest)
    .enterpriseContext?.organizationId;
  if (!organizationId) {
    res.status(401).json({
      error: 'ENTERPRISE_AUTH_REQUIRED',
      message: 'Enterprise organization context required',
    });
    return null;
  }
  return organizationId;
}

function sendComplianceTargetNotFound(res: Response): void {
  res.status(404).json({
    error: 'COMPLIANCE_TARGET_NOT_FOUND',
    message: 'Compliance target not found',
  });
}

async function isIdentityInOrganization(
  organizationId: string,
  identityId: string,
): Promise<boolean> {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_identityId: {
        organizationId,
        identityId,
      },
    },
    select: { identityId: true },
  });
  return Boolean(membership);
}

async function requireIdentityTarget(
  req: AuthenticatedRequest,
  res: Response,
  identityId: string,
): Promise<boolean> {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return false;

  if (!(await isIdentityInOrganization(organizationId, identityId))) {
    sendComplianceTargetNotFound(res);
    return false;
  }

  return true;
}

async function requireCredentialTarget(
  req: AuthenticatedRequest,
  res: Response,
  credentialId: string,
): Promise<{ subjectId: string } | null> {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return null;

  const credential = await prisma.credential.findUnique({
    where: { id: credentialId },
    select: { issuerId: true, subjectId: true },
  });
  if (!credential) {
    sendComplianceTargetNotFound(res);
    return null;
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      organizationId,
      identityId: { in: [credential.issuerId, credential.subjectId] },
    },
    select: { identityId: true },
  });
  if (!membership) {
    sendComplianceTargetNotFound(res);
    return null;
  }

  return { subjectId: credential.subjectId };
}

async function getOrganizationIdentityIds(
  organizationId: string,
): Promise<Set<string>> {
  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: { identityId: true },
  });
  return new Set(memberships.map((membership) => membership.identityId));
}

// ---------------------------------------------------------------------------
// POST /ai/compliance/screen
// Screen an identity against sanctions/PEP lists
// ---------------------------------------------------------------------------
router.post(
  '/screen',
  validate({ body: ScreenIdentitySchema }),
  requireEnterpriseContext(COMPLIANCE_WRITE_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!(await requireIdentityTarget(req, res, req.body.identityId))) return;
      const result = await complianceAdvisorService.screenIdentity(req.body);

      const statusCode = result.result === 'confirmed_match' ? 200
        : result.result === 'potential_match' ? 200
        : 200;

      res.status(statusCode).json({
        success: true,
        data: result,
        ...(result.result !== 'clear' && {
          warning: `Screening result: ${result.result} — manual review may be required`,
        }),
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/report
// Generate a compliance report for an entity
// ---------------------------------------------------------------------------
router.post(
  '/report',
  validate({ body: GenerateReportSchema }),
  requireEnterpriseContext(COMPLIANCE_WRITE_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { entityId, reportType, jurisdiction } = req.body;
      if (!(await requireIdentityTarget(req, res, entityId))) return;
      const report = await complianceAdvisorService.generateReport(
        entityId,
        reportType,
        jurisdiction,
      );

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /ai/compliance/risk/:identityId
// Get comprehensive risk assessment for an identity
// ---------------------------------------------------------------------------
router.get(
  '/risk/:identityId',
  validate({
    params: RiskAssessmentParamsSchema,
    query: RiskAssessmentQuerySchema,
  }),
  requireEnterpriseContext(COMPLIANCE_READ_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { identityId } = req.params;
      const { jurisdiction, entityType } = req.query as {
        jurisdiction?: string;
        entityType: 'identity' | 'credential' | 'transaction';
      };
      if (entityType === 'identity') {
        if (!(await requireIdentityTarget(req, res, identityId as string))) return;
      } else if (entityType === 'credential') {
        const credentialTarget = await requireCredentialTarget(
          req,
          res,
          identityId as string,
        );
        if (!credentialTarget) return;
      } else {
        res.status(403).json({
          error: 'COMPLIANCE_TARGET_SCOPE_UNSUPPORTED',
          message:
            'Transaction risk requires an organization-scoped transaction record',
        });
        return;
      }

      const assessment = await riskScoringService.assessRisk(
        identityId as string,
        entityType,
        jurisdiction,
      );

      res.json({
        success: true,
        data: {
          riskAssessment: assessment,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/advisor/query
// Natural language compliance query
// ---------------------------------------------------------------------------
router.post(
  '/advisor/query',
  validate({ body: AdvisorQuerySchema }),
  requireEnterpriseContext(COMPLIANCE_READ_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const contextIdentityId = req.body.context?.identityId;
      if (
        contextIdentityId &&
        !(await requireIdentityTarget(req, res, contextIdentityId))
      ) {
        return;
      }

      const response = await complianceAdvisorService.queryComplianceAdvisor(req.body);

      res.json({
        success: true,
        data: response,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /ai/compliance/alerts
// Get active compliance alerts
// ---------------------------------------------------------------------------
router.get(
  '/alerts',
  validate({ query: AlertsQuerySchema }),
  requireEnterpriseContext(COMPLIANCE_READ_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { entityId, severity, limit } = req.query as unknown as {
        entityId?: string;
        severity?: 'low' | 'medium' | 'high' | 'critical';
        limit: number;
      };
      const organizationId = getOrganizationId(req, res);
      if (!organizationId) return;
      if (entityId && !(await requireIdentityTarget(req, res, entityId))) return;
      const organizationIdentityIds =
        await getOrganizationIdentityIds(organizationId);

      // Fetch both compliance alerts and fraud alerts
      const [complianceAlerts, fraudAlerts] = await Promise.all([
        complianceAdvisorService.getActiveAlerts(entityId),
        fraudDetectionService.getActiveAlerts(
          severity as 'low' | 'medium' | 'high' | 'critical' | undefined,
        ),
      ]);

      // Merge and sort by creation time
      const allAlerts = [
        ...complianceAlerts.map((a) => ({
          ...a,
          source: 'compliance' as const,
        })),
        ...fraudAlerts.map((a) => ({
          alertId: a.alertId,
          entityId: a.identityId,
          level: a.severity,
          category: 'fraud_detection',
          title: a.title,
          description: a.description,
          regulation: 'AML/CFT',
          actionRequired: a.status === 'active' ? 'Review and resolve' : 'Under investigation',
          createdAt: a.createdAt,
          source: 'fraud' as const,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
       .filter((alert) => organizationIdentityIds.has(alert.entityId))
       .slice(0, limit);
      const complianceAlertCount = allAlerts.filter(
        (alert) => alert.source === 'compliance',
      ).length;
      const fraudAlertCount = allAlerts.filter(
        (alert) => alert.source === 'fraud',
      ).length;

      res.json({
        success: true,
        data: {
          alerts: allAlerts,
          total: allAlerts.length,
          complianceAlertCount,
          fraudAlertCount,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/alerts/:alertId/acknowledge
// Acknowledge a compliance alert without resolving it
// ---------------------------------------------------------------------------
router.post(
  '/alerts/:alertId/acknowledge',
  validate({ params: AlertParamsSchema }),
  requireEnterpriseContext(COMPLIANCE_WRITE_ROLES),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.identity?.id) {
        res.status(401).json({
          error: 'UNAUTHENTICATED',
          message: 'Authentication required',
        });
        return;
      }

      const { alertId } = req.params as { alertId: string };
      const targetAlert = await complianceAdvisorService.getAlert(alertId);
      if (
        !targetAlert ||
        !(await requireIdentityTarget(req, res, targetAlert.entityId))
      ) {
        return;
      }

      const alert = await complianceAdvisorService.acknowledgeAlert(
        alertId,
        req.identity.id,
      );

      res.json({
        success: true,
        data: alert,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

async function runRegulatoryImpactAssessment(
  req: AuthenticatedRequest,
  res: Response,
  deprecatedAlias = false,
): Promise<void> {
  try {
    const { regulation, changes, jurisdiction } = req.body;

    const impact = await complianceAdvisorService.assessRegulatoryChangeImpact(
      regulation,
      changes,
      jurisdiction,
    );

    if (deprecatedAlias) {
      res.setHeader('Deprecation', 'true');
      res.setHeader(
        'Link',
        '</api/v1/ai/compliance/impact-assessment>; rel="successor-version"',
      );
    }

    res.json({
      success: true,
      data: impact,
    });
  } catch (error) {
    handleError(error, res);
  }
}

// ---------------------------------------------------------------------------
// POST /ai/compliance/impact-assessment
// Assess regulatory change impact against live ZeroID records
// ---------------------------------------------------------------------------
router.post(
  '/impact-assessment',
  validate({ body: RegulatoryImpactAssessmentSchema }),
  requireEnterpriseContext(COMPLIANCE_WRITE_ROLES),
  (req: AuthenticatedRequest, res: Response): Promise<void> =>
    runRegulatoryImpactAssessment(req, res),
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/simulate
// Backward-compatible alias for regulatory change impact assessment
// ---------------------------------------------------------------------------
router.post(
  '/simulate',
  validate({ body: RegulatoryImpactAssessmentSchema }),
  requireEnterpriseContext(COMPLIANCE_WRITE_ROLES),
  (req: AuthenticatedRequest, res: Response): Promise<void> =>
    runRegulatoryImpactAssessment(req, res, true),
);

// ---------------------------------------------------------------------------
// GET /ai/compliance/jurisdictions
// Get available jurisdiction configurations
// ---------------------------------------------------------------------------
router.get(
  '/jurisdictions',
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const jurisdictions = riskScoringService.getAvailableJurisdictions();

      res.json({
        success: true,
        data: jurisdictions,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
function handleError(error: unknown, res: Response): void {
  if (
    error instanceof ComplianceAdvisorError ||
    error instanceof RiskScoringError ||
    error instanceof FraudDetectionError
  ) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  logger.error('ai_compliance_route_error', {
    error: (error as Error).message,
    stack: (error as Error).stack,
  });

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
  });
}

export { router as aiComplianceRoutes };
