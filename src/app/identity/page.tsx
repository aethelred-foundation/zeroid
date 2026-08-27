"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Copy,
  Database,
  ExternalLink,
  FileCheck2,
  Hash,
  Key,
  Link2,
  Shield,
  UserPlus,
} from "lucide-react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import AppLayout from "@/components/layout/AppLayout";
import IdentityCard from "@/components/identity/IdentityCard";
import IdentityCreation from "@/components/identity/IdentityCreation";
import { activeChain } from "@/config/chains";
import { useIdentity } from "@/hooks/useIdentity";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null;
}

function getDidUri(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  const record = asRecord(value);
  return typeof record?.uri === "string" && record.uri.trim().length > 0
    ? record.uri
    : null;
}

function isNonZeroHash(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(value) &&
    !/^0x0{64}$/i.test(value)
  );
}

function displayCount(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString()
    : "Unavailable";
}

function displayDate(value: unknown): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return "Unavailable";
  }

  const raw =
    typeof value === "number" && value > 0 && value < 10_000_000_000
      ? value * 1_000
      : value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function displayRegistryStatus(value: unknown): string {
  if (typeof value === "number") {
    return (
      ["Inactive", "Active", "Suspended", "Revoked"][value] ?? "Unavailable"
    );
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Unavailable";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function currentEvidenceLabel(value: unknown): string {
  if (value === true) return "Current evidence returned";
  if (value === false) return "No current evidence";
  return "Evidence unavailable";
}

function getExplorerUrl(address: string | undefined): string | null {
  const explorer = (
    activeChain as {
      blockExplorers?: { default?: { url?: string } };
    }
  ).blockExplorers?.default?.url;
  if (!explorer || !address) return null;
  return `${explorer.replace(/\/$/, "")}/address/${address}`;
}

function EvidenceRow({
  label,
  value,
  confirmed = false,
}: {
  label: string;
  value: string;
  confirmed?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[var(--border-primary)] last:border-0">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span
        className={`text-sm font-medium text-right ${
          confirmed ? "text-status-verified" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function IdentityPage() {
  const { address, isConnected } = useAccount();
  const { identity, isLoading, error } = useIdentity();
  const [showCreation, setShowCreation] = useState(false);

  const identityRecord = asRecord(identity);
  const profile = asRecord(identityRecord?.profile);
  const did = getDidUri(identityRecord?.did) ?? getDidUri(profile?.did) ?? null;
  const hasOnChainIdentity =
    identityRecord?.hasIdentity === true &&
    isNonZeroHash(identityRecord.didHash);
  const explorerUrl = hasOnChainIdentity ? getExplorerUrl(address) : null;
  const notRegistered = !profile && !hasOnChainIdentity;

  const copyDID = async () => {
    if (!did) return;
    try {
      await navigator.clipboard.writeText(did);
      toast.success("DID copied to clipboard");
    } catch {
      toast.error("DID could not be copied");
    }
  };

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md">
            <Shield className="w-16 h-16 mx-auto mb-4 text-[var(--text-tertiary)]" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-[var(--text-secondary)]">
              Connect the controller wallet to load its ZeroID registry record.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div
          className="flex items-center justify-center min-h-[60vh]"
          role="status"
        >
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-brand-500/20 border-t-brand-500 animate-spin" />
            <p className="text-sm text-[var(--text-secondary)]">
              Loading identity evidence…
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="card max-w-lg p-6 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto mb-4 text-status-revoked" />
            <h2 className="text-xl font-semibold mb-2">
              Identity Evidence Unavailable
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {error.message ||
                "ZeroID could not load the registry and profile evidence."}
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (notRegistered && !showCreation) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center max-w-md"
          >
            <div className="w-24 h-24 mx-auto mb-6 shield-gradient rounded-3xl flex items-center justify-center identity-glow">
              <UserPlus className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Create Your Identity</h2>
            <p className="text-[var(--text-secondary)] mb-6">
              Register an address-bound DID with a wallet signature and a
              confirmed identity-registry transaction.
            </p>
            <button
              onClick={() => setShowCreation(true)}
              className="btn-primary btn-lg"
            >
              <Key className="w-5 h-5" />
              Create ZeroID
            </button>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  if (showCreation) {
    return (
      <AppLayout>
        <IdentityCreation />
      </AppLayout>
    );
  }

  const credentialCount =
    identityRecord?.credentialCount ?? profile?.credentialCount;
  const verificationCount =
    identityRecord?.verificationCount ?? profile?.verificationCount;
  const createdAt = identityRecord?.createdAt ?? profile?.createdAt;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Identity</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Registry state and verification evidence returned for the connected
            controller wallet.
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5">
            <IdentityCard />
          </div>

          <div className="col-span-12 lg:col-span-7 space-y-6">
            <section className="card p-6" aria-labelledby="identity-record">
              <div className="flex items-center gap-3 mb-6">
                <div className="icon-chip icon-chip-sm">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="identity-record" className="font-semibold">
                    Identity record
                  </h2>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    Values below are returned by the ZeroID API or registry
                    read.
                  </p>
                </div>
              </div>

              <div className="mb-5">
                <label className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                  Decentralized Identifier
                </label>
                <div className="mt-1.5 flex items-center gap-2 p-3 bg-[var(--surface-secondary)] rounded-xl">
                  <Hash className="w-4 h-4 text-brand-500 shrink-0" />
                  <code className="text-sm font-mono truncate flex-1">
                    {did ?? "Unavailable"}
                  </code>
                  <button
                    type="button"
                    onClick={copyDID}
                    disabled={!did}
                    aria-label="Copy DID"
                    className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
                  </button>
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open controller in Aethelred Explorer"
                      className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] transition-colors"
                    >
                      <ExternalLink className="w-4 h-4 text-[var(--text-tertiary)]" />
                    </a>
                  ) : null}
                </div>
              </div>

              <EvidenceRow
                label="Registry lifecycle status"
                value={displayRegistryStatus(profile?.status)}
                confirmed={
                  profile?.status === "ACTIVE" || profile?.status === 1
                }
              />
              <EvidenceRow label="Created" value={displayDate(createdAt)} />
              <EvidenceRow
                label="Credential records"
                value={displayCount(credentialCount)}
              />
              <EvidenceRow
                label="Verification records"
                value={displayCount(verificationCount)}
              />
            </section>

            <section className="card p-6" aria-labelledby="identity-evidence">
              <div className="flex items-center gap-3 mb-4">
                <div className="icon-chip icon-chip-sm">
                  <FileCheck2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="identity-evidence" className="font-semibold">
                    Current evidence
                  </h2>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    No verification state is inferred when evidence is absent.
                  </p>
                </div>
              </div>

              <EvidenceRow
                label="TEE attestation"
                value={currentEvidenceLabel(profile?.teeAttested)}
                confirmed={profile?.teeAttested === true}
              />
              <EvidenceRow
                label="Government verification"
                value={currentEvidenceLabel(profile?.governmentVerified)}
                confirmed={profile?.governmentVerified === true}
              />

              <div
                className={`mt-5 p-4 rounded-xl border ${
                  hasOnChainIdentity
                    ? "bg-brand-600/5 border-brand-500/20"
                    : "bg-status-pending/5 border-status-pending/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  {hasOnChainIdentity ? (
                    <BadgeCheck className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
                  ) : (
                    <Link2 className="w-5 h-5 text-status-pending shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-sm font-medium">
                      {hasOnChainIdentity
                        ? "On-chain registration confirmed"
                        : "On-chain registration not confirmed"}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1">
                      {hasOnChainIdentity
                        ? "The configured identity registry returned a non-zero DID hash for this controller."
                        : "ZeroID did not receive a non-zero DID hash from the configured identity registry."}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
