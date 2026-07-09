"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Copy,
  ExternalLink,
  Fingerprint,
  Clock,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useIdentity } from "@/hooks/useIdentity";
import type { DID, IdentityProfile } from "@/types";

interface IdentityCardProps {
  identity?: IdentityProfile;
  compact?: boolean;
  onViewDetails?: () => void;
}

type IdentityVerificationState =
  | "verified"
  | "pending"
  | "revoked"
  | "expired"
  | "unverified";

const statusConfig: Record<
  IdentityVerificationState,
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

function getDidString(did: string | DID | undefined): string {
  if (!did) return "";
  return typeof did === "string" ? did : did.uri;
}

/**
 * The identity rendered as a physical object: a brushed-titanium card with the
 * DID laser-engraved into the metal and the verification state as a hallmark
 * stamp. Registered and unregistered states are the same object — one etched,
 * one still blank.
 */
export default function IdentityCard({
  identity: identityProp,
  compact = false,
  onViewDetails,
}: IdentityCardProps) {
  const { identity: contextIdentity, isLoading, error } = useIdentity();
  const identity = identityProp ?? contextIdentity;
  const did = getDidString(identity?.did);
  const verificationStatus = (identity?.verificationStatus ??
    "unverified") as IdentityVerificationState;
  const credentialCount = identity?.credentialCount ?? 0;
  const verificationCount = identity?.verificationCount ?? 0;
  const createdAt = identity?.createdAt;
  const [copied, setCopied] = useState(false);

  const handleCopyDID = async () => {
    if (!did) return;
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="titanium-card p-7 animate-pulse h-full">
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-12 h-12 rounded-xl"
            style={{ background: "rgba(255,255,255,0.05)" }}
          />
          <div className="flex-1 space-y-3">
            <div
              className="h-4 rounded-lg w-3/4"
              style={{ background: "rgba(255,255,255,0.05)" }}
            />
            <div
              className="h-3 rounded-lg w-1/2"
              style={{ background: "rgba(255,255,255,0.05)" }}
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

  // The hook always returns an identity object (with hasIdentity/profile
  // fields), so "no identity" must be detected from its contents: a wallet is
  // unregistered when it has neither a backend profile nor an on-chain DID.
  const notRegistered =
    !identity ||
    ((identity as { isRegistered?: boolean }).isRegistered === false &&
      !(identity as { profile?: unknown }).profile);

  if (notRegistered) {
    // A blank card: the same titanium object, not yet engraved.
    return (
      <div className="titanium-card p-7 h-full flex flex-col">
        <div className="flex items-start justify-between">
          <span className="engraved-faint text-[13px] font-display font-semibold tracking-[0.22em] uppercase">
            ZeroID
          </span>
          <span className="hallmark engraved-faint">Unminted</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div className="icon-chip">
            <Shield className="w-[18px] h-[18px]" />
          </div>
          <div>
            <p className="engraved text-[15px] font-display font-semibold mb-1">
              No identity yet
            </p>
            <p className="engraved-faint text-[12px] font-body max-w-[240px]">
              Create your ZeroID to request credentials and run proofs.
            </p>
          </div>
          <Link href="/identity" className="btn-primary btn-sm mt-1">
            Create ZeroID
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* The engraving line waiting for a DID */}
        <div className="mt-auto">
          <p className="engraved-faint text-[10px] font-mono tracking-[0.3em] uppercase">
            ····&nbsp;····&nbsp;····&nbsp;····
          </p>
        </div>
      </div>
    );
  }

  const status = statusConfig[verificationStatus] ?? statusConfig.unverified;
  const StatusIcon = status.icon;

  if (compact) {
    return (
      <motion.div
        className="titanium-card cursor-pointer p-4"
        whileHover={{ scale: 1.005 }}
        onClick={onViewDetails}
      >
        <div className="flex items-center gap-3 relative z-10">
          <div className="icon-chip icon-chip-sm">
            <Fingerprint className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="engraved text-[13px] font-mono truncate">
              {truncateDID(did)}
            </p>
            <span className={status.badge}>{status.label}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="titanium-card h-full"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative z-10 p-7 h-full flex flex-col">
        {/* Etched wordmark + hallmark */}
        <div className="flex items-start justify-between mb-9">
          <div className="flex items-center gap-3.5">
            <div className="icon-chip">
              <Fingerprint className="w-[19px] h-[19px]" />
            </div>
            <div>
              <h3 className="engraved text-[15px] font-display font-semibold tracking-[0.22em] uppercase leading-none">
                ZeroID
              </h3>
              <p className="engraved-faint text-[10px] font-mono tracking-[0.18em] uppercase mt-1.5">
                Self-Sovereign
              </p>
            </div>
          </div>

          <div className="hallmark" style={{ color: status.color }}>
            <StatusIcon className="w-3 h-3" />
            {status.label}
          </div>
        </div>

        {/* Engraved DID */}
        <div className="mb-9">
          <p className="engraved-faint text-[10px] font-body uppercase tracking-[0.18em] mb-2">
            Decentralized Identifier
          </p>
          <div className="flex items-center gap-2.5">
            <p className="engraved font-mono text-[15px] tracking-[0.06em] tnum">
              {truncateDID(did, 14)}
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

        {/* Etched figures — hairline-divided, no sub-cards */}
        <div
          className="grid grid-cols-3 mb-8"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {[
            { value: credentialCount, label: "Credentials" },
            { value: verificationCount, label: "Verifications" },
            {
              value: createdAt
                ? new Date(createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                : "--",
              label: "Created",
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="py-4 text-center"
              style={
                i > 0
                  ? { borderLeft: "1px solid rgba(255,255,255,0.06)" }
                  : undefined
              }
            >
              <p className="engraved text-[20px] font-display font-semibold leading-none mb-1.5 tnum">
                {stat.value}
              </p>
              <p className="engraved-faint text-[9px] font-body uppercase tracking-[0.16em]">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* Foot etch */}
        <div className="mt-auto flex items-center justify-between">
          <p className="engraved-faint text-[10px] font-mono tracking-[0.24em] uppercase">
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
