"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  ArrowRight,
  Shield,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Layers,
  Link2,
  RefreshCw,
  ExternalLink,
  Fingerprint,
  BadgeCheck,
  Coins,
  BarChart3,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import {
  useBridgeCredential,
  useBridgeFeeEstimate,
  useBridgedCredentials,
  useSupportedChains,
  type BridgedCredential,
  type BridgeTransaction,
  type SupportedChain,
} from "@/hooks/useCrossChain";
import { useCredentials } from "@/hooks/useCredentials";
import type { Credential } from "@/types";

// ============================================================
// Cross-Chain Operations Data
// ============================================================

const supportedChains = [
  {
    id: "1",
    name: "Ethereum",
    icon: "ETH",
    color: "from-blue-400 to-indigo-600",
    status: "active" as const,
    credentials: 0,
    latency: "12.0s",
    tvl: "Configured by contract",
  },
  {
    id: "137",
    name: "Polygon",
    icon: "MATIC",
    color: "from-purple-500 to-violet-600",
    status: "active" as const,
    credentials: 0,
    latency: "2.1s",
    tvl: "Configured by contract",
  },
  {
    id: "42161",
    name: "Arbitrum One",
    icon: "ARB",
    color: "from-blue-500 to-cyan-500",
    status: "active" as const,
    credentials: 0,
    latency: "0.3s",
    tvl: "Configured by contract",
  },
  {
    id: "11155111",
    name: "Sepolia",
    icon: "SEP",
    color: "from-zero-500 to-zero-700",
    status: "active" as const,
    credentials: 0,
    latency: "12.0s",
    tvl: "Testnet",
  },
];

const bridgeSteps = [
  {
    step: 1,
    label: "Initiate Bridge",
    description: "Lock credential on source chain",
  },
  {
    step: 2,
    label: "Generate Proof",
    description: "Create ZK bridge proof in TEE",
  },
  {
    step: 3,
    label: "Relay Proof",
    description: "Relay proof to destination chain",
  },
  {
    step: 4,
    label: "Verify & Mint",
    description: "Verify proof and mint bridged credential",
  },
  {
    step: 5,
    label: "Confirmation",
    description: "Bridge complete, credential active",
  },
];

// ============================================================
// Helpers
// ============================================================

const chainColors: Record<string, string> = {
  Ethereum: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Polygon: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Arbitrum One": "bg-blue-400/10 text-blue-300 border-blue-400/20",
  Sepolia: "bg-zero-400/10 text-zero-300 border-zero-400/20",
};

type ChainRow = (typeof supportedChains)[number] & {
  chainId: number;
  isActive: boolean;
  explorerUrl?: string;
  bridgeContractAddress?: string;
  requiredConfirmations?: number;
};

type CredentialOption = {
  id: string;
  label: string;
  status: string;
  issuer?: string;
};

type BridgedCredentialRow = {
  id: string;
  credential: string;
  sourceChain: string;
  destChain: string;
  bridgedAt: string;
  status: "verified" | "pending" | "expired" | "revoked";
  txHash: string;
};

const fallbackCredentialOptions: CredentialOption[] = [
  {
    id: "kyc_identity_verification",
    label: "KYC Identity Verification",
    status: "demo-ready",
  },
  {
    id: "age_verification",
    label: "Age Verification (18+)",
    status: "demo-ready",
  },
  {
    id: "accredited_investor_attestation",
    label: "Accredited Investor Attestation",
    status: "demo-ready",
  },
  {
    id: "aml_certificate",
    label: "AML Certificate",
    status: "demo-ready",
  },
];

function chainVisual(shortName: string, chainName: string) {
  const key = shortName.toLowerCase();
  if (key === "eth") return { icon: "ETH", color: "from-blue-400 to-indigo-600" };
  if (key === "pol") return { icon: "MATIC", color: "from-purple-500 to-violet-600" };
  if (key === "arb") return { icon: "ARB", color: "from-blue-500 to-cyan-500" };
  if (key === "sep") return { icon: "SEP", color: "from-zero-500 to-zero-700" };
  return {
    icon: chainName
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 5)
      .toUpperCase(),
    color: "from-zero-500 to-zero-700",
  };
}

function mapSupportedChain(chain: SupportedChain): ChainRow {
  const visual = chainVisual(chain.shortName, chain.name);
  return {
    id: String(chain.chainId),
    chainId: chain.chainId,
    name: chain.name,
    icon: visual.icon,
    color: visual.color,
    status: "active",
    isActive: chain.isActive,
    credentials: chain.supportedCredentialTypes.length,
    latency: `${(chain.avgBlockTimeMs / 1000).toFixed(1)}s`,
    tvl: chain.isActive ? "Contract configured" : "Contract missing",
    explorerUrl: chain.explorerUrl,
    bridgeContractAddress: chain.bridgeContractAddress,
    requiredConfirmations: chain.requiredConfirmations,
  };
}

function credentialId(credential: Credential) {
  return credential.id || credential.hash || credential.contentHash || credential.schemaHash;
}

function credentialLabel(credential: Credential) {
  return (
    credential.schemaName ||
    credential.name ||
    credential.schemaType ||
    credentialId(credential)
  );
}

function credentialStatus(credential: Credential) {
  return String(credential.status ?? "unknown").toLowerCase();
}

function mapCredentialOption(credential: Credential): CredentialOption {
  return {
    id: credentialId(credential),
    label: credentialLabel(credential),
    status: credentialStatus(credential),
    issuer: credential.issuer ?? String(credential.issuerDid),
  };
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const elapsedMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.round(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function mapBridgedCredential(row: BridgedCredential): BridgedCredentialRow {
  return {
    id: row.bridgeTxId,
    credential: row.schemaName,
    sourceChain: row.originalChainName,
    destChain: row.bridgedChainName,
    bridgedAt: formatRelativeTime(row.bridgedAt),
    status:
      row.status === "active"
        ? "verified"
        : row.status === "pending_sync"
          ? "pending"
          : row.status,
    txHash: row.bridgeTxId,
  };
}

function formatSeconds(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "Unavailable";
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
}

// ============================================================
// Component
// ============================================================

export default function CrossChainPage() {
  const [sourceChain, setSourceChain] = useState("1");
  const [destChain, setDestChain] = useState("137");
  const [selectedCredentials, setSelectedCredentials] = useState<string[]>([]);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [lastBridge, setLastBridge] = useState<BridgeTransaction | null>(null);
  const [activeTab, setActiveTab] = useState<
    "bridge" | "credentials" | "history"
  >("bridge");

  const chainsQuery = useSupportedChains();
  const credentialsQuery = useCredentials();
  const bridgedCredentialsQuery = useBridgedCredentials();
  const bridgeCredential = useBridgeCredential();

  const chainRows =
    chainsQuery.data && chainsQuery.data.length > 0
      ? chainsQuery.data.map(mapSupportedChain)
      : supportedChains.map((chain) => ({
          ...chain,
          chainId: Number(chain.id),
          isActive: false,
          explorerUrl: undefined,
          bridgeContractAddress: undefined,
          requiredConfirmations: undefined,
        }));
  const sourceExists = chainRows.some((chain) => chain.id === sourceChain);
  const effectiveSourceChain =
    (sourceExists ? sourceChain : chainRows[0]?.id) ?? sourceChain;
  const destinationExists = chainRows.some((chain) => chain.id === destChain);
  const requestedDestination =
    (destinationExists
      ? destChain
      : chainRows.find((chain) => chain.id !== effectiveSourceChain)?.id ??
        chainRows[0]?.id) ?? destChain;
  const effectiveDestChain =
    requestedDestination !== effectiveSourceChain
      ? requestedDestination
      : (chainRows.find((chain) => chain.id !== effectiveSourceChain)?.id ??
        requestedDestination);
  const sourceChainData = chainRows.find((c) => c.id === effectiveSourceChain);
  const destChainData = chainRows.find((c) => c.id === effectiveDestChain);

  const credentialOptions =
    credentialsQuery.credentials.length > 0
      ? credentialsQuery.credentials.map(mapCredentialOption)
      : fallbackCredentialOptions;
  const usingCredentialFallback = credentialsQuery.credentials.length === 0;
  const selectedCredentialForFee = selectedCredentials[0];
  const bridgeFeeQuery = useBridgeFeeEstimate(
    selectedCredentialForFee,
    destChainData?.chainId,
  );
  const bridgedRows =
    bridgedCredentialsQuery.data?.map(mapBridgedCredential) ?? [];
  const bridgeInProgress = bridgeCredential.isPending;
  const currentStep = bridgeInProgress ? 1 : lastBridge ? 5 : 0;
  const activeChainCount = chainRows.filter((chain) => chain.isActive).length;
  const standardEstimate = bridgeFeeQuery.data?.estimates.standard;
  const standardTime = bridgeFeeQuery.data?.estimatedTimes.standard;
  const relayerStatus =
    activeChainCount > 0 ? "Contract configured" : "Contract required";

  const handleBridge = async () => {
    setBridgeError(null);
    setLastBridge(null);

    if (!destChainData) {
      setBridgeError("Select a supported destination chain before bridging.");
      return;
    }

    try {
      let latestBridge: BridgeTransaction | null = null;
      for (const credentialId of selectedCredentials) {
        latestBridge = await bridgeCredential.mutateAsync({
          credentialId,
          destinationChainId: destChainData.chainId,
          priority: "standard",
          preservePrivacy: true,
        });
      }
      setLastBridge(latestBridge);
    } catch (error) {
      setBridgeError(
        error instanceof Error ? error.message : "Bridge initiation failed.",
      );
    }
  };

  const toggleCredential = (id: string) => {
    setSelectedCredentials((prev) => {
      const next = prev.filter((c) => c !== id);
      if (next.length === prev.length) next.push(id);
      return next;
    });
  };

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
              Bridge your verifiable credentials across blockchains with
              ZK-proof security
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Supported Chains",
              value: String(chainRows.length),
              icon: Layers,
              color: "text-brand-400",
              trend: `${activeChainCount} contract-ready`,
            },
            {
              label: "Bridged Credentials",
              value: String(bridgedRows.length),
              icon: Link2,
              color: "text-identity-chrome",
              trend: bridgedCredentialsQuery.isLoading
                ? "Refreshing"
                : "Subject inventory",
            },
            {
              label: "Standard Fee",
              value: standardEstimate
                ? `${standardEstimate.totalFee} ${standardEstimate.feeCurrency}`
                : "Select credential",
              icon: Clock,
              color: "text-emerald-400",
              trend: formatSeconds(standardTime),
            },
            {
              label: "Relayer Status",
              value: relayerStatus,
              icon: Coins,
              color: "text-identity-amber",
              trend: bridgeError ? "Action required" : "Readiness gate",
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
        <div className="flex items-center gap-2">
          {[
            { id: "bridge" as const, label: "Bridge", icon: ArrowLeftRight },
            {
              id: "credentials" as const,
              label: "Bridged Credentials",
              icon: BadgeCheck,
            },
            { id: "history" as const, label: "History", icon: Clock },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
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

        <div className="grid grid-cols-12 gap-6">
          {/* Main Content */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            <AnimatePresence mode="wait">
              {/* Bridge Interface */}
              {activeTab === "bridge" && (
                <motion.div
                  key="bridge"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className="card p-6">
                    <h2 className="font-semibold mb-4">Bridge Credentials</h2>

                    {/* Chain Selection */}
                    <div className="flex items-center gap-4 mb-6">
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">
                          Source Chain
                        </label>
	                        <select
	                          value={effectiveSourceChain}
	                          onChange={(e) => setSourceChain(e.target.value)}
                          className="w-full px-3 py-3 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
	                          {chainRows.map((c) => (
	                            <option key={c.id} value={c.id}>
	                              {c.name} ({c.icon})
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
	                        onClick={() => {
	                          const temp = effectiveSourceChain;
	                          setSourceChain(effectiveDestChain);
	                          setDestChain(temp);
	                        }}
                        className="mt-4 p-2.5 rounded-xl bg-zero-800 hover:bg-zero-700 text-zero-400 hover:text-white transition-colors"
                      >
                        <ArrowLeftRight className="w-5 h-5" />
                      </button>
                      <div className="flex-1">
                        <label className="block text-xs text-zero-500 mb-1">
                          Destination Chain
                        </label>
	                        <select
	                          value={effectiveDestChain}
	                          onChange={(e) => setDestChain(e.target.value)}
                          className="w-full px-3 py-3 bg-zero-800 border border-zero-700 rounded-xl text-sm focus:outline-none focus:border-brand-500"
                        >
	                          {chainRows
	                            .filter((c) => c.id !== effectiveSourceChain)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.icon})
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

	                    {/* Credentials to Bridge */}
	                    <div className="mb-4">
	                      <div className="flex items-center justify-between mb-2">
	                        <label className="block text-xs text-zero-500">
	                          Select Credentials to Bridge
	                        </label>
	                        {usingCredentialFallback && (
	                          <span className="text-[10px] text-amber-300">
	                            Local demo options
	                          </span>
	                        )}
	                      </div>
	                      <div className="space-y-2">
	                        {credentialOptions.map((cred) => (
	                          <label
	                            key={cred.id}
	                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
	                              selectedCredentials.includes(cred.id)
	                                ? "bg-brand-600/10 border-brand-500"
	                                : "bg-zero-800/50 border-zero-700 hover:border-zero-600"
	                            }`}
	                          >
	                            <input
	                              type="checkbox"
	                              checked={selectedCredentials.includes(cred.id)}
	                              onChange={() => toggleCredential(cred.id)}
	                              className="rounded border-zero-600"
	                            />
	                            <Fingerprint className="w-4 h-4 text-brand-400" />
	                            <span className="min-w-0 flex-1 text-sm">
	                              {cred.label}
	                              <span className="ml-2 text-[10px] uppercase text-zero-500">
	                                {cred.status}
	                              </span>
	                            </span>
	                          </label>
	                        ))}
	                      </div>
	                    </div>

                    {/* Fee Estimator */}
	                    <div className="p-4 bg-zero-800/50 rounded-xl mb-4">
	                      <div className="flex items-center justify-between text-sm mb-2">
	                        <span className="text-zero-400">Bridge Fee</span>
	                        <span className="font-medium">
	                          {standardEstimate
	                            ? `${standardEstimate.totalFee} ${standardEstimate.feeCurrency} ($${standardEstimate.feeUSD.toFixed(2)})`
	                            : "Select a credential"}
	                        </span>
	                      </div>
	                      <div className="flex items-center justify-between text-sm mb-2">
	                        <span className="text-zero-400">Estimated Time</span>
	                        <span className="font-medium">
	                          {formatSeconds(standardTime)}
	                        </span>
	                      </div>
	                      <div className="flex items-center justify-between text-sm">
	                        <span className="text-zero-400">
	                          Destination Confirmations
	                        </span>
	                        <span className="font-medium">
	                          {destChainData?.requiredConfirmations ?? "n/a"}
	                        </span>
	                      </div>
	                    </div>

	                    <button
	                      onClick={handleBridge}
	                      disabled={
	                        selectedCredentials.length === 0 ||
	                        bridgeInProgress ||
	                        !destChainData
	                      }
                      className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
	                      {bridgeInProgress ? (
	                        <span className="flex items-center gap-2">
	                          <RefreshCw className="w-4 h-4 animate-spin" />{" "}
	                          Submitting to bridge relayer...
	                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" /> Bridge{" "}
                          {selectedCredentials.length} Credential
                          {selectedCredentials.length !== 1 ? "s" : ""}
                        </span>
	                      )}
	                    </button>
	                  </div>

	                  {/* Bridge Status Steps */}
	                  {(bridgeInProgress || bridgeError || lastBridge) && (
	                    <motion.div
	                      initial={{ opacity: 0, y: 10 }}
	                      animate={{ opacity: 1, y: 0 }}
	                      className="card p-6"
	                    >
	                      <h3 className="font-semibold mb-4">
	                        Bridge Submission Status
	                      </h3>
	                      {bridgeError && (
	                        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
	                          <div className="flex items-start gap-2">
	                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
	                            <span>{bridgeError}</span>
	                          </div>
	                        </div>
	                      )}
	                      {lastBridge && (
	                        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
	                          Bridge accepted for {lastBridge.destinationChainName}.
	                          Status: {lastBridge.status}.
	                        </div>
	                      )}
	                      <div className="space-y-3">
	                        {bridgeSteps.map((step) => (
	                          <div
                            key={step.step}
                            className="flex items-center gap-3"
                          >
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
	                                step.step < currentStep
	                                  ? "bg-emerald-500 text-white"
	                                  : step.step === currentStep
	                                    ? bridgeError
	                                      ? "bg-amber-500 text-white"
	                                      : "bg-brand-600 text-white animate-pulse"
	                                    : "bg-zero-800 text-zero-500"
	                              }`}
                            >
	                              {step.step < currentStep || lastBridge ? (
	                                <CheckCircle2 className="w-4 h-4" />
	                              ) : bridgeError && step.step === 1 ? (
	                                <XCircle className="w-4 h-4" />
	                              ) : (
	                                step.step
	                              )}
                            </div>
                            <div>
                              <div
                                className={`text-sm font-medium ${step.step <= currentStep ? "text-white" : "text-zero-500"}`}
                              >
                                {step.label}
                              </div>
                              <div className="text-xs text-zero-500">
                                {step.description}
                              </div>
                            </div>
	                            {step.step === currentStep && bridgeInProgress && (
	                              <RefreshCw className="w-3 h-3 text-brand-400 animate-spin ml-auto" />
	                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* Bridged Credentials */}
              {activeTab === "credentials" && (
                <motion.div
                  key="credentials"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="card">
                    <div className="p-4 border-b border-zero-800">
                      <h2 className="font-semibold">Bridged Credentials</h2>
                    </div>
                    <div className="divide-y divide-zero-800/50">
	                      {bridgedRows.length > 0 ? (
	                        bridgedRows.map((bc, i) => (
	                          <motion.div
	                            key={bc.id}
	                            initial={{ opacity: 0 }}
	                            animate={{ opacity: 1 }}
	                            transition={{ delay: i * 0.05 }}
	                            className="p-4 flex items-center gap-4 hover:bg-zero-800/20 transition-colors"
	                          >
	                            <Fingerprint className="w-5 h-5 text-brand-400 shrink-0" />
	                            <div className="flex-1 min-w-0">
	                              <div className="font-medium text-sm">
	                                {bc.credential}
	                              </div>
	                              <div className="flex items-center gap-2 mt-1">
	                                <span
	                                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bc.sourceChain] ?? chainColors.Ethereum}`}
	                                >
	                                  {bc.sourceChain}
	                                </span>
	                                <ArrowRight className="w-3 h-3 text-zero-500" />
	                                <span
	                                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bc.destChain] ?? chainColors.Polygon}`}
	                                >
	                                  {bc.destChain}
	                                </span>
	                              </div>
	                            </div>
	                            <div className="text-right">
	                              <span
	                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${bc.status === "verified" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
	                              >
	                                {bc.status}
	                              </span>
	                              <div className="text-[10px] text-zero-600 mt-0.5">
	                                {bc.bridgedAt}
	                              </div>
	                            </div>
	                            {destChainData?.explorerUrl && (
	                              <a
	                                href={destChainData.explorerUrl}
	                                target="_blank"
	                                rel="noreferrer"
	                                className="p-1.5 rounded-lg hover:bg-zero-800 text-zero-500 hover:text-white"
	                              >
	                                <ExternalLink className="w-3.5 h-3.5" />
	                              </a>
	                            )}
	                          </motion.div>
	                        ))
	                      ) : (
	                        <div className="p-6 text-sm text-zero-400">
	                          No bridged credentials were returned for the connected
	                          subject. Once the backend records bridgedChains on a
	                          credential, it will appear here.
	                        </div>
	                      )}
	                    </div>
	                  </div>
                </motion.div>
              )}

              {/* History */}
              {activeTab === "history" && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="card">
                    <div className="p-4 border-b border-zero-800">
                      <h2 className="font-semibold">
                        Cross-Chain Verification History
                      </h2>
                    </div>
                    <div className="divide-y divide-zero-800/50">
	                      {bridgedRows.length > 0 ? (
	                        bridgedRows.map((bh, i) => (
	                          <motion.div
	                            key={bh.id}
	                            initial={{ opacity: 0 }}
	                            animate={{ opacity: 1 }}
	                            transition={{ delay: i * 0.05 }}
	                            className="p-4"
	                          >
	                            <div className="flex items-center gap-3 mb-2">
	                              <span
	                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bh.sourceChain] ?? chainColors.Ethereum}`}
	                              >
	                                {bh.sourceChain}
	                              </span>
	                              <ArrowRight className="w-3 h-3 text-zero-500" />
	                              <span
	                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${chainColors[bh.destChain] ?? chainColors.Polygon}`}
	                              >
	                                {bh.destChain}
	                              </span>
	                              <span className="flex-1 text-sm text-zero-300">
	                                {bh.credential}
	                              </span>
	                              <span
	                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${bh.status === "verified" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
	                              >
	                                {bh.status}
	                              </span>
	                            </div>
	                            <div className="flex items-center gap-4 text-xs text-zero-500">
	                              <span>Bridge ID: {bh.txHash.slice(0, 18)}...</span>
	                              <span>{bh.bridgedAt}</span>
	                            </div>
	                          </motion.div>
	                        ))
	                      ) : (
	                        <div className="p-6 text-sm text-zero-400">
	                          No cross-chain verification history is available for
	                          this subject yet.
	                        </div>
	                      )}
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
	                {chainRows.map((chain) => (
	                  <div
	                    key={chain.id}
	                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-zero-800/30 transition-colors"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg bg-gradient-to-br ${chain.color} flex items-center justify-center text-white text-xs font-bold`}
                    >
                      {chain.icon.substring(0, 2)}
                    </div>
	                    <div className="flex-1 min-w-0">
	                      <div className="text-sm font-medium">{chain.name}</div>
	                      <div className="text-[10px] text-zero-500">
	                        {chain.credentials} schemas | {chain.latency}
	                      </div>
	                    </div>
	                    <div className="flex items-center gap-1.5">
	                      <span className="relative flex h-1.5 w-1.5">
	                        {chain.isActive && (
	                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
	                        )}
	                        <span
	                          className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
	                            chain.isActive ? "bg-emerald-500" : "bg-amber-500"
	                          }`}
	                        />
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
	                {[
	                  {
	                    name: "Bridge contract",
	                    value:
	                      activeChainCount > 0
	                        ? `${activeChainCount}/${chainRows.length} configured`
	                        : "Not configured",
	                    ok: activeChainCount > 0,
	                  },
	                  {
	                    name: "Relayer submission",
	                    value: bridgeError ? "Needs relayer" : "Mutation wired",
	                    ok: !bridgeError,
	                  },
	                  {
	                    name: "Status polling",
	                    value: lastBridge ? lastBridge.status : "Relayer gated",
	                    ok: Boolean(lastBridge),
	                  },
	                  {
	                    name: "Credential inventory",
	                    value: usingCredentialFallback
	                      ? "Demo options"
	                      : `${credentialOptions.length} live`,
	                    ok: !usingCredentialFallback,
	                  },
	                ].map((op) => (
	                  <div
	                    key={op.name}
	                    className="flex items-center justify-between text-sm"
	                  >
	                    <div className="flex items-center gap-2">
	                      <span
	                        className={`w-1.5 h-1.5 rounded-full ${
	                          op.ok ? "bg-emerald-400" : "bg-amber-400"
	                        }`}
	                      />
	                      <span className="text-zero-400 text-xs">{op.name}</span>
	                    </div>
	                    <span
	                      className={`text-xs ${
	                        op.ok ? "text-emerald-400" : "text-amber-400"
	                      }`}
	                    >
	                      {op.value}
	                    </span>
	                  </div>
	                ))}
              </div>
              <div className="mt-3 p-3 bg-zero-800/50 rounded-xl">
                <div className="flex justify-between text-xs mb-1">
	                  <span className="text-zero-400">Fee Quote Valid</span>
	                  <span className="text-white font-medium">
	                    {bridgeFeeQuery.data
	                      ? new Date(
	                          bridgeFeeQuery.data.validUntil,
	                        ).toLocaleTimeString()
	                      : "n/a"}
	                  </span>
	                </div>
	                <div className="flex justify-between text-xs mb-1">
	                  <span className="text-zero-400">Destination</span>
	                  <span className="text-emerald-400">
	                    {destChainData?.name ?? "n/a"}
	                  </span>
	                </div>
	                <div className="flex justify-between text-xs">
	                  <span className="text-zero-400">Privacy Preservation</span>
	                  <span className="text-white font-medium">Enabled</span>
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
	                  { label: "Total Bridges", value: String(bridgedRows.length) },
	                  {
	                    label: "Verified Bridges",
	                    value: String(
	                      bridgedRows.filter((row) => row.status === "verified")
	                        .length,
	                    ),
	                  },
	                  {
	                    label: "Standard Fee",
	                    value: standardEstimate
	                      ? `${standardEstimate.totalFee} ${standardEstimate.feeCurrency}`
	                      : "n/a",
	                  },
	                  {
	                    label: "Destination",
	                    value: destChainData?.name ?? "n/a",
	                  },
	                  {
	                    label: "Active Bridges Now",
	                    value: bridgeInProgress ? "1" : "0",
	                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between text-sm"
                  >
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
