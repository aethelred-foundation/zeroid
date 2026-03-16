import { logger, redis } from '../index';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ZKProofRequest {
  circuitName: string;
  inputs: Record<string, string | number | bigint>;
  credentialId?: string;
  selectiveDisclosure?: string[];
}

export interface ZKProofResult {
  proofId: string;
  proof: SnarkProof;
  publicSignals: string[];
  circuitName: string;
  verificationKey: string;
  generatedAt: Date;
  generationTimeMs: number;
}

export interface SnarkProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface VerificationResult {
  valid: boolean;
  proofId: string;
  circuitName: string;
  publicSignals: string[];
  verifiedAt: Date;
}

interface CircuitConfig {
  wasmPath: string;
  zkeyPath: string;
  vkeyPath: string;
  maxInputs: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CIRCUITS_DIR = process.env.CIRCUITS_DIR ?? path.join(process.cwd(), 'circuits');
const PROOF_CACHE_TTL = parseInt(process.env.PROOF_CACHE_TTL ?? '3600', 10);
const MAX_PROOF_GENERATION_TIME_MS = 30_000;

// Supported circuits
const CIRCUIT_REGISTRY: Record<string, CircuitConfig> = {
  age_verification: {
    wasmPath: path.join(CIRCUITS_DIR, 'age_verification', 'age_verification.wasm'),
    zkeyPath: path.join(CIRCUITS_DIR, 'age_verification', 'age_verification_final.zkey'),
    vkeyPath: path.join(CIRCUITS_DIR, 'age_verification', 'verification_key.json'),
    maxInputs: 5,
    description: 'Prove age is above a threshold without revealing exact date of birth',
  },
  nationality_check: {
    wasmPath: path.join(CIRCUITS_DIR, 'nationality_check', 'nationality_check.wasm'),
    zkeyPath: path.join(CIRCUITS_DIR, 'nationality_check', 'nationality_check_final.zkey'),
    vkeyPath: path.join(CIRCUITS_DIR, 'nationality_check', 'verification_key.json'),
    maxInputs: 3,
    description: 'Prove nationality membership in a set without revealing exact nationality',
  },
  income_range: {
    wasmPath: path.join(CIRCUITS_DIR, 'income_range', 'income_range.wasm'),
    zkeyPath: path.join(CIRCUITS_DIR, 'income_range', 'income_range_final.zkey'),
    vkeyPath: path.join(CIRCUITS_DIR, 'income_range', 'verification_key.json'),
    maxInputs: 4,
    description: 'Prove income falls within a specified range',
  },
  credential_ownership: {
    wasmPath: path.join(CIRCUITS_DIR, 'credential_ownership', 'credential_ownership.wasm'),
    zkeyPath: path.join(CIRCUITS_DIR, 'credential_ownership', 'credential_ownership_final.zkey'),
    vkeyPath: path.join(CIRCUITS_DIR, 'credential_ownership', 'verification_key.json'),
    maxInputs: 8,
    description: 'Prove ownership of a credential without revealing its contents',
  },
  selective_disclosure: {
    wasmPath: path.join(CIRCUITS_DIR, 'selective_disclosure', 'selective_disclosure.wasm'),
    zkeyPath: path.join(CIRCUITS_DIR, 'selective_disclosure', 'selective_disclosure_final.zkey'),
    vkeyPath: path.join(CIRCUITS_DIR, 'selective_disclosure', 'verification_key.json'),
    maxInputs: 16,
    description: 'Selectively reveal specific fields of a credential while hiding others',
  },
};

// ---------------------------------------------------------------------------
// ZK Proof Service
// ---------------------------------------------------------------------------
export class ZKProofService {
  private snarkjs: typeof import('snarkjs') | null = null;

  // -------------------------------------------------------------------------
  // Lazy-load snarkjs (large module)
  // -------------------------------------------------------------------------
  private async getSnarkJS(): Promise<typeof import('snarkjs')> {
    if (!this.snarkjs) {
      this.snarkjs = await import('snarkjs');
    }
    return this.snarkjs;
  }

  // -------------------------------------------------------------------------
  // Generate a ZK proof
  // -------------------------------------------------------------------------
  async generateProof(request: ZKProofRequest): Promise<ZKProofResult> {
    const proofId = crypto.randomUUID();
    const startTime = Date.now();

    logger.info('zk_proof_generation_start', {
      proofId,
      circuitName: request.circuitName,
      credentialId: request.credentialId,
    });

    // Validate circuit exists
    const circuit = CIRCUIT_REGISTRY[request.circuitName];
    if (!circuit) {
      throw new ZKProofError(
        `Unknown circuit: ${request.circuitName}`,
        'ZK_UNKNOWN_CIRCUIT',
      );
    }

    // Validate input count
    const inputCount = Object.keys(request.inputs).length;
    if (inputCount > circuit.maxInputs) {
      throw new ZKProofError(
        `Too many inputs: ${inputCount} exceeds max ${circuit.maxInputs}`,
        'ZK_TOO_MANY_INPUTS',
      );
    }

    // Verify circuit files exist
    this.verifyCircuitFiles(circuit);

    // Sanitize inputs (convert all values to field elements)
    const sanitizedInputs = this.sanitizeInputs(request.inputs);

    try {
      const snarkjs = await this.getSnarkJS();

      // Generate the proof with a timeout
      const proofPromise = snarkjs.groth16.fullProve(
        sanitizedInputs,
        circuit.wasmPath,
        circuit.zkeyPath,
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new ZKProofError('Proof generation timed out', 'ZK_TIMEOUT')),
          MAX_PROOF_GENERATION_TIME_MS,
        );
      });

      const { proof, publicSignals } = await Promise.race([proofPromise, timeoutPromise]);

      const generationTimeMs = Date.now() - startTime;

      // Load verification key
      const vkeyContent = fs.readFileSync(circuit.vkeyPath, 'utf-8');
      const vkey = JSON.parse(vkeyContent);

      // Self-verify before returning
      const selfVerified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      if (!selfVerified) {
        throw new ZKProofError('Self-verification of generated proof failed', 'ZK_SELF_VERIFY_FAILED');
      }

      const result: ZKProofResult = {
        proofId,
        proof: proof as SnarkProof,
        publicSignals,
        circuitName: request.circuitName,
        verificationKey: circuit.vkeyPath,
        generatedAt: new Date(),
        generationTimeMs,
      };

      // Cache the proof
      await redis.set(
        `zk:proof:${proofId}`,
        JSON.stringify(result),
        'EX',
        PROOF_CACHE_TTL,
      );

      logger.info('zk_proof_generation_success', {
        proofId,
        circuitName: request.circuitName,
        generationTimeMs,
        publicSignalsCount: publicSignals.length,
      });

      return result;
    } catch (err) {
      if (err instanceof ZKProofError) throw err;

      logger.error('zk_proof_generation_failed', {
        proofId,
        circuitName: request.circuitName,
        error: (err as Error).message,
      });

      throw new ZKProofError(
        `Proof generation failed: ${(err as Error).message}`,
        'ZK_GENERATION_FAILED',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Verify a ZK proof
  // -------------------------------------------------------------------------
  async verifyProof(
    proof: SnarkProof,
    publicSignals: string[],
    circuitName: string,
  ): Promise<VerificationResult> {
    const proofId = crypto.randomUUID();

    logger.info('zk_proof_verification_start', { proofId, circuitName });

    const circuit = CIRCUIT_REGISTRY[circuitName];
    if (!circuit) {
      throw new ZKProofError(`Unknown circuit: ${circuitName}`, 'ZK_UNKNOWN_CIRCUIT');
    }

    try {
      const snarkjs = await this.getSnarkJS();

      // Load verification key
      const vkeyContent = fs.readFileSync(circuit.vkeyPath, 'utf-8');
      const vkey = JSON.parse(vkeyContent);

      // Verify the proof
      const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

      const result: VerificationResult = {
        valid,
        proofId,
        circuitName,
        publicSignals,
        verifiedAt: new Date(),
      };

      logger.info('zk_proof_verification_complete', { proofId, circuitName, valid });
      return result;
    } catch (err) {
      logger.error('zk_proof_verification_failed', {
        proofId,
        circuitName,
        error: (err as Error).message,
      });

      throw new ZKProofError(
        `Proof verification failed: ${(err as Error).message}`,
        'ZK_VERIFICATION_FAILED',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Get cached proof
  // -------------------------------------------------------------------------
  async getCachedProof(proofId: string): Promise<ZKProofResult | null> {
    const cached = await redis.get(`zk:proof:${proofId}`);
    return cached ? (JSON.parse(cached) as ZKProofResult) : null;
  }

  // -------------------------------------------------------------------------
  // List available circuits
  // -------------------------------------------------------------------------
  listCircuits(): Array<{ name: string; description: string; maxInputs: number }> {
    return Object.entries(CIRCUIT_REGISTRY).map(([name, config]) => ({
      name,
      description: config.description,
      maxInputs: config.maxInputs,
    }));
  }

  // -------------------------------------------------------------------------
  // Build selective disclosure inputs
  // -------------------------------------------------------------------------
  buildSelectiveDisclosureInputs(
    claims: Record<string, unknown>,
    disclosedFields: string[],
  ): Record<string, string | number | bigint> {
    const inputs: Record<string, string | number | bigint> = {};
    const allFields = Object.keys(claims);

    // Build a bitmask of disclosed fields
    let disclosureMask = BigInt(0);
    for (let i = 0; i < allFields.length; i++) {
      if (disclosedFields.includes(allFields[i])) {
        disclosureMask |= BigInt(1) << BigInt(i);
      }
    }
    inputs['disclosureMask'] = disclosureMask;

    // Hash each claim value as a field element
    for (let i = 0; i < allFields.length; i++) {
      const field = allFields[i];
      const value = claims[field];
      inputs[`claim_${i}`] = this.valueToFieldElement(value);
    }

    inputs['numFields'] = allFields.length;
    return inputs;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private verifyCircuitFiles(circuit: CircuitConfig): void {
    const requiredFiles = [circuit.wasmPath, circuit.zkeyPath, circuit.vkeyPath];
    for (const filePath of requiredFiles) {
      if (!fs.existsSync(filePath)) {
        throw new ZKProofError(
          `Circuit file not found: ${path.basename(filePath)}`,
          'ZK_CIRCUIT_FILE_MISSING',
        );
      }
    }
  }

  private sanitizeInputs(
    inputs: Record<string, string | number | bigint>,
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'bigint') {
        sanitized[key] = value.toString();
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
          throw new ZKProofError(`Invalid input value for ${key}`, 'ZK_INVALID_INPUT');
        }
        sanitized[key] = String(value);
      } else {
        // Validate it looks like a numeric string or hex
        if (!/^(0x)?[0-9a-fA-F]+$/.test(value) && !/^\d+$/.test(value)) {
          throw new ZKProofError(`Invalid input format for ${key}`, 'ZK_INVALID_INPUT');
        }
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private valueToFieldElement(value: unknown): bigint {
    if (typeof value === 'number') return BigInt(value);
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string') {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(value).digest('hex');
      return BigInt('0x' + hash) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    }
    if (typeof value === 'boolean') return value ? BigInt(1) : BigInt(0);
    return BigInt(0);
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class ZKProofError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'ZKProofError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const zkProofService = new ZKProofService();
