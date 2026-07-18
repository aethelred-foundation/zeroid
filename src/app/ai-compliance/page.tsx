"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileKey2,
  Fingerprint,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/contexts/IdentityContext";
import {
  type ComplianceAlert,
  type ScreeningResult,
  useAcknowledgeAlert,
  useComplianceAlerts,
  useRiskAssessment,
  useScreenIdentity,
} from "@/hooks/useAICompliance";

type WorkspaceTab = "alerts" | "screening" | "risk";

type ScreeningFormState = {
  identityId: string;
  fullName: string;
  jurisdiction: string;
  nationality: string;
  dateOfBirth: string;
  aliases: string;
  documentNumbers: string;
};

const INITIAL_SCREENING_FORM: ScreeningFormState = {
  identityId: "",
  fullName: "",
  jurisdiction: "AE",
  nationality: "",
  dateOfBirth: "",
  aliases: "",
  documentNumbers: "",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const tabs = [
  { id: "alerts" as const, label: "Organization alerts", icon: ShieldAlert },
  { id: "screening" as const, label: "Identity screening", icon: Search },
  { id: "risk" as const, label: "Risk assessment", icon: ClipboardCheck },
];

function formatTimestamp(value?: string): string {
  if (!value) return "Unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function splitOptionalList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function alertTone(level: ComplianceAlert["level"]): string {
  switch (level) {
    case "critical":
    case "violation":
    case "high":
      return "border-red-500/25 bg-red-500/5 text-red-200";
    case "warning":
    case "medium":
      return "border-amber-500/25 bg-amber-500/5 text-amber-100";
    default:
      return "border-cyan-500/20 bg-cyan-500/5 text-cyan-100";
  }
}

function ScreeningEvidence({ result }: { result: ScreeningResult }) {
  const matchCount = result.matchedLists.length + result.pepMatches.length;
  const clear = result.result === "clear";

  return (
    <section
      className="mt-6 border-t border-[var(--border-primary)] pt-6"
      aria-label="Screening result"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {clear ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            )}
            <h3 className="font-semibold text-[var(--text-primary)]">
              {result.result.replaceAll("_", " ")}
            </h3>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Screening {result.screeningId} · completed{" "}
            {formatTimestamp(result.screenedAt)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-right text-xs">
          <div>
            <dt className="text-[var(--text-tertiary)]">Match score</dt>
            <dd className="mt-1 font-semibold text-[var(--text-primary)]">
              {result.matchScore}/100
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">Review items</dt>
            <dd className="mt-1 font-semibold text-[var(--text-primary)]">
              {matchCount}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Sources checked ({result.listsChecked.length})
          </h4>
          {result.listsChecked.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
              {result.listsChecked.map((source) => (
                <li key={source} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  {source}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-amber-200">
              The service did not report any completed list checks.
            </p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Unavailable checks
          </h4>
          {result.unavailableChecks.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-amber-200">
              {result.unavailableChecks.map((check) => (
                <li key={check}>{check.replaceAll("_", " ")}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              None reported by the screening service.
            </p>
          )}
        </div>
      </div>

      {result.matchedLists.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Sanctions matches
          </h4>
          <div className="mt-2 divide-y divide-[var(--border-primary)] border-y border-[var(--border-primary)]">
            {result.matchedLists.map((match, index) => (
              <div
                key={`${match.listSource}-${match.sdnId ?? match.matchedName}-${index}`}
                className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="font-medium text-[var(--text-primary)]">
                    {match.matchedName}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {match.listName} · {match.entityType}
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <div className="font-mono text-sm text-amber-200">
                    {(match.matchConfidence * 100).toFixed(1)}%
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                    source confidence
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.pepMatches.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            PEP matches
          </h4>
          <div className="mt-2 divide-y divide-[var(--border-primary)] border-y border-[var(--border-primary)]">
            {result.pepMatches.map((match, index) => (
              <div
                key={`${match.source}-${match.name}-${index}`}
                className="py-3 text-sm"
              >
                <div className="font-medium text-[var(--text-primary)]">
                  {match.name}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {match.position} · {match.country} · {match.source}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function AICompliancePage() {
  const { address, isConnected } = useAccount();
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("alerts");
  const [screeningForm, setScreeningForm] = useState(INITIAL_SCREENING_FORM);
  const [screeningValidationError, setScreeningValidationError] = useState<
    string | null
  >(null);
  const [riskIdentityInput, setRiskIdentityInput] = useState("");
  const [riskJurisdictionInput, setRiskJurisdictionInput] = useState("AE");
  const [riskTarget, setRiskTarget] = useState<{
    identityId: string;
    jurisdiction: string;
  } | null>(null);
  const [riskValidationError, setRiskValidationError] = useState<string | null>(
    null,
  );

  const authenticated =
    Boolean(isConnected && address && identity.isRegistered) &&
    sessionStatus === "authenticated";
  const alertsQuery = useComplianceAlerts(authenticated);
  const acknowledgeAlert = useAcknowledgeAlert();
  const screenIdentity = useScreenIdentity();
  const riskQuery = useRiskAssessment(riskTarget?.identityId, {
    enabled: authenticated && Boolean(riskTarget),
    jurisdiction: riskTarget?.jurisdiction,
    entityType: "identity",
  });

  const alertCounts = useMemo(() => {
    const alerts = alertsQuery.data?.alerts ?? [];
    return {
      total: alerts.length,
      urgent: alerts.filter((alert) =>
        ["critical", "violation", "high"].includes(alert.level),
      ).length,
      acknowledged: alerts.filter((alert) => Boolean(alert.acknowledgedAt))
        .length,
    };
  }, [alertsQuery.data]);

  const submitScreening = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const identityId = screeningForm.identityId.trim();
    const fullName = screeningForm.fullName.trim();
    const jurisdiction = screeningForm.jurisdiction.trim().toUpperCase();
    const nationality = screeningForm.nationality.trim().toUpperCase();

    if (!UUID_PATTERN.test(identityId)) {
      setScreeningValidationError("Identity ID must be a valid UUID.");
      return;
    }
    if (fullName.length < 2) {
      setScreeningValidationError("Enter the subject name used for screening.");
      return;
    }
    if (jurisdiction.length < 2 || jurisdiction.length > 10) {
      setScreeningValidationError("Enter a valid jurisdiction code.");
      return;
    }

    setScreeningValidationError(null);
    await screenIdentity.mutateAsync({
      identityId,
      fullName,
      jurisdiction,
      ...(nationality ? { nationality } : {}),
      ...(screeningForm.dateOfBirth
        ? { dateOfBirth: screeningForm.dateOfBirth }
        : {}),
      ...(splitOptionalList(screeningForm.aliases)
        ? { aliases: splitOptionalList(screeningForm.aliases) }
        : {}),
      ...(splitOptionalList(screeningForm.documentNumbers)
        ? { documentNumbers: splitOptionalList(screeningForm.documentNumbers) }
        : {}),
    });
  };

  const submitRiskAssessment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const identityId = riskIdentityInput.trim();
    const jurisdiction = riskJurisdictionInput.trim().toUpperCase();
    if (!UUID_PATTERN.test(identityId)) {
      setRiskValidationError("Identity ID must be a valid UUID.");
      return;
    }
    if (jurisdiction.length < 2 || jurisdiction.length > 10) {
      setRiskValidationError("Enter a valid jurisdiction code.");
      return;
    }
    setRiskValidationError(null);
    setRiskTarget({ identityId, jurisdiction });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex flex-col gap-4 border-b border-[var(--border-primary)] pb-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-7 w-7 text-brand-400" />
              <h1 className="text-2xl font-bold">Compliance operations</h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Organization-scoped screening, stored alerts, and risk evidence
              returned by the ZeroID backend.
            </p>
          </div>
          {authenticated && alertsQuery.data && (
            <div className="flex gap-6 text-right text-xs">
              <div>
                <div className="text-[var(--text-tertiary)]">Open alerts</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {alertCounts.total}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-tertiary)]">Urgent</div>
                <div className="mt-1 text-lg font-semibold text-red-300">
                  {alertCounts.urgent}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-tertiary)]">Acknowledged</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {alertCounts.acknowledged}
                </div>
              </div>
            </div>
          )}
        </motion.header>

        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-100">
            Evidence console, not legal advice
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            Regulatory guidance, generated legal reports, adverse-media checks,
            and impact modelling are not shown unless an authoritative provider
            and approved policy mapping are configured. A clear sanctions result
            applies only to the sources listed in that result.
          </p>
        </section>

        {!isConnected || !address ? (
          <section className="card p-10 text-center" role="status">
            <Fingerprint className="mx-auto h-9 w-9 text-amber-300" />
            <h2 className="mt-3 font-semibold">Connect an operator wallet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Compliance records are tenant-scoped and are not requested before
              a wallet is connected.
            </p>
          </section>
        ) : identity.isLoading ? (
          <section
            className="card flex items-center justify-center gap-3 p-10 text-sm text-[var(--text-secondary)]"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
            Checking the connected ZeroID identity...
          </section>
        ) : !identity.isRegistered ? (
          <section className="card p-10 text-center" role="status">
            <ShieldAlert className="mx-auto h-9 w-9 text-amber-300" />
            <h2 className="mt-3 font-semibold">Register this wallet first</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              The compliance API requires an active ZeroID identity and an
              enterprise organization role.
            </p>
            <Link href="/identity" className="btn-primary mt-5 inline-flex">
              Open identity setup
            </Link>
          </section>
        ) : sessionStatus !== "authenticated" ? (
          <section className="card p-10 text-center" role="status">
            <FileKey2 className="mx-auto h-9 w-9 text-cyan-300" />
            <h2 className="mt-3 font-semibold">Sign in to continue</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Sign the one-time ZeroID challenge with this wallet before any
              compliance request is sent.
            </p>
            {sessionError && (
              <p
                className="mx-auto mt-3 max-w-xl text-xs text-red-300"
                role="alert"
              >
                {sessionError}
              </p>
            )}
            <button
              type="button"
              disabled={sessionStatus === "signing"}
              onClick={() => {
                void signIn().catch(() => {
                  // IdentityContext exposes the actionable authentication error.
                });
              }}
              className="btn-primary mt-5 disabled:cursor-wait disabled:opacity-60"
            >
              {sessionStatus === "signing"
                ? "Signing..."
                : "Sign in with wallet"}
            </button>
          </section>
        ) : (
          <>
            <nav
              className="flex flex-wrap gap-2 border-b border-[var(--border-primary)] pb-3"
              aria-label="Compliance workspace"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeTab === tab.id
                      ? "bg-brand-600 text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </nav>

            <AnimatePresence mode="wait">
              {activeTab === "alerts" && (
                <motion.section
                  key="alerts"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="card p-5"
                  aria-labelledby="alerts-heading"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 id="alerts-heading" className="font-semibold">
                        Active organization alerts
                      </h2>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Compliance and fraud alerts restricted to identities in
                        the resolved organization.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void alertsQuery.refetch()}
                      disabled={alertsQuery.isFetching}
                      className="btn-secondary disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${alertsQuery.isFetching ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </button>
                  </div>

                  {alertsQuery.isPending ? (
                    <div
                      className="flex items-center justify-center gap-3 py-14 text-sm text-[var(--text-secondary)]"
                      role="status"
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                      Loading organization alerts...
                    </div>
                  ) : alertsQuery.error ? (
                    <div
                      className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200"
                      role="alert"
                    >
                      {errorMessage(
                        alertsQuery.error,
                        "The alert request failed.",
                      )}
                    </div>
                  ) : alertsQuery.data?.alerts.length ? (
                    <div className="mt-5 divide-y divide-[var(--border-primary)] border-y border-[var(--border-primary)]">
                      {alertsQuery.data.alerts.map((alert) => (
                        <motion.article
                          key={alert.alertId}
                          whileHover={{ x: 2 }}
                          className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${alertTone(alert.level)}`}
                              >
                                {alert.level}
                              </span>
                              {alert.source && (
                                <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                                  {alert.source}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                              {alert.title}
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                              {alert.description}
                            </p>
                            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                              <div>
                                <dt className="text-[var(--text-tertiary)]">
                                  Required action
                                </dt>
                                <dd className="mt-1 text-[var(--text-secondary)]">
                                  {alert.actionRequired}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[var(--text-tertiary)]">
                                  Recorded
                                </dt>
                                <dd className="mt-1 text-[var(--text-secondary)]">
                                  {formatTimestamp(alert.createdAt)}
                                </dd>
                              </div>
                            </dl>
                          </div>
                          <div className="flex items-start lg:justify-end">
                            {alert.acknowledgedAt ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                                <CheckCircle2 className="h-4 w-4" />
                                Acknowledged
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void acknowledgeAlert.mutateAsync(
                                    alert.alertId,
                                  )
                                }
                                disabled={acknowledgeAlert.isPending}
                                className="btn-secondary disabled:opacity-60"
                              >
                                Acknowledge
                              </button>
                            )}
                          </div>
                        </motion.article>
                      ))}
                    </div>
                  ) : (
                    <div className="py-14 text-center" role="status">
                      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
                      <h3 className="mt-3 text-sm font-semibold">
                        No active alerts returned
                      </h3>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        This is an empty result from the current organization
                        scope, not a platform-wide assurance statement.
                      </p>
                    </div>
                  )}
                </motion.section>
              )}

              {activeTab === "screening" && (
                <motion.section
                  key="screening"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="card p-5"
                  aria-labelledby="screening-heading"
                >
                  <h2 id="screening-heading" className="font-semibold">
                    Screen an organization identity
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    The backend verifies that the target identity belongs to the
                    current organization before contacting configured list
                    providers.
                  </p>

                  <form
                    onSubmit={submitScreening}
                    className="mt-6 grid gap-4 md:grid-cols-2"
                  >
                    <label className="md:col-span-2">
                      <span className="label">Identity UUID</span>
                      <input
                        required
                        value={screeningForm.identityId}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            identityId: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full font-mono"
                        placeholder="550e8400-e29b-41d4-a716-446655440000"
                      />
                    </label>
                    <label>
                      <span className="label">Full legal name</span>
                      <input
                        required
                        minLength={2}
                        maxLength={200}
                        value={screeningForm.fullName}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            fullName: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full"
                      />
                    </label>
                    <label>
                      <span className="label">Date of birth (optional)</span>
                      <input
                        type="date"
                        value={screeningForm.dateOfBirth}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            dateOfBirth: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full"
                      />
                    </label>
                    <label>
                      <span className="label">Jurisdiction</span>
                      <input
                        required
                        minLength={2}
                        maxLength={10}
                        value={screeningForm.jurisdiction}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            jurisdiction: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full uppercase"
                      />
                    </label>
                    <label>
                      <span className="label">Nationality (optional)</span>
                      <input
                        minLength={2}
                        maxLength={3}
                        value={screeningForm.nationality}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            nationality: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full uppercase"
                      />
                    </label>
                    <label>
                      <span className="label">
                        Aliases (optional, comma separated)
                      </span>
                      <input
                        value={screeningForm.aliases}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            aliases: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full"
                      />
                    </label>
                    <label>
                      <span className="label">
                        Document numbers (optional, comma separated)
                      </span>
                      <input
                        value={screeningForm.documentNumbers}
                        onChange={(event) =>
                          setScreeningForm((current) => ({
                            ...current,
                            documentNumbers: event.target.value,
                          }))
                        }
                        className="input mt-1 w-full"
                      />
                    </label>
                    <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={screenIdentity.isPending}
                        className="btn-primary disabled:opacity-60"
                      >
                        {screenIdentity.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                        Run configured screening
                      </button>
                      {screeningValidationError && (
                        <span className="text-xs text-red-300" role="alert">
                          {screeningValidationError}
                        </span>
                      )}
                    </div>
                  </form>

                  {screenIdentity.error && (
                    <div
                      className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200"
                      role="alert"
                    >
                      {errorMessage(screenIdentity.error, "Screening failed.")}
                    </div>
                  )}
                  {screenIdentity.data && (
                    <ScreeningEvidence result={screenIdentity.data} />
                  )}
                </motion.section>
              )}

              {activeTab === "risk" && (
                <motion.section
                  key="risk"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="card p-5"
                  aria-labelledby="risk-heading"
                >
                  <h2 id="risk-heading" className="font-semibold">
                    Assess recorded risk evidence
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    This is a model output over available ZeroID records.
                    Missing evidence raises review factors and the result is not
                    a legal compliance certification.
                  </p>

                  <form
                    onSubmit={submitRiskAssessment}
                    className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
                  >
                    <label>
                      <span className="label">Identity UUID</span>
                      <input
                        required
                        value={riskIdentityInput}
                        onChange={(event) =>
                          setRiskIdentityInput(event.target.value)
                        }
                        className="input mt-1 w-full font-mono"
                        placeholder="550e8400-e29b-41d4-a716-446655440000"
                      />
                    </label>
                    <label>
                      <span className="label">Jurisdiction</span>
                      <input
                        required
                        minLength={2}
                        maxLength={10}
                        value={riskJurisdictionInput}
                        onChange={(event) =>
                          setRiskJurisdictionInput(event.target.value)
                        }
                        className="input mt-1 w-full uppercase"
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn-primary justify-center"
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      Assess
                    </button>
                  </form>
                  {riskValidationError && (
                    <p className="mt-3 text-xs text-red-300" role="alert">
                      {riskValidationError}
                    </p>
                  )}

                  {riskQuery.isFetching && (
                    <div
                      className="mt-6 flex items-center gap-3 border-t border-[var(--border-primary)] pt-6 text-sm text-[var(--text-secondary)]"
                      role="status"
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                      Calculating from available identity evidence...
                    </div>
                  )}
                  {riskQuery.error && (
                    <div
                      className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200"
                      role="alert"
                    >
                      {errorMessage(riskQuery.error, "Risk assessment failed.")}
                    </div>
                  )}
                  {riskQuery.data && !riskQuery.isFetching && (
                    <div className="mt-6 border-t border-[var(--border-primary)] pt-6">
                      <div className="grid gap-5 md:grid-cols-4">
                        <div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Risk score
                          </div>
                          <div className="mt-1 text-2xl font-semibold">
                            {riskQuery.data.riskAssessment.compositeScore}/100
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Decision
                          </div>
                          <div className="mt-1 text-sm font-semibold uppercase text-amber-200">
                            {riskQuery.data.riskAssessment.decision}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Confidence
                          </div>
                          <div className="mt-1 text-sm font-semibold">
                            {Math.round(
                              riskQuery.data.riskAssessment.confidence * 100,
                            )}
                            %
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Calculated
                          </div>
                          <div className="mt-1 text-sm">
                            {formatTimestamp(
                              riskQuery.data.riskAssessment.timestamp,
                            )}
                          </div>
                        </div>
                      </div>

                      <h3 className="mt-7 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                        Evidence factors (
                        {riskQuery.data.riskAssessment.factors.length})
                      </h3>
                      {riskQuery.data.riskAssessment.factors.length > 0 ? (
                        <div className="mt-2 divide-y divide-[var(--border-primary)] border-y border-[var(--border-primary)]">
                          {riskQuery.data.riskAssessment.factors.map(
                            (factor, index) => (
                              <div
                                key={`${factor.category}-${factor.name}-${index}`}
                                className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
                              >
                                <div>
                                  <div className="font-medium text-[var(--text-primary)]">
                                    {factor.name.replaceAll("_", " ")}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                                    {factor.explanation}
                                  </div>
                                </div>
                                <div className="font-mono text-xs text-[var(--text-secondary)] sm:text-right">
                                  {factor.normalizedScore}/100 · {factor.impact}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-[var(--text-secondary)]">
                          No factors were returned by the risk service.
                        </p>
                      )}
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </AppLayout>
  );
}
