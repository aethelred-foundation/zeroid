'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight,
  ArrowRight,
  Shield,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Globe,
  Layers,
  Link2,
  Activity,
  Zap,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  Lock,
  Server,
  Fingerprint,
  BadgeCheck,
  Coins,
  TrendingUp,
  BarChart3,
  Eye,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';

// ============================================================
// Mock Data
// ============================================================

const supportedChains = [
  { id: 'aethelred', name: 'Aethelred', icon: 'AETH', color: 'from-cyan-500 to-blue-600', status: 'active' as const, credentials: 847, latency: '1.2s', tvl: '$12.4M' },
  { id: 'ethereum', name: 'Ethereum', icon: 'ETH', color: 'from-blue-400 to-indigo-600', status: 'active' as const, credentials: 423, latency: '2.8s', tvl: '$8.7M' },
  { id: 'polygon', name: 'Polygon', icon: 'MATIC', color: 'from-purple-500 to-violet-600', status: 'active' as const, credentials: 312, latency: '0.8s', tvl: '$3.2M' },
  { id: 'arbitrum', name: 'Arbitrum', icon: 'ARB', color: 'from-blue-500 to-cyan-500', status: 'active' as const, credentials: 189, latency: '1.5s', tvl: '$2.1M' },
  { id: 'solana', name: 'Solana', icon: 'SOL', color: 'from-green-400 to-teal-500', status: 'active' as const, credentials: 156, latency: '0.4s', tvl: '$1.8M' },
  { id: 'cosmos', name: 'Cosmos', icon: 'ATOM', color: 'from-zero-400 to-zero-600', status: 'active' as const, credentials: 98, latency: '1.0s', tvl: '$0.9M' },
];

const bridgedCredentials = [
  { id: 'bc1', credential: 'KYC Identity Verification', sourceChain: 'Aethelred', destChain: 'Ethereum', bridgedAt: '2h ago', status: 'verified' as const, txHash: '0x7a3...f21d' },
  { id: 'bc2', credential: 'Accredited Investor', sourceChain: 'Aethelred', destChain: 'Polygon', bridgedAt: '5h ago', status: 'verified' as const, txHash: '0x4b2...c93e' },
  { id: 'bc3', credential: 'Age Verification (18+)', sourceChain: 'Ethereum', destChain: 'Aethelred', bridgedAt: '1d ago', status: 'verified' as const, txHash: '0x9d1...e45a' },
  { id: 'bc4', credential: 'AML Certificate', sourceChain: 'Aethelred', destChain: 'Arbitrum', bridgedAt: '2d ago', status: 'verified' as const, txHash: '0x2f8...b7c1' },
  { id: 'bc5', credential: 'Business Entity Verification', sourceChain: 'Aethelred', destChain: 'Solana', bridgedAt: '3d ago', status: 'pending' as const, txHash: '0x5c3...d89f' },
];

const bridgeHistory = [
  { id: 'bh1', from: 'Aethelred', to: 'Ethereum', credential: 'KYC Verification', timestamp: '2h ago', status: 'completed' as const, fee: '0.002 ETH', duration: '4m 23s' },
  { id: 'bh2', from: 'Aethelred', to: 'Polygon', credential: 'Accredited Investor', timestamp: '5h ago', status: 'completed' as const, fee: '0.01 MATIC', duration: '1m 12s' },
  { id: 'bh3', from: 'Ethereum', to: 'Aethelred', credential: 'Age Verification', timestamp: '1d ago', status: 'completed' as const, fee: '0.003 ETH', duration: '6m 45s' },
  { id: 'bh4', from: 'Aethelred', to: 'Arbitrum', credential: 'AML Certificate', timestamp: '2d ago', status: 'completed' as const, fee: '0.0001 ETH', duration: '2m 30s' },
  { id: 'bh5', from: 'Aethelred', to: 'Solana', credential: 'Business Verification', timestamp: '3d ago', status: 'in-progress' as const, fee: '0.01 SOL', duration: 'In progress' },
];

const bridgeSteps = [
  { step: 1, label: 'Initiate Bridge', description: 'Lock credential on source chain' },
  { step: 2, label: 'Generate Proof', description: 'Create ZK bridge proof in TEE' },
  { step: 3, label: 'Relay Proof', description: 'Relay proof to destination chain' },
  { step: 4, label: 'Verify & Mint', description: 'Verify proof and mint bridged credential' },
  { step: 5, label: 'Confirmation', description: 'Bridge complete, credential active' },
];

const operatorHealth = [
  { name: 'Bridge Relayer #1', status: 'healthy' as const, uptime: '99.99%', lastBlock: '12,847,293' },
  { name: 'Bridge Relayer #2', status: 'healthy' as const, uptime: '99.97%', lastBlock: '12,847,291' },
  { name: 'Bridge Relayer #3', status: 'healthy' as const, uptime: '99.95%', lastBlock: '12,847,289' },
  { name: 'Fraud Proof Monitor', status: 'healthy' as const, uptime: '100%', lastBlock: 'N/A' },
];

// ============================================================
// Helpers
// ============================================================

const chainColors: Record<string, string> = {
  Aethelred: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  Ethereum: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Polygon: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Arbitrum: 'bg-blue-400/10 text-blue-300 border-blue-400/20',
  Solana: 'bg-green-500/10 text-green-400 border-green-500/20',
  Cosmos: 'bg-zero-400/10 text-zero-300 border-zero-400/20',
};

// ============================================================
// Component
// ============================================================

export default function CrossChainPage() {
  const [sourceChain, setSourceChain] = useState('aethelred');
  const [destChain, setDestChain] = useState('ethereum');
  const [selectedCredentials, setSelectedCredentials] = useState<string[]>([]);
  const [bridgeInProgress, setBridgeInProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeTab, setActiveTab] = useState<'bridge' | 'credentials' | 'history'>('bridge');

  const handleBridge = () => {
    setBridgeInProgress(true);
    setCurrentStep(1);
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= 5) {
          clearInterval(interval);
          setTimeout(() => setBridgeInProgress(false), 2000);
          return 5;
        }
        return prev + 1;
      });
    }, 2000);
  };

  const toggleCredential = (id: string) => {
    setSelectedCredentials((prev) => {
      const next = prev.filter((c) => c !== id);
      if (next.length === prev.length) next.push(id);
      return next;
    });
  };

  const sourceChainData = supportedChains.find((c) => c.id === sourceChain);
  const destChainData = supportedChains.find((c) => c.id === destChain);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Link2 className="w-7 h-7 text-brand-400" />
              Cross-Chain Identity Bridge
            </h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Bridge your verifiable credentials across blockchains with ZK-proof security
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Supported Chains', value: String(supportedChains.length), icon: Layers, color: 'text-brand-400', trend: 'All operational' },
            { label: 'Bridged Credentials', value: '2,025', icon: Link2, color: 'text-identity-chrome', trend: '+127 this week' },
            { label: 'Avg Bridge Time', value: '3.5 min', icon: Clock, color: 'text-emerald-400', trend: '-15% faster' },
            { label: 'Bridge TVL', value: '$29.1M', icon: Coins, color: 'text-identity-amber', trend: '+12% this month' },
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
        <div className="flex items-center gap-2">
          {([
            { id: 'bridge' as const, label: 'Bridge', icon: ArrowLeftRight },
            { id: 'credentials' as const, label: 'Bridged Credentials', icon: BadgeCheck },
            { id: 'history' as const, label: 'History', icon: Clock },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-zero-900 border border-zero-800 text-zero-400 hover:text-white'
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
              {/* Bridge Interface */}
              {activeTab === 'bridge' && (
                <motion.div key="bridge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4">Bridge Credentials</h2>

                    {/* Chain Selection */}
                    <div className="flex items-center gap-4 mb-6">
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">Source Chain</label>
                        <select
                          value={sourceChain}
                          onChange={(e) => setSourceChain(e.target.value)}
                          className="w-full px-3 py-3 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
                          {supportedChains.map((c) => (
                            <option key={c.id} value={c.id}>{c.name} ({c.icon})</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => { const temp = sourceChain; setSourceChain(destChain); setDestChain(temp); }}
                        className="mt-4 p-2.5 rounded-xl bg-zero-800 hover:bg-zero-700 text-zero-400 hover:text-white transition-colors"
                      >
                        <ArrowLeftRight className="w-5 h-5" />
                      </button>
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">Destination Chain</label>
                        <select
                          value={destChain}
                          onChange={(e) => setDestChain(e.target.value)}
                          className="w-full px-3 py-3 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
                          {supportedChains.filter((c) => c.id !== sourceChain).map((c) => (
                            <option key={c.id} value={c.id}>{c.name} ({c.icon})</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Credentials to Bridge */}
                    <div className="mb-4">
                      <label className="block text-xs text-zero-500 mb-2">Select Credentials to Bridge</label>
                      <div className="space-y-2">
                        {['KYC Identity Verification', 'Age Verification (18+)', 'Accredited Investor Attestation', 'AML Certificate'].map((cred) => (
                          <label
                            key={cred}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                              selectedCredentials.includes(cred)
                                ? 'bg-brand-600/10 border-brand-500'
                                : 'bg-zero-800/50 border-zero-700 hover:border-zero-600'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedCredentials.includes(cred)}
                              onChange={() => toggleCredential(cred)}
                              className="rounded border-zero-600"
                            />
                            <Fingerprint className="w-4 h-4 text-brand-400" />
                            <span className="text-sm">{cred}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Fee Estimator */}
                    <div className="p-4 bg-zero-800/50 rounded-xl mb-4">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-zero-400">Bridge Fee</span>
                        <span className="font-medium">~0.003 ETH ($8.42)</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-zero-400">Estimated Time</span>
                        <span className="font-medium">~3-5 minutes</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zero-400">Fraud Proof Window</span>
                        <span className="font-medium">7 days</span>
                      </div>
                    </div>

                    <button
                      onClick={handleBridge}
                      disabled={selectedCredentials.length === 0 || bridgeInProgress}
                      className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bridgeInProgress ? (
                        <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Bridging...</span>
                      ) : (
                        <span className="flex items-center gap-2"><ArrowRight className="w-4 h-4" /> Bridge {selectedCredentials.length} Credential{selectedCredentials.length !== 1 ? 's' : ''}</span>
                      )}
                    </button>
                  </div>

                  {/* Bridge Status Steps */}
                  {bridgeInProgress && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-6">
                      <h3 className="font-semibold mb-4">Bridge Progress</h3>
                      <div className="space-y-3">
                        {bridgeSteps.map((step) => (
                          <div key={step.step} className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                              step.step < currentStep ? 'bg-emerald-500 text-white' :
                              step.step === currentStep ? 'bg-brand-600 text-white animate-pulse' :
                              'bg-zero-800 text-zero-500'
                            }`}>
                              {step.step < currentStep ? <CheckCircle2 className="w-4 h-4" /> : step.step}
                            </div>
                            <div>
                              <div className={`text-sm font-medium ${step.step <= currentStep ? 'text-white' : 'text-zero-500'}`}>{step.label}</div>
                              <div className="text-xs text-zero-500">{step.description}</div>
                            </div>
                            {step.step === currentStep && <RefreshCw className="w-3 h-3 text-brand-400 animate-spin ml-auto" />}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* Bridged Credentials */}
              {activeTab === 'credentials' && (
                <motion.div key="credentials" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="card">
                    <div className="p-4 border-b border-zero-800">
                      <h2 className="font-semibold">Bridged Credentials</h2>
                    </div>
                    <div className="divide-y divide-zero-800/50">
                      {bridgedCredentials.map((bc, i) => (
                        <motion.div
                          key={bc.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.05 }}
                          className="p-4 flex items-center gap-4 hover:bg-zero-800/20 transition-colors"
                        >
                          <Fingerprint className="w-5 h-5 text-brand-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{bc.credential}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bc.sourceChain]}`}>{bc.sourceChain}</span>
                              <ArrowRight className="w-3 h-3 text-zero-500" />
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bc.destChain]}`}>{bc.destChain}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${bc.status === 'verified' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                              {bc.status}
                            </span>
                            <div className="text-[10px] text-zero-600 mt-0.5">{bc.bridgedAt}</div>
                          </div>
                          <button className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* History */}
              {activeTab === 'history' && (
                <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="card">
                    <div className="p-4 border-b border-zero-800">
                      <h2 className="font-semibold">Cross-Chain Verification History</h2>
                    </div>
                    <div className="divide-y divide-zero-800/50">
                      {bridgeHistory.map((bh, i) => (
                        <motion.div
                          key={bh.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.05 }}
                          className="p-4"
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bh.from]}`}>{bh.from}</span>
                            <ArrowRight className="w-3 h-3 text-zero-500" />
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bh.to]}`}>{bh.to}</span>
                            <span className="flex-1 text-sm text-zero-300">{bh.credential}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${bh.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                              {bh.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-zero-500">
                            <span>Fee: {bh.fee}</span>
                            <span>Duration: {bh.duration}</span>
                            <span>{bh.timestamp}</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            {/* Supported Chains */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand-400" />
                Supported Chains
              </h3>
              <div className="space-y-2">
                {supportedChains.map((chain) => (
                  <div key={chain.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-zero-800/30 transition-colors">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${chain.color} flex items-center justify-center text-white text-xs font-bold`}>
                      {chain.icon.substring(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{chain.name}</div>
                      <div className="text-[10px] text-zero-500">{chain.credentials} credentials | {chain.latency}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Status */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Bridge Security
              </h3>
              <div className="space-y-2">
                {operatorHealth.map((op) => (
                  <div key={op.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-zero-400 text-xs">{op.name}</span>
                    </div>
                    <span className="text-xs text-emerald-400">{op.uptime}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-3 bg-zero-800/50 rounded-xl">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zero-400">Fraud Proof Window</span>
                  <span className="text-white font-medium">7 days</span>
                </div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zero-400">Bridge Contract Audited</span>
                  <span className="text-emerald-400">Yes</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zero-400">Multi-sig Threshold</span>
                  <span className="text-white font-medium">5/7</span>
                </div>
              </div>
            </div>

            {/* Bridge Stats */}
            <div className="card p-5">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-identity-chrome" />
                Bridge Statistics
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Total Bridges', value: '2,025' },
                  { label: 'Success Rate', value: '99.8%' },
                  { label: 'Avg Duration', value: '3m 28s' },
                  { label: 'Total Fees Collected', value: '4.2 ETH' },
                  { label: 'Active Bridges Now', value: '3' },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between text-sm">
                    <span className="text-zero-400">{stat.label}</span>
                    <span className="font-medium">{stat.value}</span>
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
