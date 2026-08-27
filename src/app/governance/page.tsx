"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileKey2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Vote,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import ProposalCard from "@/components/governance/ProposalCard";
import VotingPanel from "@/components/governance/VotingPanel";
import { Modal } from "@/components/ui/Modal";
import { useIdentity } from "@/contexts/IdentityContext";
import { useGovernance } from "@/hooks/useGovernance";
import type {
  CreateSchemaProposalInput,
  SchemaGovernanceStatus,
} from "@/lib/schemas/registry";

const PAGE_SIZE = 10;
const EMPTY_SCHEMA_DEFINITION = `{
  "type": "object",
  "properties": {}
}`;

type StatusFilter = "ALL" | SchemaGovernanceStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "PROPOSED", label: "Proposed" },
  { id: "APPROVED", label: "Approved" },
  { id: "DEPRECATED", label: "Deprecated" },
  { id: "DRAFT", label: "Draft" },
];

const EMPTY_FORM = {
  name: "",
  version: "",
  description: "",
  schemaDefinition: EMPTY_SCHEMA_DEFINITION,
};

export default function GovernancePage() {
  const { address, isConnected } = useAccount();
  const { identity, sessionStatus, sessionError, signIn } = useIdentity();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [filterInput, setFilterInput] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const identitySessionReady =
    Boolean(isConnected && address && identity.isRegistered) &&
    sessionStatus === "authenticated";
  const governance = useGovernance({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter === "ALL" ? undefined : statusFilter,
    name: nameFilter || undefined,
    selectedSchemaId,
    enabled: identitySessionReady,
  });
  const workflowReady =
    identitySessionReady && governance.accessState === "ready";
  const totalPages = Math.max(1, Math.ceil(governance.total / PAGE_SIZE));

  const applyNameFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSelectedSchemaId(null);
    setNameFilter(filterInput.trim());
  };

  const selectStatus = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
    setSelectedSchemaId(null);
  };

  const resetCreateForm = () => {
    setForm(EMPTY_FORM);
    setCreateError(null);
    governance.resetCreate();
  };

  const submitSchemaProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    setSuccessMessage(null);

    let parsedDefinition: unknown;
    try {
      parsedDefinition = JSON.parse(form.schemaDefinition);
    } catch {
      setCreateError("Schema definition must be valid JSON.");
      return;
    }

    try {
      const created = await governance.createSchema({
        name: form.name,
        version: form.version,
        description: form.description,
        schemaDefinition:
          parsedDefinition as CreateSchemaProposalInput["schemaDefinition"],
      });
      setSuccessMessage(
        `Schema proposal “${created.name}” version ${created.version} was recorded.`,
      );
      setShowCreateModal(false);
      resetCreateForm();
      setStatusFilter("PROPOSED");
      setPage(1);
      setSelectedSchemaId(created.id);
    } catch (cause) {
      setCreateError(
        cause instanceof Error
          ? cause.message
          : "Schema proposal submission failed.",
      );
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              <Vote className="h-7 w-7 text-identity-amber" />
              Schema Governance
            </h1>
            <p className="mt-1 text-[var(--text-secondary)]">
              Propose and vote on ZeroID credential schemas through the
              authenticated governance service.
            </p>
          </div>
          {workflowReady && (
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowCreateModal(true);
              }}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" /> Create schema proposal
            </button>
          )}
        </header>

        <section className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
          <h2 className="text-sm font-semibold text-cyan-200">
            Identity governance, not token governance
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            Records and votes are stored by the ZeroID backend under schema
            UUIDs. This workflow has approve/reject identity votes only; it does
            not expose AETH voting power, delegation, abstention, timelocks, or
            wallet transactions.
          </p>
        </section>

        {successMessage && (
          <div
            className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {successMessage}
          </div>
        )}

        {!isConnected || !address ? (
          <section className="card p-10 text-center" role="status">
            <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-amber-300" />
            <h2 className="font-semibold">Connect a wallet for governance</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Use the wallet control in the header. No protected governance
              request has been sent.
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
            <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-amber-300" />
            <h2 className="font-semibold">Register this wallet first</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Schema governance requires a registered ZeroID identity.
            </p>
            <Link href="/identity" className="btn-primary mt-5 inline-flex">
              Open identity setup
            </Link>
          </section>
        ) : !workflowReady ? (
          <section className="card p-10 text-center" role="status">
            <FileKey2 className="mx-auto mb-3 h-9 w-9 text-cyan-300" />
            <h2 className="font-semibold">Sign in for schema governance</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Sign the one-time ZeroID wallet challenge before reading or
              changing governance records.
            </p>
            {sessionError && (
              <p className="mt-3 text-xs text-red-300" role="alert">
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
            <section className="card space-y-4 p-4">
              <form
                onSubmit={applyNameFilter}
                className="flex flex-col gap-3 sm:flex-row"
                role="search"
              >
                <label className="relative flex-1">
                  <span className="sr-only">Filter schemas by name</span>
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                  <input
                    type="search"
                    value={filterInput}
                    onChange={(event) => setFilterInput(event.target.value)}
                    maxLength={100}
                    placeholder="Filter schemas by name"
                    className="input w-full pl-10"
                  />
                </label>
                <button type="submit" className="btn-primary justify-center">
                  Apply filter
                </button>
                {(nameFilter || filterInput) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterInput("");
                      setNameFilter("");
                      setPage(1);
                    }}
                    className="btn-secondary justify-center"
                  >
                    Clear
                  </button>
                )}
              </form>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => selectStatus(filter.id)}
                    className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      statusFilter === filter.id
                        ? "bg-brand-600 text-white"
                        : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </section>

            {governance.isLoading ? (
              <section
                className="card flex items-center justify-center gap-3 p-12 text-sm text-[var(--text-secondary)]"
                role="status"
              >
                <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                Loading schema governance records...
              </section>
            ) : governance.error ? (
              <section
                className="card flex items-start gap-3 border-red-500/20 p-6"
                role="alert"
              >
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
                <div className="flex-1">
                  <h2 className="font-semibold text-red-200">
                    Governance records unavailable
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {governance.error instanceof Error
                      ? governance.error.message
                      : "The authenticated governance request failed."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void governance.refetch()}
                  className="btn-secondary shrink-0"
                >
                  <RefreshCw className="h-4 w-4" /> Retry
                </button>
              </section>
            ) : governance.schemas.length === 0 ? (
              <section className="card p-14 text-center" role="status">
                <FileText className="mx-auto mb-3 h-10 w-10 text-[var(--text-tertiary)]" />
                <h2 className="font-semibold">No schema records found</h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  The backend returned no records for the current status and
                  name filters.
                </p>
              </section>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 text-sm text-[var(--text-secondary)]">
                  <span>
                    {governance.total} schema record
                    {governance.total === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Page {governance.page} of {totalPages}
                  </span>
                </div>

                <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-12 space-y-4 lg:col-span-8">
                    {governance.schemas.map((schema) => (
                      <ProposalCard
                        key={schema.id}
                        schema={schema}
                        selected={schema.id === selectedSchemaId}
                        onViewDetails={setSelectedSchemaId}
                      />
                    ))}

                    <nav
                      aria-label="Schema governance pagination"
                      className="flex items-center justify-between"
                    >
                      <button
                        type="button"
                        disabled={governance.page <= 1}
                        onClick={() => {
                          setPage((current) => Math.max(1, current - 1));
                          setSelectedSchemaId(null);
                        }}
                        className="btn-secondary disabled:opacity-40"
                      >
                        <ArrowLeft className="h-4 w-4" /> Previous
                      </button>
                      <button
                        type="button"
                        disabled={!governance.hasMore}
                        onClick={() => {
                          setPage((current) => current + 1);
                          setSelectedSchemaId(null);
                        }}
                        className="btn-secondary disabled:opacity-40"
                      >
                        Next <ArrowRight className="h-4 w-4" />
                      </button>
                    </nav>
                  </div>

                  <aside className="col-span-12 lg:col-span-4">
                    {!selectedSchemaId ? (
                      <div className="card p-8 text-center">
                        <BarChart3 className="mx-auto mb-3 h-9 w-9 text-[var(--text-tertiary)]" />
                        <p className="text-sm text-[var(--text-secondary)]">
                          Select a schema record to load its current backend
                          detail and voting state.
                        </p>
                      </div>
                    ) : governance.isDetailLoading ? (
                      <div
                        className="card flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-secondary)]"
                        role="status"
                      >
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading
                        schema detail...
                      </div>
                    ) : governance.detailError ? (
                      <div className="card p-6" role="alert">
                        <h2 className="font-semibold text-red-200">
                          Schema detail unavailable
                        </h2>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                          {governance.detailError instanceof Error
                            ? governance.detailError.message
                            : "The schema detail request failed."}
                        </p>
                        <button
                          type="button"
                          onClick={() => void governance.refetchDetail()}
                          className="btn-secondary mt-4"
                        >
                          <RefreshCw className="h-4 w-4" /> Retry detail
                        </button>
                      </div>
                    ) : governance.selectedSchema ? (
                      <VotingPanel
                        schema={governance.selectedSchema}
                        onVote={governance.voteOnSchema}
                        isSubmitting={governance.isVoting}
                        onVoteSubmitted={(schema) =>
                          setSuccessMessage(
                            `Your vote was recorded for “${schema.name}”.`,
                          )
                        }
                      />
                    ) : null}
                  </aside>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetCreateForm();
        }}
        title="Create schema proposal"
        description="Record a PROPOSED schema in the authenticated ZeroID governance database."
        size="lg"
      >
        <form onSubmit={submitSchemaProposal} className="space-y-4">
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3 text-xs leading-5 text-[var(--text-secondary)]">
            This API write does not create an on-chain proposal or request a
            transaction signature.
          </div>
          <div>
            <label
              htmlFor="schema-name"
              className="mb-1.5 block text-sm font-medium"
            >
              Schema name
            </label>
            <input
              id="schema-name"
              required
              minLength={3}
              maxLength={100}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className="input"
              placeholder="Verified Organization"
            />
          </div>
          <div>
            <label
              htmlFor="schema-version"
              className="mb-1.5 block text-sm font-medium"
            >
              Version
            </label>
            <input
              id="schema-version"
              required
              pattern="\d+\.\d+\.\d+"
              value={form.version}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  version: event.target.value,
                }))
              }
              className="input font-mono"
              placeholder="1.0.0"
            />
          </div>
          <div>
            <label
              htmlFor="schema-description"
              className="mb-1.5 block text-sm font-medium"
            >
              Description
            </label>
            <textarea
              id="schema-description"
              required
              minLength={10}
              maxLength={1000}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className="input min-h-[100px] resize-y"
              placeholder="Describe the credential schema and intended claims."
            />
          </div>
          <div>
            <label
              htmlFor="schema-definition"
              className="mb-1.5 block text-sm font-medium"
            >
              JSON schema definition
            </label>
            <textarea
              id="schema-definition"
              required
              maxLength={20_000}
              spellCheck={false}
              value={form.schemaDefinition}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  schemaDefinition: event.target.value,
                }))
              }
              className="input min-h-[220px] resize-y font-mono text-xs"
            />
          </div>

          {createError && (
            <div
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
              role="alert"
            >
              {createError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={governance.isCreating}
              onClick={() => {
                setShowCreateModal(false);
                resetCreateForm();
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={governance.isCreating}
              className="btn-primary disabled:cursor-wait disabled:opacity-60"
            >
              {governance.isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" /> Submit schema proposal
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
