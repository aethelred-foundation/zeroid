"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  FileJson,
  Fingerprint,
  Loader2,
  LockKeyhole,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useAccount } from "wagmi";
import AppLayout from "@/components/layout/AppLayout";
import { useIdentity } from "@/contexts/IdentityContext";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { generateUUID } from "@/lib/utils";
import {
  ZEROID_ELIGIBILITY_POLICY_V1,
  createEligibilityProofRequest,
  formatEligibilityReceipt,
  formatEligibilityRequest,
  type EligibilityProofRequest,
  type EligibilityProofResponse,
} from "@/lib/eligibility/kycCredential";
import type { CredentialSummary } from "@/lib/credentials/summary";

type ConsoleMode = "receipt" | "request" | "sdk";

type ApiEnvelope = {
  data?: EligibilityProofResponse;
  source?: string;
  error?: string;
  message?: string;
};

function profileDid(
  identity: ReturnType<typeof useIdentity>["identity"],
): string {
  const value = identity.profile?.did;
  if (typeof value === "string") return value;
  return value?.uri ?? "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function EligibilityPage() {
  const { isConnected } = useAccount();
  const { identity, did, sessionStatus, sessionError, signIn } = useIdentity();
  const [credentialId, setCredentialId] = useState("");
  const [relyingAppId, setRelyingAppId] = useState("");
  const [lastRequest, setLastRequest] =
    useState<EligibilityProofRequest | null>(null);
  const [receipt, setReceipt] = useState<EligibilityProofResponse | null>(null);
  const [receiptLookupId, setReceiptLookupId] = useState("");
  const [consoleMode, setConsoleMode] = useState<ConsoleMode>("receipt");
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const [signInFailure, setSignInFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<ConsoleMode | null>(null);

  const authenticated = Boolean(
    isConnected &&
    identity.isRegistered &&
    sessionStatus === "authenticated" &&
    getIdentityAuthToken(),
  );
  const subjectDid = profileDid(identity) || did?.uri || "";
  const activeCredentials = useMemo(
    () =>
      identity.credentials.filter(
        (credential) => credential.status === "active",
      ),
    [identity.credentials],
  );
  const selectedCredential = activeCredentials.find(
    (credential) => credential.id === credentialId,
  );
  const proofIssuanceAvailable =
    ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.artifactStatus ===
    "PINNED_PRODUCTION_ARTIFACTS";

  useEffect(() => {
    if (
      credentialId &&
      activeCredentials.some((credential) => credential.id === credentialId)
    ) {
      return;
    }
    setCredentialId(activeCredentials[0]?.id ?? "");
  }, [activeCredentials, credentialId]);

  const canRequest = Boolean(
    authenticated &&
    subjectDid &&
    selectedCredential &&
    proofIssuanceAvailable &&
    relyingAppId.trim().length >= 3 &&
    relyingAppId.trim().length <= 128 &&
    !isRunning,
  );

  const runEligibility = async () => {
    const authToken = getIdentityAuthToken();
    if (!authenticated || !authToken) {
      setError("An authenticated ZeroID identity session is required.");
      return;
    }
    if (!subjectDid || !selectedCredential) {
      setError("Select an active credential owned by this identity.");
      return;
    }
    const normalizedAppId = relyingAppId.trim();
    if (normalizedAppId.length < 3 || normalizedAppId.length > 128) {
      setError("Relying application ID must be between 3 and 128 characters.");
      return;
    }

    const requestBody = createEligibilityProofRequest(
      {
        subjectDid,
        credentialId: selectedCredential.id,
        relyingAppId: normalizedAppId,
        contextNonce: `eligibility-${generateUUID()}`,
      },
      {
        requireNonRevocationProof: true,
        requireOnchainAttestation: false,
        dryRun: false,
      },
    );

    setLastRequest(requestBody);
    setReceipt(null);
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/eligibility/proof", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as ApiEnvelope;
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "Eligibility request failed.",
        );
      }
      if (payload.source !== "backend" || !payload.data) {
        throw new Error(
          "Eligibility response did not contain authenticated backend evidence.",
        );
      }
      setReceipt(payload.data);
      setReceiptLookupId(payload.data.decisionId);
      setConsoleMode("receipt");
    } catch (requestError) {
      setError(errorMessage(requestError, "Eligibility request failed."));
    } finally {
      setIsRunning(false);
    }
  };

  const loadReceipt = async () => {
    const authToken = getIdentityAuthToken();
    const normalizedReceiptId = receiptLookupId.trim();
    if (!authenticated || !authToken) {
      setError("An authenticated ZeroID identity session is required.");
      return;
    }
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(normalizedReceiptId)) {
      setError("Enter a valid decision, proof, or verification receipt ID.");
      return;
    }

    setIsLoadingReceipt(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/eligibility/proof/${encodeURIComponent(normalizedReceiptId)}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      const payload = (await response.json()) as ApiEnvelope;
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "Receipt lookup failed.",
        );
      }
      if (payload.source !== "backend" || !payload.data) {
        throw new Error(
          "Receipt lookup did not contain authenticated backend evidence.",
        );
      }
      setReceipt(payload.data);
      setConsoleMode("receipt");
    } catch (lookupError) {
      setError(errorMessage(lookupError, "Receipt lookup failed."));
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const consoleText = useMemo(() => {
    if (consoleMode === "request") {
      return lastRequest
        ? formatEligibilityRequest(lastRequest)
        : "No eligibility request has been sent in this session.";
    }
    if (consoleMode === "sdk") return buildSdkSnippet();
    return receipt
      ? formatEligibilityReceipt(receipt)
      : "No backend eligibility receipt has been loaded.";
  }, [consoleMode, lastRequest, receipt]);

  const copyConsole = async () => {
    await copyText(consoleText);
    setCopied(consoleMode);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-white/[0.06] pb-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-label-sm uppercase text-zero-500">
                Policy-bound evidence
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-white font-display">
                Eligibility
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zero-400">
                Request an eligibility decision for an active credential, or
                inspect a durable receipt already recorded by the backend.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge-pending">
                {ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.artifactStatus ===
                "PINNED_PRODUCTION_ARTIFACTS"
                  ? "Artifacts pinned"
                  : "Artifacts pending"}
              </span>
              <span className="badge-chrome">
                {ZEROID_ELIGIBILITY_POLICY_V1.version}
              </span>
            </div>
          </div>
        </motion.header>

        <EvidenceBoundary />

        {!isConnected ? (
          <AccessState
            icon={LockKeyhole}
            title="Connect your wallet"
            description="Eligibility records are protected identity data."
          />
        ) : identity.isLoading ? (
          <AccessState
            icon={Loader2}
            title="Checking ZeroID identity"
            description="Waiting for the registered identity record."
            spinning
          />
        ) : !identity.isRegistered ? (
          <AccessState
            icon={AlertTriangle}
            title="ZeroID identity required"
            description="Register this wallet before requesting eligibility evidence."
          />
        ) : sessionStatus !== "authenticated" ? (
          <section className="border-b border-white/[0.06] py-8">
            <LockKeyhole className="h-7 w-7 text-brand-400" />
            <h2 className="mt-3 text-lg font-semibold text-white">
              Sign in to ZeroID
            </h2>
            <p className="mt-1 max-w-xl text-sm text-zero-400">
              A wallet signature creates the session used to load credentials
              and submit the eligibility request.
            </p>
            {(signInFailure ?? sessionError) && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {signInFailure ?? sessionError}
              </p>
            )}
            <button
              type="button"
              className="btn-primary mt-4"
              disabled={sessionStatus === "signing"}
              onClick={() => {
                setSignInFailure(null);
                void signIn().catch((signInError) =>
                  setSignInFailure(
                    errorMessage(signInError, "ZeroID sign-in failed."),
                  ),
                );
              }}
            >
              {sessionStatus === "signing" ? "Signing…" : "Sign in"}
            </button>
          </section>
        ) : (
          <div className="grid gap-8 xl:grid-cols-[0.82fr_1.18fr]">
            <section className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Request context
                </h2>
                <p className="mt-1 text-xs leading-5 text-zero-500">
                  The authenticated DID, credential, policy, relying party, and
                  fresh nonce are bound into one backend request.
                </p>
              </div>

              <Field label="Authenticated subject DID">
                <div className="input break-all text-sm text-zero-300">
                  {subjectDid || "Unavailable"}
                </div>
              </Field>

              <Field label="Active credential">
                <select
                  aria-label="Active credential"
                  className="input"
                  value={credentialId}
                  onChange={(event) => setCredentialId(event.target.value)}
                >
                  <option value="">Select an active credential</option>
                  {activeCredentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.typeLabel} · {credential.id}
                    </option>
                  ))}
                </select>
              </Field>

              {selectedCredential ? (
                <CredentialEvidence credential={selectedCredential} />
              ) : (
                <p className="text-xs text-amber-200">
                  No active credential is selected. Private KYC claims are not
                  read or rendered by this page.
                </p>
              )}

              <Field label="Relying application ID">
                <input
                  aria-label="Relying application ID"
                  className="input"
                  value={relyingAppId}
                  maxLength={128}
                  placeholder="Configured verifier or application identifier"
                  onChange={(event) => setRelyingAppId(event.target.value)}
                />
              </Field>

              <div className="flex items-start gap-3 text-sm text-zero-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  Non-revocation evidence required
                  <span className="mt-1 block text-xs text-zero-500">
                    This policy cannot be weakened by the requesting client. The
                    backend must validate credential state and revocation
                    evidence before an allowed decision.
                  </span>
                </span>
              </div>

              <button
                type="button"
                className="btn-primary"
                disabled={!canRequest}
                onClick={() => void runEligibility()}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`}
                />
                {isRunning ? "Requesting…" : "Request eligibility evidence"}
              </button>

              {!proofIssuanceAvailable && (
                <p role="status" className="text-xs leading-5 text-amber-200">
                  Proof issuance is unavailable. The signed credential witness,
                  audited Groth16 artifacts, and verification path must be
                  integrated before this action can be enabled.
                </p>
              )}

              {activeCredentials.length === 0 && (
                <p className="text-xs text-amber-200">
                  The authenticated backend returned no active credentials for
                  this identity.
                </p>
              )}
            </section>

            <section className="space-y-6 xl:border-l xl:border-white/[0.06] xl:pl-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Durable receipt
                  </h2>
                  <p className="mt-1 text-xs text-zero-500">
                    Only authenticated backend evidence is rendered here.
                  </p>
                </div>
                <ConsoleTabs value={consoleMode} onChange={setConsoleMode} />
              </div>

              <div className="flex gap-2">
                <input
                  aria-label="Receipt ID"
                  className="input min-w-0 flex-1"
                  value={receiptLookupId}
                  placeholder="Decision, proof, or verification ID"
                  onChange={(event) => setReceiptLookupId(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  disabled={isLoadingReceipt || !receiptLookupId.trim()}
                  onClick={() => void loadReceipt()}
                >
                  <Database className="h-4 w-4" />
                  {isLoadingReceipt ? "Loading…" : "Load"}
                </button>
              </div>

              <motion.pre
                key={consoleMode}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-h-[360px] overflow-auto border-y border-white/[0.06] bg-black/20 px-1 py-5 text-[11px] leading-5 text-chrome-200 whitespace-pre-wrap break-all font-mono"
              >
                {consoleText}
              </motion.pre>

              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copyConsole()}
                >
                  {copied === consoleMode ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === consoleMode ? "Copied" : "Copy"}
                </button>
              </div>

              <DecisionEvidence receipt={receipt} />
            </section>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 border-t border-red-500/20 pt-4 text-sm text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="grid gap-5 border-t border-white/[0.06] pt-6 lg:grid-cols-2">
          <div>
            <p className="text-label-sm uppercase text-zero-500">
              Configured policy
            </p>
            <h2 className="mt-2 text-base font-semibold text-white">
              {ZEROID_ELIGIBILITY_POLICY_V1.label}
            </h2>
            <p className="mt-2 text-xs leading-5 text-zero-500">
              These values describe the client configuration. They are not
              evidence of deployed artifacts; the backend validates circuit
              availability before recording a decision.
            </p>
          </div>
          <dl className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
            <Definition
              label="Policy ID"
              value={ZEROID_ELIGIBILITY_POLICY_V1.policyId}
            />
            <Definition
              label="Circuit"
              value={ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitName}
            />
            <Definition
              label="Manifest digest"
              value={
                receipt?.evidence.manifestDigest ?? "No backend receipt loaded"
              }
            />
            <Definition
              label="On-chain anchoring"
              value="Unavailable without transaction-backed verifier evidence"
            />
          </dl>
        </section>
      </div>
    </AppLayout>
  );
}

function EvidenceBoundary() {
  return (
    <section className="border-l-2 border-amber-400/50 pl-4 text-sm">
      <p className="font-medium text-amber-100">Evidence boundary</p>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-zero-400">
        ZeroID does not run a browser-side KYC evaluator or create local proof
        receipts. Context-bound circuit artifacts, credential integrity, TEE
        evidence, and durable database writes are backend requirements. On-chain
        anchoring is unavailable until a real verifier transaction integration
        is configured.
      </p>
    </section>
  );
}

function AccessState({
  icon: Icon,
  title,
  description,
  spinning = false,
}: {
  icon: typeof LockKeyhole;
  title: string;
  description: string;
  spinning?: boolean;
}) {
  return (
    <section className="border-y border-white/[0.06] py-10 text-center">
      <Icon
        className={`mx-auto h-8 w-8 text-zero-500 ${spinning ? "animate-spin" : ""}`}
      />
      <h2 className="mt-3 font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-zero-400">{description}</p>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-zero-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function CredentialEvidence({ credential }: { credential: CredentialSummary }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 border-y border-white/[0.06] py-4 text-xs sm:grid-cols-2">
      <Definition label="Type" value={credential.credentialType} />
      <Definition label="Status" value={credential.status} />
      <Definition label="Issuer record" value={credential.issuerId} />
      <Definition label="Claims commitment" value={credential.claimsHash} />
    </dl>
  );
}

function DecisionEvidence({
  receipt,
}: {
  receipt: EligibilityProofResponse | null;
}) {
  if (!receipt) {
    return (
      <div className="border-t border-white/[0.06] pt-5 text-sm text-zero-500">
        No decision evidence loaded.
      </div>
    );
  }

  const allowed = receipt.status === "ALLOWED";
  const disclosureBudget = receipt.proof.disclosurePolicy.disclosureBudget;
  return (
    <div className="space-y-5 border-t border-white/[0.06] pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {allowed ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : (
            <XCircle className="h-5 w-5 text-red-400" />
          )}
          <span className="font-semibold text-white">{receipt.status}</span>
        </div>
        <span className="text-xs text-zero-500">Backend receipt</span>
      </div>
      <dl className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
        <Definition label="Decision" value={receipt.decisionId} />
        <Definition label="Proof" value={receipt.proof.proofId} />
        <Definition label="Receipt hash" value={receipt.evidence.receiptHash} />
        <Definition label="Audit hash" value={receipt.evidence.auditHash} />
        <Definition
          label="Raw fields disclosed"
          value={String(disclosureBudget.rawFieldCount)}
        />
        <Definition
          label="Public signals"
          value={String(disclosureBudget.publicSignalCount)}
        />
        <Definition
          label="On-chain evidence"
          value={
            receipt.proof.onchainTxHash
              ? receipt.proof.onchainTxHash
              : "Not reported"
          }
        />
        <Definition
          label="TEE evidence"
          value={receipt.evidence.teeAttestationId ?? "Not reported"}
        />
      </dl>
    </div>
  );
}

function ConsoleTabs({
  value,
  onChange,
}: {
  value: ConsoleMode;
  onChange: (value: ConsoleMode) => void;
}) {
  const tabs = [
    { id: "receipt" as const, label: "Receipt", icon: ClipboardCheck },
    { id: "request" as const, label: "Request", icon: FileJson },
    { id: "sdk" as const, label: "SDK", icon: Fingerprint },
  ];
  return (
    <div className="flex border-b border-white/[0.06]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
            value === tab.id
              ? "border-b border-white text-white"
              : "text-zero-500 hover:text-zero-200"
          }`}
        >
          <tab.icon className="h-3.5 w-3.5" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-zero-500">{label}</dt>
      <dd className="mt-1 break-all text-zero-200">{value}</dd>
    </div>
  );
}

function buildSdkSnippet(): string {
  return `const decision = await apiClient.generateEligibilityProof(
  {
    subjectDid: authenticatedIdentity.did,
    credentialId: selectedCredential.id,
    policyId: configuredPolicy.policyId,
    relyingAppId: configuredVerifier.id,
    contextNonce: verifierIssuedNonce,
    options: {
      requireNonRevocationProof: true,
      requireOnchainAttestation: false,
      dryRun: false
    }
  },
  identitySessionToken
);`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
