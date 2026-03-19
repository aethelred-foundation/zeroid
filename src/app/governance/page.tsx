"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Vote,
  Plus,
  TrendingUp,
  Users,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Shield,
  BarChart3,
  Filter,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import ProposalCard from "@/components/governance/ProposalCard";
import VotingPanel from "@/components/governance/VotingPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { useGovernance } from "@/hooks/useGovernance";

type ProposalFilter = "all" | "active" | "passed" | "rejected" | "pending";

export default function GovernancePage() {
  const { proposals, votingPower, isLoading } = useGovernance();
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filteredProposals = (proposals ?? []).filter((p: any) => {
    if (filter === "all") return true;
    return p.status === filter;
  });

  const stats = {
    totalProposals: proposals?.length ?? 0,
    activeProposals:
      proposals?.filter((p: any) => p.status === "active").length ?? 0,
    passRate: proposals?.length
      ? Math.round(
          (proposals.filter((p: any) => p.status === "passed").length /
            proposals.length) *
            100,
        )
      : 0,
    totalVoters: 342,
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Governance</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Vote on credential schemas, trusted issuers, and protocol
              parameters
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Create Proposal
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Your Voting Power"
            value={votingPower ?? 0}
            icon={<Vote className="w-5 h-5" />}
            iconColor="text-brand-500"
            subtitle="AETH staked"
          />
          <MetricCard
            label="Active Proposals"
            value={stats.activeProposals}
            icon={<FileText className="w-5 h-5" />}
            iconColor="text-status-pending"
            trend={{ direction: "up", value: "Voting open" }}
          />
          <MetricCard
            label="Pass Rate"
            value={`${stats.passRate}%`}
            icon={<TrendingUp className="w-5 h-5" />}
            iconColor="text-status-verified"
            subtitle={`of ${stats.totalProposals} proposals`}
          />
          <MetricCard
            label="Total Voters"
            value={stats.totalVoters}
            icon={<Users className="w-5 h-5" />}
            iconColor="text-identity-chrome"
            trend={{ direction: "up", value: "+18 this month" }}
          />
        </div>

        {/* Filter + Proposals */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(
            [
              { id: "all" as const, label: "All" },
              { id: "active" as const, label: "Active" },
              { id: "pending" as const, label: "Pending" },
              { id: "passed" as const, label: "Passed" },
              { id: "rejected" as const, label: "Rejected" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                filter === f.id
                  ? "bg-brand-600 text-white"
                  : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Proposals List */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            {filteredProposals.length > 0 ? (
              filteredProposals.map((proposal: any, i: number) => (
                <motion.div
                  key={proposal.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <ProposalCard
                    proposal={proposal}
                    onViewDetails={() => setSelectedProposal(proposal.id)}
                  />
                </motion.div>
              ))
            ) : (
              <div className="card p-12 text-center">
                <Vote className="w-12 h-12 mx-auto mb-3 text-[var(--text-tertiary)]" />
                <h3 className="text-lg font-semibold mb-2">
                  No proposals found
                </h3>
                <p className="text-[var(--text-secondary)]">
                  {filter === "all"
                    ? "Be the first to create a governance proposal"
                    : `No ${filter} proposals`}
                </p>
              </div>
            )}
          </div>

          {/* Voting Panel */}
          <div className="col-span-12 lg:col-span-4">
            {selectedProposal &&
            (proposals ?? []).find((p: any) => p.id === selectedProposal) ? (
              <VotingPanel
                proposal={
                  proposals!.find((p: any) => p.id === selectedProposal)!
                }
                onVoteSubmitted={() => setSelectedProposal(null)}
              />
            ) : (
              <div className="card p-6 text-center">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
                <p className="text-sm text-[var(--text-secondary)]">
                  Select a proposal to vote
                </p>
              </div>
            )}

            {/* Governance Info */}
            <div className="card p-6 mt-4">
              <h3 className="text-sm font-semibold mb-3">
                Governance Parameters
              </h3>
              <div className="space-y-2.5">
                {[
                  { label: "Quorum", value: "10% of total supply" },
                  { label: "Voting Period", value: "7 days" },
                  { label: "Timelock", value: "48 hours" },
                  { label: "Proposal Threshold", value: "100,000 AETH" },
                  { label: "Execution Delay", value: "24 hours" },
                ].map((param) => (
                  <div
                    key={param.label}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-[var(--text-secondary)]">
                      {param.label}
                    </span>
                    <span className="font-medium">{param.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Proposal Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Proposal"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Proposal Type
            </label>
            <select className="input">
              <option>Add Credential Schema</option>
              <option>Add Trusted Issuer</option>
              <option>Remove Trusted Issuer</option>
              <option>Update Protocol Parameter</option>
              <option>Emergency Action</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Title</label>
            <input className="input" placeholder="Proposal title..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Description
            </label>
            <textarea
              className="input min-h-[120px] resize-y"
              placeholder="Describe the proposal and its rationale..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowCreateModal(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button className="btn-primary">
              <FileText className="w-4 h-4" />
              Submit Proposal
            </button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
