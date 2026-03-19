"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  CameraOff,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Lock,
  Cpu,
  Scan,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type LivenessStep = "look_straight" | "turn_left" | "turn_right" | "blink";
type CheckStatus = "idle" | "preparing" | "in_progress" | "success" | "failure";

interface LivenessCheckProps {
  onComplete?: (success: boolean, confidence: number) => void;
  onRetry?: () => void;
  autoStart?: boolean;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const LIVENESS_STEPS: {
  key: LivenessStep;
  label: string;
  instruction: string;
  icon: typeof Eye;
}[] = [
  {
    key: "look_straight",
    label: "Look Straight",
    instruction:
      "Position your face in the center of the frame and look directly at the camera",
    icon: Eye,
  },
  {
    key: "turn_left",
    label: "Turn Left",
    instruction: "Slowly turn your head to the left",
    icon: ArrowLeft,
  },
  {
    key: "turn_right",
    label: "Turn Right",
    instruction: "Slowly turn your head to the right",
    icon: ArrowRight,
  },
  {
    key: "blink",
    label: "Blink",
    instruction: "Blink your eyes naturally two times",
    icon: Eye,
  },
];

const ANTI_SPOOF_INDICATORS = [
  { name: "Depth Analysis", description: "3D face structure verification" },
  { name: "Texture Analysis", description: "Skin texture authenticity check" },
  {
    name: "Motion Consistency",
    description: "Natural movement pattern verification",
  },
  { name: "Light Reflection", description: "Eye reflection analysis" },
];

// ============================================================================
// Sub-components
// ============================================================================

function FaceOverlay({
  step,
  progress,
  status,
}: {
  step: LivenessStep;
  progress: number;
  status: CheckStatus;
}) {
  const radius = 110;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (progress / 100) * circumference;

  const color =
    status === "success"
      ? "#10b981"
      : status === "failure"
        ? "#ef4444"
        : "#0ea5e9";

  return (
    <div className="relative w-[260px] h-[260px] mx-auto">
      {/* Progress ring */}
      <svg
        viewBox="0 0 260 260"
        className="absolute inset-0 w-full h-full transform -rotate-90"
      >
        <circle
          cx="130"
          cy="130"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-white/10"
        />
        <motion.circle
          cx="130"
          cy="130"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: progressOffset }}
          transition={{ duration: 0.3 }}
        />
      </svg>

      {/* Face detection zone */}
      <div className="absolute inset-[24px] rounded-full border-2 border-dashed border-white/20 flex items-center justify-center">
        <div className="w-full h-full rounded-full bg-white/5 flex items-center justify-center">
          {status === "idle" || status === "preparing" ? (
            <Scan className="w-16 h-16 text-white/20" />
          ) : status === "success" ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 10 }}
            >
              <CheckCircle2 className="w-20 h-20 text-emerald-400" />
            </motion.div>
          ) : status === "failure" ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 10 }}
            >
              <XCircle className="w-20 h-20 text-red-400" />
            </motion.div>
          ) : (
            <Camera className="w-12 h-12 text-white/30" />
          )}
        </div>
      </div>

      {/* Step indicator arrows */}
      {status === "in_progress" && step === "turn_left" && (
        <motion.div
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2"
          animate={{ x: [-8, 0, -8] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <ArrowLeft className="w-8 h-8 text-brand-500" />
        </motion.div>
      )}
      {status === "in_progress" && step === "turn_right" && (
        <motion.div
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2"
          animate={{ x: [8, 0, 8] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <ArrowRight className="w-8 h-8 text-brand-500" />
        </motion.div>
      )}
    </div>
  );
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const color =
    confidence >= 90
      ? "bg-emerald-500"
      : confidence >= 70
        ? "bg-amber-500"
        : "bg-red-500";
  const label =
    confidence >= 90
      ? "High Confidence"
      : confidence >= 70
        ? "Moderate"
        : "Low Confidence";

  return (
    <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--text-secondary)]">
          Liveness Confidence
        </span>
        <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
          {confidence}%
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-[var(--surface-tertiary)]">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${confidence}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{label}</p>
    </div>
  );
}

function StepIndicator({
  steps,
  currentStepIdx,
  status,
}: {
  steps: typeof LIVENESS_STEPS;
  currentStepIdx: number;
  status: CheckStatus;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, idx) => {
        const isComplete = idx < currentStepIdx || status === "success";
        const isCurrent = idx === currentStepIdx && status === "in_progress";

        return (
          <div key={step.key} className="flex items-center gap-2">
            <motion.div
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isComplete
                  ? "bg-emerald-500"
                  : isCurrent
                    ? "bg-brand-500"
                    : "bg-[var(--surface-tertiary)]"
              }`}
              animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              {isComplete ? (
                <CheckCircle2 className="w-4 h-4 text-white" />
              ) : (
                <span className="text-[10px] font-medium text-white/60">
                  {idx + 1}
                </span>
              )}
            </motion.div>
            {idx < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 rounded ${
                  idx < currentStepIdx
                    ? "bg-emerald-500"
                    : "bg-[var(--surface-tertiary)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function LivenessCheck({
  onComplete,
  onRetry,
  autoStart = false,
  loading = false,
  error = null,
  className = "",
}: LivenessCheckProps) {
  const [status, setStatus] = useState<CheckStatus>(
    autoStart ? "preparing" : "idle",
  );
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [antiSpoofResults, setAntiSpoofResults] = useState<
    Record<string, boolean>
  >({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentStep = LIVENESS_STEPS[currentStepIdx];

  const startCheck = useCallback(() => {
    setStatus("preparing");
    setCurrentStepIdx(0);
    setProgress(0);
    setConfidence(0);
    setAntiSpoofResults({});

    // Simulate preparation
    setTimeout(() => {
      setStatus("in_progress");
    }, 1500);
  }, []);

  // Simulate step progression
  useEffect(() => {
    if (status !== "in_progress") return;

    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 2 + Math.random() * 3;
        if (next >= 100) {
          // Step complete
          const nextIdx = currentStepIdx + 1;
          if (nextIdx >= LIVENESS_STEPS.length) {
            // All steps complete
            clearInterval(timerRef.current!);
            const finalConfidence = 85 + Math.floor(Math.random() * 13);
            setConfidence(finalConfidence);

            // Simulate anti-spoof checks
            const results: Record<string, boolean> = {};
            for (const indicator of ANTI_SPOOF_INDICATORS) {
              results[indicator.name] = Math.random() > 0.1;
            }
            setAntiSpoofResults(results);

            const success =
              finalConfidence >= 80 && Object.values(results).every(Boolean);
            setStatus(success ? "success" : "failure");
            onComplete?.(success, finalConfidence);
            return 100;
          } else {
            setCurrentStepIdx(nextIdx);
            return 0;
          }
        }
        return next;
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, currentStepIdx, onComplete]);

  // Update confidence incrementally during check
  useEffect(() => {
    if (status === "in_progress") {
      const stepWeight = 100 / LIVENESS_STEPS.length;
      const baseConfidence = currentStepIdx * stepWeight;
      const stepProgress = (progress / 100) * stepWeight;
      setConfidence(Math.round(baseConfidence + stepProgress) * 0.95);
    }
  }, [progress, currentStepIdx, status]);

  const handleRetry = useCallback(() => {
    onRetry?.();
    startCheck();
  }, [onRetry, startCheck]);

  if (loading) {
    return (
      <div
        className={`card p-8 flex items-center justify-center gap-2 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">
          Initializing camera...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <CameraOff className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Scan className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Liveness Verification
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
          <Cpu className="w-3 h-3" />
          TEE Protected
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Camera preview area */}
        <div
          className="relative rounded-2xl bg-zero-950 overflow-hidden"
          style={{ minHeight: 300 }}
        >
          <div className="flex items-center justify-center py-6">
            <FaceOverlay
              step={currentStep!.key}
              progress={progress}
              status={status}
            />
          </div>

          {/* Instructions overlay */}
          <AnimatePresence mode="wait">
            {status === "in_progress" && currentStep && (
              <motion.div
                key={currentStep.key}
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
              >
                <p className="text-sm font-medium text-white mb-1">
                  {currentStep.label}
                </p>
                <p className="text-xs text-white/60">
                  {currentStep.instruction}
                </p>
              </motion.div>
            )}
            {status === "idle" && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Camera className="w-12 h-12 text-white/30 mb-3" />
                <p className="text-sm text-white/60">
                  Camera preview will appear here
                </p>
              </motion.div>
            )}
            {status === "preparing" && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Loader2 className="w-8 h-8 text-brand-500 animate-spin mb-3" />
                <p className="text-sm text-white/60">Preparing camera...</p>
                <p className="text-xs text-white/40 mt-1">
                  Ensure good lighting and face the camera
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Step progress indicator */}
        <StepIndicator
          steps={LIVENESS_STEPS}
          currentStepIdx={currentStepIdx}
          status={status}
        />

        {/* Confidence meter */}
        {(status === "in_progress" ||
          status === "success" ||
          status === "failure") && (
          <ConfidenceMeter confidence={Math.round(confidence)} />
        )}

        {/* Anti-spoof indicators */}
        {(status === "success" || status === "failure") &&
          Object.keys(antiSpoofResults).length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                Anti-Spoofing Checks
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {ANTI_SPOOF_INDICATORS.map((indicator) => {
                  const passed = antiSpoofResults[indicator.name];
                  return (
                    <div
                      key={indicator.name}
                      className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--surface-secondary)]"
                    >
                      {passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                      )}
                      <div>
                        <p className="text-[10px] font-medium text-[var(--text-primary)]">
                          {indicator.name}
                        </p>
                        <p className="text-[8px] text-[var(--text-tertiary)]">
                          {indicator.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        {/* Success state */}
        <AnimatePresence>
          {status === "success" && (
            <motion.div
              className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-emerald-400">
                Liveness Verified
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Your biometric liveness has been confirmed with{" "}
                {Math.round(confidence)}% confidence
              </p>
            </motion.div>
          )}
          {status === "failure" && (
            <motion.div
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <ShieldAlert className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-red-400">
                Verification Failed
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Unable to confirm liveness. Please try again with better
                lighting.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {status === "idle" && (
            <button
              onClick={startCheck}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              <Camera className="w-4 h-4" />
              Start Liveness Check
            </button>
          )}
          {(status === "success" || status === "failure") && (
            <button
              onClick={handleRetry}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Verification
            </button>
          )}
        </div>

        {/* Privacy notice */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
          <Lock className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-medium text-blue-400">
              Privacy Notice
            </p>
            <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
              All biometric data is processed exclusively within a Trusted
              Execution Environment (TEE). Raw biometric data never leaves the
              enclave. Only a cryptographic hash is stored on-chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
