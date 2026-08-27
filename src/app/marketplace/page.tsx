"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileKey2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  UserRound,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/contexts/IdentityContext";
import { apiClient } from "@/lib/api/client";
import type { SchemaRegistryRecord } from "@/lib/schemas/registry";

const PAGE_SIZE = 12;

function formatRegistryDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function SchemaCard({ schema }: { schema: SchemaRegistryRecord }) {
  const fieldNames = Object.keys(schema.schemaDefinition.properties);
  const visibleFieldNames = fieldNames.slice(0, 8);

  return (
    <article
      className="card flex h-full flex-col p-5"
      data-schema-id={schema.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
        <span className="font-mono text-xs text-[var(--text-secondary)]">
          v{schema.version}
        </span>
      </div>

      <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
        {schema.name}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        {schema.description}
      </p>

      <dl className="mt-5 space-y-3 border-t border-[var(--border-primary)] pt-4 text-xs">
        <div>
          <dt className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <FileKey2 className="h-3.5 w-3.5" /> Registry ID
          </dt>
          <dd className="mt-1 break-all font-mono text-[var(--text-secondary)]">
            {schema.id}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <UserRound className="h-3.5 w-3.5" /> Proposer identity
          </dt>
          <dd className="mt-1 break-all font-mono text-[var(--text-secondary)]">
            {schema.proposedBy}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[var(--text-tertiary)]">Governance votes</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              {schema.approvalVotes} approve / {schema.rejectionVotes} reject
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">Registry updated</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              {formatRegistryDate(schema.updatedAt)}
            </dd>
          </div>
        </div>
      </dl>

      <div className="mt-4 border-t border-[var(--border-primary)] pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Declared fields ({fieldNames.length})
        </div>
        {visibleFieldNames.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleFieldNames.map((fieldName) => (
              <code
                key={fieldName}
                className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
              >
                {fieldName}
              </code>
            ))}
            {fieldNames.length > visibleFieldNames.length && (
              <span className="rounded-md bg-[var(--surface-tertiary)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
                +{fieldNames.length - visibleFieldNames.length} more
              </span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            This schema declares no properties.
          </p>
        )}
      </div>
    </article>
  );
}

export default function MarketplacePage() {
  const { address, isConnected } = useAccount();
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();
  const [page, setPage] = useState(1);
  const [filterInput, setFilterInput] = useState("");
  const [nameFilter, setNameFilter] = useState("");

  const canReadRegistry =
    Boolean(isConnected && address && identity.isRegistered) &&
    sessionStatus === "authenticated";

  const registryQuery = useQuery({
    queryKey: [
      "approved-schema-registry",
      address?.toLowerCase(),
      page,
      nameFilter,
    ],
    queryFn: () =>
      apiClient.listSchemas(page, PAGE_SIZE, {
        status: "APPROVED",
        name: nameFilter || undefined,
      }),
    enabled: canReadRegistry,
    staleTime: 30_000,
    retry: false,
  });

  const applyFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setNameFilter(filterInput.trim());
  };

  const clearFilter = () => {
    setFilterInput("");
    setNameFilter("");
    setPage(1);
  };

  const totalPages = registryQuery.data
    ? Math.max(1, Math.ceil(registryQuery.data.total / PAGE_SIZE))
    : 1;

  return (
    <AppLayout>
      <div className="space-y-6">
        <header>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Store className="h-7 w-7 text-identity-amber" />
            Approved Schema Registry
          </h1>
          <p className="mt-1 text-[var(--text-secondary)]">
            Authenticated governance records for credential schemas approved by
            ZeroID.
          </p>
        </header>

        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-200">
            Registry discovery only
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            This registry does not sell or issue credentials. The current
            issuance API is controlled by authenticated issuers, so no holder
            request action is presented here.
          </p>
        </section>

        {!isConnected || !address ? (
          <section
            className="card border-amber-500/20 p-10 text-center"
            role="status"
          >
            <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-amber-300" />
            <h2 className="font-semibold text-amber-100">
              Connect a wallet to view approved schemas
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              The governance registry is protected. Use the wallet control in
              the header before loading registry data.
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
          <section
            className="card border-amber-500/20 p-10 text-center"
            role="status"
          >
            <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-amber-300" />
            <h2 className="font-semibold text-amber-100">
              Register this wallet with ZeroID first
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              An active ZeroID identity is required before the authenticated
              governance registry can be queried.
            </p>
            <Link href="/identity" className="btn-primary mt-5 inline-flex">
              Open identity setup
            </Link>
          </section>
        ) : sessionStatus !== "authenticated" ? (
          <section
            className="card border-cyan-500/20 p-10 text-center"
            role="status"
          >
            <FileKey2 className="mx-auto mb-3 h-9 w-9 text-cyan-300" />
            <h2 className="font-semibold text-cyan-100">
              Sign in to load approved schemas
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Sign the one-time ZeroID challenge with the registered wallet. No
              registry request has been sent for this session yet.
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
            <section className="card p-4">
              <form
                onSubmit={applyFilter}
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
                role="search"
              >
                <label className="relative flex-1">
                  <span className="sr-only">
                    Filter approved schemas by name
                  </span>
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    type="search"
                    value={filterInput}
                    onChange={(event) => setFilterInput(event.target.value)}
                    placeholder="Filter approved schemas by name"
                    maxLength={100}
                    className="input w-full pl-10"
                  />
                </label>
                <button type="submit" className="btn-primary justify-center">
                  Apply filter
                </button>
                {(nameFilter || filterInput) && (
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="btn-secondary justify-center"
                  >
                    Clear
                  </button>
                )}
              </form>
            </section>

            {registryQuery.isPending ? (
              <section
                className="card flex items-center justify-center gap-3 p-12 text-sm text-[var(--text-secondary)]"
                role="status"
              >
                <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                Loading approved governance schemas...
              </section>
            ) : registryQuery.error ? (
              <section
                className="card flex items-start gap-3 border-red-500/20 p-6 text-red-300"
                role="alert"
              >
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="flex-1">
                  <h2 className="font-medium">Schema registry unavailable</h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {registryQuery.error instanceof Error
                      ? registryQuery.error.message
                      : "The authenticated registry request failed."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void registryQuery.refetch()}
                  className="btn-secondary shrink-0"
                >
                  <RefreshCw className="h-4 w-4" /> Retry
                </button>
              </section>
            ) : registryQuery.data.items.length === 0 ? (
              <section className="card p-14 text-center" role="status">
                <FileText className="mx-auto mb-3 h-10 w-10 text-[var(--text-tertiary)]" />
                <h2 className="font-semibold">
                  {nameFilter
                    ? "No approved schemas match this name"
                    : "No approved schemas are published"}
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
                  {nameFilter
                    ? "Clear or change the name filter to query the registry again."
                    : "The backend returned an empty approved-governance registry."}
                </p>
              </section>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className="text-sm text-[var(--text-secondary)]"
                    role="status"
                  >
                    {registryQuery.data.total} approved schema
                    {registryQuery.data.total === 1 ? "" : "s"}
                    {nameFilter ? ` matching “${nameFilter}”` : ""}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Page {registryQuery.data.page} of {totalPages}
                  </p>
                </div>

                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {registryQuery.data.items.map((schema) => (
                    <SchemaCard key={schema.id} schema={schema} />
                  ))}
                </section>

                <nav
                  aria-label="Schema registry pagination"
                  className="flex items-center justify-between"
                >
                  <button
                    type="button"
                    disabled={registryQuery.data.page <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowLeft className="h-4 w-4" /> Previous
                  </button>
                  <button
                    type="button"
                    disabled={!registryQuery.data.hasMore}
                    onClick={() => setPage((current) => current + 1)}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next <ArrowRight className="h-4 w-4" />
                  </button>
                </nav>
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
