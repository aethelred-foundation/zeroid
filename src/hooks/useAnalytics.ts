/**
 * useAnalytics — Hook for privacy-preserving identity analytics.
 *
 * Provides privacy scores, credential usage analytics, verifier insights,
 * data exposure tracking, anonymised network benchmarks, privacy
 * recommendations, and encrypted report export.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ZeroIDApiError } from "@/lib/api/client";
import type { ISODateString } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivacyScore {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: PrivacyBreakdown;
  trend: ScoreTrend;
  lastCalculatedAt: ISODateString;
  percentileRank: number;
}

export interface PrivacyBreakdown {
  selectiveDisclosureUsage: number;
  zkProofAdoption: number;
  credentialMinimisation: number;
  dataExposureControl: number;
  verifierDiversity: number;
  consentManagement: number;
}

export interface ScoreTrend {
  direction: "improving" | "stable" | "declining";
  changePercent: number;
  period: string;
  history: { date: ISODateString; score: number }[];
}

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y" | "all";

export interface CredentialUsageAnalytics {
  period: AnalyticsPeriod;
  totalPresentations: number;
  uniqueVerifiers: number;
  zkProofPresentations: number;
  selectiveDisclosurePresentations: number;
  fullDisclosurePresentations: number;
  privacyPreservingRatio: number;
  byCredentialType: CredentialTypeUsage[];
  byDay: DailyUsageStat[];
  topAttributes: AttributeUsage[];
}

export interface CredentialTypeUsage {
  schemaName: string;
  schemaId: string;
  presentationCount: number;
  zkProofCount: number;
  selectiveDisclosureCount: number;
  lastUsedAt: ISODateString;
}

export interface DailyUsageStat {
  date: ISODateString;
  presentations: number;
  zkProofs: number;
  selectiveDisclosures: number;
}

export interface AttributeUsage {
  attributeKey: string;
  disclosureCount: number;
  proofOnlyCount: number;
  totalRequests: number;
  privacyRatio: number;
}

export interface VerifierAnalytics {
  totalVerifiers: number;
  verifiers: VerifierProfile[];
  requestsByPurpose: PurposeBreakdown[];
  trustDistribution: TrustBucket[];
}

export interface VerifierProfile {
  verifierDid: string;
  verifierName: string;
  requestCount: number;
  lastRequestAt: ISODateString;
  attributesRequested: string[];
  zkProofAcceptance: boolean;
  trustScore: number;
  jurisdiction: string;
}

export interface PurposeBreakdown {
  purpose: string;
  count: number;
  percentage: number;
}

export interface TrustBucket {
  range: string;
  count: number;
}

export interface DataExposureTimeline {
  entries: ExposureEvent[];
  totalDisclosures: number;
  uniqueAttributesExposed: number;
  uniqueVerifiers: number;
  riskLevel: "low" | "medium" | "high";
  highRiskExposures: number;
}

export interface ExposureEvent {
  id: string;
  timestamp: ISODateString;
  verifierDid: string;
  verifierName: string;
  credentialSchemaName: string;
  attributesDisclosed: string[];
  disclosureMethod: "full" | "selective" | "zk_proof";
  purpose: string;
  riskScore: number;
  consentRecordId: string;
}

export interface NetworkBenchmarks {
  calculatedAt: ISODateString;
  sampleSize: number;
  benchmarks: BenchmarkMetric[];
  userPercentiles: Record<string, number>;
}

export interface BenchmarkMetric {
  metric: string;
  label: string;
  networkMedian: number;
  networkP25: number;
  networkP75: number;
  userValue: number;
  unit: string;
}

export interface PrivacyRecommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  currentBehavior: string;
  suggestedAction: string;
  estimatedImpact: number;
  implementationSteps: string[];
}

export interface AnalyticsExport {
  id: string;
  format: "json" | "csv" | "pdf";
  encryptionMethod: "aes-256-gcm" | "chacha20-poly1305";
  downloadUrl: string;
  generatedAt: ISODateString;
  expiresAt: ISODateString;
  sizeBytes: number;
  checksum: string;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const analyticsKeys = {
  all: ["analytics"] as const,
  privacy: () => [...analyticsKeys.all, "privacy"] as const,
  credentialUsage: (p: AnalyticsPeriod) =>
    [...analyticsKeys.all, "credential-usage", p] as const,
  verifiers: () => [...analyticsKeys.all, "verifiers"] as const,
  exposure: () => [...analyticsKeys.all, "exposure"] as const,
  benchmarks: () => [...analyticsKeys.all, "benchmarks"] as const,
  recommendations: () => [...analyticsKeys.all, "recommendations"] as const,
};

function unsupportedAnalyticsFlow(message: string, code: string): never {
  throw new ZeroIDApiError(message, code, 501);
}

// ---------------------------------------------------------------------------
// Privacy Score
// ---------------------------------------------------------------------------

export function usePrivacyScore() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.privacy(),
    queryFn: () => {
      void address;
      unsupportedAnalyticsFlow(
        "Privacy score analytics are not exposed by the backend API.",
        "ANALYTICS_PRIVACY_SCORE_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Credential Usage
// ---------------------------------------------------------------------------

export function useCredentialUsageAnalytics(period: AnalyticsPeriod = "30d") {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.credentialUsage(period),
    queryFn: () => {
      void address;
      void period;
      unsupportedAnalyticsFlow(
        "Credential usage analytics are not exposed by the backend API.",
        "ANALYTICS_CREDENTIAL_USAGE_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Verifier Analytics
// ---------------------------------------------------------------------------

export function useVerifierAnalytics() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.verifiers(),
    queryFn: () => {
      void address;
      unsupportedAnalyticsFlow(
        "Verifier analytics are not exposed by the backend API.",
        "ANALYTICS_VERIFIERS_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Data Exposure Timeline
// ---------------------------------------------------------------------------

export function useDataExposureTimeline() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.exposure(),
    queryFn: () => {
      void address;
      unsupportedAnalyticsFlow(
        "Data exposure analytics are not exposed by the backend API.",
        "ANALYTICS_EXPOSURE_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Network Benchmarks
// ---------------------------------------------------------------------------

export function useNetworkBenchmarks() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.benchmarks(),
    queryFn: () => {
      void address;
      unsupportedAnalyticsFlow(
        "Network benchmark analytics are not exposed by the backend API.",
        "ANALYTICS_BENCHMARKS_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Privacy Recommendations
// ---------------------------------------------------------------------------

export function usePrivacyRecommendations() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.recommendations(),
    queryFn: () => {
      void address;
      unsupportedAnalyticsFlow(
        "Privacy recommendations are not exposed by the backend API.",
        "ANALYTICS_RECOMMENDATIONS_UNAVAILABLE",
      );
    },
    enabled: !!address,
    staleTime: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Export Analytics Report
// ---------------------------------------------------------------------------

export function useExportAnalyticsReport() {
  return useMutation({
    mutationFn: async (params: {
      format: "json" | "csv" | "pdf";
      period?: AnalyticsPeriod;
      sections?: string[];
      encryptionKey?: string;
    }): Promise<AnalyticsExport> => {
      void params;
      unsupportedAnalyticsFlow(
        "Analytics report export is not exposed by the backend API.",
        "ANALYTICS_EXPORT_UNAVAILABLE",
      );
    },
    onSuccess: (data) => {
      toast.success("Analytics report exported", {
        description: `${data.format.toUpperCase()} report (${(data.sizeBytes / 1024).toFixed(1)} KB) — encrypted with ${data.encryptionMethod}`,
      });
    },
    onError: (err: Error) => {
      toast.error("Export failed", { description: err.message });
    },
  });
}
