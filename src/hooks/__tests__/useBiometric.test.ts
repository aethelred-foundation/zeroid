import { act, renderHook, waitFor } from "@testing-library/react";

import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { useBiometric } from "@/hooks/useBiometric";

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  })),
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    listTEENodes: jest.fn(),
    requestBiometricVerification: jest.fn(),
  },
}));

const encryptedCaptureEnvelope = Buffer.from(
  JSON.stringify({
    alg: "TEE-X25519-AES-GCM",
    kid: "tee-node-1",
    nonce: "nonce-123",
    ciphertext: "ciphertext".repeat(12),
  }),
).toString("base64");

const attestedNode = {
  id: "tee-node-1",
  operator: "0x0000000000000000000000000000000000000001",
  name: "Abu Dhabi SGX 01",
  region: "AE-AZ1",
  isOnline: true,
  uptimePercent: 99.99,
  verificationsProcessed: 4812,
  avgLatencyMs: 41,
  platform: 1,
  attestation: {
    enclaveHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    platform: 1,
    attestedAt: 1_700_000_000,
    expiresAt: 1_900_000_000,
    reportDataHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nodeOperator: "0x0000000000000000000000000000000000000001",
    isValid: true,
    attestationType: "remote",
  },
};

describe("useBiometric", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getIdentityAuthToken as jest.Mock).mockReturnValue("identity-token");
    (apiClient.listTEENodes as jest.Mock).mockResolvedValue([attestedNode]);
    (apiClient.requestBiometricVerification as jest.Mock).mockResolvedValue({
      verificationId: "bio-verification-1",
      status: "verified",
    });
  });

  it("starts with idle status and isScanned=false", () => {
    const { result } = renderHook(() => useBiometric());

    expect(result.current.scanStatus).toBe("idle");
    expect(result.current.isScanned).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("requires an authenticated identity session", async () => {
    (getIdentityAuthToken as jest.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() => useBiometric());

    await act(async () => {
      await expect(
        result.current.startScan({
          encryptedBiometricData: encryptedCaptureEnvelope,
        }),
      ).rejects.toThrow(/authenticated ZeroID identity session/);
    });

    expect(result.current.scanStatus).toBe("failed");
    expect(result.current.isScanned).toBe(false);
    expect(apiClient.listTEENodes).not.toHaveBeenCalled();
  });

  it("requires an encrypted biometric capture envelope", async () => {
    const { result } = renderHook(() => useBiometric());

    await act(async () => {
      await expect(result.current.startScan()).rejects.toThrow(
        /encrypted biometric capture envelope/,
      );
    });

    expect(result.current.scanStatus).toBe("failed");
    expect(apiClient.listTEENodes).not.toHaveBeenCalled();
  });

  it("requests verification from an attested online TEE node", async () => {
    const { result } = renderHook(() => useBiometric());

    await act(async () => {
      await result.current.startScan({
        encryptedBiometricData: encryptedCaptureEnvelope,
      });
    });

    await waitFor(() => {
      expect(result.current.scanStatus).toBe("success");
      expect(result.current.isScanned).toBe(true);
    });

    expect(apiClient.requestBiometricVerification).toHaveBeenCalledWith(
      {
        subjectDidHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        enclaveHash: attestedNode.attestation.enclaveHash,
        biometricData: encryptedCaptureEnvelope,
      },
      "identity-token",
    );
    expect(result.current.verification).toEqual({
      verificationId: "bio-verification-1",
      status: "verified",
      enclaveHash: attestedNode.attestation.enclaveHash,
    });
  });

  it("fails closed when no attested TEE node is available", async () => {
    (apiClient.listTEENodes as jest.Mock).mockResolvedValue([
      { ...attestedNode, isOnline: false },
      {
        ...attestedNode,
        id: "tee-node-2",
        isOnline: true,
        attestation: { ...attestedNode.attestation, isValid: false },
      },
    ]);
    const { result } = renderHook(() => useBiometric());

    await act(async () => {
      await expect(
        result.current.startScan({
          encryptedBiometricData: encryptedCaptureEnvelope,
        }),
      ).rejects.toThrow(/No online attested TEE node/);
    });

    expect(result.current.scanStatus).toBe("failed");
    expect(apiClient.requestBiometricVerification).not.toHaveBeenCalled();
  });

  it("startScan is stable across renders for the same wallet", () => {
    const { result, rerender } = renderHook(() => useBiometric());
    const firstStartScan = result.current.startScan;

    rerender();

    expect(result.current.startScan).toBe(firstStartScan);
  });
});
