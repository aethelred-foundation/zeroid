"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  MapPin,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  ArrowRight,
  ArrowLeftRight,
  FileText,
  TrendingUp,
  BookOpen,
  Scale,
  Building2,
  Lock,
  Database,
  Newspaper,
  BarChart3,
  Layers,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

// ============================================================
// Mock Data
// ============================================================

const jurisdictions = [
  {
    id: "us",
    name: "United States",
    region: "North America",
    score: 94,
    status: "compliant" as const,
    framework: "SEC / FinCEN",
    credentials: 8,
    gaps: 0,
    dataResidency: "US-East",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["CA", "UK", "EU"],
  },
  {
    id: "eu",
    name: "European Union",
    region: "Europe",
    score: 91,
    status: "compliant" as const,
    framework: "MiCA / eIDAS 2.0",
    credentials: 10,
    gaps: 1,
    dataResidency: "EU-Frankfurt",
    gdpr: true,
    eidas: true,
    mutualRecognition: ["US", "UK", "CH", "SG"],
  },
  {
    id: "uae",
    name: "United Arab Emirates",
    region: "Middle East",
    score: 97,
    status: "compliant" as const,
    framework: "VARA / CBUAE",
    credentials: 9,
    gaps: 0,
    dataResidency: "UAE-Dubai",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["SG", "HK", "SA"],
  },
  {
    id: "uk",
    name: "United Kingdom",
    region: "Europe",
    score: 89,
    status: "compliant" as const,
    framework: "FCA / UK DIATF",
    credentials: 7,
    gaps: 2,
    dataResidency: "UK-London",
    gdpr: true,
    eidas: false,
    mutualRecognition: ["US", "EU", "AU", "CA"],
  },
  {
    id: "sg",
    name: "Singapore",
    region: "Asia-Pacific",
    score: 92,
    status: "compliant" as const,
    framework: "MAS / PDPA",
    credentials: 8,
    gaps: 1,
    dataResidency: "SG-Central",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["UAE", "HK", "JP", "AU"],
  },
  {
    id: "jp",
    name: "Japan",
    region: "Asia-Pacific",
    score: 86,
    status: "warning" as const,
    framework: "JFSA / APPI",
    credentials: 6,
    gaps: 3,
    dataResidency: "JP-Tokyo",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["SG", "KR", "AU"],
  },
  {
    id: "hk",
    name: "Hong Kong",
    region: "Asia-Pacific",
    score: 78,
    status: "at-risk" as const,
    framework: "SFC / HKMA",
    credentials: 5,
    gaps: 4,
    dataResidency: "HK-Central",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["SG", "UAE"],
  },
  {
    id: "ch",
    name: "Switzerland",
    region: "Europe",
    score: 95,
    status: "compliant" as const,
    framework: "FINMA / nDSG",
    credentials: 9,
    gaps: 0,
    dataResidency: "CH-Zurich",
    gdpr: true,
    eidas: true,
    mutualRecognition: ["EU", "US", "SG"],
  },
  {
    id: "au",
    name: "Australia",
    region: "Oceania",
    score: 88,
    status: "warning" as const,
    framework: "ASIC / Privacy Act",
    credentials: 7,
    gaps: 2,
    dataResidency: "AU-Sydney",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["UK", "SG", "NZ"],
  },
  {
    id: "ca",
    name: "Canada",
    region: "North America",
    score: 85,
    status: "warning" as const,
    framework: "CSA / PIPEDA",
    credentials: 6,
    gaps: 3,
    dataResidency: "CA-Toronto",
    gdpr: false,
    eidas: false,
    mutualRecognition: ["US", "UK"],
  },
  {
    id: "br",
    name: "Brazil",
    region: "South America",
    score: 72,
    status: "at-risk" as const,
    framework: "CVM / LGPD",
    credentials: 4,
    gaps: 5,
    dataResidency: "BR-Sao Paulo",
    gdpr: false,
    eidas: false,
    mutualRecognition: [],
  },
  {
    id: "in",
    name: "India",
    region: "Asia",
    score: 68,
    status: "at-risk" as const,
    framework: "SEBI / DPDP",
    credentials: 3,
    gaps: 6,
    dataResidency: "IN-Mumbai",
    gdpr: false,
    eidas: false,
    mutualRecognition: [],
  },
];

const regulatoryFeed = [
  {
    id: "f1",
    title: "MiCA enters full enforcement",
    jurisdiction: "EU",
    date: "Mar 31, 2026",
    impact: "high" as const,
    description:
      "All crypto-asset service providers must be fully licensed under MiCA. Identity verification requirements tightened.",
  },
  {
    id: "f2",
    title: "VARA updates digital asset framework",
    jurisdiction: "UAE",
    date: "Mar 20, 2026",
    impact: "medium" as const,
    description:
      "New provisions for AI agent identity and autonomous transaction limits. ZeroID compliance verified.",
  },
  {
    id: "f3",
    title: "Travel Rule threshold lowered to $250",
    jurisdiction: "US",
    date: "Apr 1, 2026",
    impact: "high" as const,
    description:
      "FinCEN finalizes reduced threshold for travel rule compliance. Significant impact on transaction screening.",
  },
  {
    id: "f4",
    title: "eIDAS 2.0 wallet specifications published",
    jurisdiction: "EU",
    date: "Apr 15, 2026",
    impact: "medium" as const,
    description:
      "Technical specifications for EU Digital Identity Wallet interoperability. ZeroID mapping required.",
  },
  {
    id: "f5",
    title: "Japan JFSA crypto custody guidelines",
    jurisdiction: "JP",
    date: "May 1, 2026",
    impact: "low" as const,
    description:
      "Updated custody requirements for digital asset service providers. Minor credential adjustments needed.",
  },
];

const credentialGaps = [
  {
    jurisdiction: "Hong Kong",
    credential: "SFC Type 7 License Attestation",
    priority: "critical" as const,
    estimatedTime: "4-6 weeks",
  },
  {
    jurisdiction: "Hong Kong",
    credential: "HKMA Stored Value Facility License",
    priority: "high" as const,
    estimatedTime: "8-12 weeks",
  },
  {
    jurisdiction: "Japan",
    credential: "JFSA Crypto Exchange Registration",
    priority: "high" as const,
    estimatedTime: "6-8 weeks",
  },
  {
    jurisdiction: "UK",
    credential: "FCA E-Money Institution Authorization",
    priority: "medium" as const,
    estimatedTime: "12-16 weeks",
  },
  {
    jurisdiction: "Canada",
    credential: "MSB Registration (FINTRAC)",
    priority: "medium" as const,
    estimatedTime: "4-6 weeks",
  },
  {
    jurisdiction: "Brazil",
    credential: "BCB Virtual Asset Provider License",
    priority: "high" as const,
    estimatedTime: "16-24 weeks",
  },
  {
    jurisdiction: "India",
    credential: "SEBI Registered Investment Adviser",
    priority: "low" as const,
    estimatedTime: "8-12 weeks",
  },
];

const crossBorderRoutes = [
  {
    from: "UAE",
    to: "Singapore",
    status: "compliant" as const,
    requirements: "Bilateral MOU active. Standard KYC sufficient.",
  },
  {
    from: "US",
    to: "EU",
    status: "compliant" as const,
    requirements:
      "EU-US Data Privacy Framework. Enhanced due diligence for > $10K.",
  },
  {
    from: "UK",
    to: "UAE",
    status: "compliant" as const,
    requirements:
      "Mutual recognition agreement. Travel rule compliance required.",
  },
  {
    from: "US",
    to: "India",
    status: "at-risk" as const,
    requirements:
      "No bilateral agreement. Full re-verification required at destination.",
  },
  {
    from: "EU",
    to: "Brazil",
    status: "warning" as const,
    requirements: "LGPD adequacy pending. Data localization may apply.",
  },
  {
    from: "Singapore",
    to: "Japan",
    status: "compliant" as const,
    requirements: "APAC mutual recognition. Standard credential bridging.",
  },
];

// ============================================================
// Helpers
// ============================================================

const statusColors: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  compliant: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  warning: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  "at-risk": {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
  },
};

const impactColors: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

// ============================================================
// Component
// ============================================================

export default function RegulatoryPage() {
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<
    "map" | "gaps" | "crossborder" | "mutual"
  >("map");
  const [searchQuery, setSearchQuery] = useState("");
  const [fromChain, setFromChain] = useState("UAE");
  const [toChain, setToChain] = useState("Singapore");

  const selected = jurisdictions.find((j) => j.id === selectedJurisdiction);
  const filteredJurisdictions = jurisdictions.filter(
    (j) =>
      j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.region.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const compliantCount = jurisdictions.filter(
    (j) => j.status === "compliant",
  ).length;
  const warningCount = jurisdictions.filter(
    (j) => j.status === "warning",
  ).length;
  const atRiskCount = jurisdictions.filter(
    (j) => j.status === "at-risk",
  ).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Globe className="w-7 h-7 text-identity-steel" />
              Multi-Jurisdiction Regulatory Dashboard
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Monitor compliance status, credential gaps, and regulatory changes
              across jurisdictions
            </p>
          </div>
          <button className="btn-primary">
            <FileText className="w-4 h-4" /> Export Report
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: "Jurisdictions",
              value: "12",
              icon: Globe,
              color: "text-brand-400",
              trend: "4 continents",
            },
            {
              label: "Compliant",
              value: String(compliantCount),
              icon: ShieldCheck,
              color: "text-emerald-400",
              trend: `${Math.round((compliantCount / jurisdictions.length) * 100)}% coverage`,
            },
            {
              label: "Warnings",
              value: String(warningCount),
              icon: AlertTriangle,
              color: "text-amber-400",
              trend: "Action needed",
            },
            {
              label: "At Risk",
              value: String(atRiskCount),
              icon: ShieldAlert,
              color: "text-red-400",
              trend: "Gaps identified",
            },
            {
              label: "Avg Score",
              value: String(
                Math.round(
                  jurisdictions.reduce((a, b) => a + b.score, 0) /
                    jurisdictions.length,
                ),
              ),
              icon: BarChart3,
              color: "text-identity-chrome",
              trend: "+4 vs last month",
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
            { id: "map" as const, label: "Jurisdiction Map", icon: MapPin },
            {
              id: "gaps" as const,
              label: "Credential Gaps",
              icon: AlertTriangle,
            },
            {
              id: "crossborder" as const,
              label: "Cross-Border Checker",
              icon: ArrowLeftRight,
            },
            {
              id: "mutual" as const,
              label: "Mutual Recognition",
              icon: Layers,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-brand-600 text-white"
                  : "bg-zero-900 border border-zero-800 text-zero-400 hover:text-white hover:border-zero-700"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Main Content */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            <AnimatePresence mode="wait">
              {/* Jurisdiction Map */}
              {activeTab === "map" && (
                <motion.div
                  key="map"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zero-500" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search jurisdictions..."
                      className="w-full pl-10 pr-4 py-2.5 bg-zero-900 border border-zero-800 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  {/* Visual Map Grid */}
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4">
                      Compliance Status by Jurisdiction
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {filteredJurisdictions.map((j, i) => {
                        const sc = statusColors[j.status];
                        return (
                          <motion.button
                            key={j.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.03 }}
                            onClick={() =>
                              setSelectedJurisdiction(
                                selectedJurisdiction === j.id ? null : j.id,
                              )
                            }
                            className={`p-4 rounded-xl border transition-all text-left ${
                              selectedJurisdiction === j.id
                                ? "border-brand-500 bg-brand-600/10"
                                : `${sc.bg} ${sc.border} hover:border-zero-600`
                            }`}
                          >
                            <div className="text-lg font-bold">
                              {j.id.toUpperCase()}
                            </div>
                            <div className="text-xs text-zero-400 mt-0.5">
                              {j.name}
                            </div>
                            <div
                              className={`text-2xl font-black mt-2 ${j.score >= 90 ? "text-emerald-400" : j.score >= 80 ? "text-amber-400" : "text-red-400"}`}
                            >
                              {j.score}
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              <span
                                className={`text-[10px] font-medium ${sc.text}`}
                              >
                                {j.status.toUpperCase()}
                              </span>
                              {j.gaps > 0 && (
                                <span className="text-[10px] text-zero-500">
                                  | {j.gaps} gaps
                                </span>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Credential Gaps */}
              {activeTab === "gaps" && (
                <motion.div
                  key="gaps"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="card">
                    <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <h2 className="font-semibold">Credential Gap Analysis</h2>
                      <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium">
                        {credentialGaps.length} gaps
                      </span>
                    </div>
                    <div className="divide-y divide-zero-800/50">
                      {credentialGaps.map((gap, i) => (
                        <motion.div
                          key={`${gap.jurisdiction}-${gap.credential}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="p-4 hover:bg-zero-800/20 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium text-sm">
                                {gap.credential}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <MapPin className="w-3 h-3 text-zero-500" />
                                <span className="text-xs text-zero-500">
                                  {gap.jurisdiction}
                                </span>
                                <span className="text-xs text-zero-600">|</span>
                                <Clock className="w-3 h-3 text-zero-500" />
                                <span className="text-xs text-zero-500">
                                  {gap.estimatedTime}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${impactColors[gap.priority]}`}
                              >
                                {gap.priority}
                              </span>
                              <button className="px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs transition-colors">
                                Request
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Cross-Border Checker */}
              {activeTab === "crossborder" && (
                <motion.div
                  key="crossborder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4 flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4 text-brand-400" />
                      Cross-Border Transfer Compliance Checker
                    </h2>
                    <div className="flex items-center gap-4 mb-6">
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">
                          From
                        </label>
                        <select
                          value={fromChain}
                          onChange={(e) => setFromChain(e.target.value)}
                          className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
                          {jurisdictions.map((j) => (
                            <option key={j.id} value={j.id.toUpperCase()}>
                              {j.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <ArrowLeftRight className="w-5 h-5 text-zero-500 mt-4 shrink-0" />
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">
                          To
                        </label>
                        <select
                          value={toChain}
                          onChange={(e) => setToChain(e.target.value)}
                          className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
                          {jurisdictions.map((j) => (
                            <option key={j.id} value={j.id.toUpperCase()}>
                              {j.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button className="btn-primary mt-4">Check</button>
                    </div>
                    <div className="space-y-3">
                      {crossBorderRoutes.map((route, i) => {
                        const sc = statusColors[route.status];
                        return (
                          <div
                            key={`${route.from}-${route.to}`}
                            className={`p-4 rounded-xl border ${sc.bg} ${sc.border}`}
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-bold text-sm">
                                {route.from}
                              </span>
                              <ArrowRight className="w-4 h-4 text-zero-500" />
                              <span className="font-bold text-sm">
                                {route.to}
                              </span>
                              <span
                                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.text} ${sc.bg}`}
                              >
                                {route.status.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-zero-400">
                              {route.requirements}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Mutual Recognition */}
              {activeTab === "mutual" && (
                <motion.div
                  key="mutual"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-identity-chrome" />
                      Mutual Recognition Matrix
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-zero-800">
                            <th className="text-left py-2 px-2 text-zero-500 font-medium">
                              Jurisdiction
                            </th>
                            {jurisdictions.slice(0, 8).map((j) => (
                              <th
                                key={j.id}
                                className="text-center py-2 px-1 text-zero-500 font-medium"
                              >
                                {j.id.toUpperCase()}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {jurisdictions.slice(0, 8).map((row) => (
                            <tr
                              key={row.id}
                              className="border-b border-zero-800/50 hover:bg-zero-800/20"
                            >
                              <td className="py-2 px-2 text-zero-300 font-medium">
                                {row.id.toUpperCase()}
                              </td>
                              {jurisdictions.slice(0, 8).map((col) => (
                                <td
                                  key={col.id}
                                  className="text-center py-2 px-1"
                                >
                                  {row.id === col.id ? (
                                    <span className="text-zero-700">-</span>
                                  ) : row.mutualRecognition.includes(
                                      col.id.toUpperCase(),
                                    ) ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                                  ) : (
                                    <XCircle className="w-3.5 h-3.5 text-zero-700 mx-auto" />
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            {/* Selected Jurisdiction Detail */}
            {selected ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="card p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">{selected.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusColors[selected.status].bg} ${statusColors[selected.status].text} ${statusColors[selected.status].border}`}
                  >
                    {selected.status.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">Score</span>
                    <span className="font-bold">{selected.score}/100</span>
                  </div>
                  <div className="w-full bg-zero-800 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${selected.score >= 90 ? "bg-emerald-500" : selected.score >= 80 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${selected.score}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">Framework</span>
                    <span>{selected.framework}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">Credentials</span>
                    <span>{selected.credentials} active</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">Gaps</span>
                    <span
                      className={
                        selected.gaps > 0
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }
                    >
                      {selected.gaps}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">Data Residency</span>
                    <span>{selected.dataResidency}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">GDPR</span>
                    <span>
                      {selected.gdpr ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                      ) : (
                        <XCircle className="w-4 h-4 text-zero-600 inline" />
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zero-400">eIDAS</span>
                    <span>
                      {selected.eidas ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                      ) : (
                        <XCircle className="w-4 h-4 text-zero-600 inline" />
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-zero-400">
                      Mutual Recognition
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selected.mutualRecognition.length > 0 ? (
                        selected.mutualRecognition.map((mr) => (
                          <span
                            key={mr}
                            className="px-2 py-0.5 rounded bg-zero-800 text-xs text-zero-300"
                          >
                            {mr}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-zero-500">
                          None established
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="card p-6 text-center">
                <MapPin className="w-10 h-10 mx-auto mb-3 text-zero-600" />
                <p className="text-sm text-zero-500">
                  Select a jurisdiction to view details
                </p>
              </div>
            )}

            {/* Data Sovereignty */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Database className="w-4 h-4 text-identity-steel" />
                Data Sovereignty Status
              </h3>
              <div className="space-y-2">
                {jurisdictions
                  .filter((j) => j.status === "compliant")
                  .slice(0, 5)
                  .map((j) => (
                    <div
                      key={j.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-zero-400">{j.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zero-500">
                          {j.dataResidency}
                        </span>
                        <Lock className="w-3 h-3 text-emerald-400" />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Regulatory Change Feed */}
            <div className="card">
              <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-brand-400" />
                <h3 className="font-semibold text-sm">
                  Regulatory Change Feed
                </h3>
              </div>
              <div className="divide-y divide-zero-800/50">
                {regulatoryFeed.map((item) => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between mb-1">
                      <div className="font-medium text-sm">{item.title}</div>
                      <span
                        className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium border ${impactColors[item.impact]}`}
                      >
                        {item.impact}
                      </span>
                    </div>
                    <p className="text-xs text-zero-500 mb-1.5">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-zero-600">
                      <Globe className="w-3 h-3" />
                      {item.jurisdiction}
                      <span>|</span>
                      <Clock className="w-3 h-3" />
                      {item.date}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GDPR / eIDAS Indicators */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Scale className="w-4 h-4 text-identity-amber" />
                Privacy Framework Compliance
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                  <div className="text-2xl font-bold text-emerald-400">
                    {jurisdictions.filter((j) => j.gdpr).length}
                  </div>
                  <div className="text-[10px] text-zero-500 mt-1">
                    GDPR Compliant
                  </div>
                </div>
                <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                  <div className="text-2xl font-bold text-brand-400">
                    {jurisdictions.filter((j) => j.eidas).length}
                  </div>
                  <div className="text-[10px] text-zero-500 mt-1">
                    eIDAS Compatible
                  </div>
                </div>
                <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                  <div className="text-2xl font-bold text-identity-chrome">
                    {
                      jurisdictions.filter(
                        (j) => j.mutualRecognition.length > 0,
                      ).length
                    }
                  </div>
                  <div className="text-[10px] text-zero-500 mt-1">
                    Mutual Recognition
                  </div>
                </div>
                <div className="p-3 bg-zero-800/50 rounded-xl text-center">
                  <div className="text-2xl font-bold text-identity-steel">
                    {jurisdictions.length}
                  </div>
                  <div className="text-[10px] text-zero-500 mt-1">
                    Total Covered
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
