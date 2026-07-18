export type FeatureReadinessStatus =
  | "Live"
  | "Configured"
  | "Preview"
  | "Unavailable";

export interface FeatureReadiness {
  href: string;
  status: FeatureReadinessStatus;
  evidence: string;
}

export const FEATURE_READINESS: Record<string, FeatureReadiness> = {
  "/": {
    href: "/",
    status: "Configured",
    evidence:
      "Shows wallet and identity evidence plus bounded credential and verification records; unavailable sources remain explicit instead of becoming synthetic or zero-valued fallbacks.",
  },
  "/identity": {
    href: "/identity",
    status: "Configured",
    evidence:
      "DID creation and UAE Pass status are backend-backed; production OAuth credentials still gate Live status.",
  },
  "/credentials": {
    href: "/credentials",
    status: "Configured",
    evidence:
      "Credential issuance and verification flows are implemented with audit records.",
  },
  "/eligibility": {
    href: "/eligibility",
    status: "Configured",
    evidence:
      "Hero eligibility receipt is backend-backed; compiled ZK artifacts remain required for Live production.",
  },
  "/verification": {
    href: "/verification",
    status: "Configured",
    evidence:
      "Context-bound verification routes are implemented with nonce and replay controls.",
  },
  "/ai-compliance": {
    href: "/ai-compliance",
    status: "Preview",
    evidence:
      "Signed-list screening, organization alerts, and record-based risk evidence are implemented; legal advice, reports, and impact models stay unavailable in production pending approved sources and policy mappings.",
  },
  "/agent-identity": {
    href: "/agent-identity",
    status: "Preview",
    evidence:
      "Agent identity sits above the human/KYC core and should remain labs until core assurance is live.",
  },
  "/analytics": {
    href: "/analytics",
    status: "Preview",
    evidence:
      "Analytics exposes bounded backend-derived records and labels unsupported comparisons and export evidence unavailable; production SIEM integration remains external.",
  },
  "/regulatory": {
    href: "/regulatory",
    status: "Preview",
    evidence:
      "Regulatory workflows need legal review and authority-specific filing evidence before Live.",
  },
  "/enterprise": {
    href: "/enterprise",
    status: "Configured",
    evidence:
      "Tenant-scoped enterprise controls are implemented with backend-backed policy and webhook surfaces.",
  },
  "/cross-chain": {
    href: "/cross-chain",
    status: "Preview",
    evidence:
      "Cross-chain relay is intentionally labelled Preview until relayer and bridge audits are complete.",
  },
  "/marketplace": {
    href: "/marketplace",
    status: "Preview",
    evidence:
      "Issuer marketplace needs production trust-framework onboarding before Live.",
  },
  "/governance": {
    href: "/governance",
    status: "Preview",
    evidence:
      "Governance is pilot-ready but requires operating bylaws and voting custody controls.",
  },
  "/audit": {
    href: "/audit",
    status: "Configured",
    evidence:
      "Audit views are backed by stored events; SIEM export is the remaining Live requirement.",
  },
  "/revocation": {
    href: "/revocation",
    status: "Configured",
    evidence:
      "Revocation state is implemented; production issuer SLAs determine Live status.",
  },
  "/settings": {
    href: "/settings",
    status: "Configured",
    evidence:
      "Settings are app-backed but inherit production status from connected services.",
  },
};

export function getFeatureReadiness(href: string): FeatureReadiness {
  const normalized =
    href === "/" ? "/" : `/${href.split("/").filter(Boolean)[0]}`;
  return (
    FEATURE_READINESS[normalized] ?? {
      href: normalized,
      status: "Preview",
      evidence:
        "No production readiness evidence has been registered for this surface.",
    }
  );
}

export function readinessDotClass(status: FeatureReadinessStatus): string {
  switch (status) {
    case "Live":
      return "bg-emerald-300";
    case "Configured":
      return "bg-chrome-300";
    case "Preview":
      return "bg-amber-300";
    case "Unavailable":
      return "bg-rose-300";
  }
}

export function readinessBadgeClass(status: FeatureReadinessStatus): string {
  switch (status) {
    case "Live":
      return "text-emerald-300 bg-emerald-400/8 border border-emerald-400/12";
    case "Configured":
      return "text-chrome-300 bg-chrome-300/8 border border-chrome-300/12";
    case "Preview":
      return "text-amber-200 bg-amber-300/8 border border-amber-300/12";
    case "Unavailable":
      return "text-rose-200 bg-rose-300/8 border border-rose-300/12";
  }
}
