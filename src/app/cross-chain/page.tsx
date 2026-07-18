"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Layers,
  Link2,
  LockKeyhole,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import {
  useCrossChainCapabilities,
  useSupportedChains,
} from "@/hooks/useCrossChain";
import { useCredentials } from "@/hooks/useCredentials";
import type { Credential } from "@/types";

function credentialId(credential: Credential): string {
  const id =
    credential.id ||
    credential.hash ||
    credential.contentHash ||
    credential.schemaHash;
  return typeof id === "string" && id.length > 0 ? id : "Unavailable";
}

function credentialLabel(credential: Credential): string {
  return (
    credential.schemaName ||
    credential.name ||
    credential.schemaType ||
    "Unnamed credential"
  );
}

function credentialIssuer(credential: Credential): string {
  if (credential.issuer) return credential.issuer;
  if (typeof credential.issuerDid === "string") return credential.issuerDid;
  if (
    credential.issuerDid &&
    typeof credential.issuerDid === "object" &&
    "uri" in credential.issuerDid &&
    typeof credential.issuerDid.uri === "string"
  ) {
    return credential.issuerDid.uri;
  }
  return "Issuer unavailable";
}

function credentialStatus(credential: Credential): string {
  const status = String(credential.status ?? "unknown").toLowerCase();
  return status === "1" ? "active" : status;
}

function credentialExpiry(credential: Credential): string {
  if (!credential.expiresAt) return "No expiry supplied";
  const raw = Number(credential.expiresAt);
  const timestamp = raw < 10_000_000_000 ? raw * 1000 : raw;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `Expires ${date.toLocaleDateString()}`
    : "Expiry unavailable";
}

function shorten(value: string): string {
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

export default function CrossChainPage() {
  const capabilities = useCrossChainCapabilities();
  const chainsQuery = useSupportedChains();
  const credentialsQuery = useCredentials();

  const credentials = credentialsQuery.credentials ?? [];
  const destinations = chainsQuery.data ?? [];

  const capabilityRows = [
    {
      name: "Bridge contract",
      configured: capabilities.bridgeContractConfigured,
    },
    {
      name: "Relayer service",
      configured: capabilities.relayerConfigured,
    },
    {
      name: "Destination-chain verification",
      configured: capabilities.destinationVerificationConfigured,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Link2 className="h-7 w-7 text-brand-400" />
            Cross-Chain Identity Bridge
          </h1>
          <p className="mt-1 text-[var(--text-secondary)]">
            View portability readiness and your real ZeroID credential
            inventory.
          </p>
        </div>

        <section
          data-testid={
            capabilities.infrastructureReady
              ? "cross-chain-configured"
              : "cross-chain-unavailable"
          }
          className={`rounded-2xl border p-5 ${
            capabilities.infrastructureReady
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <div className="flex items-start gap-3">
            {capabilities.infrastructureReady ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            )}
            <div>
              <h2 className="font-semibold">
                {capabilities.infrastructureReady
                  ? "Cross-chain infrastructure configured"
                  : "Cross-chain transfers are unavailable"}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {capabilities.infrastructureReady
                  ? "The required infrastructure configuration is present. This client remains read-only until the audited submission and destination-verification workflow is released."
                  : "ZeroID will not offer bridge, fee, or destination-verification actions until a bridge contract, relayer service, and authoritative destination verifier are all configured."}
              </p>
              {!capabilities.infrastructureReady && (
                <p className="mt-2 text-xs text-amber-200">
                  Missing: {capabilities.missingCapabilities.join(", ")}.
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              label: "Transfer capability",
              value: capabilities.infrastructureReady
                ? "Configured"
                : "Unavailable",
              detail: "No transactional controls",
              icon: LockKeyhole,
            },
            {
              label: "Destination definitions",
              value: chainsQuery.isLoading
                ? "Loading"
                : String(destinations.length),
              detail: "Configuration metadata only",
              icon: Layers,
            },
            {
              label: "Real credentials",
              value: credentialsQuery.isLoading
                ? "Loading"
                : String(credentials.length),
              detail: "No demo fallback records",
              icon: Fingerprint,
            },
          ].map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-zero-800 bg-zero-900 p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-zero-500">
                <metric.icon className="h-4 w-4 text-brand-400" />
                {metric.label}
              </div>
              <div className="text-xl font-bold">{metric.value}</div>
              <div className="mt-1 text-xs text-zero-500">{metric.detail}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-6">
          <section className="col-span-12 lg:col-span-8">
            <div className="card overflow-hidden">
              <div className="border-b border-zero-800 p-5">
                <h2 className="font-semibold">Your credentials — read only</h2>
                <p className="mt-1 text-xs text-zero-500">
                  Only credentials returned for the connected ZeroID subject are
                  shown. No local or demonstration records are substituted.
                </p>
              </div>

              {credentialsQuery.isLoading ? (
                <div className="p-6 text-sm text-zero-400">
                  Loading credential inventory…
                </div>
              ) : credentialsQuery.isError ? (
                <div className="p-6 text-sm text-amber-300">
                  Credential inventory is unavailable. ZeroID has not inserted
                  fallback credentials.
                </div>
              ) : credentials.length === 0 ? (
                <div className="p-6 text-sm text-zero-400">
                  No credentials were returned for this subject. There are no
                  demo credentials to display.
                </div>
              ) : (
                <div className="divide-y divide-zero-800/60">
                  {credentials.map((credential, index) => {
                    const id = credentialId(credential);
                    return (
                      <motion.article
                        key={`${id}-${index}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.03 }}
                        className="flex items-start gap-4 p-5"
                      >
                        <div className="rounded-xl bg-brand-500/10 p-2.5">
                          <Fingerprint className="h-5 w-5 text-brand-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">
                              {credentialLabel(credential)}
                            </h3>
                            <span className="rounded-full border border-zero-700 px-2 py-0.5 text-[10px] uppercase text-zero-400">
                              {credentialStatus(credential)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-zero-500">
                            Issuer: {credentialIssuer(credential)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zero-600">
                            <span title={id}>ID: {shorten(id)}</span>
                            <span>{credentialExpiry(credential)}</span>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="col-span-12 space-y-4 lg:col-span-4">
            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Server className="h-4 w-4 text-brand-400" />
                Capability gate
              </h2>
              <div className="mt-4 space-y-3">
                {capabilityRows.map((capability) => (
                  <div
                    key={capability.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-zero-400">{capability.name}</span>
                    <span
                      className={`flex items-center gap-1.5 text-xs ${
                        capability.configured
                          ? "text-emerald-400"
                          : "text-amber-300"
                      }`}
                    >
                      {capability.configured ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {capability.configured ? "Configured" : "Not configured"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-brand-400" />
                Destination definitions
              </h2>
              <p className="mt-1 text-[11px] text-zero-500">
                A listed network is not proof that bridge service is
                operational.
              </p>
              <div className="mt-4 space-y-3">
                {chainsQuery.isLoading ? (
                  <p className="text-xs text-zero-500">
                    Loading destination metadata…
                  </p>
                ) : chainsQuery.isError ? (
                  <p className="text-xs text-amber-300">
                    Destination metadata unavailable.
                  </p>
                ) : (
                  destinations.map((chain) => (
                    <div
                      key={chain.chainId}
                      className="flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{chain.name}</div>
                        <div className="text-[10px] uppercase text-zero-600">
                          {chain.network} · chain {chain.chainId}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-medium uppercase ${
                          chain.isActive ? "text-emerald-400" : "text-amber-300"
                        }`}
                      >
                        {chain.isActive ? "Configured" : "Unavailable"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
