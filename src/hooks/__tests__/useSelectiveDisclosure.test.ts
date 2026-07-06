/**
 * useSelectiveDisclosure — Unit Tests
 *
 * Tests for selective disclosure hooks: create request, build response,
 * pending disclosures, request detail, and history.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0x1234567890abcdef1234567890abcdef12345678";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
const mockToast = jest.requireMock("sonner").toast;

jest.mock("@/lib/api/client", () => ({
  ZeroIDApiError: class ZeroIDApiError extends Error {
    code: string;
    statusCode: number;

    constructor(message: string, code: string, statusCode: number) {
      super(message);
      this.name = "ZeroIDApiError";
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  apiClient: {
    createVerificationRequest: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    respondToVerification: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(() => "identity-token"),
}));
const mockGetIdentityAuthToken = jest.requireMock(
  "@/lib/identity/registration",
).getIdentityAuthToken;

import { useAccount } from "wagmi";
import {
  useCreateDisclosureRequest,
  useBuildDisclosureResponse,
  usePendingDisclosures,
  useDisclosureRequest,
  useDisclosureHistory,
} from "@/hooks/useSelectiveDisclosure";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const attributeHash = `0x${"a".repeat(64)}` as `0x${string}`;

function makeDisclosureAttribute(key = "name") {
  return {
    key,
    value: "Ada",
    hash: attributeHash,
  };
}

function makeVerificationRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    requestedAttributes: ["name"],
    purpose: "KYC verification",
    expiresAt: 1700003600,
    ...overrides,
  };
}

function makeProof() {
  return {
    id: "proof-1",
    circuitId: "0xcircuit",
    circuitName: "selective_disclosure",
    proofSystem: "groth16",
    proof: {
      a: ["0x1", "0x2"],
      b: [
        ["0x3", "0x4"],
        ["0x5", "0x6"],
      ],
      c: ["0x7", "0x8"],
    },
    publicInputs: ["0x1"],
    publicOutputs: ["0x1"],
    generatedAt: 1700000000,
    validityDuration: 300,
    proofHash: "0xproofhash",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdentityAuthToken.mockReturnValue("identity-token");
  mockApiClient.createVerificationRequest.mockResolvedValue(
    makeVerificationRequest(),
  );
  mockApiClient.respondToVerification.mockResolvedValue({
    requestId: "req-1",
    verified: true,
    attributeResults: [],
    verifiedAt: 1700000000,
  });
  mockApiClient.get.mockResolvedValue([makeVerificationRequest()]);
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
});

// ===========================================================================
// useCreateDisclosureRequest
// ===========================================================================

describe("useCreateDisclosureRequest", () => {
  it("creates disclosure requests as durable verification requests", async () => {
    const { result } = renderHook(() => useCreateDisclosureRequest(), {
      wrapper: createWrapper(),
    });

    let created: any;
    await act(async () => {
      created = await result.current.mutateAsync({
        subjectDid: "did:aethelred:mainnet:0x1",
        requestedAttributes: [makeDisclosureAttribute()],
        policy: { circuitId: "selective_disclosure" } as any,
        purpose: "KYC verification",
      });
    });

    expect(created).toEqual({ requestId: "req-1", challenge: "req-1" });
    expect(mockApiClient.createVerificationRequest).toHaveBeenCalledWith(
      {
        subjectDid: "did:aethelred:mainnet:0x1",
        credentialHash: attributeHash,
        requestedAttributes: ["name"],
        circuitId: "selective_disclosure",
        expiresAt: expect.any(Number),
        purpose: "KYC verification",
        requiredAttributes: [makeDisclosureAttribute()],
      },
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "Disclosure request created",
      { description: expect.stringContaining("req-1") },
    );
  });

  it("fails before backend submission when no credential commitment is available", async () => {
    const { result } = renderHook(() => useCreateDisclosureRequest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          subjectDid: "did:x",
          requestedAttributes: [{ key: "name" }] as any,
          policy: {} as any,
          purpose: "test",
          expiresIn: 7200,
        });
      } catch {}
    });

    expect(mockApiClient.createVerificationRequest).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Failed to create disclosure request",
      {
        description:
          "Disclosure request requires a credentialHash, schemaHash, or hashed requested attribute.",
      },
    );
  });
});

// ===========================================================================
// useBuildDisclosureResponse
// ===========================================================================

describe("useBuildDisclosureResponse", () => {
  it("submits disclosure responses through verification proof responses", async () => {
    const { result } = renderHook(() => useBuildDisclosureResponse(), {
      wrapper: createWrapper(),
    });

    let response: any;
    await act(async () => {
      response = await result.current.mutateAsync({
        requestId: "req-1",
        selectedAttributes: [makeDisclosureAttribute()],
        credentialIds: ["cred-1"],
        zkProof: JSON.stringify(makeProof()),
      });
    });

    expect(response).toMatchObject({
      requestId: "req-1",
      selectedAttributes: [makeDisclosureAttribute()],
      credentialIds: ["cred-1"],
    });
    expect(mockApiClient.respondToVerification).toHaveBeenCalledWith(
      "req-1",
      {
        consent: true,
        proof: expect.objectContaining({ id: "proof-1" }),
      },
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "Disclosure response submitted",
      { description: "Selected attributes shared with verifier" },
    );
  });

  it("rejects malformed proof payloads before calling the backend", async () => {
    const { result } = renderHook(() => useBuildDisclosureResponse(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          requestId: "req-1",
          selectedAttributes: [],
          credentialIds: [],
          zkProof: "",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Disclosure response failed", {
      description:
        "Disclosure response requires a generated ZK proof JSON payload.",
    });
    expect(mockApiClient.respondToVerification).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// usePendingDisclosures
// ===========================================================================

describe("usePendingDisclosures", () => {
  it("loads pending disclosures from the durable verification inbox", async () => {
    const { result } = renderHook(() => usePendingDisclosures(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: "req-1",
        requestedAttributes: [{ key: "name" }],
        policy: { purpose: "KYC verification", expiresAt: 1700003600 },
      }),
    ]);
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/verification/requests?role=subject&result=PENDING&limit=100",
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => usePendingDisclosures(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useDisclosureRequest
// ===========================================================================

describe("useDisclosureRequest", () => {
  it("loads disclosure detail from the pending verification inbox", async () => {
    const { result } = renderHook(() => useDisclosureRequest("req-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      id: "req-1",
      requestedAttributes: [{ key: "name" }],
      policy: { purpose: "KYC verification", expiresAt: 1700003600 },
    });
  });

  it("fails when the disclosure request is not pending", async () => {
    mockApiClient.get.mockResolvedValue([]);
    const { result } = renderHook(() => useDisclosureRequest("missing"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain(
      "Disclosure request missing was not found",
    );
  });

  it("is disabled when requestId is undefined", () => {
    const { result } = renderHook(() => useDisclosureRequest(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useDisclosureHistory
// ===========================================================================

describe("useDisclosureHistory", () => {
  it("loads disclosure history from verification history", async () => {
    mockApiClient.get.mockResolvedValue([{ id: "hist-1", requestId: "req-1" }]);
    const { result } = renderHook(() => useDisclosureHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      items: [{ id: "hist-1", requestId: "req-1" }],
      total: 1,
    });
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/verification/history?page=1&pageSize=20&limit=20",
    );
  });

  it("passes custom pagination to verification history", async () => {
    mockApiClient.get.mockResolvedValue([]);
    const { result } = renderHook(() => useDisclosureHistory(3, 50), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/verification/history?page=3&pageSize=50&limit=50",
    );
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useDisclosureHistory(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
