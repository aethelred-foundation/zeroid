"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Search,
  Grid3X3,
  List,
  Clock,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import CredentialCard from "@/components/credentials/CredentialCard";
import CredentialList from "@/components/credentials/CredentialList";
import { useCredentials } from "@/hooks/useCredentials";
import type { CredentialSummary } from "@/lib/credentials/summary";

type FilterStatus = "all" | "active" | "suspended" | "expired" | "revoked";

export default function CredentialsPage() {
  const credentialsQuery = useCredentials();
  const credentials = credentialsQuery.data?.credentials ?? [];
  const isLoading = credentialsQuery.isLoading;
  const error = credentialsQuery.error;
  const accessState = credentialsQuery.accessState;
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const statusCounts = {
    all: credentials.length,
    active: credentials.filter((credential) => credential.status === "active")
      .length,
    suspended: credentials.filter(
      (credential) => credential.status === "suspended",
    ).length,
    expired: credentials.filter((credential) => credential.status === "expired")
      .length,
    revoked: credentials.filter((credential) => credential.status === "revoked")
      .length,
  };

  const filteredCredentials = credentials.filter(
    (credential: CredentialSummary) => {
      if (filterStatus !== "all" && credential.status !== filterStatus) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          credential.typeLabel.toLowerCase().includes(query) ||
          credential.credentialType.toLowerCase().includes(query) ||
          credential.issuerId.toLowerCase().includes(query)
        );
      }
      return true;
    },
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div>
            <h1 className="text-2xl font-bold">Credentials</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Review credentials returned by the authenticated ZeroID registry
            </p>
          </div>
        </div>

        <section
          data-testid="credential-issuance-boundary"
          className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"
        >
          <h2 className="text-sm font-semibold text-amber-200">
            Issuance is issuer-controlled
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            The current API creates credentials only for an authenticated issuer
            acting on an existing subject DID. A holder request and
            issuer-approval lifecycle is not available yet, so this inventory
            does not present a self-service request action.
          </p>
        </section>

        {/* Status Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {(
            [
              {
                id: "all" as const,
                label: "All",
                icon: ShieldCheck,
                color: "text-brand-500",
              },
              {
                id: "active" as const,
                label: "Active",
                icon: CheckCircle2,
                color: "text-status-verified",
              },
              {
                id: "suspended" as const,
                label: "Suspended",
                icon: Clock,
                color: "text-status-pending",
              },
              {
                id: "expired" as const,
                label: "Expired",
                icon: AlertTriangle,
                color: "text-status-expired",
              },
              {
                id: "revoked" as const,
                label: "Revoked",
                icon: XCircle,
                color: "text-status-revoked",
              },
            ] as const
          ).map((status) => (
            <button
              key={status.id}
              onClick={() => setFilterStatus(status.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                filterStatus === status.id
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
              }`}
            >
              <status.icon
                className={`w-4 h-4 ${filterStatus === status.id ? "text-white" : status.color}`}
              />
              {status.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  filterStatus === status.id
                    ? "bg-white/20 text-white"
                    : "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]"
                }`}
              >
                {statusCounts[status.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Search + View Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Search credentials by type, issuer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center border border-[var(--border-primary)] rounded-xl overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-brand-600 text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2.5 transition-colors ${
                viewMode === "list"
                  ? "bg-brand-600 text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Credentials Grid/List */}
        {isLoading ? (
          <div
            className="card flex items-center justify-center gap-3 p-10 text-sm text-[var(--text-secondary)]"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
            Loading credential inventory...
          </div>
        ) : error ? (
          <div
            className="card flex items-start gap-3 border-red-500/20 p-6 text-red-300"
            role="alert"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Credential inventory unavailable</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {error instanceof Error
                  ? error.message
                  : "The authenticated credential request failed."}
              </p>
            </div>
          </div>
        ) : accessState !== "ready" ? (
          <div
            className="card border-amber-500/20 p-8 text-center"
            role="status"
          >
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-300" />
            <p className="font-medium text-amber-100">
              {accessState === "wallet-required"
                ? "Connect a wallet to load credentials"
                : "Sign in to load credentials"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Credential inventory is protected and has not been requested for
              this session.
            </p>
          </div>
        ) : filteredCredentials.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCredentials.map((credential, i: number) => (
                <motion.div
                  key={credential.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <CredentialCard
                    credential={credential}
                    onVerify={credentialsQuery.verifyCredential}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <CredentialList />
          )
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <ShieldCheck className="w-16 h-16 mx-auto mb-4 text-[var(--text-tertiary)]" />
            <h3 className="text-lg font-semibold mb-2">No credentials found</h3>
            <p className="text-[var(--text-secondary)] mb-6">
              {filterStatus === "all"
                ? "No credentials were returned for this identity"
                : `No ${filterStatus} credentials`}
            </p>
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
