"use client";

import React from "react";
import {
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldOff,
  Loader2,
} from "lucide-react";

// ============================================================
// Status Badge Component
// ============================================================

export type CredentialStatus =
  | "verified"
  | "pending"
  | "revoked"
  | "expired"
  | "active"
  | "suspended"
  | "issuing";

interface StatusConfig {
  label: string;
  icon: React.ReactNode;
  className: string;
  dotColor: string;
}

const STATUS_CONFIG: Record<CredentialStatus, StatusConfig> = {
  verified: {
    label: "Verified",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotColor: "bg-emerald-400",
  },
  active: {
    label: "Active",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    className: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    dotColor: "bg-cyan-400",
  },
  pending: {
    label: "Pending",
    icon: <Clock className="w-3.5 h-3.5" />,
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotColor: "bg-amber-400",
  },
  issuing: {
    label: "Issuing",
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotColor: "bg-blue-400",
  },
  revoked: {
    label: "Revoked",
    icon: <XCircle className="w-3.5 h-3.5" />,
    className: "bg-red-500/10 text-red-400 border-red-500/20",
    dotColor: "bg-red-400",
  },
  expired: {
    label: "Expired",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    className: "bg-zero-500/10 text-zero-400 border-zero-500/20",
    dotColor: "bg-zero-400",
  },
  suspended: {
    label: "Suspended",
    icon: <ShieldOff className="w-3.5 h-3.5" />,
    className: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dotColor: "bg-orange-400",
  },
};

// ============================================================
// Badge Sizes
// ============================================================

type BadgeSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[10px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
  lg: "px-3 py-1.5 text-sm gap-2",
};

// ============================================================
// StatusBadge Props
// ============================================================

interface StatusBadgeProps {
  status: CredentialStatus;
  size?: BadgeSize;
  showIcon?: boolean;
  showDot?: boolean;
  label?: string;
  className?: string;
}

export function StatusBadge({
  status,
  size = "md",
  showIcon = true,
  showDot = false,
  label,
  className = "",
}: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const sizeClass = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${config.className} ${sizeClass} ${className}`}
    >
      {showDot && (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${config.dotColor} opacity-75 ${
              status === "pending" || status === "issuing" ? "animate-ping" : ""
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-1.5 w-1.5 ${config.dotColor}`}
          />
        </span>
      )}
      {showIcon && config.icon}
      {label || config.label}
    </span>
  );
}

// ============================================================
// VerificationBadge — Specialized badge for identity verification
// ============================================================

interface VerificationBadgeProps {
  verified: boolean;
  level?: number;
  className?: string;
}

export function VerificationBadge({
  verified,
  level,
  className = "",
}: VerificationBadgeProps) {
  if (verified) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ${className}`}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        Verified
        {level !== undefined && (
          <span className="text-emerald-500/60">L{level}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zero-500/10 text-zero-400 border border-zero-500/20 ${className}`}
    >
      <ShieldOff className="w-3.5 h-3.5" />
      Unverified
    </span>
  );
}
