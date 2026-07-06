"use client";

import { useMemo, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  Webhook as WebhookIcon,
  Activity,
  BarChart3,
  Settings,
  Users,
  Shield,
  ShieldCheck,
  Code2,
  Copy,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  Server,
  Gauge,
  TrendingUp,
  CreditCard,
  UserPlus,
  ChevronDown,
  Terminal,
  Globe,
  ToggleLeft,
  ToggleRight,
  Zap,
  Package,
  ArrowRight,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import {
  useAPIKeys,
  useCreateAPIKey,
  useRevokeAPIKey,
  useRegisterWebhook,
  useSLAReport,
  useTestWebhook,
  useUsageMetrics,
  useWebhooks,
  type APIKey as EnterpriseAPIKey,
  type APIScope,
  type Webhook as EnterpriseWebhook,
  type WebhookEvent,
} from "@/hooks/useEnterprise";

// ============================================================
// Enterprise Operations Data
// ============================================================

const apiKeys = [
  {
    id: "k1",
    name: "Production - Main",
    key: null,
    prefix: "zid_live_",
    created: "Jan 15, 2026",
    lastUsed: "2 min ago",
    status: "active" as const,
    scope: ["read", "write", "verify"],
    calls: 142847,
  },
  {
    id: "k2",
    name: "Production - Mobile",
    key: null,
    prefix: "zid_live_",
    created: "Feb 3, 2026",
    lastUsed: "15 min ago",
    status: "active" as const,
    scope: ["read", "verify"],
    calls: 89321,
  },
  {
    id: "k3",
    name: "Sandbox - Testing",
    key: null,
    prefix: "zid_test_",
    created: "Mar 1, 2026",
    lastUsed: "1h ago",
    status: "active" as const,
    scope: ["read", "write", "verify", "admin"],
    calls: 3241,
  },
  {
    id: "k4",
    name: "Legacy - Deprecated",
    key: null,
    prefix: "zid_live_",
    created: "Sep 10, 2025",
    lastUsed: "30d ago",
    status: "revoked" as const,
    scope: ["read"],
    calls: 0,
  },
];

const webhooks = [
  {
    id: "w1",
    url: "https://api.acme-corp.com/webhooks/zeroid",
    events: ["credential.issued", "credential.verified", "credential.revoked"],
    status: "active" as const,
    successRate: 99.8,
    lastDelivery: "1 min ago",
  },
  {
    id: "w2",
    url: "https://compliance.acme-corp.com/hooks",
    events: ["screening.completed", "alert.triggered"],
    status: "active" as const,
    successRate: 100,
    lastDelivery: "5 min ago",
  },
  {
    id: "w3",
    url: "https://staging.acme-corp.com/webhooks",
    events: ["credential.issued"],
    status: "failing" as const,
    successRate: 45.2,
    lastDelivery: "2h ago",
  },
];

const slaMetrics = {
  uptime: 99.97,
  latencyP50: 42,
  latencyP95: 250,
  latencyP99: 412,
  errorRate: 0.03,
  throughput: 2847,
};

const usageData = [
  { day: "Mon", calls: 12400 },
  { day: "Tue", calls: 15200 },
  { day: "Wed", calls: 14800 },
  { day: "Thu", calls: 18900 },
  { day: "Fri", calls: 16300 },
  { day: "Sat", calls: 8700 },
  { day: "Sun", calls: 7200 },
];

const topEndpoints = [
  {
    endpoint: "/api/v1/credentials/{id}/verify",
    calls: 48293,
    avgLatency: "38ms",
    errorRate: "0.01%",
  },
  {
    endpoint: "/api/v1/credentials",
    calls: 23847,
    avgLatency: "124ms",
    errorRate: "0.05%",
  },
  {
    endpoint: "/api/v1/verification/zk-proof",
    calls: 18932,
    avgLatency: "287ms",
    errorRate: "0.02%",
  },
  {
    endpoint: "/api/v1/identity/resolve/{did}",
    calls: 15421,
    avgLatency: "22ms",
    errorRate: "0.00%",
  },
  {
    endpoint: "/api/v1/enterprise/compliance/screen",
    calls: 8934,
    avgLatency: "1.2s",
    errorRate: "0.08%",
  },
];

const teamMembers = [
  {
    id: "t1",
    name: "Sarah Chen",
    email: "sarah@acme-corp.com",
    role: "Admin",
    status: "active" as const,
    lastActive: "2 min ago",
  },
  {
    id: "t2",
    name: "James Wilson",
    email: "james@acme-corp.com",
    role: "Operator",
    status: "active" as const,
    lastActive: "1h ago",
  },
  {
    id: "t3",
    name: "Maria Santos",
    email: "maria@acme-corp.com",
    role: "Compliance Officer",
    status: "active" as const,
    lastActive: "30 min ago",
  },
  {
    id: "t4",
    name: "Ahmed Al-Rashid",
    email: "ahmed@acme-corp.com",
    role: "Viewer",
    status: "active" as const,
    lastActive: "2d ago",
  },
  {
    id: "t5",
    name: "Priya Sharma",
    email: "priya@acme-corp.com",
    role: "Auditor",
    status: "pending" as const,
    lastActive: "Invited",
  },
];

const sdkSnippets: Record<string, string> = {
  typescript: `import { ZeroID } from '@aethelred/zeroid-sdk';

const client = new ZeroID({
  apiKey: process.env.ZEROID_API_KEY!,
  network: 'mainnet',
});

// Verify a credential
const result = await client.credentials.verify({
  credentialId: 'cred_abc123',
  proofType: 'zk-snark',
});`,
  python: `import os
from aethelred import ZeroID

client = ZeroID(
    api_key=os.environ["ZEROID_API_KEY"],
    network="mainnet",
)

# Verify a credential
result = client.credentials.verify(
    credential_id="cred_abc123",
    proof_type="zk-snark",
)`,
  rust: `use aethelred_zeroid::Client;

let client = Client::new(
    std::env::var("ZEROID_API_KEY")?,
    Network::Mainnet,
);

// Verify a credential
let result = client
    .credentials()
    .verify("cred_abc123", ProofType::ZkSnark)
    .await?;`,
  go: `import (
    "os"

    zeroid "github.com/aethelred/zeroid-go"
)

client := zeroid.NewClient(
    os.Getenv("ZEROID_API_KEY"),
    zeroid.Mainnet,
)

// Verify a credential
result, err := client.Credentials.Verify(ctx, &zeroid.VerifyRequest{
    CredentialID: "cred_abc123",
    ProofType:    "zk-snark",
})`,
};

type EnterpriseTab = "api" | "webhooks" | "sla" | "usage" | "team" | "sdk";

type APIKeyRow = {
  id: string;
  name: string;
  key: string | null;
  prefix: string;
  created: string;
  lastUsed: string;
  status: "active" | "revoked";
  scope: APIScope[];
  calls: number;
};

type WebhookRow = {
  id: string;
  url: string;
  events: WebhookEvent[];
  status: "active" | "failing" | "inactive";
  successRate: number;
  lastDelivery: string;
};

type SLAViewMetrics = {
  uptime: number;
  uptimeTarget: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errorRate: number;
  throughput: number;
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

function formatDate(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function mapAPIKeyRow(
  key: EnterpriseAPIKey,
  createdSecrets: Record<string, string>,
): APIKeyRow {
  return {
    id: key.id,
    name: key.name,
    key: createdSecrets[key.id] ?? null,
    prefix: key.keyPrefix,
    created: formatDate(key.createdAt),
    lastUsed: formatRelativeTime(key.lastUsedAt),
    status: key.active && !key.revokedAt ? "active" : "revoked",
    scope: key.scopes,
    calls: Number(key.metadata?.calls ?? key.metadata?.requestCount ?? 0),
  };
}

function mapWebhookRow(webhook: EnterpriseWebhook): WebhookRow {
  const healthStatus = webhook.health?.status?.toLowerCase() ?? "";
  const active = webhook.active ?? webhook.enabled ?? true;
  const failing =
    healthStatus.includes("fail") ||
    healthStatus.includes("error") ||
    healthStatus.includes("degrad");

  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    status: !active ? "inactive" : failing ? "failing" : "active",
    successRate: Number(webhook.health?.successRate ?? (active ? 100 : 0)),
    lastDelivery: formatRelativeTime(webhook.health?.lastDeliveryAt),
  };
}

function buildSLAViewMetrics(
  report?: ReturnType<typeof useSLAReport>["data"],
): SLAViewMetrics {
  const p99 = Math.round(report?.p99ResponseTimeMs ?? 0);
  const p50 = Math.round(report?.avgResponseTimeMs ?? Math.max(0, p99 * 0.45));
  const p95 = Math.round(Math.max(p50, p99 * 0.75));
  const periodDays =
    report?.period === "day" ? 1 : report?.period === "week" ? 7 : 30;
  const throughput =
    report && periodDays > 0
      ? Math.round(report.totalRequests / periodDays / 24 / 60)
      : 0;

  return {
    uptime: Number((report?.uptimePercent ?? 0).toFixed(2)),
    uptimeTarget: report?.uptimeTarget ?? 99.95,
    latencyP50: p50,
    latencyP95: p95,
    latencyP99: p99,
    errorRate: Number((report?.errorRate ?? 0).toFixed(3)),
    throughput,
  };
}

function buildUsageBars(metrics?: ReturnType<typeof useUsageMetrics>["data"]) {
  return (metrics?.breakdownByDay ?? []).map((day) => ({
    day: new Date(day.date).toLocaleDateString("en-US", { weekday: "short" }),
    calls: day.requests,
  }));
}

function buildEndpointRows(
  metrics?: ReturnType<typeof useUsageMetrics>["data"],
) {
  return (metrics?.breakdownByEndpoint ?? []).map((endpoint) => ({
    endpoint: `${endpoint.method} ${endpoint.endpoint}`,
    calls: endpoint.requestCount,
    avgLatency: `${Math.round(endpoint.avgResponseTimeMs)}ms`,
    errorRate:
      endpoint.requestCount > 0
        ? `${((endpoint.errorCount / endpoint.requestCount) * 100).toFixed(2)}%`
        : "0.00%",
  }));
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

// ============================================================
// Component
// ============================================================

export default function EnterprisePage() {
  const [activeTab, setActiveTab] = useState<EnterpriseTab>("api");
  const [environment, setEnvironment] = useState<"production" | "sandbox">(
    "production",
  );
  const [selectedSdk, setSelectedSdk] = useState<
    "typescript" | "python" | "rust" | "go"
  >("typescript");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [selectedWebhookEvents, setSelectedWebhookEvents] = useState<
    WebhookEvent[]
  >(DEFAULT_WEBHOOK_EVENTS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [createdSecrets, setCreatedSecrets] = useState<Record<string, string>>(
    {},
  );

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
        .map((key) => mapAPIKeyRow(key, createdSecrets)),
    [apiKeysQuery.data, createdSecrets, environment],
  );

  const webhookRows = useMemo(
    () => (webhooksQuery.data ?? []).map(mapWebhookRow),
    [webhooksQuery.data],
  );

  const slaViewMetrics = useMemo(
    () => buildSLAViewMetrics(slaReportQuery.data),
    [slaReportQuery.data],
  );

  const liveUsageData = useMemo(
    () => buildUsageBars(usageMetricsQuery.data),
    [usageMetricsQuery.data],
  );

  const liveTopEndpoints = useMemo(
    () => buildEndpointRows(usageMetricsQuery.data),
    [usageMetricsQuery.data],
  );

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const created = await createAPIKey.mutateAsync({
      name: newKeyName.trim() || `${environment} integration key`,
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
    setCreatedSecrets((prev) => ({ ...prev, [created.id]: created.secret }));
    setRevealedKeys((prev) => new Set(prev).add(created.id));
    setNewKeyName("");
    setShowKeyModal(false);
  };

  const handleRegisterWebhook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await registerWebhook.mutateAsync({
      url: newWebhookUrl.trim(),
      events: selectedWebhookEvents,
      active: true,
      metadata: { createdFrom: "enterprise-console" },
    });
    setNewWebhookUrl("");
    setSelectedWebhookEvents(DEFAULT_WEBHOOK_EVENTS);
    setShowWebhookModal(false);
  };

  const toggleWebhookEvent = (event: WebhookEvent) => {
    setSelectedWebhookEvents((prev) =>
      prev.includes(event)
        ? prev.filter((candidate) => candidate !== event)
        : [...prev, event],
    );
  };

  const maxCalls = Math.max(1, ...liveUsageData.map((d) => d.calls));
  const queryError =
    apiKeysQuery.error ??
    webhooksQuery.error ??
    slaReportQuery.error ??
    usageMetricsQuery.error;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Settings className="w-7 h-7 text-brand-400" />
              Enterprise Admin Console
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Manage API keys, webhooks, team access, and monitor platform
              health
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                setEnvironment(
                  environment === "production" ? "sandbox" : "production",
                )
              }
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                environment === "production"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}
            >
              {environment === "production" ? (
                <ToggleRight className="w-4 h-4" />
              ) : (
                <ToggleLeft className="w-4 h-4" />
              )}
              {environment === "production" ? "Production" : "Sandbox"}
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Uptime",
              value: `${slaViewMetrics.uptime}%`,
              icon: Activity,
              color: "text-emerald-400",
              trend: "Last 30 days",
            },
            {
              label: "P95 Latency",
              value: `${slaViewMetrics.latencyP95}ms`,
              icon: Gauge,
              color: "text-brand-400",
              trend: "Target: <200ms",
            },
            {
              label: "Error Rate",
              value: `${slaViewMetrics.errorRate}%`,
              icon: AlertTriangle,
              color: "text-emerald-400",
              trend: "Below SLA",
            },
            {
              label: "API Calls/min",
              value: slaViewMetrics.throughput.toLocaleString(),
              icon: Zap,
              color: "text-identity-chrome",
              trend: "SLA window",
            },
            {
              label: "Team Members",
              value: String(teamMembers.length),
              icon: Users,
              color: "text-identity-steel",
              trend: "1 pending invite",
            },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-zero-900 border border-zero-800 rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`w-4 h-4 ${m.color}`} />
                <span className="text-xs text-zero-500">{m.label}</span>
              </div>
              <div className="text-xl font-bold">{m.value}</div>
              <div className="text-xs text-zero-500 mt-1">{m.trend}</div>
            </motion.div>
          ))}
        </div>

        {(apiKeysQuery.isLoading ||
          webhooksQuery.isLoading ||
          slaReportQuery.isLoading ||
          usageMetricsQuery.isLoading ||
          queryError) && (
          <div className="flex items-center gap-3 rounded-xl border border-zero-800 bg-zero-900 px-4 py-3 text-sm">
            <Server className="h-4 w-4 text-brand-400" />
            <span className="text-zero-400">
              {queryError
                ? `Enterprise backend issue: ${
                    queryError instanceof Error
                      ? queryError.message
                      : "service unavailable"
                  }`
                : "Loading enterprise control-plane data from backend..."}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: "api" as const, label: "API Keys", icon: Key },
            { id: "webhooks" as const, label: "Webhooks", icon: WebhookIcon },
            { id: "sla" as const, label: "SLA Monitor", icon: Gauge },
            { id: "usage" as const, label: "Usage Analytics", icon: BarChart3 },
            { id: "team" as const, label: "Team (RBAC)", icon: Users },
            { id: "sdk" as const, label: "SDK & Docs", icon: Code2 },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-zero-900 border border-zero-800 text-zero-400 hover:text-white"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {/* API Keys */}
          {activeTab === "api" && (
            <motion.div
              key="api"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">API Keys</h2>
                <button
                  onClick={() => setShowKeyModal(true)}
                  className="btn-primary text-sm"
                >
                  <Plus className="w-4 h-4" /> Create Key
                </button>
              </div>
              <div className="card divide-y divide-zero-800/50">
                {apiKeyRows.map((key) => (
                  <div key={key.id} className="p-4 flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${key.status === "active" ? "bg-emerald-500/10" : "bg-red-500/10"}`}
                    >
                      <Key
                        className={`w-5 h-5 ${key.status === "active" ? "text-emerald-400" : "text-red-400"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{key.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-zero-500 font-mono">
                          {key.key && revealedKeys.has(key.id)
                            ? key.key
                            : `${key.prefix}${"*".repeat(12)}`}
                        </code>
                        {key.key ? (
                          <>
                            <button
                              onClick={() => toggleReveal(key.id)}
                              className="text-zero-600 hover:text-white"
                            >
                              {revealedKeys.has(key.id) ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              onClick={() =>
                                key.key && handleCopy(key.key, key.id)
                              }
                              className="text-zero-600 hover:text-white"
                            >
                              {copiedKey === key.id ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-zero-600">
                            shown once at creation
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {key.scope.map((s) => (
                          <span
                            key={s}
                            className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zero-500">
                      <div>{key.calls.toLocaleString()} tracked calls</div>
                      <div className="mt-0.5">Last: {key.lastUsed}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void apiKeysQuery.refetch()}
                        className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white"
                        title="Refresh key inventory"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => revokeAPIKey.mutate(key.id)}
                        disabled={
                          key.status !== "active" || revokeAPIKey.isPending
                        }
                        className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Revoke API key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {apiKeyRows.length === 0 && (
                  <div className="p-6 text-sm text-zero-500">
                    No {environment} API keys returned by the enterprise API.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Webhooks */}
          {activeTab === "webhooks" && (
            <motion.div
              key="webhooks"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Webhook Endpoints</h2>
                <button
                  onClick={() => setShowWebhookModal(true)}
                  className="btn-primary text-sm"
                >
                  <Plus className="w-4 h-4" /> Add Endpoint
                </button>
              </div>
              <div className="card divide-y divide-zero-800/50">
                {webhookRows.map((wh) => (
                  <div key={wh.id} className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <WebhookIcon
                        className={`w-5 h-5 ${wh.status === "active" ? "text-emerald-400" : "text-red-400"}`}
                      />
                      <code className="text-sm text-zero-300 font-mono truncate flex-1">
                        {wh.url}
                      </code>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${wh.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
                      >
                        {wh.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 ml-8">
                      <div className="flex gap-1 flex-wrap">
                        {wh.events.map((ev) => (
                          <span
                            key={ev}
                            className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400"
                          >
                            {ev}
                          </span>
                        ))}
                      </div>
                      <span className="ml-auto text-xs text-zero-500">
                        {wh.successRate}% success
                      </span>
                      <span className="text-xs text-zero-600">
                        Last: {wh.lastDelivery}
                      </span>
                      <button
                        onClick={() => testWebhook.mutate(wh.id)}
                        disabled={testWebhook.isPending}
                        className="ml-2 rounded-lg border border-zero-800 px-2 py-1 text-xs text-zero-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Test
                      </button>
                    </div>
                  </div>
                ))}
                {webhookRows.length === 0 && (
                  <div className="p-6 text-sm text-zero-500">
                    No webhook endpoints returned by the enterprise API.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* SLA Monitor */}
          {activeTab === "sla" && (
            <motion.div
              key="sla"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Uptime Gauge */}
                <div className="card p-6 text-center">
                  <h3 className="text-sm text-zero-500 mb-4">Uptime (30d)</h3>
                  <div className="relative w-28 h-28 mx-auto">
                    <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgba(51,65,85,0.3)"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - slaViewMetrics.uptime / 100)}`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold text-emerald-400">
                        {slaViewMetrics.uptime}%
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-zero-500 mt-2">
                    SLA: {slaViewMetrics.uptimeTarget}%
                  </div>
                </div>

                {/* Latency */}
                <div className="card p-6">
                  <h3 className="text-sm text-zero-500 mb-4">
                    Latency Percentiles
                  </h3>
                  <div className="space-y-4">
                    {[
                      {
                        label: "P50",
                        value: slaViewMetrics.latencyP50,
                        max: 500,
                      },
                      {
                        label: "P95",
                        value: slaViewMetrics.latencyP95,
                        max: 500,
                      },
                      {
                        label: "P99",
                        value: slaViewMetrics.latencyP99,
                        max: 500,
                      },
                    ].map((p) => (
                      <div key={p.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-zero-400">{p.label}</span>
                          <span
                            className={`font-medium ${p.value < 200 ? "text-emerald-400" : p.value < 400 ? "text-amber-400" : "text-red-400"}`}
                          >
                            {p.value}ms
                          </span>
                        </div>
                        <div className="w-full bg-zero-800 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${p.value < 200 ? "bg-emerald-500" : p.value < 400 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{
                              width: `${Math.min((p.value / p.max) * 100, 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Error Rate */}
                <div className="card p-6 text-center">
                  <h3 className="text-sm text-zero-500 mb-4">Error Rate</h3>
                  <div className="text-4xl font-bold text-emerald-400">
                    {slaViewMetrics.errorRate}%
                  </div>
                  <div className="text-xs text-zero-500 mt-2">
                    SLA: &lt;0.1%
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-3 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Within SLA
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Usage Analytics */}
          {activeTab === "usage" && (
            <motion.div
              key="usage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold">API Calls This Week</h2>
                  <button
                    onClick={() =>
                      downloadJson("zeroid-enterprise-usage.json", {
                        usage: usageMetricsQuery.data,
                        endpoints: liveTopEndpoints,
                      })
                    }
                    className="rounded-lg border border-zero-800 px-3 py-1.5 text-xs text-zero-400 hover:text-white"
                  >
                    <Download className="mr-1 inline h-3.5 w-3.5" />
                    Export
                  </button>
                </div>
                <div className="flex items-end gap-3 h-48">
                  {liveUsageData.map((d, i) => (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      <span className="text-xs text-zero-400">
                        {(d.calls / 1000).toFixed(1)}k
                      </span>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(d.calls / maxCalls) * 160}px` }}
                        transition={{ delay: i * 0.1, duration: 0.5 }}
                        className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400"
                      />
                      <span className="text-[10px] text-zero-500">{d.day}</span>
                    </div>
                  ))}
                  {liveUsageData.length === 0 && (
                    <div className="flex h-full w-full items-center justify-center text-sm text-zero-500">
                      No usage samples returned for this period.
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="p-4 border-b border-zero-800">
                  <h2 className="font-semibold">Top Endpoints</h2>
                </div>
                <div className="divide-y divide-zero-800/50">
                  {liveTopEndpoints.map((ep) => (
                    <div
                      key={ep.endpoint}
                      className="p-4 flex items-center gap-4"
                    >
                      <code className="text-sm text-brand-400 font-mono flex-1">
                        {ep.endpoint}
                      </code>
                      <span className="text-xs text-zero-400">
                        {ep.calls.toLocaleString()} calls
                      </span>
                      <span className="text-xs text-zero-500">
                        {ep.avgLatency}
                      </span>
                      <span className="text-xs text-emerald-400">
                        {ep.errorRate} err
                      </span>
                    </div>
                  ))}
                  {liveTopEndpoints.length === 0 && (
                    <div className="p-6 text-sm text-zero-500">
                      No endpoint breakdown returned for this period.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Team RBAC */}
          {activeTab === "team" && (
            <motion.div
              key="team"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Team Members</h2>
                <button className="btn-primary text-sm">
                  <UserPlus className="w-4 h-4" /> Invite Member
                </button>
              </div>
              <div className="card divide-y divide-zero-800/50">
                {teamMembers.map((member) => (
                  <div key={member.id} className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-600 to-identity-chrome flex items-center justify-center text-white font-bold text-sm">
                      {member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{member.name}</div>
                      <div className="text-xs text-zero-500">
                        {member.email}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        member.role === "Admin"
                          ? "bg-brand-500/20 text-brand-400"
                          : member.role === "Operator"
                            ? "bg-identity-chrome/20 text-identity-chrome"
                            : member.role === "Compliance Officer"
                              ? "bg-amber-500/20 text-amber-400"
                              : member.role === "Auditor"
                                ? "bg-identity-steel/20 text-identity-steel"
                                : "bg-zero-500/20 text-zero-400"
                      }`}
                    >
                      {member.role}
                    </span>
                    <span className="text-xs text-zero-500">
                      {member.lastActive}
                    </span>
                    <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* RBAC Info */}
              <div className="card p-6">
                <h3 className="font-semibold text-sm mb-3">Role Permissions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zero-800">
                        <th className="text-left py-2 px-2 text-zero-500">
                          Permission
                        </th>
                        {[
                          "Admin",
                          "Operator",
                          "Compliance",
                          "Auditor",
                          "Viewer",
                        ].map((r) => (
                          <th
                            key={r}
                            className="text-center py-2 px-2 text-zero-500"
                          >
                            {r}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        "Manage API Keys",
                        "View Credentials",
                        "Issue Credentials",
                        "Run Screening",
                        "View Audit Log",
                        "Manage Team",
                        "Billing Access",
                        "Configure OIDC",
                      ].map((perm) => (
                        <tr key={perm} className="border-b border-zero-800/50">
                          <td className="py-2 px-2 text-zero-300">{perm}</td>
                          {[
                            true,
                            perm !== "Manage Team" &&
                              perm !== "Billing Access" &&
                              perm !== "Configure OIDC",
                            perm !== "Manage Team" &&
                              perm !== "Manage API Keys" &&
                              perm !== "Configure OIDC",
                            perm === "View Audit Log" ||
                              perm === "View Credentials",
                            perm === "View Credentials" ||
                              perm === "View Audit Log",
                          ].map((has, ci) => (
                            <td key={ci} className="text-center py-2 px-2">
                              {has ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-zero-700 mx-auto" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* SDK & Docs */}
          {activeTab === "sdk" && (
            <motion.div
              key="sdk"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Package className="w-4 h-4 text-brand-400" />
                  SDK Downloads
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    {
                      name: "TypeScript",
                      version: "v2.4.1",
                      icon: "{}",
                      color:
                        "from-blue-600/20 to-blue-400/20 border-blue-500/20",
                    },
                    {
                      name: "Python",
                      version: "v2.3.0",
                      icon: "#",
                      color:
                        "from-yellow-600/20 to-yellow-400/20 border-yellow-500/20",
                    },
                    {
                      name: "Rust",
                      version: "v1.8.2",
                      icon: "{}",
                      color:
                        "from-orange-600/20 to-orange-400/20 border-orange-500/20",
                    },
                    {
                      name: "Go",
                      version: "v1.6.0",
                      icon: "()",
                      color:
                        "from-cyan-600/20 to-cyan-400/20 border-cyan-500/20",
                    },
                  ].map((sdk) => (
                    <button
                      key={sdk.name}
                      onClick={() =>
                        setSelectedSdk(
                          sdk.name.toLowerCase() as typeof selectedSdk,
                        )
                      }
                      className={`p-4 rounded-xl border bg-gradient-to-br transition-all text-left ${sdk.color} ${selectedSdk === sdk.name.toLowerCase() ? "ring-2 ring-brand-500" : "hover:border-zero-600"}`}
                    >
                      <div className="text-lg font-bold">{sdk.name}</div>
                      <div className="text-xs text-zero-500 mt-0.5">
                        {sdk.version}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-xs text-brand-400">
                        <Download className="w-3 h-3" /> Install
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="p-4 border-b border-zero-800 flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-zero-400" />
                    Quick Start —{" "}
                    {selectedSdk.charAt(0).toUpperCase() + selectedSdk.slice(1)}
                  </h3>
                  <button
                    onClick={() =>
                      handleCopy(sdkSnippets[selectedSdk], "snippet")
                    }
                    className="text-xs text-zero-500 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === "snippet" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}{" "}
                    Copy
                  </button>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-zero-300 font-mono whitespace-pre-wrap bg-zero-800/50 rounded-xl p-4 overflow-x-auto">
                    {sdkSnippets[selectedSdk]}
                  </pre>
                </div>
              </div>

              {/* OIDC Setup */}
              <div className="card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-identity-chrome" />
                  OIDC Integration
                </h3>
                <div className="p-4 bg-zero-800/50 rounded-xl">
                  <div className="font-medium text-sm mb-2">OIDC Provider</div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zero-400">Issuer URL</span>
                      <span className="text-zero-300">
                        https://auth.zeroid.io
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zero-400">Client ID</span>
                      <span className="text-zero-300 font-mono">
                        zid_oidc_...
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zero-400">Status</span>
                      <span className="text-emerald-400">Connected</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Billing */}
              <div className="card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-identity-amber" />
                  Enterprise Billing
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                    <div className="text-2xl font-bold text-white">$2,847</div>
                    <div className="text-[10px] text-zero-500">
                      Current Month
                    </div>
                  </div>
                  <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                    <div className="text-2xl font-bold text-white">
                      Enterprise
                    </div>
                    <div className="text-[10px] text-zero-500">Plan</div>
                  </div>
                  <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                    <div className="text-2xl font-bold text-emerald-400">
                      93%
                    </div>
                    <div className="text-[10px] text-zero-500">Quota Used</div>
                  </div>
                </div>
              </div>
            </motion.div>
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
                    Generates a backend-issued enterprise key. The full secret
                    is shown once after creation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="rounded-lg p-1.5 text-zero-500 hover:bg-zero-900 hover:text-white"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>

              <label className="block text-sm">
                <span className="text-zero-400">Key name</span>
                <input
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
                  disabled={createAPIKey.isPending}
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
                    Registers the endpoint through the enterprise webhook API
                    and signs deliveries with the backend-managed secret.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWebhookModal(false)}
                  className="rounded-lg p-1.5 text-zero-500 hover:bg-zero-900 hover:text-white"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>

              <label className="block text-sm">
                <span className="text-zero-400">Endpoint URL</span>
                <input
                  value={newWebhookUrl}
                  onChange={(event) => setNewWebhookUrl(event.target.value)}
                  placeholder="https://enterprise.example/hooks/zeroid"
                  type="url"
                  required
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
