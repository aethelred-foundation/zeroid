'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Plus,
  Grid3X3,
  List,
  Shield,
  ShieldCheck,
  ShieldOff,
  Activity,
  Star,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Search,
  Pause,
  Play,
  Trash2,
  Eye,
  Settings,
  Users,
  Link2,
  Cpu,
  Fingerprint,
  ArrowRight,
  UserCheck,
  Zap,
  TrendingUp,
  BarChart3,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';

// ============================================================
// Mock Data
// ============================================================

const agents = [
  { id: 'a1', name: 'ComplianceBot-Alpha', type: 'Compliance', status: 'active' as const, reputation: 96, verifications: 12847, delegations: 3, lastActive: '2 min ago', capabilities: ['sanctions_screening', 'kyc_verification', 'aml_monitoring', 'report_generation'], hitlEnabled: true, creator: '0x7a3...f21d' },
  { id: 'a2', name: 'KYC-Processor-v3', type: 'Identity', status: 'active' as const, reputation: 92, verifications: 8932, delegations: 1, lastActive: '5 min ago', capabilities: ['kyc_verification', 'document_analysis', 'biometric_check'], hitlEnabled: true, creator: '0x7a3...f21d' },
  { id: 'a3', name: 'TradingAgent-Gamma', type: 'DeFi', status: 'active' as const, reputation: 88, verifications: 5621, delegations: 5, lastActive: '12 min ago', capabilities: ['trade_execution', 'portfolio_rebalance', 'risk_assessment'], hitlEnabled: false, creator: '0x4b2...c93e' },
  { id: 'a4', name: 'AuditTrail-Monitor', type: 'Audit', status: 'suspended' as const, reputation: 74, verifications: 2341, delegations: 0, lastActive: '2h ago', capabilities: ['log_analysis', 'anomaly_detection'], hitlEnabled: true, creator: '0x7a3...f21d' },
  { id: 'a5', name: 'CrossBorderAgent-01', type: 'Payments', status: 'active' as const, reputation: 91, verifications: 7823, delegations: 2, lastActive: '8 min ago', capabilities: ['cross_border_transfer', 'fx_conversion', 'compliance_check'], hitlEnabled: true, creator: '0x9d1...e45a' },
  { id: 'a6', name: 'DataGuard-Sentinel', type: 'Security', status: 'inactive' as const, reputation: 85, verifications: 3102, delegations: 0, lastActive: '1d ago', capabilities: ['threat_detection', 'access_control', 'encryption'], hitlEnabled: false, creator: '0x4b2...c93e' },
];

const approvalQueue = [
  { id: 'q1', agentName: 'TradingAgent-Gamma', action: 'Execute swap: 50,000 USDC -> ETH', riskLevel: 'high' as const, requestedAt: '3 min ago', context: 'Portfolio rebalancing triggered by 5% ETH price drop' },
  { id: 'q2', agentName: 'ComplianceBot-Alpha', action: 'Escalate SAR filing for account 0x8f2...', riskLevel: 'critical' as const, requestedAt: '7 min ago', context: 'Structuring pattern detected across 3 transactions' },
  { id: 'q3', agentName: 'CrossBorderAgent-01', action: 'Initiate $250K transfer UAE -> Singapore', riskLevel: 'medium' as const, requestedAt: '15 min ago', context: 'Routine treasury rebalancing, within authorized limits' },
  { id: 'q4', agentName: 'KYC-Processor-v3', action: 'Override manual KYC review for entity flagged low-risk', riskLevel: 'low' as const, requestedAt: '22 min ago', context: 'Entity previously cleared, renewal verification' },
];

const delegationTree = [
  { parent: 'Root Admin (0x7a3...f21d)', children: [
    { name: 'ComplianceBot-Alpha', children: [
      { name: 'SubAgent-Screening-1', children: [] },
      { name: 'SubAgent-Screening-2', children: [] },
      { name: 'SubAgent-Reporting', children: [] },
    ]},
    { name: 'KYC-Processor-v3', children: [
      { name: 'DocAnalysis-Worker', children: [] },
    ]},
    { name: 'AuditTrail-Monitor', children: [] },
  ]},
];

const activityLog = [
  { id: 'l1', agent: 'ComplianceBot-Alpha', action: 'Completed sanctions screening batch (247 entities)', timestamp: '1 min ago', status: 'success' as const },
  { id: 'l2', agent: 'TradingAgent-Gamma', action: 'Awaiting approval: swap execution (HITL)', timestamp: '3 min ago', status: 'pending' as const },
  { id: 'l3', agent: 'KYC-Processor-v3', action: 'Verified identity: did:aethelred:0xf3a...92b1', timestamp: '5 min ago', status: 'success' as const },
  { id: 'l4', agent: 'CrossBorderAgent-01', action: 'FX rate locked for USD/SGD corridor', timestamp: '8 min ago', status: 'success' as const },
  { id: 'l5', agent: 'AuditTrail-Monitor', action: 'Suspended: attestation expired', timestamp: '2h ago', status: 'error' as const },
];

const capabilityMatrix = [
  { capability: 'KYC Verification', agents: ['ComplianceBot-Alpha', 'KYC-Processor-v3'] },
  { capability: 'Sanctions Screening', agents: ['ComplianceBot-Alpha'] },
  { capability: 'Trade Execution', agents: ['TradingAgent-Gamma'] },
  { capability: 'Cross-Border Transfer', agents: ['CrossBorderAgent-01'] },
  { capability: 'AML Monitoring', agents: ['ComplianceBot-Alpha'] },
  { capability: 'Document Analysis', agents: ['KYC-Processor-v3'] },
  { capability: 'Anomaly Detection', agents: ['AuditTrail-Monitor', 'DataGuard-Sentinel'] },
  { capability: 'Report Generation', agents: ['ComplianceBot-Alpha', 'AuditTrail-Monitor'] },
];

// ============================================================
// Helpers
// ============================================================

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  active: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Active' },
  suspended: { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', label: 'Suspended' },
  inactive: { color: 'text-zero-400', bg: 'bg-zero-500/10 border-zero-500/20', label: 'Inactive' },
};

const riskColors: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const logStatusColors: Record<string, string> = {
  success: 'text-emerald-400',
  pending: 'text-amber-400',
  error: 'text-red-400',
};

// ============================================================
// Component
// ============================================================

export default function AgentIdentityPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'registry' | 'capabilities' | 'delegations'>('registry');

  const filteredAgents = agents.filter(
    (a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Bot className="w-7 h-7 text-identity-chrome" />
              AI Agent Identity Management
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Register, manage, and monitor autonomous AI agents with verifiable identity
            </p>
          </div>
          <button onClick={() => { setShowWizard(true); setWizardStep(0); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Register Agent
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Registered Agents', value: '6', icon: Bot, color: 'text-brand-400', trend: '+2 this month' },
            { label: 'Active Now', value: '4', icon: Activity, color: 'text-emerald-400', trend: '67% of fleet' },
            { label: 'M2M Verifications', value: '41,566', icon: Fingerprint, color: 'text-identity-chrome', trend: '+1,247 today' },
            { label: 'HITL Queue', value: '4', icon: UserCheck, color: 'text-amber-400', trend: '1 critical' },
            { label: 'Avg Reputation', value: '88', icon: Star, color: 'text-identity-amber', trend: 'Network: 82' },
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

        {/* Section Tabs */}
        <div className="flex items-center gap-2">
          {([
            { id: 'registry' as const, label: 'Agent Registry', icon: Grid3X3 },
            { id: 'capabilities' as const, label: 'Capability Matrix', icon: BarChart3 },
            { id: 'delegations' as const, label: 'Delegation Chains', icon: GitBranch },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeSection === tab.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white hover:border-zero-700'
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
              {/* Registry */}
              {activeSection === 'registry' && (
                <motion.div key="registry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                  {/* Search + View Toggle */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zero-500" />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search agents by name or type..."
                        className="w-full pl-10 pr-4 py-2.5 bg-zero-900 border border-zero-800 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="flex items-center bg-zero-900 border border-zero-800 rounded-xl overflow-hidden">
                      <button onClick={() => setViewMode('grid')} className={`p-2.5 ${viewMode === 'grid' ? 'bg-brand-600 text-white' : 'text-zero-500 hover:text-white'}`}>
                        <Grid3X3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setViewMode('list')} className={`p-2.5 ${viewMode === 'list' ? 'bg-brand-600 text-white' : 'text-zero-500 hover:text-white'}`}>
                        <List className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Agent Grid/List */}
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {filteredAgents.map((agent, i) => (
                        <motion.div
                          key={agent.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          onClick={() => setSelectedAgent(agent.id)}
                          className={`card p-5 cursor-pointer hover:border-zero-600 transition-all ${selectedAgent === agent.id ? 'border-brand-500' : ''}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600/20 to-identity-chrome/20 border border-brand-500/10 flex items-center justify-center">
                                <Bot className="w-5 h-5 text-brand-400" />
                              </div>
                              <div>
                                <div className="font-medium text-sm">{agent.name}</div>
                                <div className="text-[10px] text-zero-500">{agent.type}</div>
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusConfig[agent.status].bg}`}>
                              <span className={statusConfig[agent.status].color}>{statusConfig[agent.status].label}</span>
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="text-center p-2 bg-zero-800/50 rounded-lg">
                              <div className="text-sm font-bold">{agent.reputation}</div>
                              <div className="text-[10px] text-zero-500">Rep</div>
                            </div>
                            <div className="text-center p-2 bg-zero-800/50 rounded-lg">
                              <div className="text-sm font-bold">{(agent.verifications / 1000).toFixed(1)}k</div>
                              <div className="text-[10px] text-zero-500">Verified</div>
                            </div>
                            <div className="text-center p-2 bg-zero-800/50 rounded-lg">
                              <div className="text-sm font-bold">{agent.delegations}</div>
                              <div className="text-[10px] text-zero-500">Delegated</div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex gap-1">
                              {agent.capabilities.slice(0, 2).map((cap) => (
                                <span key={cap} className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">{cap.replace('_', ' ')}</span>
                              ))}
                              {agent.capabilities.length > 2 && (
                                <span className="px-1.5 py-0.5 rounded bg-zero-800 text-[9px] text-zero-400">+{agent.capabilities.length - 2}</span>
                              )}
                            </div>
                            {agent.hitlEnabled && (
                              <span className="flex items-center gap-1 text-[10px] text-amber-400">
                                <UserCheck className="w-3 h-3" /> HITL
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zero-600 mt-2">Last active: {agent.lastActive}</div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="card divide-y divide-zero-800/50">
                      {filteredAgents.map((agent, i) => (
                        <motion.div
                          key={agent.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => setSelectedAgent(agent.id)}
                          className={`p-4 flex items-center gap-4 hover:bg-zero-800/30 cursor-pointer transition-colors ${selectedAgent === agent.id ? 'bg-zero-800/50' : ''}`}
                        >
                          <Bot className="w-5 h-5 text-brand-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{agent.name}</div>
                            <div className="text-xs text-zero-500">{agent.type} | {agent.lastActive}</div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-zero-400"><Star className="w-3 h-3 inline mr-1 text-identity-amber" />{agent.reputation}</span>
                            <span className="text-zero-400">{(agent.verifications / 1000).toFixed(1)}k</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusConfig[agent.status].bg} ${statusConfig[agent.status].color}`}>{statusConfig[agent.status].label}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white"><Settings className="w-3.5 h-3.5" /></button>
                            <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-amber-400"><Pause className="w-3.5 h-3.5" /></button>
                            <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Capability Matrix */}
              {activeSection === 'capabilities' && (
                <motion.div key="capabilities" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-brand-400" />
                      Agent Capability Matrix
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zero-800">
                            <th className="text-left py-3 px-3 text-zero-500 font-medium">Capability</th>
                            {agents.filter(a => a.status === 'active').map((a) => (
                              <th key={a.id} className="text-center py-3 px-2 text-zero-400 font-medium text-xs">{a.name.split('-')[0]}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {capabilityMatrix.map((row) => (
                            <tr key={row.capability} className="border-b border-zero-800/50 hover:bg-zero-800/20">
                              <td className="py-2.5 px-3 text-zero-300">{row.capability}</td>
                              {agents.filter(a => a.status === 'active').map((a) => (
                                <td key={a.id} className="text-center py-2.5 px-2">
                                  {row.agents.includes(a.name) ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                                  ) : (
                                    <span className="w-4 h-4 block mx-auto text-zero-700">-</span>
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

              {/* Delegation Chains */}
              {activeSection === 'delegations' && (
                <motion.div key="delegations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4 flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-identity-steel" />
                      Delegation Chain Visualization
                    </h2>
                    {delegationTree.map((root) => (
                      <div key={root.parent} className="space-y-2">
                        <div className="flex items-center gap-2 p-3 bg-brand-600/10 border border-brand-500/20 rounded-xl">
                          <Shield className="w-5 h-5 text-brand-400" />
                          <span className="font-medium">{root.parent}</span>
                          <span className="ml-auto px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 text-[10px]">Root</span>
                        </div>
                        <div className="ml-6 space-y-2">
                          {root.children.map((child) => (
                            <div key={child.name}>
                              <div className="flex items-center gap-2 p-2.5 bg-zero-800/50 border border-zero-700/50 rounded-lg">
                                <div className="w-px h-4 bg-zero-700 -ml-4" />
                                <Bot className="w-4 h-4 text-identity-chrome" />
                                <span className="text-sm">{child.name}</span>
                                <span className="ml-auto text-[10px] text-zero-500">{child.children.length} sub-agents</span>
                              </div>
                              {child.children.length > 0 && (
                                <div className="ml-8 mt-1 space-y-1">
                                  {child.children.map((sub) => (
                                    <div key={sub.name} className="flex items-center gap-2 p-2 bg-zero-800/30 rounded-md text-xs text-zero-400">
                                      <Cpu className="w-3 h-3 text-zero-500" />
                                      {sub.name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            {/* HITL Approval Queue */}
            <div className="card">
              <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-sm">Human-in-the-Loop Queue</h3>
                <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium">{approvalQueue.length}</span>
              </div>
              <div className="divide-y divide-zero-800/50">
                {approvalQueue.map((item) => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-xs text-zero-500">{item.agentName}</div>
                        <div className="text-sm font-medium mt-0.5">{item.action}</div>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${riskColors[item.riskLevel]}`}>
                        {item.riskLevel}
                      </span>
                    </div>
                    <p className="text-[10px] text-zero-500 mb-2">{item.context}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zero-600">{item.requestedAt}</span>
                      <div className="flex gap-2">
                        <button className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-medium transition-colors">Approve</button>
                        <button className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-400 text-[10px] font-medium transition-colors">Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real-time Activity */}
            <div className="card">
              <div className="p-4 border-b border-zero-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-brand-400" />
                <h3 className="font-semibold text-sm">Real-time Activity</h3>
              </div>
              <div className="divide-y divide-zero-800/50">
                {activityLog.map((log) => (
                  <div key={log.id} className="p-3 flex items-start gap-2">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${log.status === 'success' ? 'bg-emerald-400' : log.status === 'pending' ? 'bg-amber-400' : 'bg-red-400'}`} />
                    <div className="min-w-0">
                      <div className="text-xs text-zero-500">{log.agent}</div>
                      <div className="text-xs text-zero-300 mt-0.5">{log.action}</div>
                      <div className="text-[10px] text-zero-600 mt-0.5">{log.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* M2M Verification Stats */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-identity-chrome" />
                M2M Verification Stats
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Agent-to-Agent Auths', value: '8,293', change: '+12%' },
                  { label: 'Delegation Validations', value: '3,847', change: '+8%' },
                  { label: 'Capability Attestations', value: '12,441', change: '+15%' },
                  { label: 'Avg Auth Latency', value: '23ms', change: '-5%' },
                  { label: 'Failed Auths (24h)', value: '7', change: '-40%' },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between text-sm">
                    <span className="text-zero-400">{stat.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{stat.value}</span>
                      <span className={`text-[10px] text-emerald-400`}>
                        {stat.change}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Controls */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3">Agent Controls</h3>
              <div className="space-y-2">
                {[
                  { icon: Pause, label: 'Suspend All Agents', desc: 'Emergency fleet halt', color: 'hover:bg-amber-500/10 hover:text-amber-400' },
                  { icon: ShieldOff, label: 'Revoke Agent', desc: 'Permanently revoke identity', color: 'hover:bg-red-500/10 hover:text-red-400' },
                  { icon: RefreshCw, label: 'Rotate Credentials', desc: 'Refresh all agent keys', color: 'hover:bg-brand-500/10 hover:text-brand-400' },
                ].map((ctrl) => (
                  <button key={ctrl.label} className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${ctrl.color}`}>
                    <ctrl.icon className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{ctrl.label}</div>
                      <div className="text-[10px] text-zero-500">{ctrl.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Agent Creation Wizard Modal */}
        <AnimatePresence>
          {showWizard && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWizard(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative bg-zero-900 border border-zero-700 rounded-2xl w-full max-w-xl max-h-[80vh] overflow-y-auto"
              >
                <div className="p-5 border-b border-zero-800 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Register New Agent</h2>
                  <div className="flex items-center gap-2 text-xs text-zero-500">
                    Step {wizardStep + 1} of 4
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* Step indicators */}
                  <div className="flex items-center gap-2 mb-4">
                    {['Identity', 'Capabilities', 'Delegation', 'Review'].map((step, i) => (
                      <div key={step} className="flex items-center gap-2 flex-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${i <= wizardStep ? 'bg-brand-600 text-white' : 'bg-zero-800 text-zero-500'}`}>{i + 1}</div>
                        <span className={`text-xs ${i <= wizardStep ? 'text-white' : 'text-zero-500'}`}>{step}</span>
                      </div>
                    ))}
                  </div>

                  {wizardStep === 0 && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Agent Name</label>
                        <input className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500" placeholder="e.g., ComplianceBot-v2" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Agent Type</label>
                        <select className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500">
                          <option>Compliance</option><option>Identity</option><option>DeFi</option><option>Payments</option><option>Audit</option><option>Security</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Description</label>
                        <textarea className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500 min-h-[80px]" placeholder="Describe what this agent does..." />
                      </div>
                    </div>
                  )}
                  {wizardStep === 1 && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium mb-1.5">Select Capabilities</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['KYC Verification', 'Sanctions Screening', 'Trade Execution', 'Cross-Border Transfer', 'AML Monitoring', 'Document Analysis', 'Anomaly Detection', 'Report Generation'].map((cap) => (
                          <label key={cap} className="flex items-center gap-2 p-2.5 bg-zero-800 rounded-lg cursor-pointer hover:bg-zero-700 transition-colors text-sm">
                            <input type="checkbox" className="rounded border-zero-600" />
                            {cap}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {wizardStep === 2 && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Delegation Limit (max sub-agents)</label>
                        <input type="number" className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500" placeholder="5" />
                      </div>
                      <div className="flex items-center justify-between p-3 bg-zero-800 rounded-xl">
                        <div>
                          <div className="text-sm font-medium">Human-in-the-Loop</div>
                          <div className="text-[10px] text-zero-500">Require human approval for high-risk actions</div>
                        </div>
                        <div className="w-10 h-5 bg-brand-600 rounded-full relative cursor-pointer">
                          <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">HITL Threshold</label>
                        <select className="w-full px-3 py-2.5 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500">
                          <option>All actions</option><option>High-risk only</option><option>Critical only</option><option>Financial &gt; $10K</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {wizardStep === 3 && (
                    <div className="space-y-3">
                      <div className="p-4 bg-zero-800/50 rounded-xl text-sm space-y-2">
                        <div className="flex justify-between"><span className="text-zero-400">Name:</span><span>ComplianceBot-v2</span></div>
                        <div className="flex justify-between"><span className="text-zero-400">Type:</span><span>Compliance</span></div>
                        <div className="flex justify-between"><span className="text-zero-400">Capabilities:</span><span>3 selected</span></div>
                        <div className="flex justify-between"><span className="text-zero-400">HITL:</span><span className="text-emerald-400">Enabled</span></div>
                        <div className="flex justify-between"><span className="text-zero-400">Delegation Limit:</span><span>5</span></div>
                      </div>
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400">
                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                        A DID will be created for this agent on the Aethelred network. This action requires a transaction signature.
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between pt-2">
                    <button onClick={() => wizardStep > 0 ? setWizardStep(wizardStep - 1) : setShowWizard(false)} className="px-4 py-2 text-sm text-zero-400 hover:text-white transition-colors">
                      {wizardStep === 0 ? 'Cancel' : 'Back'}
                    </button>
                    <button
                      onClick={() => wizardStep < 3 ? setWizardStep(wizardStep + 1) : setShowWizard(false)}
                      className="btn-primary text-sm"
                    >
                      {wizardStep === 3 ? 'Register Agent' : 'Next'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
