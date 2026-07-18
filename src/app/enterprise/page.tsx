"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Gauge,
  Key,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Webhook as WebhookIcon,
  XCircle,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import {
  useRegisterWebhook,
  useSLAReport,
  useTestWebhook,
  useWebhooks,
  type Webhook as EnterpriseWebhook,
  type WebhookEvent,
} from "@/hooks/useEnterprise";

type EnterpriseTab = "api" | "webhooks" | "sla" | "usage";

type WebhookRow = {
  id: string;
  url: string;
  events: WebhookEvent[];
  status: "active" | "failing" | "inactive";
  successRate: number | null;
  lastDelivery: string;
};

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
  { id: "api" as const, label: "API Access", icon: Key },
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

export default function EnterprisePage() {
  const [activeTab, setActiveTab] = useState<EnterpriseTab>("api");
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [selectedWebhookEvents, setSelectedWebhookEvents] = useState<
    WebhookEvent[]
  >(DEFAULT_WEBHOOK_EVENTS);
  const webhooksQuery = useWebhooks();
  const slaReportQuery = useSLAReport("month");
  const registerWebhook = useRegisterWebhook();
  const testWebhook = useTestWebhook();

  const webhookRows = useMemo(
    () => (webhooksQuery.data ?? []).map(mapWebhookRow),
    [webhooksQuery.data],
  );

  const sla = slaReportQuery.data;

  const loading = webhooksQuery.isLoading || slaReportQuery.isLoading;
  const queryError = webhooksQuery.error ?? slaReportQuery.error;

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
        <div>
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              <Settings className="h-7 w-7 text-brand-400" />
              Enterprise Console
            </h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Enterprise integrations with explicit production capability
              status.
            </p>
          </div>
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
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-3">
                      <Key className="h-5 w-5 text-amber-300" />
                      <h2 className="font-semibold">Enterprise API access</h2>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zero-400">
                      API keys and OAuth client credentials are disabled. ZeroID
                      will not issue or display credentials until they are
                      enforced by runtime route authentication, revocation, and
                      durable request metering.
                    </p>
                  </div>
                  <span className="self-start rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                    Configuration required
                  </span>
                </div>

                <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-zero-800 bg-zero-800 sm:grid-cols-3">
                  {[
                    ["Runtime credential auth", "Not connected"],
                    ["Durable request metering", "Not connected"],
                    ["Production SDK contract", "Not published"],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-zero-950 p-4">
                      <dt className="text-xs text-zero-500">{label}</dt>
                      <dd className="mt-1 text-sm font-medium text-amber-200">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
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
              <div className="rounded-2xl border border-amber-500/20 bg-zero-900 p-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-amber-300" />
                  <h2 className="font-semibold">Usage reporting unavailable</h2>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zero-400">
                  Durable request metering is not connected to the API runtime.
                  Request counts, latency, errors, quotas, and exports stay
                  unavailable; this console does not infer or fabricate them.
                </p>
                <div className="mt-5 inline-flex rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                  Awaiting telemetry integration
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

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
