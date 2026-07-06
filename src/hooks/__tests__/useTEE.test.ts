/**
 * useTEE — Unit Tests
 *
 * Tests for live-backed TEE node status and attestation verification.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { useTEE } from "@/hooks/useTEE";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    getAttestation: jest.fn(),
    listTEENodes: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

jest.mock("@/lib/tee/attestation", () => ({
  getPlatformLabel: jest.fn((platform: number) =>
    platform === 1 ? "Intel SGX" : "Unknown",
  ),
  selectBestNode: jest.fn((nodes: any[]) =>
    nodes.find((node) => node.isOnline && node.attestation.isValid) ?? null,
  ),
}));

const enclaveHash = `0x${"a".repeat(64)}` as `0x${string}`;

function makeNode(overrides: Record<string, any> = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  return {
    id: "sgx-1",
    operator: "0x0000000000000000000000000000000000000001",
    platform: 1,
    name: "SGX UAE Primary",
    region: "UAE-AbuDhabi",
    isOnline: true,
    uptimePercent: 99.98,
    verificationsProcessed: 500,
    avgLatencyMs: 88,
    attestation: {
      enclaveHash,
      platform: 1,
      attestedAt: expiresAt - 600,
      expiresAt,
      reportDataHash: `0x${"b".repeat(64)}`,
      nodeOperator: "0x0000000000000000000000000000000000000001",
      isValid: true,
      attestationType: "remote",
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const node = makeNode();
  mockApiClient.listTEENodes.mockResolvedValue([node]);
  mockApiClient.getAttestation.mockResolvedValue(node.attestation);
});

describe("useTEE", () => {
  it("loads discovered TEE nodes from the API client", async () => {
    const { result } = renderHook(() => useTEE());

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    expect(result.current.nodes[0]).toMatchObject({
      id: "sgx-1",
      type: "Intel SGX",
      status: "active",
      health: "healthy",
      uptime: 99.98,
      region: "UAE-AbuDhabi",
    });
  });

  it("returns attestation info for the selected live node", async () => {
    const { result } = renderHook(() => useTEE());

    await waitFor(() => expect(result.current.attestation).not.toBeNull());

    expect(result.current.attestation).toMatchObject({
      valid: true,
      enclaveHash,
      status: "verified",
      enclaveId: enclaveHash,
    });
  });

  it("reports healthy enclave status when every discovered node is active", async () => {
    const { result } = renderHook(() => useTEE());

    await waitFor(() => expect(result.current.enclaveStatus).toBe("healthy"));
  });

  it("refreshStatus reloads the discovered fleet", async () => {
    const { result } = renderHook(() => useTEE());
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    mockApiClient.listTEENodes.mockResolvedValueOnce([
      makeNode({ id: "sgx-2", name: "SGX UAE Secondary" }),
    ]);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.nodes[0].id).toBe("sgx-2");
  });

  it("verifyInEnclave checks the selected node attestation", async () => {
    const { result } = renderHook(() => useTEE());
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    let verifyResult:
      | { verified: boolean; attestation: string; payloadHash: string }
      | undefined;

    await act(async () => {
      verifyResult = await result.current.verifyInEnclave({ data: "test" });
    });

    expect(mockApiClient.getAttestation).toHaveBeenCalledWith(enclaveHash);
    expect(verifyResult).toMatchObject({
      verified: true,
      attestation: enclaveHash,
    });
    expect(verifyResult?.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("surfaces API errors instead of using seeded fallback nodes", async () => {
    mockApiClient.listTEENodes.mockRejectedValueOnce(new Error("TEE offline"));

    const { result } = renderHook(() => useTEE());

    await waitFor(() => expect(result.current.error).toBe("TEE offline"));
    expect(result.current.nodes).toEqual([]);
    expect(result.current.enclaveStatus).toBe("offline");
  });
});
