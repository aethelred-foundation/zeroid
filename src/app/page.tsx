"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileCheck,
  Fingerprint,
  History,
  Key,
  Loader2,
  Lock,
  Shield,
  ShieldCheck,
  UserRoundCheck,
  Zap,
} from "lucide-react";
import { useAccount } from "wagmi";
import AppLayout from "@/components/layout/AppLayout";
import { MetricCard } from "@/components/ui/MetricCard";
import { useCredentials } from "@/hooks/useCredentials";
import { useIdentity } from "@/hooks/useIdentity";
import { useVerificationHistory } from "@/hooks/useVerification";
import { getFeatureReadiness } from "@/lib/product/readiness";

type UnknownRecord = Record<string, unknown>;

type ActivityItem = {
  id: string;
  title: string;
  description: string;
  timestamp: Date | null;
  status?: string;
  icon: typeof ShieldCheck;
};

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

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function didValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return stringValue(asRecord(value).uri);
}

function toDate(value: unknown): Date | null {
  let date: Date;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    date = new Date(value > 10_000_000_000 ? value : value * 1000);
  } else if (typeof value === "string" && value.trim()) {
    date = new Date(value);
  } else if (value instanceof Date) {
    date = value;
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstValidDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const date = toDate(value);
    if (date) return date;
  }
  return null;
}

function formatTimestamp(date: Date | null): string {
  if (!date) return "Timestamp unavailable";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanizeCode(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function evidenceLabel(value: unknown): string {
  if (value === true) return "Verified evidence returned";
  if (value === false) return "No verified evidence returned";
  return "Evidence unavailable";
}

export default function DashboardPage() {
  const { isConnected, status: walletStatus, isReconnecting } = useAccount();
  const identityQuery = useIdentity();
  const credentialsQuery = useCredentials();
  const verificationQuery = useVerificationHistory(undefined, 1, 100);
  const readiness = getFeatureReadiness("/");

  const credentials = credentialsQuery.data?.credentials ?? [];
  const verificationRecords = verificationQuery.data?.items ?? [];
  const accessState = credentialsQuery.accessState;
  const protectedSourcesReady =
    accessState === "ready" &&
    credentialsQuery.isSuccess &&
    verificationQuery.isSuccess;
  const protectedSourcesLoading =
    accessState === "ready" &&
    (credentialsQuery.isLoading || verificationQuery.isLoading);
  const protectedSourceErrors = [
    credentialsQuery.error instanceof Error
      ? `Credential records: ${credentialsQuery.error.message}`
      : null,
    verificationQuery.error instanceof Error
      ? `Verification records: ${verificationQuery.error.message}`
      : null,
  ].filter((message): message is string => Boolean(message));

  const activeCredentialCount = credentials.filter(
    (credential) => credential.status === "active",
  ).length;
  const datedVerificationCount = verificationRecords.filter((record) => {
    const raw = asRecord(record);
    return Boolean(firstValidDate(raw.requestedAt, raw.completedAt));
  }).length;

  const recentActivity: ActivityItem[] = protectedSourcesReady
    ? [
        ...credentials.map((credential) => ({
          id: `credential-${credential.id}`,
          title: credential.typeLabel,
          description: `Issuer record: ${credential.issuerId}`,
          timestamp: toDate(credential.issuedAt),
          status: credential.status,
          icon: ShieldCheck,
        })),
        ...verificationRecords.map((verification, index) => {
          const record = asRecord(verification);
          const id = stringValue(record.id);
          const verificationType = stringValue(record.verificationType);
          const verifierId = stringValue(record.verifierId);
          const credentialId = stringValue(record.credentialId);
          return {
            id: `verification-${id ?? index}`,
            title: verificationType
              ? `${humanizeCode(verificationType)} record`
              : "Verification record",
            description: verifierId
              ? `Verifier record: ${verifierId}`
              : credentialId
                ? `Credential record: ${credentialId}`
                : id
                  ? `Verification record: ${id}`
                  : "Record identifiers unavailable",
            timestamp: firstValidDate(record.requestedAt, record.completedAt),
            status: stringValue(record.result),
            icon: Fingerprint,
          };
        }),
      ]
        .sort(
          (left, right) =>
            (right.timestamp?.getTime() ?? Number.NEGATIVE_INFINITY) -
            (left.timestamp?.getTime() ?? Number.NEGATIVE_INFINITY),
        )
        .slice(0, 8)
    : [];

  if (
    walletStatus === "connecting" ||
    walletStatus === "reconnecting" ||
    isReconnecting
  ) {
    return (
      <AppLayout>
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="card flex items-center gap-3 p-6 text-sm text-zero-300">
            <Loader2 className="h-5 w-5 animate-spin" />
            Checking wallet connection...
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="relative flex min-h-[85vh] items-center justify-center">
          <div
            className="pointer-events-none absolute left-1/2 top-1/4 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2"
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
            className="relative z-10 max-w-2xl text-center"
          >
            <div className="relative mx-auto mb-6 h-56 w-56">
              <Image
                src="/zeroid-logo.png"
                alt="ZeroID"
                width={224}
                height={224}
                className="h-full w-full rounded-[2rem] object-contain"
                priority
              />
            </div>
            <h1 className="text-display-xl text-gradient-hero mb-5 font-display leading-none">
              Welcome to ZeroID
            </h1>
            <p className="mx-auto mb-12 max-w-lg text-[17px] leading-relaxed text-zero-400">
              Connect a wallet to resolve its ZeroID identity state. Protected
              credential and verification records are requested only after an
              authenticated identity session exists.
            </p>
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-3"
            >
              {[
                {
                  icon: Key,
                  label: "Wallet-bound identity",
                  description:
                    "Backend profile and registry resolution are shown separately.",
                },
                {
                  icon: Lock,
                  label: "Protected records",
                  description:
                    "Unavailable sources remain unavailable instead of becoming zero.",
                },
                {
                  icon: Database,
                  label: "Returned evidence",
                  description:
                    "Counts and activity use only records returned by ZeroID APIs.",
                },
              ].map((feature) => (
                <motion.div
                  key={feature.label}
                  variants={fadeUp}
                  className="bento p-6 text-left"
                >
                  <feature.icon className="mb-4 h-5 w-5 text-chrome-300" />
                  <p className="text-[14px] font-semibold text-white">
                    {feature.label}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-zero-500">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </motion.div>
            <p className="text-[12px] text-zero-500">
              Use the Connect control in the header to continue.
            </p>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  const identity = identityQuery.identity;
  const profile = asRecord(identity.profile);
  const profileAvailable = Boolean(identity.profile);
  const hasRegistryIdentity = identity.hasIdentity === true;
  const identityAvailable = profileAvailable || hasRegistryIdentity;
  const backendDid = didValue(profile.did);
  const registryDidHash = stringValue(identity.didHash);
  const lifecycleStatus =
    stringValue(profile.status) ??
    (typeof profile.status === "number" ? String(profile.status) : undefined);
  const createdAt = toDate(profile.createdAt);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 pt-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-display-md font-display tracking-tight text-white">
              Dashboard
            </h1>
            <p className="mt-1.5 text-[13px] text-zero-500">
              Identity and protected records returned for this wallet session.
            </p>
          </div>
          <div className="max-w-xl rounded-xl border border-chrome-300/10 bg-chrome-300/[0.03] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-chrome-300/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-chrome-300">
                {readiness.status}
              </span>
              <span className="text-xs font-medium text-zero-300">
                Dashboard readiness
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zero-500">
              {readiness.evidence}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <section
            className="col-span-12 lg:col-span-7"
            aria-label="Identity evidence"
          >
            <div className="bento h-full p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-label-sm uppercase text-zero-500">
                    Identity evidence
                  </p>
                  <p className="mt-1 text-xs text-zero-600">
                    Backend profile and configured registry read.
                  </p>
                </div>
                <Fingerprint className="h-5 w-5 text-chrome-300" />
              </div>

              {identityQuery.isLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-zero-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading identity evidence...
                </div>
              ) : identityQuery.error ? (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-300">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p>Identity evidence unavailable</p>
                      <p className="mt-1 text-xs text-zero-400">
                        {identityQuery.error.message}
                      </p>
                    </div>
                  </div>
                </div>
              ) : !identityAvailable ? (
                <div className="py-8 text-center">
                  <Shield className="mx-auto mb-3 h-8 w-8 text-zero-600" />
                  <p className="text-sm text-zero-300">
                    No backend identity profile or registry DID was returned.
                  </p>
                  <Link href="/identity" className="btn-primary btn-sm mt-4">
                    Create ZeroID <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl bg-white/[0.025] p-4">
                    <p className="text-[10px] uppercase tracking-wide text-zero-600">
                      {backendDid ? "Backend DID" : "Registry DID hash"}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-zero-300">
                      {backendDid ??
                        registryDidHash ??
                        "Identifier unavailable"}
                    </p>
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                    {[
                      [
                        "Backend identity profile",
                        profileAvailable ? "Returned" : "Not returned",
                      ],
                      [
                        "Registry DID resolution",
                        hasRegistryIdentity ? "Resolved" : "Not resolved",
                      ],
                      ["Lifecycle status", lifecycleStatus ?? "Unavailable"],
                      ["Created", formatTimestamp(createdAt)],
                      ["TEE evidence", evidenceLabel(profile.teeAttested)],
                      [
                        "Government evidence",
                        evidenceLabel(profile.governmentVerified),
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-white/[0.04] p-3"
                      >
                        <dt className="text-zero-600">{label}</dt>
                        <dd className="mt-1 text-zero-300">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <Link
                    href="/identity"
                    className="inline-flex items-center gap-1.5 text-xs text-chrome-300 hover:text-white"
                  >
                    Manage identity <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          </section>

          <section
            className="col-span-12 lg:col-span-5"
            aria-label="Quick actions"
          >
            <div className="bento h-full p-6">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-label-sm uppercase text-zero-500">
                  Working links
                </p>
                <Zap className="h-3.5 w-3.5 text-zero-600" />
              </div>
              <div className="space-y-2">
                {[
                  {
                    icon: UserRoundCheck,
                    label: "Manage Identity",
                    description: "Review or create your ZeroID",
                    href: "/identity",
                  },
                  {
                    icon: FileCheck,
                    label: "View Credentials",
                    description: "Review returned credential records",
                    href: "/credentials",
                  },
                  {
                    icon: ClipboardCheck,
                    label: "Run Eligibility Proof",
                    description: "Generate a policy-bound receipt",
                    href: "/eligibility",
                  },
                  {
                    icon: History,
                    label: "View Audit Records",
                    description: "Open the server-backed audit trail",
                    href: "/audit",
                  },
                ].map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="group flex items-center gap-3.5 rounded-2xl p-3 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-chrome-300/10 bg-chrome-300/[0.04]">
                      <action.icon className="h-[17px] w-[17px] text-chrome-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-zero-200 group-hover:text-white">
                        {action.label}
                      </p>
                      <p className="text-[11px] text-zero-500">
                        {action.description}
                      </p>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-zero-700 group-hover:text-chrome-400" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section aria-label="Protected record evidence" className="space-y-4">
          <div>
            <h2 className="text-heading-sm font-display">
              Protected record evidence
            </h2>
            <p className="mt-1 text-xs text-zero-500">
              Each endpoint is requested with a 100-record page. Counts below
              describe returned records, not lifetime totals.
            </p>
          </div>

          {accessState !== "ready" ? (
            <div className="card border-amber-500/20 p-6 text-sm text-amber-100">
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-5 w-5" />
                <div>
                  <p>Authenticated identity session required</p>
                  <p className="mt-1 text-xs text-zero-400">
                    Sign in from the header to load credential and verification
                    records. No zero values are shown while these sources are
                    unavailable.
                  </p>
                </div>
              </div>
            </div>
          ) : protectedSourcesLoading ? (
            <div className="card flex items-center gap-3 p-8 text-sm text-zero-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading protected records...
            </div>
          ) : protectedSourceErrors.length > 0 ? (
            <div className="card border-rose-500/20 p-6" role="alert">
              <div className="flex items-start gap-3 text-rose-300">
                <AlertTriangle className="mt-0.5 h-5 w-5" />
                <div>
                  <p className="text-sm font-medium">
                    Protected record evidence unavailable
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-zero-400">
                    {protectedSourceErrors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : protectedSourcesReady ? (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                  {
                    label: "Credential records returned",
                    value: credentials.length,
                    subtitle: "Current 100-record page",
                    icon: <FileCheck className="h-[18px] w-[18px]" />,
                  },
                  {
                    label: "Active credentials returned",
                    value: activeCredentialCount,
                    subtitle: "Calculated from returned records",
                    icon: <ShieldCheck className="h-[18px] w-[18px]" />,
                  },
                  {
                    label: "Verification records returned",
                    value: verificationRecords.length,
                    subtitle: "Current 100-record page",
                    icon: <Fingerprint className="h-[18px] w-[18px]" />,
                  },
                  {
                    label: "Dated verification records",
                    value: datedVerificationCount,
                    subtitle: "Valid returned timestamps only",
                    icon: <CheckCircle2 className="h-[18px] w-[18px]" />,
                  },
                ].map((metric) => (
                  <MetricCard
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    subtitle={metric.subtitle}
                    icon={metric.icon}
                  />
                ))}
              </div>

              <div className="bento">
                <div className="flex items-center justify-between border-b border-white/[0.04] p-6">
                  <div>
                    <h2 className="text-heading-sm font-display">
                      Recent returned records
                    </h2>
                    <p className="mt-1 text-xs text-zero-500">
                      Credential issuance dates and verification request dates.
                    </p>
                  </div>
                  <Link
                    href="/audit"
                    className="flex items-center gap-1.5 text-[12px] text-zero-500 hover:text-chrome-300"
                  >
                    Open audit trail <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {recentActivity.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Database className="mx-auto mb-3 h-7 w-7 text-zero-600" />
                    <p className="text-[13px] text-zero-400">
                      Both protected endpoints returned empty record pages.
                    </p>
                  </div>
                ) : (
                  <div>
                    {recentActivity.map((activity, index) => (
                      <div
                        key={activity.id}
                        className="flex items-center gap-4 px-6 py-4"
                        style={{
                          borderBottom:
                            index < recentActivity.length - 1
                              ? "1px solid rgba(255,255,255,0.03)"
                              : "none",
                        }}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.025]">
                          <activity.icon className="h-[17px] w-[17px] text-chrome-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-zero-200">
                            {activity.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-zero-500">
                            {activity.description}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[10px] text-zero-400">
                            {activity.status ?? "Status unavailable"}
                          </p>
                          <p className="mt-1 text-[10px] text-zero-600">
                            {formatTimestamp(activity.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </AppLayout>
  );
}
