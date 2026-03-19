/**
 * ZeroID — Client-Side ZK Proof Generation
 *
 * Uses snarkjs WASM to generate Groth16 proofs entirely in the browser.
 * Proof artifacts (WASM circuit, zkey) are loaded from the public
 * directory and cached after first fetch for repeat proofs.
 */

import type {
  Bytes32,
  CircuitMeta,
  Groth16Proof,
  ZKProof,
  ProofSystem,
} from "@/types";
import { CIRCUITS, PROOF_GENERATION_TIMEOUT_MS } from "@/config/constants";
import { withTimeout } from "@/lib/utils";
import { keccak256, toBytes, toHex } from "viem";

// ============================================================================
// Types
// ============================================================================

/** snarkjs fullProve result shape */
interface SnarkjsProofResult {
  proof: {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
}

/** Progress callback for UI feedback during proof generation */
export type ProofProgressCallback = (progress: number, stage: string) => void;

// ============================================================================
// Artifact Cache
// ============================================================================

const artifactCache = new Map<string, ArrayBuffer>();

/**
 * Fetch a circuit artifact (WASM or zkey) with caching.
 * Artifacts are stored in-memory after first load.
 *
 * @param path - Public path to the artifact file
 * @returns The artifact as an ArrayBuffer
 * @throws If the fetch fails or returns a non-OK status
 */
async function fetchArtifact(path: string): Promise<ArrayBuffer> {
  const cached = artifactCache.get(path);
  if (cached) return cached;

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch circuit artifact: ${path} (HTTP ${response.status})`,
    );
  }

  const buffer = await response.arrayBuffer();
  artifactCache.set(path, buffer);
  return buffer;
}

/**
 * Clear the artifact cache. Useful for memory management
 * when navigating away from proof-related pages.
 */
export function clearArtifactCache(): void {
  artifactCache.clear();
}

// ============================================================================
// Proof Generation
// ============================================================================

/**
 * Generate a Groth16 ZK proof using snarkjs WASM in the browser.
 *
 * @param circuitId - Identifier of the circuit to use (must exist in CIRCUITS)
 * @param privateInputs - Private witness inputs (never leaves the browser)
 * @param publicInputs - Public inputs that will be visible to verifiers
 * @param onProgress - Optional callback for progress updates
 * @returns A complete `ZKProof` object ready for submission
 *
 * @throws {Error} If the circuit is not found, artifacts fail to load,
 *         or proof generation times out
 *
 * @example
 * ```ts
 * const proof = await generateProof(
 *   CIRCUIT_IDS.AGE_PROOF,
 *   { dateOfBirth: '946684800', nonce: '12345', ... },
 *   { ageThresholdYears: '18', currentTimestamp: '1710460800', ... },
 *   (progress, stage) => setProgress(progress),
 * );
 * ```
 */
export async function generateProof(
  circuitId: Bytes32,
  privateInputs: Record<string, string>,
  publicInputs: Record<string, string>,
  onProgress?: ProofProgressCallback,
): Promise<ZKProof> {
  // 1. Resolve circuit metadata
  const circuit = CIRCUITS[circuitId];
  if (!circuit) {
    throw new Error(
      `Unknown circuit: ${circuitId}. Available circuits: ${Object.keys(CIRCUITS).join(", ")}`,
    );
  }

  onProgress?.(5, "Loading circuit artifacts");

  // 2. Load snarkjs dynamically (it is a large module)
  const snarkjs = await loadSnarkjs();

  onProgress?.(15, "Fetching WASM proving circuit");

  // 3. Fetch artifacts in parallel
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    fetchArtifact(circuit.wasmPath),
    fetchArtifact(circuit.zkeyPath),
  ]);

  onProgress?.(40, "Preparing witness inputs");

  // 4. Merge public and private inputs into the witness input map
  const witnessInput: Record<string, string> = {
    ...publicInputs,
    ...privateInputs,
  };

  // Validate that all required inputs are present
  const allExpectedInputs = [...circuit.publicInputs, ...circuit.privateInputs];
  const missingInputs = allExpectedInputs.filter(
    (key) => !(key in witnessInput),
  );
  if (missingInputs.length > 0) {
    throw new Error(
      `Missing circuit inputs for ${circuit.name}: ${missingInputs.join(", ")}`,
    );
  }

  onProgress?.(50, "Generating ZK proof (this may take a moment)");

  // 5. Generate the proof with a timeout
  const result = await withTimeout(
    snarkjs.groth16.fullProve(
      witnessInput,
      new Uint8Array(wasmBuffer),
      new Uint8Array(zkeyBuffer),
    ) as Promise<SnarkjsProofResult>,
    PROOF_GENERATION_TIMEOUT_MS,
    `Proof generation timed out after ${PROOF_GENERATION_TIMEOUT_MS / 1000}s for circuit ${circuit.name}`,
  );

  onProgress?.(90, "Packaging proof");

  // 6. Convert snarkjs proof format to our Groth16Proof type
  const groth16Proof: Groth16Proof = {
    a: [result.proof.pi_a[0], result.proof.pi_a[1]],
    b: [
      [result.proof.pi_b[0][0], result.proof.pi_b[0][1]],
      [result.proof.pi_b[1][0], result.proof.pi_b[1][1]],
    ],
    c: [result.proof.pi_c[0], result.proof.pi_c[1]],
  };

  // 7. Compute proof hash for deduplication / reference
  const proofBytes = toBytes(
    toHex(new TextEncoder().encode(JSON.stringify(groth16Proof))),
  );
  const proofHash = keccak256(proofBytes) as Bytes32;

  // 8. Split public signals into inputs and outputs
  const numPublicInputs = circuit.publicInputs.length;
  const publicInputValues = result.publicSignals.slice(0, numPublicInputs);
  const publicOutputValues = result.publicSignals.slice(numPublicInputs);

  const now = Math.floor(Date.now() / 1000);

  const zkProof: ZKProof = {
    id: `proof-${now}-${Math.random().toString(36).slice(2, 10)}`,
    circuitId,
    circuitName: circuit.name,
    proofSystem: "groth16" as ProofSystem,
    proof: groth16Proof,
    publicInputs: publicInputValues,
    publicOutputs: publicOutputValues,
    generatedAt: now,
    validityDuration: 86400, // 24 hours default
    proofHash,
  };

  onProgress?.(100, "Proof generated successfully");

  return zkProof;
}

// ============================================================================
// Proof Serialisation
// ============================================================================

/**
 * Serialise a Groth16 proof into the calldata format expected by
 * the on-chain verifier contract.
 *
 * @param proof - The Groth16 proof
 * @param publicInputs - Array of public input values
 * @returns Tuple of `[a, b, c, publicInputs]` suitable for contract calls
 */
export function proofToCalldata(
  proof: Groth16Proof,
  publicInputs: string[],
): {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
  inputs: bigint[];
} {
  return {
    a: [BigInt(proof.a[0]), BigInt(proof.a[1])],
    b: [
      [BigInt(proof.b[0][0]), BigInt(proof.b[0][1])],
      [BigInt(proof.b[1][0]), BigInt(proof.b[1][1])],
    ],
    c: [BigInt(proof.c[0]), BigInt(proof.c[1])],
    inputs: publicInputs.map((v) => BigInt(v)),
  };
}

/**
 * Estimate the proving time for a given circuit.
 *
 * @param circuitId - The circuit to estimate for
 * @returns Estimated time in milliseconds, or -1 if unknown
 */
export function estimateProvingTime(circuitId: Bytes32): number {
  const circuit = CIRCUITS[circuitId];
  return circuit?.estimatedProvingTimeMs ?? -1;
}

/**
 * List all available circuits with their metadata.
 */
export function getAvailableCircuits(): CircuitMeta[] {
  return Object.values(CIRCUITS);
}

// ============================================================================
// Dynamic Import Helper
// ============================================================================

/**
 * Dynamically import snarkjs to avoid bundling it in the initial chunk.
 * snarkjs is ~2MB and only needed when generating proofs.
 */
async function loadSnarkjs(): Promise<typeof import("snarkjs")> {
  return import("snarkjs");
}
