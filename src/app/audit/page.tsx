"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  History,
  Search,
  Filter,
  Download,
  ShieldCheck,
  Fingerprint,
  Eye,
  Key,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  FileText,
  Calendar,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import AuditTimeline from "@/components/audit/AuditTimeline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAudit } from "@/hooks/useAudit";

type AuditCategory =
  | "all"
  | "credentials"
  | "verifications"
  | "governance"
  | "identity";

export default function AuditPage() {
  const { auditLog, isLoading } = useAudit();
  const [category, setCategory] = useState<AuditCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<"24h" | "7d" | "30d" | "all">(
    "7d",
  );

  const filteredLog = (auditLog ?? []).filter((entry: any) => {
    if (category !== "all" && entry.category !== category) return false;
    if (
      searchQuery &&
      !entry.action.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const categoryIcons = {
    credentials: ShieldCheck,
    verifications: Fingerprint,
    governance: FileText,
    identity: Key,
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Complete history of identity actions and verifications
            </p>
          </div>
          <button className="btn-secondary">
            <Download className="w-4 h-4" />
            Export Log
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2">
          {(
            [
              { id: "all" as const, label: "All Events", icon: History },
              {
                id: "credentials" as const,
                label: "Credentials",
                icon: ShieldCheck,
              },
              {
                id: "verifications" as const,
                label: "Verifications",
                icon: Fingerprint,
              },
              {
                id: "governance" as const,
                label: "Governance",
                icon: FileText,
              },
              { id: "identity" as const, label: "Identity", icon: Key },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                category === cat.id
                  ? "bg-brand-600 text-white"
                  : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
              }`}
            >
              <cat.icon className="w-4 h-4" />
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search + Date Range */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search audit events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-[var(--surface-secondary)] rounded-xl">
            {(["24h", "7d", "30d", "all"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  dateRange === range
                    ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {range === "all" ? "All" : range}
              </button>
            ))}
          </div>
        </div>

        {/* Audit Timeline */}
        <AuditTimeline />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Total Events",
              value: auditLog?.length ?? 0,
              icon: History,
              color: "text-brand-500",
            },
            {
              label: "Credentials Issued",
              value:
                auditLog?.filter((e: any) => e.action === "credential_issued")
                  .length ?? 0,
              icon: ShieldCheck,
              color: "text-status-verified",
            },
            {
              label: "Proofs Generated",
              value:
                auditLog?.filter((e: any) => e.action === "proof_generated")
                  .length ?? 0,
              icon: Fingerprint,
              color: "text-identity-chrome",
            },
            {
              label: "Revocations",
              value:
                auditLog?.filter((e: any) => e.action === "credential_revoked")
                  .length ?? 0,
              icon: XCircle,
              color: "text-status-revoked",
            },
          ].map((stat) => (
            <div key={stat.label} className="card p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl bg-[var(--surface-secondary)] flex items-center justify-center ${stat.color}`}
                >
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {stat.label}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
