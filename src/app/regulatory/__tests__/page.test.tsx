import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(),
}));

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: jest.fn(),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/hooks/useRegulatory", () => ({
  useJurisdictions: jest.fn(),
  useComplianceStatus: jest.fn(),
  useJurisdictionRequirements: jest.fn(),
  useDataSovereigntyStatus: jest.fn(),
  useCheckCrossBorder: jest.fn(),
}));

import { useAccount } from "wagmi";
import { useIdentity } from "@/contexts/IdentityContext";
import {
  useCheckCrossBorder,
  useComplianceStatus,
  useDataSovereigntyStatus,
  useJurisdictionRequirements,
  useJurisdictions,
} from "@/hooks/useRegulatory";
import RegulatoryPage from "../page";

const mockUseAccount = useAccount as jest.Mock;
const mockUseIdentity = useIdentity as jest.Mock;
const mockUseJurisdictions = useJurisdictions as jest.Mock;
const mockUseComplianceStatus = useComplianceStatus as jest.Mock;
const mockUseRequirements = useJurisdictionRequirements as jest.Mock;
const mockUseSovereignty = useDataSovereigntyStatus as jest.Mock;
const mockUseCrossBorder = useCheckCrossBorder as jest.Mock;

const jurisdictions = [
  {
    code: "AE-CBUAE",
    name: "UAE Central Bank",
    region: "mena",
    dataResidencyRequired: true,
    retentionDays: 1825,
    reportingCurrency: "AED",
    regulatoryBody: "Central Bank of UAE",
    consentModel: "explicit",
    crossBorderRestricted: false,
  },
  {
    code: "EU-GDPR",
    name: "GDPR",
    region: "europe",
    dataResidencyRequired: true,
    retentionDays: 1825,
    reportingCurrency: "EUR",
    regulatoryBody: "Data Protection Authorities",
    consentModel: "explicit",
    crossBorderRestricted: true,
  },
];

const requirements = {
  jurisdictionId: "AE-CBUAE",
  operationType: "onboarding",
  evidenceStatus: "configured_policy_only",
  policySource: {
    kind: "internal_configuration",
    externalAuthorityVerified: false,
  },
  requiredCredentials: [
    {
      credentialType: "emirates_id",
      label: "Emirates Id",
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

const evaluation = {
  entityId: "0x1234567890abcdef1234567890abcdef12345678",
  jurisdiction: "AE-CBUAE",
  overallStatus: "partial",
  missingCredentials: ["source_of_funds"],
  expiringCredentials: [],
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

const sovereigntyEvidence = {
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

function queryResult<T>(data?: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  };
}

function authenticatedIdentity() {
  return {
    identity: {
      isLoading: false,
      isRegistered: true,
    },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: jest.fn(),
  };
}

describe("RegulatoryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0x1234567890abcdef1234567890abcdef12345678",
    });
    mockUseIdentity.mockReturnValue(authenticatedIdentity());
    mockUseJurisdictions.mockReturnValue(queryResult(jurisdictions));
    mockUseRequirements.mockReturnValue(queryResult(requirements));
    mockUseComplianceStatus.mockReturnValue(queryResult(evaluation));
    mockUseSovereignty.mockReturnValue(queryResult(sovereigntyEvidence));
    mockUseCrossBorder.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: false,
      mutateAsync: jest.fn(),
      reset: jest.fn(),
    });
  });

  it("states the evidence boundary and removes fabricated dashboard claims", () => {
    render(<RegulatoryPage />);

    expect(screen.getByText("Regulatory policy evidence")).toBeInTheDocument();
    expect(
      screen.getByText("Configured policy evidence only"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("Avg Score")).not.toBeInTheDocument();
    expect(screen.queryByText("Export Report")).not.toBeInTheDocument();
    expect(
      screen.queryByText("MiCA enters full enforcement"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request" }),
    ).not.toBeInTheDocument();
  });

  it("requires a connected wallet before exposing protected data", () => {
    mockUseAccount.mockReturnValue({ isConnected: false, address: undefined });
    mockUseIdentity.mockReturnValue({
      ...authenticatedIdentity(),
      identity: { isLoading: false, isRegistered: false },
      sessionStatus: "anonymous",
    });

    render(<RegulatoryPage />);

    expect(screen.getByText("Connect your wallet")).toBeInTheDocument();
    expect(mockUseJurisdictions).toHaveBeenCalledWith({ enabled: false });
    expect(screen.queryByText("UAE Central Bank")).not.toBeInTheDocument();
  });

  it("offers a real identity sign-in when the session is missing", () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: null,
      signIn,
    });

    render(<RegulatoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("shows backend catalog failures without static fallback jurisdictions", () => {
    mockUseJurisdictions.mockReturnValue({
      ...queryResult(),
      isError: true,
      error: new Error("Enterprise membership required"),
    });

    render(<RegulatoryPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enterprise membership required",
    );
    expect(screen.queryByText("Japan")).not.toBeInTheDocument();
    expect(screen.queryByText("Brazil")).not.toBeInTheDocument();
  });

  it("renders only configured jurisdiction metadata and supports search", () => {
    render(<RegulatoryPage />);

    expect(screen.getByText("UAE Central Bank")).toBeInTheDocument();
    expect(screen.getByText("GDPR")).toBeInTheDocument();
    expect(screen.queryByText(/97\/100/)).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Search configured jurisdictions"),
      { target: { value: "GDPR" } },
    );
    expect(screen.queryByText("UAE Central Bank")).not.toBeInTheDocument();
    expect(screen.getByText("GDPR")).toBeInTheDocument();
  });

  it("shows recorded evaluations and configured requirements without scores", () => {
    render(<RegulatoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /UAE Central Bank/ }));

    expect(screen.getByText("Central Bank of UAE")).toBeInTheDocument();
    expect(screen.getByText("Emirates Id")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText("Source Of Funds")).toBeInTheDocument();
    expect(
      screen.getByText("Configured review date (not statutory)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/business days/i)).not.toBeInTheDocument();
  });

  it("does not infer compliance when no recorded evaluation exists", () => {
    const notFound = Object.assign(new Error("No compliance status found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
    mockUseComplianceStatus.mockReturnValue({
      ...queryResult(),
      isError: true,
      error: notFound,
    });

    render(<RegulatoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /UAE Central Bank/ }));

    expect(
      screen.getByText(/No recorded evaluation is available/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Compliant")).not.toBeInTheDocument();
  });

  it("reports service failures instead of calling them missing evidence", () => {
    mockUseComplianceStatus.mockReturnValue({
      ...queryResult(),
      isError: true,
      error: new Error("Compliance store unavailable"),
    });

    render(<RegulatoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /UAE Central Bank/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Compliance store unavailable",
    );
    expect(
      screen.queryByText(/No recorded evaluation is available/),
    ).not.toBeInTheDocument();
  });

  it("passes user-supplied cross-border context to the real mutation", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCrossBorder.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: false,
      mutateAsync,
      reset: jest.fn(),
    });

    render(<RegulatoryPage />);
    fireEvent.change(screen.getByLabelText("Data category"), {
      target: { value: "financial" },
    });
    fireEvent.change(screen.getByLabelText("Transfer purpose"), {
      target: { value: "credential verification" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run assessment" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        fromJurisdiction: "AE-CBUAE",
        toJurisdiction: "EU-GDPR",
        dataCategory: "financial",
        purpose: "credential verification",
      }),
    );
  });

  it("shows an assessment failure without substituting a route", () => {
    mockUseCrossBorder.mockReturnValue({
      data: undefined,
      error: new Error("Policy service offline"),
      isError: true,
      isPending: false,
      mutateAsync: jest.fn(),
      reset: jest.fn(),
    });

    render(<RegulatoryPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Policy service offline",
    );
    expect(screen.queryByText(/Bilateral MOU active/)).not.toBeInTheDocument();
  });

  it("renders recorded residency evidence without a GDPR conclusion", () => {
    render(<RegulatoryPage />);

    expect(
      screen.getByText("Recorded data-residency evidence"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("me-central-1").length).toBeGreaterThan(0);
    expect(screen.getByText("Matches")).toBeInTheDocument();
    expect(screen.queryByText("GDPR Compliant")).not.toBeInTheDocument();
  });

  it("keeps feed and filing capabilities explicitly unavailable", () => {
    render(<RegulatoryPage />);

    expect(
      screen.getByText("Authoritative regulatory feed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Regulator filing and deadlines"),
    ).toBeInTheDocument();
    expect(screen.getByText(/No source URL/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not claim that a filing was delivered/),
    ).toBeInTheDocument();
  });
});
