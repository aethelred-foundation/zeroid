import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(),
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import { useAccount } from "wagmi";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import {
  useCheckCrossBorder,
  useComplianceStatus,
  useDataSovereigntyStatus,
  useJurisdictionRequirements,
  useJurisdictions,
} from "@/hooks/useRegulatory";

const mockUseAccount = useAccount as jest.Mock;
const mockGetIdentityAuthToken = getIdentityAuthToken as jest.Mock;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const jurisdiction = {
  code: "AE-CBUAE",
  name: "UAE Central Bank",
  region: "mena",
  dataResidencyRequired: true,
  retentionDays: 1825,
  reportingCurrency: "AED",
  regulatoryBody: "Central Bank of UAE",
  consentModel: "explicit",
  crossBorderRestricted: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({
    address: walletAddress,
    isConnected: true,
  });
  mockGetIdentityAuthToken.mockReturnValue("identity-token");
});

describe("useJurisdictions", () => {
  it("requires an authenticated wallet session", () => {
    mockGetIdentityAuthToken.mockReturnValue(null);

    const { result } = renderHook(() => useJurisdictions(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("loads and strictly validates configured jurisdictions", async () => {
    mockApiClient.get.mockResolvedValue([jurisdiction]);

    const { result } = renderHook(() => useJurisdictions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/jurisdictions",
      undefined,
      "identity-token",
    );
    expect(result.current.data).toEqual([jurisdiction]);
  });

  it("rejects fabricated score fields instead of silently trusting them", async () => {
    mockApiClient.get.mockResolvedValue([{ ...jurisdiction, score: 97 }]);

    const { result } = renderHook(() => useJurisdictions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useJurisdictionRequirements", () => {
  it("returns only configured policy evidence for the selected operation", async () => {
    const requirements = {
      jurisdictionId: "AE-CBUAE",
      operationType: "transfer",
      evidenceStatus: "configured_policy_only",
      policySource: {
        kind: "internal_configuration",
        externalAuthorityVerified: false,
      },
      requiredCredentials: [
        {
          credentialType: "kyc_enhanced",
          label: "Kyc Enhanced",
          mandatory: true,
        },
      ],
      retentionPolicy: {
        retentionDays: 1825,
        dataResidencyRequired: true,
        consentModel: "explicit",
      },
      regulatoryBodyLabel: "Central Bank of UAE",
      unavailableCapabilities: ["accepted_issuer_verification"],
    };
    mockApiClient.get.mockResolvedValue(requirements);

    const { result } = renderHook(
      () => useJurisdictionRequirements("AE-CBUAE", "transfer"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/jurisdictions/AE-CBUAE/requirements",
      { operationType: "transfer" },
      "identity-token",
    );
    expect(result.current.data).toEqual(requirements);
    expect(result.current.data).not.toHaveProperty("amlThresholds");
    expect(result.current.data).not.toHaveProperty("reportingObligations");
  });

  it("does not run without a jurisdiction", () => {
    const { result } = renderHook(
      () => useJurisdictionRequirements(undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

describe("useComplianceStatus", () => {
  it("returns the recorded backend evaluation without calculating a score", async () => {
    const evaluation = {
      entityId: walletAddress,
      jurisdiction: "AE-CBUAE",
      overallStatus: "partial",
      missingCredentials: ["source_of_funds"],
      expiringCredentials: [
        {
          credentialType: "passport",
          expiresAt: "2026-08-01T00:00:00.000Z",
          daysRemaining: 14,
        },
      ],
      rules: [
        {
          ruleId: "11111111-1111-4111-8111-111111111111",
          name: "KYC Completeness",
          status: "fail",
          detail: "Missing: source_of_funds",
        },
      ],
      lastEvaluated: "2026-07-18T00:00:00.000Z",
      nextReviewDate: "2027-01-14T00:00:00.000Z",
    };
    mockApiClient.get.mockResolvedValue(evaluation);

    const { result } = renderHook(() => useComplianceStatus("AE-CBUAE"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      `/api/v1/enterprise/compliance/status/${walletAddress}`,
      { jurisdiction: "AE-CBUAE" },
      "identity-token",
    );
    expect(result.current.data).toEqual(evaluation);
    expect(result.current.data).not.toHaveProperty("score");
    expect(result.current.data).not.toHaveProperty("estimatedRemediationDays");
  });
});

describe("useCheckCrossBorder", () => {
  it("submits the real wallet subject and user-supplied transfer context", async () => {
    const assessment = {
      allowed: true,
      sourceJurisdiction: "AE-CBUAE",
      targetJurisdiction: "EU-GDPR",
      mutualRecognition: false,
      acceptedCredentials: [],
      additionalRequired: ["gdpr_consent"],
      dataTransferMechanism: "standard_contractual_clauses",
      restrictions: ["EU SCCs required"],
    };
    mockApiClient.post.mockResolvedValue(assessment);

    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromJurisdiction: "AE-CBUAE",
        toJurisdiction: "EU-GDPR",
        dataCategory: "financial",
        purpose: "credential verification",
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      "/api/v1/enterprise/compliance/cross-border",
      {
        sourceJurisdiction: "AE-CBUAE",
        targetJurisdiction: "EU-GDPR",
        entityId: walletAddress,
        dataCategories: ["financial"],
        purpose: "credential verification",
      },
      "identity-token",
    );
    await waitFor(() => expect(result.current.data).toEqual(assessment));
    expect(result.current.data).not.toHaveProperty("estimatedProcessingDays");
  });

  it("fails closed when the session is unavailable", async () => {
    mockGetIdentityAuthToken.mockReturnValue(null);
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          fromJurisdiction: "AE-CBUAE",
          toJurisdiction: "EU-GDPR",
          dataCategory: "personal",
          purpose: "identity verification",
        });
      }),
    ).rejects.toThrow("authenticated ZeroID session");
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("does not synthesize a result after a backend failure", async () => {
    mockApiClient.post.mockRejectedValue(new Error("Policy service offline"));
    const { result } = renderHook(() => useCheckCrossBorder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          fromJurisdiction: "AE-CBUAE",
          toJurisdiction: "EU-GDPR",
          dataCategory: "personal",
          purpose: "identity verification",
        });
      }),
    ).rejects.toThrow("Policy service offline");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useDataSovereigntyStatus", () => {
  it("returns recorded workflow evidence without GDPR legal claims", async () => {
    const evidence = {
      evidenceStatus: "recorded_workflow_evidence",
      compliantRegions: ["me-central-1"],
      nonCompliantRegions: [],
      dataResidencyMap: [
        {
          dataType: "personal",
          currentRegion: "me-central-1",
          requiredRegion: "me-central-1",
          compliant: true,
          migrationRequired: false,
          retentionExpiresAt: "2027-07-18T00:00:00.000Z",
          autoDeleteScheduled: true,
        },
      ],
      consentRecords: 1,
      retentionRecords: 1,
      legalConclusionAvailable: false,
      unavailableCapabilities: ["gdpr_legal_conclusion"],
    };
    mockApiClient.get.mockResolvedValue(evidence);

    const { result } = renderHook(() => useDataSovereigntyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      `/api/v1/enterprise/compliance/sovereignty/status/${walletAddress}`,
      undefined,
      "identity-token",
    );
    expect(result.current.data).toEqual(evidence);
    expect(result.current.data).not.toHaveProperty("gdprStatus");
    expect(result.current.data).not.toHaveProperty("pendingTransfers");
  });
});
