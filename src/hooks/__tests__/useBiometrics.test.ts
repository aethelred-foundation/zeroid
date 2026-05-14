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
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock("@/lib/api/client").apiClient;

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

beforeEach(() => {
  jest.clearAllMocks();
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
  it("fails closed because liveness is not exposed by the backend API", async () => {
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          frameData: "base64data",
          enclaveHash: "0xenc" as any,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Liveness check error", {
      description: "Biometric liveness is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("does not call the stale liveness endpoint", async () => {
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          frameData: "base64data",
          enclaveHash: "0xenc" as any,
        });
      } catch {}
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("uses the mutation error channel for unavailable liveness support", async () => {
    const { result } = renderHook(() => useStartLivenessCheck(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          frameData: "x",
          enclaveHash: "0x" as any,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Liveness check error", {
      description: "Biometric liveness is not exposed by the backend API.",
    });
  });
});

// ===========================================================================
// useCaptureBiometric
// ===========================================================================

describe("useCaptureBiometric", () => {
  it("fails closed because capture is not exposed by the backend API", async () => {
    const { result } = renderHook(() => useCaptureBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "face",
          captureData: "base64",
          enclaveHash: "0xenc" as any,
          livenessSessionId: "session-1",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Biometric capture failed", {
      description: "Biometric capture is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("does not call the stale capture endpoint", async () => {
    const { result } = renderHook(() => useCaptureBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "fingerprint",
          captureData: "x",
          enclaveHash: "0x" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Biometric capture failed", {
      description: "Biometric capture is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// useVerifyBiometric
// ===========================================================================

describe("useVerifyBiometric", () => {
  it("fails closed because verification is not exposed by the backend API", async () => {
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          templateHash: "0xhash" as any,
          captureData: "data",
          enclaveHash: "0xenc" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Verification error", {
      description: "Biometric verification is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("does not call the stale verification endpoint", async () => {
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          templateHash: "0x" as any,
          captureData: "d",
          enclaveHash: "0x" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("uses the mutation error channel for unavailable verification support", async () => {
    const { result } = renderHook(() => useVerifyBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          templateHash: "0x" as any,
          captureData: "d",
          enclaveHash: "0x" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Verification error", {
      description: "Biometric verification is not exposed by the backend API.",
    });
  });
});

// ===========================================================================
// useBiometricStatus
// ===========================================================================

describe("useBiometricStatus", () => {
  it("fails closed because enrollment status is not exposed by the backend API", async () => {
    const { result } = renderHook(() => useBiometricStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("enrollment status");
    expect(mockApiClient.get).not.toHaveBeenCalled();
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
  it("fails closed because enrollment is not exposed by the backend API", async () => {
    const { result } = renderHook(() => useEnrollBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "face",
          templateHash: "0xhash" as any,
          captureData: "data",
          enclaveHash: "0xenc" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Enrollment failed", {
      description: "Biometric enrollment is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });

  it("does not call the stale enrollment endpoint", async () => {
    const { result } = renderHook(() => useEnrollBiometric(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: "face",
          templateHash: "0x" as any,
          captureData: "d",
          enclaveHash: "0x" as any,
          livenessSessionId: "s",
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith("Enrollment failed", {
      description: "Biometric enrollment is not exposed by the backend API.",
    });
    expect(mockApiClient.post).not.toHaveBeenCalled();
  });
});
