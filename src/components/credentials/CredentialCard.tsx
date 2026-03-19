// @ts-nocheck
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ChevronDown,
  ChevronUp,
  User,
  Building2,
  Calendar,
  FileText,
  AlertTriangle,
} from "lucide-react";
import type {
  Credential,
  VerificationStatus,
  CredentialAttribute,
} from "@/types";

interface CredentialCardProps {
  credential: Credential;
  onRevoke?: (id: string) => void;
  onVerify?: (id: string) => void;
}

const statusConfig: Record<
  string,
  { label: string; badge: string; color: string; icon: typeof ShieldCheck }
> = {
  verified: {
    label: "Verified",
    badge: "badge-verified",
    color: "text-status-verified",
    icon: ShieldCheck,
  },
  pending: {
    label: "Pending",
    badge: "badge-pending",
    color: "text-status-pending",
    icon: Clock,
  },
  revoked: {
    label: "Revoked",
    badge: "badge-revoked",
    color: "text-status-revoked",
    icon: ShieldAlert,
  },
  expired: {
    label: "Expired",
    badge: "badge-expired",
    color: "text-status-expired",
    icon: AlertTriangle,
  },
  unverified: {
    label: "Unverified",
    badge: "badge-pending",
    color: "text-[var(--text-tertiary)]",
    icon: Shield,
  },
};

const schemaIcons: Record<string, typeof FileText> = {
  identity: User,
  organization: Building2,
  document: FileText,
};

function formatDate(date: string | number): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isExpiringSoon(expiresAt?: string | number): boolean {
  if (!expiresAt) return false;
  const daysUntilExpiry =
    (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
}

export default function CredentialCard({
  credential,
  onRevoke,
  onVerify,
}: CredentialCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const status =
    statusConfig[credential.status as unknown as string] ??
    statusConfig.unverified;
  const StatusIcon = status.icon;
  const SchemaIcon = schemaIcons[credential.schemaType ?? ""] ?? FileText;
  const expiringSoon = isExpiringSoon(credential.expiresAt);

  return (
    <motion.div
      className="card-interactive overflow-hidden"
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Main card area */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left p-5 focus:outline-none"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-4">
          {/* Shield icon with status color */}
          <div
            className={`
              relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
              ${
                (credential.status as unknown as string) === "verified"
                  ? "bg-status-verified/10"
                  : (credential.status as unknown as string) === "pending"
                    ? "bg-status-pending/10"
                    : (credential.status as unknown as string) === "revoked"
                      ? "bg-status-revoked/10"
                      : "bg-[var(--surface-tertiary)]"
              }
            `}
          >
            <Shield className={`w-6 h-6 ${status.color}`} />
            <motion.div
              className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--surface-elevated)] ${
                (credential.status as unknown as string) === "verified"
                  ? "bg-status-verified"
                  : (credential.status as unknown as string) === "pending"
                    ? "bg-status-pending"
                    : (credential.status as unknown as string) === "revoked"
                      ? "bg-status-revoked"
                      : "bg-[var(--text-tertiary)]"
              }`}
              animate={
                (credential.status as unknown as string) === "pending"
                  ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
                  : {}
              }
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-[var(--text-primary)] truncate">
                {credential.name}
              </h3>
              <span className={status.badge}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1">
                <SchemaIcon className="w-3 h-3" />
                {credential.schemaType}
              </span>
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {credential.issuer}
              </span>
            </div>
            {expiringSoon && (
              <div className="mt-2 flex items-center gap-1 text-xs text-status-pending">
                <AlertTriangle className="w-3 h-3" />
                Expires {formatDate(credential.expiresAt!)}
              </div>
            )}
          </div>

          {/* Expand toggle */}
          <div className="flex-shrink-0 text-[var(--text-tertiary)]">
            {isExpanded ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
          </div>
        </div>
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-[var(--border-primary)] pt-4 space-y-4">
              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
                  <p className="text-xs text-[var(--text-tertiary)] mb-0.5">
                    Issued
                  </p>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {credential.issuedAt
                      ? formatDate(credential.issuedAt)
                      : "N/A"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
                  <p className="text-xs text-[var(--text-tertiary)] mb-0.5">
                    Expires
                  </p>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {credential.expiresAt
                      ? formatDate(credential.expiresAt)
                      : "No Expiry"}
                  </p>
                </div>
              </div>

              {/* Attributes */}
              {credential.attributes && credential.attributes.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    Attributes
                  </p>
                  <div className="space-y-1.5">
                    {credential.attributes.map((attr: CredentialAttribute) => (
                      <div
                        key={attr.key}
                        className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-[var(--surface-secondary)] text-sm"
                      >
                        <span className="text-[var(--text-secondary)]">
                          {attr.key}
                        </span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {attr.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                {onVerify &&
                  (credential.status as unknown as string) !== "verified" && (
                    <button
                      onClick={() => onVerify(credential.id ?? credential.hash)}
                      className="btn-primary btn-sm flex-1"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Verify
                    </button>
                  )}
                {onRevoke &&
                  (credential.status as unknown as string) === "verified" && (
                    <button
                      onClick={() => onRevoke(credential.id ?? credential.hash)}
                      className="btn-danger btn-sm flex-1"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Revoke
                    </button>
                  )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
