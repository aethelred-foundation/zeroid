"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Brain,
  Cpu,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Eye,
  Pause,
  FileText,
  Zap,
  Star,
  User,
  Link2,
  Activity,
  Loader2,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type AgentType = "llm" | "autonomous" | "bot";
type AgentStatus = "active" | "suspended" | "inactive" | "pending_review";

interface AgentCapability {
  id: string;
  label: string;
  description?: string;
}

interface DelegationInfo {
  delegatorDid: string;
  delegatorName: string;
  delegatedAt: number;
  expiresAt?: number;
}

interface AgentIdentity {
  id: string;
  did: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: AgentCapability[];
  delegation?: DelegationInfo;
  reputationScore: number;
  activityData: number[];
  humanInTheLoop: boolean;
  lastActive?: number;
  createdAt: number;
  verificationCount: number;
}

interface AgentCardProps {
  agent: AgentIdentity;
  onVerify?: (agentId: string) => void;
  onSuspend?: (agentId: string) => void;
  onAudit?: (agentId: string) => void;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const AGENT_TYPE_CONFIG: Record<
  AgentType,
  { label: string; icon: typeof Bot; color: string; bg: string }
> = {
  llm: {
    label: "LLM Agent",
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  autonomous: {
    label: "Autonomous",
    icon: Cpu,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  bot: {
    label: "Bot",
    icon: Bot,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; dot: string }
> = {
  active: { label: "Active", color: "text-emerald-400", dot: "bg-emerald-400" },
  suspended: { label: "Suspended", color: "text-red-400", dot: "bg-red-400" },
  inactive: { label: "Inactive", color: "text-zero-400", dot: "bg-zero-400" },
  pending_review: {
    label: "Pending Review",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
};

// ============================================================================
// Sub-components
// ============================================================================

function ActivitySparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (v / max) * 100;
    return `${x},${y}`;
  });

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`${className}`}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
      </linearGradient>
      <polygon
        points={`0,100 ${points.join(" ")} 100,100`}
        fill="url(#sparkFill)"
      />
    </svg>
  );
}

function ReputationRing({ score, size }: { score: number; size: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color =
    score >= 80
      ? "text-emerald-400"
      : score >= 60
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-[var(--surface-tertiary)]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          className={color}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className={`text-sm font-bold ${color}`}>{score}</p>
          <p className="text-[8px] text-[var(--text-tertiary)]">REP</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AgentCard({
  agent,
  onVerify,
  onSuspend,
  onAudit,
  loading = false,
  compact = false,
  className = "",
}: AgentCardProps) {
  const [copied, setCopied] = useState(false);

  const typeConfig = AGENT_TYPE_CONFIG[agent.type];
  const statusConfig = STATUS_CONFIG[agent.status];
  const TypeIcon = typeConfig.icon;

  const handleCopyDid = async () => {
    try {
      await navigator.clipboard.writeText(agent.did);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const truncatedDid = useMemo(() => {
    if (agent.did.length <= 24) return agent.did;
    return `${agent.did.slice(0, 16)}...${agent.did.slice(-6)}`;
  }, [agent.did]);

  if (loading) {
    return (
      <div className={`card p-6 animate-pulse ${className}`}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--surface-tertiary)]" />
          <div className="flex-1 space-y-3">
            <div className="h-4 bg-[var(--surface-tertiary)] rounded w-3/4" />
            <div className="h-3 bg-[var(--surface-tertiary)] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <motion.div
        className={`card-interactive p-4 ${className}`}
        whileHover={{ scale: 1.01 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl ${typeConfig.bg} flex items-center justify-center`}
          >
            <TypeIcon className={`w-5 h-5 ${typeConfig.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {agent.name}
              </p>
              <span className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
            </div>
            <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
              {truncatedDid}
            </p>
          </div>
          <ReputationRing score={agent.reputationScore} size={40} />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header */}
      <div className="p-5 pb-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div
              className={`relative w-14 h-14 rounded-2xl ${typeConfig.bg} flex items-center justify-center border border-${typeConfig.color}/20`}
            >
              <TypeIcon className={`w-7 h-7 ${typeConfig.color}`} />
              <motion.span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${statusConfig.dot} border-2 border-[var(--surface-primary)]`}
                animate={
                  agent.status === "active"
                    ? { scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }
                    : {}
                }
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {agent.name}
              </h3>
              <span
                className={`inline-flex items-center gap-1 text-[10px] ${typeConfig.color}`}
              >
                <TypeIcon className="w-3 h-3" />
                {typeConfig.label}
              </span>
            </div>
          </div>
          <ReputationRing score={agent.reputationScore} size={56} />
        </div>

        {/* DID */}
        <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-[var(--surface-secondary)]">
          <p className="text-xs font-mono text-[var(--text-secondary)] flex-1 truncate">
            {truncatedDid}
          </p>
          <button
            onClick={handleCopyDid}
            className="p-1 rounded hover:bg-[var(--surface-tertiary)] transition-colors"
            aria-label="Copy DID"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
            )}
          </button>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-3 mt-3">
          <span
            className={`flex items-center gap-1.5 text-xs ${statusConfig.color}`}
          >
            <span className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
            {statusConfig.label}
          </span>
          {agent.humanInTheLoop && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
              <User className="w-3 h-3" />
              Human-in-the-Loop
            </span>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="px-5 mt-4">
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
          Capabilities
        </p>
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities.map((cap) => (
            <span
              key={cap.id}
              className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)]"
              title={cap.description}
            >
              {cap.label}
            </span>
          ))}
        </div>
      </div>

      {/* Delegation chain */}
      {agent.delegation && (
        <div className="px-5 mt-4">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Delegation Chain
          </p>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--surface-secondary)]">
            <Link2 className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                {agent.delegation.delegatorName}
              </p>
              <p className="text-[10px] font-mono text-[var(--text-tertiary)] truncate">
                {agent.delegation.delegatorDid}
              </p>
            </div>
            {agent.delegation.expiresAt && (
              <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                Exp:{" "}
                {new Date(
                  agent.delegation.expiresAt * 1000,
                ).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Activity sparkline */}
      {agent.activityData.length > 0 && (
        <div className="px-5 mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              Activity (7d)
            </p>
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
              <Activity className="w-3 h-3" />
              {agent.verificationCount} verifications
            </span>
          </div>
          <div className="h-12 w-full">
            <ActivitySparkline
              data={agent.activityData}
              className="w-full h-full text-brand-500"
            />
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-2 p-5 mt-2 border-t border-[var(--border-primary)]">
        {onVerify && agent.status !== "active" && (
          <button
            onClick={() => onVerify(agent.id)}
            className="btn-primary btn-sm flex-1"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Verify
          </button>
        )}
        {onSuspend && agent.status === "active" && (
          <button
            onClick={() => onSuspend(agent.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <Pause className="w-3.5 h-3.5" />
            Suspend
          </button>
        )}
        {onAudit && (
          <button
            onClick={() => onAudit(agent.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Audit
          </button>
        )}
      </div>
    </motion.div>
  );
}
