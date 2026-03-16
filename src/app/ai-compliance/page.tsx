'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Brain,
  Search,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  Bot,
  User,
  TrendingUp,
  TrendingDown,
  Activity,
  Globe,
  FileText,
  Play,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Zap,
  Calendar,
  MapPin,
  Filter,
  Eye,
  XCircle,
  BarChart3,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';

// ============================================================
// Mock Data
// ============================================================

const riskFeed = [
  { id: '1', type: 'sanctions', severity: 'critical' as const, message: 'OFAC SDN list updated — 47 new entries detected', timestamp: '2 min ago', region: 'Global' },
  { id: '2', type: 'pep', severity: 'high' as const, message: 'PEP match: Subject linked to sanctioned entity in Russia', timestamp: '8 min ago', region: 'EU' },
  { id: '3', type: 'regulatory', severity: 'medium' as const, message: 'MiCA compliance deadline approaching for EU operations', timestamp: '15 min ago', region: 'EU' },
  { id: '4', type: 'transaction', severity: 'low' as const, message: 'Unusual volume detected on cross-border corridor UAE-SG', timestamp: '23 min ago', region: 'MENA' },
  { id: '5', type: 'aml', severity: 'high' as const, message: 'AML pattern: Structuring behavior flagged on 3 accounts', timestamp: '31 min ago', region: 'APAC' },
  { id: '6', type: 'sanctions', severity: 'medium' as const, message: 'EU sanctions list revision — 12 entities de-listed', timestamp: '45 min ago', region: 'EU' },
];

const sanctionsResults = [
  { id: 's1', name: 'Viktor Petrov', matchScore: 98, list: 'OFAC SDN', country: 'RU', status: 'confirmed' as const, riskLevel: 'critical' as const },
  { id: 's2', name: 'Al-Rashid Trading Co.', matchScore: 87, list: 'EU Consolidated', country: 'SY', status: 'review' as const, riskLevel: 'high' as const },
  { id: 's3', name: 'Chen Wei Holdings', matchScore: 72, list: 'UN Security Council', country: 'CN', status: 'review' as const, riskLevel: 'medium' as const },
  { id: 's4', name: 'Novak Industries Ltd', matchScore: 45, list: 'OFAC SDN', country: 'RS', status: 'cleared' as const, riskLevel: 'low' as const },
];

const jurisdictionHeatmap = [
  { region: 'USA', score: 94, status: 'compliant' as const },
  { region: 'EU', score: 91, status: 'compliant' as const },
  { region: 'UAE', score: 97, status: 'compliant' as const },
  { region: 'UK', score: 89, status: 'compliant' as const },
  { region: 'SG', score: 92, status: 'compliant' as const },
  { region: 'JP', score: 88, status: 'warning' as const },
  { region: 'KR', score: 85, status: 'warning' as const },
  { region: 'CH', score: 93, status: 'compliant' as const },
  { region: 'HK', score: 78, status: 'warning' as const },
  { region: 'AU', score: 90, status: 'compliant' as const },
  { region: 'CA', score: 86, status: 'warning' as const },
  { region: 'BR', score: 72, status: 'at-risk' as const },
  { region: 'IN', score: 68, status: 'at-risk' as const },
  { region: 'SA', score: 81, status: 'warning' as const },
  { region: 'DE', score: 95, status: 'compliant' as const },
];

const complianceScoreTrend = [
  { month: 'Sep', score: 82 },
  { month: 'Oct', score: 85 },
  { month: 'Nov', score: 84 },
  { month: 'Dec', score: 88 },
  { month: 'Jan', score: 91 },
  { month: 'Feb', score: 93 },
  { month: 'Mar', score: 94 },
];

const pepMatches = [
  { id: 'p1', name: 'Ahmed Al-Fahim', position: 'Former Minister of Finance, UAE', riskTier: 'Tier 1', lastScreened: '2h ago', details: 'Direct PEP. Held government position 2018-2023. No adverse media found. Enhanced due diligence recommended.' },
  { id: 'p2', name: 'Maria Santos', position: 'Senator, Philippines', riskTier: 'Tier 1', lastScreened: '4h ago', details: 'Current PEP. Active political figure. 2 adverse media mentions related to campaign finance. Ongoing monitoring required.' },
  { id: 'p3', name: 'James Richardson', position: 'Family member of UK MP', riskTier: 'Tier 2', lastScreened: '1d ago', details: 'RCA (Relative/Close Associate). Brother of sitting MP. No direct political exposure. Standard monitoring.' },
];

const regulatoryCalendar = [
  { id: 'r1', date: 'Mar 31, 2026', title: 'MiCA Full Enforcement', jurisdiction: 'EU', impact: 'high' as const, daysLeft: 16 },
  { id: 'r2', date: 'Apr 15, 2026', title: 'VARA Q1 Compliance Report', jurisdiction: 'UAE', impact: 'medium' as const, daysLeft: 31 },
  { id: 'r3', date: 'May 1, 2026', title: 'Travel Rule Threshold Update', jurisdiction: 'Global', impact: 'high' as const, daysLeft: 47 },
  { id: 'r4', date: 'Jun 30, 2026', title: 'FATF Mutual Evaluation', jurisdiction: 'MENA', impact: 'critical' as const, daysLeft: 107 },
];

const chatMessages = [
  { id: 'c1', role: 'assistant' as const, content: 'Good morning. I\'ve completed the overnight compliance scan. 3 new alerts require attention: 1 sanctions match (high confidence), 1 PEP update, and 1 regulatory deadline within 30 days.' },
  { id: 'c2', role: 'user' as const, content: 'Show me the sanctions match details.' },
  { id: 'c3', role: 'assistant' as const, content: 'The high-confidence match is Al-Rashid Trading Co. (87% match) against the EU Consolidated sanctions list. The entity is flagged for potential connections to sanctioned individuals in Syria. I recommend: 1) Freeze pending transactions, 2) Escalate to compliance officer, 3) File SAR if confirmed.' },
];

// ============================================================
// Helpers
// ============================================================

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const severityDots: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
};

const statusColors: Record<string, string> = {
  compliant: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'at-risk': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const heatmapBg: Record<string, string> = {
  compliant: 'bg-emerald-500/20 hover:bg-emerald-500/30',
  warning: 'bg-amber-500/20 hover:bg-amber-500/30',
  'at-risk': 'bg-red-500/20 hover:bg-red-500/30',
};

const matchStatusColors: Record<string, string> = {
  confirmed: 'bg-red-500/10 text-red-400',
  review: 'bg-amber-500/10 text-amber-400',
  cleared: 'bg-emerald-500/10 text-emerald-400',
};

// ============================================================
// Component
// ============================================================

export default function AICompliancePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState(chatMessages);
  const [expandedPep, setExpandedPep] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'feed' | 'screening' | 'heatmap'>('feed');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const newMsg = { id: `u${Date.now()}`, role: 'user' as const, content: chatInput };
    setMessages((prev) => [...prev, newMsg]);
    setChatInput('');
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a${Date.now()}`,
          role: 'assistant' as const,
          content: 'I\'ve analyzed the request. Based on current compliance data, all sanctions screenings are up to date. The next scheduled full screening is in 4 hours. Would you like me to run an ad-hoc screening now?',
        },
      ]);
    }, 1500);
  };

  const filteredSanctions = sanctionsResults.filter(
    (s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || !searchQuery
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Brain className="w-7 h-7 text-brand-400" />
              AI Compliance Command Center
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Real-time threat intelligence, AI-powered screening, and regulatory monitoring
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              AI Engine Active
            </span>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Compliance Score', value: '94/100', icon: ShieldCheck, color: 'text-emerald-400', trend: '+3 this month' },
            { label: 'Active Alerts', value: '7', icon: AlertTriangle, color: 'text-amber-400', trend: '2 critical' },
            { label: 'Screenings Today', value: '1,247', icon: Search, color: 'text-brand-400', trend: '+18% vs avg' },
            { label: 'PEP Matches', value: '3', icon: Eye, color: 'text-orange-400', trend: '1 new today' },
            { label: 'Jurisdictions', value: '15', icon: Globe, color: 'text-identity-chrome', trend: 'All monitored' },
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

        {/* Main Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column: Tabs (Feed / Screening / Heatmap) */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            {/* Tab Switcher */}
            <div className="flex items-center gap-2">
              {([
                { id: 'feed' as const, label: 'Risk Feed', icon: Activity },
                { id: 'screening' as const, label: 'Sanctions Screening', icon: Search },
                { id: 'heatmap' as const, label: 'Risk Heatmap', icon: MapPin },
              ]).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white hover:border-zero-700'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Feed Panel */}
            <AnimatePresence mode="wait">
              {activeTab === 'feed' && (
                <motion.div
                  key="feed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="card"
                >
                  <div className="p-4 border-b border-zero-800 flex items-center justify-between">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Activity className="w-4 h-4 text-brand-400" />
                      Live Risk Intelligence Feed
                    </h2>
                    <button className="text-xs text-zero-500 hover:text-white flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" /> Refresh
                    </button>
                  </div>
                  <div className="divide-y divide-zero-800/50">
                    {riskFeed.map((item, i) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="p-4 flex items-start gap-3 hover:bg-zero-800/30 transition-colors cursor-pointer"
                      >
                        <div className={`mt-0.5 w-2 h-2 rounded-full ${severityDots[item.severity]} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{item.message}</div>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${severityColors[item.severity]}`}>
                              {item.severity.toUpperCase()}
                            </span>
                            <span className="text-xs text-zero-500">{item.region}</span>
                            <span className="text-xs text-zero-600">{item.timestamp}</span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Screening Panel */}
              {activeTab === 'screening' && (
                <motion.div
                  key="screening"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="card"
                >
                  <div className="p-4 border-b border-zero-800">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zero-500" />
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search names, entities, addresses..."
                          className="w-full pl-10 pr-4 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        />
                      </div>
                      <button className="btn-primary text-sm px-4 py-2.5">
                        <Search className="w-4 h-4" /> Screen
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-zero-800/50">
                    {filteredSanctions.map((result) => (
                      <div key={result.id} className="p-4 flex items-center gap-4 hover:bg-zero-800/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{result.name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-zero-500">{result.list}</span>
                            <span className="text-xs text-zero-600">|</span>
                            <span className="text-xs text-zero-500">{result.country}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className={`text-sm font-bold ${result.matchScore >= 90 ? 'text-red-400' : result.matchScore >= 70 ? 'text-amber-400' : 'text-zero-400'}`}>
                              {result.matchScore}%
                            </div>
                            <div className="text-[10px] text-zero-500">confidence</div>
                          </div>
                          <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${matchStatusColors[result.status]}`}>
                            {result.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Heatmap Panel */}
              {activeTab === 'heatmap' && (
                <motion.div
                  key="heatmap"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="card p-6"
                >
                  <h2 className="font-semibold mb-4 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-brand-400" />
                    Compliance Risk by Jurisdiction
                  </h2>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                    {jurisdictionHeatmap.map((j) => (
                      <div
                        key={j.region}
                        className={`${heatmapBg[j.status]} border border-zero-700/50 rounded-xl p-3 text-center transition-colors cursor-pointer`}
                      >
                        <div className="text-lg font-bold">{j.region}</div>
                        <div className={`text-2xl font-black mt-1 ${j.score >= 90 ? 'text-emerald-400' : j.score >= 80 ? 'text-amber-400' : 'text-red-400'}`}>
                          {j.score}
                        </div>
                        <div className={`text-[10px] font-medium mt-1 ${j.status === 'compliant' ? 'text-emerald-400' : j.status === 'warning' ? 'text-amber-400' : 'text-red-400'}`}>
                          {j.status.toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-6 mt-4 text-xs text-zero-500">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/30" /> Compliant (90+)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/30" /> Warning (80-89)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/30" /> At Risk (&lt;80)</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compliance Score Trend */}
            <div className="card p-6">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Compliance Score Trend
              </h2>
              <div className="flex items-end gap-2 h-40">
                {complianceScoreTrend.map((point, i) => (
                  <div key={point.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-zero-400">{point.score}</span>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(point.score / 100) * 120}px` }}
                      transition={{ delay: i * 0.1, duration: 0.5 }}
                      className={`w-full rounded-t-lg ${point.score >= 90 ? 'bg-gradient-to-t from-emerald-600 to-emerald-400' : point.score >= 85 ? 'bg-gradient-to-t from-amber-600 to-amber-400' : 'bg-gradient-to-t from-orange-600 to-orange-400'}`}
                    />
                    <span className="text-[10px] text-zero-500">{point.month}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* PEP Matches */}
            <div className="card">
              <div className="p-4 border-b border-zero-800">
                <h2 className="font-semibold flex items-center gap-2">
                  <Eye className="w-4 h-4 text-orange-400" />
                  PEP Matches
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 text-xs font-medium">{pepMatches.length}</span>
                </h2>
              </div>
              <div className="divide-y divide-zero-800/50">
                {pepMatches.map((pep) => (
                  <div key={pep.id} className="p-4">
                    <button
                      onClick={() => setExpandedPep(expandedPep === pep.id ? null : pep.id)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      {expandedPep === pep.id ? <ChevronDown className="w-4 h-4 text-zero-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zero-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{pep.name}</div>
                        <div className="text-xs text-zero-500">{pep.position}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 text-[10px] font-medium">{pep.riskTier}</span>
                      <span className="text-xs text-zero-600">{pep.lastScreened}</span>
                    </button>
                    <AnimatePresence>
                      {expandedPep === pep.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 ml-7 p-3 bg-zero-800/50 rounded-lg text-sm text-zero-400">
                            {pep.details}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            {/* AI Copilot Chat */}
            <div className="card flex flex-col" style={{ height: '420px' }}>
              <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                <Bot className="w-4 h-4 text-brand-400" />
                <h3 className="font-semibold text-sm">AI Compliance Copilot</h3>
                <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px]">Online</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="w-3.5 h-3.5 text-white" />
                      </div>
                    )}
                    <div className={`max-w-[85%] p-3 rounded-xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-brand-600 text-white'
                        : 'bg-zero-800 text-zero-300'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="p-3 border-t border-zero-800">
                <div className="flex items-center gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask the AI copilot..."
                    className="flex-1 px-3 py-2 bg-zero-800 border border-zero-700 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  />
                  <button onClick={handleSendMessage} className="p-2 bg-brand-600 rounded-lg hover:bg-brand-500 transition-colors">
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  {['Run screening', 'Risk summary', 'Alerts'].map((action) => (
                    <button key={action} className="px-2 py-1 rounded-md bg-zero-800 text-[10px] text-zero-400 hover:text-white hover:bg-zero-700 transition-colors">
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {[
                  { icon: Play, label: 'Run Full Screening', desc: 'Screen all entities against all lists', color: 'bg-brand-600' },
                  { icon: FileText, label: 'Generate Report', desc: 'Export compliance status report', color: 'bg-identity-chrome' },
                  { icon: RefreshCw, label: 'Simulate Regulation', desc: 'Test impact of regulatory changes', color: 'bg-identity-steel' },
                ].map((action) => (
                  <button
                    key={action.label}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-zero-800/50 transition-colors text-left"
                  >
                    <div className={`w-9 h-9 rounded-lg ${action.color} flex items-center justify-center`}>
                      <action.icon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{action.label}</div>
                      <div className="text-[10px] text-zero-500">{action.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Active Alerts */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                Active Alerts
                <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-medium">2 Critical</span>
              </h3>
              <div className="space-y-2">
                {riskFeed.slice(0, 4).map((alert) => (
                  <div key={alert.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-zero-800/30 transition-colors cursor-pointer">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full ${severityDots[alert.severity]} shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-xs truncate">{alert.message}</div>
                      <div className="text-[10px] text-zero-600 mt-0.5">{alert.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Regulatory Calendar */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-identity-chrome" />
                Regulatory Calendar
              </h3>
              <div className="space-y-3">
                {regulatoryCalendar.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className="text-center shrink-0 w-12">
                      <div className={`text-lg font-bold ${item.daysLeft <= 30 ? 'text-red-400' : item.daysLeft <= 60 ? 'text-amber-400' : 'text-zero-300'}`}>
                        {item.daysLeft}
                      </div>
                      <div className="text-[10px] text-zero-500">days</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-zero-500">{item.date}</span>
                        <span className="text-[10px] text-zero-600">|</span>
                        <span className="text-[10px] text-zero-500">{item.jurisdiction}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${severityColors[item.impact]}`}>
                      {item.impact}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
