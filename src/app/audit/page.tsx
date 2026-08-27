"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Download,
  FileText,
  Fingerprint,
  History,
  Key,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import AppLayout from "@/components/layout/AppLayout";
import AuditTimeline from "@/components/audit/AuditTimeline";
import { useIdentity } from "@/contexts/IdentityContext";
import { exportAuditLog, useAudit } from "@/hooks/useAudit";
import type { AuditFilter } from "@/types";

type ResourceFilter =
  | "all"
  | "credential"
  | "verification"
  | "schema"
  | "identity";
type DateRange = "24h" | "7d" | "30d" | "90d";

const RESOURCE_FILTERS = [
  { id: "all" as const, label: "All resources", icon: History },
  { id: "credential" as const, label: "Credentials", icon: ShieldCheck },
  { id: "verification" as const, label: "Verifications", icon: Fingerprint },
  { id: "schema" as const, label: "Governance schemas", icon: FileText },
  { id: "identity" as const, label: "Identity", icon: Key },
];

const RANGE_HOURS: Record<DateRange, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "90d": 90 * 24,
};

function filterWindow(
  range: DateRange,
): Pick<AuditFilter, "startDate" | "endDate"> {
  const end = new Date();
  const start = new Date(end.getTime() - RANGE_HOURS[range] * 60 * 60 * 1000);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export default function AuditPage() {
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [isExporting, setIsExporting] = useState(false);
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();

  const filters = useMemo<AuditFilter>(
    () => ({
      ...filterWindow(dateRange),
      entityType: resourceFilter === "all" ? undefined : resourceFilter,
      page: 1,
      pageSize: 100,
    }),
    [dateRange, resourceFilter],
  );
  const authenticated =
    identity.isRegistered && sessionStatus === "authenticated";
  const { auditLog, total, isConnected, isLoading, isSuccess, error } =
    useAudit(filters, authenticated);

  const summary = useMemo(() => {
    const actions = new Set(
      auditLog.flatMap((entry) => (entry.action ? [entry.action] : [])),
    );
    const resources = new Set(
      auditLog.flatMap((entry) =>
        entry.entityType && entry.entityId
          ? [`${entry.entityType}:${entry.entityId}`]
          : [],
      ),
    );
    const datedRecords = auditLog.filter((entry) => entry.timestamp).length;
    return {
      returnedRecords: total,
      datedRecords,
      distinctActions: actions.size,
      distinctResources: resources.size,
    };
  }, [auditLog, total]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportAuditLog(filters, "json");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Server-backed identity audit records for the selected filters.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExport}
            disabled={!isConnected || !authenticated || isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isExporting ? "Exporting..." : "Export JSON"}
          </button>
        </div>

        {!isConnected ? (
          <div className="card p-4 text-sm text-[var(--text-secondary)]">
            Connect your wallet and authenticated ZeroID session to load audit
            records.
          </div>
        ) : identity.isLoading ? (
          <div
            className="card flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-secondary)]"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            Checking the connected ZeroID identity...
          </div>
        ) : !identity.isRegistered ? (
          <div className="card p-8 text-center" role="status">
            <h2 className="font-semibold">Register this wallet first</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Audit records are protected by an authenticated ZeroID identity.
            </p>
            <Link href="/identity" className="btn-primary mt-4 inline-flex">
              Open identity setup
            </Link>
          </div>
        ) : sessionStatus !== "authenticated" ? (
          <div className="card p-8 text-center" role="status">
            <h2 className="font-semibold">Sign in to load audit records</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Sign the one-time wallet challenge before the audit endpoint is
              queried.
            </p>
            {sessionError && (
              <p className="mt-2 text-xs text-red-300" role="alert">
                {sessionError}
              </p>
            )}
            <button
              type="button"
              disabled={sessionStatus === "signing"}
              onClick={() => {
                void signIn().catch(() => {
                  // IdentityContext renders the actionable sign-in error.
                });
              }}
              className="btn-primary mt-4 disabled:opacity-60"
            >
              {sessionStatus === "signing"
                ? "Signing..."
                : "Sign in with wallet"}
            </button>
          </div>
        ) : (
          <>
            <section className="card space-y-4 p-4" aria-label="Audit filters">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  Resource type
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {RESOURCE_FILTERS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setResourceFilter(item.id)}
                      aria-pressed={resourceFilter === item.id}
                      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                        resourceFilter === item.id
                          ? "bg-brand-600 text-white"
                          : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  <Calendar className="h-3.5 w-3.5" />
                  Server date window
                </p>
                <div className="flex w-fit items-center gap-1 rounded-xl bg-[var(--surface-secondary)] p-1">
                  {(["24h", "7d", "30d", "90d"] as const).map((range) => (
                    <button
                      type="button"
                      key={range}
                      onClick={() => setDateRange(range)}
                      aria-pressed={dateRange === range}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        dateRange === range
                          ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-xs text-[var(--text-tertiary)]">
                Resource and date filters are sent to the audit endpoint. This
                view shows at most 100 returned records, not an inferred
                lifetime total.
              </p>
            </section>

            <AuditTimeline
              events={auditLog}
              isLoading={isLoading}
              error={error instanceof Error ? error : null}
              emptyMessage="No audit records were returned for these server filters."
            />

            {isSuccess && auditLog.length > 0 && (
              <section aria-label="Returned record summary">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold">
                    Returned record summary
                  </h2>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Calculated only from the records displayed above.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    {
                      label: "Returned records",
                      value: summary.returnedRecords,
                      icon: History,
                    },
                    {
                      label: "Dated records",
                      value: summary.datedRecords,
                      icon: Calendar,
                    },
                    {
                      label: "Distinct action codes",
                      value: summary.distinctActions,
                      icon: FileText,
                    },
                    {
                      label: "Distinct resources",
                      value: summary.distinctResources,
                      icon: ShieldCheck,
                    },
                  ].map((item) => (
                    <div key={item.label} className="card p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-secondary)] text-brand-500">
                          <item.icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{item.value}</div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            {item.label}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
