"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Plus,
  Search,
  Filter,
  Grid3X3,
  List,
  Download,
  ChevronDown,
  Clock,
  XCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import CredentialCard from "@/components/credentials/CredentialCard";
import CredentialRequest from "@/components/credentials/CredentialRequest";
import CredentialList from "@/components/credentials/CredentialList";
import { Modal } from "@/components/ui/Modal";
import { useCredentials } from "@/hooks/useCredentials";

type FilterStatus = "all" | "active" | "pending" | "expired" | "revoked";

const schemaTypes = [
  { id: "age", label: "Age Verification", icon: "🎂" },
  { id: "residency", label: "Residency Proof", icon: "🏠" },
  { id: "nationality", label: "Nationality", icon: "🌍" },
  { id: "credit", label: "Credit Tier", icon: "💳" },
  { id: "employment", label: "Employment Status", icon: "💼" },
  { id: "education", label: "Education", icon: "🎓" },
  { id: "accredited", label: "Accredited Investor", icon: "📊" },
  { id: "kyc", label: "KYC Verification", icon: "✅" },
];

export default function CredentialsPage() {
  const credentialsQuery = useCredentials();
  const credentials = credentialsQuery.data?.credentials ?? [];
  const isLoading = credentialsQuery.isLoading;
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const statusCounts = {
    all: credentials.length,
    active: credentials.filter((c: any) => c.status === "active").length,
    pending: credentials.filter((c: any) => c.status === "pending").length,
    expired: credentials.filter((c: any) => c.status === "expired").length,
    revoked: credentials.filter((c: any) => c.status === "revoked").length,
  };

  const filteredCredentials = credentials.filter((cred: any) => {
    if (filterStatus !== "all" && cred.status !== filterStatus) return false;
    if (
      searchQuery &&
      !cred.schemaType.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Credentials</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Manage your verifiable credentials issued via TEE enclaves
            </p>
          </div>
          <button
            onClick={() => setShowRequestModal(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Request Credential
          </button>
        </div>

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
                id: "pending" as const,
                label: "Pending",
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
        {filteredCredentials.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCredentials.map((credential: any, i: number) => (
                <motion.div
                  key={credential.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <CredentialCard credential={credential} />
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
                ? "Request your first credential to get started"
                : `No ${filterStatus} credentials`}
            </p>
            {filterStatus === "all" && (
              <button
                onClick={() => setShowRequestModal(true)}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                Request Credential
              </button>
            )}
          </motion.div>
        )}

        {/* Available Credential Schemas */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">
            Available Credential Schemas
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {schemaTypes.map((schema) => (
              <button
                key={schema.id}
                onClick={() => setShowRequestModal(true)}
                className="p-4 rounded-xl border border-[var(--border-primary)] hover:border-brand-500/50 hover:bg-brand-500/5 transition-all text-left group"
              >
                <div className="text-2xl mb-2">{schema.icon}</div>
                <div className="text-sm font-medium group-hover:text-brand-400 transition-colors">
                  {schema.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Request Modal */}
      <Modal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        title="Request Credential"
        size="lg"
      >
        <CredentialRequest />
      </Modal>
    </AppLayout>
  );
}
