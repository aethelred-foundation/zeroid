/**
 * useAICompliance — Hook for AI-powered compliance operations.
 *
 * Provides sanctions/PEP screening, risk assessment, AI copilot queries,
 * compliance alert management, report generation, and regulatory change
 * simulation. All mutations surface feedback via sonner toasts.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type {
  Address,
  ISODateString,
} from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreeningResult {
  identityId: string;
  sanctionsHit: boolean;
  pepHit: boolean;
  adverseMediaHits: number;
  matchedEntities: MatchedEntity[];
  screenedAt: ISODateString;
  expiresAt: ISODateString;
  confidence: number;
}

export interface MatchedEntity {
  name: string;
  listSource: string;
  matchScore: number;
  category: 'sanctions' | 'pep' | 'adverse_media' | 'watchlist';
  jurisdiction: string;
}

export interface RiskAssessment {
  identityId: string;
  compositeScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  assessedAt: ISODateString;
  nextReviewAt: ISODateString;
  modelVersion: string;
}

export interface RiskFactor {
  category: string;
  score: number;
  weight: number;
  description: string;
  mitigations: string[];
}

export interface ComplianceAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  title: string;
  description: string;
  identityId?: string;
  createdAt: ISODateString;
  acknowledgedAt?: ISODateString;
  resolvedAt?: ISODateString;
}

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: ISODateString;
  citations?: CopilotCitation[];
}

export interface CopilotCitation {
  regulation: string;
  section: string;
  url?: string;
}

export interface ComplianceReport {
  id: string;
  type: ComplianceReportType;
  generatedAt: ISODateString;
  format: 'pdf' | 'json' | 'csv';
  downloadUrl: string;
  expiresAt: ISODateString;
}

export type ComplianceReportType =
  | 'sar'
  | 'ctr'
  | 'risk_summary'
  | 'audit_trail'
  | 'regulatory_filing';

export interface RegulationSimulation {
  regulation: string;
  changes: Record<string, unknown>;
  impactedIdentities: number;
  complianceGapsBefore: number;
  complianceGapsAfter: number;
  estimatedRemediationCost: number;
  affectedJurisdictions: string[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const complianceKeys = {
  all: ['compliance'] as const,
  screening: (id: string) => [...complianceKeys.all, 'screening', id] as const,
  risk: (id: string) => [...complianceKeys.all, 'risk', id] as const,
  alerts: () => [...complianceKeys.all, 'alerts'] as const,
};

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export function useScreenIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (identityId: string): Promise<ScreeningResult> => {
      return apiClient.post<ScreeningResult>('/api/v1/compliance/screen', {
        identityId,
        screeningTypes: ['sanctions', 'pep', 'adverse_media'],
      }) as unknown as ScreeningResult;
    },
    onSuccess: (data, identityId) => {
      const hits = data.sanctionsHit || data.pepHit;
      if (hits) {
        toast.warning('Screening flagged potential matches', {
          description: `${data.matchedEntities.length} match(es) found — review required`,
        });
      } else {
        toast.success('Screening complete — no matches found');
      }
      queryClient.invalidateQueries({ queryKey: complianceKeys.screening(identityId) });
    },
    onError: (err: Error) => {
      toast.error('Screening failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Risk Assessment
// ---------------------------------------------------------------------------

export function useRiskAssessment(identityId: string | undefined) {
  return useQuery({
    queryKey: complianceKeys.risk(identityId ?? ''),
    queryFn: () =>
      apiClient.get<RiskAssessment>(`/api/v1/compliance/risk/${identityId}`) as unknown as RiskAssessment,
    enabled: !!identityId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useRefreshRiskAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (identityId: string): Promise<RiskAssessment> => {
      return apiClient.post<RiskAssessment>('/api/v1/compliance/risk/refresh', {
        identityId,
      }) as unknown as RiskAssessment;
    },
    onSuccess: (data, identityId) => {
      toast.success('Risk assessment updated', {
        description: `Score: ${data.compositeScore} (${data.riskLevel})`,
      });
      queryClient.setQueryData(complianceKeys.risk(identityId), data);
    },
    onError: (err: Error) => {
      toast.error('Risk refresh failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Compliance Copilot
// ---------------------------------------------------------------------------

export function useComplianceCopilot() {
  const queryClient = useQueryClient();

  const sendMessage = useMutation({
    mutationFn: async (message: string): Promise<CopilotMessage> => {
      return apiClient.post<CopilotMessage>('/api/v1/compliance/copilot', {
        message,
        context: 'zeroid_compliance',
      }) as unknown as CopilotMessage;
    },
    onError: (err: Error) => {
      toast.error('Copilot request failed', { description: err.message });
    },
  });

  return {
    sendMessage: sendMessage.mutateAsync,
    isLoading: sendMessage.isPending,
    error: sendMessage.error,
    lastResponse: sendMessage.data,
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function useComplianceAlerts() {
  const { address } = useAccount();

  return useQuery({
    queryKey: complianceKeys.alerts(),
    queryFn: () =>
      apiClient.get<ComplianceAlert[]>('/api/v1/compliance/alerts', {
        owner: address as string,
      }) as unknown as ComplianceAlert[],
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string): Promise<void> => {
      await apiClient.post(`/api/v1/compliance/alerts/${alertId}/acknowledge`, {});
    },
    onSuccess: () => {
      toast.success('Alert acknowledged');
      queryClient.invalidateQueries({ queryKey: complianceKeys.alerts() });
    },
    onError: (err: Error) => {
      toast.error('Failed to acknowledge alert', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

export function useGenerateReport() {
  return useMutation({
    mutationFn: async (params: {
      type: ComplianceReportType;
      startDate?: ISODateString;
      endDate?: ISODateString;
      identityIds?: string[];
      format?: 'pdf' | 'json' | 'csv';
    }): Promise<ComplianceReport> => {
      return apiClient.post<ComplianceReport>('/api/v1/compliance/reports/generate', params) as unknown as ComplianceReport;
    },
    onSuccess: (data) => {
      toast.success('Report generated', {
        description: `${data.type} report ready for download`,
      });
    },
    onError: (err: Error) => {
      toast.error('Report generation failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Regulatory Change Simulation
// ---------------------------------------------------------------------------

export function useSimulateRegChange() {
  return useMutation({
    mutationFn: async (params: {
      regulation: string;
      changes: Record<string, unknown>;
    }): Promise<RegulationSimulation> => {
      return apiClient.post<RegulationSimulation>(
        '/api/v1/compliance/simulate',
        params,
      ) as unknown as RegulationSimulation;
    },
    onSuccess: (data) => {
      const delta = data.complianceGapsAfter - data.complianceGapsBefore;
      if (delta > 0) {
        toast.warning('Simulation complete', {
          description: `${delta} new compliance gap(s) detected across ${data.affectedJurisdictions.length} jurisdiction(s)`,
        });
      } else {
        toast.success('Simulation complete — no new gaps detected');
      }
    },
    onError: (err: Error) => {
      toast.error('Simulation failed', { description: err.message });
    },
  });
}
