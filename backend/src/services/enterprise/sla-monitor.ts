import { z } from "zod";
import { createLogger, format, transports } from "winston";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "sla-monitor" },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const ServiceComponentSchema = z.enum([
  "api_gateway",
  "credential_service",
  "verification_service",
  "proof_generation",
  "tee_nodes",
  "identity_service",
  "compliance_engine",
  "webhook_delivery",
  "oidc_bridge",
  "sanctions_screening",
]);

export type ServiceComponent = z.infer<typeof ServiceComponentSchema>;

export const SLADefinitionSchema = z.object({
  clientId: z.string(),
  tier: z.enum(["standard", "professional", "enterprise"]),
  components: z.array(
    z.object({
      component: ServiceComponentSchema,
      uptimeTarget: z.number().min(90).max(100).default(99.9),
      latencyP50Ms: z.number().int().positive(),
      latencyP95Ms: z.number().int().positive(),
      latencyP99Ms: z.number().int().positive(),
      errorRateTarget: z.number().min(0).max(10).default(0.1),
      proofGenerationTimeMs: z.number().int().positive().optional(),
    }),
  ),
  creditPercentages: z
    .object({
      tier1: z.number().default(10),
      tier2: z.number().default(25),
      tier3: z.number().default(50),
    })
    .default({}),
  reportingIntervalDays: z.number().int().positive().default(30),
});

export type SLADefinition = z.infer<typeof SLADefinitionSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LatencyBucket {
  timestamp: number;
  component: ServiceComponent;
  latencyMs: number;
  success: boolean;
}

interface UptimeRecord {
  component: ServiceComponent;
  checkTimestamp: number;
  available: boolean;
  responseTimeMs: number;
}

interface SLAViolation {
  id: string;
  clientId: string;
  component: ServiceComponent;
  violationType:
    | "uptime"
    | "latency_p50"
    | "latency_p95"
    | "latency_p99"
    | "error_rate"
    | "proof_generation";
  target: number;
  actual: number;
  detectedAt: string;
  periodStart: string;
  periodEnd: string;
  creditPercentage: number;
  acknowledged: boolean;
}

export interface SLAReport {
  reportId: string;
  clientId: string;
  tier: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  components: Array<{
    component: ServiceComponent;
    uptimeTarget: number;
    uptimeActual: number;
    uptimeMet: boolean;
    latencyP50Actual: number;
    latencyP50Target: number;
    latencyP95Actual: number;
    latencyP95Target: number;
    latencyP99Actual: number;
    latencyP99Target: number;
    errorRateActual: number;
    errorRateTarget: number;
    totalRequests: number;
    totalErrors: number;
  }>;
  violations: SLAViolation[];
  totalCredit: number;
  overallCompliance: boolean;
}

// ---------------------------------------------------------------------------
// SLAMonitor
// ---------------------------------------------------------------------------
export class SLAMonitor {
  private slaDefinitions: Map<string, SLADefinition> = new Map();
  private latencyBuckets: LatencyBucket[] = [];
  private uptimeRecords: UptimeRecord[] = [];
  private violations: SLAViolation[] = [];
  private alerts: Array<{
    id: string;
    clientId: string;
    message: string;
    severity: string;
    timestamp: string;
  }> = [];

  private readonly maxBuckets = 1_000_000;
  private readonly maxUptimeRecords = 100_000;

  constructor() {
    logger.info("SLAMonitor initialized");
  }

  // -------------------------------------------------------------------------
  // Register SLA definition
  // -------------------------------------------------------------------------
  registerSLA(definition: SLADefinition): void {
    const parsed = SLADefinitionSchema.parse(definition);
    this.slaDefinitions.set(parsed.clientId, parsed);
    logger.info("sla_registered", {
      clientId: parsed.clientId,
      tier: parsed.tier,
      components: parsed.components.length,
    });
  }

  getSLA(clientId: string): SLADefinition | null {
    return this.slaDefinitions.get(clientId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Record metrics
  // -------------------------------------------------------------------------
  recordLatency(
    component: ServiceComponent,
    latencyMs: number,
    success: boolean,
  ): void {
    this.latencyBuckets.push({
      timestamp: Date.now(),
      component,
      latencyMs,
      success,
    });

    if (this.latencyBuckets.length > this.maxBuckets) {
      this.latencyBuckets = this.latencyBuckets.slice(
        -Math.floor(this.maxBuckets / 2),
      );
    }
  }

  recordUptime(
    component: ServiceComponent,
    available: boolean,
    responseTimeMs: number,
  ): void {
    this.uptimeRecords.push({
      component,
      checkTimestamp: Date.now(),
      available,
      responseTimeMs,
    });

    if (this.uptimeRecords.length > this.maxUptimeRecords) {
      this.uptimeRecords = this.uptimeRecords.slice(
        -Math.floor(this.maxUptimeRecords / 2),
      );
    }

    // Check all SLAs for this component
    if (!available) {
      for (const [clientId, sla] of this.slaDefinitions) {
        const compDef = sla.components.find((c) => c.component === component);
        if (compDef) {
          this.emitAlert(clientId, `${component} is unavailable`, "critical");
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Calculate percentiles
  // -------------------------------------------------------------------------
  getLatencyPercentiles(
    component: ServiceComponent,
    windowMs: number,
  ): {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    errorRate: number;
  } {
    const cutoff = Date.now() - windowMs;
    const buckets = this.latencyBuckets.filter(
      (b) => b.component === component && b.timestamp >= cutoff,
    );

    if (buckets.length === 0) {
      return { p50: 0, p95: 0, p99: 0, count: 0, errorRate: 0 };
    }

    const latencies = buckets.map((b) => b.latencyMs).sort((a, b) => a - b);
    const errors = buckets.filter((b) => !b.success).length;

    return {
      p50: this.percentile(latencies, 50),
      p95: this.percentile(latencies, 95),
      p99: this.percentile(latencies, 99),
      count: buckets.length,
      errorRate: Math.round((errors / buckets.length) * 10000) / 100,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  // -------------------------------------------------------------------------
  // Calculate uptime
  // -------------------------------------------------------------------------
  getUptime(
    component: ServiceComponent,
    windowMs: number,
  ): { uptimePercentage: number; totalChecks: number; downChecks: number } {
    const cutoff = Date.now() - windowMs;
    const records = this.uptimeRecords.filter(
      (r) => r.component === component && r.checkTimestamp >= cutoff,
    );

    if (records.length === 0) {
      return { uptimePercentage: 100, totalChecks: 0, downChecks: 0 };
    }

    const downChecks = records.filter((r) => !r.available).length;
    const uptimePercentage =
      Math.round(((records.length - downChecks) / records.length) * 10000) /
      100;

    return { uptimePercentage, totalChecks: records.length, downChecks };
  }

  // -------------------------------------------------------------------------
  // Evaluate SLA compliance
  // -------------------------------------------------------------------------
  evaluateSLA(clientId: string, periodMs?: number): SLAViolation[] {
    const sla = this.slaDefinitions.get(clientId);
    if (!sla) return [];

    const window = periodMs ?? sla.reportingIntervalDays * 24 * 60 * 60 * 1000;
    const now = new Date();
    const periodStart = new Date(now.getTime() - window);
    const newViolations: SLAViolation[] = [];

    for (const compDef of sla.components) {
      const uptime = this.getUptime(compDef.component, window);
      const latency = this.getLatencyPercentiles(compDef.component, window);

      // Uptime violation
      if (uptime.uptimePercentage < compDef.uptimeTarget) {
        newViolations.push(
          this.createViolation(
            clientId,
            compDef.component,
            "uptime",
            compDef.uptimeTarget,
            uptime.uptimePercentage,
            periodStart,
            now,
            sla,
          ),
        );
      }

      // Latency violations
      if (latency.p50 > compDef.latencyP50Ms && latency.count > 0) {
        newViolations.push(
          this.createViolation(
            clientId,
            compDef.component,
            "latency_p50",
            compDef.latencyP50Ms,
            latency.p50,
            periodStart,
            now,
            sla,
          ),
        );
      }
      if (latency.p95 > compDef.latencyP95Ms && latency.count > 0) {
        newViolations.push(
          this.createViolation(
            clientId,
            compDef.component,
            "latency_p95",
            compDef.latencyP95Ms,
            latency.p95,
            periodStart,
            now,
            sla,
          ),
        );
      }
      if (latency.p99 > compDef.latencyP99Ms && latency.count > 0) {
        newViolations.push(
          this.createViolation(
            clientId,
            compDef.component,
            "latency_p99",
            compDef.latencyP99Ms,
            latency.p99,
            periodStart,
            now,
            sla,
          ),
        );
      }

      // Error rate violation
      if (latency.errorRate > compDef.errorRateTarget && latency.count > 0) {
        newViolations.push(
          this.createViolation(
            clientId,
            compDef.component,
            "error_rate",
            compDef.errorRateTarget,
            latency.errorRate,
            periodStart,
            now,
            sla,
          ),
        );
      }
    }

    this.violations.push(...newViolations);
    for (const v of newViolations) {
      this.emitAlert(
        clientId,
        `SLA violation: ${v.component} ${v.violationType} (target: ${v.target}, actual: ${v.actual})`,
        "high",
      );
    }

    return newViolations;
  }

  private createViolation(
    clientId: string,
    component: ServiceComponent,
    violationType: SLAViolation["violationType"],
    target: number,
    actual: number,
    periodStart: Date,
    periodEnd: Date,
    sla: SLADefinition,
  ): SLAViolation {
    // Determine credit tier based on severity
    const deviation = Math.abs(target - actual) / target;
    let creditPercentage = sla.creditPercentages.tier1;
    if (deviation > 0.1) creditPercentage = sla.creditPercentages.tier2;
    if (deviation > 0.25) creditPercentage = sla.creditPercentages.tier3;

    return {
      id: crypto.randomUUID(),
      clientId,
      component,
      violationType,
      target,
      actual: Math.round(actual * 100) / 100,
      detectedAt: new Date().toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      creditPercentage,
      acknowledged: false,
    };
  }

  // -------------------------------------------------------------------------
  // Generate SLA report
  // -------------------------------------------------------------------------
  generateReport(clientId: string, periodDays?: number): SLAReport {
    const sla = this.slaDefinitions.get(clientId);
    if (!sla) {
      throw new Error(`No SLA definition for client: ${clientId}`);
    }

    const days = periodDays ?? sla.reportingIntervalDays;
    const windowMs = days * 24 * 60 * 60 * 1000;
    const now = new Date();
    const periodStart = new Date(now.getTime() - windowMs);

    const components = sla.components.map((compDef) => {
      const uptime = this.getUptime(compDef.component, windowMs);
      const latency = this.getLatencyPercentiles(compDef.component, windowMs);

      return {
        component: compDef.component,
        uptimeTarget: compDef.uptimeTarget,
        uptimeActual: uptime.uptimePercentage,
        uptimeMet: uptime.uptimePercentage >= compDef.uptimeTarget,
        latencyP50Actual: latency.p50,
        latencyP50Target: compDef.latencyP50Ms,
        latencyP95Actual: latency.p95,
        latencyP95Target: compDef.latencyP95Ms,
        latencyP99Actual: latency.p99,
        latencyP99Target: compDef.latencyP99Ms,
        errorRateActual: latency.errorRate,
        errorRateTarget: compDef.errorRateTarget,
        totalRequests: latency.count,
        totalErrors: Math.round((latency.count * latency.errorRate) / 100),
      };
    });

    const periodViolations = this.violations.filter(
      (v) => v.clientId === clientId && new Date(v.detectedAt) >= periodStart,
    );

    const totalCredit = periodViolations.reduce(
      (sum, v) => sum + v.creditPercentage,
      0,
    );
    const overallCompliance = periodViolations.length === 0;

    const report: SLAReport = {
      reportId: crypto.randomUUID(),
      clientId,
      tier: sla.tier,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
      generatedAt: now.toISOString(),
      components,
      violations: periodViolations,
      totalCredit: Math.min(totalCredit, 100),
      overallCompliance,
    };

    logger.info("sla_report_generated", {
      reportId: report.reportId,
      clientId,
      compliance: overallCompliance,
      violations: periodViolations.length,
      credit: report.totalCredit,
    });

    return report;
  }

  // -------------------------------------------------------------------------
  // Get violations
  // -------------------------------------------------------------------------
  getViolations(clientId: string, since?: string): SLAViolation[] {
    let violations = this.violations.filter((v) => v.clientId === clientId);
    if (since) {
      const sinceDate = new Date(since);
      violations = violations.filter(
        (v) => new Date(v.detectedAt) >= sinceDate,
      );
    }
    return violations;
  }

  acknowledgeViolation(violationId: string): boolean {
    const violation = this.violations.find((v) => v.id === violationId);
    if (!violation) return false;
    violation.acknowledged = true;
    return true;
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------
  private emitAlert(clientId: string, message: string, severity: string): void {
    const alert = {
      id: crypto.randomUUID(),
      clientId,
      message,
      severity,
      timestamp: new Date().toISOString(),
    };
    this.alerts.push(alert);
    if (this.alerts.length > 10000) this.alerts = this.alerts.slice(-5000);
    logger.warn("sla_alert", alert);
  }

  getAlerts(clientId: string, limit = 50): typeof this.alerts {
    return this.alerts
      .filter((a) => a.clientId === clientId)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const slaMonitor = new SLAMonitor();
