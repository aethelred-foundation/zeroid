"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Binary,
  ShieldCheck,
  Zap,
  CircuitBoard,
  Hash,
} from "lucide-react";
import { useProof } from "@/hooks/useProof";
import type { DisclosureSelection, ZKProof } from "@/types";

type ProofStage =
  | "idle"
  | "loading-wasm"
  | "computing-witness"
  | "generating-proof"
  | "complete"
  | "error";

interface ProofGeneratorProps {
  disclosure: DisclosureSelection;
  onProofGenerated: (proof: ZKProof) => void;
  onError: (error: string) => void;
}

const stageConfig: Record<
  ProofStage,
  { label: string; description: string; icon: typeof Cpu; progress: number }
> = {
  idle: {
    label: "Ready",
    description: "Click generate to begin ZK proof creation",
    icon: CircuitBoard,
    progress: 0,
  },
  "loading-wasm": {
    label: "Loading Circuit",
    description: "Loading WASM prover module into memory...",
    icon: Binary,
    progress: 25,
  },
  "computing-witness": {
    label: "Computing Witness",
    description: "Evaluating circuit constraints with private inputs...",
    icon: Cpu,
    progress: 55,
  },
  "generating-proof": {
    label: "Generating Proof",
    description: "Computing zero-knowledge proof from witness...",
    icon: ShieldCheck,
    progress: 85,
  },
  complete: {
    label: "Proof Generated",
    description: "Zero-knowledge proof created successfully",
    icon: CheckCircle2,
    progress: 100,
  },
  error: {
    label: "Error",
    description: "Proof generation failed",
    icon: AlertCircle,
    progress: 0,
  },
};

export default function ProofGenerator({
  disclosure,
  onProofGenerated,
  onError,
}: ProofGeneratorProps) {
  const [stage, setStage] = useState<ProofStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { generateProof } = useProof();

  const handleGenerate = useCallback(async () => {
    setStage("loading-wasm");
    setErrorMessage(null);

    try {
      // Simulate stage transitions (in production, these would be callbacks from the prover)
      await new Promise((resolve) => setTimeout(resolve, 1200));
      setStage("computing-witness");

      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStage("generating-proof");

      const proof = await generateProof(disclosure);
      setStage("complete");
      onProofGenerated(proof);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error during proof generation";
      setErrorMessage(message);
      setStage("error");
      onError(message);
    }
  }, [disclosure, generateProof, onProofGenerated, onError]);

  const currentConfig = stageConfig[stage];
  const StageIcon = currentConfig.icon;

  // Circuit visualization nodes
  const circuitNodes = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    x: 20 + (i % 4) * 60,
    y: 20 + Math.floor(i / 4) * 50,
  }));

  const circuitEdges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 5],
    [5, 6],
    [6, 7],
    [4, 8],
    [5, 9],
    [6, 10],
    [7, 11],
    [8, 9],
    [9, 10],
    [10, 11],
  ];

  return (
    <div className="space-y-6">
      {/* Circuit visualization */}
      <div className="card p-6 overflow-hidden">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <CircuitBoard className="w-4 h-4 text-brand-500" />
          ZK Circuit
        </h3>
        <div className="relative h-40 w-full">
          <svg
            viewBox="0 0 260 170"
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Edges */}
            {circuitEdges.map(([from, to], idx) => {
              const fromNode = circuitNodes[from];
              const toNode = circuitNodes[to];
              const isActive = stage !== "idle" && stage !== "error";
              const activeDelay = idx * 0.1;

              return (
                <motion.line
                  key={`edge-${idx}`}
                  x1={fromNode.x}
                  y1={fromNode.y}
                  x2={toNode.x}
                  y2={toNode.y}
                  stroke={isActive ? "#4263eb" : "var(--border-primary)"}
                  strokeWidth={1.5}
                  strokeOpacity={isActive ? 0.6 : 0.3}
                  initial={{ pathLength: 0 }}
                  animate={
                    isActive
                      ? { pathLength: 1, strokeOpacity: [0.3, 0.8, 0.3] }
                      : { pathLength: 1 }
                  }
                  transition={
                    isActive
                      ? {
                          pathLength: { duration: 0.5, delay: activeDelay },
                          strokeOpacity: {
                            duration: 2,
                            repeat: Infinity,
                            delay: activeDelay,
                          },
                        }
                      : { duration: 0.3 }
                  }
                />
              );
            })}

            {/* Nodes */}
            {circuitNodes.map((node, idx) => {
              const isActive = stage !== "idle" && stage !== "error";
              const nodeDelay = idx * 0.08;
              const isHighlighted = (() => {
                if (stage === "complete") return true;
                if (stage === "computing-witness") return idx < 8;
                if (stage === "generating-proof") return idx >= 4;
                return false;
              })();

              return (
                <motion.circle
                  key={`node-${idx}`}
                  cx={node.x}
                  cy={node.y}
                  r={6}
                  fill={
                    isHighlighted
                      ? "#4263eb"
                      : isActive
                        ? "var(--surface-tertiary)"
                        : "var(--surface-secondary)"
                  }
                  stroke={isActive ? "#4263eb" : "var(--border-primary)"}
                  strokeWidth={1.5}
                  initial={{ scale: 0.8, opacity: 0.5 }}
                  animate={
                    isHighlighted
                      ? { scale: [1, 1.3, 1], opacity: 1 }
                      : { scale: 1, opacity: isActive ? 0.7 : 0.4 }
                  }
                  transition={
                    isHighlighted
                      ? { duration: 1.5, repeat: Infinity, delay: nodeDelay }
                      : { duration: 0.3, delay: nodeDelay }
                  }
                />
              );
            })}
          </svg>
        </div>
      </div>

      {/* Progress */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              stage === "complete"
                ? "bg-status-verified/10"
                : stage === "error"
                  ? "bg-red-500/10"
                  : "bg-brand-500/10"
            }`}
          >
            {stage === "idle" || stage === "complete" || stage === "error" ? (
              <StageIcon
                className={`w-5 h-5 ${
                  stage === "complete"
                    ? "text-status-verified"
                    : stage === "error"
                      ? "text-red-400"
                      : "text-brand-500"
                }`}
              />
            ) : (
              <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {currentConfig.label}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {currentConfig.description}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full bg-[var(--surface-tertiary)] overflow-hidden mb-4">
          <motion.div
            className={`h-full rounded-full ${
              stage === "complete"
                ? "bg-status-verified"
                : stage === "error"
                  ? "bg-red-500"
                  : "bg-brand-500"
            }`}
            initial={{ width: "0%" }}
            animate={{ width: `${currentConfig.progress}%` }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </div>

        {/* Stage steps */}
        <div className="space-y-2">
          {(
            [
              "loading-wasm",
              "computing-witness",
              "generating-proof",
            ] as ProofStage[]
          ).map((s, idx) => {
            const config = stageConfig[s];
            const Icon = config.icon;
            const stageOrder = [
              "loading-wasm",
              "computing-witness",
              "generating-proof",
            ];
            const currentOrder = stageOrder.indexOf(stage);
            const thisOrder = idx;
            const isDone = stage === "complete" || currentOrder > thisOrder;
            const isRunning = stage === s;

            return (
              <div
                key={s}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                  isRunning ? "bg-brand-500/5" : ""
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-status-verified flex-shrink-0" />
                ) : isRunning ? (
                  <Loader2 className="w-4 h-4 text-brand-500 animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-[var(--border-primary)] flex-shrink-0" />
                )}
                <span
                  className={`text-sm ${
                    isDone
                      ? "text-status-verified"
                      : isRunning
                        ? "text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {config.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error message */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{errorMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Generate button */}
      {(stage === "idle" || stage === "error") && (
        <button onClick={handleGenerate} className="btn-primary w-full">
          <Zap className="w-4 h-4" />
          Generate ZK Proof
        </button>
      )}
    </div>
  );
}
