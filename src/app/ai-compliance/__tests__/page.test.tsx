import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockSignIn = jest.fn();
const mockAcknowledge = jest.fn();
const mockScreenIdentity = jest.fn();
const mockRefetchAlerts = jest.fn();
const mockUseAccount = jest.fn();
const mockUseIdentity = jest.fn();
const mockUseComplianceAlerts = jest.fn();
const mockUseRiskAssessment = jest.fn();
const mockUseScreenIdentity = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/ai-compliance",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown>>(
          function MotionElement(props, ref) {
            const {
              initial: _initial,
              animate: _animate,
              exit: _exit,
              transition: _transition,
              whileHover: _whileHover,
              layout: _layout,
              ...rest
            } = props;
            return React.createElement(prop, { ...rest, ref });
          },
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("@/hooks/useAICompliance", () => ({
  useComplianceAlerts: (enabled: boolean) => mockUseComplianceAlerts(enabled),
  useAcknowledgeAlert: () => ({
    mutateAsync: mockAcknowledge,
    isPending: false,
  }),
  useScreenIdentity: () => mockUseScreenIdentity(),
  useRiskAssessment: (
    identityId: string | undefined,
    options: Record<string, unknown>,
  ) => mockUseRiskAssessment(identityId, options),
}));

import AICompliancePage from "../page";

const identityId = "550e8400-e29b-41d4-a716-446655440000";

const alertFixture = {
  alertId: "alert-1",
  entityId: identityId,
  level: "critical",
  category: "sanctions",
  title: "Potential sanctions match",
  description: "A configured source returned a possible name match.",
  regulation: "Tenant policy",
  actionRequired: "Review the source evidence",
  createdAt: "2026-07-18T08:00:00.000Z",
  source: "compliance",
};

const screeningFixture = {
  screeningId: "scr-1",
  identityId,
  result: "potential_match",
  matchScore: 91,
  matchedLists: [
    {
      listName: "Signed sanctions source",
      listSource: "signed_source",
      matchedName: "Example Person",
      matchConfidence: 0.91,
      entityType: "individual",
      sanctions: ["asset_freeze"],
      listedSince: "2025-01-01T00:00:00.000Z",
      lastUpdated: "2026-07-18T07:00:00.000Z",
      sdnId: "entry-1",
    },
  ],
  pepMatches: [],
  adverseMedia: [],
  riskIndicators: ["signed_source:pending_review"],
  screenedAt: "2026-07-18T08:00:00.000Z",
  expiresAt: "2026-07-19T08:00:00.000Z",
  listsChecked: ["signed_source", "pep_database"],
  unavailableChecks: ["adverse_media"],
};

const riskFixture = {
  riskAssessment: {
    assessmentId: "risk-1",
    entityId: identityId,
    entityType: "identity",
    compositeScore: 72,
    decision: "review",
    factors: [
      {
        name: "no_credentials",
        category: "credential",
        rawValue: 1,
        normalizedScore: 80,
        weight: 1,
        impact: "increasing",
        explanation: "No active credential evidence was returned.",
      },
    ],
    trend: "stable",
    jurisdiction: "AE",
    regulatoryRegime: "CBUAE/VARA",
    confidence: 0.64,
    timestamp: "2026-07-18T08:05:00.000Z",
  },
};

function authenticatedDefaults() {
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  });
  mockUseIdentity.mockReturnValue({
    identity: {
      isLoading: false,
      isRegistered: true,
    },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: mockSignIn,
  });
  mockUseComplianceAlerts.mockReturnValue({
    data: {
      alerts: [alertFixture],
      total: 1,
      complianceAlertCount: 1,
      fraudAlertCount: 0,
    },
    isPending: false,
    isFetching: false,
    error: null,
    refetch: mockRefetchAlerts,
  });
  mockUseScreenIdentity.mockReturnValue({
    data: null,
    error: null,
    isPending: false,
    mutateAsync: mockScreenIdentity,
  });
  mockUseRiskAssessment.mockReturnValue({
    data: null,
    error: null,
    isFetching: false,
  });
}

describe("AICompliancePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockResolvedValue(undefined);
    authenticatedDefaults();
    mockScreenIdentity.mockResolvedValue(screeningFixture);
    mockAcknowledge.mockResolvedValue({
      ...alertFixture,
      acknowledgedAt: "2026-07-18T08:06:00.000Z",
    });
  });

  it("does not request tenant data before a wallet is connected", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });

    render(<AICompliancePage />);

    expect(screen.getByText("Connect an operator wallet")).toBeInTheDocument();
    expect(mockUseComplianceAlerts).toHaveBeenCalledWith(false);
    expect(screen.queryByText(alertFixture.title)).not.toBeInTheDocument();
  });

  it("requires an explicit wallet-backed identity session", () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: "Session expired",
      signIn: mockSignIn,
    });

    render(<AICompliancePage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with wallet" }),
    );

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockUseComplianceAlerts).toHaveBeenCalledWith(false);
  });

  it("renders only returned organization alerts and acknowledges through the API", async () => {
    render(<AICompliancePage />);

    expect(screen.getByText(alertFixture.title)).toBeInTheDocument();
    expect(screen.getByText("Open alerts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() =>
      expect(mockAcknowledge).toHaveBeenCalledWith("alert-1"),
    );
  });

  it("submits the exact organization screening request", async () => {
    render(<AICompliancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Identity screening" }));

    fireEvent.change(screen.getByLabelText("Identity UUID"), {
      target: { value: identityId },
    });
    fireEvent.change(screen.getByLabelText("Full legal name"), {
      target: { value: "Example Person" },
    });
    fireEvent.change(screen.getByLabelText("Nationality (optional)"), {
      target: { value: "ae" },
    });
    fireEvent.change(
      screen.getByLabelText("Aliases (optional, comma separated)"),
      { target: { value: "Example Alias, Second Alias" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run configured screening" }),
    );

    await waitFor(() =>
      expect(mockScreenIdentity).toHaveBeenCalledWith({
        identityId,
        fullName: "Example Person",
        jurisdiction: "AE",
        nationality: "AE",
        aliases: ["Example Alias", "Second Alias"],
      }),
    );
  });

  it("shows source coverage and unavailable checks from the screening response", () => {
    mockUseScreenIdentity.mockReturnValue({
      data: screeningFixture,
      error: null,
      isPending: false,
      mutateAsync: mockScreenIdentity,
    });

    render(<AICompliancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Identity screening" }));

    expect(screen.getByText("signed_source")).toBeInTheDocument();
    expect(screen.getByText("Example Person")).toBeInTheDocument();
    expect(screen.getByText("adverse media")).toBeInTheDocument();
    expect(screen.getByText("91/100")).toBeInTheDocument();
  });

  it("requests and renders a real risk assessment for the submitted target", async () => {
    mockUseRiskAssessment.mockImplementation((requestedIdentityId) => ({
      data: requestedIdentityId ? riskFixture : null,
      error: null,
      isFetching: false,
    }));

    render(<AICompliancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Risk assessment" }));
    fireEvent.change(screen.getByLabelText("Identity UUID"), {
      target: { value: identityId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assess" }));

    await waitFor(() =>
      expect(mockUseRiskAssessment).toHaveBeenLastCalledWith(
        identityId,
        expect.objectContaining({
          enabled: true,
          jurisdiction: "AE",
          entityType: "identity",
        }),
      ),
    );
    expect(await screen.findByText("72/100")).toBeInTheDocument();
    expect(screen.getByText("no credentials")).toBeInTheDocument();
  });

  it("fails client validation before sending a malformed identity ID", () => {
    render(<AICompliancePage />);
    fireEvent.click(screen.getByRole("button", { name: "Identity screening" }));
    fireEvent.change(screen.getByLabelText("Identity UUID"), {
      target: { value: "not-an-id" },
    });
    fireEvent.change(screen.getByLabelText("Full legal name"), {
      target: { value: "Example Person" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Run configured screening" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Identity ID must be a valid UUID",
    );
    expect(mockScreenIdentity).not.toHaveBeenCalled();
  });

  it("contains no former fabricated command-center claims", () => {
    render(<AICompliancePage />);

    expect(screen.queryByText("AI Engine Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Viktor Petrov")).not.toBeInTheDocument();
    expect(screen.queryByText("94/100")).not.toBeInTheDocument();
    expect(screen.queryByText("MiCA Full Enforcement")).not.toBeInTheDocument();
    expect(
      screen.getByText("Evidence console, not legal advice"),
    ).toBeInTheDocument();
  });
});
