'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet,
  ShieldCheck,
  Fingerprint,
  KeyRound,
  Globe,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ScanFace,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAccount, useConnect } from 'wagmi';
import { useIdentity } from '@/hooks/useIdentity';
import { useUAEPass } from '@/hooks/useUAEPass';
import { useBiometric } from '@/hooks/useBiometric';
import type { IdentityCreationStep } from '@/types';

interface StepConfig {
  id: IdentityCreationStep;
  title: string;
  subtitle: string;
  icon: typeof Wallet;
}

const STEPS: StepConfig[] = [
  {
    id: 'connect-wallet',
    title: 'Connect Wallet',
    subtitle: 'Link your Web3 wallet to anchor your identity',
    icon: Wallet,
  },
  {
    id: 'uae-pass',
    title: 'UAE Pass Verification',
    subtitle: 'Verify your real-world identity via UAE Pass',
    icon: ShieldCheck,
  },
  {
    id: 'biometric',
    title: 'Biometric Scan',
    subtitle: 'Provide biometric data for enhanced security',
    icon: ScanFace,
  },
  {
    id: 'generate-did',
    title: 'Generate DID',
    subtitle: 'Create your decentralized identifier',
    icon: KeyRound,
  },
  {
    id: 'on-chain',
    title: 'On-Chain Registration',
    subtitle: 'Register your identity on the Aethelred network',
    icon: Globe,
  },
];

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

export default function IdentityCreation() {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { createIdentity, registerOnChain } = useIdentity();
  const { initiateVerification: initiateUAEPass, verificationStatus: uaePassStatus } = useUAEPass();
  const { startScan, scanStatus } = useBiometric();

  const goToStep = useCallback(
    (step: number) => {
      setDirection(step > currentStep ? 1 : -1);
      setCurrentStep(step);
    },
    [currentStep]
  );

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      goToStep(currentStep + 1);
    }
  }, [currentStep, goToStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const clearError = useCallback(() => {
    setStepErrors((prev) => {
      const next = { ...prev };
      delete next[currentStep];
      return next;
    });
  }, [currentStep]);

  const handleConnectWallet = useCallback(
    async (connectorId: number) => {
      clearError();
      setIsProcessing(true);
      try {
        const connector = connectors[connectorId];
        if (connector) {
          connect({ connector });
        }
      } catch (err) {
        setStepErrors((prev) => ({
          ...prev,
          0: err instanceof Error ? err.message : 'Failed to connect wallet',
        }));
      } finally {
        setIsProcessing(false);
      }
    },
    [connectors, connect, clearError]
  );

  const handleUAEPass = useCallback(async () => {
    clearError();
    setIsProcessing(true);
    try {
      await initiateUAEPass();
    } catch (err) {
      setStepErrors((prev) => ({
        ...prev,
        1: err instanceof Error ? err.message : 'UAE Pass verification failed',
      }));
    } finally {
      setIsProcessing(false);
    }
  }, [initiateUAEPass, clearError]);

  const handleBiometricScan = useCallback(async () => {
    clearError();
    setIsProcessing(true);
    try {
      await startScan();
    } catch (err) {
      setStepErrors((prev) => ({
        ...prev,
        2: err instanceof Error ? err.message : 'Biometric scan failed',
      }));
    } finally {
      setIsProcessing(false);
    }
  }, [startScan, clearError]);

  const handleGenerateDID = useCallback(async () => {
    clearError();
    setIsProcessing(true);
    try {
      await createIdentity();
    } catch (err) {
      setStepErrors((prev) => ({
        ...prev,
        3: err instanceof Error ? err.message : 'DID generation failed',
      }));
    } finally {
      setIsProcessing(false);
    }
  }, [createIdentity, clearError]);

  const handleOnChainRegistration = useCallback(async () => {
    clearError();
    setIsProcessing(true);
    try {
      await registerOnChain();
    } catch (err) {
      setStepErrors((prev) => ({
        ...prev,
        4: err instanceof Error ? err.message : 'On-chain registration failed',
      }));
    } finally {
      setIsProcessing(false);
    }
  }, [registerOnChain, clearError]);

  const currentError = stepErrors[currentStep];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            {isConnected && address ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-status-verified/10 border border-status-verified/20">
                <CheckCircle2 className="w-5 h-5 text-status-verified flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Wallet Connected</p>
                  <p className="text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {connectors.map((connector, idx) => (
                  <button
                    key={connector.id}
                    onClick={() => handleConnectWallet(idx)}
                    disabled={isProcessing}
                    className="btn-secondary w-full justify-start gap-3"
                  >
                    <Wallet className="w-4 h-4" />
                    {connector.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case 1:
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
                Verify your identity using the UAE Pass system. This links your real-world identity
                to your DID without exposing personal data on-chain.
              </p>
              {uaePassStatus === 'verified' ? (
                <div className="flex items-center justify-center gap-2 text-status-verified">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Verification Complete</span>
                </div>
              ) : uaePassStatus === 'pending' ? (
                <div className="flex items-center justify-center gap-2 text-status-pending">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">Verification in Progress...</span>
                </div>
              ) : (
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
                  Start UAE Pass Verification
                </button>
              )}
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <motion.div
                className="w-20 h-20 mx-auto mb-4 rounded-full shield-gradient flex items-center justify-center"
                animate={
                  scanStatus === 'scanning'
                    ? { scale: [1, 1.1, 1], boxShadow: ['0 0 0 0 rgba(66,99,235,0.4)', '0 0 0 20px rgba(66,99,235,0)', '0 0 0 0 rgba(66,99,235,0.4)'] }
                    : {}
                }
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <ScanFace className="w-10 h-10 text-white" />
              </motion.div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">Biometric Verification</h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                A biometric scan adds an additional layer of identity assurance. Your biometric data
                is processed inside a Trusted Execution Environment and never stored raw.
              </p>
              {scanStatus === 'complete' ? (
                <div className="flex items-center justify-center gap-2 text-status-verified">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Scan Complete</span>
                </div>
              ) : (
                <button
                  onClick={handleBiometricScan}
                  disabled={isProcessing || scanStatus === 'scanning'}
                  className="btn-primary"
                >
                  {scanStatus === 'scanning' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      Start Biometric Scan
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <motion.div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-identity-chrome/10 flex items-center justify-center"
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              >
                <KeyRound className="w-8 h-8 text-identity-chrome" />
              </motion.div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">
                Generate Decentralized Identifier
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Your DID is a globally unique, cryptographically verifiable identifier anchored to the
                Aethelred network. It puts you in full control of your digital identity.
              </p>
              <button
                onClick={handleGenerateDID}
                disabled={isProcessing}
                className="btn-primary"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate DID
                  </>
                )}
              </button>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div className="card p-6 text-center">
              <motion.div
                className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-500/10 flex items-center justify-center"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200 }}
              >
                <Globe className="w-8 h-8 text-brand-500" />
              </motion.div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-2">On-Chain Registration</h4>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Register your DID on the Aethelred blockchain. This creates an immutable record while
                keeping your personal information private through zero-knowledge proofs.
              </p>
              <button
                onClick={handleOnChainRegistration}
                disabled={isProcessing}
                className="btn-primary"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4" />
                    Register On-Chain
                  </>
                )}
              </button>
            </div>
          </div>
        );

    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            const isCompleted = completedSteps.has(idx);
            const isCurrent = idx === currentStep;

            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => isCompleted && goToStep(idx)}
                  disabled={!isCompleted && !isCurrent}
                  className={`
                    relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300
                    ${isCompleted
                      ? 'bg-status-verified border-status-verified text-white cursor-pointer'
                      : isCurrent
                        ? 'border-brand-500 text-brand-500 bg-brand-500/10'
                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] bg-[var(--surface-secondary)]'
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
                      isCompleted ? 'bg-status-verified' : 'bg-[var(--border-primary)]'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">
            {STEPS[currentStep].title}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {STEPS[currentStep].subtitle}
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
            transition={{ duration: 0.3, ease: 'easeInOut' }}
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
          {STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === currentStep ? 'bg-brand-500' : 'bg-[var(--border-primary)]'
              }`}
            />
          ))}
        </div>
        <button
          onClick={handleNext}
          disabled={currentStep === STEPS.length - 1}
          className="btn-primary btn-sm"
        >
          Next
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
