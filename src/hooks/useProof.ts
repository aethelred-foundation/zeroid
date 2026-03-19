/**
 * useProof — Convenience hook re-exporting proof generation from useZKProof.
 */

import { useZKProof } from "./useZKProof";

export function useProof() {
  const {
    generateProof,
    verifyProof,
    isVerifying,
    cancelGeneration,
    progress,
    proofHistory,
  } = useZKProof();

  return {
    generateProof,
    verifyProof,
    isVerifying,
    cancelGeneration,
    proofStatus: progress.stage,
    progress,
    proofHistory,
  };
}
