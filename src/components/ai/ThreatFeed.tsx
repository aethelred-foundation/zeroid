"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  Info,
  AlertOctagon,
  Filter,
  ChevronDown,
  ChevronUp,
  Check,
  Clock,
  Loader2,
  Eye,
  Bug,
  Fingerprint,
  Lock,
  Globe,
  RefreshCw,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type ThreatSeverity = "info" | "warning" | "error" | "critical";

type ThreatType =
  | "identity_compromise"
  | "credential_fraud"
  | "unauthorized_access"
  | "sanctions_match"
  | "anomalous_behavior"
  | "network_attack";

interface ThreatEvent {
  id: string;
  type: ThreatType;
  severity: ThreatSeverity;
  title: string;
  description: string;
  details?: string;
  source: string;
  timestamp: number;
  reviewed: boolean;
  affectedDid?: string;
  metadata?: Record<string, string>;
}

interface ThreatFeedProps {
  events?: ThreatEvent[];
  autoRefresh?: boolean;
  refreshInterval?: number;
  loading?: boolean;
  error?: string | null;
  onReview?: (eventId: string) => void;
  onEventClick?: (event: ThreatEvent) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SEVERITY_CONFIG: Record<
  ThreatSeverity,
  {
    label: string;
    icon: typeof Info;
    color: string;
    bg: string;
    border: string;
    dot: string;
  }
> = {
  info: {
    label: "Info",
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    dot: "bg-blue-400",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    dot: "bg-amber-400",
  },
  error: {
    label: "Error",
    icon: ShieldAlert,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    dot: "bg-orange-400",
  },
  critical: {
    label: "Critical",
    icon: AlertOctagon,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    dot: "bg-red-400",
  },
};

const TYPE_CONFIG: Record<ThreatType, { label: string; icon: typeof Shield }> =
  {
    identity_compromise: { label: "Identity Compromise", icon: Fingerprint },
    credential_fraud: { label: "Credential Fraud", icon: ShieldAlert },
    unauthorized_access: { label: "Unauthorized Access", icon: Lock },
    sanctions_match: { label: "Sanctions Match", icon: AlertOctagon },
    anomalous_behavior: { label: "Anomalous Behavior", icon: Bug },
    network_attack: { label: "Network Attack", icon: Globe },
  };

const REFERENCE_THREAT_EVENTS: Array<
  Pick<
    ThreatEvent,
    | "type"
    | "severity"
    | "description"
    | "source"
    | "reviewed"
    | "affectedDid"
    | "metadata"
  > & {
    offsetMs: number;
    relatedEvents: number;
    playbook: string;
  }
> = [
  {
    type: "unauthorized_access",
    severity: "critical",
    description:
      "Privileged verification API call blocked after mTLS fingerprint drift",
    source: "API Gateway",
    reviewed: false,
    affectedDid: "did:aethelred:mainnet:0x9f41c2a8...",
    offsetMs: 4 * 60 * 1000,
    relatedEvents: 4,
    playbook: "EDGE-P1 API containment",
    metadata: {
      confidence: "98%",
      region: "AE-Central",
      control: "mTLS device binding",
    },
  },
  {
    type: "sanctions_match",
    severity: "error",
    description:
      "Sanctions oracle surfaced a potential match during credential presentation",
    source: "Sanctions Oracle",
    reviewed: false,
    affectedDid: "did:aethelred:mainnet:0x71cbb03e...",
    offsetMs: 11 * 60 * 1000,
    relatedEvents: 2,
    playbook: "Presight AML analyst review",
    metadata: {
      confidence: "91%",
      list: "UAE-FIU consolidated",
      action: "manual adjudication",
    },
  },
  {
    type: "network_attack",
    severity: "warning",
    description:
      "TEE attestation endpoint absorbed a traffic spike and held latency budget",
    source: "TEE Monitor",
    reviewed: true,
    offsetMs: 24 * 60 * 1000,
    relatedEvents: 5,
    playbook: "Sovereign enclave protection",
    metadata: {
      confidence: "87%",
      p95: "142 ms",
      mitigation: "rate-limit tier elevated",
    },
  },
  {
    type: "credential_fraud",
    severity: "error",
    description:
      "Duplicate credential presentation detected across two relying applications",
    source: "ZK Verifier",
    reviewed: false,
    affectedDid: "did:aethelred:mainnet:0x31a044d2...",
    offsetMs: 38 * 60 * 1000,
    relatedEvents: 3,
    playbook: "Credential replay investigation",
    metadata: {
      confidence: "94%",
      circuit: "eligibility_v2",
      signal: "context commitment reuse",
    },
  },
  {
    type: "identity_compromise",
    severity: "warning",
    description:
      "Recovery request volume crossed baseline for a high-trust identity cohort",
    source: "Identity Risk Engine",
    reviewed: true,
    offsetMs: 52 * 60 * 1000,
    relatedEvents: 2,
    playbook: "Step-up recovery controls",
    metadata: {
      confidence: "82%",
      cohort: "enterprise administrators",
      action: "hardware re-attestation",
    },
  },
  {
    type: "anomalous_behavior",
    severity: "info",
    description:
      "Issuer activity profile shifted after schema update and stayed within guardrails",
    source: "Governance Monitor",
    reviewed: true,
    offsetMs: 76 * 60 * 1000,
    relatedEvents: 1,
    playbook: "Issuer telemetry review",
    metadata: {
      confidence: "79%",
      schema: "KYC level 2",
      outcome: "no escalation",
    },
  },
  {
    type: "unauthorized_access",
    severity: "warning",
    description:
      "Console session challenged after impossible-travel signal from operator account",
    source: "Session Monitor",
    reviewed: false,
    affectedDid: "did:aethelred:mainnet:0x6a829d10...",
    offsetMs: 91 * 60 * 1000,
    relatedEvents: 2,
    playbook: "Operator access step-up",
    metadata: {
      confidence: "89%",
      factor: "geo-velocity",
      result: "session locked",
    },
  },
  {
    type: "credential_fraud",
    severity: "info",
    description:
      "Low-risk credential anomaly resolved by issuer revocation accumulator update",
    source: "Chain Indexer",
    reviewed: true,
    offsetMs: 118 * 60 * 1000,
    relatedEvents: 1,
    playbook: "Accumulator witness refresh",
    metadata: {
      confidence: "84%",
      epoch: "revocation-1842",
      result: "witness refreshed",
    },
  },
];

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildReferenceThreatEvent(
  sequence: number,
  observedAt = Date.now(),
): ThreatEvent {
  const template =
    REFERENCE_THREAT_EVENTS[sequence % REFERENCE_THREAT_EVENTS.length];
  const cycle = Math.floor(sequence / REFERENCE_THREAT_EVENTS.length);
  const typeConfig = TYPE_CONFIG[template.type];

  return {
    id: `threat_ref_${String(sequence).padStart(3, "0")}`,
    type: template.type,
    severity: template.severity,
    title: typeConfig.label,
    description: template.description,
    details: `Analysis packet ${template.playbook}. Correlated with ${template.relatedEvents} related event${template.relatedEvents === 1 ? "" : "s"} in the last 24 hours.`,
    source: template.source,
    timestamp: observedAt - template.offsetMs - cycle * 15 * 60 * 1000,
    reviewed: template.reviewed,
    affectedDid: template.affectedDid,
    metadata: template.metadata,
  };
}

function buildInitialReferenceThreatEvents(now = Date.now()): ThreatEvent[] {
  return Array.from({ length: REFERENCE_THREAT_EVENTS.length }, (_, index) =>
    buildReferenceThreatEvent(index, now),
  ).sort((a, b) => b.timestamp - a.timestamp);
}

// ============================================================================
// Sub-components
// ============================================================================

function ThreatEventCard({
  event,
  isNew,
  onReview,
  onExpand,
}: {
  event: ThreatEvent;
  isNew?: boolean;
  onReview?: (id: string) => void;
  onExpand?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[event.severity];
  const typeConfig = TYPE_CONFIG[event.type];
  const SeverityIcon = config.icon;
  const TypeIcon = typeConfig.icon;

  return (
    <motion.div
      className={`rounded-xl border ${config.border} ${
        isNew ? config.bg : "bg-[var(--surface-secondary)]"
      } overflow-hidden transition-colors ${event.reviewed ? "opacity-60" : ""}`}
      initial={
        isNew ? { opacity: 0, x: -20, scale: 0.95 } : { opacity: 0, y: 5 }
      }
      animate={{ opacity: event.reviewed ? 0.6 : 1, x: 0, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      layout
    >
      <button
        className="w-full text-left p-4 focus:outline-none"
        onClick={() => {
          setExpanded(!expanded);
          onExpand?.();
        }}
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}
          >
            <SeverityIcon className={`w-4 h-4 ${config.color}`} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                {event.title}
              </h4>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.bg} ${config.color}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                {config.label}
              </span>
              {isNew && (
                <motion.span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-500/10 text-brand-500"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  NEW
                </motion.span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
              {event.description}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                <TypeIcon className="w-3 h-3" />
                {typeConfig.label}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(event.timestamp)}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                via {event.source}
              </span>
            </div>
          </div>

          {/* Expand */}
          <div className="flex-shrink-0 text-[var(--text-tertiary)]">
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-[var(--border-primary)] pt-3 space-y-3">
              {event.details && (
                <p className="text-xs text-[var(--text-secondary)]">
                  {event.details}
                </p>
              )}
              {event.affectedDid && (
                <div className="p-2 rounded-lg bg-[var(--surface-primary)]">
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    Affected DID:
                  </span>
                  <p className="text-xs font-mono text-[var(--text-primary)]">
                    {event.affectedDid}
                  </p>
                </div>
              )}
              {event.metadata && (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(event.metadata).map(([key, value]) => (
                    <div
                      key={key}
                      className="p-2 rounded-lg bg-[var(--surface-primary)]"
                    >
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {key}
                      </span>
                      <p className="text-xs text-[var(--text-primary)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                {!event.reviewed && onReview && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReview(event.id);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Mark Reviewed
                  </button>
                )}
                {event.reviewed && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Eye className="w-3 h-3" />
                    Reviewed
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ThreatFeed({
  events: externalEvents,
  autoRefresh = true,
  refreshInterval = 8000,
  loading = false,
  error = null,
  onReview,
  onEventClick,
  className = "",
}: ThreatFeedProps) {
  const [internalEvents, setInternalEvents] = useState<ThreatEvent[]>(
    () => externalEvents ?? buildInitialReferenceThreatEvents(),
  );
  const nextReferenceEvent = useRef(REFERENCE_THREAT_EVENTS.length);
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<ThreatSeverity | "all">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<ThreatType | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const events = externalEvents ?? internalEvents;

  // Auto-refresh with deterministic reference events
  useEffect(() => {
    if (!autoRefresh || externalEvents) return;

    const interval = setInterval(() => {
      const newEvent = buildReferenceThreatEvent(
        nextReferenceEvent.current,
        Date.now(),
      );
      nextReferenceEvent.current += 1;
      setInternalEvents((prev) => [newEvent, ...prev].slice(0, 50));
      setNewEventIds((prev) => {
        const next = new Set(prev);
        next.add(newEvent.id);
        return next;
      });

      // Clear "new" status after 5s
      setTimeout(() => {
        setNewEventIds((prev) => {
          const next = new Set(prev);
          next.delete(newEvent.id);
          return next;
        });
      }, 5000);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, externalEvents]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [events.length, autoScroll]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (severityFilter !== "all" && e.severity !== severityFilter)
        return false;
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      return true;
    });
  }, [events, severityFilter, typeFilter]);

  const handleReview = useCallback(
    (eventId: string) => {
      if (onReview) {
        onReview(eventId);
      } else {
        setInternalEvents((prev) =>
          prev.map((e) => (e.id === eventId ? { ...e, reviewed: true } : e)),
        );
      }
    },
    [onReview],
  );

  const unreviewedCount = useMemo(
    () => events.filter((e) => !e.reviewed).length,
    [events],
  );

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading threat feed...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <ShieldAlert className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Shield className="w-5 h-5 text-brand-500" />
            {unreviewedCount > 0 && (
              <motion.span
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] text-white font-bold flex items-center justify-center"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {unreviewedCount > 9 ? "9+" : unreviewedCount}
              </motion.span>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Threat Intelligence Feed
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              {filteredEvents.length} events {autoRefresh && "- Live"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {autoRefresh && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            </motion.div>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <Filter className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            className="px-5 py-3 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] text-[var(--text-tertiary)] self-center mr-1">
                Severity:
              </span>
              {(["all", "info", "warning", "error", "critical"] as const).map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                      severityFilter === s
                        ? "bg-brand-500/20 text-brand-500"
                        : "bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                    }`}
                  >
                    {s === "all" ? "All" : SEVERITY_CONFIG[s].label}
                  </button>
                ),
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-[10px] text-[var(--text-tertiary)] self-center mr-1">
                Type:
              </span>
              <button
                onClick={() => setTypeFilter("all")}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                  typeFilter === "all"
                    ? "bg-brand-500/20 text-brand-500"
                    : "bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                }`}
              >
                All
              </button>
              {(Object.keys(TYPE_CONFIG) as ThreatType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    typeFilter === t
                      ? "bg-brand-500/20 text-brand-500"
                      : "bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                  }`}
                >
                  {TYPE_CONFIG[t].label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event list */}
      <div
        ref={listRef}
        className="max-h-[500px] overflow-y-auto p-4 space-y-3"
      >
        {filteredEvents.length === 0 ? (
          <div className="py-8 text-center">
            <Shield className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">
              No threat events match your filters
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filteredEvents.map((event) => (
              <ThreatEventCard
                key={event.id}
                event={event}
                isNew={newEventIds.has(event.id)}
                onReview={handleReview}
                onExpand={() => onEventClick?.(event)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
