/**
 * useBiometrics — Unit Tests
 *
 * Tests for biometric TEE hooks: camera state, liveness check,
 * capture, verification, enrollment status, and enrollment.
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
  apiClient: {
    get: jest.fn(),
    enrollBiometric: jest.fn(),
    listTEENodes: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    requestBiometricVerification: jest.fn(),
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

jest.mock("@/config/constants", () => ({
  TEE_SERVICE_URL: "https://tee.example.com",
}));

import { useAccount } from "wagmi";
import {
  useCameraState,
  useStartLivenessCheck,
  useCaptureBiometric,
  useVerifyBiometric,
  useBiometricStatus,
  useEnrollBiometric,
} from "@/hooks/useBiometrics";

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

const enclaveHash =
  `0x${"a".repeat(64)}` as `0x${string}`;
const templateHash =
  `0x${"b".repeat(64)}` as `0x${string}`;
const subjectDidHash =
  `0x${"c".repeat(64)}` as `0x${string}`;
const encryptedCapture = "encrypted-biometric-envelope-v1".repeat(3);

function makeNode() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  return {
    id: "tee-1",
    operator: "0x0000000000000000000000000000000000000001",
    platform: 1,
    name: "Primary TEE",
    region: "UAE-AbuDhabi",
    isOnline: true,
    uptimePercent: 99.98,
    verificationsProcessed: 100,
    avgLatencyMs: 80,
    attestation: {
      enclaveHash,
      platform: 1,
      attestedAt: expiresAt - 600,
      expiresAt,
      reportDataHash: `0x${"d".repeat(64)}`,
      nodeOperator: "0x0000000000000000000000000000000000000001",
      isValid: true,
      attestationType: "remote",
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdentityAuthToken.mockReturnValue("identity-token");
  mockApiClient.listTEENodes.mockResolvedValue([makeNode()]);
  mockApiClient.requestBiometricVerification.mockResolvedValue({
    success: true,
    verificationId: "bio-1",
    status: "verified",
    biometricHash: templateHash,
    enclaveHash,
  });
  mockApiClient.enrollBiometric.mockResolvedValue({
    success: true,
    verificationId: "enroll-1",
    status: "verified",
    biometricHash: templateHash,
    enclaveHash,
  });
  (useAccount as jest.Mock).mockReturnValue({
    address: mockAddress,
    isConnected: true,
  });
});

// ===========================================================================
// useCameraState
// ===========================================================================

describe("useCameraState", () => {
  const mockStream = {
    getTracks: jest.fn(() => [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ]),
  };

  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: jest.fn() },
      writable: true,
      configurable: true,
    });
  });

  it("starts with idle state", () => {
    const { result } = renderHook(() => useCameraState());
    expect(result.current.cameraState).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.stream).toBeNull();
  });

  it("transitions to active when camera starts successfully", async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(
      mockStream,
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe("active");
  });

  it("transitions to error state when camera access denied", async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(
      new Error("Permission denied"),
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe("error");
    expect(result.current.errorMessage).toBe("Permission denied");
    expect(mockToast.error).toHaveBeenCalledWith("Camera access failed", {
      description: "Permission denied",
    });
  });

  it("stopCamera resets to idle", async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(
      mockStream,
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.stopCamera();
    });

    expect(result.current.cameraState).toBe("idle");
  });

  it("pauseCamera disables tracks and sets paused state", async () => {
    const tracks = [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(
      stream,
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.pauseCamera();
    });

    expect(result.current.cameraState).toBe("paused");
    expect(tracks[0].enabled).toBe(false);
    expect(tracks[1].enabled).toBe(false);
  });

  it("resumeCamera enables tracks and sets active state", async () => {
    const tracks = [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(
      stream,
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.pauseCamera();
    });

    act(() => {
      result.current.resumeCamera();
    });

    expect(result.current.cameraState).toBe("active");
    expect(tracks[0].enabled).toBe(true);
    expect(tracks[1].enabled).toBe(true);
  });

  it("pauseCamera does nothing when no stream", () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.pauseCamera();
    });

    expect(result.current.cameraState).toBe("idle");
  });

  it("resumeCamera does nothing when no stream", () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.resumeCamera();
    });

    expect(result.current.cameraState).toBe("idle");
  });

  it("stopCamera does nothing when no stream", () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.stopCamera();
    });

    expect(result.current.cameraState).toBe("idle");
  });

  it("handles non-Error thrown from getUserMedia", async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(
      "string error",
    );
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe("error");
    expect(result.current.errorMessage).toBe("Camera access denied");
  });

  it("cleanup on unmount stops tracks", async () => {
    const tracks = [{ enabled: true, stop: jest.fn() }];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(
      stream,
    );
    const { result, unmount } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    unmount();
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});

// ===========================================================================
// useStartLivenessCheck
// ===========================================================================

describe("useStartLivenessCheck", () => {
  it("submits encrypted liveness evidence to the TEE service", async () => {
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    let livenessResult: any;
    await act(async () => {
      livenessResult = await result.current.mutateAsync({
        frameData: encryptedCapture,
        enclaveHash,
        subjectDidHash,
      });
    });

    expect(livenessResult).toMatchObject({
      passed: true,
      confidence: 1,
      sessionId: "bio-1",
      attestationHash: enclaveHash,
      processedInTEE: true,
    });
    expect(mockApiClient.requestBiometricVerification).toHaveBeenCalledWith(
      {
        subjectDidHash,
        enclaveHash,
        biometricData: encryptedCapture,
        biometricType: "face_liveness",
      },
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith("Liveness check passed", {
      description: "Confidence: 100.0%",
    });
  });

  it("resolves an attested TEE node when enclaveHash is not supplied", async () => {
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        frameData: encryptedCapture,
        subjectDidHash,
      });
    });

    expect(mockApiClient.listTEENodes).toHaveBeenCalled();
    expect(mockApiClient.requestBiometricVerification).toHaveBeenCalledWith(
      expect.objectContaining({ enclaveHash }),
      "identity-token",
    );
  });

  it("fails closed when no identity auth token is available", async () => {
    mockGetIdentityAuthToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          frameData: encryptedCapture,
          enclaveHash,
          subjectDidHash,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Liveness check error", {
      description:
        "An authenticated ZeroID identity session is required for biometric TEE operations.",
    });
    expect(mockApiClient.requestBiometricVerification).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useCaptureBiometric
// ===========================================================================

describe("useCaptureBiometric", () => {
  it("captures biometric templates through the TEE service", async () => {
    const { result } = renderHook(() => useCaptureBiometric(), {
      wrapper: createWrapper(),
    });

    let capture: any;
    await act(async () => {
      capture = await result.current.mutateAsync({
        modality: "face",
        captureData: encryptedCapture,
        enclaveHash,
        livenessSessionId: "session-1",
        subjectDidHash,
      });
    });

    expect(capture).toMatchObject({
      sessionId: "bio-1",
      modality: "face",
      templateHash,
      qualityScore: 1,
      enclaveHash,
    });
    expect(mockApiClient.requestBiometricVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        biometricData: encryptedCapture,
        biometricType: "face",
      }),
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith("face captured", {
      description: "Quality score: 100%",
    });
  });

  it("fails closed when the TEE does not return a biometric hash", async () => {
    mockApiClient.requestBiometricVerification.mockResolvedValue({
      success: true,
      verificationId: "bio-1",
      status: "verified",
      enclaveHash,
    });
    const { result } = renderHook(() => useCaptureBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "face",
          captureData: encryptedCapture,
          enclaveHash,
          livenessSessionId: "session-1",
          subjectDidHash,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Biometric capture failed", {
      description: "Biometric capture did not return a TEE biometric hash.",
    });
  });
});

// ===========================================================================
// useVerifyBiometric
// ===========================================================================

describe("useVerifyBiometric", () => {
  it("verifies biometric captures through the TEE service", async () => {
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    let verification: any;
    await act(async () => {
      verification = await result.current.mutateAsync({
        templateHash,
        captureData: encryptedCapture,
        enclaveHash,
        livenessSessionId: "session-1",
        subjectDidHash,
      });
    });

    expect(verification).toMatchObject({
      verified: true,
      matchScore: 1,
      threshold: 1,
      modality: "face",
      attestationHash: enclaveHash,
      processedInTEE: true,
      livenessConfirmed: true,
    });
    expect(mockApiClient.requestBiometricVerification).toHaveBeenCalledWith(
      expect.objectContaining({ biometricType: "face_verification" }),
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith("Biometric verified", {
      description: "Match score: 100.0% (threshold: 100%)",
    });
  });

  it("returns a failed verification result when the TEE rejects the match", async () => {
    mockApiClient.requestBiometricVerification.mockResolvedValue({
      success: false,
      verificationId: "bio-2",
      status: "failed",
      enclaveHash,
      error: "below threshold",
    });
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    let verification: any;
    await act(async () => {
      verification = await result.current.mutateAsync({
        templateHash,
        captureData: encryptedCapture,
        enclaveHash,
        livenessSessionId: "session-1",
        subjectDidHash,
      });
    });

    expect(verification.verified).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Biometric verification failed",
      {
        description: "Match score 0.0% below threshold 100%",
      },
    );
  });

  it("uses the mutation error channel for malformed capture envelopes", async () => {
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          templateHash,
          captureData: "short",
          enclaveHash,
          livenessSessionId: "session-1",
          subjectDidHash,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Verification error", {
      description: "Verification requires an encrypted capture envelope.",
    });
  });
});

// ===========================================================================
// useBiometricStatus
// ===========================================================================

describe("useBiometricStatus", () => {
  it("returns a real empty enrollment status after checking TEE availability", async () => {
    const { result } = renderHook(() => useBiometricStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.listTEENodes).toHaveBeenCalled();
    expect(result.current.data).toEqual({
      enrolled: false,
      modalities: [],
      requiresRenewal: false,
    });
  });

  it("is disabled when no address", () => {
    (useAccount as jest.Mock).mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    const { result } = renderHook(() => useBiometricStatus(), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ===========================================================================
// useEnrollBiometric
// ===========================================================================

describe("useEnrollBiometric", () => {
  it("enrolls a biometric template through the TEE enrollment API", async () => {
    const { result } = renderHook(() => useEnrollBiometric(), {
      wrapper: createWrapper(),
    });

    let enrollment: any;
    await act(async () => {
      enrollment = await result.current.mutateAsync({
        modality: "face",
        templateHash,
        captureData: encryptedCapture,
        enclaveHash,
        livenessSessionId: "session-1",
        subjectDidHash,
      });
    });

    expect(enrollment).toMatchObject({
      type: "face",
      qualityScore: 1,
      templateVersion: 1,
      enclaveHash: templateHash,
    });
    expect(mockApiClient.enrollBiometric).toHaveBeenCalledWith(
      {
        subjectDidHash,
        enclaveHash,
        biometricData: encryptedCapture,
        biometricType: "face",
      },
      "identity-token",
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "face enrolled successfully",
      {
        description: "Template v1, quality 100%",
      },
    );
  });

  it("fails closed when enrollment is rejected by the TEE", async () => {
    mockApiClient.enrollBiometric.mockResolvedValue({
      success: false,
      verificationId: "enroll-2",
      status: "failed",
      enclaveHash,
      error: "template already enrolled",
    });
    const { result } = renderHook(() => useEnrollBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "face",
          templateHash,
          captureData: encryptedCapture,
          enclaveHash,
          livenessSessionId: "session-1",
          subjectDidHash,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Enrollment failed", {
      description: "template already enrolled",
    });
  });
});
