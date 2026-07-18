import { renderHook, waitFor } from "@testing-library/react";
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
  },
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;
const mockToast = jest.requireMock("sonner").toast;

import { useAccount } from "wagmi";
import {
  AuditResponseContractError,
  exportAuditLog,
  useAudit,
  useAuditLog,
  useCredentialAudit,
  useIdentityActivitySummary,
  useVerificationAudit,
} from "@/hooks/useAudit";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

let blobParts: unknown[] | undefined;
let blobType: string | undefined;
let clickDownload: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
  blobParts = undefined;
  blobType = undefined;
  clickDownload = jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  URL.createObjectURL = jest.fn(() => "blob:zeroid-audit");
  URL.revokeObjectURL = jest.fn();
  global.Blob = jest.fn((parts: unknown[], options?: BlobPropertyBag) => {
    blobParts = parts;
    blobType = options?.type;
    return { size: 1, type: options?.type ?? "" } as Blob;
  }) as unknown as typeof Blob;
});

afterEach(() => {
  clickDownload.mockRestore();
});

describe("useAudit", () => {
  it("uses one filtered audit endpoint and preserves backend action fields", async () => {
    mockApiClient.get.mockResolvedValue([
      {
        id: "audit-1",
        identityId: "identity-1",
        action: "CREDENTIAL_ISSUED",
        resourceType: "credential",
        resourceId: "credential-1",
        timestamp: "2026-07-18T08:00:00Z",
      },
    ]);

    const { result } = renderHook(
      () =>
        useAudit({
          entityType: "credential",
          startDate: "2026-07-01T00:00:00.000Z",
          endDate: "2026-07-18T23:59:59.000Z",
          page: 2,
          pageSize: 25,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain("resourceType=credential");
    expect(url).toContain("from=2026-07-01T00%3A00%3A00.000Z");
    expect(url).toContain("to=2026-07-18T23%3A59%3A59.000Z");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=25");
    expect(result.current.auditLog).toEqual([
      expect.objectContaining({
        id: "audit-1",
        action: "CREDENTIAL_ISSUED",
        type: "CREDENTIAL_ISSUED",
        actor: "identity-1",
        entityType: "credential",
        entityId: "credential-1",
        timestamp: "2026-07-18T08:00:00.000Z",
      }),
    ]);
    expect(result.current.total).toBe(1);
  });

  it("marks missing and invalid timestamps unavailable instead of using now", async () => {
    mockApiClient.get.mockResolvedValue([
      { id: "audit-1", action: "IDENTITY_UPDATED" },
      {
        id: "audit-2",
        action: "AUTH_LOGIN",
        timestamp: "not-a-date",
      },
      {
        id: "audit-3",
        action: "AUTH_LOGOUT",
        timestamp: 1_700_000_000,
      },
    ]);

    const { result } = renderHook(() => useAudit(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.auditLog[0].timestamp).toBeUndefined();
    expect(result.current.auditLog[1].timestamp).toBeUndefined();
    expect(result.current.auditLog[2].timestamp).toBe(
      "2023-11-14T22:13:20.000Z",
    );
  });

  it("excludes malformed records without inventing an action name", async () => {
    mockApiClient.get.mockResolvedValue([
      { id: "missing-action", timestamp: "2026-01-01T00:00:00Z" },
      { action: "AUTH_LOGIN", timestamp: "2026-01-01T00:00:00Z" },
      { id: "valid", action: "AUTH_LOGIN" },
    ]);

    const { result } = renderHook(() => useAudit(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.auditLog).toHaveLength(1);
    expect(result.current.auditLog[0].action).toBe("AUTH_LOGIN");
    expect(result.current.auditLog[0].type).not.toBe("audit");
  });

  it("fails closed on a non-array audit response", async () => {
    mockApiClient.get.mockResolvedValue({ records: [] });
    const { result } = renderHook(() => useAuditLog(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(AuditResponseContractError);
  });

  it("does not query without a connected address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useAudit(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isConnected).toBe(false);
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("does not query until the caller enables an authenticated session", () => {
    renderHook(() => useAuditLog({}, false), {
      wrapper: createWrapper(),
    });

    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

describe("resource audit hooks", () => {
  it("loads and normalizes a credential trail", async () => {
    mockApiClient.get.mockResolvedValue([
      { id: "entry-1", action: "CREDENTIAL_VERIFIED" },
    ]);
    const { result } = renderHook(() => useCredentialAudit("credential-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/audit/resource/credential/credential-1?page=1&limit=100",
    );
    expect(result.current.data?.[0].type).toBe("CREDENTIAL_VERIFIED");
  });

  it("loads and normalizes a verification trail", async () => {
    mockApiClient.get.mockResolvedValue([
      { id: "entry-1", action: "VERIFICATION_COMPLETED" },
    ]);
    const { result } = renderHook(
      () => useVerificationAudit("verification-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/api/v1/audit/resource/verification/verification-1?page=1&limit=100",
    );
    expect(result.current.data?.[0].type).toBe("VERIFICATION_COMPLETED");
  });
});

describe("useIdentityActivitySummary", () => {
  it("returns only summary values supplied by the backend", async () => {
    mockApiClient.get.mockResolvedValue({
      totalEvents: 12,
      eventsLast30Days: 4,
      actionBreakdown: [
        { action: "CREDENTIAL_ISSUED", count: 3 },
        { action: "AUTH_LOGIN", count: 1 },
      ],
      lastActivity: {
        action: "AUTH_LOGIN",
        resourceType: "identity",
        timestamp: "invalid-date",
      },
    });
    const { result } = renderHook(() => useIdentityActivitySummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      totalEvents: 12,
      eventsLast30Days: 4,
      actionBreakdown: [
        { action: "CREDENTIAL_ISSUED", count: 3 },
        { action: "AUTH_LOGIN", count: 1 },
      ],
      lastActivity: {
        action: "AUTH_LOGIN",
        resourceType: "identity",
        timestamp: undefined,
      },
    });
    expect(result.current.data).not.toHaveProperty("credentialsIssued");
    expect(result.current.data).not.toHaveProperty("proofsGenerated");
  });

  it("uses null rather than zero when summary counts are unavailable", async () => {
    mockApiClient.get.mockResolvedValue({});
    const { result } = renderHook(() => useIdentityActivitySummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      totalEvents: null,
      eventsLast30Days: null,
      actionBreakdown: [],
      lastActivity: null,
    });
  });
});

describe("exportAuditLog", () => {
  it("uses the real export endpoint and applies unsupported filters to its returned records", async () => {
    mockApiClient.get.mockResolvedValue({
      exportedAt: "2026-07-18T12:00:00.000Z",
      records: [
        {
          id: "keep",
          action: "CREDENTIAL_ISSUED",
          resourceType: "credential",
          resourceId: "credential-1",
        },
        {
          id: "drop",
          action: "AUTH_LOGIN",
          resourceType: "identity",
          resourceId: "identity-1",
        },
      ],
    });

    await exportAuditLog(
      {
        action: "CREDENTIAL_ISSUED",
        entityType: "credential",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-07-18T00:00:00.000Z",
      },
      "json",
    );

    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/audit/export/download?");
    expect(url).toContain("from=2026-07-01T00%3A00%3A00.000Z");
    expect(url).toContain("to=2026-07-18T00%3A00%3A00.000Z");
    expect(url).toContain("format=json");
    expect(String(blobParts?.[0])).toContain('"totalRecords": 1');
    expect(String(blobParts?.[0])).toContain('"id": "keep"');
    expect(String(blobParts?.[0])).not.toContain('"id": "drop"');
    expect(clickDownload).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:zeroid-audit");
    expect(mockToast.success).toHaveBeenCalledWith("Audit log exported");
  });

  it("converts real export records to CSV using backend field names", async () => {
    mockApiClient.get.mockResolvedValue({
      records: [
        {
          id: "audit-1",
          timestamp: "2026-07-18T08:00:00.000Z",
          action: "AUTH_LOGIN",
          identityId: "identity-1",
          resourceType: "identity",
          resourceId: "identity-1",
        },
      ],
    });

    await exportAuditLog({}, "csv");

    expect(blobType).toBe("text/csv");
    expect(String(blobParts?.[0])).toContain(
      "id,timestamp,action,identityId,resourceType,resourceId,ipAddress,details",
    );
    expect(String(blobParts?.[0])).toContain('"AUTH_LOGIN"');
  });

  it("reports endpoint and contract failures without downloading a fallback", async () => {
    mockApiClient.get.mockResolvedValue({ entries: [] });

    await exportAuditLog();

    expect(clickDownload).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith("Export failed", {
      description: "The audit export endpoint returned an invalid response",
    });
  });
});
