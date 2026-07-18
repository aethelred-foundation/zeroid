"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  ShieldCheck,
  Fingerprint,
  Globe,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ScanFace,
} from "lucide-react";
import { useAccount, useConnect } from "wagmi";
import {
  isAethelredWallet,
  orderWalletConnectors,
} from "@/config/wallet-picker";
import { useUAEPass } from "@/hooks/useUAEPass";
import { useBiometric } from "@/hooks/useBiometric";
import { IDENTITY_REGISTRY_VERIFICATION_UNAVAILABLE_MESSAGE } from "@/lib/identity/registration";
import type { IdentityCreationStep } from "@/types";

interface StepConfig {
  id: IdentityCreationStep;
  title: string;
  subtitle: string;
  icon: typeof Wallet;
  /** Shown, but the base identity does not require it — surfaced as skippable. */
  optional?: boolean;
}

// The full catalogue. The visible STEPS are this filtered by feature flags, so
// step order/count is dynamic — which is why rendering keys off step id, never
// a hard-coded index.
const ALL_STEPS: StepConfig[] = [
  {
    id: "connect-wallet",
    title: "Connect Wallet",
    subtitle: "Link your Web3 wallet to anchor your identity",
    icon: Wallet,
  },
  {
    id: "uae-pass",
    title: "UAE Pass Verification",
    subtitle: "Verify your real-world identity via UAE Pass",
    icon: ShieldCheck,
    optional: true,
  },
  {
    id: "biometric",
    title: "TEE Biometric Verification",
    subtitle: "Bind encrypted liveness evidence to an attested enclave",
    icon: ScanFace,
    optional: true,
  },
  {
    id: "register",
    title: "Identity Registration",
    subtitle: "Registration is paused until server-side chain verification is ready",
    icon: Globe,
  },
];

// Enterprise identity-assurance steps (government ID via UAE Pass, TEE biometric
// liveness) require real external credentials and are off unless a deployment
// enables them. Gating them keeps the default (testnet) flow to just Connect
// Wallet → Register, instead of surfacing steps that error when their backends
// aren't configured. Read as literal process.env.* so Next.js inlines the value
// into the client bundle (a computed key is never substituted at build time).
function visibleSteps(): StepConfig[] {
  const uaePassEnabled = process.env.NEXT_PUBLIC_UAE_PASS_ENABLED === "true";
  const teeBiometricEnabled =
    process.env.NEXT_PUBLIC_TEE_BIOMETRIC_ENABLED === "true";
  return ALL_STEPS.filter((s) => {
    if (s.id === "uae-pass") return uaePassEnabled;
    if (s.id === "biometric") return teeBiometricEnabled;
    return true;
  });
}

const stepVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -300 : 300, opacity: 0 }),
};

export default function IdentityCreation() {
  const STEPS = useMemo(visibleSteps, []);

  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const { address, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const {
    initiateVerification: initiateUAEPass,
    verificationStatus: uaePassStatus,
    error: uaePassError,
  } = useUAEPass();
  const { startScan, scanStatus } = useBiometric();

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  const goToStep = useCallback(
    (target: number) => {
      setDirection(target > currentStep ? 1 : -1);
      setCurrentStep(target);
    },
    [currentStep],
  );

  const handleNext = useCallback(() => {
    if (step?.id === "connect-wallet" && (!isConnected || !address)) return;
    if (currentStep < STEPS.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      goToStep(currentStep + 1);
    }
  }, [address, currentStep, goToStep, isConnected, step?.id, STEPS.length]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const clearError = useCallback(() => {
    setStepErrors((prev) => {
      const next = { ...prev };
      delete next[currentStep];
      return next;
    });
  }, [currentStep]);

  const runStep = useCallback(
    async (action: () => Promise<unknown>, fallbackMessage: string) => {
      clearError();
      setIsProcessing(true);
      try {
        await action();
        return true;
      } catch (err) {
        setStepErrors((prev) => ({
          ...prev,
          [currentStep]: err instanceof Error ? err.message : fallbackMessage,
        }));
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    [clearError, currentStep],
  );

  const walletOptions = orderWalletConnectors(connectors);

  const handleConnectWallet = useCallback(
    (connector: (typeof connectors)[number]) =>
      runStep(async () => {
        await connectAsync({ connector });
      }, "Failed to connect wallet"),
    [connectAsync, runStep],
  );

  const handleUAEPass = useCallback(
    () => runStep(initiateUAEPass, "UAE Pass verification failed"),
    [initiateUAEPass, runStep],
  );

  const handleBiometricScan = useCallback(
    () => runStep(startScan, "Biometric scan failed"),
    [startScan, runStep],
  );

  const currentError = stepErrors[currentStep];

  const renderStepContent = () => {
    switch (step?.id) {
      case "connect-wallet":
        return (
          <div className="space-y-4">
            {isConnected && address ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-status-verified/10 border border-status-verified/20">
                <CheckCircle2 className="w-5 h-5 text-status-verified flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Wallet Connected
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {walletOptions.map((connector) => (
                  <button
                    key={connector.uid}
                    onClick={() => handleConnectWallet(connector)}
                    disabled={isProcessing}
                    className="btn-secondary w-full justify-start gap-3"
                  >
                    {connector.icon ? (
                      // EIP-6963 icons are wallet-announced data: URIs.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={connector.icon}
                        alt=""
                        aria-hidden
                        className="h-4 w-4 rounded"
                      />
                    ) : (
                      <Wallet className="w-4 h-4" />
                    )}
                    {connector.name}
                    {isAethelredWallet(connector) && (
                      <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-brand-500">
                        Recommended
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case "uae-pass":
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-500/10 flex items-center justify-center">
                <ShieldCheck className="w-8 h-8 text-brand-500" />
              </div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">
                UAE Pass Identity Verification
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Start an official UAE Pass OAuth handoff. ZeroID marks this step
                complete only after the backend validates the callback and
                records government verification evidence.
              </p>
              {uaePassStatus === "verified" ? (
                <div className="flex items-center justify-center gap-2 text-status-verified">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">
                    Government Verification Complete
                  </span>
                </div>
              ) : uaePassStatus === "pending" ? (
                <div className="flex items-center justify-center gap-2 text-status-pending">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">
                    Awaiting UAE Pass Callback...
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {uaePassStatus === "failed" && uaePassError && (
                    <p className="text-sm text-red-400">{uaePassError}</p>
                  )}
                  <button
                    onClick={handleUAEPass}
                    disabled={isProcessing}
                    className="btn-primary"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    Start UAE Pass OAuth
                  </button>
                </div>
              )}
            </div>
          </div>
        );

      case "biometric":
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <motion.div
                className="w-20 h-20 mx-auto mb-4 rounded-full shield-gradient flex items-center justify-center"
                animate={
                  scanStatus === "scanning"
                    ? {
                        scale: [1, 1.1, 1],
                        boxShadow: [
                          "0 0 0 0 rgba(66,99,235,0.4)",
                          "0 0 0 20px rgba(66,99,235,0)",
                          "0 0 0 0 rgba(66,99,235,0.4)",
                        ],
                      }
                    : {}
                }
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <ScanFace className="w-10 h-10 text-white" />
              </motion.div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">
                Biometric Verification
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                ZeroID submits a sealed biometric capture envelope to an attested
                TEE node. This step remains incomplete until the backend returns
                a verification identifier from the enclave.
              </p>
              {scanStatus === "success" || scanStatus === "complete" ? (
                <div className="flex items-center justify-center gap-2 text-status-verified">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">
                    TEE Verification Complete
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleBiometricScan}
                  disabled={isProcessing || scanStatus === "scanning"}
                  className="btn-primary"
                >
                  {scanStatus === "scanning" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Requesting TEE...
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      Request TEE Verification
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        );

      case "register":
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <motion.div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-500/10 flex items-center justify-center"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200 }}
              >
                <AlertCircle className="w-8 h-8 text-status-pending" />
              </motion.div>

              <h4 className="font-semibold text-[var(--text-primary)] mb-2">
                Registration Temporarily Unavailable
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                {IDENTITY_REGISTRY_VERIFICATION_UNAVAILABLE_MESSAGE}
              </p>
              <button disabled className="btn-primary" aria-disabled="true">
                <Globe className="w-4 h-4" />
                Registration Unavailable
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((s, idx) => {
            const StepIcon = s.icon;
            const isCompleted = completedSteps.has(idx);
            const isCurrent = idx === currentStep;

            return (
              <div key={s.id} className="flex items-center">
                <button
                  onClick={() => isCompleted && goToStep(idx)}
                  disabled={!isCompleted && !isCurrent}
                  className={`
                    relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300
                    ${
                      isCompleted
                        ? "bg-status-verified border-status-verified text-white cursor-pointer"
                        : isCurrent
                          ? "border-brand-500 text-brand-500 bg-brand-500/10"
                          : "border-[var(--border-primary)] text-[var(--text-tertiary)] bg-[var(--surface-secondary)]"
                    }
                  `}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <StepIcon className="w-4 h-4" />
                  )}
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`hidden sm:block w-12 md:w-20 h-0.5 mx-1 transition-colors duration-300 ${
                      isCompleted
                        ? "bg-status-verified"
                        : "bg-[var(--border-primary)]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">
            {step?.title}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {step?.subtitle}
            {step?.optional && (
              <span className="ml-2 text-[var(--text-tertiary)]">
                · Optional
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Step content */}
      <div className="relative overflow-hidden min-h-[300px]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            {currentError && (
              <motion.div
                className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{currentError}</p>
              </motion.div>
            )}
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border-primary)]">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="btn-ghost disabled:opacity-30"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === currentStep
                  ? "bg-brand-500"
                  : "bg-[var(--border-primary)]"
              }`}
            />
          ))}
        </div>
        <button
          onClick={handleNext}
          disabled={
            isLastStep ||
            isProcessing ||
            (step?.id === "connect-wallet" && (!isConnected || !address))
          }
          className="btn-primary btn-sm"
        >
          {step?.optional ? "Skip" : "Next"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
