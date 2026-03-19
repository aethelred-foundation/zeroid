"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldCheck,
  Key,
  Fingerprint,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowUpRight,
  Users,
  FileCheck,
  CheckCircle2,
  Lock,
  Globe,
  Server,
  Zap,
  BarChart3,
  Bot,
  Cpu,
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
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d">("7d");

  const stats = {
    totalCredentials: credentials.length,
    activeCredentials: credentials.filter((c: any) => c.status === "active")
      .length,
    verificationsToday:
      verificationHistory?.filter(
        (v: any) =>
          new Date(v.timestamp).toDateString() === new Date().toDateString(),
      ).length ?? 0,
    zkProofsGenerated: verificationHistory?.length ?? 0,
  };

  const recentActivity = [
    {
      id: "1",
      title: "Age Verification Credential",
      description: "Issued by UAE Pass TEE Node",
      timestamp: new Date(Date.now() - 3600000),
      status: "verified" as const,
      icon: ShieldCheck,
    },
    {
      id: "2",
      title: "ZK Age Proof Generated",
      description: "Proved age >= 18 without revealing DOB",
      timestamp: new Date(Date.now() - 7200000),
      status: "verified" as const,
      icon: Eye,
    },
    {
      id: "3",
      title: "Residency Verification Request",
      description: "From Aethelred DeFi Protocol",
      timestamp: new Date(Date.now() - 14400000),
      status: "pending" as const,
      icon: Globe,
    },
    {
      id: "4",
      title: "Credit Tier Credential Renewed",
      description: "Auto-renewed via TEE re-verification",
      timestamp: new Date(Date.now() - 86400000),
      status: "verified" as const,
      icon: FileCheck,
    },
  ];

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
                  label: "TEE Secured",
                  desc: "Hardware-verified credential issuance",
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
          <div
            className="flex items-center gap-1 p-1 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {(["24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all font-body ${
                  timeRange === r
                    ? "text-white"
                    : "text-zero-500 hover:text-zero-300"
                }`}
                style={
                  timeRange === r
                    ? {
                        background: "rgba(192,196,204,0.1)",
                        boxShadow: "0 0 0 1px rgba(192,196,204,0.08)",
                      }
                    : {}
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Bento Grid — Row 1: Metrics strip */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {[
            {
              label: "Active Credentials",
              value: stats.activeCredentials,
              icon: <ShieldCheck className="w-[18px] h-[18px]" />,
              trend: { direction: "up" as const, value: "+2" },
            },
            {
              label: "Verifications",
              value: stats.verificationsToday,
              icon: <CheckCircle2 className="w-[18px] h-[18px]" />,
              trend: { direction: "up" as const, value: "+12%" },
            },
            {
              label: "ZK Proofs",
              value: stats.zkProofsGenerated,
              icon: <Fingerprint className="w-[18px] h-[18px]" />,
              trend: { direction: "up" as const, value: "156" },
            },
            {
              label: "TEE Nodes",
              value: 8,
              icon: <Server className="w-[18px] h-[18px]" />,
              trend: { direction: "up" as const, value: "99.97%" },
            },
          ].map((m) => (
            <motion.div key={m.label} variants={fadeUp}>
              <MetricCard
                label={m.label}
                value={m.value}
                icon={m.icon}
                trend={m.trend}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Bento Grid — Row 2: Identity + Privacy + Quick Actions */}
        <div className="grid grid-cols-12 gap-4">
          {/* Identity Card — Hero element */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-12 lg:col-span-5"
          >
            <IdentityCard />
          </motion.div>

          {/* Privacy Score */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="col-span-12 sm:col-span-6 lg:col-span-3"
          >
            <div className="bento p-6 h-full flex flex-col">
              <p className="text-label-sm text-zero-500 uppercase mb-5 font-body">
                Privacy Score
              </p>

              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="relative w-28 h-28 mb-4">
                  <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke="rgba(255,255,255,0.03)"
                      strokeWidth="4"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke="url(#privGrad)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray="264"
                      strokeDashoffset="26"
                      className="proof-ring"
                    />
                    <defs>
                      <linearGradient
                        id="privGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop offset="0%" stopColor="#34d399" />
                        <stop offset="100%" stopColor="#c0c4cc" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[32px] font-bold text-white font-display leading-none">
                      90
                    </span>
                    <span className="text-[10px] text-zero-500 font-body mt-1">
                      / 100
                    </span>
                  </div>
                </div>

                <div className="text-center">
                  <span className="text-emerald-400 text-[13px] font-semibold font-body">
                    Excellent
                  </span>
                  <p className="text-[11px] text-zero-500 mt-1 font-body leading-relaxed max-w-[160px]">
                    All verifications use ZK proofs
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="col-span-12 sm:col-span-6 lg:col-span-4"
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
                    desc: "Get verified via TEE",
                    href: "/credentials",
                    color: "emerald",
                  },
                  {
                    icon: Fingerprint,
                    label: "Generate ZK Proof",
                    desc: "Prove without revealing",
                    href: "/verification",
                    color: "chrome",
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

        {/* Bento Grid — Row 3: Activity + TEE Network */}
        <div className="grid grid-cols-12 gap-4">
          {/* Activity Feed */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="col-span-12 lg:col-span-8"
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
                        {formatTimeAgo(a.timestamp)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* TEE Network Status */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.5 }}
            className="col-span-12 lg:col-span-4"
          >
            <div className="bento p-6 h-full">
              <div className="flex items-center justify-between mb-5">
                <p className="text-label-sm text-zero-500 uppercase font-body">
                  TEE Network
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-[5px] w-[5px]">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-[5px] w-[5px] bg-emerald-500" />
                  </span>
                  <span className="text-[11px] text-emerald-400 font-medium font-body">
                    Healthy
                  </span>
                </div>
              </div>

              {/* Network visualization */}
              <div className="w-full aspect-square max-w-[180px] mx-auto mb-6 relative">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "rgba(52,211,153,0.03)",
                    border: "1px solid rgba(52,211,153,0.06)",
                  }}
                />
                <div
                  className="absolute inset-4 rounded-full"
                  style={{
                    background: "rgba(52,211,153,0.04)",
                    border: "1px solid rgba(52,211,153,0.08)",
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <Cpu className="w-6 h-6 text-emerald-400 mx-auto mb-1.5" />
                    <span className="text-[20px] font-bold text-white font-display leading-none">
                      8
                    </span>
                    <p className="text-[9px] text-zero-500 font-body mt-0.5 uppercase tracking-wider">
                      Active Nodes
                    </p>
                  </div>
                </div>
                {/* Orbiting dots */}
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                  <motion.div
                    key={deg}
                    className="absolute w-2 h-2 rounded-full bg-emerald-400"
                    style={{
                      top: `${50 + 42 * Math.sin((deg * Math.PI) / 180)}%`,
                      left: `${50 + 42 * Math.cos((deg * Math.PI) / 180)}%`,
                      transform: "translate(-50%, -50%)",
                      boxShadow: "0 0 8px rgba(52,211,153,0.4)",
                    }}
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                      duration: 3,
                      delay: deg / 360,
                      repeat: Infinity,
                    }}
                  />
                ))}
              </div>

              <div className="space-y-3">
                {[
                  { label: "SGX Enclaves", value: "5/5" },
                  { label: "SEV Nodes", value: "3/3" },
                  { label: "Avg Attestation", value: "1.2s" },
                  { label: "Queue Depth", value: "12" },
                ].map((n) => (
                  <div
                    key={n.label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-[12px] text-zero-500 font-body">
                      {n.label}
                    </span>
                    <span className="text-[12px] font-semibold text-zero-300 font-mono">
                      {n.value}
                    </span>
                  </div>
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
