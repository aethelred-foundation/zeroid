"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  Gauge,
  Key,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Webhook as WebhookIcon,
  XCircle,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import {
  useAPIKeys,
  useCreateAPIKey,
  useRegisterWebhook,
  useRevokeAPIKey,
  useSLAReport,
  useTestWebhook,
  useUsageMetrics,
  useWebhooks,
  type APIKey as EnterpriseAPIKey,
  type APIScope,
  type Webhook as EnterpriseWebhook,
  type WebhookEvent,
} from "@/hooks/useEnterprise";

type EnterpriseTab = "api" | "webhooks" | "sla" | "usage";

type APIKeyRow = {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string;
  status: "active" | "revoked";
  scopes: APIScope[];
};

type WebhookRow = {
  id: string;
  url: string;
  events: WebhookEvent[];
  status: "active" | "failing" | "inactive";
  successRate: number | null;
  lastDelivery: string;
};

const DEFAULT_API_KEY_SCOPES: APIScope[] = [
  "credentials:read",
  "verification:write",
  "identity:read",
];

const DEFAULT_WEBHOOK_EVENTS: WebhookEvent[] = [
  "credential.issued",
  "verification.completed",
  "compliance.status_changed",
];

const WEBHOOK_EVENT_OPTIONS: WebhookEvent[] = [
  ...DEFAULT_WEBHOOK_EVENTS,
  "identity.registered",
  "enterprise.sla_violation",
];

const TABS = [
  { id: "api" as const, label: "API Keys", icon: Key },
  { id: "webhooks" as const, label: "Webhooks", icon: WebhookIcon },
  { id: "sla" as const, label: "SLA Report", icon: Gauge },
  { id: "usage" as const, label: "Usage", icon: BarChart3 },
];

function formatDate(value?: string | null): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not reported";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not reported";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function mapAPIKeyRow(key: EnterpriseAPIKey): APIKeyRow {
  return {
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    created: formatDate(key.createdAt),
    lastUsed: formatRelativeTime(key.lastUsedAt),
    status: key.active && !key.revokedAt ? "active" : "revoked",
    scopes: key.scopes,
  };
}

function mapWebhookRow(webhook: EnterpriseWebhook): WebhookRow {
  const active = webhook.active ?? webhook.enabled ?? false;
  const healthStatus = webhook.health?.status?.toLowerCase() ?? "";
  const failing =
    healthStatus.includes("fail") ||
    healthStatus.includes("error") ||
    healthStatus.includes("degrad");

  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    status: !active ? "inactive" : failing ? "failing" : "active",
    successRate:
      typeof webhook.health?.successRate === "number"
        ? webhook.health.successRate
        : null,
    lastDelivery: formatRelativeTime(webhook.health?.lastDeliveryAt),
  };
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function EnterprisePage() {
  const [activeTab, setActiveTab] = useState<EnterpriseTab>("api");
  const [environment, setEnvironment] = useState<"production" | "sandbox">(
    "production",
  );
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [selectedWebhookEvents, setSelectedWebhookEvents] = useState<
    WebhookEvent[]
  >(DEFAULT_WEBHOOK_EVENTS);
  const [createdSecret, setCreatedSecret] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const apiKeysQuery = useAPIKeys();
  const webhooksQuery = useWebhooks();
  const slaReportQuery = useSLAReport("month");
  const usageMetricsQuery = useUsageMetrics("week");
  const createAPIKey = useCreateAPIKey();
  const revokeAPIKey = useRevokeAPIKey();
  const registerWebhook = useRegisterWebhook();
  const testWebhook = useTestWebhook();

  const apiKeyRows = useMemo(
    () =>
      (apiKeysQuery.data ?? [])
        .filter((key) => key.environment === environment)
        .map(mapAPIKeyRow),
    [apiKeysQuery.data, environment],
  );

  const webhookRows = useMemo(
    () => (webhooksQuery.data ?? []).map(mapWebhookRow),
    [webhooksQuery.data],
  );

  const usageDays = usageMetricsQuery.data?.breakdownByDay ?? [];
  const usageEndpoints = usageMetricsQuery.data?.breakdownByEndpoint ?? [];
  const maxDailyRequests = Math.max(1, ...usageDays.map((day) => day.requests));
  const sla = slaReportQuery.data;

  const loading =
    apiKeysQuery.isLoading ||
    webhooksQuery.isLoading ||
    slaReportQuery.isLoading ||
    usageMetricsQuery.isLoading;
  const queryError =
    apiKeysQuery.error ??
    webhooksQuery.error ??
    slaReportQuery.error ??
    usageMetricsQuery.error;

  const handleCreateKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newKeyName.trim();
    if (!name) return;

    try {
      const created = await createAPIKey.mutateAsync({
        name,
        environment,
        scopes: DEFAULT_API_KEY_SCOPES,
        dailyQuota: environment === "production" ? 100_000 : 10_000,
        monthlyQuota: environment === "production" ? 3_000_000 : 100_000,
        rateLimit: {
          requestsPerSecond: environment === "production" ? 200 : 50,
          burstSize: environment === "production" ? 500 : 100,
        },
        metadata: { createdFrom: "enterprise-console" },
      });
      setCreatedSecret({ name: created.name, value: created.secret });
      setNewKeyName("");
      setShowKeyModal(false);
    } catch {
      // The mutation hook owns the user-facing error toast. Keep the form open.
    }
  };

  const handleRegisterWebhook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newWebhookUrl.trim() || selectedWebhookEvents.length === 0) return;

    try {
      await registerWebhook.mutateAsync({
        url: newWebhookUrl.trim(),
        events: selectedWebhookEvents,
        active: true,
        metadata: { createdFrom: "enterprise-console" },
      });
      setNewWebhookUrl("");
      setSelectedWebhookEvents(DEFAULT_WEBHOOK_EVENTS);
      setShowWebhookModal(false);
    } catch {
      // The mutation hook owns the user-facing error toast. Keep the form open.
    }
  };

  const toggleWebhookEvent = (event: WebhookEvent) => {
    setSelectedWebhookEvents((current) =>
      current.includes(event)
        ? current.filter((candidate) => candidate !== event)
        : [...current, event],
    );
  };

  const copyCreatedSecret = async () => {
    if (!createdSecret || !navigator.clipboard) return;
    await navigator.clipboard.writeText(createdSecret.value);
    setSecretCopied(true);
  };

  const summaryMetrics = [
    {
      label: "Uptime (30d)",
      value: sla ? `${sla.uptimePercent.toFixed(2)}%` : "—",
      detail: sla ? `Target ${sla.uptimeTarget}%` : "Awaiting SLA report",
      icon: Activity,
    },
    {
      label: "P99 latency",
      value: sla ? `${Math.round(sla.p99ResponseTimeMs)}ms` : "—",
      detail: "Backend SLA report",
      icon: Gauge,
    },
    {
      label: "Error rate",
      value: sla ? `${sla.errorRate.toFixed(3)}%` : "—",
      detail: sla ? `${sla.failedRequests.toLocaleString()} failed` : "No data",
      icon: AlertTriangle,
    },
    {
      label: "Requests (30d)",
      value: sla ? sla.totalRequests.toLocaleString() : "—",
      detail: "Backend SLA window",
      icon: BarChart3,
    },
    {
      label: "SLA status",
      value: sla ? (sla.complianceMet ? "Met" : "Not met") : "—",
      detail: sla ? `${sla.incidentCount} recorded violation(s)` : "No data",
      icon: CheckCircle2,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              <Settings className="h-7 w-7 text-brand-400" />
              Enterprise Console
            </h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Backend-backed API keys, webhooks, SLA reports, and usage.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setEnvironment((current) =>
                current === "production" ? "sandbox" : "production",
              )
            }
            aria-label="Switch API key environment"
            className={`flex items-center gap-2 self-start rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
              environment === "production"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/20 bg-amber-500/10 text-amber-400"
            }`}
          >
            {environment === "production" ? (
              <ToggleRight className="h-4 w-4" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
            {environment === "production" ? "Production" : "Sandbox"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {summaryMetrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-zero-800 bg-zero-900 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <metric.icon className="h-4 w-4 text-brand-400" />
                <span className="text-xs text-zero-500">{metric.label}</span>
              </div>
              <div className="text-xl font-bold">{metric.value}</div>
              <div className="mt-1 text-xs text-zero-500">{metric.detail}</div>
            </motion.div>
          ))}
        </div>

        {(loading || queryError) && (
          <div
            role={queryError ? "alert" : "status"}
            className="flex items-center gap-3 rounded-xl border border-zero-800 bg-zero-900 px-4 py-3 text-sm"
          >
            <Server className="h-4 w-4 text-brand-400" />
            <span className="text-zero-400">
              {queryError
                ? `Enterprise backend issue: ${
                    queryError instanceof Error
                      ? queryError.message
                      : "service unavailable"
                  }`
                : "Loading enterprise control-plane data from the backend..."}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "border border-zero-800 bg-zero-900 text-zero-400 hover:text-white"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "api" && (
            <motion.section
              key="api"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">API Keys</h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Showing keys reported by the {environment} tenant API.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void apiKeysQuery.refetch()}
                    className="btn-secondary text-sm"
                  >
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowKeyModal(true)}
                    className="btn-primary text-sm"
                  >
                    <Plus className="h-4 w-4" /> Create Key
                  </button>
                </div>
              </div>

              <div className="card divide-y divide-zero-800/50">
                {apiKeyRows.map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        key.status === "active"
                          ? "bg-emerald-500/10"
                          : "bg-red-500/10"
                      }`}
                    >
                      <Key
                        className={`h-5 w-5 ${
                          key.status === "active"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{key.name}</span>
                        <span className="rounded-full bg-zero-800 px-2 py-0.5 text-[10px] uppercase text-zero-400">
                          {key.status}
                        </span>
                      </div>
                      <code className="mt-1 block text-xs text-zero-500">
                        {key.prefix}
                        {"*".repeat(12)}
                      </code>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded bg-zero-800 px-1.5 py-0.5 text-[9px] text-zero-400"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-zero-500 lg:text-right">
                      <div>Created: {key.created}</div>
                      <div className="mt-1">Last used: {key.lastUsed}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => revokeAPIKey.mutate(key.id)}
                      disabled={
                        key.status !== "active" || revokeAPIKey.isPending
                      }
                      className="self-start rounded-lg p-2 text-zero-500 hover:bg-zero-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Revoke API key"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {apiKeyRows.length === 0 && (
                  <div className="p-6 text-sm text-zero-500">
                    No {environment} API keys were returned by the enterprise
                    API.
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {activeTab === "webhooks" && (
            <motion.section
              key="webhooks"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Webhook Endpoints</h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Delivery health appears only when reported by the backend.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWebhookModal(true)}
                  className="btn-primary text-sm"
                >
                  <Plus className="h-4 w-4" /> Add Endpoint
                </button>
              </div>

              <div className="card divide-y divide-zero-800/50">
                {webhookRows.map((webhook) => (
                  <div key={webhook.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <WebhookIcon
                        className={`h-5 w-5 ${
                          webhook.status === "active"
                            ? "text-emerald-400"
                            : webhook.status === "failing"
                              ? "text-red-400"
                              : "text-zero-500"
                        }`}
                      />
                      <code className="min-w-0 flex-1 truncate text-sm text-zero-300">
                        {webhook.url}
                      </code>
                      <span className="rounded-full bg-zero-800 px-2 py-0.5 text-[10px] uppercase text-zero-400">
                        {webhook.status}
                      </span>
                    </div>
                    <div className="ml-8 mt-3 flex flex-wrap items-center gap-2">
                      {webhook.events.map((event) => (
                        <span
                          key={event}
                          className="rounded bg-zero-800 px-1.5 py-0.5 text-[9px] text-zero-400"
                        >
                          {event}
                        </span>
                      ))}
                      <span className="ml-auto text-xs text-zero-500">
                        {webhook.successRate === null
                          ? "Success rate not reported"
                          : `${webhook.successRate}% success`}
                      </span>
                      <span className="text-xs text-zero-600">
                        Last delivery: {webhook.lastDelivery}
                      </span>
                      <button
                        type="button"
                        onClick={() => testWebhook.mutate(webhook.id)}
                        disabled={
                          webhook.status === "inactive" || testWebhook.isPending
                        }
                        className="rounded-lg border border-zero-800 px-2 py-1 text-xs text-zero-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Test delivery
                      </button>
                    </div>
                  </div>
                ))}
                {webhookRows.length === 0 && (
                  <div className="p-6 text-sm text-zero-500">
                    No webhook endpoints were returned by the enterprise API.
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {activeTab === "sla" && (
            <motion.section
              key="sla"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div>
                <h2 className="font-semibold">SLA Report</h2>
                <p className="mt-1 text-xs text-zero-500">
                  Values below are returned by the enterprise SLA endpoint;
                  unreported percentiles are not estimated.
                </p>
              </div>
              {sla ? (
                <div className="card overflow-hidden">
                  <div className="flex flex-col gap-2 border-b border-zero-800 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium">
                        Reporting window
                      </div>
                      <div className="mt-1 text-xs text-zero-500">
                        {formatDate(sla.startDate)} – {formatDate(sla.endDate)}
                      </div>
                    </div>
                    <span
                      className={`self-start rounded-full px-3 py-1 text-xs font-medium ${
                        sla.complianceMet
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {sla.complianceMet ? "SLA met" : "SLA not met"}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-px bg-zero-800 sm:grid-cols-3">
                    {[
                      ["Uptime", `${sla.uptimePercent.toFixed(2)}%`],
                      ["Uptime target", `${sla.uptimeTarget}%`],
                      [
                        "P99 response time",
                        `${Math.round(sla.p99ResponseTimeMs)}ms`,
                      ],
                      ["Total requests", sla.totalRequests.toLocaleString()],
                      ["Failed requests", sla.failedRequests.toLocaleString()],
                      [
                        "Recorded violations",
                        sla.incidentCount.toLocaleString(),
                      ],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-zero-900 p-5">
                        <dt className="text-xs text-zero-500">{label}</dt>
                        <dd className="mt-1 text-lg font-semibold">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <div className="card p-6 text-sm text-zero-500">
                  No SLA report was returned by the enterprise API.
                </div>
              )}
            </motion.section>
          )}

          {activeTab === "usage" && (
            <motion.section
              key="usage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">API Requests This Week</h2>
                    <p className="mt-1 text-xs text-zero-500">
                      {usageMetricsQuery.data
                        ? `${usageMetricsQuery.data.totalAPIRequests.toLocaleString()} requests reported`
                        : "No usage report returned"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!usageMetricsQuery.data}
                    onClick={() =>
                      usageMetricsQuery.data &&
                      downloadJson(
                        "zeroid-enterprise-usage.json",
                        usageMetricsQuery.data,
                      )
                    }
                    className="rounded-lg border border-zero-800 px-3 py-1.5 text-xs text-zero-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="mr-1 inline h-3.5 w-3.5" /> Export
                  </button>
                </div>
                {usageDays.length > 0 ? (
                  <div className="flex h-48 items-end gap-3">
                    {usageDays.map((day) => (
                      <div
                        key={day.date}
                        className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                      >
                        <div className="text-[10px] text-zero-500">
                          {day.requests.toLocaleString()}
                        </div>
                        <div
                          className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400"
                          style={{
                            height: `${Math.max(
                              4,
                              (day.requests / maxDailyRequests) * 150,
                            )}px`,
                          }}
                        />
                        <div className="text-xs text-zero-500">
                          {new Date(day.date).toLocaleDateString("en-US", {
                            weekday: "short",
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-zero-500">
                    No daily usage breakdown was returned.
                  </div>
                )}
              </div>

              <div className="card overflow-hidden">
                <div className="border-b border-zero-800 p-4">
                  <h2 className="font-semibold">Endpoint Usage</h2>
                </div>
                {usageEndpoints.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zero-800 text-left text-xs text-zero-500">
                          <th className="px-4 py-3 font-medium">Endpoint</th>
                          <th className="px-4 py-3 text-right font-medium">
                            Requests
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Average latency
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Errors
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageEndpoints.map((endpoint) => (
                          <tr
                            key={`${endpoint.method}-${endpoint.endpoint}`}
                            className="border-b border-zero-800/50 last:border-0"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-zero-300">
                              {endpoint.method} {endpoint.endpoint}
                            </td>
                            <td className="px-4 py-3 text-right text-zero-400">
                              {endpoint.requestCount.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-zero-400">
                              {Math.round(endpoint.avgResponseTimeMs)}ms
                            </td>
                            <td className="px-4 py-3 text-right text-zero-400">
                              {endpoint.errorCount.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-sm text-zero-500">
                    No endpoint usage breakdown was returned.
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {showKeyModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            role="dialog"
            aria-modal="true"
            aria-label="Create API key"
          >
            <form
              onSubmit={handleCreateKey}
              className="w-full max-w-lg rounded-2xl border border-zero-800 bg-zero-950 p-6 shadow-2xl"
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Create API Key</h2>
                  <p className="mt-1 text-sm text-zero-500">
                    The backend returns the full secret once. Store it before
                    closing the confirmation.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close create key dialog"
                  onClick={() => setShowKeyModal(false)}
                  className="rounded-lg p-1.5 text-zero-500 hover:bg-zero-900 hover:text-white"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
              <label className="block text-sm">
                <span className="text-zero-400">Key name</span>
                <input
                  required
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                  placeholder={`${environment} identity verification`}
                  className="mt-2 w-full rounded-xl border border-zero-800 bg-zero-900 px-3 py-2 text-white outline-none focus:border-brand-500"
                />
              </label>
              <div className="mt-4">
                <div className="mb-2 text-sm text-zero-400">Scopes</div>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_API_KEY_SCOPES.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-lg bg-zero-900 px-2 py-1 text-xs text-zero-300"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createAPIKey.isPending || !newKeyName.trim()}
                  className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createAPIKey.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create Key
                </button>
              </div>
            </form>
          </div>
        )}

        {createdSecret && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            role="dialog"
            aria-modal="true"
            aria-label="API key created"
          >
            <div className="w-full max-w-xl rounded-2xl border border-zero-800 bg-zero-950 p-6 shadow-2xl">
              <h2 className="text-lg font-semibold">API key created</h2>
              <p className="mt-1 text-sm text-zero-500">
                {createdSecret.name} — this secret will not be available after
                you close this confirmation.
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-zero-800 bg-zero-900 p-3">
                <code className="min-w-0 flex-1 break-all text-sm text-zero-200">
                  {createdSecret.value}
                </code>
                <button
                  type="button"
                  onClick={() => void copyCreatedSecret()}
                  className="btn-secondary shrink-0 text-sm"
                >
                  {secretCopied ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {secretCopied ? "Copied" : "Copy secret"}
                </button>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setCreatedSecret(null);
                    setSecretCopied(false);
                  }}
                  className="btn-primary text-sm"
                >
                  I have stored it
                </button>
              </div>
            </div>
          </div>
        )}

        {showWebhookModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            role="dialog"
            aria-modal="true"
            aria-label="Add webhook endpoint"
          >
            <form
              onSubmit={handleRegisterWebhook}
              className="w-full max-w-xl rounded-2xl border border-zero-800 bg-zero-950 p-6 shadow-2xl"
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    Add Webhook Endpoint
                  </h2>
                  <p className="mt-1 text-sm text-zero-500">
                    Registers the endpoint through the enterprise webhook API.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close webhook dialog"
                  onClick={() => setShowWebhookModal(false)}
                  className="rounded-lg p-1.5 text-zero-500 hover:bg-zero-900 hover:text-white"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
              <label className="block text-sm">
                <span className="text-zero-400">Endpoint URL</span>
                <input
                  required
                  type="url"
                  value={newWebhookUrl}
                  onChange={(event) => setNewWebhookUrl(event.target.value)}
                  placeholder="https://enterprise.example/hooks/zeroid"
                  className="mt-2 w-full rounded-xl border border-zero-800 bg-zero-900 px-3 py-2 text-white outline-none focus:border-brand-500"
                />
              </label>
              <div className="mt-4">
                <div className="mb-2 text-sm text-zero-400">Events</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {WEBHOOK_EVENT_OPTIONS.map((event) => (
                    <label
                      key={event}
                      className="flex items-center gap-2 rounded-lg border border-zero-800 bg-zero-900 px-3 py-2 text-xs text-zero-300"
                    >
                      <input
                        type="checkbox"
                        checked={selectedWebhookEvents.includes(event)}
                        onChange={() => toggleWebhookEvent(event)}
                        className="rounded border-zero-700 bg-zero-950"
                      />
                      {event}
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowWebhookModal(false)}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    registerWebhook.isPending ||
                    !newWebhookUrl.trim() ||
                    selectedWebhookEvents.length === 0
                  }
                  className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {registerWebhook.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <WebhookIcon className="h-4 w-4" />
                  )}
                  Register Endpoint
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
