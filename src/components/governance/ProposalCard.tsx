// @ts-nocheck
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  Clock,
  CheckCircle2,
  XCircle,
  Timer,
  Users,
  ArrowRight,
  MessageSquare,
} from "lucide-react";
import type { Proposal, ProposalStatus } from "@/types";

interface ProposalCardProps {
  proposal: Proposal;
  onVote?: (proposalId: string, vote: "for" | "against" | "abstain") => void;
  onViewDetails?: (proposalId: string) => void;
}

const statusConfig: Record<
  ProposalStatus,
  { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
  active: {
    label: "Active",
    color: "text-status-verified",
    bgColor: "bg-status-verified/10",
    icon: Timer,
  },
  pending: {
    label: "Pending",
    color: "text-status-pending",
    bgColor: "bg-status-pending/10",
    icon: Clock,
  },
  passed: {
    label: "Passed",
    color: "text-status-verified",
    bgColor: "bg-status-verified/10",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    color: "text-status-revoked",
    bgColor: "bg-status-revoked/10",
    icon: XCircle,
  },
  executed: {
    label: "Executed",
    color: "text-brand-500",
    bgColor: "bg-brand-500/10",
    icon: CheckCircle2,
  },
};

function formatVoteCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function timeRemaining(endTime: string | number): string {
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  return `${hours}h remaining`;
}

export default function ProposalCard({
  proposal,
  onVote,
  onViewDetails,
}: ProposalCardProps) {
  const [hasVoted, setHasVoted] = useState<
    "for" | "against" | "abstain" | null
  >(null);

  const status = statusConfig[proposal.status] ?? statusConfig.pending;
  const StatusIcon = status.icon;

  const totalVotes =
    proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
  const forPercentage =
    totalVotes > 0 ? (proposal.votesFor / totalVotes) * 100 : 0;
  const againstPercentage =
    totalVotes > 0 ? (proposal.votesAgainst / totalVotes) * 100 : 0;
  const abstainPercentage =
    totalVotes > 0 ? (proposal.votesAbstain / totalVotes) * 100 : 0;
  const quorumPercentage =
    proposal.quorum > 0
      ? Math.min((totalVotes / proposal.quorum) * 100, 100)
      : 0;

  const handleVote = (vote: "for" | "against" | "abstain") => {
    setHasVoted(vote);
    onVote?.(proposal.id, vote);
  };

  return (
    <motion.div
      className="card overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-[var(--text-tertiary)]">
                #{proposal.id.slice(0, 8)}
              </span>
              <span
                className={`badge ${status.bgColor} ${status.color} border-0`}
              >
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            </div>
            <h3 className="font-semibold text-[var(--text-primary)] line-clamp-2">
              {proposal.title}
            </h3>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2 mb-4">
          {proposal.description}
        </p>

        {/* Voting progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-1.5">
            <span>Votes</span>
            <span>{formatVoteCount(totalVotes)} total</span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--surface-tertiary)] flex overflow-hidden">
            {forPercentage > 0 && (
              <motion.div
                className="h-full bg-status-verified"
                initial={{ width: 0 }}
                animate={{ width: `${forPercentage}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            )}
            {againstPercentage > 0 && (
              <motion.div
                className="h-full bg-status-revoked"
                initial={{ width: 0 }}
                animate={{ width: `${againstPercentage}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
              />
            )}
            {abstainPercentage > 0 && (
              <motion.div
                className="h-full bg-[var(--text-tertiary)]"
                initial={{ width: 0 }}
                animate={{ width: `${abstainPercentage}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="flex items-center gap-1 text-status-verified">
              <ThumbsUp className="w-3 h-3" />
              {forPercentage.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1 text-status-revoked">
              <ThumbsDown className="w-3 h-3" />
              {againstPercentage.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
              <Minus className="w-3 h-3" />
              {abstainPercentage.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Quorum progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-1">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              Quorum
            </span>
            <span>{quorumPercentage.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-tertiary)] overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                quorumPercentage >= 100 ? "bg-status-verified" : "bg-brand-500"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${quorumPercentage}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Time remaining */}
        {proposal.endTime && (
          <p className="text-xs text-[var(--text-tertiary)] flex items-center gap-1 mb-4">
            <Clock className="w-3 h-3" />
            {timeRemaining(proposal.endTime)}
          </p>
        )}

        {/* Vote buttons */}
        {proposal.status === "active" && !hasVoted && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleVote("for")}
              className="btn-sm flex-1 btn bg-status-verified/10 text-status-verified hover:bg-status-verified/20 border border-status-verified/20"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              For
            </button>
            <button
              onClick={() => handleVote("against")}
              className="btn-sm flex-1 btn bg-status-revoked/10 text-status-revoked hover:bg-status-revoked/20 border border-status-revoked/20"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              Against
            </button>
            <button
              onClick={() => handleVote("abstain")}
              className="btn-sm flex-1 btn-secondary"
            >
              <Minus className="w-3.5 h-3.5" />
              Abstain
            </button>
          </div>
        )}

        {hasVoted && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-brand-500/5 text-sm">
            <CheckCircle2 className="w-4 h-4 text-brand-500" />
            <span className="text-[var(--text-secondary)]">
              You voted{" "}
              <strong className="text-[var(--text-primary)] capitalize">
                {hasVoted}
              </strong>
            </span>
          </div>
        )}

        {/* View details */}
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(proposal.id)}
            className="btn-ghost w-full mt-3 text-sm"
          >
            View Details
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
