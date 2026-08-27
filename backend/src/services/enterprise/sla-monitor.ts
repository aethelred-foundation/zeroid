import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isProductionRuntime } from '../production-safety';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'sla-monitor' },
  transports: [new transports.Console()],
});

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const ServiceComponentSchema = z.enum([
  'api_gateway',
  'credential_service',
  'verification_service',
  'proof_generation',
  'tee_nodes',
  'identity_service',
  'compliance_engine',
  'webhook_delivery',
  'oidc_bridge',
  'sanctions_screening',
]);

export type ServiceComponent = z.infer<typeof ServiceComponentSchema>;

const SLAComponentDefinitionSchema = z.object({
  component: ServiceComponentSchema,
  uptimeTarget: z.number().min(90).max(100),
  latencyP50Ms: z.number().int().positive(),
  latencyP95Ms: z.number().int().positive(),
  latencyP99Ms: z.number().int().positive(),
  errorRateTarget: z.number().min(0).max(10),
}).strict().refine(
  ({ latencyP50Ms, latencyP95Ms, latencyP99Ms }) => (
    latencyP50Ms <= latencyP95Ms && latencyP95Ms <= latencyP99Ms
  ),
  {
    message: 'Latency targets must be ordered p50 <= p95 <= p99',
    path: ['latencyP95Ms'],
  },
);

export const SLADefinitionSchema = z.object({
  clientId: z.string().trim().min(1).max(160),
  tier: z.enum(['standard', 'professional', 'enterprise']),
  components: z.array(SLAComponentDefinitionSchema).min(1),
  creditPercentages: z.object({
      tier1: z.number().min(0).max(100),
      tier2: z.number().min(0).max(100),
      tier3: z.number().min(0).max(100),
    })
    .strict()
    .refine(
      ({ tier1, tier2, tier3 }) => tier1 <= tier2 && tier2 <= tier3,
      { message: 'Credit tiers must be ordered tier1 <= tier2 <= tier3' },
    ),
  reportingIntervalDays: z.number().int().min(1).max(366),
}).strict().refine(
  ({ components }) => (
    new Set(components.map(({ component }) => component)).size === components.length
  ),
  { message: 'Each SLA component may be configured only once', path: ['components'] },
);

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
  violationType: 'uptime' | 'latency_p50' | 'latency_p95' | 'latency_p99' | 'error_rate' | 'proof_generation';
  target: number;
  actual: number;
  detectedAt: string;
  periodStart: string;
  periodEnd: string;
  creditPercentage: number;
  acknowledged: boolean;
}

interface SLAAlert {
  id: string;
  clientId: string;
  message: string;
  severity: string;
  timestamp: string;
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

interface LatencySummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  count: number;
  errorRate: number | null;
}

interface UptimeSummary {
  uptimePercentage: number | null;
  totalChecks: number;
  downChecks: number;
}

interface SLAMonitorSnapshot {
  version: 1;
  savedAt: string;
  slaDefinitions: Array<[string, SLADefinition]>;
  latencyBuckets: LatencyBucket[];
  uptimeRecords: UptimeRecord[];
  violations: SLAViolation[];
  alerts: SLAAlert[];
}

export interface SLAMonitorOptions {
  storeFile?: string;
}

// ---------------------------------------------------------------------------
// SLAMonitor
// ---------------------------------------------------------------------------
export class SLAMonitor {
  private slaDefinitions: Map<string, SLADefinition> = new Map();
  private latencyBuckets: LatencyBucket[] = [];
  private uptimeRecords: UptimeRecord[] = [];
  private violations: SLAViolation[] = [];
  private alerts: SLAAlert[] = [];
  private readonly storeFile?: string;

  private readonly maxBuckets = 1_000_000;
  private readonly maxUptimeRecords = 100_000;

  constructor(options: SLAMonitorOptions = {}) {
    const configuredStoreFile = options.storeFile ?? process.env.SLA_MONITOR_STORE_FILE;
    this.storeFile = configuredStoreFile?.trim() || undefined;
    this.initializeStore();
    logger.info('SLAMonitor initialized', {
      durableStoreConfigured: Boolean(this.storeFile),
    });
  }

  // -------------------------------------------------------------------------
  // Register SLA definition
  // -------------------------------------------------------------------------
  registerSLA(definition: SLADefinition): void {
    this.refreshStateFromStore();
    this.assertStoreAvailable();
    const parsed = SLADefinitionSchema.parse(definition);
    this.slaDefinitions.set(parsed.clientId, parsed);
    this.persistState();
    logger.info('sla_registered', { clientId: parsed.clientId, tier: parsed.tier, components: parsed.components.length });
  }

  getSLA(clientId: string): SLADefinition | null {
    this.refreshStateFromStore();
    return this.slaDefinitions.get(clientId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Record metrics
  // -------------------------------------------------------------------------
  recordLatency(component: ServiceComponent, latencyMs: number, success: boolean): void {
    this.refreshStateFromStore();
    this.assertStoreAvailable();
    this.assertMetricSample(component, latencyMs, success);
    this.latencyBuckets.push({
      timestamp: Date.now(),
      component,
      latencyMs,
      success,
    });

    if (this.latencyBuckets.length > this.maxBuckets) {
      this.latencyBuckets = this.latencyBuckets.slice(-Math.floor(this.maxBuckets / 2));
    }
    this.persistState();
  }

  recordUptime(component: ServiceComponent, available: boolean, responseTimeMs: number): void {
    this.refreshStateFromStore();
    this.assertStoreAvailable();
    this.assertMetricSample(component, responseTimeMs, available);
    this.uptimeRecords.push({
      component,
      checkTimestamp: Date.now(),
      available,
      responseTimeMs,
    });

    if (this.uptimeRecords.length > this.maxUptimeRecords) {
      this.uptimeRecords = this.uptimeRecords.slice(-Math.floor(this.maxUptimeRecords / 2));
    }

    // Check all SLAs for this component
    if (!available) {
      for (const [clientId, sla] of this.slaDefinitions) {
        const compDef = sla.components.find((c) => c.component === component);
        if (compDef) {
          this.emitAlert(clientId, `${component} is unavailable`, 'critical');
        }
      }
    }
    this.persistState();
  }

  // -------------------------------------------------------------------------
  // Calculate percentiles
  // -------------------------------------------------------------------------
  getLatencyPercentiles(component: ServiceComponent, windowMs: number): LatencySummary {
    this.refreshStateFromStore();
    const cutoff = Date.now() - windowMs;
    const buckets = this.latencyBuckets.filter(
      (b) => b.component === component && b.timestamp >= cutoff,
    );

    if (buckets.length === 0) {
      return { p50: null, p95: null, p99: null, count: 0, errorRate: null };
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
  getUptime(component: ServiceComponent, windowMs: number): UptimeSummary {
    this.refreshStateFromStore();
    const cutoff = Date.now() - windowMs;
    const records = this.uptimeRecords.filter(
      (r) => r.component === component && r.checkTimestamp >= cutoff,
    );

    if (records.length === 0) {
      return { uptimePercentage: null, totalChecks: 0, downChecks: 0 };
    }

    const downChecks = records.filter((r) => !r.available).length;
    const uptimePercentage = Math.round(((records.length - downChecks) / records.length) * 10000) / 100;

    return { uptimePercentage, totalChecks: records.length, downChecks };
  }

  // -------------------------------------------------------------------------
  // Evaluate SLA compliance
  // -------------------------------------------------------------------------
  evaluateSLA(_clientId: string, _periodMs?: number): SLAViolation[] {
    return this.authoritativeTelemetryUnavailable();
  }

  // -------------------------------------------------------------------------
  // Generate SLA report
  // -------------------------------------------------------------------------
  generateReport(_clientId: string, _periodDays?: number): SLAReport {
    return this.authoritativeTelemetryUnavailable();
  }

  // -------------------------------------------------------------------------
  // Get violations
  // -------------------------------------------------------------------------
  getViolations(_clientId: string, _since?: string): SLAViolation[] {
    return this.authoritativeTelemetryUnavailable();
  }

  acknowledgeViolation(violationId: string): boolean {
    this.refreshStateFromStore();
    this.assertStoreAvailable();
    const violation = this.violations.find((v) => v.id === violationId);
    if (!violation) return false;
    violation.acknowledged = true;
    this.persistState();
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
    logger.warn('sla_alert', alert);
  }

  getAlerts(_clientId: string, _limit = 50): typeof this.alerts {
    return this.authoritativeTelemetryUnavailable();
  }

  private initializeStore(): void {
    if (!this.storeFile) return;

    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true, mode: 0o700 });
      this.refreshStateFromStore();
    } catch (error) {
      throw new SLAMonitorError(
        `Durable SLA monitor store could not be initialized: ${(error as Error).message}`,
        'SLA_MONITOR_STORE_INITIALIZATION_FAILED',
        503,
      );
    }
  }

  private assertStoreAvailable(): void {
    if (!isProductionRuntime() || this.storeFile) return;

    throw new SLAMonitorError(
      'Durable SLA monitor store is required in production',
      'SLA_MONITOR_STORE_REQUIRED',
      503,
    );
  }

  private authoritativeTelemetryUnavailable(): never {
    throw new SLAMonitorError(
      'SLA evidence is unavailable until an instrumented durable telemetry adapter is deployed',
      'SLA_AUTHORITATIVE_TELEMETRY_UNAVAILABLE',
      503,
    );
  }

  private assertMetricSample(
    component: ServiceComponent,
    durationMs: number,
    outcome: boolean,
  ): void {
    if (
      !ServiceComponentSchema.safeParse(component).success
      || !Number.isFinite(durationMs)
      || durationMs < 0
      || typeof outcome !== 'boolean'
    ) {
      throw new SLAMonitorError(
        'SLA metric sample is invalid',
        'SLA_METRIC_SAMPLE_INVALID',
        400,
      );
    }
  }

  private persistState(): void {
    this.assertStoreAvailable();
    if (!this.storeFile) return;

    const snapshot: SLAMonitorSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      slaDefinitions: Array.from(this.slaDefinitions.entries()),
      latencyBuckets: [...this.latencyBuckets],
      uptimeRecords: [...this.uptimeRecords],
      violations: [...this.violations],
      alerts: [...this.alerts],
    };
    const tempFile = `${this.storeFile}.${process.pid}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempFile, this.storeFile);
    } catch (error) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw new SLAMonitorError(
        `Durable SLA monitor store could not be written: ${(error as Error).message}`,
        'SLA_MONITOR_STORE_WRITE_FAILED',
        503,
      );
    }
  }

  private refreshStateFromStore(): void {
    if (!this.storeFile || !fs.existsSync(this.storeFile)) return;

    try {
      const snapshot = JSON.parse(fs.readFileSync(this.storeFile, 'utf8')) as Partial<SLAMonitorSnapshot>;
      if (snapshot.version !== 1) {
        throw new Error(`unsupported snapshot version: ${String(snapshot.version)}`);
      }

      this.slaDefinitions = new Map(snapshot.slaDefinitions ?? []);
      this.latencyBuckets = [...(snapshot.latencyBuckets ?? [])];
      this.uptimeRecords = [...(snapshot.uptimeRecords ?? [])];
      this.violations = [...(snapshot.violations ?? [])];
      this.alerts = [...(snapshot.alerts ?? [])];
    } catch (error) {
      logger.error('sla_monitor_store_load_failed', {
        storeFile: this.storeFile,
        error: (error as Error).message,
      });

      throw new SLAMonitorError(
        `Durable SLA monitor store could not be loaded: ${(error as Error).message}`,
        'SLA_MONITOR_STORE_READ_FAILED',
        503,
      );
    }
  }
}

export class SLAMonitorError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'SLAMonitorError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const slaMonitor = new SLAMonitor();
