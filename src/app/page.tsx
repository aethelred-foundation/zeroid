"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  Key,
  Fingerprint,
  EyeOff,
  ArrowRight,
  ArrowUpRight,
  FileCheck,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Zap,
  BarChart3,
  Bot,
} from "lucide-react";
import { useAccount } from "wagmi";
import AppLayout from "@/components/layout/AppLayout";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import IdentityCard from "@/components/identity/IdentityCard";
import { useIdentity } from "@/hooks/useIdentity";
import { useCredentials } from "@/hooks/useCredentials";
import { useVerification } from "@/hooks/useVerification";

const stagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function DashboardPage() {
  const { isConnected } = useAccount();
  const { identity } = useIdentity();
  const credentialsQuery = useCredentials();
  const credentials = credentialsQuery.data?.credentials ?? [];
  const { verificationHistory } = useVerification();

  const stats = {
    totalCredentials: credentials.length,
    activeCredentials: credentials.filter(
      (credential) => credential.status === "active",
    ).length,
    verificationsToday:
      verificationHistory?.filter(
        (v: any) =>
          new Date(v.timestamp).toDateString() === new Date().toDateString(),
      ).length ?? 0,
    totalVerifications: verificationHistory?.length ?? 0,
  };

  // Activity is derived from the user's real credentials and verification
  // history — the dashboard shows nothing it cannot back with data. A fresh
  // account renders the empty state instead of sample records.
  const recentActivity: Array<{
    id: string;
    title: string;
    description: string;
    timestamp: Date | null;
    status: "verified" | "pending" | "revoked" | "expired" | "active";
    icon: typeof ShieldCheck;
  }> = [
    ...credentials.map((credential, i: number) => ({
      id: `cred-${credential.id ?? i}`,
      title: credential.typeLabel,
      description: `Issuer record: ${credential.issuerId}`,
      timestamp: toDate(credential.issuedAt),
      status: normalizeActivityStatus(credential.status),
      icon: ShieldCheck,
    })),
    ...(verificationHistory ?? []).map((v: any, i: number) => ({
      id: `verif-${v.id ?? i}`,
      title: v.proofType ? `${v.proofType} verification` : "Verification",
      description: v.verifier
        ? `Verifier: ${v.verifier}`
        : "Proof verification",
      timestamp: toDate(v.timestamp),
      status: normalizeActivityStatus(v.status),
      icon: Fingerprint,
    })),
  ]
    .sort(
      (a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0),
    )
    .slice(0, 6);

  // ================================================================
  // WELCOME STATE — Not Connected
  // ================================================================
  if (!isConnected) {
    return (
      <AppLayout>
        <div className="relative flex items-center justify-center min-h-[85vh]">
          {/* Ambient chrome glow */}
          <div
            className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse, rgba(192, 196, 204, 0.04) 0%, transparent 60%)",
              filter: "blur(80px)",
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative text-center max-w-2xl z-10"
          >
            {/* Logo with breathing glow */}
            <motion.div
              className="relative mx-auto w-56 h-56 mb-6"
              animate={{
                filter: [
                  "drop-shadow(0 0 24px rgba(192,196,204,0.06))",
                  "drop-shadow(0 0 50px rgba(192,196,204,0.18))",
                  "drop-shadow(0 0 24px rgba(192,196,204,0.06))",
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/zeroid-logo.png"
                alt="ZeroID"
                width={224}
                height={224}
                className="w-full h-full object-contain rounded-[2rem]"
                priority
              />
            </motion.div>

            {/* Title */}
            <h1 className="text-display-xl font-display mb-5 text-gradient-hero leading-none">
              Welcome to ZeroID
            </h1>

            {/* Subtitle */}
            <p className="text-zero-400 text-[17px] mb-16 max-w-lg mx-auto leading-relaxed text-balance font-body">
              Self-sovereign identity with zero-knowledge proofs. Prove who you
              are without revealing what you are.
            </p>

            {/* Feature cards — bento style */}
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-3 gap-4 mb-16"
            >
              {[
                {
                  icon: EyeOff,
                  label: "Private by Default",
                  desc: "ZK selective disclosure protects your data",
                },
                {
                  icon: Lock,
                  label: "On-Chain Anchored",
                  desc: "Credentials anchored on the Aethelred network",
                },
                {
                  icon: Key,
                  label: "Self-Sovereign",
                  desc: "You own and control your identity",
                },
              ].map((f) => (
                <motion.div
                  key={f.label}
                  variants={fadeUp}
                  className="group bento p-6 text-left"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{
                      background: "rgba(192,196,204,0.06)",
                      border: "1px solid rgba(192,196,204,0.08)",
                    }}
                  >
                    <f.icon className="w-5 h-5 text-chrome-300" />
                  </div>
                  <div className="font-semibold text-[14px] text-white font-display mb-1">
                    {f.label}
                  </div>
                  <div className="text-[12px] text-zero-500 font-body leading-relaxed">
                    {f.desc}
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center justify-center gap-3 text-[12px] text-zero-500 font-body"
            >
              <div
                className="w-12 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.06))",
                }}
              />
              Connect your wallet to get started
              <div
                className="w-12 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.06), transparent)",
                }}
              />
            </motion.div>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  // ================================================================
  // CONNECTED DASHBOARD — Bento Grid Layout
  // ================================================================
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-end justify-between pt-1">
          <div>
            <h1 className="text-display-md font-display tracking-tight text-white">
              Dashboard
            </h1>
            <p className="text-zero-500 mt-1.5 text-[13px] font-body">
              Your identity at a glance
            </p>
          </div>
        </div>

        {/* Bento Grid — Row 1: Metrics strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Every metric is computed from the account's real data — no sample
              trends or invented network stats. Explicit per-card animation:
              variant propagation through the stagger container proved
              unreliable on the connect→dashboard mount path. */}
          {[
            {
              label: "Active Credentials",
              value: stats.activeCredentials,
              icon: <ShieldCheck className="w-[18px] h-[18px]" />,
            },
            {
              label: "Total Credentials",
              value: stats.totalCredentials,
              icon: <FileCheck className="w-[18px] h-[18px]" />,
            },
            {
              label: "Verifications Today",
              value: stats.verificationsToday,
              icon: <CheckCircle2 className="w-[18px] h-[18px]" />,
            },
            {
              label: "Total Verifications",
              value: stats.totalVerifications,
              icon: <Fingerprint className="w-[18px] h-[18px]" />,
            },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.1 + i * 0.07,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <MetricCard label={m.label} value={m.value} icon={m.icon} />
            </motion.div>
          ))}
        </div>

        {/* Bento Grid — Row 2: Identity + Quick Actions */}
        <div className="grid grid-cols-12 gap-4">
          {/* Identity Card — Hero element */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-12 lg:col-span-7"
          >
            <IdentityCard />
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="col-span-12 lg:col-span-5"
          >
            <div className="bento p-6 h-full">
              <div className="flex items-center justify-between mb-5">
                <p className="text-label-sm text-zero-500 uppercase font-body">
                  Quick Actions
                </p>
                <Zap className="w-3.5 h-3.5 text-zero-600" />
              </div>

              <div className="space-y-2">
                {[
                  {
                    icon: ShieldCheck,
                    label: "Request Credential",
                    desc: "Request a verifiable credential",
                    href: "/credentials",
                    color: "emerald",
                  },
                  {
                    icon: ClipboardCheck,
                    label: "Run Eligibility Proof",
                    desc: "Issue policy receipt",
                    href: "/eligibility",
                    color: "emerald",
                  },
                  {
                    icon: Bot,
                    label: "Register AI Agent",
                    desc: "Deploy autonomous identity",
                    href: "/agent-identity",
                    color: "chrome",
                  },
                  {
                    icon: BarChart3,
                    label: "View Analytics",
                    desc: "Privacy insights",
                    href: "/analytics",
                    color: "chrome",
                  },
                ].map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-center gap-3.5 p-3 rounded-2xl transition-all duration-300 group hover:bg-white/[0.03]"
                    style={{ border: "1px solid transparent" }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105"
                      style={{
                        background:
                          action.color === "emerald"
                            ? "rgba(52,211,153,0.06)"
                            : "rgba(192,196,204,0.06)",
                        border: `1px solid ${action.color === "emerald" ? "rgba(52,211,153,0.1)" : "rgba(192,196,204,0.08)"}`,
                      }}
                    >
                      <action.icon
                        className={`w-[17px] h-[17px] ${action.color === "emerald" ? "text-emerald-400" : "text-chrome-300"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13px] text-zero-200 group-hover:text-white transition-colors font-body">
                        {action.label}
                      </div>
                      <div className="text-[11px] text-zero-500 font-body">
                        {action.desc}
                      </div>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-zero-700 group-hover:text-chrome-400 transition-all shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bento Grid — Row 3: Activity */}
        <div className="grid grid-cols-12 gap-4">
          {/* Activity Feed — real credentials + verifications only */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="col-span-12"
          >
            <div className="bento">
              <div
                className="p-6 flex items-center justify-between"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                <h2 className="text-heading-sm font-display">
                  Recent Activity
                </h2>
                <Link
                  href="/audit"
                  className="text-[12px] text-zero-500 hover:text-chrome-300 transition-colors flex items-center gap-1.5 font-body"
                >
                  View All <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {recentActivity.length === 0 && (
                <div className="px-6 py-12 text-center">
                  <Shield className="w-7 h-7 text-zero-600 mx-auto mb-3" />
                  <p className="text-[13px] text-zero-400 font-body">
                    No activity yet
                  </p>
                  <p className="text-[11px] text-zero-500 font-body mt-1">
                    Create your identity and request a credential — your real
                    issuance and verification events appear here.
                  </p>
                </div>
              )}

              <div>
                {recentActivity.map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.07 }}
                    className="px-6 py-4 flex items-center gap-4 transition-colors hover:bg-white/[0.015] group"
                    style={{
                      borderBottom:
                        i < recentActivity.length - 1
                          ? "1px solid rgba(255,255,255,0.03)"
                          : "none",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105"
                      style={{
                        background:
                          a.status === "verified"
                            ? "rgba(52, 211, 153, 0.06)"
                            : "rgba(251, 191, 36, 0.06)",
                        border: `1px solid ${a.status === "verified" ? "rgba(52, 211, 153, 0.1)" : "rgba(251, 191, 36, 0.1)"}`,
                      }}
                    >
                      <a.icon
                        className={`w-[17px] h-[17px] ${a.status === "verified" ? "text-emerald-400" : "text-amber-400"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13px] text-zero-200 font-body">
                        {a.title}
                      </div>
                      <div className="text-[11px] text-zero-500 truncate font-body mt-0.5">
                        {a.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusBadge status={a.status} size="sm" />
                      <span className="text-[10px] text-zero-600 whitespace-nowrap font-mono">
                        {a.timestamp ? formatTimeAgo(a.timestamp) : "—"}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Accepts Unix seconds, Unix milliseconds, or an ISO string. */
function toDate(ts: unknown): Date | null {
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
    return new Date(ts < 1e12 ? ts * 1000 : ts);
  }
  if (typeof ts === "string" && ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Collapse backend/legacy status strings onto the StatusBadge vocabulary. */
function normalizeActivityStatus(
  status: unknown,
): "verified" | "pending" | "revoked" | "expired" | "active" {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (s === "verified" || s === "completed") return "verified";
  if (s === "active") return "active";
  if (s === "revoked" || s === "rejected" || s === "failed") return "revoked";
  if (s === "expired") return "expired";
  return "pending";
}
