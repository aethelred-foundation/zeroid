"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import {
  FileKey2,
  Fingerprint,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
} from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/hooks/useIdentity";

const THEMES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

function formatDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "Not reported";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not reported"
    : date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { identity, delegates, isLoading, error } = useIdentity();

  return (
    <AppLayout>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="mt-1 text-[var(--text-secondary)]">
            Local appearance and read-only ZeroID account context.
          </p>
        </header>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--border-secondary)] p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Palette className="h-5 w-5 text-brand-500" /> Appearance
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Theme selection is stored by the browser for this device.
            </p>
          </div>
          <div className="grid gap-3 p-6 sm:grid-cols-3">
            {THEMES.map((option) => {
              const Icon = option.icon;
              const selected = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTheme(option.id)}
                  className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-brand-500 bg-brand-500/10 text-[var(--text-primary)]"
                      : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--border-secondary)] p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Fingerprint className="h-5 w-5 text-identity-chrome" /> Identity
              context
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Values below come from the connected wallet, identity registry,
              and ZeroID API. They are not editable preferences.
            </p>
          </div>

          {isLoading ? (
            <div
              className="p-6 text-sm text-[var(--text-secondary)]"
              role="status"
            >
              Loading registered identity context...
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-red-400" role="alert">
              Identity context is unavailable: {error.message}
            </div>
          ) : !identity.isRegistered ? (
            <div className="p-6">
              <p className="text-sm text-[var(--text-secondary)]">
                The connected wallet has no registered ZeroID identity.
              </p>
              <Link href="/identity" className="btn-primary mt-4 inline-flex">
                Open identity setup
              </Link>
            </div>
          ) : (
            <dl className="grid gap-px bg-[var(--border-secondary)] sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["DID", identity.did || "Not reported"],
                ["Verification status", identity.verificationStatus],
                ["Credentials", identity.credentialCount.toLocaleString()],
                ["Verifications", identity.verificationCount.toLocaleString()],
                ["Active delegates", delegates.length.toLocaleString()],
                ["Registered", formatDate(identity.createdAt)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 bg-[var(--surface-primary)] p-5"
                >
                  <dt className="text-xs text-[var(--text-tertiary)]">
                    {label}
                  </dt>
                  <dd className="mt-1 break-all text-sm font-medium text-[var(--text-primary)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Link
            href="/identity"
            className="card p-5 transition-colors hover:border-brand-500/40"
          >
            <Fingerprint className="h-5 w-5 text-brand-500" />
            <h2 className="mt-3 text-sm font-semibold">Identity controls</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Manage the registered identity and on-chain delegates.
            </p>
          </Link>
          <Link
            href="/credentials"
            className="card p-5 transition-colors hover:border-brand-500/40"
          >
            <FileKey2 className="h-5 w-5 text-identity-amber" />
            <h2 className="mt-3 text-sm font-semibold">Credential records</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Review credentials returned by the authenticated API.
            </p>
          </Link>
          <Link
            href="/audit"
            className="card p-5 transition-colors hover:border-brand-500/40"
          >
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h2 className="mt-3 text-sm font-semibold">Audit activity</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Inspect durable identity and credential audit events.
            </p>
          </Link>
        </section>

        <p className="text-xs leading-5 text-[var(--text-tertiary)]">
          Notification rules, hardware-key enrollment, data export, identity
          deletion, TEE selection, and proving-backend preferences are hidden
          until authoritative APIs implement those operations.
        </p>
      </div>
    </AppLayout>
  );
}
