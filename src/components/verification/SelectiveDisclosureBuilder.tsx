"use client";
// @ts-nocheck

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Lock,
  Unlock,
  Info,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useCredentials } from "@/hooks/useCredentials";
import type { CredentialAttribute, DisclosureSelection } from "@/types";

type DisclosureMode = "disclose" | "zk-prove" | "hidden";

interface AttributeState {
  attribute: CredentialAttribute;
  mode: DisclosureMode;
  required: boolean;
}

interface SelectiveDisclosureBuilderProps {
  requestedAttributes: CredentialAttribute[];
  onComplete: (selection: DisclosureSelection) => void;
}

export default function SelectiveDisclosureBuilder({
  requestedAttributes,
  onComplete,
}: SelectiveDisclosureBuilderProps) {
  const { credentials } = useCredentials();

  const availableAttributes = useMemo(() => {
    if (!credentials) return [];
    const attrs: CredentialAttribute[] = [];
    credentials.forEach((cred) => {
      cred.attributes?.forEach((attr: CredentialAttribute) => {
        if (!attrs.some((a) => a.key === attr.key)) {
          attrs.push(attr);
        }
      });
    });
    return attrs;
  }, [credentials]);

  const [attributeStates, setAttributeStates] = useState<AttributeState[]>(() =>
    availableAttributes.map((attr) => {
      const isRequested = requestedAttributes.some((r) => r.key === attr.key);
      return {
        attribute: attr,
        mode: isRequested ? "zk-prove" : "hidden",
        required: isRequested,
      };
    }),
  );

  const [error, setError] = useState<string | null>(null);

  const setMode = useCallback((key: string, mode: DisclosureMode) => {
    setAttributeStates((prev) =>
      prev.map((state) => {
        if (state.attribute.key !== key) return state;
        return { ...state, mode };
      }),
    );
    setError(null);
  }, []);

  const disclosedCount = attributeStates.filter(
    (s) => s.mode === "disclose",
  ).length;
  const zkProvedCount = attributeStates.filter(
    (s) => s.mode === "zk-prove",
  ).length;
  const hiddenCount = attributeStates.filter((s) => s.mode === "hidden").length;

  const handleComplete = useCallback(() => {
    const selection: DisclosureSelection = {
      disclosed: attributeStates
        .filter((s) => s.mode === "disclose")
        .map((s) => s.attribute),
      zkProved: attributeStates
        .filter((s) => s.mode === "zk-prove")
        .map((s) => s.attribute),
      hidden: attributeStates
        .filter((s) => s.mode === "hidden")
        .map((s) => s.attribute),
    };
    onComplete(selection);
  }, [attributeStates, onComplete]);

  const modeConfig: Record<
    DisclosureMode,
    {
      label: string;
      icon: typeof Eye;
      color: string;
      bgColor: string;
      description: string;
    }
  > = {
    disclose: {
      label: "Disclose",
      icon: Eye,
      color: "text-status-verified",
      bgColor: "bg-status-verified/10",
      description: "Value revealed to verifier",
    },
    "zk-prove": {
      label: "ZK Prove",
      icon: ShieldCheck,
      color: "text-brand-500",
      bgColor: "bg-brand-500/10",
      description: "Proved without revealing value",
    },
    hidden: {
      label: "Hidden",
      icon: EyeOff,
      color: "text-[var(--text-tertiary)]",
      bgColor: "bg-[var(--surface-tertiary)]",
      description: "Not included in proof",
    },
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="card p-4 flex items-start gap-3 bg-brand-500/5 border-brand-500/20">
        <Info className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Choose what to reveal
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            For each attribute, choose whether to directly disclose the value,
            prove it via zero-knowledge proof (keeping the value private), or
            hide it entirely.
          </p>
        </div>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-status-verified/5 border border-status-verified/10 text-center">
          <Eye className="w-4 h-4 text-status-verified mx-auto mb-1" />
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {disclosedCount}
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">Disclosed</p>
        </div>
        <div className="p-3 rounded-xl bg-brand-500/5 border border-brand-500/10 text-center">
          <Lock className="w-4 h-4 text-brand-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {zkProvedCount}
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">ZK Proved</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)] text-center">
          <EyeOff className="w-4 h-4 text-[var(--text-tertiary)] mx-auto mb-1" />
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {hiddenCount}
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">Hidden</p>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attribute list */}
      <div className="space-y-2">
        {attributeStates.length === 0 ? (
          <div className="card p-8 text-center">
            <Shield className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">
              No attributes available
            </p>
          </div>
        ) : (
          attributeStates.map((state) => {
            const config = modeConfig[state.mode];
            const ModeIcon = config.icon;

            return (
              <motion.div
                key={state.attribute.key}
                className={`p-4 rounded-xl border transition-all ${
                  state.mode === "disclose"
                    ? "border-status-verified/30 bg-status-verified/5"
                    : state.mode === "zk-prove"
                      ? "border-brand-500/30 bg-brand-500/5"
                      : "border-[var(--border-primary)] bg-[var(--surface-secondary)]"
                }`}
                layout
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-8 h-8 rounded-lg ${config.bgColor} flex items-center justify-center flex-shrink-0`}
                    >
                      <ModeIcon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {state.attribute.key}
                        </p>
                        {state.required && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-500 bg-brand-500/10 px-1.5 py-0.5 rounded">
                            Required
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {config.description}
                      </p>
                    </div>
                  </div>

                  {/* Mode toggle buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setMode(state.attribute.key, "disclose")}
                      className={`p-1.5 rounded-lg transition-colors ${
                        state.mode === "disclose"
                          ? "bg-status-verified/20 text-status-verified"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                      }`}
                      title="Disclose value"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setMode(state.attribute.key, "zk-prove")}
                      className={`p-1.5 rounded-lg transition-colors ${
                        state.mode === "zk-prove"
                          ? "bg-brand-500/20 text-brand-500"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                      }`}
                      title="Prove via ZK"
                    >
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setMode(state.attribute.key, "hidden")}
                      disabled={state.required}
                      className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        state.mode === "hidden"
                          ? "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
                      }`}
                      title="Hide attribute"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Show value preview when disclosing */}
                <AnimatePresence>
                  {state.mode === "disclose" && (
                    <motion.div
                      className="mt-3 pt-3 border-t border-status-verified/20"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <p className="text-xs text-[var(--text-tertiary)] mb-0.5">
                        Value to be revealed
                      </p>
                      <p className="text-sm font-mono text-[var(--text-primary)]">
                        {state.attribute.value}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Continue button */}
      <button onClick={handleComplete} className="btn-primary w-full">
        <CheckCircle2 className="w-4 h-4" />
        Continue with Selection
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
