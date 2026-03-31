"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Server,
  Lock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { useTEE } from "@/hooks/useTEE";
import type { TEENodeStatus, AttestationInfo } from "@/types";

interface TEEStatusPanelProps {
  compact?: boolean;
}

const healthColors: Record<string, string> = {
  healthy: "text-status-verified",
  degraded: "text-status-pending",
  offline: "text-status-revoked",
  unknown: "text-[var(--text-tertiary)]",
};

const healthBg: Record<string, string> = {
  healthy: "bg-status-verified/10",
  degraded: "bg-status-pending/10",
  offline: "bg-status-revoked/10",
  unknown: "bg-[var(--surface-tertiary)]",
};

function normalizeHealth(node: TEENodeStatus): keyof typeof healthColors {
  if (
    node.health === "healthy" ||
    node.health === "degraded" ||
    node.health === "offline"
  ) {
    return node.health;
  }
  if (node.health === "unhealthy") return "offline";
  if (node.status === "active") return "healthy";
  if (node.status === "degraded") return "degraded";
  if (node.status === "offline") return "offline";
  return "unknown";
}

export default function TEEStatusPanel({
  compact = false,
}: TEEStatusPanelProps) {
  const { nodes, attestation, isLoading, error, refreshStatus } = useTEE();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshStatus();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="card p-6 flex items-center justify-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Loading TEE status...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 text-red-400">
          <ShieldAlert className="w-5 h-5" />
          <p className="text-sm">Failed to load TEE status</p>
        </div>
      </div>
    );
  }

  const healthyCount =
    nodes?.filter((n: TEENodeStatus) => n.health === "healthy").length ?? 0;
  const totalCount = nodes?.length ?? 0;

  if (compact) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${healthyCount === totalCount ? "bg-status-verified" : "bg-status-pending"}`}
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              TEE Nodes
            </span>
          </div>
          <span className="text-sm text-[var(--text-secondary)]">
            {healthyCount}/{totalCount} healthy
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-[var(--border-primary)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-brand-500" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">
              TEE Status
            </h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Trusted Execution Environment
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="btn-ghost btn-sm"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Attestation info */}
      {attestation && (
        <div className="p-5 border-b border-[var(--border-primary)]">
          <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
            Attestation
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
              <Lock className="w-4 h-4 text-brand-500 mb-1" />
              <p className="text-xs text-[var(--text-tertiary)]">Status</p>
              <p className="text-sm font-medium text-[var(--text-primary)] capitalize">
                {attestation.status}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
              <Clock className="w-4 h-4 text-brand-500 mb-1" />
              <p className="text-xs text-[var(--text-tertiary)]">
                Last Verified
              </p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {attestation.lastVerified
                  ? new Date(attestation.lastVerified).toLocaleString()
                  : "Never"}
              </p>
            </div>
          </div>
          {attestation.enclaveId && (
            <div className="mt-3 p-3 rounded-xl bg-[var(--surface-secondary)]">
              <p className="text-xs text-[var(--text-tertiary)] mb-0.5">
                Enclave ID
              </p>
              <p className="font-mono text-xs text-[var(--text-primary)] break-all">
                {attestation.enclaveId}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Node list */}
      <div className="p-5">
        <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
          Nodes ({healthyCount}/{totalCount} healthy)
        </p>
        <div className="space-y-2">
          {nodes?.map((node: TEENodeStatus) => (
            <motion.div
              key={node.id}
              className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-secondary)]"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {(() => {
                const health = normalizeHealth(node);
                return (
                  <>
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg ${healthBg[health]} flex items-center justify-center`}
                      >
                        <Server className={`w-4 h-4 ${healthColors[health]}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {node.name ?? node.id}
                        </p>
                        <p className="text-xs text-[var(--text-tertiary)] font-mono">
                          {node.region}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {health === "healthy" ? (
                        <CheckCircle2 className="w-4 h-4 text-status-verified" />
                      ) : health === "degraded" ? (
                        <Activity className="w-4 h-4 text-status-pending" />
                      ) : (
                        <XCircle className="w-4 h-4 text-status-revoked" />
                      )}
                      <span
                        className={`text-xs font-medium capitalize ${healthColors[health]}`}
                      >
                        {health}
                      </span>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          ))}
          {(!nodes || nodes.length === 0) && (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
              No TEE nodes available
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
