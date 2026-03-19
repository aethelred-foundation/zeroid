"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Download,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type SLAStatus = "met" | "at_risk" | "violated";

interface LatencyDataPoint {
  timestamp: string;
  p50: number;
  p95: number;
  p99: number;
}

interface ErrorRatePoint {
  timestamp: string;
  rate: number;
}

interface SLAMetric {
  name: string;
  target: string;
  current: string;
  status: SLAStatus;
  trend: "up" | "down" | "stable";
}

interface SLAViolation {
  id: string;
  metric: string;
  timestamp: string;
  duration: string;
  impact: string;
  credit: string;
  resolved: boolean;
}

interface ServiceComponent {
  name: string;
  uptime: number;
  status: "operational" | "degraded" | "outage";
}

interface SLADashboardProps {
  uptime?: number;
  latencyData?: LatencyDataPoint[];
  errorRateData?: ErrorRatePoint[];
  metrics?: SLAMetric[];
  violations?: SLAViolation[];
  components?: ServiceComponent[];
  loading?: boolean;
  error?: string | null;
  onDownloadReport?: () => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SLA_STATUS_CONFIG: Record<
  SLAStatus,
  { label: string; color: string; bg: string; icon: typeof Shield }
> = {
  met: {
    label: "Met",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    icon: ShieldCheck,
  },
  at_risk: {
    label: "At Risk",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    icon: AlertTriangle,
  },
  violated: {
    label: "Violated",
    color: "text-red-400",
    bg: "bg-red-500/10",
    icon: ShieldAlert,
  },
};

const COMPONENT_STATUS: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  operational: {
    label: "Operational",
    color: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  degraded: { label: "Degraded", color: "text-amber-400", dot: "bg-amber-400" },
  outage: { label: "Outage", color: "text-red-400", dot: "bg-red-400" },
};

const DEFAULT_UPTIME = 99.97;

const DEFAULT_LATENCY: LatencyDataPoint[] = Array.from(
  { length: 24 },
  (_, i) => ({
    timestamp: `${String(i).padStart(2, "0")}:00`,
    p50: 25 + Math.random() * 15,
    p95: 80 + Math.random() * 40,
    p99: 150 + Math.random() * 80,
  }),
);

const DEFAULT_ERROR_RATE: ErrorRatePoint[] = Array.from(
  { length: 24 },
  (_, i) => ({
    timestamp: `${String(i).padStart(2, "0")}:00`,
    rate: Math.random() * 0.5,
  }),
);

const DEFAULT_METRICS: SLAMetric[] = [
  {
    name: "Uptime",
    target: "99.95%",
    current: "99.97%",
    status: "met",
    trend: "up",
  },
  {
    name: "API Latency (P95)",
    target: "<200ms",
    current: "142ms",
    status: "met",
    trend: "down",
  },
  {
    name: "Error Rate",
    target: "<0.1%",
    current: "0.03%",
    status: "met",
    trend: "stable",
  },
  {
    name: "Proof Generation",
    target: "<5s",
    current: "3.2s",
    status: "met",
    trend: "down",
  },
  {
    name: "TEE Attestation",
    target: "<2s",
    current: "1.8s",
    status: "at_risk",
    trend: "up",
  },
  {
    name: "Webhook Delivery",
    target: "<30s",
    current: "12s",
    status: "met",
    trend: "stable",
  },
];

const DEFAULT_VIOLATIONS: SLAViolation[] = [
  {
    id: "v1",
    metric: "API Latency",
    timestamp: "2026-02-28T14:22:00Z",
    duration: "12 minutes",
    impact: "0.08% of requests affected",
    credit: "$120",
    resolved: true,
  },
  {
    id: "v2",
    metric: "Uptime",
    timestamp: "2026-01-15T03:45:00Z",
    duration: "4 minutes",
    impact: "Full service disruption",
    credit: "$450",
    resolved: true,
  },
];

const DEFAULT_COMPONENTS: ServiceComponent[] = [
  { name: "Identity Service", uptime: 99.99, status: "operational" },
  { name: "Credential Issuance", uptime: 99.98, status: "operational" },
  { name: "ZK Proof Engine", uptime: 99.95, status: "operational" },
  { name: "TEE Network", uptime: 99.92, status: "degraded" },
  { name: "Webhook Delivery", uptime: 99.97, status: "operational" },
  { name: "API Gateway", uptime: 99.99, status: "operational" },
];

// ============================================================================
// Sub-components
// ============================================================================

function UptimeGauge({ value, size }: { value: number; size: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;
  const color =
    value >= 99.95
      ? "text-emerald-400"
      : value >= 99.5
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-[var(--surface-tertiary)]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          className={color}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={`text-2xl font-bold ${color}`}>{value}%</p>
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
          Uptime
        </p>
      </div>
    </div>
  );
}

function MiniChart({
  data,
  color,
  height,
}: {
  data: number[];
  color: string;
  height: number;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = height - ((v - min) / range) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function SLADashboard({
  uptime = DEFAULT_UPTIME,
  latencyData = DEFAULT_LATENCY,
  errorRateData = DEFAULT_ERROR_RATE,
  metrics = DEFAULT_METRICS,
  violations = DEFAULT_VIOLATIONS,
  components = DEFAULT_COMPONENTS,
  loading = false,
  error = null,
  onDownloadReport,
  className = "",
}: SLADashboardProps) {
  const totalCredits = useMemo(
    () =>
      violations.reduce(
        (sum, v) => sum + parseFloat(v.credit.replace("$", "")),
        0,
      ),
    [violations],
  );

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading SLA dashboard...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            SLA Dashboard
          </h3>
        </div>
        {onDownloadReport && (
          <button
            onClick={onDownloadReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Monthly Report
          </button>
        )}
      </div>

      {/* Top row: Uptime gauge + latency + error rate */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
        {/* Uptime */}
        <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-[var(--surface-secondary)]">
          <UptimeGauge value={uptime} size={140} />
          <p className="text-xs text-[var(--text-secondary)] mt-2">
            30-day rolling uptime
          </p>
        </div>

        {/* Latency chart */}
        <div className="p-4 rounded-xl bg-[var(--surface-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-medium text-[var(--text-primary)]">
              Latency (24h)
            </h4>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 bg-emerald-400 rounded" /> P50
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 bg-amber-400 rounded" /> P95
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 bg-red-400 rounded" /> P99
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <MiniChart
              data={latencyData.map((d) => d.p99)}
              color="#ef4444"
              height={20}
            />
            <MiniChart
              data={latencyData.map((d) => d.p95)}
              color="#f59e0b"
              height={20}
            />
            <MiniChart
              data={latencyData.map((d) => d.p50)}
              color="#10b981"
              height={20}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
            <span>
              P50: {Math.round(latencyData[latencyData.length - 1]?.p50 ?? 0)}ms
            </span>
            <span>
              P95: {Math.round(latencyData[latencyData.length - 1]?.p95 ?? 0)}ms
            </span>
            <span>
              P99: {Math.round(latencyData[latencyData.length - 1]?.p99 ?? 0)}ms
            </span>
          </div>
        </div>

        {/* Error rate */}
        <div className="p-4 rounded-xl bg-[var(--surface-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-medium text-[var(--text-primary)]">
              Error Rate (24h)
            </h4>
            <span className="text-[10px] text-emerald-400">
              {(errorRateData[errorRateData.length - 1]?.rate ?? 0).toFixed(2)}%
            </span>
          </div>
          <MiniChart
            data={errorRateData.map((d) => d.rate)}
            color="#ef4444"
            height={60}
          />
          <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
            <span>Target: &lt;0.1%</span>
            <span>
              Avg:{" "}
              {(
                errorRateData.reduce((s, d) => s + d.rate, 0) /
                errorRateData.length
              ).toFixed(3)}
              %
            </span>
          </div>
        </div>
      </div>

      {/* SLA metrics table */}
      <div className="px-5 pb-4">
        <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">
          SLA Compliance
        </h4>
        <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
          <div className="grid grid-cols-5 gap-2 px-4 py-2 bg-[var(--surface-secondary)] text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
            <span>Metric</span>
            <span>Target</span>
            <span>Current</span>
            <span>Status</span>
            <span>Trend</span>
          </div>
          {metrics.map((metric, idx) => {
            const statusConfig = SLA_STATUS_CONFIG[metric.status];
            const StatusIcon = statusConfig.icon;
            return (
              <motion.div
                key={metric.name}
                className="grid grid-cols-5 gap-2 px-4 py-3 border-t border-[var(--border-primary)] items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
              >
                <span className="text-xs text-[var(--text-primary)]">
                  {metric.name}
                </span>
                <span className="text-xs text-[var(--text-secondary)] font-mono">
                  {metric.target}
                </span>
                <span className="text-xs text-[var(--text-primary)] font-mono font-medium">
                  {metric.current}
                </span>
                <span
                  className={`flex items-center gap-1 text-[10px] font-medium ${statusConfig.color}`}
                >
                  <StatusIcon className="w-3 h-3" />
                  {statusConfig.label}
                </span>
                <span>
                  {metric.trend === "up" && (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {metric.trend === "down" && (
                    <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {metric.trend === "stable" && (
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      Stable
                    </span>
                  )}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Service components */}
      <div className="px-5 pb-4">
        <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">
          Service Components
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {components.map((comp) => {
            const status = COMPONENT_STATUS[comp.status];
            return (
              <div
                key={comp.name}
                className="p-3 rounded-xl bg-[var(--surface-secondary)]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {comp.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] ${status.color}`}>
                    {status.label}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {comp.uptime}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Violation history */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-medium text-[var(--text-primary)]">
            Violation History
          </h4>
          {totalCredits > 0 && (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
              Total Credits: ${totalCredits.toFixed(0)}
            </span>
          )}
        </div>
        {violations.length === 0 ? (
          <div className="p-4 rounded-xl bg-[var(--surface-secondary)] text-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-xs text-[var(--text-secondary)]">
              No SLA violations recorded
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {violations.map((violation) => (
              <div
                key={violation.id}
                className="p-3 rounded-xl bg-[var(--surface-secondary)] flex items-start gap-3"
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${violation.resolved ? "bg-emerald-500/10" : "bg-red-500/10"}`}
                >
                  {violation.resolved ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {violation.metric}
                    </span>
                    <span className="text-[10px] text-amber-400">
                      {violation.credit}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {violation.impact}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-tertiary)]">
                    <span>
                      {new Date(violation.timestamp).toLocaleDateString()}
                    </span>
                    <span>Duration: {violation.duration}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
