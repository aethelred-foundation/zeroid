"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  Key,
  Fingerprint,
  Copy,
  ExternalLink,
  RefreshCw,
  UserPlus,
  Users,
  AlertTriangle,
  Check,
  Clock,
  Hash,
  Link2,
  Settings,
  ChevronRight,
} from "lucide-react";
import { useAccount } from "wagmi";
import AppLayout from "@/components/layout/AppLayout";
import IdentityCard from "@/components/identity/IdentityCard";
import IdentityCreation from "@/components/identity/IdentityCreation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useIdentity } from "@/hooks/useIdentity";
import { toast } from "sonner";

export default function IdentityPage() {
  const { address, isConnected } = useAccount();
  const { identity, delegates, isLoading, createIdentity, revokeDelegate } =
    useIdentity();
  const [showCreation, setShowCreation] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "delegates" | "recovery"
  >("overview");

  const copyDID = () => {
    if (identity?.did) {
      navigator.clipboard.writeText(identity.did);
      toast.success("DID copied to clipboard");
    }
  };

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-[var(--text-tertiary)]" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-[var(--text-secondary)]">
              Connect your wallet to manage your decentralized identity
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!identity && !showCreation) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center max-w-md"
          >
            <div className="w-24 h-24 mx-auto mb-6 shield-gradient rounded-3xl flex items-center justify-center identity-glow">
              <UserPlus className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Create Your Identity</h2>
            <p className="text-[var(--text-secondary)] mb-6">
              Create a self-sovereign decentralized identity. Your DID is
              anchored on-chain and verified through TEE enclaves.
            </p>
            <button
              onClick={() => setShowCreation(true)}
              className="btn-primary btn-lg"
            >
              <Key className="w-5 h-5" />
              Create ZeroID
            </button>
            <p className="text-xs text-[var(--text-tertiary)] mt-4">
              You retain full control. No central authority.
            </p>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  if (showCreation) {
    return (
      <AppLayout>
        <IdentityCreation />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Identity</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Manage your decentralized identity and delegates
            </p>
          </div>
          <button className="btn-secondary">
            <Settings className="w-4 h-4" />
            Identity Settings
          </button>
        </div>

        {/* Identity Card + Details */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5">
            <IdentityCard />
          </div>

          <div className="col-span-12 lg:col-span-7">
            <div className="card">
              {/* Tabs */}
              <div className="border-b border-[var(--border-primary)]">
                <div className="flex gap-0">
                  {[
                    {
                      id: "overview" as const,
                      label: "Overview",
                      icon: Shield,
                    },
                    {
                      id: "delegates" as const,
                      label: "Delegates",
                      icon: Users,
                    },
                    { id: "recovery" as const, label: "Recovery", icon: Key },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? "border-brand-500 text-brand-500"
                          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-6">
                <AnimatePresence mode="wait">
                  {activeTab === "overview" && (
                    <motion.div
                      key="overview"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-5"
                    >
                      {/* DID */}
                      <div>
                        <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Decentralized Identifier
                        </label>
                        <div className="mt-1.5 flex items-center gap-2 p-3 bg-[var(--surface-secondary)] rounded-xl">
                          <Hash className="w-4 h-4 text-brand-500 shrink-0" />
                          <code className="text-sm font-mono truncate flex-1">
                            {identity?.did ?? "did:aethelred:zeroid:0x..."}
                          </code>
                          <button
                            onClick={copyDID}
                            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] transition-colors"
                          >
                            <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
                          </button>
                          <a
                            href="#"
                            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                          </a>
                        </div>
                      </div>

                      {/* Identity Details Grid */}
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          {
                            label: "Status",
                            value: (identity as any)?.status ?? "Active",
                            badge: true,
                          },
                          {
                            label: "Created",
                            value: (identity as any)?.createdAt
                              ? new Date(
                                  (identity as any).createdAt,
                                ).toLocaleDateString()
                              : "N/A",
                          },
                          {
                            label: "Credentials",
                            value: (
                              (identity as any)?.credentialCount ?? 0
                            ).toString(),
                          },
                          {
                            label: "Verifications",
                            value: (
                              (identity as any)?.verificationCount ?? 0
                            ).toString(),
                          },
                          {
                            label: "TEE Attestation",
                            value: "Intel SGX",
                          },
                          {
                            label: "Last Active",
                            value: "Just now",
                          },
                        ].map((item) => (
                          <div key={item.label} className="space-y-1">
                            <div className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                              {item.label}
                            </div>
                            {item.badge ? (
                              <StatusBadge status="verified" />
                            ) : (
                              <div className="text-sm font-medium">
                                {item.value}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* On-chain Registration */}
                      <div className="p-4 bg-brand-600/5 border border-brand-500/20 rounded-xl">
                        <div className="flex items-center gap-3">
                          <Link2 className="w-5 h-5 text-brand-500" />
                          <div>
                            <div className="text-sm font-medium">
                              On-chain Anchored
                            </div>
                            <div className="text-xs text-[var(--text-tertiary)]">
                              Identity registered on Aethelred L1 at block #
                              {(identity as any)?.registrationBlock ??
                                "4,521,089"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeTab === "delegates" && (
                    <motion.div
                      key="delegates"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-[var(--text-secondary)]">
                          Delegates can act on your behalf for specific
                          credential operations.
                        </p>
                        <button className="btn-primary btn-sm">
                          <UserPlus className="w-4 h-4" />
                          Add Delegate
                        </button>
                      </div>

                      {(delegates ?? []).length === 0 ? (
                        <div className="text-center py-12">
                          <Users className="w-12 h-12 mx-auto mb-3 text-[var(--text-tertiary)]" />
                          <p className="text-[var(--text-secondary)]">
                            No delegates configured
                          </p>
                          <p className="text-xs text-[var(--text-tertiary)] mt-1">
                            Add trusted addresses that can manage credentials on
                            your behalf
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {delegates?.map((d) => (
                            <div
                              key={d.delegate}
                              className="flex items-center justify-between p-3 bg-[var(--surface-secondary)] rounded-xl"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand-600/20 flex items-center justify-center">
                                  <Users className="w-4 h-4 text-brand-500" />
                                </div>
                                <div>
                                  <code className="text-sm font-mono">
                                    {d.delegate.slice(0, 6)}...
                                    {d.delegate.slice(-4)}
                                  </code>
                                  <div className="text-xs text-[var(--text-tertiary)]">
                                    Expires:{" "}
                                    {new Date(
                                      Number(d.expiry) * 1000,
                                    ).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => revokeDelegate(d.delegate)}
                                className="btn-ghost btn-sm text-status-revoked"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeTab === "recovery" && (
                    <motion.div
                      key="recovery"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      <div className="p-4 bg-status-pending/5 border border-status-pending/20 rounded-xl">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-status-pending shrink-0 mt-0.5" />
                          <div>
                            <div className="text-sm font-medium">
                              Social Recovery Configured
                            </div>
                            <div className="text-xs text-[var(--text-secondary)] mt-1">
                              3 of 5 guardians required to recover your
                              identity. Last verified 14 days ago.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">
                          Recovery Guardians
                        </h3>
                        {[
                          {
                            name: "Guardian 1",
                            status: "active",
                            type: "Wallet",
                          },
                          {
                            name: "Guardian 2",
                            status: "active",
                            type: "Wallet",
                          },
                          {
                            name: "Guardian 3",
                            status: "active",
                            type: "Hardware Key",
                          },
                          {
                            name: "Guardian 4",
                            status: "active",
                            type: "Wallet",
                          },
                          {
                            name: "Guardian 5",
                            status: "pending",
                            type: "Email",
                          },
                        ].map((guardian, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 bg-[var(--surface-secondary)] rounded-xl"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  guardian.status === "active"
                                    ? "bg-status-verified"
                                    : "bg-status-pending"
                                }`}
                              />
                              <div>
                                <div className="text-sm font-medium">
                                  {guardian.name}
                                </div>
                                <div className="text-xs text-[var(--text-tertiary)]">
                                  {guardian.type}
                                </div>
                              </div>
                            </div>
                            <StatusBadge
                              status={
                                guardian.status === "active"
                                  ? "verified"
                                  : "pending"
                              }
                            />
                          </div>
                        ))}
                      </div>

                      <button className="btn-secondary w-full">
                        <RefreshCw className="w-4 h-4" />
                        Update Recovery Configuration
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
