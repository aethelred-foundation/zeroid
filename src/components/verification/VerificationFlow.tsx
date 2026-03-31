"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Fingerprint,
  Eye,
  EyeOff,
  Zap,
  Lock,
  Send,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import SelectiveDisclosureBuilder from "./SelectiveDisclosureBuilder";
import ProofGenerator from "@/components/zkp/ProofGenerator";
import { useVerification } from "@/hooks/useVerification";
import { useProof } from "@/hooks/useProof";
import type {
  VerificationRequest,
  DisclosureSelection,
  ZKProof,
  VerificationResult,
  CredentialAttribute,
} from "@/types";

type FlowStep =
  | "select-attributes"
  | "generate-proof"
  | "submit-proof"
  | "result";

interface VerificationFlowProps {
  request?: VerificationRequest;
  onComplete?: (result: VerificationResult) => void;
  onCancel?: () => void;
}

const stepLabels: Record<FlowStep, string> = {
  "select-attributes": "Select Attributes",
  "generate-proof": "Generate Proof",
  "submit-proof": "Submit",
  result: "Result",
};

const FLOW_STEPS: FlowStep[] = [
  "select-attributes",
  "generate-proof",
  "submit-proof",
  "result",
];

export default function VerificationFlow({
  request,
  onComplete,
  onCancel,
}: VerificationFlowProps) {
  const [currentStep, setCurrentStep] = useState<FlowStep>("select-attributes");
  const [disclosureSelection, setDisclosureSelection] =
    useState<DisclosureSelection | null>(null);
  const [generatedProof, setGeneratedProof] = useState<ZKProof | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { submitProof, isVerifying } = useVerification();
  const { generateProof, proofStatus } = useProof();
  const disclosedAttributes = disclosureSelection?.disclosed ?? [];
  const zkProvedAttributes = disclosureSelection?.zkProved ?? [];

  const currentStepIndex = FLOW_STEPS.indexOf(currentStep);

  const handleDisclosureComplete = useCallback(
    (selection: DisclosureSelection) => {
      setDisclosureSelection(selection);
      setCurrentStep("generate-proof");
      setError(null);
    },
    [],
  );

  const handleProofGenerated = useCallback((proof: ZKProof) => {
    setGeneratedProof(proof);
    setCurrentStep("submit-proof");
    setError(null);
  }, []);

  const handleSubmitProof = useCallback(async () => {
    if (!generatedProof || !request) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const verificationResult = await submitProof({
        proof: generatedProof,
        requestId: request.id,
        disclosedAttributes: disclosureSelection?.disclosed ?? [],
      });
      setResult(verificationResult);
      setCurrentStep("result");
      onComplete?.(verificationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proof submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [generatedProof, request, disclosureSelection, submitProof, onComplete]);

  const handleReset = useCallback(() => {
    setCurrentStep("select-attributes");
    setDisclosureSelection(null);
    setGeneratedProof(null);
    setResult(null);
    setError(null);
  }, []);

  const goBack = useCallback(() => {
    const idx = FLOW_STEPS.indexOf(currentStep);
    if (idx > 0) {
      setCurrentStep(FLOW_STEPS[idx - 1]);
      setError(null);
    }
  }, [currentStep]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl shield-gradient flex items-center justify-center">
          <Fingerprint className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            Identity Verification
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {request?.verifierName
              ? `Requested by ${request.verifierName}`
              : "Generate a zero-knowledge proof of your credentials"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          {FLOW_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = step === currentStep;
            return (
              <div key={step} className="flex items-center">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                    ${
                      isCompleted
                        ? "bg-status-verified text-white"
                        : isCurrent
                          ? "bg-brand-500 text-white"
                          : "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]"
                    }
                  `}
                >
                  {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                {idx < FLOW_STEPS.length - 1 && (
                  <div
                    className={`hidden sm:block w-16 md:w-24 h-0.5 mx-2 transition-colors ${
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
        <div className="flex justify-between">
          {FLOW_STEPS.map((step) => (
            <p
              key={step}
              className={`text-xs ${
                step === currentStep
                  ? "text-brand-500 font-medium"
                  : "text-[var(--text-tertiary)]"
              }`}
            >
              {stepLabels[step]}
            </p>
          ))}
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step Content */}
      <div className="min-h-[400px]">
        <AnimatePresence mode="wait">
          {/* Step 1: Selective Disclosure */}
          {currentStep === "select-attributes" && (
            <motion.div
              key="select"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <SelectiveDisclosureBuilder
                requestedAttributes={request?.requestedAttributes ?? []}
                onComplete={handleDisclosureComplete}
              />
            </motion.div>
          )}

          {/* Step 2: Proof Generation */}
          {currentStep === "generate-proof" && disclosureSelection && (
            <motion.div
              key="generate"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <ProofGenerator
                disclosure={disclosureSelection}
                onProofGenerated={handleProofGenerated}
                onError={(err) => setError(err)}
              />
            </motion.div>
          )}

          {/* Step 3: Submit Proof */}
          {currentStep === "submit-proof" && generatedProof && (
            <motion.div
              key="submit"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="card p-6">
                <h3 className="font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-brand-500" />
                  Proof Summary
                </h3>

                {/* Disclosed attributes */}
                <div className="mb-4">
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    Disclosed Attributes
                  </p>
                  <div className="space-y-1.5">
                    {disclosedAttributes.map((attr: CredentialAttribute) => (
                      <div
                        key={attr.key}
                        className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-secondary)] text-sm"
                      >
                        <Eye className="w-3.5 h-3.5 text-status-verified" />
                        <span className="text-[var(--text-secondary)]">
                          {attr.key}:
                        </span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {attr.value}
                        </span>
                      </div>
                    ))}
                    {disclosedAttributes.length === 0 && (
                      <p className="text-sm text-[var(--text-tertiary)]">
                        No attributes directly disclosed
                      </p>
                    )}
                  </div>
                </div>

                {/* ZK-proved attributes */}
                <div className="mb-4">
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    ZK-Proved (Hidden)
                  </p>
                  <div className="space-y-1.5">
                    {zkProvedAttributes.map((attr: CredentialAttribute) => (
                      <div
                        key={attr.key}
                        className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-secondary)] text-sm"
                      >
                        <EyeOff className="w-3.5 h-3.5 text-brand-500" />
                        <span className="text-[var(--text-secondary)]">
                          {attr.key}:
                        </span>
                        <span className="font-mono text-[var(--text-tertiary)]">
                          *****
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Proof hash */}
                <div className="p-3 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">
                    Proof Hash
                  </p>
                  <p className="font-mono text-xs text-[var(--text-primary)] break-all">
                    {generatedProof.hash}
                  </p>
                </div>
              </div>

              {/* Proof generation animation */}
              <motion.div
                className="flex justify-center py-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <div className="relative w-20 h-20">
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-brand-500/30"
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 8,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  />
                  <motion.div
                    className="absolute inset-2 rounded-full border-2 border-identity-chrome/30"
                    animate={{ rotate: -360 }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-brand-500" />
                  </div>
                </div>
              </motion.div>

              <button
                onClick={handleSubmitProof}
                disabled={isSubmitting || isVerifying}
                className="btn-primary w-full"
              >
                {isSubmitting || isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting Proof...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit Proof
                  </>
                )}
              </button>
            </motion.div>
          )}

          {/* Step 4: Result */}
          {currentStep === "result" && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="text-center py-8"
            >
              {result.verified ? (
                <>
                  <motion.div
                    className="w-20 h-20 mx-auto mb-6 rounded-full bg-status-verified/10 flex items-center justify-center"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                  >
                    <CheckCircle2 className="w-10 h-10 text-status-verified" />
                  </motion.div>
                  <motion.h3
                    className="text-xl font-bold text-[var(--text-primary)] mb-2"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    Verification Successful
                  </motion.h3>
                  <motion.p
                    className="text-sm text-[var(--text-secondary)] mb-6 max-w-sm mx-auto"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    Your zero-knowledge proof has been verified. The verifier
                    has received confirmation without accessing your private
                    data.
                  </motion.p>

                  {/* Verified sparkle animation */}
                  <motion.div
                    className="flex justify-center gap-1 mb-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{
                          y: [0, -8, 0],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          delay: i * 0.2,
                        }}
                      >
                        <Sparkles className="w-4 h-4 text-status-verified" />
                      </motion.div>
                    ))}
                  </motion.div>
                </>
              ) : (
                <>
                  <motion.div
                    className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200 }}
                  >
                    <XCircle className="w-10 h-10 text-red-400" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
                    Verification Failed
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-sm mx-auto">
                    {result.reason ??
                      "The proof could not be verified. Please try again."}
                  </p>
                </>
              )}

              {/* Result details */}
              {result.transactionHash && (
                <div className="card p-4 max-w-md mx-auto mb-6">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">
                    Transaction Hash
                  </p>
                  <p className="font-mono text-xs text-[var(--text-primary)] break-all">
                    {result.transactionHash}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <button onClick={handleReset} className="btn-secondary">
                  <RotateCcw className="w-4 h-4" />
                  Start Over
                </button>
                {onCancel && (
                  <button onClick={onCancel} className="btn-ghost">
                    Close
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      {currentStep !== "result" && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-primary)]">
          <button
            onClick={currentStepIndex === 0 ? onCancel : goBack}
            className="btn-ghost"
          >
            <ArrowLeft className="w-4 h-4" />
            {currentStepIndex === 0 ? "Cancel" : "Back"}
          </button>
          <p className="text-xs text-[var(--text-tertiary)]">
            Step {currentStepIndex + 1} of {FLOW_STEPS.length}
          </p>
        </div>
      )}
    </div>
  );
}
