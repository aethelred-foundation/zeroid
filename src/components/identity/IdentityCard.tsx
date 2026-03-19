// @ts-nocheck
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Copy,
  ExternalLink,
  Fingerprint,
  Award,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { useIdentity } from "@/hooks/useIdentity";
import type { IdentityProfile, VerificationStatus } from "@/types";

interface IdentityCardProps {
  identity?: IdentityProfile;
  compact?: boolean;
  onViewDetails?: () => void;
}

const statusConfig: Record<
  VerificationStatus,
  { label: string; badge: string; icon: typeof ShieldCheck; color: string }
> = {
  verified: {
    label: "Verified",
    badge: "badge-verified",
    icon: ShieldCheck,
    color: "#34d399",
  },
  pending: {
    label: "Pending",
    badge: "badge-pending",
    icon: Shield,
    color: "#fbbf24",
  },
  revoked: {
    label: "Revoked",
    badge: "badge-revoked",
    icon: ShieldAlert,
    color: "#fb7185",
  },
  expired: {
    label: "Expired",
    badge: "badge-expired",
    icon: Clock,
    color: "#6b7280",
  },
  unverified: {
    label: "Unverified",
    badge: "badge-pending",
    icon: Shield,
    color: "#fbbf24",
  },
};

function truncateDID(did: string, chars = 8): string {
  if (did.length <= chars * 2 + 3) return did;
  return `${did.slice(0, chars + 6)}...${did.slice(-chars)}`;
}

export default function IdentityCard({
  identity: identityProp,
  compact = false,
  onViewDetails,
}: IdentityCardProps) {
  const { identity: contextIdentity, isLoading, error } = useIdentity();
  const identity = identityProp ?? contextIdentity;
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopyDID = async () => {
    if (!identity?.did) return;
    try {
      await navigator.clipboard.writeText(identity.did);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="bento p-7 animate-pulse h-full">
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-14 h-14 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.04)" }}
          />
          <div className="flex-1 space-y-3">
            <div
              className="h-4 rounded-lg w-3/4"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
            <div
              className="h-3 rounded-lg w-1/2"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="bento p-7"
        style={{ borderColor: "rgba(251,113,133,0.2)" }}
      >
        <div className="flex items-center gap-3 text-rose-400">
          <ShieldAlert className="w-5 h-5" />
          <p className="text-[13px] font-body">
            Failed to load identity: {error.message}
          </p>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div
        className="bento p-7 h-full"
        style={{ borderStyle: "dashed", borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <Shield className="w-7 h-7 text-zero-500" />
          </div>
          <div>
            <p className="text-zero-300 text-[14px] font-display font-medium mb-1">
              No Identity
            </p>
            <p className="text-zero-500 text-[12px] font-body">
              Create your ZeroID to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const status =
    statusConfig[identity.verificationStatus] ?? statusConfig.unverified;
  const StatusIcon = status.icon;

  if (compact) {
    return (
      <motion.div
        className="card-interactive p-4"
        whileHover={{ scale: 1.005 }}
        onClick={onViewDetails}
      >
        <div className="flex items-center gap-3">
          <div className="shield-gradient w-10 h-10 rounded-xl flex items-center justify-center">
            <Fingerprint className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate font-body">
              {truncateDID(identity.did)}
            </p>
            <span className={status.badge}>{status.label}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="relative overflow-hidden rounded-3xl h-full group"
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background layers */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(165deg, #2a2d38 0%, #1a1c26 35%, #111318 65%, #1a1d28 100%)",
        }}
      />

      {/* Chrome edge light */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(192,196,204,0.06) 0%, transparent 35%)",
        }}
      />

      {/* Hover shimmer */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              background:
                "linear-gradient(125deg, rgba(192,196,204,0.05) 0%, transparent 40%, rgba(168,173,184,0.03) 100%)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="relative z-10 p-7 text-white h-full flex flex-col">
        {/* Header row */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <motion.div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(192,196,204,0.12), rgba(192,196,204,0.04))",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
              animate={isHovered ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 0.5 }}
            >
              <Fingerprint className="w-7 h-7 text-chrome-200" />
            </motion.div>
            <div>
              <h3 className="text-[18px] font-bold tracking-tight font-display">
                ZeroID
              </h3>
              <p className="text-white/30 text-[11px] font-mono mt-0.5">
                Self-Sovereign
              </p>
            </div>
          </div>

          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium font-body"
            style={{
              background: `rgba(${status.color === "#34d399" ? "52,211,153" : status.color === "#fbbf24" ? "251,191,36" : "192,196,204"}, 0.08)`,
              border: `1px solid rgba(${status.color === "#34d399" ? "52,211,153" : status.color === "#fbbf24" ? "251,191,36" : "192,196,204"}, 0.15)`,
              color: status.color,
            }}
          >
            <StatusIcon className="w-3.5 h-3.5" />
            {status.label}
          </div>
        </div>

        {/* DID */}
        <div className="mb-8">
          <p className="text-white/25 text-label-sm uppercase mb-2 font-body">
            Decentralized Identifier
          </p>
          <div className="flex items-center gap-2.5">
            <p className="font-mono text-[14px] tracking-wide text-white/70">
              {truncateDID(identity.did, 14)}
            </p>
            <button
              onClick={handleCopyDID}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Copy DID"
            >
              {copied ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-white/25 hover:text-white/50 transition-colors" />
              )}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            {
              icon: Award,
              value: identity.credentialCount ?? 0,
              label: "Credentials",
            },
            {
              icon: ShieldCheck,
              value: identity.verificationCount ?? 0,
              label: "Verifications",
            },
            {
              icon: Clock,
              value: identity.createdAt
                ? new Date(identity.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                : "--",
              label: "Created",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl p-4 text-center"
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <p className="text-[22px] font-bold font-display leading-none mb-1">
                {stat.value}
              </p>
              <p className="text-white/30 text-[10px] font-body uppercase tracking-wider">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="mt-auto flex items-center justify-between pt-5"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}
        >
          <p className="text-white/20 text-[10px] font-mono tracking-wider uppercase">
            Aethelred Network
          </p>
          {onViewDetails && (
            <button
              onClick={onViewDetails}
              className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white transition-colors font-body"
            >
              Details <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
