"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileKey2,
  ThumbsDown,
  ThumbsUp,
  Vote,
  XCircle,
} from "lucide-react";
import type {
  SchemaGovernanceStatus,
  SchemaRegistryRecord,
} from "@/lib/schemas/registry";

interface ProposalCardProps {
  schema: SchemaRegistryRecord;
  onViewDetails?: (schemaId: string) => void;
  selected?: boolean;
}

const statusConfig: Record<
  SchemaGovernanceStatus,
  { label: string; color: string; background: string; icon: typeof Clock }
> = {
  DRAFT: {
    label: "Draft",
    color: "text-[var(--text-secondary)]",
    background: "bg-[var(--surface-tertiary)]",
    icon: Clock,
  },
  PROPOSED: {
    label: "Proposed",
    color: "text-amber-300",
    background: "bg-amber-500/10",
    icon: Vote,
  },
  APPROVED: {
    label: "Approved",
    color: "text-status-verified",
    background: "bg-status-verified/10",
    icon: CheckCircle2,
  },
  DEPRECATED: {
    label: "Deprecated",
    color: "text-status-revoked",
    background: "bg-status-revoked/10",
    icon: XCircle,
  },
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function ProposalCard({
  schema,
  onViewDetails,
  selected = false,
}: ProposalCardProps) {
  const status = statusConfig[schema.status];
  const StatusIcon = status.icon;
  const totalVotes = schema.approvalVotes + schema.rejectionVotes;
  const approvalPercentage =
    totalVotes > 0 ? (schema.approvalVotes / totalVotes) * 100 : 0;
  const rejectionPercentage =
    totalVotes > 0 ? (schema.rejectionVotes / totalVotes) * 100 : 0;
  const fieldCount = Object.keys(schema.schemaDefinition.properties).length;

  return (
    <article
      className={`card overflow-hidden transition-colors ${
        selected ? "border-brand-500/50" : ""
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${status.background} ${status.color}`}
              >
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </span>
              <span className="font-mono text-xs text-[var(--text-tertiary)]">
                v{schema.version}
              </span>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {schema.name}
            </h2>
          </div>
          <FileKey2 className="h-5 w-5 shrink-0 text-brand-400" />
        </div>

        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--text-secondary)]">
          {schema.description}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-[var(--text-tertiary)]">Proposer identity</dt>
            <dd
              className="mt-1 truncate font-mono text-[var(--text-secondary)]"
              title={schema.proposedBy}
            >
              {schema.proposedBy}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">Declared fields</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">{fieldCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">Created</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              {formatDate(schema.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">Identity voters</dt>
            <dd className="mt-1 text-[var(--text-secondary)]">
              {schema.voters.length}
            </dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-[var(--border-primary)] pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1 text-status-verified">
              <ThumbsUp className="h-3.5 w-3.5" />
              {schema.approvalVotes} approve
            </span>
            <span className="inline-flex items-center gap-1 text-status-revoked">
              <ThumbsDown className="h-3.5 w-3.5" />
              {schema.rejectionVotes} reject
            </span>
          </div>
          <div
            className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"
            aria-label={`${approvalPercentage.toFixed(0)}% approve, ${rejectionPercentage.toFixed(0)}% reject`}
          >
            {approvalPercentage > 0 && (
              <div
                className="h-full bg-status-verified"
                style={{ width: `${approvalPercentage}%` }}
              />
            )}
            {rejectionPercentage > 0 && (
              <div
                className="h-full bg-status-revoked"
                style={{ width: `${rejectionPercentage}%` }}
              />
            )}
          </div>
        </div>

        {onViewDetails && (
          <button
            type="button"
            onClick={() => onViewDetails(schema.id)}
            className="btn-ghost mt-4 w-full text-sm"
          >
            {schema.status === "PROPOSED" ? "Review and vote" : "View record"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}
