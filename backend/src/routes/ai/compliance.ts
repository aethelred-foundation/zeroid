import { Router, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../index';
import { AuthenticatedRequest, authMiddleware } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import {
  complianceCopilotService,
  ComplianceCopilotError,
} from '../../services/ai/compliance-copilot';
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

const RiskAssessmentQuerySchema = z.object({
  jurisdiction: z.string().min(2).max(10).optional(),
  entityType: z.enum(['identity', 'credential', 'transaction']).default('identity'),
});

const CopilotQuerySchema = z.object({
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

const SimulateChangeSchema = z.object({
  regulation: z.string().min(3).max(200),
  changes: z.string().min(10).max(5000),
  jurisdiction: z.string().min(2).max(10),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// All AI compliance routes require authentication
router.use(authMiddleware);

// ---------------------------------------------------------------------------
// POST /ai/compliance/screen
// Screen an identity against sanctions/PEP lists
// ---------------------------------------------------------------------------
router.post(
  '/screen',
  validate({ body: ScreenIdentitySchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const result = await complianceCopilotService.screenIdentity(req.body);

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
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { entityId, reportType, jurisdiction } = req.body;
      const report = await complianceCopilotService.generateReport(
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
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { identityId } = req.params;
      const { jurisdiction, entityType } = req.query as {
        jurisdiction?: string;
        entityType: 'identity' | 'credential' | 'transaction';
      };

      const assessment = await riskScoringService.assessRisk(
        identityId as string,
        entityType,
        jurisdiction,
      );

      // Also fetch compliance score
      const complianceScore = await complianceCopilotService.computeComplianceScore(
        identityId as string,
        jurisdiction ?? 'US',
      );

      res.json({
        success: true,
        data: {
          riskAssessment: assessment,
          complianceScore,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/copilot/query
// Natural language compliance query
// ---------------------------------------------------------------------------
router.post(
  '/copilot/query',
  validate({ body: CopilotQuerySchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const response = await complianceCopilotService.queryComplianceCopilot(req.body);

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
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { entityId, severity, limit } = req.query as unknown as {
        entityId?: string;
        severity?: 'low' | 'medium' | 'high' | 'critical';
        limit: number;
      };

      // Fetch both compliance alerts and fraud alerts
      const [complianceAlerts, fraudAlerts] = await Promise.all([
        complianceCopilotService.getActiveAlerts(entityId),
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
       .slice(0, limit);

      res.json({
        success: true,
        data: {
          alerts: allAlerts,
          total: allAlerts.length,
          complianceAlertCount: complianceAlerts.length,
          fraudAlertCount: fraudAlerts.length,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/compliance/simulate
// Simulate regulatory change impact
// ---------------------------------------------------------------------------
router.post(
  '/simulate',
  validate({ body: SimulateChangeSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { regulation, changes, jurisdiction } = req.body;

      const impact = await complianceCopilotService.simulateRegulatoryChange(
        regulation,
        changes,
        jurisdiction,
      );

      res.json({
        success: true,
        data: impact,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
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
    error instanceof ComplianceCopilotError ||
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
