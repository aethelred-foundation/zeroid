'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Cpu,
  Database,
  FileJson,
  Fingerprint,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ScanEye,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { getIdentityAuthToken } from '@/lib/identity/registration';
import {
  RELYING_APP_PROFILES,
  ZEROID_ELIGIBILITY_POLICY_V1,
  ZEROID_KYC_CREDENTIAL_SCHEMA_FIELDS,
  ZEROID_SAMPLE_KYC_CREDENTIAL,
  createEligibilityProofRequest,
  formatEligibilityReceipt,
  formatEligibilityRequest,
  getRelyingAppProfile,
  type EligibilityProofResponse,
  type RelyingAppId,
} from '@/lib/eligibility/kycCredential';

type ConsoleMode = 'receipt' | 'request' | 'sdk';
type ReceiptSource = 'local' | 'backend';

const workflowSteps = [
  {
    label: 'DID',
    title: 'Subject identity',
    description: 'Holder-controlled DID resolves before proof generation.',
    icon: Fingerprint,
  },
  {
    label: 'VC',
    title: 'KYC credential',
    description: 'Compact ZeroIDKycCredentialV1 issued by trusted KYC node.',
    icon: BadgeCheck,
  },
  {
    label: 'ZK',
    title: 'Eligibility proof',
    description: 'Age and jurisdiction are proven without exposing raw fields.',
    icon: ScanEye,
  },
  {
    label: 'Policy',
    title: 'Decision engine',
    description: 'Policy version, app context, and nonce bind the proof.',
    icon: ShieldCheck,
  },
  {
    label: 'Receipt',
    title: 'Evidence record',
    description:
      'Audit hash, circuit manifest, and TEE evidence are inspectable.',
    icon: ClipboardCheck,
  },
];

export default function EligibilityPage() {
  const [selectedAppId, setSelectedAppId] = useState<RelyingAppId>(
    RELYING_APP_PROFILES[0].id,
  );
  const [requireNonRevocation, setRequireNonRevocation] = useState(true);
  const [requireOnchain, setRequireOnchain] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [consoleMode, setConsoleMode] = useState<ConsoleMode>('receipt');
  const [receipt, setReceipt] = useState<EligibilityProofResponse | null>(null);
  const [receiptSource, setReceiptSource] = useState<ReceiptSource | null>(
    null,
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isRefreshingReceipt, setIsRefreshingReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<ConsoleMode | null>(null);

  const selectedApp = useMemo(
    () => getRelyingAppProfile(selectedAppId),
    [selectedAppId],
  );

  const requestBody = useMemo(
    () =>
      createEligibilityProofRequest(selectedAppId, {
        requireNonRevocationProof: requireNonRevocation,
        requireOnchainAttestation: requireOnchain,
        dryRun,
      }),
    [dryRun, requireNonRevocation, requireOnchain, selectedAppId],
  );

  const runProof = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const authToken = getIdentityAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
        headers['x-zeroid-use-backend'] = 'true';
      }

      const response = await fetch('/api/eligibility/proof', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Eligibility proof failed');
      }
      setReceipt(payload.data);
      setReceiptSource(payload.source === 'backend' ? 'backend' : 'local');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eligibility proof failed');
    } finally {
      setIsRunning(false);
    }
  }, [requestBody]);

  const refreshDurableReceipt = useCallback(async () => {
    if (!receipt) return;

    const authToken = getIdentityAuthToken();
    if (!authToken) {
      setError(
        'Backend receipt lookup requires an authenticated ZeroID identity token.',
      );
      return;
    }

    setIsRefreshingReceipt(true);
    setError(null);
    try {
      const receiptId = receipt.decisionId || receipt.proof.proofId;
      const response = await fetch(
        `/api/eligibility/proof/${encodeURIComponent(receiptId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Receipt lookup failed');
      }
      setReceipt(payload.data);
      setReceiptSource(payload.source === 'backend' ? 'backend' : 'local');
      setConsoleMode('receipt');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Receipt lookup failed');
    } finally {
      setIsRefreshingReceipt(false);
    }
  }, [receipt]);

  useEffect(() => {
    void runProof();
  }, [runProof]);

  const consoleText = useMemo(() => {
    if (consoleMode === 'request') return formatEligibilityRequest(requestBody);
    if (consoleMode === 'sdk') return buildSdkSnippet();
    return receipt
      ? formatEligibilityReceipt(receipt)
      : 'Run the eligibility proof to produce an evidence receipt.';
  }, [consoleMode, receipt, requestBody]);

  const copyConsole = async () => {
    await copyText(consoleText);
    setCopied(consoleMode);
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <AppLayout>
      <div className="space-y-5 overflow-hidden pt-1">
        <section
          className="relative max-w-full overflow-hidden rounded-[28px] border p-5 sm:p-7 lg:p-8"
          style={{
            background:
              'linear-gradient(180deg, rgba(17,18,22,0.96), rgba(10,11,13,0.98))',
            borderColor: 'rgba(255,255,255,0.06)',
            boxShadow:
              '0 30px 100px -40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(212,215,222,0.45), transparent)',
            }}
          />

          <div className="grid min-w-0 grid-cols-1 gap-7 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div className="min-w-0">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="badge-chrome">Core v1 hero workflow</span>
                <span className="badge-verified">Manifest validated</span>
                <span className="badge-pending">Artifacts pending</span>
                <span className="badge-verified">EDGE</span>
                <span className="badge-verified">Presight</span>
                <span className="badge-verified">TII</span>
              </div>
              <h1 className="max-w-4xl break-words text-[30px] font-semibold leading-[1.08] text-white font-display sm:text-display-lg">
                Eligibility proof command center
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-7 text-zero-400 font-body sm:text-[15px]">
                One production-shaped flow for regulated enterprise demos:
                ZeroID issues a compact KYC credential, generates an age and
                jurisdiction ZK proof, runs policy, and returns an evidence
                receipt that consultants can inspect line by line.
              </p>
            </div>

            <DecisionPanel receipt={receipt} isRunning={isRunning} />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-4">
            <Panel>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-label-sm uppercase text-zero-500 font-body">
                    Relying application
                  </p>
                  <h2 className="mt-2 text-heading-sm font-display text-white">
                    Enterprise pilot target
                  </h2>
                </div>
                <Globe2 className="h-5 w-5 text-chrome-300" />
              </div>

              <div className="mt-5 grid gap-2">
                {RELYING_APP_PROFILES.map((profile) => {
                  const active = selectedAppId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedAppId(profile.id)}
                      className={`group w-full rounded-2xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-chrome-300/30 bg-white/[0.065]'
                          : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-white font-body">
                              {profile.name}
                            </span>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-zero-500 font-body">
                            {profile.sector}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zero-600 group-hover:text-chrome-300" />
                      </div>
                      <p className="mt-3 text-[12px] leading-5 text-zero-400 font-body">
                        {profile.purpose}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-label-sm uppercase text-zero-500 font-body">
                    Proof options
                  </p>
                  <h2 className="mt-2 text-heading-sm font-display text-white">
                    Assurance controls
                  </h2>
                </div>
                <LockKeyhole className="h-5 w-5 text-chrome-300" />
              </div>

              <div className="mt-5 space-y-3">
                <ToggleRow
                  label="Require non-revocation"
                  description="Checks active status and revocation nonce."
                  checked={requireNonRevocation}
                  onChange={setRequireNonRevocation}
                />
                <ToggleRow
                  label="Require on-chain attestation"
                  description="Live mode must anchor the receipt on verifier contract."
                  checked={requireOnchain}
                  onChange={setRequireOnchain}
                />
                <ToggleRow
                  label="Deterministic local evaluation"
                  description="Uses the local evaluator only outside production backend mode."
                  checked={dryRun}
                  onChange={setDryRun}
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  onClick={runProof}
                  disabled={isRunning}
                  className="btn-primary"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`}
                  />
                  {isRunning ? 'Running proof' : 'Run eligibility proof'}
                </button>
                <button onClick={copyConsole} className="btn-secondary">
                  {copied === consoleMode ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied === consoleMode ? 'Copied' : 'Copy console'}
                </button>
                <button
                  onClick={refreshDurableReceipt}
                  disabled={!receipt || isRunning || isRefreshingReceipt}
                  className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Database
                    className={`h-4 w-4 ${
                      isRefreshingReceipt ? 'animate-pulse' : ''
                    }`}
                  />
                  {receiptSource === 'backend'
                    ? 'Refresh receipt'
                    : 'Sync backend receipt'}
                </button>
              </div>

              <p className="mt-3 text-[11px] leading-5 text-zero-500 font-body">
                Receipt source:{' '}
                <span className="text-zero-300">
                  {receiptSource === 'backend'
                    ? 'authenticated backend'
                    : 'deterministic demo'}
                </span>
              </p>

              {error && (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/8 p-4 text-[12px] text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {workflowSteps.map((step, index) => (
                  <motion.div
                    key={step.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="relative rounded-2xl border border-white/[0.04] bg-white/[0.025] p-4"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zero-500 font-body">
                        {step.label}
                      </span>
                      <step.icon className="h-4 w-4 text-chrome-300" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-white font-body">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-[11px] leading-5 text-zero-500 font-body">
                      {step.description}
                    </p>
                  </motion.div>
                ))}
              </div>
            </Panel>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <Panel>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-label-sm uppercase text-zero-500 font-body">
                      Credential
                    </p>
                    <h2 className="mt-2 text-heading-sm font-display text-white">
                      ZeroIDKycCredentialV1
                    </h2>
                  </div>
                  <BadgeCheck className="h-5 w-5 text-emerald-400" />
                </div>

                <div className="mt-5 space-y-3">
                  <KeyValue
                    label="Subject DID"
                    value={ZEROID_SAMPLE_KYC_CREDENTIAL.subjectDid}
                  />
                  <KeyValue
                    label="Issuer"
                    value={ZEROID_SAMPLE_KYC_CREDENTIAL.issuerId}
                  />
                  <KeyValue
                    label="Residence"
                    value={
                      ZEROID_SAMPLE_KYC_CREDENTIAL.attributes.countryOfResidence
                    }
                  />
                  <KeyValue
                    label="Sanctions"
                    value={
                      ZEROID_SAMPLE_KYC_CREDENTIAL.attributes
                        .sanctionsScreeningResult
                    }
                    positive
                  />
                  <KeyValue
                    label="Risk tier"
                    value={`${ZEROID_SAMPLE_KYC_CREDENTIAL.attributes.riskTier} / ${ZEROID_SAMPLE_KYC_CREDENTIAL.riskProfile.score}`}
                    positive
                  />
                </div>

                <div className="mt-5 rounded-2xl border border-white/[0.04] bg-black/20 p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zero-500">
                    Schema fields
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ZEROID_KYC_CREDENTIAL_SCHEMA_FIELDS.map((field) => (
                      <code
                        key={field}
                        className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-2 py-1 text-[10px] text-zero-400"
                      >
                        {field}
                      </code>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-label-sm uppercase text-zero-500 font-body">
                      Evidence console
                    </p>
                    <h2 className="mt-2 text-heading-sm font-display text-white">
                      Inspectable proof receipt
                    </h2>
                  </div>
                  <ConsoleTabs value={consoleMode} onChange={setConsoleMode} />
                </div>

                <pre className="mt-5 max-h-[360px] overflow-auto rounded-2xl border border-white/[0.05] bg-black/35 p-4 text-[11px] leading-5 text-chrome-200 whitespace-pre-wrap break-all font-mono">
                  {consoleText}
                </pre>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <EvidenceMetric
                    icon={FileJson}
                    label="Receipt hash"
                    value={receipt?.evidence.receiptHash ?? 'pending'}
                  />
                  <EvidenceMetric
                    icon={Database}
                    label="Audit hash"
                    value={receipt?.evidence.auditHash ?? 'pending'}
                  />
                  <EvidenceMetric
                    icon={Cpu}
                    label="TEE evidence"
                    value={receipt?.evidence.teeAttestationId ?? 'not linked'}
                  />
                  <EvidenceMetric
                    icon={ShieldCheck}
                    label="Manifest digest"
                    value={receipt?.evidence.manifestDigest ?? 'pending'}
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-white/[0.05] bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zero-500">
                        Disclosure policy
                      </p>
                      <p className="mt-2 text-[12px] leading-5 text-zero-400">
                        Raw KYC fields remain in credential custody; the
                        verifier receives bounded public signals and proved
                        predicates only.
                      </p>
                    </div>
                    <LockKeyhole className="h-5 w-5 shrink-0 text-emerald-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <KeyValue
                      label="Raw fields disclosed"
                      value={String(
                        receipt?.proof.disclosurePolicy.disclosureBudget
                          .rawFieldCount ?? 0,
                      )}
                      positive
                    />
                    <KeyValue
                      label="Public signals"
                      value={String(
                        receipt?.proof.disclosurePolicy.disclosureBudget
                          .publicSignalCount ?? 0,
                      )}
                    />
                    <KeyValue
                      label="Proved predicates"
                      value={String(
                        receipt?.proof.disclosurePolicy.disclosureBudget
                          .provedPredicateCount ?? 0,
                      )}
                    />
                  </div>
                </div>
              </Panel>
            </section>

            <Panel>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                <div>
                  <p className="text-label-sm uppercase text-zero-500 font-body">
                    Policy manifest
                  </p>
                  <h2 className="mt-2 text-heading-sm font-display text-white">
                    {ZEROID_ELIGIBILITY_POLICY_V1.label}
                  </h2>
                  <p className="mt-3 text-[12px] leading-6 text-zero-400 font-body">
                    {selectedApp.name} receives only a boolean decision, proof
                    metadata, and evidence hashes. The credential holder never
                    reveals birth date, raw nationality, revocation nonce, or
                    sanctions artifacts to the verifier.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <KeyValue
                    label="Policy version"
                    value={ZEROID_ELIGIBILITY_POLICY_V1.version}
                  />
                  <KeyValue
                    label="Minimum age"
                    value={`${ZEROID_ELIGIBILITY_POLICY_V1.minimumAge}+`}
                  />
                  <KeyValue
                    label="Allowed residence"
                    value={ZEROID_ELIGIBILITY_POLICY_V1.allowedResidencies.join(
                      ', ',
                    )}
                  />
                  <KeyValue
                    label="Circuit"
                    value={
                      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitId
                    }
                  />
                  <KeyValue
                    label="Verification key"
                    value={
                      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest
                        .verificationKeyId
                    }
                  />
                  <KeyValue
                    label="Manifest digest"
                    value={
                      receipt?.evidence.manifestDigest ??
                      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest
                        .manifestDigest
                    }
                  />
                  <KeyValue
                    label="Artifact status"
                    value={
                      receipt?.evidence.artifactStatus ??
                      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest
                        .artifactStatus
                    }
                  />
                  <KeyValue
                    label="Policy binding"
                    value={
                      receipt?.evidence.policyBindingDigest ??
                      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest
                        .policyBindingDigest
                    }
                  />
                  <KeyValue
                    label="Relying app"
                    value={selectedApp.requiredAssurance}
                  />
                </div>
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="bento p-5 sm:p-6">{children}</div>;
}

function DecisionPanel({
  receipt,
  isRunning,
}: {
  receipt: EligibilityProofResponse | null;
  isRunning: boolean;
}) {
  const allowed = receipt?.status === 'ALLOWED';
  const denied = receipt?.status === 'DENIED';

  return (
    <div className="min-w-0 rounded-[24px] border border-white/[0.06] bg-white/[0.035] p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-label-sm uppercase text-zero-500 font-body">
            Policy decision
          </p>
          <div className="mt-2 flex items-center gap-3">
            {isRunning ? (
              <RefreshCw className="h-6 w-6 animate-spin text-chrome-300" />
            ) : allowed ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            ) : denied ? (
              <XCircle className="h-6 w-6 text-rose-400" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-chrome-300" />
            )}
            <span className="break-words text-[28px] font-semibold leading-none text-white font-display">
              {isRunning ? 'Evaluating' : (receipt?.status ?? 'Ready')}
            </span>
          </div>
        </div>
        <span className={allowed ? 'badge-verified' : 'badge-chrome'}>
          {receipt?.policyVersion ?? ZEROID_ELIGIBILITY_POLICY_V1.version}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DecisionCheck
          label="Age"
          value={receipt?.evaluation.ageOverThreshold}
        />
        <DecisionCheck
          label="Residency"
          value={receipt?.evaluation.residencyAllowed}
        />
        <DecisionCheck
          label="Sanctions"
          value={receipt?.evaluation.sanctionsClear}
        />
        <DecisionCheck label="Risk" value={receipt?.evaluation.riskAccepted} />
        <DecisionCheck
          label="Non-revocation"
          value={receipt?.evaluation.nonRevocationChecked}
        />
        <DecisionCheck label="TEE" value={receipt?.evaluation.teeAttested} />
      </div>

      <div className="mt-5 space-y-2 text-[11px] text-zero-500 font-mono">
        <div className="break-all">
          decision: {receipt?.decisionId ?? 'pending'}
        </div>
        <div className="break-all">
          proof: {receipt?.proof.proofId ?? 'pending'}
        </div>
        <div className="break-all">
          context: {receipt?.proof.contextHash ?? 'pending'}
        </div>
      </div>
    </div>
  );
}

function DecisionCheck({ label, value }: { label: string; value?: boolean }) {
  const ready = value !== undefined;
  return (
    <div className="rounded-2xl border border-white/[0.04] bg-black/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-zero-500 font-body">{label}</span>
        {ready && value ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : ready ? (
          <XCircle className="h-3.5 w-3.5 text-rose-400" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-zero-700" />
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/[0.04] bg-white/[0.025] p-4">
      <span>
        <span className="block text-[13px] font-medium text-white font-body">
          {label}
        </span>
        <span className="mt-1 block text-[11px] leading-5 text-zero-500 font-body">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 rounded-md border-white/10 bg-black/30 text-emerald-400 focus:ring-emerald-400/30"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function ConsoleTabs({
  value,
  onChange,
}: {
  value: ConsoleMode;
  onChange: (value: ConsoleMode) => void;
}) {
  const tabs: Array<{ id: ConsoleMode; label: string; icon: typeof Terminal }> =
    [
      { id: 'receipt', label: 'Receipt', icon: ClipboardCheck },
      { id: 'request', label: 'Request', icon: FileJson },
      { id: 'sdk', label: 'SDK', icon: Terminal },
    ];

  return (
    <div className="flex rounded-xl border border-white/[0.05] bg-black/20 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
            value === tab.id
              ? 'bg-white/[0.08] text-white'
              : 'text-zero-500 hover:text-zero-200'
          }`}
        >
          <tab.icon className="h-3.5 w-3.5" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function KeyValue({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.04] bg-white/[0.025] p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zero-600 font-body">
        {label}
      </div>
      <div
        className={`mt-1 break-all text-[12px] font-medium font-body ${
          positive ? 'text-emerald-300' : 'text-zero-200'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function EvidenceMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileJson;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.04] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-zero-500">
        <Icon className="h-3.5 w-3.5 text-chrome-300" />
        {label}
      </div>
      <div className="truncate text-[11px] text-zero-300 font-mono">
        {value}
      </div>
    </div>
  );
}

function buildSdkSnippet(): string {
  return `import { apiClient } from "@aethelred/zeroid";

const decision = await apiClient.generateEligibilityProof({
  subjectDid: "did:aethelred:mainnet:0x8f4c2a1d6e7b9012cafe",
  credentialId: "cred_kyc_v1_ae_000184",
  policyId: "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
  relyingAppId: "edge-secure-data-room",
  contextNonce: crypto.randomUUID(),
  options: {
    requireNonRevocationProof: true,
    requireOnchainAttestation: false
  }
});`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
