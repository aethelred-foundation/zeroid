import { useState, useCallback } from "react";
import { useAccount } from "wagmi";

import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { stringToBytes32 } from "@/lib/utils";
import type { Bytes32, TEENode } from "@/types";

type ScanStatus = "idle" | "scanning" | "success" | "complete" | "failed";

interface StartScanOptions {
  authToken?: string;
  subjectDidHash?: Bytes32;
  enclaveHash?: Bytes32;
  encryptedBiometricData?: string;
  biometricData?: string;
}

interface BiometricScanResult {
  verificationId: string;
  status: string;
  enclaveHash: Bytes32;
}

function selectAttestedBiometricNode(nodes: TEENode[]): TEENode | undefined {
  return nodes
    .filter((node) => node.isOnline && node.attestation.isValid)
    .sort((a, b) => {
      const latencyDelta = a.avgLatencyMs - b.avgLatencyMs;
      if (Math.abs(latencyDelta) > 50) {
        return latencyDelta;
      }
      return b.uptimePercent - a.uptimePercent;
    })[0];
}

function readEncryptedCaptureEnvelope(options: StartScanOptions): string {
  const envelope =
    options.encryptedBiometricData?.trim() ?? options.biometricData?.trim();

  if (!envelope || envelope.length < 64) {
    throw new Error(
      "An encrypted biometric capture envelope is required before TEE verification can start.",
    );
  }

  return envelope;
}

export function useBiometric() {
  const { address } = useAccount();
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [verification, setVerification] = useState<BiometricScanResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const startScan = useCallback(async (options: StartScanOptions = {}) => {
    setScanStatus("scanning");
    setError(null);
    setVerification(null);

    try {
      const authToken = options.authToken ?? getIdentityAuthToken();
      if (!authToken) {
        throw new Error(
          "An authenticated ZeroID identity session is required before biometric verification can start.",
        );
      }

      const subjectDidHash =
        options.subjectDidHash ??
        (address
          ? stringToBytes32(`zeroid:pre-registration-biometric:${address}`)
          : undefined);
      if (!subjectDidHash) {
        throw new Error(
          "A wallet-bound subject hash is required before biometric verification can start.",
        );
      }

      const encryptedBiometricData = readEncryptedCaptureEnvelope(options);

      let enclaveHash = options.enclaveHash;
      if (!enclaveHash) {
        const node = selectAttestedBiometricNode(await apiClient.listTEENodes());
        if (!node) {
          throw new Error(
            "No online attested TEE node is available for biometric verification.",
          );
        }
        enclaveHash = node.attestation.enclaveHash;
      }

      const result = await apiClient.requestBiometricVerification(
        {
          subjectDidHash,
          enclaveHash,
          biometricData: encryptedBiometricData,
        },
        authToken,
      );

      const scanResult: BiometricScanResult = {
        verificationId: result.verificationId,
        status: result.status,
        enclaveHash,
      };

      setVerification(scanResult);
      if (result.status === "verified") {
        setScanStatus("success");
      } else {
        throw new Error("TEE biometric verification was not approved.");
      }

      return scanResult;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Biometric verification failed";
      setError(message);
      setScanStatus("failed");
      throw err;
    }
  }, [address]);

  return {
    startScan,
    scanStatus,
    isScanned: scanStatus === "success" || scanStatus === "complete",
    verification,
    error,
  };
}
