/**
 * Tests for useCredentials hooks — listing, detail retrieval,
 * credential requesting, and issuer registry revocation.
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
const credentialId = "d74ed26c-47ac-4b62-94a8-38704c53b876";

const backendCredential = {
  id: credentialId,
  credentialType: "KYC_LEVEL_2",
  issuerId: "issuer-record-17",
  subjectId: "subject-record-8",
  claimsHash:
    "3f3bd8d3d60d1412f98f8f366f0bbbea21c10ac40db80a9e28fa8911223e7f4b",
  proof: { type: "DataIntegrityProof" },
  status: "ACTIVE",
  issuedAt: "2026-07-18T08:00:00.000Z",
  expiresAt: "2027-07-18T08:00:00.000Z",
};

const mockUseAccount = jest.fn();
const mockUseReadContract = jest.fn();
const mockWriteContractAsync = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useReadContract: (args: unknown) => mockUseReadContract(args),
  usePublicClient: jest.fn(() => undefined),
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

// A registered user has an identity session token; protected credential queries
// are gated on it, so mock a present token for the fetch-path tests.
jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(() => "identity-token"),
}));

jest.mock("@/config/constants", () => ({
  DID_METHOD_PREFIX: "did:aethelred",
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
  mockWriteContractAsync.mockResolvedValue("0xunused");
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
      const credsResponse = [
        backendCredential,
        {
          ...backendCredential,
          id: "9b4bde84-439b-452b-a0eb-d0671988ad44",
          credentialType: "EMPLOYMENT",
          status: "SUSPENDED",
        },
      ];
      (apiClient.get as jest.Mock).mockResolvedValue(credsResponse);

      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toMatchObject({
          credentials: [
            {
              id: credentialId,
              typeLabel: "KYC Level 2",
              category: "kyc",
              status: "active",
              issuerId: "issuer-record-17",
              claimsHash: backendCredential.claimsHash,
            },
            {
              id: "9b4bde84-439b-452b-a0eb-d0671988ad44",
              typeLabel: "Employment",
              category: "employment",
              status: "suspended",
            },
          ],
          total: 2,
        });
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/credentials"),
      );
    });

    it("passes status filter to the query", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);

      const { useCredentials } = await import("@/hooks/useCredentials");
      renderHook(() => useCredentials("active" as any), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
      });

      const url = (apiClient.get as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain("status=ACTIVE");
      expect(url).toContain("role=subject");
    });

    it("queries issuer inventory only when explicitly requested", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);

      const { useCredentials } = await import("@/hooks/useCredentials");
      renderHook(() => useCredentials(undefined, "issuer"), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
      expect((apiClient.get as jest.Mock).mock.calls[0][0]).toContain(
        "role=issuer",
      );
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

    it("does not fetch protected credentials without an identity session token", async () => {
      // A connected-but-unregistered wallet has no session JWT; the query must
      // stay disabled rather than fire and 401.
      const { getIdentityAuthToken } = jest.requireMock(
        "@/lib/identity/registration",
      );
      (getIdentityAuthToken as jest.Mock).mockReturnValue(null);
      try {
        const { useCredentials } = await import("@/hooks/useCredentials");
        const { result } = renderHook(() => useCredentials(), {
          wrapper: createQueryWrapper(),
        });

        expect(result.current.isFetching).toBe(false);
        expect(apiClient.get).not.toHaveBeenCalled();
      } finally {
        (getIdentityAuthToken as jest.Mock).mockReturnValue("identity-token");
      }
    });

    it("includes correct query key with status", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);

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

    it("does not expose the issuer-only issuance endpoint as a holder action", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);
      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current).not.toHaveProperty("requestCredential");
      expect(apiClient.post).not.toHaveBeenCalledWith(
        "/api/v1/credentials",
        expect.anything(),
      );
    });

    it("reports a passing authenticated validation response without changing status", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);
      (apiClient.post as jest.Mock).mockResolvedValue({ valid: true });
      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.verifyCredential(credentialId);
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        `/api/v1/credentials/${credentialId}/verify`,
        {},
      );
      expect(toast.success).toHaveBeenCalledWith(
        "Credential validation passed",
      );
    });

    it("does not call an invalid backend verification result successful", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue([]);
      (apiClient.post as jest.Mock).mockResolvedValue({ valid: false });
      const { useCredentials } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentials(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.verifyCredential(credentialId);
      });

      expect(toast.success).not.toHaveBeenCalledWith(
        "Credential validation passed",
      );
      expect(toast.error).toHaveBeenCalledWith("Credential validation failed", {
        description: "One or more authenticated backend checks did not pass",
      });
    });
  });

  // =========================================================================
  // useCredentialDetails
  // =========================================================================

  describe("useCredentialDetails", () => {
    it("fetches and normalizes backend detail without a fake on-chain read", async () => {
      (apiClient.get as jest.Mock).mockResolvedValue(backendCredential);

      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails(credentialId), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => expect(result.current.data?.status).toBe("active"));
      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/v1/credentials/${credentialId}`,
      );
      expect(mockUseReadContract).not.toHaveBeenCalled();
      expect(result.current).not.toHaveProperty("onChainHash");
      expect(result.current).not.toHaveProperty("isIntegrityValid");
      expect(result.current.registryAnchor).toEqual({
        available: false,
        reason: expect.stringContaining(
          "does not supply a deployed-registry bytes32 identifier",
        ),
      });
    });

    it("does not fetch when credentialId is undefined", async () => {
      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails(undefined), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("does not fetch a non-UUID identifier as either API or bytes32 input", async () => {
      const { useCredentialDetails } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useCredentialDetails("cred-123"), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
      expect(mockUseReadContract).not.toHaveBeenCalled();
    });

    it("does not fetch credential detail without a current identity token", async () => {
      const { getIdentityAuthToken } = jest.requireMock(
        "@/lib/identity/registration",
      );
      (getIdentityAuthToken as jest.Mock).mockReturnValue(null);
      try {
        const { useCredentialDetails } = await import("@/hooks/useCredentials");
        const { result } = renderHook(
          () => useCredentialDetails(credentialId),
          { wrapper: createQueryWrapper() },
        );

        expect(result.current.fetchStatus).toBe("idle");
        expect(apiClient.get).not.toHaveBeenCalled();
        expect(mockUseReadContract).not.toHaveBeenCalled();
      } finally {
        (getIdentityAuthToken as jest.Mock).mockReturnValue("identity-token");
      }
    });
  });

  // =========================================================================
  // useRevokeCredential
  // =========================================================================

  describe("useRevokeCredential", () => {
    it("revokes an issuer-owned credential through the ZeroID registry API", async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        ...backendCredential,
        status: "REVOKED",
      });

      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      let revokedStatus: string | undefined;
      await act(async () => {
        const revoked = await result.current.mutateAsync({
          credentialId,
          reason: "Issuer confirmed that the source record is invalid",
        });
        revokedStatus = revoked.status;
      });

      expect(revokedStatus).toBe("revoked");
      expect(mockWriteContractAsync).not.toHaveBeenCalled();

      expect(apiClient.post).toHaveBeenCalledWith(
        `/api/v1/credentials/${credentialId}/revoke`,
        { reason: "Issuer confirmed that the source record is invalid" },
      );

      expect(toast.success).toHaveBeenCalledWith(
        "Credential revoked in the ZeroID registry",
      );
    });

    it("shows error toast on revocation failure", async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(
        new Error("Not authorized to revoke"),
      );

      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            credentialId,
            reason: "Issuer confirmed the credential is compromised",
          });
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith("Revocation failed", {
        description: "Not authorized to revoke",
      });
    });

    it("rejects non-UUID identifiers before calling the registry API", async () => {
      const { useRevokeCredential } = await import("@/hooks/useCredentials");
      const { result } = renderHook(() => useRevokeCredential(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            credentialId: "0xnot-a-zeroid-uuid",
            reason: "Issuer confirmed the credential is compromised",
          });
        } catch {
          // Expected
        }
      });

      expect(mockWriteContractAsync).not.toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Revocation failed", {
        description: "Credential revocation requires a ZeroID credential UUID",
      });
    });
  });
});
