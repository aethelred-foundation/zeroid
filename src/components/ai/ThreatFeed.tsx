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

function generateMockEvent(): ThreatEvent {
  const types = Object.keys(TYPE_CONFIG) as ThreatType[];
  const severities: ThreatSeverity[] = ["info", "warning", "error", "critical"];
  const type = types[Math.floor(Math.random() * types.length)];
  const severity = severities[Math.floor(Math.random() * severities.length)];

  const descriptions: Record<ThreatType, string> = {
    identity_compromise:
      "Potential identity takeover attempt detected on DID endpoint",
    credential_fraud:
      "Fraudulent credential presentation intercepted during verification",
    unauthorized_access:
      "Unauthorized API access attempt from unregistered IP range",
    sanctions_match:
      "New sanctions list entry matches existing identity in the system",
    anomalous_behavior:
      "Unusual credential request pattern detected from verified issuer",
    network_attack:
      "DDoS mitigation triggered on TEE attestation service endpoint",
  };

  return {
    id: `threat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    severity,
    title: TYPE_CONFIG[type].label,
    description: descriptions[type],
    details: `Full analysis available. Event originated from monitoring subsystem. Automated correlation with ${Math.floor(Math.random() * 5) + 1} related events in the last 24 hours.`,
    source: [
      "TEE Monitor",
      "ZK Verifier",
      "API Gateway",
      "Chain Indexer",
      "Sanctions Oracle",
    ][Math.floor(Math.random() * 5)],
    timestamp: Date.now() - Math.floor(Math.random() * 3600000),
    reviewed: Math.random() > 0.6,
    affectedDid:
      Math.random() > 0.5
        ? `did:aethelred:mainnet:0x${Math.random().toString(16).slice(2, 10)}...`
        : undefined,
  };
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
    () =>
      externalEvents ??
      Array.from({ length: 8 }, () => generateMockEvent()).sort(
        (a, b) => b.timestamp - a.timestamp,
      ),
  );
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<ThreatSeverity | "all">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<ThreatType | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const events = externalEvents ?? internalEvents;

  // Auto-refresh with new mock events
  useEffect(() => {
    if (!autoRefresh || externalEvents) return;

    const interval = setInterval(() => {
      const newEvent = generateMockEvent();
      newEvent.timestamp = Date.now();
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
