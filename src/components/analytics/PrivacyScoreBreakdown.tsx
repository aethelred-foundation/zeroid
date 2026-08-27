"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Fingerprint,
  Lightbulb,
  Loader2,
  Lock,
  Shield,
  Users,
} from "lucide-react";

interface CategoryScore {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  description: string;
  icon: "disclosure" | "zk" | "verifier" | "freshness";
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  category: string;
}

interface HistoryPoint {
  date: string;
  score: number;
}

interface DataExposure {
  attribute: string;
  disclosed: boolean;
  zkProved: boolean;
  disclosureCount: number;
}

interface PrivacyScoreBreakdownProps {
  overallScore?: number | null;
  calculationBasis?: string;
  categories?: CategoryScore[];
  recommendations?: Recommendation[];
  history?: HistoryPoint[];
  exposures?: DataExposure[];
  loading?: boolean;
  error?: string | null;
  className?: string;
}

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  disclosure: EyeOff,
  zk: Lock,
  verifier: Users,
  freshness: Clock,
};

const IMPACT_CONFIG: Record<
  Recommendation["impact"],
  { label: string; color: string; bg: string }
> = {
  high: {
    label: "High priority",
    color: "text-red-300",
    bg: "bg-red-500/10",
  },
  medium: {
    label: "Medium priority",
    color: "text-amber-300",
    bg: "bg-amber-500/10",
  },
  low: {
    label: "Low priority",
    color: "text-blue-300",
    bg: "bg-blue-500/10",
  },
};

function ScoreGauge({ score, size }: { score: number; size: number }) {
  const boundedScore = Math.min(100, Math.max(0, score));
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (boundedScore / 100) * circumference;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          className="text-[var(--surface-tertiary)]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          className="text-brand-400"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-3xl font-bold text-brand-300">{boundedScore}</p>
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Tenant score
        </p>
      </div>
    </div>
  );
}

function CategoryBar({ category }: { category: CategoryScore }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Shield;
  const percentage =
    category.maxScore > 0
      ? Math.min(100, Math.max(0, (category.score / category.maxScore) * 100))
      : 0;

  return (
    <div className="rounded-xl bg-[var(--surface-secondary)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
        <span className="flex-1 text-xs font-medium text-[var(--text-primary)]">
          {category.name}
        </span>
        <span className="text-xs font-bold text-[var(--text-primary)]">
          {category.score}/{category.maxScore}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--surface-tertiary)]">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
        {category.description}
      </p>
    </div>
  );
}

function HistoryChart({ data }: { data: HistoryPoint[] }) {
  const height = 80;
  const points = data
    .map((point, index) => {
      const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
      const boundedScore = Math.min(100, Math.max(0, point.score));
      const y = height - (boundedScore / 100) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-xl bg-[var(--surface-secondary)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-medium text-[var(--text-primary)]">
          Tenant Score History
        </h4>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          No network comparison
        </span>
      </div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <polyline
          points={points}
          fill="none"
          stroke="rgb(14,165,233)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function PrivacyScoreBreakdown({
  overallScore = null,
  calculationBasis,
  categories = [],
  recommendations = [],
  history = [],
  exposures = [],
  loading = false,
  error = null,
  className = "",
}: PrivacyScoreBreakdownProps) {
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const displayedRecommendations = showAllRecommendations
    ? recommendations
    : recommendations.slice(0, 2);

  const exposureStats = useMemo(() => {
    const disclosed = exposures.filter((entry) => entry.disclosed).length;
    const zkProved = exposures.filter((entry) => entry.zkProved).length;
    const privateCount = exposures.filter(
      (entry) => !entry.disclosed && !entry.zkProved,
    ).length;
    return { disclosed, zkProved, privateCount };
  }, [exposures]);
  const exposureSummary = [
    { label: "Disclosed", value: exposureStats.disclosed, Icon: Eye },
    { label: "ZK proved", value: exposureStats.zkProved, Icon: Lock },
    { label: "Private", value: exposureStats.privateCount, Icon: EyeOff },
  ];

  if (loading) {
    return (
      <div
        className={`card flex items-center justify-center gap-2 p-8 ${className}`}
      >
        <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Calculating tenant privacy score...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card border-red-500/30 p-6 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] ${className}`}
    >
      <div className="border-b border-[var(--border-primary)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Tenant Privacy Score
          </h3>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {overallScore === null ? (
          <div className="rounded-xl bg-[var(--surface-secondary)] p-4 text-sm text-[var(--text-secondary)]">
            Score unavailable. Supply calculated tenant records before rendering
            a score; no fallback or comparative value is used.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 md:flex-row">
            <ScoreGauge score={overallScore} size={150} />
            <p className="flex-1 rounded-xl bg-[var(--surface-secondary)] p-4 text-sm text-[var(--text-secondary)]">
              {calculationBasis ??
                "Calculated from supplied tenant data. No network comparison is included."}
            </p>
          </div>
        )}

        {exposures.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {exposureSummary.map(({ label, value, Icon }) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-3 text-center"
              >
                <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-brand-400" />
                <p className="text-sm font-bold">{value}</p>
                <p className="text-[9px] text-[var(--text-tertiary)]">
                  {label}
                </p>
              </div>
            ))}
          </div>
        )}

        <div>
          <h4 className="mb-3 text-xs font-medium text-[var(--text-primary)]">
            Category Breakdown
          </h4>
          {categories.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {categories.map((category) => (
                <CategoryBar key={category.id} category={category} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">
              No calculated category data supplied.
            </p>
          )}
        </div>

        {history.length > 0 && <HistoryChart data={history} />}

        <div>
          <h4 className="mb-3 text-xs font-medium text-[var(--text-primary)]">
            Data Exposure Summary
          </h4>
          {exposures.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-[var(--border-primary)]">
              {exposures.map((exposure) => (
                <div
                  key={exposure.attribute}
                  className="grid grid-cols-3 items-center gap-2 border-t border-[var(--border-primary)] px-4 py-2.5 first:border-0"
                >
                  <span className="text-xs text-[var(--text-primary)]">
                    {exposure.attribute}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {exposure.disclosed
                      ? "Direct"
                      : exposure.zkProved
                        ? "Zero-knowledge"
                        : "Not shared"}
                  </span>
                  <span className="text-right text-[10px] text-[var(--text-tertiary)]">
                    {exposure.disclosureCount} disclosure(s)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">
              No exposure records supplied.
            </p>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-medium text-[var(--text-primary)]">
              Rule-Based Recommendations
            </h4>
          </div>
          {recommendations.length > 0 ? (
            <div className="space-y-2">
              {displayedRecommendations.map((recommendation) => {
                const impact = IMPACT_CONFIG[recommendation.impact];
                return (
                  <div
                    key={recommendation.id}
                    className="rounded-xl bg-[var(--surface-secondary)] p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        {recommendation.title}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] ${impact.bg} ${impact.color}`}
                      >
                        {impact.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {recommendation.description}
                    </p>
                  </div>
                );
              })}
              {recommendations.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowAllRecommendations((value) => !value)}
                  className="flex w-full items-center justify-center gap-1 py-2 text-xs text-brand-400"
                >
                  {showAllRecommendations
                    ? "Show less"
                    : `Show ${recommendations.length - 2} more`}
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${
                      showAllRecommendations ? "rotate-90" : ""
                    }`}
                  />
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">
              No recommendations supplied. This is not evidence of compliance.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
