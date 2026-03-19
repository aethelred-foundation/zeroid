// @ts-nocheck
"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Users,
  ArrowUpRight,
  Shield,
  Info,
} from "lucide-react";
import { useGovernance } from "@/hooks/useGovernance";
import type { Proposal } from "@/types";

interface VotingPanelProps {
  proposal: Proposal;
  onVoteSubmitted?: () => void;
}

type VoteChoice = "for" | "against" | "abstain";

const voteConfig: Record<
  VoteChoice,
  {
    label: string;
    icon: typeof ThumbsUp;
    color: string;
    bgColor: string;
    hoverBg: string;
  }
> = {
  for: {
    label: "Vote For",
    icon: ThumbsUp,
    color: "text-status-verified",
    bgColor: "bg-status-verified/10",
    hoverBg: "hover:bg-status-verified/20",
  },
  against: {
    label: "Vote Against",
    icon: ThumbsDown,
    color: "text-status-revoked",
    bgColor: "bg-status-revoked/10",
    hoverBg: "hover:bg-status-revoked/20",
  },
  abstain: {
    label: "Abstain",
    icon: Minus,
    color: "text-[var(--text-tertiary)]",
    bgColor: "bg-[var(--surface-tertiary)]",
    hoverBg: "hover:bg-[var(--surface-tertiary)]",
  },
};

export default function VotingPanel({
  proposal,
  onVoteSubmitted,
}: VotingPanelProps) {
  const [selectedVote, setSelectedVote] = useState<VoteChoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDelegation, setShowDelegation] = useState(false);
  const [delegateAddress, setDelegateAddress] = useState("");

  const {
    vote,
    delegate,
    votingPower,
    delegatedTo,
    isLoading: governanceLoading,
  } = useGovernance();

  const handleSubmitVote = useCallback(async () => {
    if (!selectedVote) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await vote(proposal.id, selectedVote);
      setHasVoted(true);
      onVoteSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedVote, proposal.id, vote, onVoteSubmitted]);

  const handleDelegate = useCallback(async () => {
    if (!delegateAddress) return;
    setError(null);
    try {
      await delegate(delegateAddress);
      setShowDelegation(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delegation failed");
    }
  }, [delegateAddress, delegate]);

  const isActive = proposal.status === "active";

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-[var(--border-primary)]">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Shield className="w-4 h-4 text-brand-500" />
          Cast Your Vote
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Proposal #{proposal.id.slice(0, 8)}
        </p>
      </div>

      {/* Voting power */}
      <div className="p-5 border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
            Your Voting Power
          </span>
          <button
            onClick={() => setShowDelegation(!showDelegation)}
            className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1"
          >
            <ArrowUpRight className="w-3 h-3" />
            Delegate
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-brand-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {votingPower?.toLocaleString() ?? "0"}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">AETH tokens</p>
          </div>
        </div>
        {delegatedTo && (
          <div className="mt-2 flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <Users className="w-3 h-3" />
            Delegated to:{" "}
            <span className="font-mono">
              {delegatedTo.slice(0, 6)}...{delegatedTo.slice(-4)}
            </span>
          </div>
        )}

        {/* Delegation form */}
        <AnimatePresence>
          {showDelegation && (
            <motion.div
              className="mt-4 space-y-3"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="p-3 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)]">
                <div className="flex items-start gap-2 mb-3">
                  <Info className="w-3.5 h-3.5 text-brand-500 mt-0.5" />
                  <p className="text-xs text-[var(--text-secondary)]">
                    Delegate your voting power to another address. You can
                    reclaim it at any time.
                  </p>
                </div>
                <input
                  type="text"
                  value={delegateAddress}
                  onChange={(e) => setDelegateAddress(e.target.value)}
                  placeholder="0x... delegate address"
                  className="input font-mono text-sm mb-2"
                />
                <button
                  onClick={handleDelegate}
                  className="btn-primary btn-sm w-full"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Delegate Power
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Vote options */}
      <div className="p-5">
        {/* Error */}
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

        {hasVoted ? (
          <motion.div
            className="text-center py-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <motion.div
              className="w-14 h-14 mx-auto mb-3 rounded-full bg-status-verified/10 flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <CheckCircle2 className="w-7 h-7 text-status-verified" />
            </motion.div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Vote Submitted
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              You voted <strong className="capitalize">{selectedVote}</strong>{" "}
              on this proposal.
            </p>
          </motion.div>
        ) : !isActive ? (
          <div className="text-center py-6">
            <p className="text-sm text-[var(--text-tertiary)]">
              Voting is not active for this proposal.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {(
              Object.entries(voteConfig) as [
                VoteChoice,
                typeof voteConfig.for,
              ][]
            ).map(([choice, config]) => {
              const Icon = config.icon;
              const isSelected = selectedVote === choice;
              return (
                <motion.button
                  key={choice}
                  onClick={() => setSelectedVote(choice)}
                  className={`w-full p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${
                    isSelected
                      ? `${config.bgColor} border-current ${config.color}`
                      : `border-[var(--border-primary)] ${config.hoverBg} text-[var(--text-secondary)]`
                  }`}
                  whileTap={{ scale: 0.98 }}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isSelected
                        ? config.bgColor
                        : "bg-[var(--surface-secondary)]"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 ${isSelected ? config.color : ""}`}
                    />
                  </div>
                  <span className="font-medium text-sm">{config.label}</span>
                  {isSelected && (
                    <motion.div
                      className="ml-auto"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300 }}
                    >
                      <CheckCircle2 className={`w-5 h-5 ${config.color}`} />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}

            <button
              onClick={handleSubmitVote}
              disabled={!selectedVote || isSubmitting}
              className="btn-primary w-full mt-4"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting Vote...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4" />
                  Submit Vote
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
