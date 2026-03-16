/**
 * useBiometrics — Unit Tests
 *
 * Tests for biometric TEE hooks: camera state, liveness check,
 * capture, verification, enrollment status, and enrollment.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
const mockToast = jest.requireMock('sonner').toast;

jest.mock('@/lib/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock('@/lib/api/client').apiClient;

jest.mock('@/config/constants', () => ({
  TEE_SERVICE_URL: 'https://tee.example.com',
}));

import { useAccount } from 'wagmi';
import {
  useCameraState,
  useStartLivenessCheck,
  useCaptureBiometric,
  useVerifyBiometric,
  useBiometricStatus,
  useEnrollBiometric,
} from '@/hooks/useBiometrics';

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
  (useAccount as jest.Mock).mockReturnValue({ address: mockAddress, isConnected: true });
});

// ===========================================================================
// useCameraState
// ===========================================================================

describe('useCameraState', () => {
  const mockStream = {
    getTracks: jest.fn(() => [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ]),
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('starts with idle state', () => {
    const { result } = renderHook(() => useCameraState());
    expect(result.current.cameraState).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.stream).toBeNull();
  });

  it('transitions to active when camera starts successfully', async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream);
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe('active');
  });

  it('transitions to error state when camera access denied', async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(new Error('Permission denied'));
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe('error');
    expect(result.current.errorMessage).toBe('Permission denied');
    expect(mockToast.error).toHaveBeenCalledWith('Camera access failed', { description: 'Permission denied' });
  });

  it('stopCamera resets to idle', async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream);
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.stopCamera();
    });

    expect(result.current.cameraState).toBe('idle');
  });

  it('pauseCamera disables tracks and sets paused state', async () => {
    const tracks = [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(stream);
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.pauseCamera();
    });

    expect(result.current.cameraState).toBe('paused');
    expect(tracks[0].enabled).toBe(false);
    expect(tracks[1].enabled).toBe(false);
  });

  it('resumeCamera enables tracks and sets active state', async () => {
    const tracks = [
      { enabled: true, stop: jest.fn() },
      { enabled: true, stop: jest.fn() },
    ];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(stream);
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

    expect(result.current.cameraState).toBe('active');
    expect(tracks[0].enabled).toBe(true);
    expect(tracks[1].enabled).toBe(true);
  });

  it('pauseCamera does nothing when no stream', () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.pauseCamera();
    });

    expect(result.current.cameraState).toBe('idle');
  });

  it('resumeCamera does nothing when no stream', () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.resumeCamera();
    });

    expect(result.current.cameraState).toBe('idle');
  });

  it('stopCamera does nothing when no stream', () => {
    const { result } = renderHook(() => useCameraState());

    act(() => {
      result.current.stopCamera();
    });

    expect(result.current.cameraState).toBe('idle');
  });

  it('handles non-Error thrown from getUserMedia', async () => {
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue('string error');
    const { result } = renderHook(() => useCameraState());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.cameraState).toBe('error');
    expect(result.current.errorMessage).toBe('Camera access denied');
  });

  it('cleanup on unmount stops tracks', async () => {
    const tracks = [
      { enabled: true, stop: jest.fn() },
    ];
    const stream = { getTracks: jest.fn(() => tracks) };
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(stream);
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

describe('useStartLivenessCheck', () => {
  const passedResult = {
    passed: true,
    confidence: 0.98,
    challenges: [{ type: 'blink', completed: true, confidenceScore: 0.99 }],
    sessionId: 'session-1',
    attestationHash: '0xabc',
    processedInTEE: true,
  };

  it('shows success toast when liveness passes', async () => {
    mockApiClient.post.mockResolvedValue(passedResult);
    const { result } = renderHook(() => useStartLivenessCheck(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        frameData: 'base64data',
        enclaveHash: '0xenc' as any,
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Liveness check passed', {
      description: 'Confidence: 98.0%',
    });
  });

  it('shows warning toast when liveness fails', async () => {
    mockApiClient.post.mockResolvedValue({ ...passedResult, passed: false });
    const { result } = renderHook(() => useStartLivenessCheck(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        frameData: 'base64data',
        enclaveHash: '0xenc' as any,
      });
    });

    expect(mockToast.warning).toHaveBeenCalledWith('Liveness check failed — please try again');
  });

  it('shows error toast on API error', async () => {
    mockApiClient.post.mockRejectedValue(new Error('TEE unavailable'));
    const { result } = renderHook(() => useStartLivenessCheck(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ frameData: 'x', enclaveHash: '0x' as any });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Liveness check error', { description: 'TEE unavailable' });
  });
});

// ===========================================================================
// useCaptureBiometric
// ===========================================================================

describe('useCaptureBiometric', () => {
  const mockCapture = {
    sessionId: 'session-1',
    modality: 'face',
    templateHash: '0xhash',
    qualityScore: 0.95,
    capturedAt: '2026-01-01T00:00:00Z',
    enclaveHash: '0xenc',
  };

  it('captures biometric and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockCapture);
    const { result } = renderHook(() => useCaptureBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        modality: 'face',
        captureData: 'base64',
        enclaveHash: '0xenc' as any,
        livenessSessionId: 'session-1',
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('face captured', {
      description: 'Quality score: 95%',
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Capture failed'));
    const { result } = renderHook(() => useCaptureBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: 'fingerprint',
          captureData: 'x',
          enclaveHash: '0x' as any,
          livenessSessionId: 's',
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Biometric capture failed', { description: 'Capture failed' });
  });
});

// ===========================================================================
// useVerifyBiometric
// ===========================================================================

describe('useVerifyBiometric', () => {
  it('shows success toast when verified', async () => {
    mockApiClient.post.mockResolvedValue({
      verified: true,
      matchScore: 0.95,
      threshold: 0.8,
      modality: 'face',
      verifiedAt: '2026-01-01T00:00:00Z',
      attestationHash: '0x',
      processedInTEE: true,
      livenessConfirmed: true,
    });
    const { result } = renderHook(() => useVerifyBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        templateHash: '0xhash' as any,
        captureData: 'data',
        enclaveHash: '0xenc' as any,
        livenessSessionId: 's',
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Biometric verified', {
      description: expect.stringContaining('95.0%'),
    });
  });

  it('shows error toast when not verified', async () => {
    mockApiClient.post.mockResolvedValue({
      verified: false,
      matchScore: 0.5,
      threshold: 0.8,
      modality: 'face',
      verifiedAt: '2026-01-01T00:00:00Z',
      attestationHash: '0x',
      processedInTEE: true,
      livenessConfirmed: true,
    });
    const { result } = renderHook(() => useVerifyBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        templateHash: '0x' as any,
        captureData: 'd',
        enclaveHash: '0x' as any,
        livenessSessionId: 's',
      });
    });

    expect(mockToast.error).toHaveBeenCalledWith('Biometric verification failed', {
      description: expect.stringContaining('50.0%'),
    });
  });

  it('shows error toast on API error', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Verify error'));
    const { result } = renderHook(() => useVerifyBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          templateHash: '0x' as any,
          captureData: 'd',
          enclaveHash: '0x' as any,
          livenessSessionId: 's',
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Verification error', { description: 'Verify error' });
  });
});

// ===========================================================================
// useBiometricStatus
// ===========================================================================

describe('useBiometricStatus', () => {
  const mockStatus = {
    enrolled: true,
    modalities: [{ type: 'face', enrolledAt: '2026-01-01T00:00:00Z', qualityScore: 0.95, templateVersion: 1, enclaveHash: '0x' }],
    lastVerifiedAt: '2026-01-01T00:00:00Z',
    enrolledAt: '2026-01-01T00:00:00Z',
    requiresRenewal: false,
  };

  it('fetches biometric status for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockStatus);
    const { result } = renderHook(() => useBiometricStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/tee/biometric/status', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useBiometricStatus(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useEnrollBiometric
// ===========================================================================

describe('useEnrollBiometric', () => {
  const mockEnrolled = {
    type: 'face',
    enrolledAt: '2026-01-01T00:00:00Z',
    qualityScore: 0.92,
    templateVersion: 2,
    enclaveHash: '0xenc',
  };

  it('enrolls biometric and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockEnrolled);
    const { result } = renderHook(() => useEnrollBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        modality: 'face',
        templateHash: '0xhash' as any,
        captureData: 'data',
        enclaveHash: '0xenc' as any,
        livenessSessionId: 's',
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('face enrolled successfully', {
      description: expect.stringContaining('Template v2'),
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Already enrolled'));
    const { result } = renderHook(() => useEnrollBiometric(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          modality: 'face',
          templateHash: '0x' as any,
          captureData: 'd',
          enclaveHash: '0x' as any,
          livenessSessionId: 's',
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Enrollment failed', { description: 'Already enrolled' });
  });
});
