"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Star,
  Award,
  Clock,
  Globe,
  Building2,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type Specialization =
  | "KYC"
  | "Residency"
  | "Credit"
  | "Employment"
  | "Education"
  | "Accreditation"
  | "AML"
  | "Age";

interface IssuerInfo {
  id: string;
  name: string;
  verified: boolean;
  trustScore: number;
  credentialsIssued: number;
  verificationsCompleted: number;
  specializations: Specialization[];
  jurisdictions: string[];
  avgIssuanceTime: string;
  description?: string;
  website?: string;
}

interface IssuerCardProps {
  issuer: IssuerInfo;
  onConnect?: (issuerId: string) => void;
  onRequest?: (issuerId: string) => void;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SPECIALIZATION_COLORS: Record<Specialization, string> = {
  KYC: "text-cyan-400 bg-cyan-500/10",
  Residency: "text-violet-400 bg-violet-500/10",
  Credit: "text-emerald-400 bg-emerald-500/10",
  Employment: "text-blue-400 bg-blue-500/10",
  Education: "text-amber-400 bg-amber-500/10",
  Accreditation: "text-rose-400 bg-rose-500/10",
  AML: "text-red-400 bg-red-500/10",
  Age: "text-orange-400 bg-orange-500/10",
};

// ============================================================================
// Sub-components
// ============================================================================

function StarRating({
  score,
  maxScore = 5,
}: {
  score: number;
  maxScore?: number;
}) {
  const fullStars = Math.floor(score);
  const hasHalf = score - fullStars >= 0.5;
  const emptyStars = maxScore - fullStars - (hasHalf ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: fullStars }, (_, i) => (
        <Star
          key={`full-${i}`}
          className="w-3.5 h-3.5 text-amber-400 fill-amber-400"
        />
      ))}
      {hasHalf && (
        <div className="relative w-3.5 h-3.5">
          <Star className="absolute inset-0 w-3.5 h-3.5 text-[var(--surface-tertiary)]" />
          <div className="absolute inset-0 w-[50%] overflow-hidden">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          </div>
        </div>
      )}
      {Array.from({ length: emptyStars }, (_, i) => (
        <Star
          key={`empty-${i}`}
          className="w-3.5 h-3.5 text-[var(--surface-tertiary)]"
        />
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function IssuerCard({
  issuer,
  onConnect,
  onRequest,
  loading = false,
  compact = false,
  className = "",
}: IssuerCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  if (loading) {
    return (
      <div className={`card p-6 animate-pulse ${className}`}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[var(--surface-tertiary)]" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-[var(--surface-tertiary)] rounded w-3/4" />
            <div className="h-3 bg-[var(--surface-tertiary)] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  const trustScoreNormalized = Math.min((issuer.trustScore / 100) * 5, 5);

  if (compact) {
    return (
      <motion.div
        className={`card-interactive p-4 ${className}`}
        whileHover={{ scale: 1.01 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/20 border border-brand-500/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-brand-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {issuer.name}
              </p>
              {issuer.verified && (
                <ShieldCheck className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <StarRating score={trustScoreNormalized} />
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {issuer.trustScore}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="p-5">
        {/* Top section */}
        <div className="flex items-start gap-4 mb-4">
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500/20 to-brand-600/20 border border-brand-500/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-7 h-7 text-brand-500" />
            {issuer.verified && (
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center border-2 border-[var(--surface-primary)]">
                <CheckCircle2 className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {issuer.name}
              </h3>
              {issuer.verified && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-500/10 text-brand-500">
                  Verified Issuer
                </span>
              )}
            </div>
            {/* Trust score */}
            <div className="flex items-center gap-2 mt-1.5">
              <StarRating score={trustScoreNormalized} />
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {issuer.trustScore}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                / 100
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        {issuer.description && (
          <p className="text-xs text-[var(--text-secondary)] mb-4 line-clamp-2">
            {issuer.description}
          </p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-2.5 rounded-xl bg-[var(--surface-secondary)] text-center">
            <Award className="w-3.5 h-3.5 text-[var(--text-tertiary)] mx-auto mb-1" />
            <p className="text-sm font-bold text-[var(--text-primary)]">
              {issuer.credentialsIssued >= 1000
                ? `${(issuer.credentialsIssued / 1000).toFixed(1)}K`
                : issuer.credentialsIssued}
            </p>
            <p className="text-[8px] text-[var(--text-tertiary)]">Issued</p>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--surface-secondary)] text-center">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-tertiary)] mx-auto mb-1" />
            <p className="text-sm font-bold text-[var(--text-primary)]">
              {issuer.verificationsCompleted >= 1000
                ? `${(issuer.verificationsCompleted / 1000).toFixed(1)}K`
                : issuer.verificationsCompleted}
            </p>
            <p className="text-[8px] text-[var(--text-tertiary)]">Verified</p>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--surface-secondary)] text-center">
            <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)] mx-auto mb-1" />
            <p className="text-sm font-bold text-[var(--text-primary)]">
              {issuer.avgIssuanceTime}
            </p>
            <p className="text-[8px] text-[var(--text-tertiary)]">Avg Time</p>
          </div>
        </div>

        {/* Specializations */}
        <div className="mb-4">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
            Specializations
          </p>
          <div className="flex flex-wrap gap-1.5">
            {issuer.specializations.map((spec) => (
              <span
                key={spec}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${SPECIALIZATION_COLORS[spec]}`}
              >
                {spec}
              </span>
            ))}
          </div>
        </div>

        {/* Jurisdictions */}
        <div className="mb-4">
          <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
            Jurisdictions
          </p>
          <div className="flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-[var(--text-tertiary)]" />
            <span className="text-xs text-[var(--text-secondary)]">
              {issuer.jurisdictions.join(", ")}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-5 py-4 border-t border-[var(--border-primary)]">
        {onConnect && (
          <button
            onClick={() => onConnect(issuer.id)}
            className="flex-1 btn-primary btn-sm"
          >
            Connect
          </button>
        )}
        {onRequest && (
          <button
            onClick={() => onRequest(issuer.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            Request Credential
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
