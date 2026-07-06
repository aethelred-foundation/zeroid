/**
 * useCrossChain — Unit Tests
 *
 * Tests for production-honest cross-chain hooks: configured chain discovery,
 * fee estimation, bridged inventory derivation, and credential-backed
 * verification preflight.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

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
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

jest.mock("@/config/constants", () => ({
  CONTRACT_ADDRESSES: {
    crossChainBridge: "0x1111111111111111111111111111111111111111",
  },
}));

import { useAccount } from "wagmi";
import {
  useSupportedChains,
  useBridgeCredential,
  useBridgeStatus,
  useBridgedCredentials,
  useBridgeFeeEstimate,
  useVerifyBridgedCredential,
} from "@/hooks/useCrossChain";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const activeCredential = {
  id: "cred-1",
  hash: "0xcred1",
  schemaHash: "0xschema",
  schemaName: "KYC Credential",
  issuerDid: { uri: "did:aethelred:issuer:edge" },
  issuer: "EDGE",
  subjectDid: { uri: "did:aethelred:subject:1" },
  issuedAt: 1_782_000_000,
  expiresAt: 1_900_000_000,
  status: "verified",
  merkleRoot: "0xroot",
  bridgedChains: [137],
};

beforeEach(() => {
  jest.clearAllMocks();
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
});

describe("useSupportedChains", () => {
  it("returns configured chain metadata from bridge contract configuration", async () => {
    const { result } = renderHook(() => useSupportedChains(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((chain) => chain.chainId)).toEqual([
      1, 137, 42161, 11155111,
    ]);
    expect(result.current.data?.[0].bridgeContractAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });
});

describe("useBridgeCredential", () => {
  it("fails clearly when relayer submission is not configured", async () => {
    const { result } = renderHook(() => useBridgeCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          credentialId: "cred-1",
          destinationChainId: 137,
          priority: "standard",
          preservePrivacy: true,
        }),
      ).rejects.toThrow("relayer endpoint is not configured");
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Bridge initiation failed", {
      description: expect.stringContaining("relayer endpoint"),
    });
  });
});

describe("useBridgeStatus", () => {
  it("reports that bridge polling needs a configured relayer status endpoint", async () => {
    const { result } = renderHook(() => useBridgeStatus("bridge-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      message: expect.stringContaining("relayer status endpoint"),
    });
  });

  it("is disabled when bridgeId is undefined", () => {
    const { result } = renderHook(() => useBridgeStatus(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useBridgedCredentials", () => {
  it("derives bridged credentials from credential inventory bridge metadata", async () => {
    mockApiClient.get.mockResolvedValue([activeCredential]);
    const { result } = renderHook(() => useBridgedCredentials(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/credentials?role=subject",
    );
    expect(result.current.data?.[0]).toMatchObject({
      credentialId: "cred-1",
      bridgedChainId: 137,
      bridgedChainName: "Polygon",
      status: "active",
    });
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useBridgedCredentials(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useBridgeFeeEstimate", () => {
  it("computes deterministic bridge fee estimates for supported chains", async () => {
    const { result } = renderHook(() => useBridgeFeeEstimate("cred-1", 137), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      credentialId: "cred-1",
      destinationChainId: 137,
    });
    expect(Number(result.current.data?.estimates.fast.totalFee)).toBeGreaterThan(
      Number(result.current.data?.estimates.standard.totalFee),
    );
  });

  it("is disabled when credentialId is undefined", () => {
    const { result } = renderHook(() => useBridgeFeeEstimate(undefined, 137), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useVerifyBridgedCredential", () => {
  it("verifies credential integrity preflight against backend credential record", async () => {
    mockApiClient.get.mockResolvedValue(activeCredential);
    const { result } = renderHook(() => useVerifyBridgedCredential(), {
      wrapper: createWrapper(),
    });

    let verification;
    await act(async () => {
      verification = await result.current.mutateAsync({
        credentialId: "cred-1",
        chainId: 137,
      });
    });

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/credentials/cred-1",
    );
    expect(verification).toMatchObject({
      credentialId: "cred-1",
      chainName: "Polygon",
      integrityValid: true,
      issuerValid: true,
      expiryValid: true,
      verified: true,
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Credential verified on destination chain",
      expect.objectContaining({
        description: expect.stringContaining("Polygon"),
      }),
    );
  });

  it("shows error toast when preflight verification fails", async () => {
    mockApiClient.get.mockResolvedValue({
      ...activeCredential,
      status: "revoked",
    });
    const { result } = renderHook(() => useVerifyBridgedCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ credentialId: "cred-1", chainId: 137 });
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Credential verification failed",
      expect.objectContaining({
        description: expect.stringContaining("Polygon"),
      }),
    );
  });
});
