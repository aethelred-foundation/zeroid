// @ts-nocheck
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Fingerprint,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Send,
  CheckCircle2,
  Clock,
  ArrowRight,
  QrCode,
  Link2,
  FileCheck,
  Zap,
  History,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import VerificationFlow from "@/components/verification/VerificationFlow";
import SelectiveDisclosureBuilder from "@/components/verification/SelectiveDisclosureBuilder";
import ProofVisualization from "@/components/zkp/ProofVisualization";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useVerification } from "@/hooks/useVerification";
import { useZKProof } from "@/hooks/useZKProof";

type VerificationMode = "generate" | "respond" | "history";

export default function VerificationPage() {
  const [mode, setMode] = useState<VerificationMode>("generate");
  const { verificationHistory, pendingRequests } = useVerification();
  const { proofHistory } = useZKProof();
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Verification</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Generate ZK proofs and manage selective disclosure
            </p>
          </div>
          {pendingRequests && pendingRequests.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-status-pending/10 border border-status-pending/20 rounded-xl">
              <Clock className="w-4 h-4 text-status-pending" />
              <span className="text-sm font-medium text-status-pending">
                {pendingRequests.length} pending request
                {pendingRequests.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[var(--surface-secondary)] rounded-xl w-fit">
          {[
            {
              id: "generate" as const,
              label: "Generate Proof",
              icon: Fingerprint,
            },
            { id: "respond" as const, label: "Respond to Request", icon: Send },
            { id: "history" as const, label: "History", icon: History },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === tab.id
                  ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {mode === "generate" && (
            <motion.div
              key="generate"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-12 gap-6"
            >
              {/* Verification Flow */}
              <div className="col-span-12 lg:col-span-8">
                <VerificationFlow />
              </div>

              {/* Sidebar */}
              <div className="col-span-12 lg:col-span-4 space-y-4">
                {/* How it works */}
                <div className="card p-6">
                  <h3 className="text-sm font-semibold mb-4">
                    How ZK Proofs Work
                  </h3>
                  <div className="space-y-4">
                    {[
                      {
                        step: "1",
                        title: "Select Attributes",
                        desc: "Choose what you want to prove",
                        icon: Eye,
                      },
                      {
                        step: "2",
                        title: "Build Circuit",
                        desc: "Private inputs stay local",
                        icon: Zap,
                      },
                      {
                        step: "3",
                        title: "Generate Proof",
                        desc: "Computed in your browser",
                        icon: Fingerprint,
                      },
                      {
                        step: "4",
                        title: "Verify On-chain",
                        desc: "Proof verified, data stays private",
                        icon: ShieldCheck,
                      },
                    ].map((step, i) => (
                      <div key={step.step} className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-brand-600/10 flex items-center justify-center text-brand-500 text-sm font-bold shrink-0">
                          {step.step}
                        </div>
                        <div>
                          <div className="text-sm font-medium">
                            {step.title}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            {step.desc}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Privacy guarantee */}
                <div className="card p-6 border-brand-500/20 bg-brand-500/5">
                  <div className="flex items-start gap-3">
                    <EyeOff className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold">
                        Zero Knowledge Guarantee
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-1">
                        The verifier learns only the truth of your claim, never
                        the underlying data. Your age, score, and nationality
                        remain private.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Supported proof types */}
                <div className="card p-6">
                  <h3 className="text-sm font-semibold mb-3">
                    Supported Proofs
                  </h3>
                  <div className="space-y-2">
                    {[
                      { label: "Age >= Threshold", circuit: "age_proof" },
                      { label: "Residency Region", circuit: "residency_proof" },
                      { label: "Credit Tier >=", circuit: "credit_tier_proof" },
                      {
                        label: "Nationality Set",
                        circuit: "nationality_proof",
                      },
                      { label: "Composite", circuit: "composite_proof" },
                    ].map((proof) => (
                      <div
                        key={proof.circuit}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--surface-secondary)]"
                      >
                        <span className="text-sm">{proof.label}</span>
                        <code className="text-2xs font-mono text-[var(--text-tertiary)]">
                          {proof.circuit}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {mode === "respond" && (
            <motion.div
              key="respond"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <SelectiveDisclosureBuilder requestedAttributes={[]} onComplete={() => {}} />
            </motion.div>
          )}

          {mode === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="card">
                <div className="p-6 border-b border-[var(--border-primary)]">
                  <h2 className="text-lg font-semibold">
                    Verification History
                  </h2>
                </div>
                <div className="divide-y divide-[var(--border-secondary)]">
                  {(verificationHistory ?? []).length > 0 ? (
                    verificationHistory?.map((verification, i) => (
                      <div
                        key={verification.id}
                        className="p-4 flex items-center gap-4 hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                        onClick={() => setSelectedProof(verification.id)}
                      >
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            verification.status === "verified"
                              ? "bg-status-verified/10 text-status-verified"
                              : verification.status === "pending"
                                ? "bg-status-pending/10 text-status-pending"
                                : "bg-status-revoked/10 text-status-revoked"
                          }`}
                        >
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {verification.proofType} Proof
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Requested by {verification.verifier}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusBadge status={verification.status as any} />
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {new Date(
                              verification.timestamp,
                            ).toLocaleDateString()}
                          </span>
                          <ArrowRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-12 text-center">
                      <History className="w-12 h-12 mx-auto mb-3 text-[var(--text-tertiary)]" />
                      <p className="text-[var(--text-secondary)]">
                        No verifications yet
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] mt-1">
                        Generate your first ZK proof to get started
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Proof Visualization Modal */}
              {selectedProof && (
                <div className="mt-6">
                  <ProofVisualization
                    proof={{} as any}
                    proofId={selectedProof}
                    onClose={() => setSelectedProof(null)}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}
