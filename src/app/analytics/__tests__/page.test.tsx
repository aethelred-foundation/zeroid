import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockExportMutateAsync = jest.fn();
const mockUsePrivacyScore = jest.fn();
const mockUseCredentialUsage = jest.fn();
const mockUseVerifierAnalytics = jest.fn();
const mockUseExposureTimeline = jest.fn();
const mockUseRecommendations = jest.fn();

const privacyScore = {
  overallScore: 75,
  grade: "C",
  breakdown: {
    selectiveDisclosureUsage: 75,
    zkProofAdoption: 50,
    credentialMinimisation: 50,
    dataExposureControl: 75,
    verifierDiversity: 50,
    consentManagement: 50,
  },
  lastCalculatedAt: "2026-06-21T00:00:00.000Z",
  calculationBasis:
    "Calculated locally from the tenant's returned verification records; no network percentile or external benchmark is included.",
  recordCount: 4,
};

const usage = {
  period: "30d",
  totalPresentations: 4,
  uniqueVerifiers: 2,
  zkProofPresentations: 2,
  selectiveDisclosurePresentations: 1,
  fullDisclosurePresentations: 1,
  privacyPreservingRatio: 75,
  byCredentialType: [
    {
      credentialTypeLabel: "KYC Credential",
      credentialId: "d74ed26c-47ac-4b62-94a8-38704c53b876",
      presentationCount: 4,
      zkProofCount: 2,
      selectiveDisclosureCount: 1,
      lastUsedAt: "2026-06-20T00:00:00.000Z",
    },
  ],
  byDay: [
    {
      date: "2026-06-20T00:00:00.000Z",
      presentations: 4,
      zkProofs: 2,
      selectiveDisclosures: 1,
    },
  ],
  topAttributes: [
    {
      attributeKey: "nationality",
      disclosureCount: 1,
      proofOnlyCount: 2,
      totalRequests: 3,
      privacyRatio: 67,
    },
  ],
};

const verifierAnalytics = {
  totalVerifiers: 2,
  verifiers: [
    {
      verifierDid: "did:aethelred:verifier:edge",
      verifierName: "EDGE Secure Data Room",
      requestCount: 3,
      lastRequestAt: "2026-06-20T00:00:00.000Z",
      attributesRequested: ["nationality", "ageOver18"],
      zkProofRequestObserved: true,
    },
  ],
  requestsByPurpose: [{ purpose: "facility_access", count: 3, percentage: 75 }],
};

const exposureTimeline = {
  entries: [
    {
      id: "exp-1",
      timestamp: "2026-06-21T00:00:00.000Z",
      verifierDid: "did:aethelred:verifier:edge",
      verifierName: "EDGE Secure Data Room",
      credentialTypeLabel: "KYC Credential",
      attributesDisclosed: [],
      disclosureMethod: "zk_proof",
      purpose: "facility_access",
      consentRecorded: true,
    },
    {
      id: "exp-2",
      timestamp: "2026-06-20T00:00:00.000Z",
      verifierDid: "did:aethelred:verifier:edge",
      verifierName: "EDGE Secure Data Room",
      credentialTypeLabel: "KYC Credential",
      attributesDisclosed: ["nationality"],
      disclosureMethod: "selective",
      purpose: "onboarding",
      consentRecorded: false,
    },
  ],
  totalDisclosures: 1,
  uniqueAttributesExposed: 1,
  uniqueVerifiers: 1,
  fullDisclosureEvents: 0,
};

const recommendations = [
  {
    id: "rec-1",
    priority: "medium",
    category: "consent",
    title: "Improve consent evidence capture",
    description: "Some verifier interactions lack explicit consent evidence.",
    currentBehavior: "50% consent coverage",
    suggestedAction: "Attach consent receipts to verifier approvals.",
    implementationSteps: ["Require consent before responding"],
  },
];

jest.mock("@/hooks/useAnalytics", () => ({
  usePrivacyScore: (period: string) => mockUsePrivacyScore(period),
  useCredentialUsageAnalytics: (period: string) =>
    mockUseCredentialUsage(period),
  useVerifierAnalytics: (period: string) => mockUseVerifierAnalytics(period),
  useDataExposureTimeline: (period: string) => mockUseExposureTimeline(period),
  usePrivacyRecommendations: (period: string) => mockUseRecommendations(period),
  useExportAnalyticsReport: () => ({
    mutateAsync: mockExportMutateAsync,
    isPending: false,
  }),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) =>
        React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        }),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import AnalyticsPage from "../page";

function queryResult(data: unknown) {
  return { data, isLoading: false, isError: false };
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePrivacyScore.mockReturnValue(queryResult(privacyScore));
    mockUseCredentialUsage.mockReturnValue(queryResult(usage));
    mockUseVerifierAnalytics.mockReturnValue(queryResult(verifierAnalytics));
    mockUseExposureTimeline.mockReturnValue(queryResult(exposureTimeline));
    mockUseRecommendations.mockReturnValue(queryResult(recommendations));
    mockExportMutateAsync.mockResolvedValue({
      id: "analytics-1",
      format: "json",
      encryptionMethod: "none",
      downloadUrl: "blob:analytics",
      generatedAt: "2026-06-21T00:00:00.000Z",
      expiresAt: "2026-06-21T00:15:00.000Z",
      sizeBytes: 1200,
      checksum: "fnv1a-test",
    });
  });

  it("renders backend-backed tenant analytics without comparative claims", () => {
    render(<AnalyticsPage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Tenant Analytics")).toBeInTheDocument();
    expect(screen.getByText("Recorded presentations")).toBeInTheDocument();
    expect(screen.getByText("Known verifiers")).toBeInTheDocument();
    expect(screen.queryByText(/Network Analytics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Top 5%/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Network Average/i)).not.toBeInTheDocument();
  });

  it("states the calculation basis and missing authoritative benchmark feed", () => {
    render(<AnalyticsPage />);
    expect(
      screen.getByText(/does not currently receive an authoritative network/i),
    ).toBeInTheDocument();
  });

  it("renders tenant usage returned by hooks", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("Presentations by Day")).toBeInTheDocument();
    expect(screen.getByText("KYC Credential")).toBeInTheDocument();
    expect(screen.getByText("EDGE Secure Data Room")).toBeInTheDocument();
    expect(screen.getByText("ZK request observed: Yes")).toBeInTheDocument();
  });

  it("passes the selected period to every tenant analytics hook", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: "90d" }));

    expect(mockUsePrivacyScore).toHaveBeenLastCalledWith("90d");
    expect(mockUseCredentialUsage).toHaveBeenLastCalledWith("90d");
    expect(mockUseVerifierAnalytics).toHaveBeenLastCalledWith("90d");
    expect(mockUseExposureTimeline).toHaveBeenLastCalledWith("90d");
    expect(mockUseRecommendations).toHaveBeenLastCalledWith("90d");
  });

  it("shows the local score and its non-comparative calculation basis", () => {
    render(<AnalyticsPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Privacy Calculations" }),
    );

    expect(
      screen.getByText("Calculated tenant privacy score"),
    ).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText(/no network percentile/i)).toBeInTheDocument();
    expect(screen.getByText("Consent evidence")).toBeInTheDocument();
    expect(screen.getByText("nationality")).toBeInTheDocument();
  });

  it("uses an explicit empty state instead of treating no data as a score", () => {
    mockUsePrivacyScore.mockReturnValue(
      queryResult({
        ...privacyScore,
        overallScore: null,
        grade: null,
        recordCount: 0,
      }),
    );
    render(<AnalyticsPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Privacy Calculations" }),
    );

    expect(screen.getByText(/Privacy score unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero is not displayed/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Calculated tenant privacy score"),
    ).not.toBeInTheDocument();
  });

  it("labels inferred disclosure methods and rule-based recommendations", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Exposure Review" }));

    expect(screen.getByText(/methods are inferred/i)).toBeInTheDocument();
    expect(
      screen.getByText("Limited attribute request (inferred)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Rule-Based Recommendations")).toBeInTheDocument();
    expect(
      screen.getByText("Improve consent evidence capture"),
    ).toBeInTheDocument();
  });

  it("exports the selected tenant period", async () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(mockExportMutateAsync).toHaveBeenCalledWith({
        format: "json",
        period: "30d",
      }),
    );
  });
});
