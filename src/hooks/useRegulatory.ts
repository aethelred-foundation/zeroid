/**
 * Authenticated access to ZeroID's configured regulatory policy evidence.
 *
 * These hooks deliberately expose the backend records without calculating
 * legal scores, deadlines, remediation estimates, or compliance conclusions
 * in the browser.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAccount } from "wagmi";

import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";

const jurisdictionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]+$/, "Invalid jurisdiction code");

const jurisdictionSchema = z
  .object({
    code: jurisdictionCodeSchema,
    name: z.string().min(1),
    region: z.string().min(1),
    dataResidencyRequired: z.boolean(),
    retentionDays: z.number().int().nonnegative(),
    reportingCurrency: z.string().min(1),
    regulatoryBody: z.string().min(1),
    consentModel: z.enum(["opt-in", "opt-out", "explicit"]),
    crossBorderRestricted: z.boolean(),
  })
  .strict();

const operationTypeSchema = z.enum([
  "onboarding",
  "transaction",
  "transfer",
  "periodic_review",
]);

const jurisdictionRequirementsSchema = z
  .object({
    jurisdictionId: jurisdictionCodeSchema,
    operationType: operationTypeSchema,
    evidenceStatus: z.literal("configured_policy_only"),
    policySource: z
      .object({
        kind: z.literal("internal_configuration"),
        externalAuthorityVerified: z.literal(false),
      })
      .strict(),
    requiredCredentials: z.array(
      z
        .object({
          credentialType: z.string().min(1),
          label: z.string().min(1),
          mandatory: z.boolean(),
        })
        .strict(),
    ),
    retentionPolicy: z
      .object({
        retentionDays: z.number().int().nonnegative(),
        dataResidencyRequired: z.boolean(),
        consentModel: z.enum(["opt-in", "opt-out", "explicit"]),
      })
      .strict(),
    regulatoryBodyLabel: z.string().min(1),
    unavailableCapabilities: z.array(z.string().min(1)),
  })
  .strict();

const complianceEvaluationSchema = z
  .object({
    entityId: z.string().min(1),
    jurisdiction: jurisdictionCodeSchema,
    overallStatus: z.enum([
      "compliant",
      "non_compliant",
      "partial",
      "pending_review",
    ]),
    missingCredentials: z.array(z.string().min(1)),
    expiringCredentials: z.array(
      z
        .object({
          credentialType: z.string().min(1),
          expiresAt: z.string().datetime(),
          daysRemaining: z.number().int(),
        })
        .strict(),
    ),
    rules: z.array(
      z
        .object({
          ruleId: z.string().uuid(),
          name: z.string().min(1),
          status: z.enum(["pass", "fail", "warning"]),
          detail: z.string().min(1),
        })
        .strict(),
    ),
    lastEvaluated: z.string().datetime(),
    nextReviewDate: z.string().datetime(),
  })
  .strict();

const crossBorderResultSchema = z
  .object({
    allowed: z.boolean(),
    sourceJurisdiction: jurisdictionCodeSchema,
    targetJurisdiction: jurisdictionCodeSchema,
    mutualRecognition: z.boolean(),
    acceptedCredentials: z.array(z.string().min(1)),
    additionalRequired: z.array(z.string().min(1)),
    dataTransferMechanism: z.enum([
      "adequacy_decision",
      "standard_contractual_clauses",
      "binding_corporate_rules",
      "explicit_consent",
      "not_required",
    ]),
    restrictions: z.array(z.string().min(1)),
    policyAlerts: z.array(z.string().min(1)).optional(),
    policyDecision: z.enum(["allow", "review_required", "blocked"]).optional(),
  })
  .strict();

const dataSovereigntyStatusSchema = z
  .object({
    evidenceStatus: z.literal("recorded_workflow_evidence"),
    compliantRegions: z.array(z.string().min(1)),
    nonCompliantRegions: z.array(z.string().min(1)),
    dataResidencyMap: z.array(
      z
        .object({
          dataType: z.string().min(1),
          currentRegion: z.string().min(1),
          requiredRegion: z.string().min(1),
          compliant: z.boolean(),
          migrationRequired: z.boolean(),
          retentionExpiresAt: z.string().datetime(),
          autoDeleteScheduled: z.boolean(),
        })
        .strict(),
    ),
    consentRecords: z.number().int().nonnegative(),
    retentionRecords: z.number().int().nonnegative(),
    legalConclusionAvailable: z.literal(false),
    unavailableCapabilities: z.array(z.string().min(1)),
  })
  .strict();

const crossBorderInputSchema = z
  .object({
    fromJurisdiction: jurisdictionCodeSchema,
    toJurisdiction: jurisdictionCodeSchema,
    dataCategory: z.enum([
      "personal",
      "financial",
      "biometric",
      "health",
      "criminal",
    ]),
    purpose: z.string().trim().min(3).max(200),
  })
  .strict()
  .refine(
    (input) => input.fromJurisdiction !== input.toJurisdiction,
    "Source and target jurisdictions must differ",
  );

export type Jurisdiction = z.infer<typeof jurisdictionSchema>;
export type OperationType = z.infer<typeof operationTypeSchema>;
export type JurisdictionRequirements = z.infer<
  typeof jurisdictionRequirementsSchema
>;
export type ComplianceEvaluation = z.infer<typeof complianceEvaluationSchema>;
export type CrossBorderAssessment = z.infer<typeof crossBorderResultSchema>;
export type CrossBorderInput = z.infer<typeof crossBorderInputSchema>;
export type DataSovereigntyStatus = z.infer<typeof dataSovereigntyStatusSchema>;

type ProtectedHookOptions = {
  enabled?: boolean;
};

const regulatoryKeys = {
  all: ["regulatory"] as const,
  jurisdictions: (address: string) =>
    [...regulatoryKeys.all, "jurisdictions", address] as const,
  requirements: (
    address: string,
    jurisdictionId: string,
    operationType: OperationType,
  ) =>
    [
      ...regulatoryKeys.all,
      "requirements",
      address,
      jurisdictionId,
      operationType,
    ] as const,
  compliance: (address: string, jurisdictionId: string) =>
    [...regulatoryKeys.all, "compliance", address, jurisdictionId] as const,
  sovereignty: (address: string) =>
    [...regulatoryKeys.all, "sovereignty", address] as const,
};

function useProtectedSession(options: ProtectedHookOptions) {
  const { address, isConnected } = useAccount();
  const authToken = getIdentityAuthToken();
  const ready = Boolean(
    (options.enabled ?? true) && isConnected && address && authToken,
  );

  return {
    address,
    authToken,
    ready,
  };
}

export function useJurisdictions(options: ProtectedHookOptions = {}) {
  const session = useProtectedSession(options);
  const query = useQuery({
    queryKey: regulatoryKeys.jurisdictions(session.address ?? "anonymous"),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        "/api/v1/enterprise/compliance/jurisdictions",
        undefined,
        session.authToken,
      );
      return z.array(jurisdictionSchema).parse(response);
    },
    enabled: session.ready,
    retry: false,
    staleTime: 300_000,
  });

  return { ...query, data: session.ready ? query.data : undefined };
}

export function useJurisdictionRequirements(
  jurisdictionId: string | undefined,
  operationType: OperationType = "onboarding",
  options: ProtectedHookOptions = {},
) {
  const session = useProtectedSession(options);
  const enabled = session.ready && Boolean(jurisdictionId);
  const query = useQuery({
    queryKey: regulatoryKeys.requirements(
      session.address ?? "anonymous",
      jurisdictionId ?? "",
      operationType,
    ),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `/api/v1/enterprise/compliance/jurisdictions/${encodeURIComponent(
          jurisdictionId as string,
        )}/requirements`,
        { operationType },
        session.authToken,
      );
      return jurisdictionRequirementsSchema.parse(response);
    },
    enabled,
    retry: false,
    staleTime: 120_000,
  });

  return { ...query, data: enabled ? query.data : undefined };
}

export function useComplianceStatus(
  jurisdictionId: string | undefined,
  options: ProtectedHookOptions = {},
) {
  const session = useProtectedSession(options);
  const enabled = session.ready && Boolean(jurisdictionId && session.address);
  const query = useQuery({
    queryKey: regulatoryKeys.compliance(
      session.address ?? "anonymous",
      jurisdictionId ?? "",
    ),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `/api/v1/enterprise/compliance/status/${encodeURIComponent(
          session.address as string,
        )}`,
        { jurisdiction: jurisdictionId as string },
        session.authToken,
      );
      return complianceEvaluationSchema.parse(response);
    },
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  return { ...query, data: enabled ? query.data : undefined };
}

export function useCheckCrossBorder(options: ProtectedHookOptions = {}) {
  const session = useProtectedSession(options);

  return useMutation({
    mutationFn: async (
      input: CrossBorderInput,
    ): Promise<CrossBorderAssessment> => {
      if (!session.ready || !session.address || !session.authToken) {
        throw new Error("An authenticated ZeroID session is required.");
      }

      const parsed = crossBorderInputSchema.parse(input);
      const response = await apiClient.post<unknown>(
        "/api/v1/enterprise/compliance/cross-border",
        {
          sourceJurisdiction: parsed.fromJurisdiction,
          targetJurisdiction: parsed.toJurisdiction,
          entityId: session.address,
          dataCategories: [parsed.dataCategory],
          purpose: parsed.purpose,
        },
        session.authToken,
      );
      return crossBorderResultSchema.parse(response);
    },
    retry: false,
  });
}

export function useDataSovereigntyStatus(options: ProtectedHookOptions = {}) {
  const session = useProtectedSession(options);
  const enabled = session.ready && Boolean(session.address);
  const query = useQuery({
    queryKey: regulatoryKeys.sovereignty(session.address ?? "anonymous"),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        `/api/v1/enterprise/compliance/sovereignty/status/${encodeURIComponent(
          session.address as string,
        )}`,
        undefined,
        session.authToken,
      );
      return dataSovereigntyStatusSchema.parse(response);
    },
    enabled,
    retry: false,
    staleTime: 120_000,
  });

  return { ...query, data: enabled ? query.data : undefined };
}
