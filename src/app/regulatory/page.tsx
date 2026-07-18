"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Database,
  FileWarning,
  Globe,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useAccount } from "wagmi";

import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/contexts/IdentityContext";
import {
  useCheckCrossBorder,
  useComplianceStatus,
  useDataSovereigntyStatus,
  useJurisdictionRequirements,
  useJurisdictions,
  type OperationType,
} from "@/hooks/useRegulatory";

const operationLabels: Record<OperationType, string> = {
  onboarding: "Onboarding",
  transaction: "Transaction",
  transfer: "Transfer",
  periodic_review: "Periodic review",
};

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as { statusCode?: number; code?: string } | null;
  return candidate?.statusCode === 404 || candidate?.code === "NOT_FOUND";
}

function statusStyle(status: string): string {
  if (status === "compliant" || status === "pass") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "non_compliant" || status === "fail") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function EvidenceBoundary() {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          <p className="font-semibold">Configured policy evidence only</p>
          <p className="mt-1 text-amber-100/80">
            This surface does not have a source-attributed regulator feed or a
            regulator filing gateway. ZeroID does not generate legal scores,
            statutory deadlines, filing confirmations, or legal conclusions
            here. Treat every result as an internal policy assessment that
            requires qualified review.
          </p>
        </div>
      </div>
    </div>
  );
}

function AuthenticationState({ isConnected }: { isConnected: boolean }) {
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();
  const [signInError, setSignInError] = useState<string | null>(null);

  if (!isConnected) {
    return (
      <div className="card p-8 text-center">
        <LockKeyhole className="mx-auto h-10 w-10 text-zero-500" />
        <h2 className="mt-3 font-semibold">Connect your wallet</h2>
        <p className="mt-1 text-sm text-zero-400">
          Regulatory policy evidence is protected enterprise data.
        </p>
      </div>
    );
  }

  if (identity.isLoading) {
    return (
      <div className="card flex items-center gap-3 p-6 text-sm text-zero-300">
        <Loader2 className="h-5 w-5 animate-spin" />
        Checking your ZeroID identity…
      </div>
    );
  }

  if (!identity.isRegistered) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="mt-3 font-semibold">ZeroID identity required</h2>
        <p className="mt-1 text-sm text-zero-400">
          Register an identity before accessing protected policy evidence.
        </p>
        <Link href="/identity" className="btn-primary mt-4 inline-flex">
          Open identity
        </Link>
      </div>
    );
  }

  if (sessionStatus !== "authenticated") {
    const visibleError = signInError ?? sessionError;
    return (
      <div className="card p-8 text-center">
        <LockKeyhole className="mx-auto h-10 w-10 text-brand-400" />
        <h2 className="mt-3 font-semibold">Sign in to ZeroID</h2>
        <p className="mt-1 text-sm text-zero-400">
          A wallet signature creates the authenticated session used by the
          enterprise compliance API.
        </p>
        {visibleError && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {visibleError}
          </p>
        )}
        <button
          type="button"
          className="btn-primary mt-4"
          disabled={sessionStatus === "signing"}
          onClick={() => {
            setSignInError(null);
            void signIn().catch((error) =>
              setSignInError(errorMessage(error, "ZeroID sign-in failed.")),
            );
          }}
        >
          {sessionStatus === "signing" ? "Signing…" : "Sign in"}
        </button>
      </div>
    );
  }

  return null;
}

export default function RegulatoryPage() {
  const { isConnected } = useAccount();
  const { identity, sessionStatus } = useIdentity();
  const authenticated = Boolean(
    isConnected && identity.isRegistered && sessionStatus === "authenticated",
  );
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string>();
  const [operationType, setOperationType] =
    useState<OperationType>("onboarding");
  const [sourceCode, setSourceCode] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [dataCategory, setDataCategory] = useState<
    "personal" | "financial" | "biometric" | "health" | "criminal"
  >("personal");
  const [purpose, setPurpose] = useState("");

  const jurisdictionsQuery = useJurisdictions({ enabled: authenticated });
  const requirementsQuery = useJurisdictionRequirements(
    selectedCode,
    operationType,
    { enabled: authenticated },
  );
  const complianceQuery = useComplianceStatus(selectedCode, {
    enabled: authenticated,
  });
  const sovereigntyQuery = useDataSovereigntyStatus({
    enabled: authenticated,
  });
  const crossBorder = useCheckCrossBorder({ enabled: authenticated });

  const jurisdictions = useMemo(
    () => jurisdictionsQuery.data ?? [],
    [jurisdictionsQuery.data],
  );
  const filteredJurisdictions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return jurisdictions;
    return jurisdictions.filter((jurisdiction) =>
      [
        jurisdiction.code,
        jurisdiction.name,
        jurisdiction.region,
        jurisdiction.regulatoryBody,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [jurisdictions, search]);

  const selectedJurisdiction = jurisdictions.find(
    (jurisdiction) => jurisdiction.code === selectedCode,
  );
  const effectiveSource = jurisdictions.some(
    (jurisdiction) => jurisdiction.code === sourceCode,
  )
    ? sourceCode
    : (jurisdictions[0]?.code ?? "");
  const effectiveTarget = jurisdictions.some(
    (jurisdiction) =>
      jurisdiction.code === targetCode && jurisdiction.code !== effectiveSource,
  )
    ? targetCode
    : (jurisdictions.find(
        (jurisdiction) => jurisdiction.code !== effectiveSource,
      )?.code ?? "");
  const canAssess = Boolean(
    authenticated &&
    effectiveSource &&
    effectiveTarget &&
    effectiveSource !== effectiveTarget &&
    purpose.trim().length >= 3 &&
    !crossBorder.isPending,
  );

  const resetAssessment = () => crossBorder.reset();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <Globe className="h-7 w-7 text-identity-steel" />
            <h1 className="text-2xl font-bold">Regulatory policy evidence</h1>
          </div>
          <p className="mt-1 text-sm text-zero-400">
            Inspect authenticated ZeroID policy configuration and recorded
            evaluation evidence without manufacturing legal claims.
          </p>
        </div>

        <EvidenceBoundary />

        {!authenticated ? (
          <AuthenticationState isConnected={isConnected} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card p-4">
                <p className="text-xs text-zero-500">
                  Configured jurisdictions
                </p>
                <p className="mt-2 text-2xl font-bold">
                  {jurisdictionsQuery.isLoading ? "—" : jurisdictions.length}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-zero-500">
                  Recorded residency entries
                </p>
                <p className="mt-2 text-2xl font-bold">
                  {sovereigntyQuery.data?.retentionRecords ?? "—"}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-zero-500">Authoritative feed</p>
                <p className="mt-2 font-semibold text-amber-300">Unavailable</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-zero-500">
                  Regulator filing gateway
                </p>
                <p className="mt-2 font-semibold text-amber-300">Unavailable</p>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <section className="card overflow-hidden">
                <div className="border-b border-zero-800 p-5">
                  <h2 className="font-semibold">
                    Configured jurisdiction catalog
                  </h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Internal policy configuration; not a live statement from a
                    regulator.
                  </p>
                  <label className="relative mt-4 block">
                    <span className="sr-only">Search jurisdictions</span>
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zero-500" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search configured jurisdictions"
                      className="w-full rounded-xl border border-zero-700 bg-zero-900 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-brand-500"
                    />
                  </label>
                </div>

                {jurisdictionsQuery.isLoading ? (
                  <div className="flex items-center gap-3 p-6 text-sm text-zero-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading authenticated policy configuration…
                  </div>
                ) : jurisdictionsQuery.isError ? (
                  <div className="p-6">
                    <p role="alert" className="text-sm text-red-300">
                      {errorMessage(
                        jurisdictionsQuery.error,
                        "The jurisdiction catalog could not be loaded.",
                      )}
                    </p>
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center gap-2 text-sm text-brand-300"
                      onClick={() => void jurisdictionsQuery.refetch()}
                    >
                      <RefreshCw className="h-4 w-4" /> Retry
                    </button>
                  </div>
                ) : filteredJurisdictions.length === 0 ? (
                  <p className="p-6 text-sm text-zero-400">
                    {jurisdictions.length === 0
                      ? "No configured jurisdictions were returned."
                      : "No configured jurisdiction matches this search."}
                  </p>
                ) : (
                  <div className="divide-y divide-zero-800/70">
                    {filteredJurisdictions.map((jurisdiction) => (
                      <button
                        type="button"
                        key={jurisdiction.code}
                        onClick={() =>
                          setSelectedCode((current) =>
                            current === jurisdiction.code
                              ? undefined
                              : jurisdiction.code,
                          )
                        }
                        className={`w-full p-4 text-left transition-colors hover:bg-zero-800/40 ${
                          selectedCode === jurisdiction.code
                            ? "bg-brand-500/10"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{jurisdiction.name}</p>
                            <p className="mt-1 text-xs text-zero-500">
                              {jurisdiction.code} ·{" "}
                              {humanize(jurisdiction.region)}
                            </p>
                          </div>
                          <span className="rounded-full border border-zero-700 px-2 py-1 text-[10px] text-zero-400">
                            CONFIGURED
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-4">
                {!selectedJurisdiction ? (
                  <div className="card p-8 text-center text-sm text-zero-400">
                    Select a configured jurisdiction to inspect its policy and
                    recorded evaluation evidence.
                  </div>
                ) : (
                  <>
                    <div className="card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">
                            {selectedJurisdiction.name}
                          </h2>
                          <p className="mt-1 text-xs text-zero-500">
                            {selectedJurisdiction.code}
                          </p>
                        </div>
                        <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-1 text-[10px] text-brand-200">
                          INTERNAL POLICY
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-zero-500">
                            Configured regulator label
                          </dt>
                          <dd className="mt-1">
                            {selectedJurisdiction.regulatoryBody}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">Reporting currency</dt>
                          <dd className="mt-1">
                            {selectedJurisdiction.reportingCurrency}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">
                            Configured retention
                          </dt>
                          <dd className="mt-1">
                            {selectedJurisdiction.retentionDays} days
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">Consent model</dt>
                          <dd className="mt-1">
                            {humanize(selectedJurisdiction.consentModel)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">
                            Residency rule configured
                          </dt>
                          <dd className="mt-1">
                            {selectedJurisdiction.dataResidencyRequired
                              ? "Yes"
                              : "No"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">
                            Cross-border restriction configured
                          </dt>
                          <dd className="mt-1">
                            {selectedJurisdiction.crossBorderRestricted
                              ? "Yes"
                              : "No"}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="card p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">
                            Required credential policy
                          </h3>
                          <p className="mt-1 text-xs text-zero-500">
                            Accepted issuers and statutory validity are not
                            asserted.
                          </p>
                        </div>
                        <select
                          aria-label="Operation type"
                          value={operationType}
                          onChange={(event) =>
                            setOperationType(
                              event.target.value as OperationType,
                            )
                          }
                          className="rounded-lg border border-zero-700 bg-zero-900 px-3 py-2 text-sm"
                        >
                          {Object.entries(operationLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                      {requirementsQuery.isLoading ? (
                        <p className="mt-4 text-sm text-zero-400">
                          Loading policy…
                        </p>
                      ) : requirementsQuery.isError ? (
                        <p role="alert" className="mt-4 text-sm text-red-300">
                          {errorMessage(
                            requirementsQuery.error,
                            "Configured requirements could not be loaded.",
                          )}
                        </p>
                      ) : requirementsQuery.data ? (
                        <div className="mt-4 space-y-3">
                          {requirementsQuery.data.requiredCredentials.length >
                          0 ? (
                            <ul className="space-y-2">
                              {requirementsQuery.data.requiredCredentials.map(
                                (credential) => (
                                  <li
                                    key={credential.credentialType}
                                    className="flex items-center justify-between rounded-lg bg-zero-800/50 px-3 py-2 text-sm"
                                  >
                                    <span>{credential.label}</span>
                                    <code className="text-xs text-zero-500">
                                      {credential.credentialType}
                                    </code>
                                  </li>
                                ),
                              )}
                            </ul>
                          ) : (
                            <p className="text-sm text-zero-400">
                              No credential types are configured for this
                              operation.
                            </p>
                          )}
                          <p className="text-xs text-amber-200">
                            External authority verification: unavailable
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="card p-5">
                      <h3 className="font-semibold">
                        Recorded compliance evaluation
                      </h3>
                      <p className="mt-1 text-xs text-zero-500">
                        A status appears only after the backend records an
                        evaluation for this wallet and jurisdiction.
                      </p>
                      {complianceQuery.isLoading ? (
                        <p className="mt-4 text-sm text-zero-400">
                          Loading recorded evaluation…
                        </p>
                      ) : complianceQuery.isError &&
                        isNotFoundError(complianceQuery.error) ? (
                        <div className="mt-4 rounded-xl border border-zero-700 p-3 text-sm text-zero-300">
                          No recorded evaluation is available. ZeroID will not
                          infer a score or compliance status from missing
                          evidence.
                        </div>
                      ) : complianceQuery.isError ? (
                        <p role="alert" className="mt-4 text-sm text-red-300">
                          {errorMessage(
                            complianceQuery.error,
                            "Recorded evaluation evidence could not be loaded.",
                          )}
                        </p>
                      ) : complianceQuery.data ? (
                        <div className="mt-4 space-y-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-zero-400">
                              Recorded result
                            </span>
                            <span
                              className={`rounded-full border px-2 py-1 text-xs ${statusStyle(
                                complianceQuery.data.overallStatus,
                              )}`}
                            >
                              {humanize(complianceQuery.data.overallStatus)}
                            </span>
                          </div>
                          <div className="grid gap-3 text-xs sm:grid-cols-2">
                            <div className="rounded-lg bg-zero-800/50 p-3">
                              <p className="text-zero-500">Last evaluated</p>
                              <p className="mt-1">
                                {formatTimestamp(
                                  complianceQuery.data.lastEvaluated,
                                )}
                              </p>
                            </div>
                            <div className="rounded-lg bg-zero-800/50 p-3">
                              <p className="text-zero-500">
                                Configured review date (not statutory)
                              </p>
                              <p className="mt-1">
                                {formatTimestamp(
                                  complianceQuery.data.nextReviewDate,
                                )}
                              </p>
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              Missing credentials
                            </p>
                            {complianceQuery.data.missingCredentials.length >
                            0 ? (
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-200">
                                {complianceQuery.data.missingCredentials.map(
                                  (credential) => (
                                    <li key={credential}>
                                      {humanize(credential)}
                                    </li>
                                  ),
                                )}
                              </ul>
                            ) : (
                              <p className="mt-2 text-sm text-zero-400">
                                None recorded.
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            {complianceQuery.data.rules.map((rule) => (
                              <div
                                key={rule.ruleId}
                                className="rounded-lg border border-zero-800 p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium">
                                    {rule.name}
                                  </p>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] ${statusStyle(
                                      rule.status,
                                    )}`}
                                  >
                                    {rule.status.toUpperCase()}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-zero-400">
                                  {rule.detail}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-zero-400">
                          Select a jurisdiction to request recorded evidence.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>

            <section className="card p-5">
              <div className="flex items-start gap-3">
                <ArrowLeftRight className="mt-0.5 h-5 w-5 text-brand-400" />
                <div>
                  <h2 className="font-semibold">
                    Configured cross-border assessment
                  </h2>
                  <p className="mt-1 text-xs text-zero-500">
                    The result evaluates the supplied transfer context against
                    ZeroID configuration. It is not regulator approval, legal
                    advice, or proof of a filed transfer.
                  </p>
                </div>
              </div>
              {jurisdictions.length < 2 ? (
                <p className="mt-4 text-sm text-zero-400">
                  At least two configured jurisdictions are required.
                </p>
              ) : (
                <>
                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-zero-500">
                        From
                      </span>
                      <select
                        aria-label="From jurisdiction"
                        value={effectiveSource}
                        onChange={(event) => {
                          setSourceCode(event.target.value);
                          resetAssessment();
                        }}
                        className="w-full rounded-xl border border-zero-700 bg-zero-900 px-3 py-2.5"
                      >
                        {jurisdictions.map((jurisdiction) => (
                          <option
                            key={jurisdiction.code}
                            value={jurisdiction.code}
                          >
                            {jurisdiction.code} — {jurisdiction.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-zero-500">
                        To
                      </span>
                      <select
                        aria-label="To jurisdiction"
                        value={effectiveTarget}
                        onChange={(event) => {
                          setTargetCode(event.target.value);
                          resetAssessment();
                        }}
                        className="w-full rounded-xl border border-zero-700 bg-zero-900 px-3 py-2.5"
                      >
                        {jurisdictions
                          .filter(
                            (jurisdiction) =>
                              jurisdiction.code !== effectiveSource,
                          )
                          .map((jurisdiction) => (
                            <option
                              key={jurisdiction.code}
                              value={jurisdiction.code}
                            >
                              {jurisdiction.code} — {jurisdiction.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-zero-500">
                        Data category
                      </span>
                      <select
                        aria-label="Data category"
                        value={dataCategory}
                        onChange={(event) => {
                          setDataCategory(
                            event.target.value as typeof dataCategory,
                          );
                          resetAssessment();
                        }}
                        className="w-full rounded-xl border border-zero-700 bg-zero-900 px-3 py-2.5"
                      >
                        {[
                          "personal",
                          "financial",
                          "biometric",
                          "health",
                          "criminal",
                        ].map((category) => (
                          <option key={category} value={category}>
                            {humanize(category)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-zero-500">
                        Purpose
                      </span>
                      <input
                        aria-label="Transfer purpose"
                        value={purpose}
                        maxLength={200}
                        onChange={(event) => {
                          setPurpose(event.target.value);
                          resetAssessment();
                        }}
                        placeholder="Describe the actual purpose"
                        className="w-full rounded-xl border border-zero-700 bg-zero-900 px-3 py-2.5"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn-primary mt-4"
                    disabled={!canAssess}
                    onClick={() => {
                      void crossBorder
                        .mutateAsync({
                          fromJurisdiction: effectiveSource,
                          toJurisdiction: effectiveTarget,
                          dataCategory,
                          purpose,
                        })
                        .catch(() => undefined);
                    }}
                  >
                    {crossBorder.isPending ? "Assessing…" : "Run assessment"}
                  </button>

                  {crossBorder.isError && (
                    <p role="alert" className="mt-4 text-sm text-red-300">
                      {errorMessage(
                        crossBorder.error,
                        "The cross-border assessment failed. No result was inferred.",
                      )}
                    </p>
                  )}

                  {crossBorder.data && (
                    <div
                      className={`mt-5 rounded-xl border p-4 ${
                        crossBorder.data.allowed
                          ? "border-emerald-500/30 bg-emerald-500/10"
                          : "border-red-500/30 bg-red-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {crossBorder.data.allowed ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-400" />
                        )}
                        <p className="font-semibold">
                          {crossBorder.data.allowed
                            ? "Allowed by configured policy"
                            : "Denied by configured policy"}
                        </p>
                      </div>
                      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                        <div>
                          <dt className="text-zero-500">Transfer mechanism</dt>
                          <dd className="mt-1">
                            {humanize(crossBorder.data.dataTransferMechanism)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zero-500">
                            Configured mutual recognition
                          </dt>
                          <dd className="mt-1">
                            {crossBorder.data.mutualRecognition ? "Yes" : "No"}
                          </dd>
                        </div>
                        {crossBorder.data.policyDecision && (
                          <div>
                            <dt className="text-zero-500">
                              Policy overlay decision
                            </dt>
                            <dd className="mt-1">
                              {humanize(crossBorder.data.policyDecision)}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {crossBorder.data.policyAlerts?.length ? (
                        <div className="mt-4">
                          <p className="text-sm font-medium">
                            Policy overlay alerts
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zero-300">
                            {crossBorder.data.policyAlerts.map((alert) => (
                              <li key={alert}>{alert}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {crossBorder.data.additionalRequired.length > 0 && (
                        <div className="mt-4">
                          <p className="text-sm font-medium">
                            Additional credential types
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zero-300">
                            {crossBorder.data.additionalRequired.map((item) => (
                              <li key={item}>{humanize(item)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {crossBorder.data.restrictions.length > 0 && (
                        <div className="mt-4">
                          <p className="text-sm font-medium">
                            Configured restrictions
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zero-300">
                            {crossBorder.data.restrictions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="card p-5">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-5 w-5 text-identity-steel" />
                <div>
                  <h2 className="font-semibold">
                    Recorded data-residency evidence
                  </h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Workflow records are shown as stored. No GDPR or other legal
                    conclusion is inferred.
                  </p>
                </div>
              </div>
              {sovereigntyQuery.isLoading ? (
                <p className="mt-4 text-sm text-zero-400">Loading records…</p>
              ) : sovereigntyQuery.isError ? (
                <p role="alert" className="mt-4 text-sm text-red-300">
                  {errorMessage(
                    sovereigntyQuery.error,
                    "Data-residency evidence could not be loaded.",
                  )}
                </p>
              ) : sovereigntyQuery.data?.dataResidencyMap.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs text-zero-500">
                      <tr>
                        <th className="pb-2 font-medium">Data type</th>
                        <th className="pb-2 font-medium">Current region</th>
                        <th className="pb-2 font-medium">Required region</th>
                        <th className="pb-2 font-medium">Policy match</th>
                        <th className="pb-2 font-medium">Retention expires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zero-800">
                      {sovereigntyQuery.data.dataResidencyMap.map((entry) => (
                        <tr key={`${entry.dataType}-${entry.currentRegion}`}>
                          <td className="py-3">{humanize(entry.dataType)}</td>
                          <td className="py-3">{entry.currentRegion}</td>
                          <td className="py-3">{entry.requiredRegion}</td>
                          <td className="py-3">
                            {entry.compliant ? "Matches" : "Does not match"}
                          </td>
                          <td className="py-3">
                            {formatTimestamp(entry.retentionExpiresAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-zero-400">
                  No retention or residency workflow records exist. Empty
                  evidence is not treated as compliance.
                </p>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zero-800 bg-zero-900 p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-300" />
                  <h2 className="font-semibold">
                    Authoritative regulatory feed
                  </h2>
                </div>
                <p className="mt-2 text-sm text-zero-400">
                  Unavailable. No source URL, publisher verification, or durable
                  external-feed integration exists on this surface.
                </p>
              </div>
              <div className="rounded-2xl border border-zero-800 bg-zero-900 p-5">
                <div className="flex items-center gap-2">
                  <FileWarning className="h-5 w-5 text-amber-300" />
                  <h2 className="font-semibold">
                    Regulator filing and deadlines
                  </h2>
                </div>
                <p className="mt-2 text-sm text-zero-400">
                  Unavailable. ZeroID does not claim that a filing was
                  delivered, acknowledged, or due unless an external authority
                  integration provides that evidence.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
