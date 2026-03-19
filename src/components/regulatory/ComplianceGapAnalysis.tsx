"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Zap,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type GapStatus = "met" | "missing" | "partial" | "expiring";
type GapPriority = "critical" | "high" | "medium" | "low";

interface CredentialGap {
  id: string;
  name: string;
  description: string;
  status: GapStatus;
  priority: GapPriority;
  estimatedDays?: number;
  category: string;
  requiredBy?: string;
  currentCredential?: string;
  expiresAt?: string;
}

interface ComplianceGapAnalysisProps {
  jurisdiction?: string;
  gaps?: CredentialGap[];
  loading?: boolean;
  error?: string | null;
  onRequestCredential?: (gapId: string) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_CONFIG: Record<
  GapStatus,
  { label: string; icon: typeof Shield; color: string; bg: string }
> = {
  met: {
    label: "Met",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  missing: {
    label: "Missing",
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
  },
  partial: {
    label: "Partial",
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  expiring: {
    label: "Expiring",
    icon: Clock,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
  },
};

const PRIORITY_CONFIG: Record<
  GapPriority,
  { label: string; color: string; bg: string; order: number }
> = {
  critical: {
    label: "Critical",
    color: "text-red-400",
    bg: "bg-red-500/10",
    order: 0,
  },
  high: {
    label: "High",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    order: 1,
  },
  medium: {
    label: "Medium",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    order: 2,
  },
  low: { label: "Low", color: "text-zero-400", bg: "bg-zero-500/10", order: 3 },
};

const DEFAULT_GAPS: CredentialGap[] = [
  {
    id: "g1",
    name: "KYC Level 3 Verification",
    description:
      "Enhanced due diligence credential required for high-value transactions",
    status: "missing",
    priority: "critical",
    estimatedDays: 5,
    category: "KYC/AML",
    requiredBy: "MAS Notice 626",
  },
  {
    id: "g2",
    name: "AML Screening Certificate",
    description:
      "Certified anti-money laundering screening from approved provider",
    status: "met",
    priority: "high",
    category: "KYC/AML",
    currentCredential: "AML-CERT-2026-001",
  },
  {
    id: "g3",
    name: "Data Localization Attestation",
    description:
      "Proof that identity data is stored within jurisdictional boundaries",
    status: "partial",
    priority: "high",
    estimatedDays: 14,
    category: "Data Privacy",
    requiredBy: "PDPA Section 26",
  },
  {
    id: "g4",
    name: "Cross-border Transfer License",
    description:
      "License for transferring credential data across jurisdictional boundaries",
    status: "missing",
    priority: "medium",
    estimatedDays: 30,
    category: "Cross-border",
    requiredBy: "MAS PS Act",
  },
  {
    id: "g5",
    name: "Biometric TEE Attestation",
    description:
      "Proof of biometric processing within trusted execution environment",
    status: "met",
    priority: "medium",
    category: "Security",
    currentCredential: "TEE-ATT-2026-042",
  },
  {
    id: "g6",
    name: "Annual Compliance Review",
    description: "Yearly compliance review and audit attestation",
    status: "expiring",
    priority: "high",
    estimatedDays: 7,
    category: "Compliance",
    expiresAt: "2026-04-01",
  },
  {
    id: "g7",
    name: "Sanctions Screening Credential",
    description: "Real-time sanctions list screening capability credential",
    status: "met",
    priority: "critical",
    category: "KYC/AML",
    currentCredential: "SANC-2026-018",
  },
  {
    id: "g8",
    name: "Digital Identity Standard",
    description: "Compliance with national digital identity framework",
    status: "missing",
    priority: "low",
    estimatedDays: 45,
    category: "Identity",
    requiredBy: "NDI Framework",
  },
];

// ============================================================================
// Main Component
// ============================================================================

export default function ComplianceGapAnalysis({
  jurisdiction = "Singapore (SG)",
  gaps = DEFAULT_GAPS,
  loading = false,
  error = null,
  onRequestCredential,
  className = "",
}: ComplianceGapAnalysisProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showMet, setShowMet] = useState(true);

  const sortedGaps = useMemo(() => {
    const filtered = showMet ? gaps : gaps.filter((g) => g.status !== "met");
    return [...filtered].sort((a, b) => {
      // Priority first, then status (missing before partial before expiring before met)
      const statusOrder: Record<GapStatus, number> = {
        missing: 0,
        partial: 1,
        expiring: 2,
        met: 3,
      };
      const priorityDiff =
        PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order;
      if (priorityDiff !== 0) return priorityDiff;
      return statusOrder[a.status] - statusOrder[b.status];
    });
  }, [gaps, showMet]);

  const stats = useMemo(() => {
    const met = gaps.filter((g) => g.status === "met").length;
    const total = gaps.length;
    const percentage = total > 0 ? Math.round((met / total) * 100) : 0;
    return { met, total, percentage };
  }, [gaps]);

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Analyzing compliance gaps...
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
      <div className="px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Compliance Gap Analysis
            </h3>
          </div>
          <span className="text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] px-2.5 py-1 rounded-lg">
            {jurisdiction}
          </span>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">
              Overall Compliance
            </span>
            <span className="text-sm font-bold text-[var(--text-primary)]">
              {stats.met}/{stats.total} requirements met
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-[var(--surface-tertiary)] overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                stats.percentage >= 80
                  ? "bg-emerald-500"
                  : stats.percentage >= 50
                    ? "bg-amber-500"
                    : "bg-red-500"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${stats.percentage}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {stats.percentage}% complete
            </span>
            <button
              onClick={() => setShowMet(!showMet)}
              className="text-[10px] text-brand-500 hover:text-brand-400 transition-colors"
            >
              {showMet ? "Hide met requirements" : "Show all requirements"}
            </button>
          </div>
        </div>
      </div>

      {/* Gap list */}
      <div className="max-h-[480px] overflow-y-auto">
        {sortedGaps.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">
              All requirements are met
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-primary)]">
            {sortedGaps.map((gap, idx) => {
              const statusConfig = STATUS_CONFIG[gap.status];
              const priorityConfig = PRIORITY_CONFIG[gap.priority];
              const StatusIcon = statusConfig.icon;
              const isExpanded = expandedId === gap.id;

              return (
                <motion.div
                  key={gap.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                >
                  <button
                    className="w-full text-left px-5 py-4 hover:bg-[var(--surface-secondary)] transition-colors focus:outline-none"
                    onClick={() => setExpandedId(isExpanded ? null : gap.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg ${statusConfig.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}
                      >
                        <StatusIcon
                          className={`w-4 h-4 ${statusConfig.color}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {gap.name}
                          </h4>
                          <span
                            className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${priorityConfig.bg} ${priorityConfig.color}`}
                          >
                            {priorityConfig.label}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-1">
                          {gap.description}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span
                            className={`text-[10px] font-medium ${statusConfig.color}`}
                          >
                            {statusConfig.label}
                          </span>
                          <span className="text-[10px] text-[var(--text-tertiary)]">
                            {gap.category}
                          </span>
                          {gap.estimatedDays && gap.status !== "met" && (
                            <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                              <Clock className="w-3 h-3" />~{gap.estimatedDays}d
                              to obtain
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-[var(--text-tertiary)]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
                        )}
                      </div>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 pl-16 space-y-3">
                          <p className="text-xs text-[var(--text-secondary)]">
                            {gap.description}
                          </p>

                          {gap.requiredBy && (
                            <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
                              <p className="text-[10px] text-[var(--text-tertiary)]">
                                Required By
                              </p>
                              <p className="text-xs text-[var(--text-primary)]">
                                {gap.requiredBy}
                              </p>
                            </div>
                          )}

                          {gap.currentCredential && (
                            <div className="p-2.5 rounded-lg bg-[var(--surface-secondary)]">
                              <p className="text-[10px] text-[var(--text-tertiary)]">
                                Current Credential
                              </p>
                              <p className="text-xs font-mono text-[var(--text-primary)]">
                                {gap.currentCredential}
                              </p>
                            </div>
                          )}

                          {gap.expiresAt && (
                            <div className="p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/20">
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3 h-3 text-orange-400" />
                                <p className="text-xs text-orange-400">
                                  Expires{" "}
                                  {new Date(gap.expiresAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                          )}

                          {gap.status !== "met" && onRequestCredential && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRequestCredential(gap.id);
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Request Credential
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
