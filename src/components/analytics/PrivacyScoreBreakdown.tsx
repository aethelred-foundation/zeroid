"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Fingerprint,
  Lock,
  Users,
  Clock,
  AlertTriangle,
  Loader2,
  ChevronRight,
  Lightbulb,
  BarChart3,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

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
  overallScore?: number;
  categories?: CategoryScore[];
  recommendations?: Recommendation[];
  history?: HistoryPoint[];
  networkAverage?: number;
  exposures?: DataExposure[];
  loading?: boolean;
  error?: string | null;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  disclosure: EyeOff,
  zk: Lock,
  verifier: Users,
  freshness: Clock,
};

const IMPACT_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  high: {
    label: "High Impact",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  medium: {
    label: "Medium Impact",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  low: { label: "Low Impact", color: "text-zero-400", bg: "bg-zero-500/10" },
};

const DEFAULT_CATEGORIES: CategoryScore[] = [
  {
    id: "disclosure",
    name: "Data Disclosure",
    score: 82,
    maxScore: 100,
    description:
      "Measures how much personal data is directly shared vs. kept private",
    icon: "disclosure",
  },
  {
    id: "zk",
    name: "ZK Usage",
    score: 91,
    maxScore: 100,
    description: "Proportion of verifications using zero-knowledge proofs",
    icon: "zk",
  },
  {
    id: "verifier",
    name: "Verifier Diversity",
    score: 68,
    maxScore: 100,
    description: "Variety of verifiers reducing correlation risk",
    icon: "verifier",
  },
  {
    id: "freshness",
    name: "Credential Freshness",
    score: 75,
    maxScore: 100,
    description:
      "How current your credentials are relative to their validity periods",
    icon: "freshness",
  },
];

const DEFAULT_RECOMMENDATIONS: Recommendation[] = [
  {
    id: "r1",
    title: "Enable ZK proofs for age verification",
    description:
      "Your age attribute is being disclosed directly. Switch to a ZK range proof to prove age >= 18 without revealing your date of birth.",
    impact: "high",
    category: "ZK Usage",
  },
  {
    id: "r2",
    title: "Diversify verifier interactions",
    description:
      "You have used only 2 unique verifiers in the past 30 days. Interacting with more verifiers reduces correlation risk.",
    impact: "medium",
    category: "Verifier Diversity",
  },
  {
    id: "r3",
    title: "Refresh your KYC credential",
    description:
      "Your KYC credential was issued 8 months ago. Refreshing it improves your freshness score and strengthens trust.",
    impact: "medium",
    category: "Credential Freshness",
  },
  {
    id: "r4",
    title: "Use selective disclosure for employment",
    description:
      "Your employment credential is being fully disclosed. Use selective disclosure to share only the attributes needed.",
    impact: "high",
    category: "Data Disclosure",
  },
];

const DEFAULT_HISTORY: HistoryPoint[] = Array.from({ length: 12 }, (_, i) => ({
  date: new Date(2026, i - 11, 1).toISOString().slice(0, 7),
  score: 65 + Math.floor(Math.random() * 15) + i * 1.5,
}));

const DEFAULT_EXPOSURES: DataExposure[] = [
  {
    attribute: "Full Name",
    disclosed: true,
    zkProved: false,
    disclosureCount: 12,
  },
  {
    attribute: "Date of Birth",
    disclosed: false,
    zkProved: true,
    disclosureCount: 0,
  },
  {
    attribute: "Nationality",
    disclosed: true,
    zkProved: false,
    disclosureCount: 5,
  },
  {
    attribute: "Age >= 18",
    disclosed: false,
    zkProved: true,
    disclosureCount: 0,
  },
  {
    attribute: "Address",
    disclosed: false,
    zkProved: false,
    disclosureCount: 0,
  },
  {
    attribute: "Employment Status",
    disclosed: true,
    zkProved: false,
    disclosureCount: 3,
  },
  {
    attribute: "Credit Score Range",
    disclosed: false,
    zkProved: true,
    disclosureCount: 0,
  },
  {
    attribute: "Accreditation Status",
    disclosed: true,
    zkProved: false,
    disclosureCount: 8,
  },
];

// ============================================================================
// Sub-components
// ============================================================================

function ScoreGauge({ score, size }: { score: number; size: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color =
    score >= 80
      ? "text-emerald-400"
      : score >= 60
        ? "text-amber-400"
        : "text-red-400";
  const label =
    score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Improvement";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
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
          className={color}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={`text-3xl font-bold ${color}`}>{score}</p>
        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
          {label}
        </p>
      </div>
    </div>
  );
}

function CategoryBar({ category }: { category: CategoryScore }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Shield;
  const percentage = (category.score / category.maxScore) * 100;
  const color =
    percentage >= 80
      ? "bg-emerald-500"
      : percentage >= 60
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <motion.div
      className="p-3 rounded-xl bg-[var(--surface-secondary)]"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-[var(--text-tertiary)]" />
        <span className="text-xs font-medium text-[var(--text-primary)] flex-1">
          {category.name}
        </span>
        <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
          {category.score}
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-[var(--surface-tertiary)]">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
        {category.description}
      </p>
    </motion.div>
  );
}

function HistoryChart({
  data,
  networkAvg,
}: {
  data: HistoryPoint[];
  networkAvg: number;
}) {
  const max = 100;
  const min = 0;
  const h = 80;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = h - ((d.score - min) / (max - min)) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  const avgY = h - ((networkAvg - min) / (max - min)) * (h - 8) - 4;

  return (
    <div className="p-4 rounded-xl bg-[var(--surface-secondary)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-[var(--text-primary)]">
          Score History (12mo)
        </h4>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-0.5 bg-brand-500 rounded" /> You
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-0.5 bg-zero-500 rounded"
              style={{ borderTop: "1px dashed" }}
            />{" "}
            Network Avg
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 100 ${h}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: h }}
      >
        {/* Network average line */}
        <line
          x1="0"
          y1={avgY}
          x2="100"
          y2={avgY}
          stroke="rgb(100,116,139)"
          strokeWidth="1"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
        {/* User score line */}
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
      <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--text-tertiary)]">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function PrivacyScoreBreakdown({
  overallScore = 79,
  categories = DEFAULT_CATEGORIES,
  recommendations = DEFAULT_RECOMMENDATIONS,
  history = DEFAULT_HISTORY,
  networkAverage = 72,
  exposures = DEFAULT_EXPOSURES,
  loading = false,
  error = null,
  className = "",
}: PrivacyScoreBreakdownProps) {
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);

  const displayedRecommendations = showAllRecommendations
    ? recommendations
    : recommendations.slice(0, 2);

  const exposureStats = useMemo(() => {
    const disclosed = exposures.filter((e) => e.disclosed).length;
    const zkProved = exposures.filter((e) => e.zkProved).length;
    const private_ = exposures.filter(
      (e) => !e.disclosed && !e.zkProved,
    ).length;
    return { disclosed, zkProved, private: private_, total: exposures.length };
  }, [exposures]);

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Calculating privacy score...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Privacy Score
          </h3>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Overall score + comparison */}
        <div className="flex flex-col md:flex-row items-center gap-6">
          <ScoreGauge score={overallScore} size={160} />
          <div className="flex-1 space-y-3">
            <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  Network Average
                </span>
                <span className="text-xs font-mono font-medium text-[var(--text-primary)]">
                  {networkAverage}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {overallScore > networkAverage ? (
                  <>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs text-emerald-400">
                      {overallScore - networkAverage} points above average
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-amber-400">
                      {networkAverage - overallScore} points below average
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Exposure summary */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/10 text-center">
                <Eye className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {exposureStats.disclosed}
                </p>
                <p className="text-[8px] text-[var(--text-tertiary)]">
                  Disclosed
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                <Lock className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {exposureStats.zkProved}
                </p>
                <p className="text-[8px] text-[var(--text-tertiary)]">
                  ZK Proved
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
                <EyeOff className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {exposureStats.private}
                </p>
                <p className="text-[8px] text-[var(--text-tertiary)]">
                  Private
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Category scores */}
        <div>
          <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">
            Category Breakdown
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {categories.map((cat) => (
              <CategoryBar key={cat.id} category={cat} />
            ))}
          </div>
        </div>

        {/* History */}
        <HistoryChart data={history} networkAvg={networkAverage} />

        {/* Data exposure detail */}
        <div>
          <h4 className="text-xs font-medium text-[var(--text-primary)] mb-3">
            Data Exposure Summary
          </h4>
          <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-[var(--surface-secondary)] text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              <span>Attribute</span>
              <span>Status</span>
              <span>Method</span>
              <span>Disclosures</span>
            </div>
            {exposures.map((exp) => (
              <div
                key={exp.attribute}
                className="grid grid-cols-4 gap-2 px-4 py-2.5 border-t border-[var(--border-primary)] items-center"
              >
                <span className="text-xs text-[var(--text-primary)]">
                  {exp.attribute}
                </span>
                <span
                  className={`text-[10px] font-medium ${exp.disclosed ? "text-red-400" : exp.zkProved ? "text-emerald-400" : "text-blue-400"}`}
                >
                  {exp.disclosed
                    ? "Exposed"
                    : exp.zkProved
                      ? "ZK Protected"
                      : "Private"}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {exp.disclosed
                    ? "Direct"
                    : exp.zkProved
                      ? "Zero-Knowledge"
                      : "Not shared"}
                </span>
                <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                  {exp.disclosureCount}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-medium text-[var(--text-primary)]">
              Recommendations
            </h4>
          </div>
          <div className="space-y-2">
            {displayedRecommendations.map((rec) => {
              const impact = IMPACT_CONFIG[rec.impact];
              return (
                <div
                  key={rec.id}
                  className="p-3 rounded-xl bg-[var(--surface-secondary)]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {rec.title}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${impact.bg} ${impact.color}`}
                    >
                      {impact.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {rec.description}
                  </p>
                  <span className="text-[10px] text-[var(--text-tertiary)] mt-1 inline-block">
                    {rec.category}
                  </span>
                </div>
              );
            })}
          </div>
          {recommendations.length > 2 && (
            <button
              onClick={() => setShowAllRecommendations(!showAllRecommendations)}
              className="flex items-center gap-1 mt-2 text-xs text-brand-500 hover:text-brand-400 transition-colors"
            >
              {showAllRecommendations
                ? "Show less"
                : `Show ${recommendations.length - 2} more`}
              <ChevronRight
                className={`w-3 h-3 transition-transform ${showAllRecommendations ? "rotate-90" : ""}`}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
