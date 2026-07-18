"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Gauge,
  Key,
  Server,
  Settings,
  Webhook as WebhookIcon,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import { useSLAReport } from "@/hooks/useEnterprise";

type EnterpriseTab = "api" | "webhooks" | "sla" | "usage";

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

export default function EnterprisePage() {
  const [activeTab, setActiveTab] = useState<EnterpriseTab>("api");
  const slaReportQuery = useSLAReport("month");

  const sla = slaReportQuery.data;

  const loading = slaReportQuery.isLoading;
  const queryError = slaReportQuery.error;

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
              <div className="rounded-2xl border border-amber-500/20 bg-zero-900 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-3">
                      <WebhookIcon className="h-5 w-5 text-amber-300" />
                      <h2 className="font-semibold">
                        Webhook delivery unavailable
                      </h2>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zero-400">
                      Registration, endpoint inventory, delivery health, test
                      deliveries, and replay are disabled until authoritative
                      domain mutations are published through a durable event
                      outbox.
                    </p>
                  </div>
                  <span className="self-start rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                    Awaiting durable event outbox
                  </span>
                </div>

                <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-zero-800 bg-zero-800 sm:grid-cols-3">
                  {[
                    ["Authoritative event source", "Not connected"],
                    ["Endpoint registration", "Disabled"],
                    ["Test and replay", "Disabled"],
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
      </div>
    </AppLayout>
  );
}
