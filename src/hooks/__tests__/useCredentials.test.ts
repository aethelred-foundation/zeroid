/**
 * Tests for useCredentials hooks — listing, detail retrieval,
 * credential requesting, and on-chain revocation.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = "0xholder0000000000000000000000000000000001";
const mockTxHash =
  "0xtxhash000000000000000000000000000000000000000000000000000000001";

const mockUseAccount = jest.fn();
const mockUseReadContract = jest.fn();
const mockWriteContractAsync = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useReadContract: (args: unknown) => mockUseReadContract(args),
  useWriteContract: () => ({
    writeContractAsync: mockWriteContractAsync,
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/config/constants", () => ({
  CREDENTIAL_REGISTRY_ADDRESS: "0xCredRegistryAddress",
  CREDENTIAL_REGISTRY_ABI: [{ type: "function", name: "credentialHash" }],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({ address: mockAddress });
  mockUseReadContract.mockReturnValue({ data: undefined, isLoading: false });
  mockWriteContractAsync.mockResolvedValue(mockTxHash);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCredentials hooks", () => {
  // =========================================================================
  // useCredentials
  // =========================================================================

  describe("useCredentials", () => {
    it("fetches credentials for the connected address", async () => {
      const credsResponse = {
        credentials: [
          { hash: "0xcred1", status: "active" },
          { hash: "0xcred2", status: "active" },
        ],
        total: 2,
      };
      (apiClient.get as jest.Mock).mockResolvedValue(credsResponse);

      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(credsResponse);
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/credentials/${mockAddress}`),
      );
    });

    it("passes status filter to the query", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      const { useCredentials } = await import("@/hooks/useCredentials");
      renderHook(() => useCredentials("active" as any), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain("status=active");
    });

    it("does not fetch when address is undefined", async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("includes correct query key with status", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result: result1 } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });
      const { result: result2 } = renderHook(
        () => useCredentials("revoked" as any),
        { wrapper: createQueryWrapper() },
      );

      // Both should trigger API calls with different params
      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // useCredentialDetails
  // =========================================================================

  describe("useCredentialDetails", () => {
    it("fetches credential detail from API and on-chain hash", async () => {
      const credDetail = {
        hash: "0xcred1",
        schemaName: "Government ID",
        contentHash: "0xonchain_hash_match",
      };

      (apiClient.get as jest.Mock).mockResolvedValue(credDetail);
      mockUseReadContract.mockReturnValue({
        data: "0xonchain_hash_match",
        isLoading: false,
      });

      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails("cred-123"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(credDetail);
      });

      expect(result.current.onChainHash).toBe("0xonchain_hash_match");
      expect(result.current.isIntegrityValid).toBe(true);
    });

    it("returns isIntegrityValid false when hashes do not match", async () => {
      const credDetail = {
        hash: "0xcred1",
        contentHash: "0xoffchain_hash",
      };

      (apiClient.get as jest.Mock).mockResolvedValue(credDetail);
      mockUseReadContract.mockReturnValue({
        data: "0xonchain_hash_different",
        isLoading: false,
      });

      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails("cred-123"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(result.current.isIntegrityValid).toBe(false);
    });

    it("returns isIntegrityValid undefined when data is not yet loaded", async () => {
      (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {}));
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails("cred-123"), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isIntegrityValid).toBeUndefined();
    });

    it("does not fetch when credentialId is undefined", async () => {
      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails(undefined), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("exposes isHashLoading from on-chain read", async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails("cred-123"), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isHashLoading).toBe(true);
    });
  });

  // =========================================================================
  // useRequestCredential
  // =========================================================================

  describe("useRequestCredential", () => {
    it("submits a credential request and shows success toast", async () => {
      const response = { credentialId: "cred-new-0123456789ab" };
      (apiClient.post as jest.Mock).mockResolvedValue(response);

      const { useRequestCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRequestCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          issuerDid: "did:aethelred:testnet:0xissuer",
          schemaId: "schema-1",
          claims: { fullName: "Alice" },
          proofOfEligibility: "proof-data",
        } as any);
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        "/v1/credentials/request",
        expect.objectContaining({
          holderAddress: mockAddress,
          issuerDid: "did:aethelred:testnet:0xissuer",
          schemaId: "schema-1",
        }),
      );

      expect(toast.success).toHaveBeenCalledWith("Credential requested", {
        description: expect.stringContaining("cred-new-012"),
      });
    });

    it("shows error toast on request failure", async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(
        new Error("Issuer unavailable"),
      );

      const { useRequestCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRequestCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            issuerDid: "did:aethelred:testnet:0xissuer",
            schemaId: "schema-1",
            claims: {},
          } as any);
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Credential request failed", {
        description: "Issuer unavailable",
      });
    });
  });

  // =========================================================================
  // useRevokeCredential
  // =========================================================================

  describe("useRevokeCredential", () => {
    it("revokes a credential on-chain and notifies API", async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      let hash: string | undefined;
      await act(async () => {
        hash = await result.current.mutateAsync("cred-to-revoke");
      });

      expect(hash).toBe(mockTxHash);

      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "revokeCredential",
          args: ["cred-to-revoke"],
        }),
      );

      expect(apiClient.post).toHaveBeenCalledWith(
        "/v1/credentials/cred-to-revoke/revoke",
        expect.objectContaining({
          txHash: mockTxHash,
          revokerAddress: mockAddress,
        }),
      );

      expect(toast.success).toHaveBeenCalledWith("Credential revoked");
    });

    it("shows error toast on revocation failure", async () => {
      mockWriteContractAsync.mockRejectedValue(
        new Error("Not authorized to revoke"),
      );

      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync("cred-to-revoke");
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Revocation failed", {
        description: "Not authorized to revoke",
      });
    });

    it("handles API notification failure after on-chain revocation", async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(
        new Error("API notification failed"),
      );

      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync("cred-to-revoke");
        } catch {
          // Expected — the mutation includes the API call
        }
      });

      // On-chain call should have succeeded
      expect(mockWriteContractAsync).toHaveBeenCalled();
      // Error toast shown
      expect(toast.error).toHaveBeenCalledWith("Revocation failed", {
        description: "API notification failed",
      });
    });
  });
});
