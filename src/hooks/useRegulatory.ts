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
import { apiClient, ZeroIDApiError } from "@/lib/api/client";
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

function unsupportedRegulatoryFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
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
    queryFn: () =>
      apiClient.get<Jurisdiction[]>(
        "/api/v1/enterprise/compliance/jurisdictions",
      ) as unknown as Jurisdiction[],
    staleTime: 300_000,
  });
}

export function useJurisdictionRequirements(
  jurisdictionId: string | undefined,
) {
  return useQuery({
    queryKey: regulatoryKeys.requirements(jurisdictionId ?? ""),
    queryFn: () => {
      void jurisdictionId;
      unsupportedRegulatoryFlow(
        "Jurisdiction requirement detail is not exposed by the backend API.",
        "REGULATORY_REQUIREMENTS_UNAVAILABLE",
      );
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
    queryFn: () =>
      apiClient.get<ComplianceStatus>(
        `/api/v1/enterprise/compliance/status/${address}`,
        { jurisdiction: jurisdictionId as string },
      ) as unknown as ComplianceStatus,
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
    queryFn: () => {
      void jurisdictionId;
      void address;
      unsupportedRegulatoryFlow(
        "Regulatory gap analysis is not exposed by the backend API.",
        "REGULATORY_GAP_ANALYSIS_UNAVAILABLE",
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
    queryFn: () =>
      unsupportedRegulatoryFlow(
        "Regulatory change feed is not exposed by the backend API.",
        "REGULATORY_FEED_UNAVAILABLE",
      ),
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
    queryFn: () => {
      void address;
      unsupportedRegulatoryFlow(
        "Data sovereignty status is not exposed by the backend API.",
        "REGULATORY_DATA_SOVEREIGNTY_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 120_000,
  });
}
