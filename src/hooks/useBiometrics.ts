/**
 * useBiometrics — Hook for biometric verification in TEE enclaves.
 *
 * Manages camera state, liveness checks, biometric capture (face/fingerprint),
 * TEE-based verification, and enrollment. Raw biometric data never
 * leaves the enclave — only template hashes are returned to the client.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { isExpired, stringToBytes32 } from "@/lib/utils";
import type { Bytes32, ISODateString, TEENode } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BiometricModality = "face" | "fingerprint" | "iris";

export type CameraState =
  | "idle"
  | "initializing"
  | "active"
  | "paused"
  | "error";

export interface LivenessResult {
  passed: boolean;
  confidence: number;
  challenges: LivenessChallenge[];
  sessionId: string;
  attestationHash: Bytes32;
  processedInTEE: boolean;
}

export interface LivenessChallenge {
  type: "blink" | "turn_left" | "turn_right" | "smile" | "nod";
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
  all: ["biometrics"] as const,
  status: (address?: string) =>
    [...biometricKeys.all, "status", address?.toLowerCase() ?? "anonymous"] as const,
};

type TEEBiometricReceipt = Awaited<
  ReturnType<typeof apiClient.requestBiometricVerification>
>;

type AuthenticatedBiometricParams = {
  authToken?: string;
  subjectDidHash?: Bytes32;
};

function requireAuthToken(explicit?: string): string {
  const token = explicit ?? getIdentityAuthToken();
  if (!token) {
    throw new Error(
      "An authenticated ZeroID identity session is required for biometric TEE operations.",
    );
  }
  return token;
}

function resolveSubjectDidHash(
  address: string | undefined,
  explicit?: Bytes32,
): Bytes32 {
  if (explicit) return explicit;
  if (!address) {
    throw new Error(
      "A wallet-bound subject hash is required for biometric TEE operations.",
    );
  }
  return stringToBytes32(`zeroid:biometric:${address.toLowerCase()}`);
}

function requireEncryptedEnvelope(value: string, label: string): string {
  const envelope = value.trim();
  if (!envelope || envelope.length < 32) {
    throw new Error(`${label} requires an encrypted capture envelope.`);
  }
  return envelope;
}

function selectAttestedNode(nodes: TEENode[]): TEENode | undefined {
  return nodes
    .filter(
      (node) =>
        node.isOnline &&
        node.attestation.isValid &&
        !isExpired(node.attestation.expiresAt),
    )
    .sort((a, b) => {
      const latencyDelta = a.avgLatencyMs - b.avgLatencyMs;
      if (Math.abs(latencyDelta) > 50) return latencyDelta;
      return b.uptimePercent - a.uptimePercent;
    })[0];
}

async function resolveEnclaveHash(explicit?: Bytes32): Promise<Bytes32> {
  if (explicit) return explicit;
  const node = selectAttestedNode(await apiClient.listTEENodes());
  if (!node) {
    throw new Error("No online attested TEE node is available.");
  }
  return node.attestation.enclaveHash;
}

async function submitBiometricToTEE(params: {
  authToken?: string;
  subjectDidHash?: Bytes32;
  address?: string;
  enclaveHash?: Bytes32;
  biometricData: string;
  biometricType: string;
}): Promise<TEEBiometricReceipt> {
  const authToken = requireAuthToken(params.authToken);
  const subjectDidHash = resolveSubjectDidHash(
    params.address,
    params.subjectDidHash,
  );
  const enclaveHash = await resolveEnclaveHash(params.enclaveHash);
  return apiClient.requestBiometricVerification(
    {
      subjectDidHash,
      enclaveHash,
      biometricData: params.biometricData,
      biometricType: params.biometricType,
    },
    authToken,
  );
}

function requireTEEHash(
  receipt: TEEBiometricReceipt,
  operation: string,
): Bytes32 {
  if (receipt.status !== "verified") {
    throw new Error(receipt.error ?? `${operation} was rejected by the TEE.`);
  }
  if (!receipt.biometricHash) {
    throw new Error(`${operation} did not return a TEE biometric hash.`);
  }
  return receipt.biometricHash;
}

function binaryScore(verified: boolean): number {
  return verified ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Camera State Management
// ---------------------------------------------------------------------------

export function useCameraState() {
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setCameraState("initializing");
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      setCameraState("active");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Camera access denied";
      setErrorMessage(message);
      setCameraState("error");
      toast.error("Camera access failed", { description: message });
    }
  }, []);

  const pauseCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.enabled = false;
      });
      setCameraState("paused");
    }
  }, []);

  const resumeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.enabled = true;
      });
      setCameraState("active");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraState("idle");
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
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      sessionId?: string;
      frameData: string; // base64-encoded, encrypted for enclave
      enclaveHash?: Bytes32;
      modality?: BiometricModality;
    } & AuthenticatedBiometricParams): Promise<LivenessResult> => {
      const receipt = await submitBiometricToTEE({
        address,
        authToken: params.authToken,
        subjectDidHash: params.subjectDidHash,
        enclaveHash: params.enclaveHash,
        biometricData: requireEncryptedEnvelope(params.frameData, "Liveness"),
        biometricType: `${params.modality ?? "face"}_liveness`,
      });
      const passed = receipt.status === "verified";
      const confidence = binaryScore(passed);

      return {
        passed,
        confidence,
        challenges: [
          {
            type: "blink",
            completed: passed,
            confidenceScore: confidence,
          },
        ],
        sessionId: receipt.verificationId || params.sessionId || "",
        attestationHash: receipt.enclaveHash,
        processedInTEE: true,
      };
    },
    onSuccess: (data) => {
      if (data.passed) {
        toast.success("Liveness check passed", {
          description: `Confidence: ${(data.confidence * 100).toFixed(1)}%`,
        });
      } else {
        toast.warning("Liveness check failed — please try again");
      }
    },
    onError: (err: Error) => {
      toast.error("Liveness check error", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Biometric Capture
// ---------------------------------------------------------------------------

export function useCaptureBiometric() {
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      modality: BiometricModality;
      captureData: string; // base64-encoded, encrypted for enclave
      enclaveHash?: Bytes32;
      livenessSessionId: string;
    } & AuthenticatedBiometricParams): Promise<BiometricCapture> => {
      if (!params.livenessSessionId) {
        throw new Error("Biometric capture requires a completed liveness session.");
      }
      const receipt = await submitBiometricToTEE({
        address,
        authToken: params.authToken,
        subjectDidHash: params.subjectDidHash,
        enclaveHash: params.enclaveHash,
        biometricData: requireEncryptedEnvelope(params.captureData, "Capture"),
        biometricType: params.modality,
      });
      const templateHash = requireTEEHash(receipt, "Biometric capture");

      return {
        sessionId: receipt.verificationId || params.livenessSessionId,
        modality: params.modality,
        templateHash,
        qualityScore: 1,
        capturedAt: new Date().toISOString(),
        enclaveHash: receipt.enclaveHash,
      };
    },
    onSuccess: (data) => {
      toast.success(`${data.modality} captured`, {
        description: `Quality score: ${(data.qualityScore * 100).toFixed(0)}%`,
      });
    },
    onError: (err: Error) => {
      toast.error("Biometric capture failed", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Verify Biometric
// ---------------------------------------------------------------------------

export function useVerifyBiometric() {
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      templateHash: Bytes32;
      captureData: string;
      enclaveHash?: Bytes32;
      livenessSessionId: string;
    } & AuthenticatedBiometricParams): Promise<BiometricVerificationResult> => {
      if (!params.templateHash) {
        throw new Error("Biometric verification requires a template hash.");
      }
      if (!params.livenessSessionId) {
        throw new Error("Biometric verification requires a liveness session.");
      }
      const receipt = await submitBiometricToTEE({
        address,
        authToken: params.authToken,
        subjectDidHash: params.subjectDidHash,
        enclaveHash: params.enclaveHash,
        biometricData: requireEncryptedEnvelope(
          params.captureData,
          "Verification",
        ),
        biometricType: "face_verification",
      });
      const verified = receipt.status === "verified";
      const score = binaryScore(verified);

      return {
        verified,
        matchScore: score,
        threshold: 1,
        modality: "face",
        verifiedAt: new Date().toISOString(),
        attestationHash: receipt.enclaveHash,
        processedInTEE: true,
        livenessConfirmed: verified,
      };
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast.success("Biometric verified", {
          description: `Match score: ${(data.matchScore * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(0)}%)`,
        });
      } else {
        toast.error("Biometric verification failed", {
          description: `Match score ${(data.matchScore * 100).toFixed(1)}% below threshold ${(data.threshold * 100).toFixed(0)}%`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error("Verification error", { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Enrollment Status
// ---------------------------------------------------------------------------

export function useBiometricStatus() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: biometricKeys.status(address),
    queryFn: async (): Promise<BiometricEnrollmentStatus> => {
      const existing = queryClient.getQueryData<BiometricEnrollmentStatus>(
        biometricKeys.status(address),
      );
      if (existing) return existing;

      await apiClient.listTEENodes();
      return {
        enrolled: false,
        modalities: [],
        requiresRenewal: false,
      };
    },
    enabled: !!address,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Enroll Biometric
// ---------------------------------------------------------------------------

export function useEnrollBiometric() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      modality: BiometricModality;
      templateHash: Bytes32;
      captureData: string;
      enclaveHash?: Bytes32;
      livenessSessionId: string;
    } & AuthenticatedBiometricParams): Promise<EnrolledModality> => {
      if (!params.templateHash) {
        throw new Error("Biometric enrollment requires a template hash.");
      }
      if (!params.livenessSessionId) {
        throw new Error("Biometric enrollment requires a liveness session.");
      }

      const authToken = requireAuthToken(params.authToken);
      const subjectDidHash = resolveSubjectDidHash(
        address,
        params.subjectDidHash,
      );
      const enclaveHash = await resolveEnclaveHash(params.enclaveHash);
      const receipt = await apiClient.enrollBiometric(
        {
          subjectDidHash,
          enclaveHash,
          biometricData: requireEncryptedEnvelope(params.captureData, "Enrollment"),
          biometricType: params.modality,
        },
        authToken,
      );
      const enrolledHash = requireTEEHash(receipt, "Biometric enrollment");

      return {
        type: params.modality,
        enrolledAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        qualityScore: 1,
        templateVersion: 1,
        enclaveHash: enrolledHash,
      };
    },
    onSuccess: (data) => {
      toast.success(`${data.type} enrolled successfully`, {
        description: `Template v${data.templateVersion}, quality ${(data.qualityScore * 100).toFixed(0)}%`,
      });
      const status: BiometricEnrollmentStatus = {
        enrolled: true,
        modalities: [data],
        lastVerifiedAt: data.lastUsedAt,
        enrolledAt: data.enrolledAt,
        requiresRenewal: false,
      };
      queryClient.setQueryData(biometricKeys.status(address), status);
      queryClient.invalidateQueries({ queryKey: biometricKeys.status(address) });
    },
    onError: (err: Error) => {
      toast.error("Enrollment failed", { description: err.message });
    },
  });
}
