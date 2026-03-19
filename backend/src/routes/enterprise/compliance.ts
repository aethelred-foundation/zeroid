import { Router, Request, Response } from "express";
import { z } from "zod";
import { createLogger, format, transports } from "winston";
import {
  jurisdictionEngine,
  ComplianceEvaluationRequestSchema,
  CrossBorderAssessmentSchema,
  JurisdictionCodeSchema,
} from "../../services/compliance/jurisdiction-engine";
import {
  sanctionsScreeningService,
  ScreeningRequestSchema,
  BatchScreeningRequestSchema,
  FalsePositiveDecisionSchema,
} from "../../services/compliance/sanctions-screening";
import {
  regulatoryReportingService,
  ReportTypeSchema,
  ExportFormatSchema,
} from "../../services/compliance/regulatory-reporting";
import {
  dataSovereigntyService,
  CrossBorderTransferSchema,
  PIASchema,
  BreachNotificationSchema,
  ConsentRecordSchema,
} from "../../services/compliance/data-sovereignty";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "compliance-routes" },
  transports: [new transports.Console()],
});

const router = Router();

// ---------------------------------------------------------------------------
// Middleware: validate request body with Zod schema
// ---------------------------------------------------------------------------
function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: () => void) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen — Sanctions screening
// ---------------------------------------------------------------------------
router.post(
  "/screen",
  validate(ScreeningRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await sanctionsScreeningService.screenEntity(req.body);
      res.status(200).json({ data: result, message: "Screening completed" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("screening_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "SCREENING_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/batch — Batch screening
// ---------------------------------------------------------------------------
router.post(
  "/screen/batch",
  validate(BatchScreeningRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await sanctionsScreeningService.screenBatch(req.body);
      res
        .status(200)
        .json({ data: result, message: "Batch screening completed" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("batch_screening_error", { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? "BATCH_SCREENING_ERROR",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/screen/resolve — Resolve false positive
// ---------------------------------------------------------------------------
router.post(
  "/screen/resolve",
  validate(FalsePositiveDecisionSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await sanctionsScreeningService.resolveMatch(req.body);
      res.status(200).json({ message: "Match resolution recorded" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("resolve_match_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "RESOLVE_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/status/:entityId — Compliance status
// ---------------------------------------------------------------------------
router.get(
  "/status/:entityId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { entityId } = req.params;
      const jurisdiction = req.query.jurisdiction as string | undefined;

      if (jurisdiction) {
        const parsed = JurisdictionCodeSchema.safeParse(jurisdiction);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid jurisdiction code",
            code: "INVALID_JURISDICTION",
          });
          return;
        }
        const status = jurisdictionEngine.getComplianceStatus(
          entityId as string,
          parsed.data,
        );
        if (!status) {
          res
            .status(404)
            .json({ error: "No compliance status found", code: "NOT_FOUND" });
          return;
        }
        res.status(200).json({ data: status });
        return;
      }

      // Return screening history
      const screenings = sanctionsScreeningService.getEntityScreenings(
        entityId as string,
      );
      res.status(200).json({ data: { entityId, screenings } });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("compliance_status_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "STATUS_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/evaluate — Evaluate compliance for entity
// ---------------------------------------------------------------------------
router.post(
  "/evaluate",
  validate(ComplianceEvaluationRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const results = await jurisdictionEngine.evaluateCompliance(req.body);
      res
        .status(200)
        .json({ data: results, message: "Compliance evaluation completed" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("compliance_evaluation_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "EVALUATION_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report — Generate regulatory report
// ---------------------------------------------------------------------------
router.post("/report", async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportType } = req.body;
    const parsed = ReportTypeSchema.safeParse(reportType);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid report type", code: "INVALID_REPORT_TYPE" });
      return;
    }

    let report;
    switch (parsed.data) {
      case "SAR":
        report = await regulatoryReportingService.generateSAR(req.body);
        break;
      case "CTR":
        report = await regulatoryReportingService.generateCTR(req.body);
        break;
      case "STR":
        report = await regulatoryReportingService.generateSTR(req.body);
        break;
      case "DSAR":
        report = await regulatoryReportingService.fulfillDSAR(req.body);
        break;
      case "ERASURE":
        report = await regulatoryReportingService.processErasure(req.body);
        break;
      case "AUDIT":
        report = await regulatoryReportingService.generateAuditPackage(
          req.body.jurisdiction ?? "all",
          req.body.dateRange ?? {
            start: new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            end: new Date().toISOString(),
          },
        );
        break;
      case "DASHBOARD":
        const dashboard = regulatoryReportingService.getDashboardData();
        res.status(200).json({ data: dashboard });
        return;
      default:
        res.status(400).json({
          error: "Unsupported report type",
          code: "UNSUPPORTED_REPORT_TYPE",
        });
        return;
    }

    res
      .status(201)
      .json({ data: report, message: `${parsed.data} report generated` });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error("report_generation_error", { error: error.message });
    res
      .status(error.statusCode ?? 500)
      .json({ error: error.message, code: error.code ?? "REPORT_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/report/:reportId/submit — Submit report
// ---------------------------------------------------------------------------
router.post(
  "/report/:reportId/submit",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await regulatoryReportingService.submitReport(
        req.params.reportId as string,
      );
      res.status(200).json({
        data: result,
        message: "Report submitted to regulatory authority",
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("report_submit_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "SUBMIT_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/report/:reportId/export — Export report
// ---------------------------------------------------------------------------
router.get(
  "/report/:reportId/export",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const fmt = ExportFormatSchema.safeParse(req.query.format ?? "json");
      if (!fmt.success) {
        res
          .status(400)
          .json({ error: "Invalid export format", code: "INVALID_FORMAT" });
        return;
      }
      const exported = await regulatoryReportingService.exportReport(
        req.params.reportId as string,
        fmt.data,
      );
      res.setHeader("Content-Type", exported.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exported.filename}"`,
      );
      res.status(200).send(exported.data);
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("report_export_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "EXPORT_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /enterprise/compliance/jurisdictions — List supported jurisdictions
// ---------------------------------------------------------------------------
router.get("/jurisdictions", (_req: Request, res: Response): void => {
  try {
    const jurisdictions = jurisdictionEngine.listJurisdictions();
    res.status(200).json({ data: jurisdictions });
  } catch (err) {
    const error = err as Error;
    logger.error("jurisdictions_list_error", { error: error.message });
    res.status(500).json({ error: error.message, code: "JURISDICTION_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/cross-border — Cross-border transfer assessment
// ---------------------------------------------------------------------------
router.post(
  "/cross-border",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Compliance cross-border assessment (jurisdiction level)
      const jurisdictionAssessment = CrossBorderAssessmentSchema.safeParse(
        req.body,
      );
      if (jurisdictionAssessment.success) {
        const result = jurisdictionEngine.assessCrossBorder(
          jurisdictionAssessment.data,
        );
        res
          .status(200)
          .json({ data: result, message: "Cross-border assessment completed" });
        return;
      }

      // Data sovereignty cross-border assessment
      const transferAssessment = CrossBorderTransferSchema.safeParse(req.body);
      if (transferAssessment.success) {
        const result = dataSovereigntyService.assessCrossBorderTransfer(
          transferAssessment.data,
        );
        res.status(200).json({
          data: result,
          message: "Data transfer assessment completed",
        });
        return;
      }

      res.status(400).json({
        error: "Invalid request body",
        code: "VALIDATION_ERROR",
        details: jurisdictionAssessment.error.flatten(),
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("cross_border_error", { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? "CROSS_BORDER_ERROR",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/dsar — Data subject access request
// ---------------------------------------------------------------------------
router.post("/dsar", async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestType } = req.body;

    if (requestType === "erasure" || req.body.reportType === "ERASURE") {
      const report = await regulatoryReportingService.processErasure({
        ...req.body,
        reportType: "ERASURE",
      });
      res
        .status(200)
        .json({ data: report, message: "Erasure request processed" });
      return;
    }

    const report = await regulatoryReportingService.fulfillDSAR({
      ...req.body,
      reportType: "DSAR",
    });
    res.status(200).json({ data: report, message: "DSAR fulfilled" });
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    logger.error("dsar_error", { error: error.message });
    res
      .status(error.statusCode ?? 500)
      .json({ error: error.message, code: error.code ?? "DSAR_ERROR" });
  }
});

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/consent — Record consent
// ---------------------------------------------------------------------------
router.post(
  "/consent",
  validate(ConsentRecordSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = dataSovereigntyService.recordConsent(req.body);
      res.status(201).json({ data: result, message: "Consent recorded" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("consent_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "CONSENT_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/pia — Privacy impact assessment
// ---------------------------------------------------------------------------
router.post(
  "/pia",
  validate(PIASchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = dataSovereigntyService.conductPIA(req.body);
      res
        .status(200)
        .json({ data: result, message: "Privacy impact assessment completed" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("pia_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "PIA_ERROR" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /enterprise/compliance/breach — Breach notification
// ---------------------------------------------------------------------------
router.post(
  "/breach",
  validate(BreachNotificationSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const timeline = dataSovereigntyService.initiateBreachNotification(
        req.body,
      );
      res.status(201).json({
        data: timeline,
        message: "Breach notification workflow initiated",
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("breach_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code ?? "BREACH_ERROR" });
    }
  },
);

export default router;
