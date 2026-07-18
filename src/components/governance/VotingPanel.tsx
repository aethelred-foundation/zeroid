"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  Vote,
} from "lucide-react";
import type { SchemaRegistryRecord } from "@/lib/schemas/registry";

interface VotingPanelProps {
  schema: SchemaRegistryRecord;
  onVote: (schemaId: string, approve: boolean) => Promise<SchemaRegistryRecord>;
  isSubmitting?: boolean;
  onVoteSubmitted?: (schema: SchemaRegistryRecord) => void;
}

type VoteChoice = "approve" | "reject";

export default function VotingPanel({
  schema,
  onVote,
  isSubmitting = false,
  onVoteSubmitted,
}: VotingPanelProps) {
  const [selectedVote, setSelectedVote] = useState<VoteChoice | null>(null);
  const [submittedVote, setSubmittedVote] = useState<VoteChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitVote = async () => {
    if (!selectedVote || isSubmitting) return;
    setError(null);
    try {
      const updatedSchema = await onVote(schema.id, selectedVote === "approve");
      setSubmittedVote(selectedVote);
      onVoteSubmitted?.(updatedSchema);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Schema vote submission failed",
      );
    }
  };

  return (
    <section className="card overflow-hidden" aria-label="Schema voting panel">
      <div className="border-b border-[var(--border-primary)] p-5">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          <Vote className="h-4 w-4 text-brand-500" />
          Schema vote
        </h2>
        <p className="mt-1 break-all font-mono text-xs text-[var(--text-tertiary)]">
          {schema.id}
        </p>
      </div>

      <div className="border-b border-[var(--border-primary)] p-5">
        <h3 className="text-sm font-semibold">{schema.name}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
          Version {schema.version} · proposed by identity {schema.proposedBy}
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          {schema.description}
        </p>
        <details className="mt-4 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Inspect exact schema definition
          </summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[var(--text-secondary)]">
            {JSON.stringify(schema.schemaDefinition, null, 2)}
          </pre>
        </details>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            This records an authenticated identity vote in ZeroID&apos;s schema
            governance database. It does not broadcast a wallet transaction or
            spend AETH.
          </p>
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div
            className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {submittedVote ? (
          <div className="py-6 text-center" role="status">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-status-verified" />
            <p className="font-semibold">Vote recorded</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Your identity voted to {submittedVote} this schema proposal.
            </p>
          </div>
        ) : schema.status !== "PROPOSED" ? (
          <div className="py-6 text-center" role="status">
            <p className="font-medium">Voting is not open</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Only records in the Proposed state accept approve or reject votes.
              This record is {schema.status.toLowerCase()}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setSelectedVote("approve")}
              aria-pressed={selectedVote === "approve"}
              className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors disabled:opacity-60 ${
                selectedVote === "approve"
                  ? "border-status-verified bg-status-verified/10 text-status-verified"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-status-verified/5"
              }`}
            >
              <ThumbsUp className="h-5 w-5" />
              <span>
                <span className="block text-sm font-semibold">Approve</span>
                <span className="mt-0.5 block text-xs opacity-80">
                  Support this schema definition and version.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setSelectedVote("reject")}
              aria-pressed={selectedVote === "reject"}
              className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-colors disabled:opacity-60 ${
                selectedVote === "reject"
                  ? "border-status-revoked bg-status-revoked/10 text-status-revoked"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-status-revoked/5"
              }`}
            >
              <ThumbsDown className="h-5 w-5" />
              <span>
                <span className="block text-sm font-semibold">Reject</span>
                <span className="mt-0.5 block text-xs opacity-80">
                  Oppose this schema definition and version.
                </span>
              </span>
            </button>

            <button
              type="button"
              disabled={!selectedVote || isSubmitting}
              onClick={() => void submitVote()}
              className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording vote...
                </>
              ) : (
                <>
                  <Vote className="h-4 w-4" /> Record identity vote
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
