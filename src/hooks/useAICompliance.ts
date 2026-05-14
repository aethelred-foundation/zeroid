/**
 * useAICompliance — Hook for AI-powered compliance operations.
 *
 * Provides sanctions/PEP screening, risk assessment, advisor queries,
 * compliance alert management, report generation, and regulatory change
 * simulation. All mutations surface feedback via sonner toasts.
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import type { ISODateString } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreeningResult {
  screeningId: string;
  identityId: string;
  result: "clear" | "potential_match" | "confirmed_match" | "inconclusive";
  matchScore: number;
  matchedLists: SanctionsListMatch[];
  pepMatches: PepMatch[];
  adverseMedia: AdverseMediaHit[];
  riskIndicators: string[];
  screenedAt: ISODateString;
  expiresAt: ISODateString;
  listsChecked: string[];
}

export interface SanctionsListMatch {
  listName: string;
  listSource: string;
  matchedName: string;
  matchConfidence: number;
  entityType: "individual" | "entity" | "vessel" | "aircraft";
  sanctions: string[];
  listedSince: ISODateString;
  lastUpdated: ISODateString;
  sdnId?: string;
}

export interface PepMatch {
  name: string;
  position: string;
  country: string;
  level:
    | "head_of_state"
    | "senior_official"
    | "family_member"
    | "close_associate";
  active: boolean;
  matchConfidence: number;
  source: string;
}

export interface AdverseMediaHit {
  headline: string;
  source: string;
  publishedAt: ISODateString;
  relevanceScore: number;
  categories: string[];
  url: string;
}

export interface ScreenIdentityInput {
  identityId: string;
  fullName: string;
  jurisdiction: string;
  dateOfBirth?: string;
  nationality?: string;
  aliases?: string[];
  documentNumbers?: string[];
}

export interface RiskAssessment {
  assessmentId: string;
  entityId: string;
  entityType: "identity" | "credential" | "transaction";
  compositeScore: number;
  decision: "approve" | "review" | "reject" | "escalate";
  factors: RiskFactorDetail[];
  trend: "improving" | "stable" | "degrading" | "volatile";
  jurisdiction?: string;
  regulatoryRegime?: string;
  confidence: number;
  timestamp: ISODateString;
}

export interface RiskFactorDetail {
  name: string;
  category: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
  impact: "increasing" | "decreasing" | "neutral";
  explanation: string;
}

export interface ComplianceScore {
  entityId: string;
  jurisdiction: string;
  overallScore: number;
  rating: "excellent" | "good" | "fair" | "poor" | "critical";
  components: Record<string, number>;
  computedAt: ISODateString;
}

export interface RiskAssessmentResponse {
  riskAssessment: RiskAssessment;
  complianceScore: ComplianceScore;
}

export interface ComplianceAlert {
  alertId: string;
  entityId: string;
  level:
    | "info"
    | "warning"
    | "violation"
    | "critical"
    | "low"
    | "medium"
    | "high";
  category: string;
  title: string;
  description: string;
  regulation: string;
  actionRequired: string;
  createdAt: ISODateString;
  acknowledgedAt?: ISODateString;
  resolvedAt?: ISODateString;
  source?: "compliance" | "fraud";
}

export interface ComplianceAlertsResponse {
  alerts: ComplianceAlert[];
  total: number;
  complianceAlertCount: number;
  fraudAlertCount: number;
}

export interface AdvisorResponse {
  queryId: string;
  question: string;
  answer: string;
  confidence: number;
  citations: AdvisorCitation[];
  relatedTopics: string[];
  disclaimer: string;
  timestamp: ISODateString;
}

export interface AdvisorCitation {
  regulation: string;
  section: string;
  text: string;
}

export interface ComplianceReport {
  reportId: string;
  entityId: string;
  reportType: ComplianceReportType;
  status: "generating" | "complete" | "failed";
  summary: string;
  sections: ComplianceReportSection[];
  complianceScore: number;
  gaps: ComplianceGap[];
  recommendations: string[];
  generatedAt: ISODateString;
  validUntil: ISODateString;
  jurisdiction: string;
  regulatoryFramework: string;
}

export type ComplianceReportType =
  | "kyc"
  | "aml"
  | "sanctions"
  | "pep"
  | "travel_rule"
  | "comprehensive";

export interface ComplianceReportSection {
  title: string;
  status: "pass" | "warning" | "fail" | "not_applicable";
  findings: string[];
  evidence: Record<string, unknown>;
}

export interface ComplianceGap {
  gapId: string;
  category: string;
  severity: "info" | "warning" | "violation" | "critical";
  description: string;
  regulation: string;
  remediation: string;
  deadline?: ISODateString;
}

export interface RegulationSimulation {
  changeId: string;
  regulation: string;
  effectiveDate: ISODateString;
  description: string;
  impactedEntities: number;
  impactedCredentialTypes: string[];
  requiredActions: string[];
  estimatedEffort: "low" | "medium" | "high" | "critical";
  automationPossible: boolean;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const complianceKeys = {
  all: ["compliance"] as const,
  screening: (id: string) => [...complianceKeys.all, "screening", id] as const,
  risk: (id: string) => [...complianceKeys.all, "risk", id] as const,
  alerts: () => [...complianceKeys.all, "alerts"] as const,
};

const AI_COMPLIANCE_BASE = "/api/v1/ai/compliance";

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export function useScreenIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: ScreenIdentityInput,
    ): Promise<ScreeningResult> => {
      return apiClient.post<ScreeningResult>(
        `${AI_COMPLIANCE_BASE}/screen`,
        input,
      ) as unknown as ScreeningResult;
    },
    onSuccess: (data, input) => {
      const hits = data.result !== "clear";
      if (hits) {
        const matchCount =
          data.matchedLists.length +
          data.pepMatches.length +
          data.adverseMedia.length;
        toast.warning("Screening flagged potential matches", {
          description: `${matchCount} match(es) found — review required`,
        });
      } else {
        toast.success("Screening complete — no matches found");
      }
      queryClient.invalidateQueries({
        queryKey: complianceKeys.screening(input.identityId),
      });
    },
    onError: (err: Error) => {
      toast.error("Screening failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Risk Assessment
// ---------------------------------------------------------------------------

export function useRiskAssessment(identityId: string | undefined) {
  return useQuery({
    queryKey: complianceKeys.risk(identityId ?? ""),
    queryFn: () =>
      apiClient.get<RiskAssessmentResponse>(
        `${AI_COMPLIANCE_BASE}/risk/${identityId}`,
      ) as unknown as RiskAssessmentResponse,
    enabled: !!identityId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useRefreshRiskAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (identityId: string): Promise<RiskAssessmentResponse> => {
      return apiClient.get<RiskAssessmentResponse>(
        `${AI_COMPLIANCE_BASE}/risk/${identityId}`,
      ) as unknown as RiskAssessmentResponse;
    },
    onSuccess: (data, identityId) => {
      toast.success("Risk assessment updated", {
        description: `Score: ${data.riskAssessment.compositeScore} (${data.riskAssessment.decision})`,
      });
      queryClient.setQueryData(complianceKeys.risk(identityId), data);
    },
    onError: (err: Error) => {
      toast.error("Risk refresh failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Compliance Advisor
// ---------------------------------------------------------------------------

export function useComplianceAdvisor() {
  const sendMessage = useMutation({
    mutationFn: async (message: string): Promise<AdvisorResponse> => {
      return apiClient.post<AdvisorResponse>(
        `${AI_COMPLIANCE_BASE}/advisor/query`,
        {
          question: message,
          context: {},
        },
      ) as unknown as AdvisorResponse;
    },
    onError: (err: Error) => {
      toast.error("Advisor request failed", { description: err.message });
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
      apiClient.get<ComplianceAlertsResponse>(
        `${AI_COMPLIANCE_BASE}/alerts`,
      ) as unknown as ComplianceAlertsResponse,
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string): Promise<void> => {
      await apiClient.post(
        `${AI_COMPLIANCE_BASE}/alerts/${alertId}/acknowledge`,
        {},
      );
    },
    onSuccess: () => {
      toast.success("Alert acknowledged");
      queryClient.invalidateQueries({ queryKey: complianceKeys.alerts() });
    },
    onError: (err: Error) => {
      toast.error("Failed to acknowledge alert", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

export function useGenerateReport() {
  return useMutation({
    mutationFn: async (params: {
      entityId: string;
      reportType: ComplianceReportType;
      jurisdiction: string;
    }): Promise<ComplianceReport> => {
      return apiClient.post<ComplianceReport>(
        `${AI_COMPLIANCE_BASE}/report`,
        params,
      ) as unknown as ComplianceReport;
    },
    onSuccess: (data) => {
      toast.success("Report generated", {
        description: `${data.reportType} report ${data.status}`,
      });
    },
    onError: (err: Error) => {
      toast.error("Report generation failed", { description: err.message });
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
      changes: string;
      jurisdiction: string;
    }): Promise<RegulationSimulation> => {
      return apiClient.post<RegulationSimulation>(
        `${AI_COMPLIANCE_BASE}/simulate`,
        params,
      ) as unknown as RegulationSimulation;
    },
    onSuccess: (data) => {
      if (
        data.estimatedEffort === "high" ||
        data.estimatedEffort === "critical"
      ) {
        toast.warning("Simulation complete", {
          description: `${data.impactedEntities} impacted entity(ies); ${data.requiredActions.length} action(s) required`,
        });
      } else {
        toast.success("Simulation complete — no new gaps detected");
      }
    },
    onError: (err: Error) => {
      toast.error("Simulation failed", { description: err.message });
    },
  });
}
