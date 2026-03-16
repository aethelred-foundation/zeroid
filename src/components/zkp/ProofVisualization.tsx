'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ShieldCheck,
  Hash,
  Copy,
  Clock,
  Fingerprint,
} from 'lucide-react';
import type { ZKProof } from '@/types';

interface ProofVisualizationProps {
  proof: ZKProof;
  isVerifying?: boolean;
  isVerified?: boolean;
  showDetails?: boolean;
}

export default function ProofVisualization({
  proof,
  isVerifying = false,
  isVerified = false,
  showDetails = true,
}: ProofVisualizationProps) {
  const [copied, setCopied] = useState(false);
  const [ringProgress, setRingProgress] = useState(0);

  useEffect(() => {
    if (isVerifying) {
      setRingProgress(0);
      const interval = setInterval(() => {
        setRingProgress((prev) => Math.min(prev + 2, 95));
      }, 50);
      return () => clearInterval(interval);
    }
    if (isVerified) {
      setRingProgress(100);
    }
  }, [isVerifying, isVerified]);

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(proof.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (ringProgress / 100) * circumference;

  return (
    <div className="card p-6 space-y-6">
      {/* Animated ring */}
      <div className="flex justify-center">
        <div className="relative w-32 h-32">
          {/* Background ring */}
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="var(--border-primary)"
              strokeWidth="3"
            />
            {/* Progress ring */}
            <motion.circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke={isVerified ? '#10b981' : '#4263eb'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-all duration-300"
            />
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              {isVerified ? (
                <motion.div
                  key="verified"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                >
                  <CheckCircle2 className="w-10 h-10 text-status-verified" />
                </motion.div>
              ) : isVerifying ? (
                <motion.div
                  key="verifying"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <ShieldCheck className="w-10 h-10 text-brand-500" />
                </motion.div>
              ) : (
                <motion.div
                  key="static"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <Fingerprint className="w-10 h-10 text-brand-500" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Orbiting dots */}
          {isVerifying && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-brand-500"
                  style={{ top: '50%', left: '50%' }}
                  animate={{
                    x: [0, 50 * Math.cos((i * 2 * Math.PI) / 3), 0],
                    y: [0, 50 * Math.sin((i * 2 * Math.PI) / 3), 0],
                    opacity: [0.3, 1, 0.3],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: i * 0.3,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </>
          )}

          {/* Verification checkmark animation */}
          <AnimatePresence>
            {isVerified && (
              <motion.div
                className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-status-verified flex items-center justify-center shadow-lg"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, delay: 0.5 }}
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Status text */}
      <div className="text-center">
        <p
          className={`text-sm font-semibold ${
            isVerified
              ? 'text-status-verified'
              : isVerifying
                ? 'text-brand-500'
                : 'text-[var(--text-primary)]'
          }`}
        >
          {isVerified ? 'Proof Verified' : isVerifying ? 'Verifying Proof...' : 'ZK Proof'}
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {proof.protocol ?? 'Groth16'} | {proof.curve ?? 'BN254'}
        </p>
      </div>

      {/* Proof details */}
      {showDetails && (
        <div className="space-y-3">
          {/* Hash display */}
          <div className="p-3 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-tertiary)] flex items-center gap-1">
                <Hash className="w-3 h-3" />
                Proof Hash
              </span>
              <button
                onClick={handleCopyHash}
                className="p-1 rounded hover:bg-[var(--surface-tertiary)] transition-colors"
              >
                {copied ? (
                  <CheckCircle2 className="w-3 h-3 text-status-verified" />
                ) : (
                  <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-[var(--text-primary)] break-all leading-relaxed">
              {proof.hash}
            </p>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
              <p className="text-xs text-[var(--text-tertiary)] mb-0.5">Created</p>
              <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {proof.createdAt
                  ? new Date(proof.createdAt).toLocaleTimeString()
                  : '--'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[var(--surface-secondary)]">
              <p className="text-xs text-[var(--text-tertiary)] mb-0.5">Public Inputs</p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {proof.publicInputCount ?? 0}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
