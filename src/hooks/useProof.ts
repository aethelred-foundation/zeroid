/**
 * useProof — Convenience hook re-exporting proof generation from useZKProof.
 */

import { useZKProof } from "./useZKProof";
import type { DisclosureSelection, ZKCircuitType, ZKProofInput } from "@/types";

export function useProof() {
  const {
    generateProof: generateZKProof,
    verifyProof,
    isVerifying,
    cancelGeneration,
    progress,
    proofHistory,
  } = useZKProof();

  return {
    generateProof: (
      circuitOrDisclosure: ZKCircuitType | DisclosureSelection,
      privateInputs?: ZKProofInput,
    ) => {
      if (typeof circuitOrDisclosure === "string") {
        return generateZKProof(circuitOrDisclosure, privateInputs ?? {});
      }

      return generateZKProof("selective-disclosure", {
        disclosedAttributes: circuitOrDisclosure.disclosed ?? [],
        zkProvedAttributes: circuitOrDisclosure.zkProved ?? [],
        hiddenAttributes: circuitOrDisclosure.hidden ?? [],
      });
    },
    verifyProof,
    isVerifying,
    cancelGeneration,
    proofStatus: progress.stage,
    progress,
    proofHistory,
  };
}
