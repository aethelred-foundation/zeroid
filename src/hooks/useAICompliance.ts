/**
 * useAICompliance — Hook for AI-powered compliance operations.
 *
 * Provides sanctions/PEP screening, risk assessment, advisor queries,
 * compliance alert management, report generation, and regulatory change
 * impact assessment. All mutations surface feedback via sonner toasts.
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { z } from "zod";
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
  unavailableChecks: string[];
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

export interface RiskAssessmentResponse {
  riskAssessment: RiskAssessment;
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

export interface RegulationImpactAssessment {
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

export type RegulationSimulation = RegulationImpactAssessment;

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
// Runtime response contracts
// ---------------------------------------------------------------------------

export class AIComplianceResponseContractError extends Error {
  constructor(operation: string, cause: z.ZodError) {
    super(
      `ZeroID returned an invalid ${operation} response: ${cause.issues
        .map(
          (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
    this.name = "AIComplianceResponseContractError";
  }
}

const isoDateSchema = z.string().datetime({ offset: true });
const nonEmptyStringSchema = z.string().trim().min(1);
const percentageSchema = z.number().finite().min(0).max(100);
const probabilitySchema = z.number().finite().min(0).max(1);

const sanctionsListMatchSchema = z
  .object({
    listName: nonEmptyStringSchema,
    listSource: nonEmptyStringSchema,
    matchedName: nonEmptyStringSchema,
    matchConfidence: probabilitySchema,
    entityType: z.enum(["individual", "entity", "vessel", "aircraft"]),
    sanctions: z.array(nonEmptyStringSchema),
    listedSince: isoDateSchema,
    lastUpdated: isoDateSchema,
    sdnId: nonEmptyStringSchema.optional(),
  })
  .strict();

const pepMatchSchema = z
  .object({
    name: nonEmptyStringSchema,
    position: nonEmptyStringSchema,
    country: nonEmptyStringSchema,
    level: z.enum([
      "head_of_state",
      "senior_official",
      "family_member",
      "close_associate",
    ]),
    active: z.boolean(),
    matchConfidence: probabilitySchema,
    source: nonEmptyStringSchema,
  })
  .strict();

const adverseMediaHitSchema = z
  .object({
    headline: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    publishedAt: isoDateSchema,
    relevanceScore: probabilitySchema,
    categories: z.array(nonEmptyStringSchema),
    url: z.string().url(),
  })
  .strict();

const screeningResultSchema = z
  .object({
    screeningId: nonEmptyStringSchema,
    identityId: z.string().uuid(),
    result: z.enum([
      "clear",
      "potential_match",
      "confirmed_match",
      "inconclusive",
    ]),
    matchScore: percentageSchema,
    matchedLists: z.array(sanctionsListMatchSchema),
    pepMatches: z.array(pepMatchSchema),
    adverseMedia: z.array(adverseMediaHitSchema),
    riskIndicators: z.array(nonEmptyStringSchema),
    screenedAt: isoDateSchema,
    expiresAt: isoDateSchema,
    listsChecked: z.array(nonEmptyStringSchema),
    unavailableChecks: z.array(nonEmptyStringSchema),
  })
  .strict();

const riskFactorSchema = z
  .object({
    name: nonEmptyStringSchema,
    category: nonEmptyStringSchema,
    rawValue: z.number().finite(),
    normalizedScore: percentageSchema,
    weight: z.number().finite().min(0),
    impact: z.enum(["increasing", "decreasing", "neutral"]),
    explanation: nonEmptyStringSchema,
  })
  .strict();

const riskAssessmentSchema = z
  .object({
    assessmentId: nonEmptyStringSchema,
    entityId: nonEmptyStringSchema,
    entityType: z.enum(["identity", "credential", "transaction"]),
    compositeScore: percentageSchema,
    decision: z.enum(["approve", "review", "reject", "escalate"]),
    factors: z.array(riskFactorSchema),
    trend: z.enum(["improving", "stable", "degrading", "volatile"]),
    jurisdiction: nonEmptyStringSchema.optional(),
    regulatoryRegime: nonEmptyStringSchema.optional(),
    confidence: probabilitySchema,
    timestamp: isoDateSchema,
  })
  .passthrough();

const riskAssessmentResponseSchema = z
  .object({ riskAssessment: riskAssessmentSchema })
  .strict();

const complianceAlertSchema = z
  .object({
    alertId: nonEmptyStringSchema,
    entityId: z.string().uuid(),
    level: z.enum([
      "info",
      "warning",
      "violation",
      "critical",
      "low",
      "medium",
      "high",
    ]),
    category: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    regulation: nonEmptyStringSchema,
    actionRequired: nonEmptyStringSchema,
    createdAt: isoDateSchema,
    acknowledgedAt: isoDateSchema.optional(),
    resolvedAt: isoDateSchema.optional(),
    source: z.enum(["compliance", "fraud"]).optional(),
  })
  .strict();

const complianceAlertsResponseSchema = z
  .object({
    alerts: z.array(complianceAlertSchema),
    total: z.number().int().nonnegative(),
    complianceAlertCount: z.number().int().nonnegative(),
    fraudAlertCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.total !== value.alerts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total"],
        message: "must equal the returned alert count",
      });
    }
  });

const advisorResponseSchema = z
  .object({
    queryId: nonEmptyStringSchema,
    question: nonEmptyStringSchema,
    answer: nonEmptyStringSchema,
    confidence: probabilitySchema,
    citations: z.array(
      z
        .object({
          regulation: nonEmptyStringSchema,
          section: nonEmptyStringSchema,
          text: nonEmptyStringSchema,
        })
        .strict(),
    ),
    relatedTopics: z.array(nonEmptyStringSchema),
    disclaimer: nonEmptyStringSchema,
    timestamp: isoDateSchema,
  })
  .strict();

const complianceReportSchema = z
  .object({
    reportId: nonEmptyStringSchema,
    entityId: z.string().uuid(),
    reportType: z.enum([
      "kyc",
      "aml",
      "sanctions",
      "pep",
      "travel_rule",
      "comprehensive",
    ]),
    status: z.enum(["generating", "complete", "failed"]),
    summary: nonEmptyStringSchema,
    sections: z.array(
      z
        .object({
          title: nonEmptyStringSchema,
          status: z.enum(["pass", "warning", "fail", "not_applicable"]),
          findings: z.array(nonEmptyStringSchema),
          evidence: z.record(z.unknown()),
        })
        .strict(),
    ),
    complianceScore: percentageSchema,
    gaps: z.array(
      z
        .object({
          gapId: nonEmptyStringSchema,
          category: nonEmptyStringSchema,
          severity: z.enum(["info", "warning", "violation", "critical"]),
          description: nonEmptyStringSchema,
          regulation: nonEmptyStringSchema,
          remediation: nonEmptyStringSchema,
          deadline: isoDateSchema.optional(),
        })
        .strict(),
    ),
    recommendations: z.array(nonEmptyStringSchema),
    generatedAt: isoDateSchema,
    validUntil: isoDateSchema,
    jurisdiction: nonEmptyStringSchema,
    regulatoryFramework: nonEmptyStringSchema,
  })
  .strict();

const regulationImpactAssessmentSchema = z
  .object({
    changeId: nonEmptyStringSchema,
    regulation: nonEmptyStringSchema,
    effectiveDate: isoDateSchema,
    description: nonEmptyStringSchema,
    impactedEntities: z.number().int().nonnegative(),
    impactedCredentialTypes: z.array(nonEmptyStringSchema),
    requiredActions: z.array(nonEmptyStringSchema),
    estimatedEffort: z.enum(["low", "medium", "high", "critical"]),
    automationPossible: z.boolean(),
  })
  .strict();

function parseComplianceResponse<T>(
  operation: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AIComplianceResponseContractError(operation, parsed.error);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export function useScreenIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: ScreenIdentityInput,
    ): Promise<ScreeningResult> => {
      const response = await apiClient.post<unknown>(
        `${AI_COMPLIANCE_BASE}/screen`,
        input,
      );
      return parseComplianceResponse(
        "screening",
        screeningResultSchema,
        response,
      );
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

export interface RiskAssessmentQueryOptions {
  enabled?: boolean;
  jurisdiction?: string;
  entityType?: "identity" | "credential";
}

export function useRiskAssessment(
  identityId: string | undefined,
  options: RiskAssessmentQueryOptions = {},
) {
  const entityType = options.entityType ?? "identity";
  const jurisdiction = options.jurisdiction?.trim().toUpperCase();

  return useQuery({
    queryKey: [
      ...complianceKeys.risk(identityId ?? ""),
      entityType,
      jurisdiction ?? "",
    ],
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `${AI_COMPLIANCE_BASE}/risk/${identityId}`,
        {
          entityType,
          ...(jurisdiction ? { jurisdiction } : {}),
        },
      );
      return parseComplianceResponse(
        "risk assessment",
        riskAssessmentResponseSchema,
        response,
      );
    },
    enabled: (options.enabled ?? true) && !!identityId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useRefreshRiskAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (identityId: string): Promise<RiskAssessmentResponse> => {
      const response = await apiClient.get<unknown>(
        `${AI_COMPLIANCE_BASE}/risk/${identityId}`,
        { entityType: "identity" },
      );
      return parseComplianceResponse(
        "risk assessment",
        riskAssessmentResponseSchema,
        response,
      );
    },
    onSuccess: (data, identityId) => {
      toast.success("Risk assessment updated", {
        description: `Score: ${data.riskAssessment.compositeScore} (${data.riskAssessment.decision})`,
      });
      queryClient.setQueriesData(
        { queryKey: complianceKeys.risk(identityId) },
        data,
      );
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
      const response = await apiClient.post<unknown>(
        `${AI_COMPLIANCE_BASE}/advisor/query`,
        {
          question: message,
          context: {},
        },
      );
      return parseComplianceResponse(
        "advisor",
        advisorResponseSchema,
        response,
      );
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

export function useComplianceAlerts(enabled = true) {
  const { address } = useAccount();

  return useQuery({
    queryKey: complianceKeys.alerts(),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `${AI_COMPLIANCE_BASE}/alerts`,
      );
      return parseComplianceResponse(
        "alert list",
        complianceAlertsResponseSchema,
        response,
      );
    },
    enabled: enabled && !!address,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string): Promise<ComplianceAlert> => {
      const response = await apiClient.post<unknown>(
        `${AI_COMPLIANCE_BASE}/alerts/${alertId}/acknowledge`,
        {},
      );
      return parseComplianceResponse(
        "alert acknowledgement",
        complianceAlertSchema,
        response,
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
      const response = await apiClient.post<unknown>(
        `${AI_COMPLIANCE_BASE}/report`,
        params,
      );
      return parseComplianceResponse(
        "compliance report",
        complianceReportSchema,
        response,
      );
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
// Regulatory Change Impact Assessment
// ---------------------------------------------------------------------------

export function useAssessRegChangeImpact() {
  return useMutation({
    mutationFn: async (params: {
      regulation: string;
      changes: string;
      jurisdiction: string;
    }): Promise<RegulationImpactAssessment> => {
      const response = await apiClient.post<unknown>(
        `${AI_COMPLIANCE_BASE}/impact-assessment`,
        params,
      );
      return parseComplianceResponse(
        "regulatory impact assessment",
        regulationImpactAssessmentSchema,
        response,
      );
    },
    onSuccess: (data) => {
      if (
        data.estimatedEffort === "high" ||
        data.estimatedEffort === "critical"
      ) {
        toast.warning("Impact assessment complete", {
          description: `${data.impactedEntities} impacted entity(ies); ${data.requiredActions.length} action(s) required`,
        });
      } else {
        toast.success("Impact assessment complete — no new gaps detected");
      }
    },
    onError: (err: Error) => {
      toast.error("Impact assessment failed", { description: err.message });
    },
  });
}

export function useSimulateRegChange() {
  // Backward-compatible alias for older callers; new code should use
  // useAssessRegChangeImpact.
  return useAssessRegChangeImpact();
}
