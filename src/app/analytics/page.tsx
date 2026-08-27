"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import {
  useCredentialUsageAnalytics,
  useDataExposureTimeline,
  useExportAnalyticsReport,
  usePrivacyRecommendations,
  usePrivacyScore,
  useVerifierAnalytics,
  type AnalyticsPeriod,
  type PrivacyRecommendation,
} from "@/hooks/useAnalytics";

type AnalyticsTab = "usage" | "privacy" | "exposure";

const PERIODS: Exclude<AnalyticsPeriod, "all">[] = ["7d", "30d", "90d", "1y"];

const TABS = [
  { id: "usage" as const, label: "Tenant Usage", icon: BarChart3 },
  { id: "privacy" as const, label: "Privacy Calculations", icon: Lock },
  { id: "exposure" as const, label: "Exposure Review", icon: Eye },
];

const PRIORITY_CLASSES: Record<PrivacyRecommendation["priority"], string> = {
  critical: "border-red-500/20 bg-red-500/10 text-red-300",
  high: "border-red-500/20 bg-red-500/10 text-red-300",
  medium: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  low: "border-blue-500/20 bg-blue-500/10 text-blue-300",
};

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function methodLabel(method: "full" | "selective" | "zk_proof"): string {
  if (method === "zk_proof") return "ZK proof request";
  if (method === "selective") return "Limited attribute request (inferred)";
  return "Full credential request (inferred)";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BarChart3;
}) {
  return (
    <div className="rounded-2xl border border-zero-800 bg-zero-900 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zero-500">
        <Icon className="h-4 w-4 text-brand-400" />
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-zero-500">{detail}</div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="card p-6 text-sm text-zero-500">{children}</div>;
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Exclude<AnalyticsPeriod, "all">>("30d");
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("usage");

  const privacyScoreQuery = usePrivacyScore(period);
  const credentialUsageQuery = useCredentialUsageAnalytics(period);
  const verifierQuery = useVerifierAnalytics(period);
  const exposureQuery = useDataExposureTimeline(period);
  const recommendationQuery = usePrivacyRecommendations(period);
  const exportAnalytics = useExportAnalyticsReport();

  const usage = credentialUsageQuery.data;
  const privacyScore = privacyScoreQuery.data;
  const verifierData = verifierQuery.data;
  const exposure = exposureQuery.data;
  const recommendations = recommendationQuery.data;

  const analyticsHasError =
    privacyScoreQuery.isError ||
    credentialUsageQuery.isError ||
    verifierQuery.isError ||
    exposureQuery.isError ||
    recommendationQuery.isError;
  const analyticsLoading =
    privacyScoreQuery.isLoading ||
    credentialUsageQuery.isLoading ||
    verifierQuery.isLoading ||
    exposureQuery.isLoading ||
    recommendationQuery.isLoading;

  const maxDailyPresentations = Math.max(
    1,
    ...(usage?.byDay ?? []).map((day) => day.presentations),
  );

  const exportReport = async () => {
    try {
      await exportAnalytics.mutateAsync({ format: "json", period });
    } catch {
      // The mutation hook owns the user-facing error toast.
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              <BarChart3 className="h-7 w-7 text-identity-chrome" />
              Tenant Analytics
            </h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Usage and privacy calculations derived from authenticated ZeroID
              records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setPeriod(candidate)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === candidate
                    ? "bg-brand-600 text-white"
                    : "text-zero-500 hover:bg-zero-800"
                }`}
              >
                {candidate}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void exportReport()}
              disabled={exportAnalytics.isPending}
              className="btn-primary ml-2 text-sm disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exportAnalytics.isPending ? "Exporting" : "Export"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-3 text-sm text-zero-300">
          <div className="flex items-start gap-2">
            <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
            <p>
              Scores and ratios are calculated locally from this tenant&apos;s
              returned, dated records. ZeroID does not currently receive an
              authoritative network, competitor, percentile, or industry
              benchmark feed.
            </p>
          </div>
        </div>

        {(analyticsLoading || analyticsHasError) && (
          <div
            role={analyticsHasError ? "alert" : "status"}
            className={`rounded-xl border px-4 py-3 text-sm ${
              analyticsHasError
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-brand-500/30 bg-brand-500/10 text-brand-200"
            }`}
          >
            {analyticsHasError
              ? "One or more analytics sources are unavailable. No fallback metrics are shown."
              : "Loading tenant records from the backend..."}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard
            label="Recorded presentations"
            value={
              usage ? usage.totalPresentations.toLocaleString() : "Unavailable"
            }
            detail={`Selected ${period} window`}
            icon={FileText}
          />
          <MetricCard
            label="Dated requests"
            value={
              privacyScore
                ? privacyScore.recordCount.toLocaleString()
                : "Unavailable"
            }
            detail="Used for local privacy calculations"
            icon={KeyRound}
          />
          <MetricCard
            label="Known verifiers"
            value={
              verifierData
                ? verifierData.totalVerifiers.toLocaleString()
                : "Unavailable"
            }
            detail="Distinct verifier identifiers returned"
            icon={Users}
          />
          <MetricCard
            label="Attributes disclosed"
            value={
              exposure
                ? exposure.totalDisclosures.toLocaleString()
                : "Unavailable"
            }
            detail="Direct attributes in returned requests"
            icon={Eye}
          />
          <MetricCard
            label="Privacy-preserving ratio"
            value={usage ? `${usage.privacyPreservingRatio}%` : "Unavailable"}
            detail="Calculated from returned request shapes"
            icon={ShieldCheck}
          />
        </div>

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
          {activeTab === "usage" && (
            <motion.section
              key="usage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <div className="mb-5">
                  <h2 className="font-semibold">Presentations by Day</h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Counts returned in the selected tenant window.
                  </p>
                </div>
                {usage?.byDay.length ? (
                  <div className="flex h-52 items-end gap-3">
                    {usage.byDay.map((day) => (
                      <div
                        key={day.date}
                        className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                      >
                        <span className="text-[10px] text-zero-500">
                          {day.presentations.toLocaleString()}
                        </span>
                        <div
                          className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400"
                          style={{
                            height: `${Math.max(
                              4,
                              (day.presentations / maxDailyPresentations) * 160,
                            )}px`,
                          }}
                        />
                        <span className="text-xs text-zero-500">
                          {shortDate(day.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-zero-500">
                    No dated presentation records were returned for this period.
                  </div>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="card overflow-hidden">
                  <div className="border-b border-zero-800 p-4">
                    <h2 className="font-semibold">Credential Type Activity</h2>
                  </div>
                  {usage?.byCredentialType.length ? (
                    <div className="divide-y divide-zero-800/50">
                      {usage.byCredentialType.map((credential) => (
                        <div
                          key={credential.credentialId}
                          className="flex items-center justify-between gap-4 p-4"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {credential.credentialTypeLabel}
                            </div>
                            <div className="mt-1 text-xs text-zero-500">
                              Last used {shortDate(credential.lastUsedAt)}
                            </div>
                          </div>
                          <div className="text-right text-xs text-zero-400">
                            <div>
                              {credential.presentationCount} presentation(s)
                            </div>
                            <div className="mt-1">
                              {credential.zkProofCount} ZK proof(s)
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-zero-500">
                      No credential-linked presentation records were returned.
                    </div>
                  )}
                </div>

                <div className="card overflow-hidden">
                  <div className="border-b border-zero-800 p-4">
                    <h2 className="font-semibold">Verifier Requests</h2>
                  </div>
                  {verifierData?.verifiers.length ? (
                    <div className="divide-y divide-zero-800/50">
                      {verifierData.verifiers.map((verifier) => (
                        <div key={verifier.verifierDid} className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-sm font-medium">
                              {verifier.verifierName || verifier.verifierDid}
                            </div>
                            <span className="text-xs text-zero-400">
                              {verifier.requestCount} request(s)
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zero-500">
                            <span>
                              ZK request observed:{" "}
                              {verifier.zkProofRequestObserved ? "Yes" : "No"}
                            </span>
                            <span>•</span>
                            <span>
                              Last request {shortDate(verifier.lastRequestAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-zero-500">
                      No verifier identifiers were returned for this period.
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          )}

          {activeTab === "privacy" && (
            <motion.section
              key="privacy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {privacyScore && privacyScore.recordCount > 0 ? (
                <div className="card p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm text-zero-500">
                        Calculated tenant privacy score
                      </div>
                      <div className="mt-2 flex items-end gap-2">
                        <span className="text-5xl font-bold">
                          {privacyScore.overallScore}
                        </span>
                        <span className="pb-1 text-zero-500">/100</span>
                      </div>
                      <div className="mt-2 text-sm text-zero-400">
                        Grade {privacyScore.grade} from{" "}
                        {privacyScore.recordCount} dated request(s)
                      </div>
                    </div>
                    <p className="max-w-xl rounded-xl border border-zero-800 bg-zero-900 p-4 text-sm text-zero-400">
                      {privacyScore.calculationBasis}
                    </p>
                  </div>
                </div>
              ) : (
                <EmptyState>
                  Privacy score unavailable: no dated verification requests were
                  returned for the selected period. Zero is not displayed as a
                  comparative score.
                </EmptyState>
              )}

              {privacyScore && privacyScore.recordCount > 0 && (
                <div className="card p-6">
                  <h2 className="font-semibold">Calculated Components</h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Percentages below are calculated only from returned tenant
                    request fields and are not network comparisons.
                  </p>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {[
                      [
                        "Privacy-preserving request shape",
                        privacyScore.breakdown.selectiveDisclosureUsage,
                      ],
                      [
                        "ZK request adoption",
                        privacyScore.breakdown.zkProofAdoption,
                      ],
                      [
                        "Attribute minimisation",
                        privacyScore.breakdown.credentialMinimisation,
                      ],
                      [
                        "Exposure control",
                        privacyScore.breakdown.dataExposureControl,
                      ],
                      [
                        "Verifier diversity ratio",
                        privacyScore.breakdown.verifierDiversity,
                      ],
                      [
                        "Consent evidence",
                        privacyScore.breakdown.consentManagement,
                      ],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-zero-400">{label}</span>
                          <span>{value}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-zero-800">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card overflow-hidden">
                <div className="border-b border-zero-800 p-4">
                  <h2 className="font-semibold">Requested Attributes</h2>
                </div>
                {usage?.topAttributes.length ? (
                  <div className="divide-y divide-zero-800/50">
                    {usage.topAttributes.map((attribute) => (
                      <div
                        key={attribute.attributeKey}
                        className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4"
                      >
                        <span className="font-mono text-zero-300">
                          {attribute.attributeKey}
                        </span>
                        <span className="text-zero-500">
                          {attribute.totalRequests} request(s)
                        </span>
                        <span className="text-zero-500">
                          {attribute.disclosureCount} disclosed
                        </span>
                        <span className="text-zero-500">
                          {attribute.proofOnlyCount} proof-only
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-sm text-zero-500">
                    No requested attributes were returned for this period.
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {activeTab === "exposure" && (
            <motion.section
              key="exposure"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
                Non-ZK disclosure methods are inferred from the returned request
                shape because the backend does not provide an authoritative
                disclosure-method field.
              </div>

              <div className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-zero-800 p-4">
                  <h2 className="font-semibold">Exposure Events</h2>
                  <span className="text-xs text-zero-500">
                    {exposure
                      ? `${exposure.fullDisclosureEvents} inferred full disclosure(s)`
                      : "Unavailable"}
                  </span>
                </div>
                {exposure?.entries.length ? (
                  <div className="divide-y divide-zero-800/50">
                    {exposure.entries.map((entry) => (
                      <div key={entry.id} className="p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              {entry.purpose}
                            </div>
                            <div className="mt-1 text-xs text-zero-500">
                              {entry.verifierName} •{" "}
                              {shortDate(entry.timestamp)}
                            </div>
                          </div>
                          <span className="self-start rounded-full bg-zero-800 px-2 py-1 text-[10px] text-zero-300">
                            {methodLabel(entry.disclosureMethod)}
                          </span>
                        </div>
                        <div className="mt-3 text-xs text-zero-500">
                          {entry.attributesDisclosed.length > 0
                            ? `Attributes: ${entry.attributesDisclosed.join(", ")}`
                            : "No direct attributes listed"}
                        </div>
                        <div className="mt-1 text-xs text-zero-600">
                          Consent flag recorded:{" "}
                          {entry.consentRecorded ? "Yes" : "No"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-sm text-zero-500">
                    No dated exposure events were returned for this period.
                  </div>
                )}
              </div>

              <div className="card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <h2 className="font-semibold">Rule-Based Recommendations</h2>
                </div>
                {recommendations?.length ? (
                  <div className="space-y-3">
                    {recommendations.map((recommendation) => (
                      <div
                        key={recommendation.id}
                        className="rounded-xl border border-zero-800 bg-zero-900 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">
                            {recommendation.title}
                          </h3>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                              PRIORITY_CLASSES[recommendation.priority]
                            }`}
                          >
                            {recommendation.priority}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-zero-400">
                          {recommendation.description}
                        </p>
                        <p className="mt-2 text-xs text-zero-500">
                          Suggested action: {recommendation.suggestedAction}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-sm text-zero-500">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      No rule-based recommendation was generated from the
                      returned records. This is not evidence of compliance.
                    </span>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
