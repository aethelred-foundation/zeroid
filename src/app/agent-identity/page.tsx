"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Fingerprint,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import {
  useAgent,
  useAgents,
  useApprovalQueue,
  useApproveAction,
  useRegisterAgent,
  useSuspendAgent,
  type AIAgentCapability,
  type AIAgentRecord,
  type AgentProtocol,
  type AgentRiskLevel,
  type RegisterAIAgentRequest,
} from "@/hooks/useAgentIdentity";
import {
  AGENT_PROTOCOLS,
  AGENT_RISK_LEVELS,
} from "@/lib/api/agent-passport-client";

type CapabilityDraft = Omit<AIAgentCapability, "resourceTypes" | "actions"> & {
  resourceTypes: string;
  actions: string;
};

interface RegistrationDraft {
  agentName: string;
  agentDescription: string;
  agentProtocol: AgentProtocol;
  publicKey: string;
  maxDelegationDepth: number;
  capabilities: CapabilityDraft[];
}

const inputClass =
  "w-full rounded-lg border border-zero-700 bg-zero-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";

const emptyCapability = (): CapabilityDraft => ({
  name: "",
  description: "",
  resourceTypes: "",
  actions: "",
  riskLevel: "low",
  requiresApproval: true,
});

const emptyRegistration = (): RegistrationDraft => ({
  agentName: "",
  agentDescription: "",
  agentProtocol: "aethelred_native",
  publicKey: "",
  maxDelegationDepth: 2,
  capabilities: [emptyCapability()],
});

const statusStyle: Record<AIAgentRecord["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  suspended: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  revoked: "border-red-500/30 bg-red-500/10 text-red-300",
};

const riskStyle: Record<AgentRiskLevel, string> = {
  low: "text-sky-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-red-300",
};

function splitValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

function RegistrationDialog({ onClose }: { onClose: () => void }) {
  const registration = useRegisterAgent();
  const [draft, setDraft] = useState<RegistrationDraft>(emptyRegistration);
  const [formError, setFormError] = useState<string | null>(null);

  const updateCapability = (
    index: number,
    update: Partial<CapabilityDraft>,
  ) => {
    setDraft((current) => ({
      ...current,
      capabilities: current.capabilities.map((capability, capabilityIndex) =>
        capabilityIndex === index ? { ...capability, ...update } : capability,
      ),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const capabilities = draft.capabilities.map((capability) => ({
      name: capability.name.trim(),
      description: capability.description.trim(),
      resourceTypes: splitValues(capability.resourceTypes),
      actions: splitValues(capability.actions),
      riskLevel: capability.riskLevel,
      requiresApproval:
        capability.riskLevel === "critical"
          ? true
          : capability.requiresApproval,
    }));

    if (
      capabilities.some(
        (capability) =>
          capability.resourceTypes.length === 0 ||
          capability.actions.length === 0,
      )
    ) {
      setFormError(
        "Every capability needs at least one resource type and action.",
      );
      return;
    }

    const request: RegisterAIAgentRequest = {
      agentName: draft.agentName.trim(),
      agentDescription: draft.agentDescription.trim(),
      agentProtocol: draft.agentProtocol,
      capabilities,
      publicKey: draft.publicKey.trim(),
      maxDelegationDepth: draft.maxDelegationDepth,
      teeRequired: false,
    };

    try {
      await registration.mutateAsync(request);
      onClose();
    } catch {
      // The mutation renders its backend error below and emits the toast.
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="presentation"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-agent-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zero-700 bg-zero-900 shadow-2xl"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-zero-800 bg-zero-900/95 px-6 py-5 backdrop-blur">
          <div>
            <h2 id="register-agent-title" className="text-lg font-semibold">
              Register AI agent
            </h2>
            <p className="mt-1 text-xs text-zero-400">
              Submit the agent runtime&apos;s public identity and
              least-privilege capabilities.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zero-400 transition hover:bg-zero-800 hover:text-white"
            aria-label="Close registration"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-7 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-xs font-medium text-zero-300">
              Agent name
              <input
                className={inputClass}
                value={draft.agentName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    agentName: event.target.value,
                  }))
                }
                minLength={3}
                maxLength={100}
                required
              />
            </label>
            <label className="space-y-2 text-xs font-medium text-zero-300">
              Protocol
              <select
                className={inputClass}
                value={draft.agentProtocol}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    agentProtocol: event.target.value as AgentProtocol,
                  }))
                }
              >
                {AGENT_PROTOCOLS.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {protocol.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-2 text-xs font-medium text-zero-300">
            Agent description
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={draft.agentDescription}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  agentDescription: event.target.value,
                }))
              }
              minLength={10}
              maxLength={1000}
              required
            />
          </label>

          <div className="space-y-2">
            <label
              className="text-xs font-medium text-zero-300"
              htmlFor="agent-public-key"
            >
              Ed25519 public key (PEM)
            </label>
            <textarea
              id="agent-public-key"
              className={`${inputClass} min-h-28 resize-y font-mono text-xs`}
              value={draft.publicKey}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  publicKey: event.target.value,
                }))
              }
              placeholder="-----BEGIN PUBLIC KEY-----"
              minLength={32}
              maxLength={512}
              required
            />
            <p className="text-[11px] leading-relaxed text-zero-500">
              Keep the private key inside the agent runtime. ZeroID stores only
              this public key and its SHA-256 fingerprint.
            </p>
          </div>

          <label className="block max-w-xs space-y-2 text-xs font-medium text-zero-300">
            Maximum delegation depth
            <select
              className={inputClass}
              value={draft.maxDelegationDepth}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  maxDelegationDepth: Number(event.target.value),
                }))
              }
            >
              {[0, 1, 2, 3, 4, 5].map((depth) => (
                <option key={depth} value={depth}>
                  {depth}
                </option>
              ))}
            </select>
          </label>

          <section className="space-y-4 border-t border-zero-800 pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Capabilities</h3>
                <p className="mt-1 text-xs text-zero-500">
                  Each grant is sent exactly as an API capability record.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    capabilities: [...current.capabilities, emptyCapability()],
                  }))
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-zero-700 px-3 py-2 text-xs text-zero-200 transition hover:border-zero-500 hover:bg-zero-800"
              >
                <Plus className="h-3.5 w-3.5" /> Add capability
              </button>
            </div>

            {draft.capabilities.map((capability, index) => (
              <div
                key={index}
                className="space-y-4 rounded-xl border border-zero-800 bg-zero-950/45 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zero-300">
                    Capability {index + 1}
                  </span>
                  {draft.capabilities.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          capabilities: current.capabilities.filter(
                            (_, capabilityIndex) => capabilityIndex !== index,
                          ),
                        }))
                      }
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-xs text-zero-400">
                    Capability name
                    <input
                      className={inputClass}
                      value={capability.name}
                      onChange={(event) =>
                        updateCapability(index, { name: event.target.value })
                      }
                      maxLength={100}
                      required
                    />
                  </label>
                  <label className="space-y-2 text-xs text-zero-400">
                    Risk level
                    <select
                      className={inputClass}
                      value={capability.riskLevel}
                      onChange={(event) =>
                        updateCapability(index, {
                          riskLevel: event.target.value as AgentRiskLevel,
                        })
                      }
                    >
                      {AGENT_RISK_LEVELS.map((risk) => (
                        <option key={risk} value={risk}>
                          {risk}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-2 text-xs text-zero-400">
                  Description
                  <input
                    className={inputClass}
                    value={capability.description}
                    onChange={(event) =>
                      updateCapability(index, {
                        description: event.target.value,
                      })
                    }
                    minLength={5}
                    maxLength={500}
                    required
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-xs text-zero-400">
                    Resource types (comma-separated)
                    <input
                      className={inputClass}
                      value={capability.resourceTypes}
                      onChange={(event) =>
                        updateCapability(index, {
                          resourceTypes: event.target.value,
                        })
                      }
                      placeholder="credential, identity"
                      required
                    />
                  </label>
                  <label className="space-y-2 text-xs text-zero-400">
                    Actions (comma-separated)
                    <input
                      className={inputClass}
                      value={capability.actions}
                      onChange={(event) =>
                        updateCapability(index, { actions: event.target.value })
                      }
                      placeholder="read, verify"
                      required
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-zero-300">
                  <input
                    type="checkbox"
                    checked={
                      capability.riskLevel === "critical" ||
                      capability.requiresApproval
                    }
                    disabled={capability.riskLevel === "critical"}
                    onChange={(event) =>
                      updateCapability(index, {
                        requiresApproval: event.target.checked,
                      })
                    }
                    className="rounded border-zero-600 bg-zero-900 text-brand-500"
                  />
                  Require human approval
                </label>
              </div>
            ))}
          </section>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-100/80">
            TEE enrollment is not available in this registration flow, so the
            request is submitted with <code>teeRequired=false</code>.
          </div>

          {(formError || registration.error) && (
            <p role="alert" className="text-sm text-red-300">
              {formError ?? errorMessage(registration.error)}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-zero-800 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zero-700 px-4 py-2.5 text-sm text-zero-300 transition hover:bg-zero-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={registration.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {registration.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Register agent
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AgentInspector({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId);
  const suspension = useSuspendAgent();
  const [showSuspend, setShowSuspend] = useState(false);
  const [reason, setReason] = useState("");

  if (agent.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center text-zero-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading agent
      </div>
    );
  }

  if (agent.isError || !agent.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-300">
          {errorMessage(agent.error ?? new Error("Agent was not returned."))}
        </p>
        <button
          type="button"
          onClick={() => void agent.refetch()}
          className="mt-4 inline-flex items-center gap-2 text-xs text-zero-300 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  const record = agent.data;
  const handleSuspend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await suspension.mutateAsync({
        agentId: record.agentId,
        reason: reason.trim(),
      });
      setShowSuspend(false);
      setReason("");
    } catch {
      // The mutation renders its backend error below and emits the toast.
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4 border-b border-zero-800 pb-5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zero-500">
            Agent profile
          </p>
          <h2 className="mt-2 truncate text-lg font-semibold">
            {record.agentName}
          </h2>
          <p className="mt-1 break-all font-mono text-[11px] text-zero-500">
            {record.did}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${statusStyle[record.status]}`}
        >
          {record.status}
        </span>
      </div>

      <p className="py-5 text-sm leading-relaxed text-zero-300">
        {record.agentDescription}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-zero-800 py-5 text-xs">
        <div>
          <dt className="text-zero-500">Protocol</dt>
          <dd className="mt-1 text-zero-200">
            {record.agentProtocol.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Total actions</dt>
          <dd className="mt-1 text-zero-200">
            {formatNumber(record.stats.totalActions)}
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Success rate</dt>
          <dd className="mt-1 text-zero-200">
            {(record.stats.successRate * 100).toFixed(1)}%
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Average latency</dt>
          <dd className="mt-1 text-zero-200">
            {record.stats.averageLatencyMs.toFixed(1)} ms
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Anomalies</dt>
          <dd className="mt-1 text-zero-200">
            {formatNumber(record.stats.anomalyCount)}
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Last active</dt>
          <dd className="mt-1 text-zero-200">
            {formatDate(record.lastActiveAt)}
          </dd>
        </div>
        <div>
          <dt className="text-zero-500">Delegation depth</dt>
          <dd className="mt-1 text-zero-200">{record.maxDelegationDepth}</dd>
        </div>
        <div>
          <dt className="text-zero-500">TEE</dt>
          <dd className="mt-1 text-zero-200">
            {record.teeAttested ? "Attested" : "Not attested"}
          </dd>
        </div>
      </dl>

      <div className="space-y-3 py-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-zero-300">
          <KeyRound className="h-3.5 w-3.5 text-brand-400" /> Public key
          fingerprint
        </div>
        <p className="break-all rounded-lg bg-zero-950 px-3 py-2 font-mono text-[10px] text-zero-400">
          {record.publicKeyHash}
        </p>
      </div>

      <div className="space-y-3 border-t border-zero-800 pt-5">
        <h3 className="text-xs font-semibold text-zero-300">Capabilities</h3>
        {record.capabilities.length === 0 ? (
          <p className="text-xs text-zero-500">No capabilities returned.</p>
        ) : (
          record.capabilities.map((capability) => (
            <div
              key={capability.name}
              className="border-l border-zero-700 pl-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-zero-200">
                  {capability.name}
                </span>
                <span
                  className={`text-[10px] uppercase ${riskStyle[capability.riskLevel]}`}
                >
                  {capability.riskLevel}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zero-500">
                {capability.description}
              </p>
              <p className="mt-1 text-[10px] text-zero-600">
                {capability.resourceTypes.join(", ")} ·{" "}
                {capability.actions.join(", ")}
                {capability.requiresApproval ? " · approval required" : ""}
              </p>
            </div>
          ))
        )}
      </div>

      {record.suspension && (
        <div className="mt-5 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-xs text-orange-100/80">
          Suspended {formatDate(record.suspension.suspendedAt)}:{" "}
          {record.suspension.reason}
        </div>
      )}

      {record.status === "active" && (
        <div className="mt-6 border-t border-zero-800 pt-5">
          {!showSuspend ? (
            <button
              type="button"
              onClick={() => setShowSuspend(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-500/30 px-3 py-2 text-xs font-medium text-orange-300 transition hover:bg-orange-500/10"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Suspend agent
            </button>
          ) : (
            <form onSubmit={handleSuspend} className="space-y-3">
              <label className="block space-y-2 text-xs text-zero-300">
                Suspension reason
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={5}
                  maxLength={1000}
                  required
                />
              </label>
              {suspension.error && (
                <p role="alert" className="text-xs text-red-300">
                  {errorMessage(suspension.error)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={suspension.isPending}
                  className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Confirm suspension
                </button>
                <button
                  type="button"
                  onClick={() => setShowSuspend(false)}
                  className="rounded-lg px-3 py-2 text-xs text-zero-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentIdentityPage() {
  const agents = useAgents();
  const approvals = useApprovalQueue();
  const approvalAction = useApproveAction();
  const [query, setQuery] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);

  const records = useMemo(() => agents.data ?? [], [agents.data]);
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((agent) =>
      [
        agent.agentName,
        agent.did,
        agent.agentProtocol,
        ...agent.capabilities.map((capability) => capability.name),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [query, records]);

  const totals = useMemo(
    () => ({
      active: records.filter((agent) => agent.status === "active").length,
      actions: records.reduce(
        (sum, agent) => sum + agent.stats.totalActions,
        0,
      ),
      anomalies: records.reduce(
        (sum, agent) => sum + agent.stats.anomalyCount,
        0,
      ),
    }),
    [records],
  );

  if (agents.accessState !== "ready") {
    return (
      <AppLayout>
        <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-10 sm:px-6">
          <div className="w-full border-y border-zero-800 py-14 text-center">
            <Fingerprint className="mx-auto h-9 w-9 text-brand-400" />
            <h1 className="mt-5 text-2xl font-semibold">AI Agent Identity</h1>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-zero-400">
              {agents.accessState === "wallet-required"
                ? "Connect your operator wallet to access its registered AI agents."
                : "Sign in to your ZeroID identity before loading or registering AI agents."}
            </p>
            {agents.accessState === "sign-in-required" && (
              <Link
                href="/identity"
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-500"
              >
                Open identity sign-in <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-zero-800 pb-7 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-brand-400">
              <Fingerprint className="h-4 w-4" /> Agent registry
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              AI Agent Identity
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zero-400">
              Register cryptographic agent identities, inspect durable activity,
              and resolve owner approval requests.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRegistration(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-500"
          >
            <Plus className="h-4 w-4" /> Register agent
          </button>
        </header>

        <section
          aria-label="Agent totals"
          className="grid grid-cols-2 divide-x divide-y divide-zero-800 border-y border-zero-800 sm:grid-cols-4 sm:divide-y-0"
        >
          {[
            ["Registered", records.length],
            ["Active", totals.active],
            ["Total actions", totals.actions],
            ["Anomalies", totals.anomalies],
          ].map(([label, value]) => (
            <div key={label} className="px-4 py-4 sm:px-6">
              <div className="text-xs text-zero-500">{label}</div>
              <div className="mt-1 text-xl font-semibold">
                {formatNumber(value as number)}
              </div>
            </div>
          ))}
        </section>

        {agents.isPending ? (
          <div className="flex min-h-80 items-center justify-center border-y border-zero-800 text-sm text-zero-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading registered
            agents
          </div>
        ) : agents.isError ? (
          <div className="border-y border-red-500/20 py-12 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-red-300" />
            <p className="mt-3 text-sm text-red-200">
              {errorMessage(agents.error)}
            </p>
            <button
              type="button"
              onClick={() => void agents.refetch()}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-zero-700 px-3 py-2 text-xs text-zero-300 hover:bg-zero-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="border-y border-zero-800 py-16 text-center">
            <Bot className="mx-auto h-8 w-8 text-zero-500" />
            <h2 className="mt-4 text-base font-semibold">
              No registered agents
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zero-500">
              Register an agent runtime with its public key and explicit
              capabilities. No sample agents are shown.
            </p>
            <button
              type="button"
              onClick={() => setShowRegistration(true)}
              className="mt-5 text-sm font-medium text-brand-300 hover:text-brand-200"
            >
              Register the first agent
            </button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
            <section>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zero-500" />
                <input
                  type="search"
                  aria-label="Search agents"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={`${inputClass} pl-9`}
                  placeholder="Search name, DID, protocol, or capability"
                />
              </div>

              <div className="divide-y divide-zero-800 border-y border-zero-800">
                <AnimatePresence initial={false}>
                  {filteredAgents.map((agent) => (
                    <motion.button
                      layout
                      key={agent.agentId}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.agentId)}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className={`flex w-full items-center gap-4 px-3 py-4 text-left transition hover:bg-zero-900/70 ${
                        selectedAgentId === agent.agentId ? "bg-zero-900" : ""
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zero-700 bg-zero-900">
                        <Bot className="h-4 w-4 text-brand-300" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {agent.agentName}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${statusStyle[agent.status]}`}
                          >
                            {agent.status}
                          </span>
                        </span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-zero-500">
                          {agent.did}
                        </span>
                      </span>
                      <span className="hidden text-right sm:block">
                        <span className="block text-xs text-zero-300">
                          {formatNumber(agent.stats.totalActions)} actions
                        </span>
                        <span className="mt-1 block text-[10px] text-zero-500">
                          {agent.capabilities.length} capabilities
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-zero-600" />
                    </motion.button>
                  ))}
                </AnimatePresence>
                {filteredAgents.length === 0 && (
                  <p className="px-4 py-12 text-center text-sm text-zero-500">
                    No agents match “{query}”.
                  </p>
                )}
              </div>
            </section>

            <aside className="min-h-80 rounded-xl border border-zero-800 bg-zero-900/45">
              {selectedAgentId ? (
                <AgentInspector agentId={selectedAgentId} />
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center px-8 text-center">
                  <Fingerprint className="h-7 w-7 text-zero-600" />
                  <h2 className="mt-4 text-sm font-medium">Select an agent</h2>
                  <p className="mt-2 text-xs leading-relaxed text-zero-500">
                    Inspect its backend profile, returned statistics,
                    capabilities, key fingerprint, and lifecycle controls.
                  </p>
                </div>
              )}
            </aside>
          </div>
        )}

        <section className="border-t border-zero-800 pt-7">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-amber-300" />
                <h2 className="text-base font-semibold">Approval queue</h2>
              </div>
              <p className="mt-2 text-xs text-zero-500">
                Pending human decisions returned for this operator identity.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void approvals.refetch()}
              className="inline-flex items-center gap-2 text-xs text-zero-400 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          <div className="mt-5 divide-y divide-zero-800 border-y border-zero-800">
            {approvals.isPending ? (
              <p className="py-8 text-center text-sm text-zero-500">
                Loading approval queue…
              </p>
            ) : approvals.isError ? (
              <p className="py-8 text-center text-sm text-red-300">
                {errorMessage(approvals.error)}
              </p>
            ) : approvals.data?.length ? (
              approvals.data.map((approval) => {
                const agentName = records.find(
                  (agent) => agent.agentId === approval.agentId,
                )?.agentName;
                const resolving =
                  approvalAction.isPending &&
                  approvalAction.variables?.requestId === approval.requestId;
                return (
                  <div
                    key={approval.requestId}
                    className="grid gap-4 px-2 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {approval.actionDescription}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase ${riskStyle[approval.riskLevel]}`}
                        >
                          {approval.riskLevel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zero-500">
                        {agentName ?? approval.agentId} · requested{" "}
                        {formatDate(approval.requestedAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={resolving}
                        onClick={() =>
                          approvalAction.mutate({
                            requestId: approval.requestId,
                            approved: true,
                            note: "Approved by the owning operator.",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={resolving}
                        onClick={() =>
                          approvalAction.mutate({
                            requestId: approval.requestId,
                            approved: false,
                            note: "Rejected by the owning operator.",
                          })
                        }
                        className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-medium text-red-300 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-sm text-zero-500">
                No pending approvals.
              </p>
            )}
          </div>
        </section>

        <aside className="grid gap-3 border-t border-zero-800 pt-6 text-xs leading-relaxed text-zero-500 sm:grid-cols-3">
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Agent records and counters on this page come from the authenticated
            backend response.
          </div>
          <div className="flex gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            Approval and delegation workflows are not presented as durable
            history until backend persistence is completed.
          </div>
          <div className="flex gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
            TEE-backed onboarding is unavailable; registration never claims an
            attestation.
          </div>
        </aside>
      </main>

      <AnimatePresence>
        {showRegistration && (
          <RegistrationDialog onClose={() => setShowRegistration(false)} />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
