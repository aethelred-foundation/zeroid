"use client";

import { motion } from "framer-motion";
import {
  Clock,
  FileText,
  Fingerprint,
  History,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { AuditLogEntry } from "@/types";

interface AuditTimelineProps {
  events?: AuditLogEntry[];
  isLoading?: boolean;
  error?: Error | null;
  emptyMessage?: string;
}

function stringField(event: AuditLogEntry, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function eventAction(event: AuditLogEntry): string | undefined {
  return event.action ?? stringField(event, "type");
}

function actionLabel(action: string): string {
  return action
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatTimestamp(
  timestamp: AuditLogEntry["timestamp"],
): { date: string; time: string } | null {
  let date: Date;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
  } else if (typeof timestamp === "string" && timestamp.trim()) {
    date = new Date(timestamp);
  } else {
    return null;
  }
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function iconForResource(resourceType?: string) {
  switch (resourceType) {
    case "credential":
      return ShieldCheck;
    case "verification":
      return Fingerprint;
    case "identity":
      return KeyRound;
    case "schema":
      return FileText;
    default:
      return History;
  }
}

export default function AuditTimeline({
  events = [],
  isLoading = false,
  error = null,
  emptyMessage = "No audit records were returned.",
}: AuditTimelineProps) {
  if (isLoading) {
    return (
      <div className="card flex items-center justify-center gap-2 p-8">
        <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading server audit records...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-2 text-red-400">
          <ShieldAlert className="mt-0.5 h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Audit records unavailable</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {error.message}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Audit timeline">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          <Clock className="h-4 w-4 text-brand-500" />
          Audit Timeline
        </h2>
        <span className="text-xs text-[var(--text-tertiary)]">
          {events.length} returned
        </span>
      </div>

      {events.length === 0 ? (
        <div className="card p-8 text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-secondary)]">{emptyMessage}</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-5 top-0 w-px bg-[var(--border-primary)]" />
          <div className="space-y-1">
            {events.map((event, index) => {
              const action = eventAction(event);
              const resourceType =
                event.entityType ?? stringField(event, "resourceType");
              const resourceId =
                event.entityId ?? stringField(event, "resourceId");
              const EventIcon = iconForResource(resourceType);
              const timestamp = formatTimestamp(event.timestamp);

              return (
                <motion.div
                  key={event.id}
                  className="relative py-3 pl-12"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                >
                  <div className="absolute left-3 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/10 ring-4 ring-[var(--surface-primary)]">
                    <EventIcon className="h-3 w-3 text-brand-500" />
                  </div>

                  <div className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {action ? actionLabel(action) : "Action unavailable"}
                        </p>
                        {action && (
                          <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--text-tertiary)]">
                            {action}
                          </p>
                        )}
                        {resourceType && (
                          <p className="mt-2 text-xs text-[var(--text-secondary)]">
                            Resource: {resourceType}
                            {resourceId ? ` / ${resourceId}` : ""}
                          </p>
                        )}
                        {event.description && (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {event.description}
                          </p>
                        )}
                        {event.transactionHash && (
                          <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-tertiary)]">
                            Transaction: {event.transactionHash}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {timestamp ? (
                          <>
                            <p className="text-xs text-[var(--text-secondary)]">
                              {timestamp.date}
                            </p>
                            <p className="text-[10px] text-[var(--text-tertiary)]">
                              {timestamp.time}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-amber-300">
                            Timestamp unavailable
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
