/**
 * useBiometrics — Hook for biometric verification in TEE enclaves.
 *
 * Manages camera state, liveness checks, biometric capture (face/fingerprint),
 * TEE-based verification, and enrollment. Raw biometric data never
 * leaves the enclave — only template hashes are returned to the client.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { TEE_SERVICE_URL } from '@/config/constants';
import type { Bytes32, ISODateString } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BiometricModality = 'face' | 'fingerprint' | 'iris';

export type CameraState = 'idle' | 'initializing' | 'active' | 'paused' | 'error';

export interface LivenessResult {
  passed: boolean;
  confidence: number;
  challenges: LivenessChallenge[];
  sessionId: string;
  attestationHash: Bytes32;
  processedInTEE: boolean;
}

export interface LivenessChallenge {
  type: 'blink' | 'turn_left' | 'turn_right' | 'smile' | 'nod';
  completed: boolean;
  confidenceScore: number;
}

export interface BiometricCapture {
  sessionId: string;
  modality: BiometricModality;
  templateHash: Bytes32;
  qualityScore: number;
  capturedAt: ISODateString;
  enclaveHash: Bytes32;
}

export interface BiometricVerificationResult {
  verified: boolean;
  matchScore: number;
  threshold: number;
  modality: BiometricModality;
  verifiedAt: ISODateString;
  attestationHash: Bytes32;
  processedInTEE: boolean;
  livenessConfirmed: boolean;
}

export interface BiometricEnrollmentStatus {
  enrolled: boolean;
  modalities: EnrolledModality[];
  lastVerifiedAt?: ISODateString;
  enrolledAt?: ISODateString;
  requiresRenewal: boolean;
  renewalDeadline?: ISODateString;
}

export interface EnrolledModality {
  type: BiometricModality;
  enrolledAt: ISODateString;
  lastUsedAt?: ISODateString;
  qualityScore: number;
  templateVersion: number;
  enclaveHash: Bytes32;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const biometricKeys = {
  all: ['biometrics'] as const,
  status: () => [...biometricKeys.all, 'status'] as const,
};

// ---------------------------------------------------------------------------
// Camera State Management
// ---------------------------------------------------------------------------

export function useCameraState() {
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setCameraState('initializing');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });
      streamRef.current = stream;
      setCameraState('active');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera access denied';
      setErrorMessage(message);
      setCameraState('error');
      toast.error('Camera access failed', { description: message });
    }
  }, []);

  const pauseCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.enabled = false;
      });
      setCameraState('paused');
    }
  }, []);

  const resumeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.enabled = true;
      });
      setCameraState('active');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraState('idle');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    cameraState,
    errorMessage,
    stream: streamRef.current,
    startCamera,
    pauseCamera,
    resumeCamera,
    stopCamera,
  };
}

// ---------------------------------------------------------------------------
// Liveness Check
// ---------------------------------------------------------------------------

export function useStartLivenessCheck() {
  return useMutation({
    mutationFn: async (params: {
      sessionId?: string;
      frameData: string; // base64-encoded, encrypted for enclave
      enclaveHash: Bytes32;
    }): Promise<LivenessResult> => {
      return apiClient.post<LivenessResult>(
        '/api/v1/tee/biometric/liveness',
        {
          frameData: params.frameData,
          enclaveHash: params.enclaveHash,
          sessionId: params.sessionId,
        },
      ) as unknown as LivenessResult;
    },
    onSuccess: (data) => {
      if (data.passed) {
        toast.success('Liveness check passed', {
          description: `Confidence: ${(data.confidence * 100).toFixed(1)}%`,
        });
      } else {
        toast.warning('Liveness check failed — please try again');
      }
    },
    onError: (err: Error) => {
      toast.error('Liveness check error', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Biometric Capture
// ---------------------------------------------------------------------------

export function useCaptureBiometric() {
  return useMutation({
    mutationFn: async (params: {
      modality: BiometricModality;
      captureData: string; // base64-encoded, encrypted for enclave
      enclaveHash: Bytes32;
      livenessSessionId: string;
    }): Promise<BiometricCapture> => {
      return apiClient.post<BiometricCapture>(
        '/api/v1/tee/biometric/capture',
        params,
      ) as unknown as BiometricCapture;
    },
    onSuccess: (data) => {
      toast.success(`${data.modality} captured`, {
        description: `Quality score: ${(data.qualityScore * 100).toFixed(0)}%`,
      });
    },
    onError: (err: Error) => {
      toast.error('Biometric capture failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Verify Biometric
// ---------------------------------------------------------------------------

export function useVerifyBiometric() {
  return useMutation({
    mutationFn: async (params: {
      templateHash: Bytes32;
      captureData: string;
      enclaveHash: Bytes32;
      livenessSessionId: string;
    }): Promise<BiometricVerificationResult> => {
      return apiClient.post<BiometricVerificationResult>(
        '/api/v1/tee/biometric/verify',
        params,
      ) as unknown as BiometricVerificationResult;
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success('Biometric verified', {
          description: `Match score: ${(data.matchScore * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(0)}%)`,
        });
      } else {
        toast.error('Biometric verification failed', {
          description: `Match score ${(data.matchScore * 100).toFixed(1)}% below threshold ${(data.threshold * 100).toFixed(0)}%`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error('Verification error', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Enrollment Status
// ---------------------------------------------------------------------------

export function useBiometricStatus() {
  const { address } = useAccount();

  return useQuery({
    queryKey: biometricKeys.status(),
    queryFn: () =>
      apiClient.get<BiometricEnrollmentStatus>(
        '/api/v1/tee/biometric/status',
        { owner: address as string },
      ) as unknown as BiometricEnrollmentStatus,
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Enroll Biometric
// ---------------------------------------------------------------------------

export function useEnrollBiometric() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      modality: BiometricModality;
      templateHash: Bytes32;
      captureData: string;
      enclaveHash: Bytes32;
      livenessSessionId: string;
    }): Promise<EnrolledModality> => {
      return apiClient.post<EnrolledModality>(
        '/api/v1/tee/biometric/enroll',
        params,
      ) as unknown as EnrolledModality;
    },
    onSuccess: (data) => {
      toast.success(`${data.type} enrolled successfully`, {
        description: `Template v${data.templateVersion}, quality ${(data.qualityScore * 100).toFixed(0)}%`,
      });
      queryClient.invalidateQueries({ queryKey: biometricKeys.status() });
    },
    onError: (err: Error) => {
      toast.error('Enrollment failed', { description: err.message });
    },
  });
}
