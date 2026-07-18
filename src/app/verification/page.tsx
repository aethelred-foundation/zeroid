"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Fingerprint,
  History,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useAccount } from "wagmi";

import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/contexts/IdentityContext";
import {
  useDeclineVerification,
  usePendingVerifications,
  useVerificationHistory,
} from "@/hooks/useVerification";
import type { VerificationHistory, VerificationRequest } from "@/types";

type VerificationMode = "requests" | "history";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function didLabel(
  value: VerificationRequest["verifierDid"] | string | null | undefined,
): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "uri" in value) {
    const uri = value.uri;
    if (typeof uri === "string" && uri.trim()) return uri;
  }
  return "Not supplied by the verification API";
}

function formatUnixTimestamp(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "Not supplied";
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "Invalid timestamp";
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) return "Invalid timestamp";

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyOutcome(record: VerificationHistory): {
  label: string;
  className: string;
  Icon: typeof CheckCircle2;
} {
  if (record.verified) {
    return {
      label: "Verified",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      Icon: CheckCircle2,
    };
  }

  const raw = String(record.error ?? record.status ?? "").toUpperCase();
  if (raw === "PENDING" || raw === "PROCESSING") {
    return {
      label: raw === "PROCESSING" ? "Processing" : "Pending",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      Icon: Clock,
    };
  }
  if (raw === "EXPIRED") {
    return {
      label: "Expired",
      className: "border-slate-500/30 bg-slate-500/10 text-slate-300",
      Icon: Clock,
    };
  }

  return {
    label: raw === "REJECTED" ? "Rejected" : "Failed",
    className: "border-red-500/30 bg-red-500/10 text-red-300",
    Icon: XCircle,
  };
}

function CapabilityBoundary() {
  return (
    <section
      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5"
      aria-labelledby="verification-capability-heading"
    >
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div className="min-w-0">
          <h2
            id="verification-capability-heading"
            className="font-semibold text-amber-100"
          >
            Proof response is unavailable
          </h2>
          <p className="mt-1 text-sm text-amber-100/80">
            This client does not expose a trusted circuit-artifact manifest or a
            pinned verifier deployment for the requested circuit. ZeroID can
            show authenticated request and history records here, but it cannot
            honestly claim that browser proof generation or on-chain
            verification is available. A holder can still decline a pending
            request without generating a proof.
          </p>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-amber-100/60">Record source</dt>
              <dd className="mt-1 font-medium text-amber-50">
                Authenticated ZeroID API
              </dd>
            </div>
            <div>
              <dt className="text-amber-100/60">Circuit artifacts</dt>
              <dd className="mt-1 font-medium text-amber-50">
                No trusted manifest exposed
              </dd>
            </div>
            <div>
              <dt className="text-amber-100/60">Verifier deployment</dt>
              <dd className="mt-1 font-medium text-amber-50">
                No pinned evidence exposed
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function AuthenticationState({ isConnected }: { isConnected: boolean }) {
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();
  const [signInError, setSignInError] = useState<string | null>(null);

  if (!isConnected) {
    return (
      <section className="card p-10 text-center" role="status">
        <LockKeyhole className="mx-auto h-10 w-10 text-brand-400" />
        <h2 className="mt-3 font-semibold">Connect your wallet</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
          Use the wallet control in the header. No protected verification
          request has been sent.
        </p>
      </section>
    );
  }

  if (identity.isLoading) {
    return (
      <section
        className="card flex items-center justify-center gap-3 p-10 text-sm text-[var(--text-secondary)]"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
        Checking the connected ZeroID identity...
      </section>
    );
  }

  if (!identity.isRegistered) {
    return (
      <section className="card p-10 text-center" role="status">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-300" />
        <h2 className="mt-3 font-semibold">Register this wallet first</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
          Verification records are protected by a registered ZeroID identity.
        </p>
        <Link href="/identity" className="btn-primary mt-5 inline-flex">
          Open identity setup
        </Link>
      </section>
    );
  }

  if (sessionStatus !== "authenticated") {
    const visibleError = signInError ?? sessionError;
    return (
      <section className="card p-10 text-center" role="status">
        <LockKeyhole className="mx-auto h-10 w-10 text-brand-400" />
        <h2 className="mt-3 font-semibold">Sign in to load records</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
          Sign the one-time ZeroID wallet challenge before a protected
          verification endpoint is queried.
        </p>
        {visibleError && (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {visibleError}
          </p>
        )}
        <button
          type="button"
          className="btn-primary mt-5 disabled:cursor-wait disabled:opacity-60"
          disabled={sessionStatus === "signing"}
          onClick={() => {
            setSignInError(null);
            void signIn().catch((error) =>
              setSignInError(errorMessage(error, "ZeroID sign-in failed.")),
            );
          }}
        >
          {sessionStatus === "signing" ? "Signing..." : "Sign in with wallet"}
        </button>
      </section>
    );
  }

  return null;
}

function RequestList({
  requests,
  onDecline,
  decliningRequestId,
  isDeclining,
  declineError,
}: {
  requests: VerificationRequest[];
  onDecline: (requestId: string) => void;
  decliningRequestId?: string;
  isDeclining: boolean;
  declineError?: unknown;
}) {
  if (requests.length === 0) {
    return (
      <div className="p-12 text-center">
        <Clock className="mx-auto h-10 w-10 text-[var(--text-tertiary)]" />
        <p className="mt-3 text-[var(--text-secondary)]">
          No pending requests returned
        </p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          The authenticated ZeroID API did not return a pending verification
          request for this identity.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-secondary)]">
      {requests.map((request) => (
        <article key={request.id} className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                Verification request
              </p>
              <h3 className="mt-1 font-medium text-[var(--text-primary)]">
                {request.purpose?.trim() || "Purpose not supplied"}
              </h3>
              <p className="mt-1 break-all font-mono text-xs text-[var(--text-tertiary)]">
                {request.id}
              </p>
            </div>
            <span className="w-fit rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
              Pending
            </span>
          </div>

          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">
                Verifier DID
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">
                {didLabel(request.verifierDid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Expires</dt>
              <dd className="mt-1 text-[var(--text-secondary)]">
                {formatUnixTimestamp(request.expiresAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">
                Requested attributes
              </dt>
              <dd className="mt-1 text-[var(--text-secondary)]">
                {request.requestedAttributes.length > 0
                  ? request.requestedAttributes.join(", ")
                  : "None supplied"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">
                Requested circuit reference
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">
                {String(request.circuitId || "Not supplied")}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3 border-t border-[var(--border-secondary)] pt-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-2xl text-xs text-[var(--text-tertiary)]">
              Cryptographic response stays disabled until trusted prover
              artifacts and the verifier deployment are bound to this circuit
              reference. Declining records a durable response without a proof.
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled>
                Proof response unavailable
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-60"
                disabled={isDeclining}
                onClick={() => onDecline(request.id)}
              >
                {isDeclining && decliningRequestId === request.id
                  ? "Declining..."
                  : "Decline request"}
              </button>
            </div>
          </div>
          {decliningRequestId === request.id && declineError ? (
            <p role="alert" className="text-sm text-red-300">
              {errorMessage(
                declineError,
                "The verification request could not be declined.",
              )}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function HistoryList({ records }: { records: VerificationHistory[] }) {
  if (records.length === 0) {
    return (
      <div className="p-12 text-center">
        <History className="mx-auto h-10 w-10 text-[var(--text-tertiary)]" />
        <p className="mt-3 text-[var(--text-secondary)]">
          No verification records returned
        </p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          The authenticated ZeroID API returned an empty history for this
          identity.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-secondary)]">
      {records.map((record) => {
        const outcome = historyOutcome(record);
        const OutcomeIcon = outcome.Icon;
        return (
          <article
            key={record.id ?? record.requestId}
            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-secondary)]">
              <Fingerprint className="h-5 w-5 text-brand-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Verification record
              </p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--text-tertiary)]">
                {record.requestId || record.id || "Identifier not supplied"}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="text-xs text-[var(--text-tertiary)]">
                {formatUnixTimestamp(
                  record.verifiedAt ?? record.timestamp ?? record.createdAt,
                )}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${outcome.className}`}
              >
                <OutcomeIcon className="h-3.5 w-3.5" />
                {outcome.label}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function VerificationPage() {
  const [mode, setMode] = useState<VerificationMode>("requests");
  const { isConnected } = useAccount();
  const { identity, sessionStatus } = useIdentity();
  const authenticated = Boolean(
    isConnected && identity.isRegistered && sessionStatus === "authenticated",
  );
  const pending = usePendingVerifications();
  const history = useVerificationHistory(undefined, 1, 100);
  const decline = useDeclineVerification();

  const activeQuery = mode === "requests" ? pending : history;
  const activeError = activeQuery.error;

  return (
    <AppLayout>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Verification</h1>
          <p className="mt-1 text-[var(--text-secondary)]">
            Authenticated verification requests and recorded outcomes.
          </p>
        </header>

        <CapabilityBoundary />

        {!authenticated ? (
          <AuthenticationState isConnected={isConnected} />
        ) : (
          <>
            <nav
              className="flex w-fit items-center gap-1 rounded-xl bg-[var(--surface-secondary)] p-1"
              aria-label="Verification records"
            >
              {[
                {
                  id: "requests" as const,
                  label: "Pending requests",
                  Icon: Clock,
                },
                { id: "history" as const, label: "History", Icon: History },
              ].map(({ id, label, Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setMode(id)}
                  aria-current={mode === id ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    mode === id
                      ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {id === "requests" &&
                    pending.data &&
                    pending.data.length > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
                        {pending.data.length}
                      </span>
                    )}
                </button>
              ))}
            </nav>

            <section className="card overflow-hidden" aria-live="polite">
              <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-5">
                <div>
                  <h2 className="font-semibold">
                    {mode === "requests"
                      ? "Pending requests"
                      : "Verification history"}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Records returned by the authenticated ZeroID API.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={activeQuery.isFetching}
                  onClick={() => void activeQuery.refetch()}
                  aria-label="Refresh verification records"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${activeQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
              </div>

              {activeQuery.isLoading ? (
                <div
                  className="flex items-center justify-center gap-3 p-12 text-sm text-[var(--text-secondary)]"
                  role="status"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                  Loading authenticated verification records...
                </div>
              ) : activeError ? (
                <div className="p-10 text-center" role="alert">
                  <AlertTriangle className="mx-auto h-9 w-9 text-red-300" />
                  <h3 className="mt-3 font-semibold">
                    Records could not be loaded
                  </h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                    {errorMessage(
                      activeError,
                      "The authenticated verification API request failed.",
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary mt-4"
                    onClick={() => void activeQuery.refetch()}
                  >
                    Try again
                  </button>
                </div>
              ) : mode === "requests" ? (
                <RequestList
                  requests={pending.data ?? []}
                  onDecline={(requestId) => decline.mutate(requestId)}
                  decliningRequestId={decline.variables}
                  isDeclining={decline.isPending}
                  declineError={decline.error}
                />
              ) : (
                <HistoryList records={history.data?.items ?? []} />
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
