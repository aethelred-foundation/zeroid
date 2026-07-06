import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/analytics",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: any, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const {
            initial,
            animate,
            exit,
            transition,
            whileHover,
            whileTap,
            variants,
            layout,
            layoutId,
            ...rest
          } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock AppLayout
jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: any) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const mockExportMutateAsync = jest.fn();

jest.mock("@/hooks/useAnalytics", () => ({
  usePrivacyScore: jest.fn(() => ({
    data: {
      overallScore: 91,
      grade: "A",
      breakdown: {
        selectiveDisclosureUsage: 75,
        zkProofAdoption: 50,
        credentialMinimisation: 88,
        dataExposureControl: 92,
        verifierDiversity: 80,
        consentManagement: 50,
      },
      trend: {
        direction: "improving",
        changePercent: 8,
        period: "30d",
        history: [],
      },
      lastCalculatedAt: "2026-06-20T00:00:00.000Z",
      percentileRank: 83,
    },
    isLoading: false,
    isError: false,
  })),
  useCredentialUsageAnalytics: jest.fn(() => ({
    data: {
      period: "30d",
      totalPresentations: 4,
      uniqueVerifiers: 2,
      zkProofPresentations: 2,
      selectiveDisclosurePresentations: 1,
      fullDisclosurePresentations: 1,
      privacyPreservingRatio: 75,
      byCredentialType: [
        {
          schemaName: "KYC Credential",
          schemaId: "kyc",
          presentationCount: 3,
          zkProofCount: 2,
          selectiveDisclosureCount: 1,
          lastUsedAt: "2026-06-20T00:00:00.000Z",
        },
        {
          schemaName: "AML Clearance",
          schemaId: "aml",
          presentationCount: 1,
          zkProofCount: 0,
          selectiveDisclosureCount: 0,
          lastUsedAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      byDay: [
        {
          date: "2026-06-20T00:00:00.000Z",
          presentations: 2,
          zkProofs: 1,
          selectiveDisclosures: 1,
        },
        {
          date: "2026-06-21T00:00:00.000Z",
          presentations: 2,
          zkProofs: 1,
          selectiveDisclosures: 0,
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
    },
    isLoading: false,
    isError: false,
  })),
  useVerifierAnalytics: jest.fn(() => ({
    data: {
      totalVerifiers: 2,
      verifiers: [
        {
          verifierDid: "did:aethelred:verifier:edge",
          verifierName: "EDGE Secure Data Room",
          requestCount: 3,
          lastRequestAt: "2026-06-20T00:00:00.000Z",
          attributesRequested: ["nationality", "ageOver18"],
          zkProofAcceptance: true,
          trustScore: 92,
          jurisdiction: "AE",
        },
        {
          verifierDid: "did:aethelred:verifier:presight",
          verifierName: "Presight Analytics Mesh",
          requestCount: 1,
          lastRequestAt: "2026-06-21T00:00:00.000Z",
          attributesRequested: ["amlStatus"],
          zkProofAcceptance: false,
          trustScore: 71,
          jurisdiction: "AE",
        },
      ],
      requestsByPurpose: [],
      trustDistribution: [],
    },
    isLoading: false,
    isError: false,
  })),
  useDataExposureTimeline: jest.fn(() => ({
    data: {
      entries: [
        {
          id: "exp-1",
          timestamp: "2026-06-21T00:00:00.000Z",
          verifierDid: "did:aethelred:verifier:edge",
          verifierName: "EDGE Secure Data Room",
          credentialSchemaName: "KYC Credential",
          attributesDisclosed: [],
          disclosureMethod: "zk_proof",
          purpose: "facility_access",
          riskScore: 12,
          consentRecordId: "consent-1",
        },
        {
          id: "exp-2",
          timestamp: "2026-06-20T00:00:00.000Z",
          verifierDid: "did:aethelred:verifier:presight",
          verifierName: "Presight Analytics Mesh",
          credentialSchemaName: "AML Clearance",
          attributesDisclosed: ["amlStatus"],
          disclosureMethod: "selective",
          purpose: "model_governance",
          riskScore: 34,
          consentRecordId: "consent-2",
        },
      ],
      totalDisclosures: 1,
      uniqueAttributesExposed: 1,
      uniqueVerifiers: 2,
      riskLevel: "low",
      highRiskExposures: 0,
    },
    isLoading: false,
    isError: false,
  })),
  useNetworkBenchmarks: jest.fn(() => ({
    data: {
      calculatedAt: "2026-06-21T00:00:00.000Z",
      sampleSize: 4,
      benchmarks: [
        {
          metric: "privacyPreservingRatio",
          label: "Privacy-preserving presentations",
          networkMedian: 72,
          networkP25: 48,
          networkP75: 88,
          userValue: 75,
          unit: "%",
        },
      ],
      userPercentiles: { privacyPreservingRatio: 75 },
    },
    isLoading: false,
    isError: false,
  })),
  usePrivacyRecommendations: jest.fn(() => ({
    data: [
      {
        id: "rec-1",
        priority: "high",
        category: "data_minimisation",
        title: "Reduce full disclosures",
        description: "Use ZK proofs for verifier workflows.",
        currentBehavior: "1 full-disclosure request",
        suggestedAction: "Move recurring checks to selective proof templates.",
        estimatedImpact: 18,
        implementationSteps: ["Review disclosure events"],
      },
    ],
    isLoading: false,
    isError: false,
  })),
  useExportAnalyticsReport: jest.fn(() => ({
    mutateAsync: mockExportMutateAsync,
    isPending: false,
  })),
}));

import AnalyticsPage from "../page";

describe("AnalyticsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("renders without crashing", () => {
    render(<AnalyticsPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<AnalyticsPage />);
    expect(
      screen.getByText("Privacy-Preserving Analytics"),
    ).toBeInTheDocument();
  });

  it("shows Credential Usage tab by default", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("Verifications Over Time")).toBeInTheDocument();
    expect(screen.getByText("Verifier Analytics")).toBeInTheDocument();
  });

  it("switches time range", () => {
    render(<AnalyticsPage />);
    const button7d = screen.getByRole("button", { name: "7d" });
    fireEvent.click(button7d);
    expect(button7d).toBeInTheDocument();
  });

  it("switches to Privacy Analysis tab", () => {
    render(<AnalyticsPage />);
    const privacyTab = screen.getByRole("button", {
      name: /Privacy Analysis/i,
    });
    fireEvent.click(privacyTab);
    expect(screen.getAllByText("Privacy Score").length).toBeGreaterThan(0);
    expect(screen.getByText("Disclosure Breakdown")).toBeInTheDocument();
  });

  it("shows privacy analysis details", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Privacy Analysis/i }));
    // Check disclosure breakdown
    expect(screen.getByText("ZK Proved")).toBeInTheDocument();
    expect(screen.getByText("Selective")).toBeInTheDocument();
    expect(screen.getAllByText("Full Disclosure").length).toBeGreaterThan(0);
    // Data exposure timeline
    expect(screen.getByText("Data Exposure Timeline")).toBeInTheDocument();
    // Privacy recommendations
    expect(screen.getByText("Privacy Recommendations")).toBeInTheDocument();
    expect(screen.getByText("Reduce full disclosures")).toBeInTheDocument();
  });

  it("switches to Identity Health tab", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Identity Health/i }));
    expect(screen.getByText("Identity Health Metrics")).toBeInTheDocument();
    expect(screen.getByText("Credential Freshness")).toBeInTheDocument();
    expect(screen.getByText("ZK Proof Adoption")).toBeInTheDocument();
    expect(screen.getByText("Data Exposure Control")).toBeInTheDocument();
    expect(screen.getByText("Verifier Diversity")).toBeInTheDocument();
    expect(screen.getByText("Consent Management")).toBeInTheDocument();
    // Overall scores
    expect(screen.getByText("Overall Health")).toBeInTheDocument();
    expect(screen.getByText("Active Credentials")).toBeInTheDocument();
    expect(screen.getByText("Issuers")).toBeInTheDocument();
  });

  it("switches to Network Analytics tab", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Network Analytics/i }));
    // Network stats cards
    expect(screen.getAllByText("Total Credentials").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Total Verifications").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Unique Users").length).toBeGreaterThan(0);
    expect(screen.getByText("Network Growth")).toBeInTheDocument();
    // Benchmarks section
    expect(screen.getByText(/Anonymized Benchmarks/)).toBeInTheDocument();
    expect(
      screen.getByText("Privacy-preserving presentations"),
    ).toBeInTheDocument();
  });

  it("switches between all time ranges", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: "90d" }));
    expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1y" }));
    expect(screen.getByRole("button", { name: "1y" })).toBeInTheDocument();
  });

  it("shows exposure timeline with different methods", () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Privacy Analysis/i }));
    // Verify different disclosure methods are shown
    expect(screen.getAllByText("ZK Proof").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selective Disclosure").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Full Disclosure").length).toBeGreaterThan(0);
  });

  it("shows verifier analytics table in usage tab", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("EDGE Secure Data Room")).toBeInTheDocument();
    expect(screen.getByText("Presight Analytics Mesh")).toBeInTheDocument();
  });

  it("shows credential type breakdown in usage tab", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("By Credential Type")).toBeInTheDocument();
    expect(screen.getAllByText("KYC Credential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AML Clearance").length).toBeGreaterThan(0);
  });

  it("exports using the analytics export mutation", async () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export/i }));
    await waitFor(() =>
      expect(mockExportMutateAsync).toHaveBeenCalledWith({
        format: "json",
        period: "30d",
      }),
    );
  });
});
