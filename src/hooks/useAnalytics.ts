/**
 * useAnalytics — Hook for privacy-preserving identity analytics.
 *
 * Provides privacy scores, credential usage analytics, verifier insights,
 * data exposure tracking, anonymised network benchmarks, privacy
 * recommendations, and encrypted report export.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { ISODateString } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivacyScore {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
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
  direction: 'improving' | 'stable' | 'declining';
  changePercent: number;
  period: string;
  history: { date: ISODateString; score: number }[];
}

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y' | 'all';

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
  riskLevel: 'low' | 'medium' | 'high';
  highRiskExposures: number;
}

export interface ExposureEvent {
  id: string;
  timestamp: ISODateString;
  verifierDid: string;
  verifierName: string;
  credentialSchemaName: string;
  attributesDisclosed: string[];
  disclosureMethod: 'full' | 'selective' | 'zk_proof';
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
  priority: 'critical' | 'high' | 'medium' | 'low';
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
  format: 'json' | 'csv' | 'pdf';
  encryptionMethod: 'aes-256-gcm' | 'chacha20-poly1305';
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
  all: ['analytics'] as const,
  privacy: () => [...analyticsKeys.all, 'privacy'] as const,
  credentialUsage: (p: AnalyticsPeriod) => [...analyticsKeys.all, 'credential-usage', p] as const,
  verifiers: () => [...analyticsKeys.all, 'verifiers'] as const,
  exposure: () => [...analyticsKeys.all, 'exposure'] as const,
  benchmarks: () => [...analyticsKeys.all, 'benchmarks'] as const,
  recommendations: () => [...analyticsKeys.all, 'recommendations'] as const,
};

// ---------------------------------------------------------------------------
// Privacy Score
// ---------------------------------------------------------------------------

export function usePrivacyScore() {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.privacy(),
    queryFn: () =>
      apiClient.get<PrivacyScore>('/api/v1/analytics/privacy-score', {
        owner: address as string,
      }) as unknown as PrivacyScore,
    enabled: !!address,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Credential Usage
// ---------------------------------------------------------------------------

export function useCredentialUsageAnalytics(period: AnalyticsPeriod = '30d') {
  const { address } = useAccount();

  return useQuery({
    queryKey: analyticsKeys.credentialUsage(period),
    queryFn: () =>
      apiClient.get<CredentialUsageAnalytics>('/api/v1/analytics/credential-usage', {
        owner: address as string,
        period,
      }) as unknown as CredentialUsageAnalytics,
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
    queryFn: () =>
      apiClient.get<VerifierAnalytics>('/api/v1/analytics/verifiers', {
        owner: address as string,
      }) as unknown as VerifierAnalytics,
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
    queryFn: () =>
      apiClient.get<DataExposureTimeline>('/api/v1/analytics/exposure', {
        owner: address as string,
      }) as unknown as DataExposureTimeline,
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
    queryFn: () =>
      apiClient.get<NetworkBenchmarks>('/api/v1/analytics/benchmarks', {
        owner: address as string,
      }) as unknown as NetworkBenchmarks,
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
    queryFn: () =>
      apiClient.get<PrivacyRecommendation[]>('/api/v1/analytics/recommendations', {
        owner: address as string,
      }) as unknown as PrivacyRecommendation[],
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
      format: 'json' | 'csv' | 'pdf';
      period?: AnalyticsPeriod;
      sections?: string[];
      encryptionKey?: string;
    }): Promise<AnalyticsExport> => {
      return apiClient.post<AnalyticsExport>(
        '/api/v1/analytics/export',
        params,
      ) as unknown as AnalyticsExport;
    },
    onSuccess: (data) => {
      toast.success('Analytics report exported', {
        description: `${data.format.toUpperCase()} report (${(data.sizeBytes / 1024).toFixed(1)} KB) — encrypted with ${data.encryptionMethod}`,
      });
    },
    onError: (err: Error) => {
      toast.error('Export failed', { description: err.message });
    },
  });
}
