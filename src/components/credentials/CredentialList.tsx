"use client";
// @ts-nocheck

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  Grid3X3,
  List,
  ShieldCheck,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  FolderOpen,
} from "lucide-react";
import CredentialCard from "./CredentialCard";
import { useCredentials } from "@/hooks/useCredentials";
import type {
  Credential,
  VerificationStatus,
  CredentialSchemaType,
} from "@/types";

type ViewMode = "grid" | "list";

const STATUS_FILTERS: {
  value: VerificationStatus | "all";
  label: string;
  icon: typeof ShieldCheck;
}[] = [
  { value: "all", label: "All", icon: Filter },
  { value: "verified", label: "Verified", icon: ShieldCheck },
  { value: "pending", label: "Pending", icon: Clock },
  { value: "revoked", label: "Revoked", icon: ShieldAlert },
  { value: "expired", label: "Expired", icon: AlertTriangle },
];

const SCHEMA_FILTERS: { value: CredentialSchemaType | "all"; label: string }[] =
  [
    { value: "all", label: "All Types" },
    { value: "identity", label: "Identity" },
    { value: "accreditation", label: "Accreditation" },
    { value: "kyc", label: "KYC" },
    { value: "education", label: "Education" },
    { value: "employment", label: "Employment" },
  ];

export default function CredentialList() {
  const { credentials, isLoading, error, revokeCredential, verifyCredential } =
    useCredentials();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "all">(
    "all",
  );
  const [schemaFilter, setSchemaFilter] = useState<
    CredentialSchemaType | "all"
  >("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const filteredCredentials = useMemo(() => {
    if (!credentials) return [];

    return credentials.filter((cred: Credential) => {
      if (statusFilter !== "all" && cred.status !== statusFilter) return false;
      if (schemaFilter !== "all" && cred.schemaType !== schemaFilter)
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          cred.name.toLowerCase().includes(q) ||
          cred.issuer.toLowerCase().includes(q) ||
          cred.schemaType.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [credentials, statusFilter, schemaFilter, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
        <span className="ml-3 text-[var(--text-secondary)]">
          Loading credentials...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <ShieldAlert className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-400">
          Failed to load credentials: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search credentials..."
            className="input pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={schemaFilter}
            onChange={(e) =>
              setSchemaFilter(e.target.value as CredentialSchemaType | "all")
            }
            className="input w-auto"
          >
            {SCHEMA_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <div className="flex items-center border border-[var(--border-primary)] rounded-xl overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 transition-colors ${
                viewMode === "grid"
                  ? "bg-brand-500/10 text-brand-500"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
              aria-label="Grid view"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 transition-colors ${
                viewMode === "list"
                  ? "bg-brand-500/10 text-brand-500"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-secondary)] overflow-x-auto">
        {STATUS_FILTERS.map((filter) => {
          const Icon = filter.icon;
          const isActive = statusFilter === filter.value;
          return (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <p className="text-xs text-[var(--text-tertiary)]">
        {filteredCredentials.length} credential
        {filteredCredentials.length !== 1 ? "s" : ""} found
      </p>

      {/* Credential list */}
      {filteredCredentials.length === 0 ? (
        <motion.div
          className="card p-12 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <FolderOpen className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3" />
          <p className="text-[var(--text-secondary)] text-sm">
            {credentials && credentials.length > 0
              ? "No credentials match your filters."
              : "No credentials yet. Request your first credential to get started."}
          </p>
        </motion.div>
      ) : (
        <motion.div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 gap-4"
              : "space-y-3"
          }
          layout
        >
          <AnimatePresence mode="popLayout">
            {filteredCredentials.map((credential: Credential) => (
              <CredentialCard
                key={credential.id}
                credential={credential}
                onRevoke={revokeCredential}
                onVerify={verifyCredential}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
