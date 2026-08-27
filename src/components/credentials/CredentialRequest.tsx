"use client";

import { Building2, KeyRound, Server, ShieldAlert } from "lucide-react";

const ISSUANCE_REQUIREMENTS = [
  {
    icon: Building2,
    title: "Accredited issuer",
    description:
      "Only an authenticated issuer with an active, organization-scoped trust record may issue a credential.",
  },
  {
    icon: KeyRound,
    title: "Issuer-controlled proof",
    description:
      "Production issuance requires a proof signed by the issuer's registered assertion key.",
  },
  {
    icon: Server,
    title: "Private document workflow",
    description:
      "A holder request, encrypted document escrow, issuer review, and attested TEE processing service must be deployed first.",
  },
] as const;

/**
 * The backend currently exposes an issuer-only issuance endpoint; it does not
 * expose a holder request or document-upload workflow. Keep this surface
 * deliberately non-interactive so local files are never serialized into JSON
 * or represented as having been verified by merely checking node health.
 */
export default function CredentialRequest() {
  return (
    <div
      className="mx-auto max-w-xl"
      data-testid="credential-request-unavailable"
    >
      <div className="card p-6 md:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-status-pending/10">
            <ShieldAlert className="h-5 w-5 text-status-pending" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              Holder requests are not enabled
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              ZeroID will not collect documents or claim TEE verification until
              the complete issuer-review pipeline is deployed.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {ISSUANCE_REQUIREMENTS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4"
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {title}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs leading-5 text-[var(--text-tertiary)]">
          Existing credentials remain available to inspect and verify. An
          accredited issuer can use the authenticated issuance API after its
          organization, trust record, KMS key, and assertion proof are
          configured.
        </p>
      </div>
    </div>
  );
}
