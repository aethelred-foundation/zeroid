/**
 * useZKProof — Hook for zero-knowledge proof generation and verification.
 *
 * Manages WASM/zkey loading for snarkjs circuits, proof generation with
 * progress tracking, and on-chain / API-based verification.
 */

import { useState, useCallback, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery, useMutation } from "@tanstack/react-query";
import { type Address } from "viem";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { ProofSystem } from "@/types";
import {
  ZK_VERIFIER_ADDRESS,
  ZK_VERIFIER_ABI,
  ZK_CIRCUIT_BASE_URL,
} from "@/config/constants";
import type {
  ZKCircuitType,
  ZKProof,
  ZKProofInput,
  ProofHistoryEntry,
  ProofProgress,
  Groth16Proof,
  Bytes32,
} from "@/types";

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
const EMPTY_BYTES32 = `0x${"0".repeat(64)}` as Bytes32;

export function useZKProof() {
  const publicClient = usePublicClient();
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

        const generatedAt = Math.floor(Date.now() / 1000);
        const zkProof: ZKProof = {
          id: `${circuitType}-${generatedAt}`,
          circuitId: EMPTY_BYTES32,
          circuitName: circuitType,
          proofSystem: ProofSystem.Groth16,
          proof: proof as Groth16Proof,
          publicInputs: publicSignals,
          publicOutputs: [],
          generatedAt,
          validityDuration: 0,
          proofHash: EMPTY_BYTES32,
          circuitType,
          publicSignals,
          protocol: "groth16",
          curve: "bn128",
          createdAt: generatedAt,
          publicInputCount: publicSignals.length,
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
    mutationFn: async (zkProof: ZKProof): Promise<boolean> => {
      if (!publicClient) {
        throw new Error("A public blockchain client is not available.");
      }

      const calldata = await formatCalldata(zkProof);
      return publicClient.readContract({
        address: ZK_VERIFIER_ADDRESS as Address,
        abi: ZK_VERIFIER_ABI,
        functionName: "verifyProof",
        args: [
          zkProof.circuitId,
          calldata,
          zkProof.publicInputs.map((value) => BigInt(value)),
        ],
      });
    },
    onSuccess: (isValid) => {
      if (isValid) {
        toast.success("Proof verified on-chain");
      } else {
        toast.error("On-chain verification failed", {
          description: "The verifier contract returned false.",
        });
      }
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
      apiClient.get<ProofHistoryEntry[]>(
        "/api/v1/verification/history?type=ZK_PROOF",
      ),
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
    zkProof.publicInputs,
  );
  const [rawA, rawB, rawC] = JSON.parse(`[${raw}]`) as unknown[];
  return {
    a: toUint256Pair(rawA, "proof.a"),
    b: toUint256PairPair(rawB, "proof.b"),
    c: toUint256Pair(rawC, "proof.c"),
  };
}

function toUint256Pair(value: unknown, label: string): [bigint, bigint] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must contain exactly two uint256 values.`);
  }

  return [
    toUint256(value[0], `${label}[0]`),
    toUint256(value[1], `${label}[1]`),
  ];
}

function toUint256PairPair(
  value: unknown,
  label: string,
): [[bigint, bigint], [bigint, bigint]] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must contain exactly two uint256 pairs.`);
  }

  return [
    toUint256Pair(value[0], `${label}[0]`),
    toUint256Pair(value[1], `${label}[1]`),
  ];
}

function toUint256(value: unknown, label: string): bigint {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`${label} is not a uint256 value.`);
  }

  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${label} is not a uint256 value.`);
  }
}
