/**
 * useBiometric — Hook for biometric scanning (re-exports from useBiometrics).
 */

import { useState, useCallback } from "react";

type ScanStatus = "idle" | "scanning" | "success" | "complete" | "failed";

export function useBiometric() {
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");

  const startScan = useCallback(async () => {
    setScanStatus("scanning");
    // In production, this would invoke TEE-based biometric capture
    setTimeout(() => setScanStatus("success"), 2000);
  }, []);

  return {
    startScan,
    scanStatus,
    isScanned: scanStatus === "success" || scanStatus === "complete",
  };
}
