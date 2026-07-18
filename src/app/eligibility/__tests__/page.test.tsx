import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EligibilityPage from "../page";

const mockUseAccount = jest.fn();
const mockUseIdentity = jest.fn();
const mockSignIn = jest.fn();
const mockGetIdentityAuthToken = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: () => mockGetIdentityAuthToken(),
}));

jest.mock("@/lib/utils", () => ({
  generateUUID: () => "123e4567-e89b-42d3-a456-426614174000",
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const { initial, animate, transition, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
}));

const credential = {
  id: "123e4567-e89b-42d3-a456-426614174001",
  credentialType: "KYC_LEVEL_2",
  typeLabel: "KYC Level 2",
  category: "kyc",
  issuerId: "issuer-record-1",
  subjectId: "identity-1",
  claimsHash: "a".repeat(64),
  proofAvailable: true,
  status: "active",
  issuedAt: "2026-07-01T00:00:00.000Z",
  expiresAt: "2027-07-01T00:00:00.000Z",
};

const receipt = {
  status: "ALLOWED",
  decisionId: "dec_backend_1",
  policyId:
    "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
  policyVersion: "2026.06.1",
  subjectDid: "did:aethelred:testnet:holder-1",
  credentialId: credential.id,
  relyingAppId: "verifier-production-1",
  proof: {
    proofId: "zkp_backend_1",
    verified: true,
    groth16Proof: {
      pi_a: ["1", "2", "1"],
      pi_b: [
        ["3", "4"],
        ["5", "6"],
        ["1", "0"],
      ],
      pi_c: ["7", "8", "1"],
      protocol: "groth16",
      curve: "bn128",
    },
    circuitId: "zkc_eligibility_policy_context_v1",
    circuitName: "eligibility_policy_context_v1",
    verificationKeyId: "vk_eligibility_policy_context_v1_2026_06_27",
    manifestDigest:
      "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
    policyBindingDigest:
      "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
    contextHash: `0x${"b".repeat(64)}`,
    verifiedAt: "2026-07-18T10:00:00.000Z",
    publicSignals: { claimsHash: `0x${"a".repeat(64)}` },
    privateInputsRedacted: ["dateOfBirth"],
    disclosurePolicy: {
      rawFieldsDisclosed: [],
      publicSignals: ["claimsHash"],
      provedPredicates: ["AGE_OVER_THRESHOLD"],
      privateInputsRedacted: ["dateOfBirth"],
      disclosureBudget: {
        rawFieldCount: 0,
        publicSignalCount: 1,
        provedPredicateCount: 1,
        redactedPrivateInputCount: 1,
      },
    },
  },
  evaluation: {
    ageOverThreshold: true,
    residencyAllowed: true,
    nationalityAllowed: true,
    sanctionsClear: true,
    riskAccepted: true,
    credentialActive: true,
    credentialNotExpired: true,
    nonRevocationChecked: true,
    onchainAttested: false,
    teeAttested: true,
    minimumAge: 21,
    computedAge: 33,
    allowedResidencies: ["AE"],
    deniedReasons: [],
  },
  evidence: {
    auditLogId: "audit-backend-1",
    auditHash: `0x${"c".repeat(64)}`,
    regulatoryReportId: "reg-backend-1",
    teeAttestationId: "tee-backend-1",
    receiptHash: `0x${"d".repeat(64)}`,
    receiptHashAlgorithm: "sha256-canonical-json-v1",
    policyRegistry: "zeroid://policy-registry/test",
    artifactDigest: `0x${"e".repeat(64)}`,
    manifestPath: "circuits/manifest/eligibility_v1.json",
    manifestDigest:
      "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
    sourceDigest: `0x${"f".repeat(64)}`,
    policyBindingDigest:
      "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
    artifactStatus: "SOURCE_VALIDATED_ARTIFACTS_PENDING",
    evidenceChain: ["issuer-proof", "tee-backend-1"],
  },
  issuedAt: "2026-07-18T10:00:00.000Z",
};

const fetchMock = jest.fn();

function authenticatedIdentity(credentials = [credential]) {
  return {
    identity: {
      profile: { did: "did:aethelred:testnet:holder-1" },
      credentials,
      isLoading: false,
      isRegistered: true,
      error: null,
    },
    did: { uri: "did:aethelred:testnet:holder-1" },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: mockSignIn,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({ isConnected: true });
  mockUseIdentity.mockReturnValue(authenticatedIdentity());
  mockGetIdentityAuthToken.mockReturnValue("identity-token");
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: receipt, source: "backend" }),
  });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

describe("EligibilityPage", () => {
  it("does not evaluate or render sample evidence on mount", () => {
    render(<EligibilityPage />);

    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Eligibility")).toBeInTheDocument();
    expect(
      screen.getByText("No backend eligibility receipt has been loaded."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/deterministic demo/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/EDGE Secure Data Room/i),
    ).not.toBeInTheDocument();
  });

  it("keeps proof issuance disabled while production artifacts are pending", () => {
    render(<EligibilityPage />);

    fireEvent.change(screen.getByLabelText("Relying application ID"), {
      target: { value: "verifier-production-1" },
    });
    const submit = screen.getByRole("button", {
      name: "Request eligibility evidence",
    });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText(/signed credential witness.*must be integrated/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads only an authenticated backend receipt", async () => {
    render(<EligibilityPage />);
    fireEvent.change(screen.getByLabelText("Receipt ID"), {
      target: { value: "dec_backend_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/eligibility/proof/dec_backend_1",
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer identity-token",
    );
    expect(await screen.findByText("ALLOWED")).toBeInTheDocument();
  });

  it("does not enable a request when no active credential was returned", () => {
    mockUseIdentity.mockReturnValue(authenticatedIdentity([]));
    render(<EligibilityPage />);
    fireEvent.change(screen.getByLabelText("Relying application ID"), {
      target: { value: "verifier-production-1" },
    });

    expect(
      screen.getByRole("button", { name: "Request eligibility evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/returned no active credentials/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers wallet-backed sign-in instead of calling eligibility anonymously", async () => {
    mockUseIdentity.mockReturnValue({
      ...authenticatedIdentity([]),
      sessionStatus: "sign-in-required",
      sessionError: "Session expired",
    });
    mockGetIdentityAuthToken.mockReturnValue(undefined);
    mockSignIn.mockResolvedValue(undefined);
    render(<EligibilityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
