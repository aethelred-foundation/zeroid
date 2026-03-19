"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Shield,
  ShieldCheck,
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  Activity,
  Fingerprint,
  Lock,
  Unlock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Download,
  Calendar,
  Users,
  Globe,
  Layers,
  PieChart,
  LineChart,
  ArrowRight,
  ArrowUpRight,
  Zap,
  Info,
  FileText,
  Award,
  Heart,
  Target,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

// ============================================================
// Mock Data
// ============================================================

const verificationsOverTime = [
  { month: "Sep", count: 1240, zkProofs: 1180 },
  { month: "Oct", count: 1890, zkProofs: 1820 },
  { month: "Nov", count: 2340, zkProofs: 2290 },
  { month: "Dec", count: 2780, zkProofs: 2700 },
  { month: "Jan", count: 3420, zkProofs: 3380 },
  { month: "Feb", count: 4100, zkProofs: 4060 },
  { month: "Mar", count: 4680, zkProofs: 4650 },
];

const verificationsByType = [
  { type: "KYC Identity", count: 8423, percentage: 35 },
  { type: "Age Verification", count: 6231, percentage: 26 },
  { type: "Accredited Investor", count: 3847, percentage: 16 },
  { type: "AML Certificate", count: 2891, percentage: 12 },
  { type: "Residency Proof", count: 1643, percentage: 7 },
  { type: "Other", count: 965, percentage: 4 },
];

const verifierAnalytics = [
  {
    verifier: "Aethelred DeFi Protocol",
    requests: 4823,
    acceptance: 99.2,
    frequency: "~120/day",
    topCredential: "KYC Identity",
  },
  {
    verifier: "NoblePay Gateway",
    requests: 3241,
    acceptance: 98.7,
    frequency: "~80/day",
    topCredential: "AML Certificate",
  },
  {
    verifier: "Cruzible Exchange",
    requests: 2847,
    acceptance: 99.5,
    frequency: "~70/day",
    topCredential: "Accredited Investor",
  },
  {
    verifier: "External DApp #1",
    requests: 1923,
    acceptance: 97.8,
    frequency: "~50/day",
    topCredential: "Age Verification",
  },
  {
    verifier: "External DApp #2",
    requests: 1241,
    acceptance: 96.4,
    frequency: "~30/day",
    topCredential: "Residency Proof",
  },
];

const privacyBreakdown = {
  totalVerifications: 24000,
  zkProved: 23400,
  selectiveDisclosure: 450,
  fullDisclosure: 150,
  privacyScore: 96,
  dataPointsProtected: 127340,
  dataPointsExposed: 4820,
};

const identityHealthMetrics = [
  {
    metric: "Credential Freshness",
    score: 94,
    status: "excellent" as const,
    detail: "12 of 13 credentials within validity period",
  },
  {
    metric: "Coverage",
    score: 88,
    status: "good" as const,
    detail: "7 of 8 required credential types held",
  },
  {
    metric: "Diversification",
    score: 82,
    status: "good" as const,
    detail: "Credentials from 4 different issuers",
  },
  {
    metric: "Verification Readiness",
    score: 97,
    status: "excellent" as const,
    detail: "All credentials ready for instant verification",
  },
  {
    metric: "Cross-Chain Coverage",
    score: 75,
    status: "moderate" as const,
    detail: "Credentials bridged to 3 of 6 chains",
  },
];

const exposureTimeline = [
  {
    date: "Mar 14",
    event: "KYC Verification",
    disclosed: "Age range (over 18)",
    method: "ZK Proof",
    verifier: "Aethelred DeFi",
  },
  {
    date: "Mar 13",
    event: "Accredited Investor Check",
    disclosed: "Income tier (above threshold)",
    method: "ZK Proof",
    verifier: "Cruzible Exchange",
  },
  {
    date: "Mar 12",
    event: "Residency Verification",
    disclosed: "Jurisdiction (UAE)",
    method: "Selective Disclosure",
    verifier: "NoblePay Gateway",
  },
  {
    date: "Mar 10",
    event: "AML Screening Result",
    disclosed: "Clear status (no details)",
    method: "ZK Proof",
    verifier: "External DApp #1",
  },
  {
    date: "Mar 8",
    event: "Business Entity Verification",
    disclosed: "Registration number",
    method: "Full Disclosure",
    verifier: "Dubai Chamber",
  },
  {
    date: "Mar 5",
    event: "Credit Score Attestation",
    disclosed: "Score tier (Good)",
    method: "ZK Proof",
    verifier: "DeFi Lending Pool",
  },
];

const networkStats = {
  totalCredentials: 2847293,
  totalVerifications: 12847293,
  uniqueUsers: 342847,
  avgPrivacyScore: 89,
  zkProofPercentage: 96.4,
};

const recommendations = [
  {
    id: "r1",
    title: "Bridge credentials to Solana",
    impact: "Improve cross-chain coverage by 17%",
    priority: "medium" as const,
  },
  {
    id: "r2",
    title: "Renew AML certificate",
    impact: "Expires in 14 days, maintain freshness score",
    priority: "high" as const,
  },
  {
    id: "r3",
    title: "Add professional license credential",
    impact: "Increase coverage score by 12%",
    priority: "low" as const,
  },
  {
    id: "r4",
    title: "Enable batch ZK proof generation",
    impact: "Reduce verification latency by 40%",
    priority: "medium" as const,
  },
];

// ============================================================
// Helpers
// ============================================================

const healthColors: Record<string, { text: string; bg: string }> = {
  excellent: { text: "text-emerald-400", bg: "bg-emerald-500" },
  good: { text: "text-blue-400", bg: "bg-blue-500" },
  moderate: { text: "text-amber-400", bg: "bg-amber-500" },
  poor: { text: "text-red-400", bg: "bg-red-500" },
};

const priorityColors: Record<string, string> = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const methodColors: Record<string, string> = {
  "ZK Proof": "bg-emerald-500/10 text-emerald-400",
  "Selective Disclosure": "bg-amber-500/10 text-amber-400",
  "Full Disclosure": "bg-red-500/10 text-red-400",
};

// ============================================================
// Component
// ============================================================

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "1y">(
    "30d",
  );
  const [activeTab, setActiveTab] = useState<
    "usage" | "privacy" | "health" | "network"
  >("usage");

  const maxVerifications = Math.max(
    ...verificationsOverTime.map((v) => v.count),
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <BarChart3 className="w-7 h-7 text-identity-chrome" />
              Privacy-Preserving Analytics
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Monitor credential usage, privacy score, and identity health with
              full data sovereignty
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(["7d", "30d", "90d", "1y"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  timeRange === range
                    ? "bg-brand-600 text-white"
                    : "text-zero-500 hover:bg-zero-800"
                }`}
              >
                {range}
              </button>
            ))}
            <button className="btn-primary text-sm ml-2">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Privacy Score",
              value: `${privacyBreakdown.privacyScore}/100`,
              icon: Shield,
              color: "text-emerald-400",
              trend: "Excellent",
            },
            {
              label: "Total Verifications",
              value: "24,000",
              icon: CheckCircle2,
              color: "text-brand-400",
              trend: "+18% this month",
            },
            {
              label: "ZK Proof Rate",
              value: "97.5%",
              icon: EyeOff,
              color: "text-identity-chrome",
              trend: "vs 89% network avg",
            },
            {
              label: "Identity Health",
              value: "87/100",
              icon: Heart,
              color: "text-red-400",
              trend: "+3 this month",
            },
            {
              label: "Data Protected",
              value: "96.3%",
              icon: Lock,
              color: "text-identity-steel",
              trend: "127K data points",
            },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-zero-900 border border-zero-800 rounded-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`w-4 h-4 ${m.color}`} />
                <span className="text-xs text-zero-500">{m.label}</span>
              </div>
              <div className="text-xl font-bold">{m.value}</div>
              <div className="text-xs text-zero-500 mt-1">{m.trend}</div>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: "usage" as const, label: "Credential Usage", icon: Activity },
            { id: "privacy" as const, label: "Privacy Analysis", icon: EyeOff },
            { id: "health" as const, label: "Identity Health", icon: Heart },
            { id: "network" as const, label: "Network Analytics", icon: Globe },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-zero-900 border border-zero-800 text-zero-400 hover:text-white"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Credential Usage */}
          {activeTab === "usage" && (
            <motion.div
              key="usage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-12 gap-6">
                {/* Chart */}
                <div className="col-span-12 lg:col-span-8">
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4">
                      Verifications Over Time
                    </h2>
                    <div className="flex items-end gap-3 h-48">
                      {verificationsOverTime.map((v, i) => (
                        <div
                          key={v.month}
                          className="flex-1 flex flex-col items-center gap-1"
                        >
                          <span className="text-xs text-zero-400">
                            {(v.count / 1000).toFixed(1)}k
                          </span>
                          <div className="w-full relative">
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{
                                height: `${(v.count / maxVerifications) * 150}px`,
                              }}
                              transition={{ delay: i * 0.1, duration: 0.5 }}
                              className="w-full rounded-t-lg bg-gradient-to-t from-brand-600/30 to-brand-400/30 border border-brand-500/20"
                            />
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{
                                height: `${(v.zkProofs / maxVerifications) * 150}px`,
                              }}
                              transition={{
                                delay: i * 0.1 + 0.1,
                                duration: 0.5,
                              }}
                              className="absolute bottom-0 w-full rounded-t-lg bg-gradient-to-t from-identity-chrome/50 to-identity-chrome/30"
                            />
                          </div>
                          <span className="text-[10px] text-zero-500">
                            {v.month}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-xs text-zero-500">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-brand-500/30 border border-brand-500/20" />{" "}
                        Total
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded bg-identity-chrome/30" />{" "}
                        ZK Proofs
                      </span>
                    </div>
                  </div>
                </div>

                {/* By Type */}
                <div className="col-span-12 lg:col-span-4">
                  <div className="card p-6">
                    <h3 className="font-semibold text-sm mb-4">
                      By Credential Type
                    </h3>
                    <div className="space-y-3">
                      {verificationsByType.map((item) => (
                        <div key={item.type}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-zero-400">{item.type}</span>
                            <span className="font-medium">
                              {item.percentage}%
                            </span>
                          </div>
                          <div className="w-full bg-zero-800 rounded-full h-1.5">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${item.percentage}%` }}
                              transition={{ duration: 0.8 }}
                              className="h-1.5 rounded-full bg-gradient-to-r from-brand-500 to-identity-chrome"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Verifier Analytics */}
              <div className="card">
                <div className="p-4 border-b border-zero-800">
                  <h2 className="font-semibold">Verifier Analytics</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zero-800">
                        <th className="text-left py-3 px-4 text-zero-500 font-medium">
                          Verifier
                        </th>
                        <th className="text-right py-3 px-4 text-zero-500 font-medium">
                          Requests
                        </th>
                        <th className="text-right py-3 px-4 text-zero-500 font-medium">
                          Acceptance
                        </th>
                        <th className="text-right py-3 px-4 text-zero-500 font-medium">
                          Frequency
                        </th>
                        <th className="text-right py-3 px-4 text-zero-500 font-medium">
                          Top Credential
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {verifierAnalytics.map((v) => (
                        <tr
                          key={v.verifier}
                          className="border-b border-zero-800/50 hover:bg-zero-800/20"
                        >
                          <td className="py-3 px-4 text-zero-300">
                            {v.verifier}
                          </td>
                          <td className="py-3 px-4 text-right font-medium">
                            {v.requests.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right text-emerald-400">
                            {v.acceptance}%
                          </td>
                          <td className="py-3 px-4 text-right text-zero-400">
                            {v.frequency}
                          </td>
                          <td className="py-3 px-4 text-right text-zero-400">
                            {v.topCredential}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Privacy Analysis */}
          {activeTab === "privacy" && (
            <motion.div
              key="privacy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-12 gap-6">
                {/* Privacy Score */}
                <div className="col-span-12 lg:col-span-4">
                  <div className="card p-6 text-center">
                    <h3 className="text-sm text-zero-500 mb-4">
                      Privacy Score
                    </h3>
                    <div className="relative w-32 h-32 mx-auto">
                      <svg
                        className="w-32 h-32 -rotate-90"
                        viewBox="0 0 100 100"
                      >
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          fill="none"
                          stroke="rgba(51,65,85,0.3)"
                          strokeWidth="8"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 42}`}
                          strokeDashoffset={`${2 * Math.PI * 42 * (1 - privacyBreakdown.privacyScore / 100)}`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-emerald-400">
                          {privacyBreakdown.privacyScore}
                        </span>
                        <span className="text-[10px] text-zero-500">
                          out of 100
                        </span>
                      </div>
                    </div>
                    <div className="text-sm text-emerald-400 mt-2 font-medium">
                      Excellent
                    </div>
                    <div className="text-xs text-zero-500 mt-1">
                      Top 5% of network
                    </div>
                  </div>
                </div>

                {/* Privacy Breakdown */}
                <div className="col-span-12 lg:col-span-8">
                  <div className="card p-6">
                    <h3 className="font-semibold mb-4">Disclosure Breakdown</h3>
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center">
                        <EyeOff className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                        <div className="text-2xl font-bold text-emerald-400">
                          {(
                            (privacyBreakdown.zkProved /
                              privacyBreakdown.totalVerifications) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                        <div className="text-[10px] text-zero-500 mt-1">
                          ZK Proved
                        </div>
                      </div>
                      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
                        <Eye className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                        <div className="text-2xl font-bold text-amber-400">
                          {(
                            (privacyBreakdown.selectiveDisclosure /
                              privacyBreakdown.totalVerifications) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                        <div className="text-[10px] text-zero-500 mt-1">
                          Selective
                        </div>
                      </div>
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
                        <Unlock className="w-5 h-5 text-red-400 mx-auto mb-2" />
                        <div className="text-2xl font-bold text-red-400">
                          {(
                            (privacyBreakdown.fullDisclosure /
                              privacyBreakdown.totalVerifications) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                        <div className="text-[10px] text-zero-500 mt-1">
                          Full Disclosure
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-zero-800/50 rounded-xl text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="text-zero-400">
                          Data Points Protected
                        </span>
                        <span className="text-emerald-400 font-medium">
                          {privacyBreakdown.dataPointsProtected.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zero-400">
                          Data Points Exposed
                        </span>
                        <span className="text-red-400 font-medium">
                          {privacyBreakdown.dataPointsExposed.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Exposure Timeline */}
              <div className="card">
                <div className="p-4 border-b border-zero-800 flex items-center justify-between">
                  <h2 className="font-semibold">Data Exposure Timeline</h2>
                  <span className="text-xs text-zero-500">Last 30 days</span>
                </div>
                <div className="divide-y divide-zero-800/50">
                  {exposureTimeline.map((item, i) => (
                    <motion.div
                      key={`${item.date}-${item.event}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-4 flex items-center gap-4"
                    >
                      <div className="text-xs text-zero-500 w-16 shrink-0">
                        {item.date}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{item.event}</div>
                        <div className="text-xs text-zero-500 mt-0.5">
                          Disclosed: {item.disclosed}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${methodColors[item.method]}`}
                      >
                        {item.method}
                      </span>
                      <span className="text-xs text-zero-500">
                        {item.verifier}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div className="card p-5">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-brand-400" />
                  Privacy Recommendations
                </h3>
                <div className="space-y-2">
                  {recommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-zero-800/30 transition-colors"
                    >
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${priorityColors[rec.priority]}`}
                      >
                        {rec.priority}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{rec.title}</div>
                        <div className="text-xs text-zero-500 mt-0.5">
                          {rec.impact}
                        </div>
                      </div>
                      <button className="ml-auto shrink-0 text-xs text-brand-400 hover:text-brand-300">
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Identity Health */}
          {activeTab === "health" && (
            <motion.div
              key="health"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="card p-6">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-red-400" />
                  Identity Health Metrics
                </h2>
                <div className="space-y-4">
                  {identityHealthMetrics.map((metric, i) => {
                    const hc = healthColors[metric.status];
                    return (
                      <motion.div
                        key={metric.metric}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium">
                            {metric.metric}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${hc.text}`}>
                              {metric.score}%
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${hc.text} bg-opacity-10`}
                              style={{ backgroundColor: `${hc.bg}1a` }}
                            >
                              {metric.status}
                            </span>
                          </div>
                        </div>
                        <div className="w-full bg-zero-800 rounded-full h-2 mb-1">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${metric.score}%` }}
                            transition={{ duration: 0.8, delay: i * 0.1 }}
                            className={`h-2 rounded-full ${hc.bg}`}
                          />
                        </div>
                        <div className="text-[10px] text-zero-500">
                          {metric.detail}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Overall Score */}
              <div className="grid grid-cols-3 gap-4">
                <div className="card p-6 text-center">
                  <div className="text-3xl font-bold text-emerald-400">87</div>
                  <div className="text-xs text-zero-500 mt-1">
                    Overall Health
                  </div>
                </div>
                <div className="card p-6 text-center">
                  <div className="text-3xl font-bold text-brand-400">13</div>
                  <div className="text-xs text-zero-500 mt-1">
                    Active Credentials
                  </div>
                </div>
                <div className="card p-6 text-center">
                  <div className="text-3xl font-bold text-identity-chrome">
                    4
                  </div>
                  <div className="text-xs text-zero-500 mt-1">Issuers</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Network Analytics */}
          {activeTab === "network" && (
            <motion.div
              key="network"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    label: "Total Credentials",
                    value:
                      (networkStats.totalCredentials / 1000000).toFixed(1) +
                      "M",
                    icon: Fingerprint,
                  },
                  {
                    label: "Total Verifications",
                    value:
                      (networkStats.totalVerifications / 1000000).toFixed(1) +
                      "M",
                    icon: CheckCircle2,
                  },
                  {
                    label: "Unique Users",
                    value: (networkStats.uniqueUsers / 1000).toFixed(0) + "K",
                    icon: Users,
                  },
                  {
                    label: "Avg Privacy Score",
                    value: String(networkStats.avgPrivacyScore),
                    icon: Shield,
                  },
                  {
                    label: "ZK Proof Rate",
                    value: networkStats.zkProofPercentage + "%",
                    icon: EyeOff,
                  },
                  { label: "Network Growth", value: "+23%", icon: TrendingUp },
                ].map((stat) => (
                  <div key={stat.label} className="card p-5 text-center">
                    <stat.icon className="w-5 h-5 text-brand-400 mx-auto mb-2" />
                    <div className="text-2xl font-bold">{stat.value}</div>
                    <div className="text-xs text-zero-500 mt-1">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Benchmarks */}
              <div className="card p-6">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Award className="w-4 h-4 text-identity-amber" />
                  Anonymized Benchmarks (Your Score vs Network Average)
                </h2>
                <div className="space-y-4">
                  {[
                    { metric: "Privacy Score", yours: 96, network: 89 },
                    { metric: "Credential Coverage", yours: 88, network: 72 },
                    { metric: "ZK Proof Usage", yours: 97, network: 84 },
                    { metric: "Verification Speed", yours: 92, network: 78 },
                    { metric: "Cross-Chain Presence", yours: 75, network: 45 },
                  ].map((benchmark) => (
                    <div key={benchmark.metric}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="text-zero-300">
                          {benchmark.metric}
                        </span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-brand-400">
                            You: {benchmark.yours}%
                          </span>
                          <span className="text-zero-500">
                            Avg: {benchmark.network}%
                          </span>
                        </div>
                      </div>
                      <div className="relative w-full bg-zero-800 rounded-full h-2">
                        <div
                          className="absolute h-2 rounded-full bg-zero-600/50"
                          style={{ width: `${benchmark.network}%` }}
                        />
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${benchmark.yours}%` }}
                          transition={{ duration: 0.8 }}
                          className="absolute h-2 rounded-full bg-gradient-to-r from-brand-500 to-identity-chrome"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
