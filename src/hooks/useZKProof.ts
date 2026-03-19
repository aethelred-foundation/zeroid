/**
 * useZKProof — Hook for zero-knowledge proof generation and verification.
 *
 * Manages WASM/zkey loading for snarkjs circuits, proof generation with
 * progress tracking, and on-chain / API-based verification.
 */

import { useState, useCallback, useRef } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Address, type Hash } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  ZK_VERIFIER_ADDRESS,
  ZK_VERIFIER_ABI,
  ZK_CIRCUIT_BASE_URL,
} from "@/config/constants";
import type {
  ZKCircuitType,
  ZKProofInput,
  ProofHistoryEntry,
  ProofProgress,
} from "@/types";

/** Local proof shape produced by snarkjs Groth16 fullProve */
interface ZKProof {
  circuitType: ZKCircuitType;
  proof: unknown;
  publicSignals: string[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Progress state for proof generation
// ---------------------------------------------------------------------------

type ProofStage =
  | "idle"
  | "loading-wasm"
  | "loading-zkey"
  | "generating"
  | "done"
  | "error";

export function useZKProof() {
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [progress, setProgress] = useState<ProofProgress>({
    stage: "idle" as ProofStage,
    percent: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  // -------------------------------------------------------------------------
  // Generate a ZK proof client-side using snarkjs
  // -------------------------------------------------------------------------

  const generateProof = useCallback(
    async (
      circuitType: ZKCircuitType,
      privateInputs: ZKProofInput,
    ): Promise<ZKProof> => {
      abortRef.current = new AbortController();

      try {
        setProgress({ stage: "loading-wasm", percent: 10 });
        const wasmUrl = `${ZK_CIRCUIT_BASE_URL}/${circuitType}/${circuitType}.wasm`;
        const wasmResponse = await fetch(wasmUrl, {
          signal: abortRef.current.signal,
        });
        const wasmBuffer = await wasmResponse.arrayBuffer();

        setProgress({ stage: "loading-zkey", percent: 30 });
        const zkeyUrl = `${ZK_CIRCUIT_BASE_URL}/${circuitType}/${circuitType}.zkey`;
        const zkeyResponse = await fetch(zkeyUrl, {
          signal: abortRef.current.signal,
        });
        const zkeyBuffer = await zkeyResponse.arrayBuffer();

        setProgress({ stage: "generating", percent: 50 });
        const snarkjs = await import("snarkjs");
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          privateInputs,
          new Uint8Array(wasmBuffer),
          new Uint8Array(zkeyBuffer),
        );

        setProgress({ stage: "done", percent: 100 });
        toast.success("Proof generated successfully");

        const zkProof: ZKProof = {
          circuitType,
          proof,
          publicSignals,
          generatedAt: Date.now(),
        };

        return zkProof;
      } catch (err: any) {
        setProgress({ stage: "error", percent: 0 });
        if (err.name !== "AbortError") {
          toast.error("Proof generation failed", { description: err.message });
        }
        throw err;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Verify proof on-chain
  // -------------------------------------------------------------------------

  const verifyProofMutation = useMutation({
    mutationFn: async (zkProof: ZKProof): Promise<Hash> => {
      const calldata = await formatCalldata(zkProof);
      const hash = await writeContractAsync({
        address: ZK_VERIFIER_ADDRESS as Address,
        abi: ZK_VERIFIER_ABI,
        functionName: "verifyProof",
        args: [calldata.a, calldata.b, calldata.c, zkProof.publicSignals],
      });

      await apiClient.post("/v1/proofs/record", {
        txHash: hash,
        circuitType: zkProof.circuitType,
        publicSignals: zkProof.publicSignals,
      });

      return hash;
    },
    onSuccess: () => {
      toast.success("Proof verified on-chain");
      queryClient.invalidateQueries({ queryKey: ["proofHistory"] });
    },
    onError: (err: Error) => {
      toast.error("On-chain verification failed", { description: err.message });
    },
  });

  // -------------------------------------------------------------------------
  // Abort in-progress proof generation
  // -------------------------------------------------------------------------

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    setProgress({ stage: "idle", percent: 0 });
  }, []);

  const { address } = useAccount();
  const historyQuery = useProofHistory(address);

  return {
    generateProof,
    verifyProof: verifyProofMutation.mutateAsync,
    isVerifying: verifyProofMutation.isPending,
    cancelGeneration,
    progress,
    proofHistory: historyQuery.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Proof history query
// ---------------------------------------------------------------------------

export function useProofHistory(address: string | undefined) {
  return useQuery({
    queryKey: ["proofHistory", address],
    queryFn: () =>
      apiClient.get<ProofHistoryEntry[]>(`/v1/proofs/history/${address}`),
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function formatCalldata(zkProof: ZKProof) {
  const snarkjs = await import("snarkjs");
  const raw = await snarkjs.groth16.exportSolidityCallData(
    zkProof.proof,
    zkProof.publicSignals,
  );
  const [a, b, c] = JSON.parse(`[${raw}]`);
  return { a, b, c };
}
