'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpDown,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Fuel,
  Link2,
  ChevronDown,
  Info,
  Zap,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type BridgeStep = 'initiate' | 'confirm_source' | 'relay' | 'confirm_dest' | 'complete';
type ChainId = 'ethereum' | 'aethelred' | 'polygon' | 'arbitrum' | 'optimism' | 'base';

interface Chain {
  id: ChainId;
  name: string;
  icon: string;
  color: string;
  explorerUrl: string;
}

interface BridgeableCredential {
  id: string;
  name: string;
  issuer: string;
  schema: string;
  expiresAt?: string;
}

interface FeeBreakdown {
  sourceTxFee: string;
  relayerFee: string;
  destTxFee: string;
  protocolFee: string;
  total: string;
  estimatedTime: string;
}

interface BridgeInterfaceProps {
  credentials?: BridgeableCredential[];
  loading?: boolean;
  error?: string | null;
  onBridge?: (params: { sourceChain: ChainId; destChain: ChainId; credentialIds: string[] }) => Promise<void>;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CHAINS: Chain[] = [
  { id: 'aethelred', name: 'Aethelred', icon: 'A', color: 'from-cyan-500 to-blue-600', explorerUrl: 'https://explorer.aethelred.io' },
  { id: 'ethereum', name: 'Ethereum', icon: 'E', color: 'from-blue-400 to-indigo-600', explorerUrl: 'https://etherscan.io' },
  { id: 'polygon', name: 'Polygon', icon: 'P', color: 'from-violet-500 to-purple-600', explorerUrl: 'https://polygonscan.com' },
  { id: 'arbitrum', name: 'Arbitrum', icon: 'Ar', color: 'from-blue-500 to-sky-600', explorerUrl: 'https://arbiscan.io' },
  { id: 'optimism', name: 'Optimism', icon: 'Op', color: 'from-red-500 to-rose-600', explorerUrl: 'https://optimistic.etherscan.io' },
  { id: 'base', name: 'Base', icon: 'B', color: 'from-blue-600 to-blue-800', explorerUrl: 'https://basescan.org' },
];

const BRIDGE_STEPS: { key: BridgeStep; label: string; description: string }[] = [
  { key: 'initiate', label: 'Initiate', description: 'Submit bridge request' },
  { key: 'confirm_source', label: 'Source Confirm', description: 'Transaction confirmed on source chain' },
  { key: 'relay', label: 'Relay', description: 'Relayer transmitting credential proof' },
  { key: 'confirm_dest', label: 'Dest Confirm', description: 'Transaction confirmed on destination' },
  { key: 'complete', label: 'Complete', description: 'Credential available on destination' },
];

const DEFAULT_CREDENTIALS: BridgeableCredential[] = [
  { id: 'c1', name: 'KYC Level 2 Verification', issuer: 'Aethelred Identity', schema: 'kyc-v2', expiresAt: '2027-01-15' },
  { id: 'c2', name: 'Accredited Investor', issuer: 'SEC Registry', schema: 'accredited-investor-v1', expiresAt: '2026-12-01' },
  { id: 'c3', name: 'AML Compliance Certificate', issuer: 'ComplianceOracle', schema: 'aml-cert-v1' },
  { id: 'c4', name: 'Age Verification (21+)', issuer: 'Aethelred Identity', schema: 'age-proof-v1', expiresAt: '2027-06-30' },
];

function getMockFees(source: ChainId, dest: ChainId): FeeBreakdown {
  return {
    sourceTxFee: source === 'ethereum' ? '0.0042 ETH' : '0.0003 ETH',
    relayerFee: '0.001 ETH',
    destTxFee: dest === 'ethereum' ? '0.0038 ETH' : '0.0002 ETH',
    protocolFee: '0.0005 ETH',
    total: source === 'ethereum' || dest === 'ethereum' ? '~0.009 ETH' : '~0.002 ETH',
    estimatedTime: source === 'ethereum' || dest === 'ethereum' ? '~15 minutes' : '~3 minutes',
  };
}

// ============================================================================
// Sub-components
// ============================================================================

function ChainSelector({
  selected,
  onSelect,
  label,
  excludeChain,
}: {
  selected: ChainId;
  onSelect: (chain: ChainId) => void;
  label: string;
  excludeChain?: ChainId;
}) {
  const [open, setOpen] = useState(false);
  const chain = CHAINS.find((c) => c.id === selected)!;

  return (
    <div className="relative">
      <label className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
      >
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${chain.color} flex items-center justify-center text-white text-xs font-bold`}>
          {chain.icon}
        </div>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1 text-left">
          {chain.name}
        </span>
        <ChevronDown className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute z-20 w-full mt-1 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-lg overflow-hidden"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            {CHAINS.filter((c) => c.id !== excludeChain).map((c) => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-secondary)] transition-colors ${
                  c.id === selected ? 'bg-brand-500/5' : ''
                }`}
              >
                <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${c.color} flex items-center justify-center text-white text-[10px] font-bold`}>
                  {c.icon}
                </div>
                <span className="text-xs text-[var(--text-primary)]">{c.name}</span>
                {c.id === selected && <CheckCircle2 className="w-3.5 h-3.5 text-brand-500 ml-auto" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BridgeStepper({ currentStep, txHashes }: { currentStep: BridgeStep; txHashes: Record<string, string> }) {
  const currentIdx = BRIDGE_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="space-y-2">
      {BRIDGE_STEPS.map((step, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isPending = idx > currentIdx;

        return (
          <motion.div
            key={step.key}
            className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
              isCurrent ? 'bg-brand-500/10 border border-brand-500/20' : 'bg-[var(--surface-secondary)]'
            }`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                isComplete
                  ? 'bg-emerald-500'
                  : isCurrent
                    ? 'bg-brand-500'
                    : 'bg-[var(--surface-tertiary)]'
              }`}
            >
              {isComplete ? (
                <CheckCircle2 className="w-4 h-4 text-white" />
              ) : isCurrent ? (
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              ) : (
                <span className="text-[10px] text-[var(--text-tertiary)] font-medium">{idx + 1}</span>
              )}
            </div>
            <div className="flex-1">
              <p className={`text-xs font-medium ${isCurrent ? 'text-brand-500' : isComplete ? 'text-emerald-400' : 'text-[var(--text-tertiary)]'}`}>
                {step.label}
              </p>
              <p className="text-[10px] text-[var(--text-tertiary)]">{step.description}</p>
            </div>
            {txHashes[step.key] && (
              <a href="#" className="flex items-center gap-1 text-[10px] text-brand-500 hover:text-brand-400">
                <ExternalLink className="w-3 h-3" />
                tx
              </a>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BridgeInterface({
  credentials = DEFAULT_CREDENTIALS,
  loading = false,
  error = null,
  onBridge,
  className = '',
}: BridgeInterfaceProps) {
  const [sourceChain, setSourceChain] = useState<ChainId>('aethelred');
  const [destChain, setDestChain] = useState<ChainId>('ethereum');
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
  const [bridging, setBridging] = useState(false);
  const [currentStep, setCurrentStep] = useState<BridgeStep | null>(null);
  const [showFees, setShowFees] = useState(false);

  const fees = useMemo(() => getMockFees(sourceChain, destChain), [sourceChain, destChain]);

  const toggleCredential = (id: string) => {
    setSelectedCredentials((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const swapChains = () => {
    setSourceChain(destChain);
    setDestChain(sourceChain);
  };

  const handleBridge = useCallback(async () => {
    if (selectedCredentials.size === 0) return;
    setBridging(true);

    const steps: BridgeStep[] = ['initiate', 'confirm_source', 'relay', 'confirm_dest', 'complete'];
    for (const step of steps) {
      setCurrentStep(step);
      await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000));
    }

    if (onBridge) {
      await onBridge({
        sourceChain,
        destChain,
        credentialIds: Array.from(selectedCredentials),
      });
    }

    setTimeout(() => {
      setBridging(false);
      setCurrentStep(null);
      setSelectedCredentials(new Set());
    }, 1500);
  }, [selectedCredentials, sourceChain, destChain, onBridge]);

  if (loading) {
    return (
      <div className={`card p-8 flex items-center justify-center gap-2 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">Loading bridge...</span>
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
    <div className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cross-Chain Credential Bridge</h3>
        </div>
        <span className="text-[10px] text-[var(--text-tertiary)]">Powered by ZeroID Relay</span>
      </div>

      <div className="p-5 space-y-5">
        {!bridging ? (
          <>
            {/* Chain selectors */}
            <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-end">
              <ChainSelector
                selected={sourceChain}
                onSelect={setSourceChain}
                label="Source Chain"
                excludeChain={destChain}
              />
              <button
                onClick={swapChains}
                className="w-10 h-10 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)] flex items-center justify-center hover:bg-[var(--surface-tertiary)] transition-colors mb-0.5"
                aria-label="Swap chains"
              >
                <ArrowUpDown className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
              <ChainSelector
                selected={destChain}
                onSelect={setDestChain}
                label="Destination Chain"
                excludeChain={sourceChain}
              />
            </div>

            {/* Credential selector */}
            <div>
              <label className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                Select Credentials to Bridge
              </label>
              <div className="space-y-1.5">
                {credentials.map((cred) => (
                  <button
                    key={cred.id}
                    onClick={() => toggleCredential(cred.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                      selectedCredentials.has(cred.id)
                        ? 'border-brand-500/30 bg-brand-500/5'
                        : 'border-[var(--border-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedCredentials.has(cred.id) ? 'border-brand-500 bg-brand-500' : 'border-[var(--border-primary)]'
                    }`}>
                      {selectedCredentials.has(cred.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">{cred.name}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">{cred.issuer}</p>
                    </div>
                    {cred.expiresAt && (
                      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                        Exp: {cred.expiresAt}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Fee breakdown */}
            {selectedCredentials.size > 0 && (
              <motion.div
                className="rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <button
                  onClick={() => setShowFees(!showFees)}
                  className="w-full flex items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <Fuel className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                    <span className="text-xs text-[var(--text-secondary)]">Estimated Fees</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--text-primary)]">{fees.total}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform ${showFees ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                <AnimatePresence>
                  {showFees && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 space-y-1.5 border-t border-[var(--border-primary)] pt-2">
                        {[
                          { label: 'Source Transaction', value: fees.sourceTxFee },
                          { label: 'Relayer Fee', value: fees.relayerFee },
                          { label: 'Destination Transaction', value: fees.destTxFee },
                          { label: 'Protocol Fee', value: fees.protocolFee },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center justify-between text-[10px]">
                            <span className="text-[var(--text-tertiary)]">{item.label}</span>
                            <span className="font-mono text-[var(--text-secondary)]">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Estimated time */}
            {selectedCredentials.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Clock className="w-3.5 h-3.5" />
                <span>Estimated completion: {fees.estimatedTime}</span>
              </div>
            )}

            {/* Security warning */}
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-400 font-medium">Security Notice</p>
                <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                  Bridged credentials use ZK relay proofs verified by TEE nodes on both chains.
                  The original credential remains valid on the source chain.
                </p>
              </div>
            </div>

            {/* Bridge button */}
            <button
              onClick={handleBridge}
              disabled={selectedCredentials.size === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Zap className="w-4 h-4" />
              Bridge {selectedCredentials.size} Credential{selectedCredentials.size !== 1 ? 's' : ''}
            </button>
          </>
        ) : (
          /* Bridge progress */
          <div className="space-y-4">
            <div className="text-center mb-4">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Bridging in Progress</h4>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {CHAINS.find((c) => c.id === sourceChain)?.name} to {CHAINS.find((c) => c.id === destChain)?.name}
              </p>
            </div>
            <BridgeStepper currentStep={currentStep!} txHashes={{}} />
          </div>
        )}
      </div>
    </div>
  );
}
