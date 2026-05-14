/**
 * useEnterprise — Hook for enterprise integration management.
 *
 * Provides API key lifecycle, webhook configuration, SLA reporting,
 * and usage metrics. Designed for enterprise customers integrating
 * ZeroID into their existing identity infrastructure.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient, ZeroIDApiError } from "@/lib/api/client";
import type { ISODateString } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface APIKeyConfig {
  name: string;
  scopes: APIScope[];
  environment: "sandbox" | "production";
  expiresInDays?: number;
  ipAllowlist?: string[];
  dailyQuota?: number;
  monthlyQuota?: number;
  rateLimit?: {
    requestsPerSecond?: number;
    burstSize?: number;
  };
  metadata?: Record<string, string>;
}

export interface APIKey {
  id: string;
  clientId?: string;
  name: string;
  keyPrefix: string;
  scopes: APIScope[];
  environment: "sandbox" | "production";
  ipAllowlist: string[];
  dailyQuota: number;
  monthlyQuota: number;
  rateLimit: {
    requestsPerSecond: number;
    burstSize: number;
  };
  createdAt: ISODateString;
  expiresAt?: ISODateString;
  lastUsedAt?: ISODateString | null;
  active: boolean;
  revokedAt?: ISODateString | null;
  revokedReason?: string | null;
  metadata?: Record<string, string>;
}

export interface APIKeyWithSecret extends APIKey {
  /** Full API key — only returned once at creation time */
  secret: string;
}

export type APIScope =
  | "credentials:read"
  | "credentials:write"
  | "verification:read"
  | "verification:write"
  | "identity:read"
  | "identity:write"
  | "compliance:read"
  | "compliance:write"
  | "webhooks:manage"
  | "reports:read"
  | "reports:write"
  | "admin:full";

export interface WebhookConfig {
  url: string;
  events: WebhookEvent[];
  secret?: string;
  description?: string;
  headers?: Record<string, string>;
  active?: boolean;
  enabled?: boolean;
  metadata?: Record<string, string>;
  batchDelivery?: boolean;
  batchIntervalMs?: number;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: ISODateString;
  updatedAt?: ISODateString;
  active: boolean;
  enabled?: boolean;
  health?: {
    status?: string;
    successRate?: number;
    totalDeliveries?: number;
    failedDeliveries?: number;
    lastDeliveryAt?: ISODateString;
  };
  secret?: string;
}

export type WebhookEvent =
  | "credential.issued"
  | "credential.revoked"
  | "credential.expired"
  | "credential.updated"
  | "verification.completed"
  | "verification.failed"
  | "identity.registered"
  | "identity.updated"
  | "identity.deactivated"
  | "compliance.status_changed"
  | "compliance.screening_complete"
  | "compliance.report_generated"
  | "enterprise.api_key_created"
  | "enterprise.api_key_revoked"
  | "enterprise.sla_violation";

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface WebhookTestResult {
  webhookId: string;
  delivered: boolean;
  statusCode: number;
  responseTimeMs: number;
  error?: string;
  testedAt: ISODateString;
}

type BackendCreateAPIKeyResult = {
  apiKey: string;
  apiKeyId: string;
  expiresAt: ISODateString;
};

type BackendAPIAnalytics = {
  totalRequests: number;
  totalErrors: number;
  averageLatencyMs: number;
  endpointBreakdown: Record<
    string,
    { count: number; errors: number; avgLatencyMs: number }
  >;
  dailyUsage: Array<{ date: string; requests: number; errors: number }>;
};

type BackendSLAReport = {
  periodStart: ISODateString;
  periodEnd: ISODateString;
  generatedAt: ISODateString;
  components: Array<{
    component: string;
    uptimeTarget: number;
    uptimeActual: number;
    latencyP99Actual: number;
    totalRequests: number;
    totalErrors: number;
  }>;
  violations: Array<{
    id: string;
    component: string;
    violationType: string;
    detectedAt: ISODateString;
  }>;
  overallCompliance: boolean;
};

export interface SLAReport {
  period: ReportPeriod;
  startDate: ISODateString;
  endDate: ISODateString;
  uptimePercent: number;
  uptimeTarget: number;
  avgResponseTimeMs: number;
  p99ResponseTimeMs: number;
  totalRequests: number;
  failedRequests: number;
  errorRate: number;
  incidentCount: number;
  incidents: SLAIncident[];
  complianceMet: boolean;
}

export interface SLAIncident {
  id: string;
  title: string;
  severity: "minor" | "major" | "critical";
  startedAt: ISODateString;
  resolvedAt?: ISODateString;
  durationMinutes: number;
  affectedServices: string[];
  rootCause?: string;
}

export type ReportPeriod = "day" | "week" | "month" | "quarter" | "year";

export interface UsageMetrics {
  period: ReportPeriod;
  startDate: ISODateString;
  endDate: ISODateString;
  totalAPIRequests: number;
  uniqueIdentities: number;
  credentialsIssued: number;
  credentialsVerified: number;
  proofsGenerated: number;
  agentActions: number;
  bandwidthMB: number;
  costEstimateUSD: number;
  breakdownByEndpoint: EndpointUsage[];
  breakdownByDay: DailyUsage[];
}

export interface EndpointUsage {
  endpoint: string;
  method: string;
  requestCount: number;
  avgResponseTimeMs: number;
  errorCount: number;
}

export interface DailyUsage {
  date: ISODateString;
  requests: number;
  uniqueUsers: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const enterpriseKeys = {
  all: ["enterprise"] as const,
  apiKeys: () => [...enterpriseKeys.all, "api-keys"] as const,
  webhooks: () => [...enterpriseKeys.all, "webhooks"] as const,
  sla: (period: ReportPeriod) =>
    [...enterpriseKeys.all, "sla", period] as const,
  usage: (period: ReportPeriod) =>
    [...enterpriseKeys.all, "usage", period] as const,
};

const periodDays: Record<ReportPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

function normalizeCreatedAPIKey(
  config: APIKeyConfig,
  result: BackendCreateAPIKeyResult,
): APIKeyWithSecret {
  return {
    id: result.apiKeyId,
    name: config.name,
    keyPrefix: result.apiKey.slice(0, 12),
    scopes: config.scopes,
    environment: config.environment,
    ipAllowlist: config.ipAllowlist ?? [],
    dailyQuota: config.dailyQuota ?? 10_000,
    monthlyQuota: config.monthlyQuota ?? 1_000_000,
    rateLimit: {
      requestsPerSecond: config.rateLimit?.requestsPerSecond ?? 100,
      burstSize: config.rateLimit?.burstSize ?? 200,
    },
    createdAt: new Date().toISOString(),
    expiresAt: result.expiresAt,
    lastUsedAt: null,
    active: true,
    revokedAt: null,
    revokedReason: null,
    metadata: config.metadata ?? {},
    secret: result.apiKey,
  };
}

function normalizeSLAReport(
  period: ReportPeriod,
  report: BackendSLAReport,
): SLAReport {
  const components = report.components ?? [];
  const totalRequests = components.reduce(
    (sum, component) => sum + component.totalRequests,
    0,
  );
  const failedRequests = components.reduce(
    (sum, component) => sum + component.totalErrors,
    0,
  );
  const uptimePercent =
    components.length > 0
      ? components.reduce((sum, component) => sum + component.uptimeActual, 0) /
        components.length
      : 0;
  const uptimeTarget =
    components.length > 0
      ? components.reduce((sum, component) => sum + component.uptimeTarget, 0) /
        components.length
      : 99.9;

  return {
    period,
    startDate: report.periodStart,
    endDate: report.periodEnd,
    uptimePercent,
    uptimeTarget,
    avgResponseTimeMs: 0,
    p99ResponseTimeMs: Math.max(
      0,
      ...components.map((component) => component.latencyP99Actual),
    ),
    totalRequests,
    failedRequests,
    errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
    incidentCount: report.violations?.length ?? 0,
    incidents: (report.violations ?? []).map((violation) => ({
      id: violation.id,
      title: `${violation.component} ${violation.violationType}`,
      severity: "major",
      startedAt: violation.detectedAt,
      durationMinutes: 0,
      affectedServices: [violation.component],
    })),
    complianceMet: report.overallCompliance,
  };
}

function normalizeUsageMetrics(
  period: ReportPeriod,
  analytics: BackendAPIAnalytics,
): UsageMetrics {
  const now = new Date();
  const startDate = new Date(
    now.getTime() - periodDays[period] * 24 * 60 * 60 * 1000,
  );

  return {
    period,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    totalAPIRequests: analytics.totalRequests,
    uniqueIdentities: 0,
    credentialsIssued: 0,
    credentialsVerified: 0,
    proofsGenerated: 0,
    agentActions: 0,
    bandwidthMB: 0,
    costEstimateUSD: 0,
    breakdownByEndpoint: Object.entries(analytics.endpointBreakdown ?? {}).map(
      ([endpoint, data]) => {
        const [method = "GET", ...pathParts] = endpoint.split(" ");
        return {
          endpoint: pathParts.join(" ") || endpoint,
          method,
          requestCount: data.count,
          avgResponseTimeMs: data.avgLatencyMs,
          errorCount: data.errors,
        };
      },
    ),
    breakdownByDay: (analytics.dailyUsage ?? []).map((day) => ({
      date: day.date,
      requests: day.requests,
      uniqueUsers: 0,
      errors: day.errors,
    })),
  };
}

function unsupportedEnterpriseFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export function useAPIKeys() {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.apiKeys(),
    queryFn: () =>
      apiClient.get<APIKey[]>(
        "/api/v1/enterprise/api-keys",
      ) as unknown as APIKey[],
    enabled: !!address,
    staleTime: 30_000,
  });
}

export function useCreateAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: APIKeyConfig): Promise<APIKeyWithSecret> => {
      const result = await apiClient.post<BackendCreateAPIKeyResult>(
        "/api/v1/enterprise/api-keys",
        config,
      );
      return normalizeCreatedAPIKey(config, result);
    },
    onSuccess: (data) => {
      toast.success("API key created", {
        description: `"${data.name}" — copy the secret now, it will not be shown again`,
        duration: 10_000,
      });
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.apiKeys() });
    },
    onError: (err: Error) => {
      toast.error("API key creation failed", { description: err.message });
    },
  });
}

export function useRevokeAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keyId: string): Promise<void> => {
      await apiClient.del(`/api/v1/enterprise/api-keys/${keyId}`, {
        reason: "Revoked by client",
      });
    },
    onSuccess: () => {
      toast.success("API key revoked");
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.apiKeys() });
    },
    onError: (err: Error) => {
      toast.error("Key revocation failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export function useWebhooks() {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.webhooks(),
    queryFn: () =>
      apiClient.get<Webhook[]>(
        "/api/v1/enterprise/webhooks",
      ) as unknown as Webhook[],
    enabled: !!address,
    staleTime: 30_000,
  });
}

export function useRegisterWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: WebhookConfig): Promise<Webhook> => {
      return apiClient.post<Webhook>("/api/v1/enterprise/webhooks", {
        url: config.url,
        events: config.events,
        secret: config.secret,
        description: config.description,
        active: config.active ?? config.enabled ?? true,
        metadata: config.metadata ?? {},
        batchDelivery: config.batchDelivery ?? false,
        batchIntervalMs: config.batchIntervalMs ?? 5_000,
        headers: config.headers ?? {},
      }) as unknown as Webhook;
    },
    onSuccess: (data) => {
      toast.success("Webhook registered", {
        description: `Listening for ${data.events.length} event type(s) at ${data.url}`,
      });
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.webhooks() });
    },
    onError: (err: Error) => {
      toast.error("Webhook registration failed", { description: err.message });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (webhookId: string): Promise<WebhookTestResult> => {
      void webhookId;
      unsupportedEnterpriseFlow(
        "Ad-hoc webhook test delivery is not exposed by the backend API.",
        "ENTERPRISE_WEBHOOK_TEST_UNAVAILABLE",
      );
    },
    onSuccess: (data) => {
      if (data.delivered) {
        toast.success("Webhook test delivered", {
          description: `Status ${data.statusCode}, ${data.responseTimeMs}ms`,
        });
      } else {
        toast.error("Webhook test failed", {
          description: data.error ?? `Status ${data.statusCode}`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Webhook test request failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// SLA Report
// ---------------------------------------------------------------------------

export function useSLAReport(period: ReportPeriod = "month") {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.sla(period),
    queryFn: () =>
      apiClient
        .get<BackendSLAReport>("/api/v1/enterprise/sla/report", {
          period: periodDays[period],
        })
        .then((report) => normalizeSLAReport(period, report)),
    enabled: !!address,
    staleTime: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Usage Metrics
// ---------------------------------------------------------------------------

export function useUsageMetrics(period: ReportPeriod = "month") {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.usage(period),
    queryFn: () =>
      apiClient
        .get<BackendAPIAnalytics>("/api/v1/enterprise/usage", {
          period: periodDays[period],
        })
        .then((analytics) => normalizeUsageMetrics(period, analytics)),
    enabled: !!address,
    staleTime: 120_000,
  });
}
