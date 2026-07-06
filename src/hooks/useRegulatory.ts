/**
 * useRegulatory — Hook for regulatory compliance and jurisdiction management.
 *
 * Provides jurisdiction lookups, compliance status tracking, cross-border
 * transfer assessments, gap analysis, regulatory change feeds, and
 * data sovereignty status queries.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type { ISODateString } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Jurisdiction {
  id: string;
  name: string;
  code: string;
  region: "mena" | "eu" | "americas" | "apac" | "africa";
  regulatoryAuthority: string;
  authorityUrl: string;
  frameworks: string[];
  isActive: boolean;
  lastUpdated: ISODateString;
}

export interface JurisdictionRequirements {
  jurisdictionId: string;
  requiredCredentials: RequiredCredential[];
  dataRetentionDays: number;
  consentRequirements: ConsentRequirement[];
  reportingObligations: ReportingObligation[];
  kycLevel: number;
  amlThresholds: AMLThreshold[];
  updateFrequency: "daily" | "weekly" | "monthly" | "quarterly";
}

export interface RequiredCredential {
  schemaId: string;
  schemaName: string;
  mandatory: boolean;
  validityPeriodDays: number;
  acceptedIssuers: string[];
  renewalBufferDays: number;
}

export interface ConsentRequirement {
  type: "explicit" | "implicit" | "opt_out";
  purpose: string;
  retentionDays: number;
  withdrawalEnabled: boolean;
  granularity: "per_attribute" | "per_credential" | "blanket";
}

export interface ReportingObligation {
  type: string;
  frequency:
    | "real_time"
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "annual";
  authority: string;
  format: string;
  thresholdAmount?: number;
  thresholdCurrency?: string;
}

export interface AMLThreshold {
  transactionType: string;
  amountUSD: number;
  action: "report" | "block" | "enhanced_due_diligence";
}

export interface ComplianceStatus {
  jurisdictionId: string;
  jurisdictionName: string;
  overallStatus:
    | "compliant"
    | "partially_compliant"
    | "non_compliant"
    | "pending";
  score: number;
  credentialStatus: CredentialComplianceItem[];
  lastAssessedAt: ISODateString;
  nextAssessmentAt: ISODateString;
  blockers: string[];
}

export interface CredentialComplianceItem {
  schemaId: string;
  schemaName: string;
  status: "valid" | "expired" | "missing" | "pending" | "expiring_soon";
  expiresAt?: ISODateString;
  daysUntilExpiry?: number;
}

export interface CrossBorderAssessment {
  fromJurisdiction: string;
  toJurisdiction: string;
  eligible: boolean;
  riskLevel: "low" | "medium" | "high" | "prohibited";
  requiredActions: string[];
  additionalCredentials: string[];
  estimatedProcessingDays: number;
  restrictions: string[];
  bilateralAgreements: string[];
}

export interface GapAnalysis {
  jurisdictionId: string;
  totalRequired: number;
  totalMet: number;
  gaps: ComplianceGap[];
  remediationPriority: ComplianceGap[];
  estimatedRemediationDays: number;
}

export interface ComplianceGap {
  requirement: string;
  category: "credential" | "consent" | "reporting" | "data_residency";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  remediationSteps: string[];
  estimatedEffort: string;
}

export interface RegulatoryUpdate {
  id: string;
  jurisdictionId: string;
  jurisdictionName: string;
  title: string;
  summary: string;
  category:
    | "new_regulation"
    | "amendment"
    | "guidance"
    | "enforcement"
    | "deadline";
  severity: "critical" | "high" | "medium" | "low";
  effectiveDate: ISODateString;
  publishedAt: ISODateString;
  sourceUrl: string;
  impactsIdentity: boolean;
  requiredAction?: string;
}

export interface DataSovereigntyStatus {
  compliantRegions: string[];
  nonCompliantRegions: string[];
  dataResidencyMap: DataResidencyEntry[];
  gdprStatus: GDPRComplianceStatus;
  pendingTransfers: number;
}

export interface DataResidencyEntry {
  dataType: string;
  currentRegion: string;
  requiredRegion: string;
  compliant: boolean;
  migrationRequired: boolean;
}

export interface GDPRComplianceStatus {
  dataProcessingAgreement: boolean;
  dataProtectionOfficer: boolean;
  privacyImpactAssessment: boolean;
  consentManagement: boolean;
  rightToErasure: boolean;
  dataPortability: boolean;
  breachNotificationProcess: boolean;
  overallCompliant: boolean;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const regulatoryKeys = {
  all: ["regulatory"] as const,
  jurisdictions: () => [...regulatoryKeys.all, "jurisdictions"] as const,
  requirements: (id: string) =>
    [...regulatoryKeys.all, "requirements", id] as const,
  compliance: (id: string) =>
    [...regulatoryKeys.all, "compliance", id] as const,
  gaps: (id: string) => [...regulatoryKeys.all, "gaps", id] as const,
  feed: () => [...regulatoryKeys.all, "feed"] as const,
  sovereignty: () => [...regulatoryKeys.all, "sovereignty"] as const,
};

type EnterpriseCrossBorderResult = {
  allowed?: boolean;
  eligible?: boolean;
  riskLevel?: CrossBorderAssessment["riskLevel"];
  restrictions?: string[];
  requirements?: string[];
  requiredActions?: string[];
  additionalCredentials?: string[];
  mutualRecognitionAgreements?: string[];
  bilateralAgreements?: string[];
  estimatedProcessingDays?: number;
};

type BackendJurisdiction = Partial<Jurisdiction> & {
  code: string;
  name: string;
  region?: string;
  regulatoryBody?: string;
  retentionDays?: number;
};

type BackendComplianceStatus = Omit<Partial<ComplianceStatus>, "overallStatus"> & {
  jurisdiction?: string;
  overallStatus?:
    | "compliant"
    | "non_compliant"
    | "partial"
    | "pending_review"
    | ComplianceStatus["overallStatus"];
  missingCredentials?: string[];
  expiringCredentials?: Array<{
    credentialType: string;
    expiresAt: string;
    daysRemaining: number;
  }>;
  rules?: Array<{
    name: string;
    status: "pass" | "fail" | "warning";
    detail: string;
  }>;
  lastEvaluated?: string;
  nextReviewDate?: string;
};

type BackendRegulatoryChange = {
  id: string;
  jurisdiction: string;
  changeType:
    | "new_requirement"
    | "amendment"
    | "repeal"
    | "effective_date_change";
  title: string;
  description: string;
  effectiveDate: string;
  publishedAt: string;
  impactedEntities?: string[];
};

function labelFromId(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapRegion(region: string | undefined): Jurisdiction["region"] {
  switch (region) {
    case "mena":
      return "mena";
    case "europe":
    case "eu":
      return "eu";
    case "north_america":
    case "americas":
      return "americas";
    case "asia_pacific":
    case "apac":
      return "apac";
    case "africa":
      return "africa";
    default:
      return "mena";
  }
}

function mapJurisdiction(jurisdiction: BackendJurisdiction): Jurisdiction {
  return {
    id: jurisdiction.id ?? jurisdiction.code,
    name: jurisdiction.name,
    code: jurisdiction.code,
    region: mapRegion(jurisdiction.region),
    regulatoryAuthority:
      jurisdiction.regulatoryAuthority ?? jurisdiction.regulatoryBody ?? "",
    authorityUrl: jurisdiction.authorityUrl ?? "",
    frameworks: jurisdiction.frameworks ?? [jurisdiction.code],
    isActive: jurisdiction.isActive ?? true,
    lastUpdated: jurisdiction.lastUpdated ?? new Date().toISOString(),
  };
}

function normalizeOverallStatus(
  status: BackendComplianceStatus["overallStatus"],
): ComplianceStatus["overallStatus"] {
  switch (status) {
    case "partial":
      return "partially_compliant";
    case "pending_review":
      return "pending";
    case "non_compliant":
      return "non_compliant";
    case "compliant":
    case "partially_compliant":
    case "pending":
      return status;
    default:
      return "pending";
  }
}

function scoreCompliance(status: BackendComplianceStatus): number {
  if (typeof status.score === "number") return status.score;
  const missingPenalty = (status.missingCredentials?.length ?? 0) * 20;
  const expiringPenalty = (status.expiringCredentials?.length ?? 0) * 8;
  const failedPenalty =
    (status.rules?.filter((rule) => rule.status === "fail").length ?? 0) * 12;
  const warningPenalty =
    (status.rules?.filter((rule) => rule.status === "warning").length ?? 0) * 4;
  return Math.max(
    0,
    Math.min(100, 100 - missingPenalty - expiringPenalty - failedPenalty - warningPenalty),
  );
}

function mapComplianceStatus(
  jurisdictionId: string,
  status: BackendComplianceStatus,
): ComplianceStatus {
  if (
    status.jurisdictionId &&
    status.credentialStatus &&
    typeof status.score === "number"
  ) {
    return status as ComplianceStatus;
  }

  const missingCredentials =
    status.missingCredentials?.map((credential) => ({
      schemaId: credential,
      schemaName: labelFromId(credential),
      status: "missing" as const,
    })) ?? [];
  const expiringCredentials =
    status.expiringCredentials?.map((credential) => ({
      schemaId: credential.credentialType,
      schemaName: labelFromId(credential.credentialType),
      status:
        credential.daysRemaining <= 0
          ? ("expired" as const)
          : ("expiring_soon" as const),
      expiresAt: credential.expiresAt,
      daysUntilExpiry: credential.daysRemaining,
    })) ?? [];
  const blockers =
    status.blockers ??
    [
      ...(status.missingCredentials ?? []).map(
        (credential) => `Missing ${labelFromId(credential)}`,
      ),
      ...(status.rules ?? [])
        .filter((rule) => rule.status === "fail")
        .map((rule) => rule.detail),
    ];

  return {
    jurisdictionId: status.jurisdictionId ?? status.jurisdiction ?? jurisdictionId,
    jurisdictionName:
      status.jurisdictionName ?? status.jurisdiction ?? jurisdictionId,
    overallStatus: normalizeOverallStatus(status.overallStatus),
    score: scoreCompliance(status),
    credentialStatus: [
      ...(status.credentialStatus ?? []),
      ...missingCredentials,
      ...expiringCredentials,
    ],
    lastAssessedAt:
      status.lastAssessedAt ??
      status.lastEvaluated ??
      new Date().toISOString(),
    nextAssessmentAt:
      status.nextAssessmentAt ??
      status.nextReviewDate ??
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    blockers,
  };
}

function severityRank(severity: ComplianceGap["severity"]): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity];
}

function normalizeRequirementText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildGapAnalysis(
  jurisdictionId: string,
  status: ComplianceStatus,
): GapAnalysis {
  const credentialGaps: ComplianceGap[] = status.credentialStatus
    .filter((credential) => credential.status !== "valid")
    .map((credential) => {
      const severity: ComplianceGap["severity"] =
        credential.status === "missing"
          ? "critical"
          : credential.status === "expired"
            ? "high"
            : "medium";
      return {
        requirement: credential.schemaName,
        category: "credential",
        severity,
        description: `${credential.schemaName} is ${credential.status.replace("_", " ")} for ${jurisdictionId}.`,
        remediationSteps: [
          `Collect or refresh ${credential.schemaName}`,
          "Issue the updated credential to the subject wallet",
          "Re-run the jurisdiction compliance evaluation",
        ],
        estimatedEffort:
          severity === "critical" ? "5-10 business days" : "1-3 business days",
      };
    });

  const blockerGaps = status.blockers
    .filter(
      (blocker) => {
        const normalizedBlocker = normalizeRequirementText(blocker);
        return !credentialGaps.some((gap) =>
          normalizedBlocker.includes(normalizeRequirementText(gap.requirement)),
        );
      },
    )
    .map<ComplianceGap>((blocker) => ({
      requirement: blocker,
      category: "reporting",
      severity: status.overallStatus === "non_compliant" ? "high" : "medium",
      description: blocker,
      remediationSteps: [
        "Review the policy receipt evidence",
        "Resolve the failed control",
        "Re-run compliance evaluation",
      ],
      estimatedEffort: "1-5 business days",
    }));

  const gaps = [...credentialGaps, ...blockerGaps].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const totalRequired = Math.max(status.credentialStatus.length, gaps.length);
  const totalMet = status.credentialStatus.filter(
    (credential) => credential.status === "valid",
  ).length;

  return {
    jurisdictionId,
    totalRequired,
    totalMet,
    gaps,
    remediationPriority: gaps.slice(0, 5),
    estimatedRemediationDays: gaps.reduce((days, gap) => {
      if (gap.severity === "critical") return days + 10;
      if (gap.severity === "high") return days + 5;
      if (gap.severity === "medium") return days + 3;
      return days + 1;
    }, 0),
  };
}

function mapRegulatoryUpdate(change: BackendRegulatoryChange): RegulatoryUpdate {
  const category: RegulatoryUpdate["category"] =
    change.changeType === "new_requirement"
      ? "new_regulation"
      : change.changeType === "effective_date_change"
        ? "deadline"
        : "amendment";
  const severity: RegulatoryUpdate["severity"] =
    change.changeType === "new_requirement" ? "high" : "medium";

  return {
    id: change.id,
    jurisdictionId: change.jurisdiction,
    jurisdictionName: change.jurisdiction,
    title: change.title,
    summary: change.description,
    category,
    severity,
    effectiveDate: change.effectiveDate,
    publishedAt: change.publishedAt,
    sourceUrl: "",
    impactsIdentity: (change.impactedEntities ?? []).length > 0,
    requiredAction:
      category === "deadline"
        ? "Review affected controls before the effective date"
        : undefined,
  };
}

function normalizeSovereigntyStatus(
  status: Partial<DataSovereigntyStatus>,
): DataSovereigntyStatus {
  const gdprStatus = status.gdprStatus ?? {
    dataProcessingAgreement: false,
    dataProtectionOfficer: false,
    privacyImpactAssessment: false,
    consentManagement: false,
    rightToErasure: false,
    dataPortability: false,
    breachNotificationProcess: false,
    overallCompliant: false,
  };
  return {
    compliantRegions: status.compliantRegions ?? [],
    nonCompliantRegions: status.nonCompliantRegions ?? [],
    dataResidencyMap: status.dataResidencyMap ?? [],
    gdprStatus,
    pendingTransfers: status.pendingTransfers ?? 0,
  };
}

function mapCrossBorderResult(
  params: { fromJurisdiction: string; toJurisdiction: string },
  result: EnterpriseCrossBorderResult,
): CrossBorderAssessment {
  const eligible = result.allowed ?? result.eligible ?? false;
  return {
    fromJurisdiction: params.fromJurisdiction,
    toJurisdiction: params.toJurisdiction,
    eligible,
    riskLevel: result.riskLevel ?? (eligible ? "low" : "high"),
    requiredActions: result.requiredActions ?? result.requirements ?? [],
    additionalCredentials: result.additionalCredentials ?? [],
    estimatedProcessingDays: result.estimatedProcessingDays ?? 0,
    restrictions: result.restrictions ?? [],
    bilateralAgreements:
      result.bilateralAgreements ?? result.mutualRecognitionAgreements ?? [],
  };
}

// ---------------------------------------------------------------------------
// Jurisdictions
// ---------------------------------------------------------------------------

export function useJurisdictions() {
  return useQuery({
    queryKey: regulatoryKeys.jurisdictions(),
    queryFn: async () => {
      const jurisdictions = await apiClient.get<BackendJurisdiction[]>(
        "/api/v1/enterprise/compliance/jurisdictions",
      );
      return jurisdictions.map(mapJurisdiction);
    },
    staleTime: 300_000,
  });
}

export function useJurisdictionRequirements(
  jurisdictionId: string | undefined,
) {
  return useQuery({
    queryKey: regulatoryKeys.requirements(jurisdictionId ?? ""),
    queryFn: async () => {
      const requirements = await apiClient.get<JurisdictionRequirements>(
        `/api/v1/enterprise/compliance/jurisdictions/${encodeURIComponent(
          jurisdictionId as string,
        )}/requirements`,
      );
      return {
        ...requirements,
        requiredCredentials: requirements.requiredCredentials.map(
          (credential) => ({
            ...credential,
            schemaName: credential.schemaName || labelFromId(credential.schemaId),
          }),
        ),
      };
    },
    enabled: !!jurisdictionId,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Compliance Status
// ---------------------------------------------------------------------------

export function useComplianceStatus(jurisdictionId: string | undefined) {
  const { address } = useAccount();

  return useQuery({
    queryKey: regulatoryKeys.compliance(jurisdictionId ?? ""),
    queryFn: async () => {
      const status = await apiClient.get<BackendComplianceStatus>(
        `/api/v1/enterprise/compliance/status/${address}`,
        { jurisdiction: jurisdictionId as string },
      );
      return mapComplianceStatus(jurisdictionId as string, status);
    },
    enabled: !!jurisdictionId && !!address,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Cross-Border Assessment
// ---------------------------------------------------------------------------

export function useCheckCrossBorder() {
  return useMutation({
    mutationFn: async (params: {
      fromJurisdiction: string;
      toJurisdiction: string;
    }): Promise<CrossBorderAssessment> => {
      const result = await apiClient.post<EnterpriseCrossBorderResult>(
        "/api/v1/enterprise/compliance/cross-border",
        {
          sourceJurisdiction: params.fromJurisdiction,
          targetJurisdiction: params.toJurisdiction,
          entityId: "current-subject",
          dataCategories: ["personal"],
          purpose: "identity_verification",
        },
      );
      return mapCrossBorderResult(params, result);
    },
    onSuccess: (data) => {
      if (data.eligible) {
        toast.success("Cross-border transfer eligible", {
          description: `Risk level: ${data.riskLevel}, est. ${data.estimatedProcessingDays} day(s)`,
        });
      } else {
        toast.warning("Cross-border transfer not eligible", {
          description: `${data.restrictions.length} restriction(s) apply`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Cross-border check failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Gap Analysis
// ---------------------------------------------------------------------------

export function useGapAnalysis(jurisdictionId: string | undefined) {
  const { address } = useAccount();

  return useQuery({
    queryKey: regulatoryKeys.gaps(jurisdictionId ?? ""),
    queryFn: async () => {
      const status = await apiClient.get<BackendComplianceStatus>(
        `/api/v1/enterprise/compliance/status/${address}`,
        { jurisdiction: jurisdictionId as string },
      );
      return buildGapAnalysis(
        jurisdictionId as string,
        mapComplianceStatus(jurisdictionId as string, status),
      );
    },
    enabled: !!jurisdictionId && !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Regulatory Feed
// ---------------------------------------------------------------------------

export function useRegulatoryFeed() {
  return useQuery({
    queryKey: regulatoryKeys.feed(),
    queryFn: async () => {
      const changes = await apiClient.get<BackendRegulatoryChange[]>(
        "/api/v1/enterprise/compliance/regulatory-changes",
      );
      return changes.map(mapRegulatoryUpdate);
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Data Sovereignty
// ---------------------------------------------------------------------------

export function useDataSovereigntyStatus() {
  const { address } = useAccount();

  return useQuery({
    queryKey: regulatoryKeys.sovereignty(),
    queryFn: async () => {
      const status = await apiClient.get<Partial<DataSovereigntyStatus>>(
        `/api/v1/enterprise/compliance/sovereignty/status/${encodeURIComponent(
          address as string,
        )}`,
      );
      return normalizeSovereigntyStatus(status);
    },
    enabled: !!address,
    staleTime: 120_000,
  });
}
