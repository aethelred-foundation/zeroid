// @ts-nocheck
"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  FileText,
  Clock,
  Eye,
  UserCheck,
  KeyRound,
  Loader2,
  Filter,
  ChevronDown,
} from "lucide-react";
import { useAudit } from "@/hooks/useAudit";
import type { AuditEvent, AuditEventType } from "@/types";

interface AuditTimelineProps {
  did?: string;
  limit?: number;
}

const eventConfig: Record<
  AuditEventType,
  { label: string; icon: typeof ShieldCheck; color: string; bgColor: string }
> = {
  "credential-issued": {
    label: "Credential Issued",
    icon: FileText,
    color: "text-status-verified",
    bgColor: "bg-status-verified/10",
  },
  "credential-revoked": {
    label: "Credential Revoked",
    icon: ShieldAlert,
    color: "text-status-revoked",
    bgColor: "bg-status-revoked/10",
  },
  "credential-verified": {
    label: "Credential Verified",
    icon: ShieldCheck,
    color: "text-brand-500",
    bgColor: "bg-brand-500/10",
  },
  "proof-generated": {
    label: "Proof Generated",
    icon: KeyRound,
    color: "text-identity-chrome",
    bgColor: "bg-identity-chrome/10",
  },
  "proof-verified": {
    label: "Proof Verified",
    icon: ShieldCheck,
    color: "text-status-verified",
    bgColor: "bg-status-verified/10",
  },
  "identity-created": {
    label: "Identity Created",
    icon: UserCheck,
    color: "text-brand-500",
    bgColor: "bg-brand-500/10",
  },
  "selective-disclosure": {
    label: "Selective Disclosure",
    icon: Eye,
    color: "text-status-pending",
    bgColor: "bg-status-pending/10",
  },
};

function formatTimestamp(ts: string | number): { date: string; time: string } {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function AuditTimeline({ did, limit = 50 }: AuditTimelineProps) {
  const { auditLog: events, isLoading } = useAudit();
  const error = null;
  const [filterType, setFilterType] = useState<AuditEventType | "all">("all");
  const [showFilter, setShowFilter] = useState(false);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    if (filterType === "all") return events;
    return events.filter((e: AuditEvent) => e.type === filterType);
  }, [events, filterType]);

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading audit trail...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 text-red-400">
          <ShieldAlert className="w-5 h-5" />
          <p className="text-sm">Failed to load audit events</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with filter */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-500" />
          Audit Timeline
        </h3>
        <div className="relative">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="btn-ghost btn-sm"
          >
            <Filter className="w-3.5 h-3.5" />
            {filterType === "all"
              ? "All Events"
              : eventConfig[filterType]?.label}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showFilter ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence>
            {showFilter && (
              <motion.div
                className="absolute right-0 mt-1 z-20 w-48 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-lg overflow-hidden"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
              >
                <button
                  onClick={() => {
                    setFilterType("all");
                    setShowFilter(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface-secondary)] ${
                    filterType === "all"
                      ? "text-brand-500 font-medium"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  All Events
                </button>
                {(Object.keys(eventConfig) as AuditEventType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setFilterType(type);
                      setShowFilter(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface-secondary)] ${
                      filterType === type
                        ? "text-brand-500 font-medium"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {eventConfig[type].label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div className="card p-8 text-center">
          <Clock className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
          <p className="text-sm text-[var(--text-secondary)]">
            No audit events found
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-[var(--border-primary)]" />

          <div className="space-y-1">
            {filteredEvents.map((event: AuditEvent, idx: number) => {
              const config =
                eventConfig[event.type] ?? eventConfig["credential-verified"];
              const EventIcon = config.icon;
              const { date, time } = formatTimestamp(event.timestamp);

              return (
                <motion.div
                  key={event.id}
                  className="relative pl-12 py-3"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-3 top-4 w-5 h-5 rounded-full ${config.bgColor} flex items-center justify-center ring-4 ring-[var(--surface-primary)]`}
                  >
                    <EventIcon className={`w-3 h-3 ${config.color}`} />
                  </div>

                  {/* Event card */}
                  <div className="card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-medium ${config.color}`}>
                          {config.label}
                        </p>
                        {event.description && (
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            {event.description}
                          </p>
                        )}
                        {event.transactionHash && (
                          <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-1">
                            tx: {event.transactionHash.slice(0, 10)}...
                            {event.transactionHash.slice(-6)}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-[var(--text-secondary)]">
                          {date}
                        </p>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                          {time}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
