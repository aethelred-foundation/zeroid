import { logger, redis } from '../runtime';
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
  /** Why the proof was rejected, when `valid` is false. */
  reason?: string;
}

/** Outcome of checking a proof's published predicate outputs. */
export interface PredicateCheck {
  satisfied: boolean;
  reason?: string;
}

interface CircuitConfig {
  wasmPath: string;
  zkeyPath: string;
  vkeyPath: string;
  maxInputs: number;
  description: string;
  /**
   * Public-signal names in the exact order the circuit emits them. circom
   * emits public OUTPUTS first, then public inputs, so `publicOutputs` is a
   * prefix of this list.
   */
  publicSignals: string[];
  /**
   * Names of the circuit's public OUTPUT signals, occupying the first
   * positions of the public-signal vector. Empty for circuits that assert
   * their predicate in-circuit and publish no outputs.
   */
  publicOutputs: string[];
  /**
   * Output signals that must equal 1 for the proof to carry the meaning the
   * caller attaches to it. A Groth16 proof is valid whenever the witness
   * satisfies the constraint system — which, for a circuit that computes its
   * verdict into an output instead of asserting it, includes the case where
   * the verdict is 0. `undefined` means the circuit's predicate is not known;
   * such proofs are refused rather than accepted.
   */
  requiredOutputs?: string[];
  contextBound: boolean;
}

export interface PublicSignalCommitments {
  claimsHash: string;
  contextCommitment: string;
  publicSignals?: Record<string, string>;
}

export interface PublicSignalSchemaValidation {
  valid: boolean;
  code?: string;
  error?: string;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CIRCUITS_DIR =
  process.env.CIRCUITS_DIR ?? path.join(process.cwd(), 'circuits');
const PROOF_CACHE_TTL = parseInt(process.env.PROOF_CACHE_TTL ?? '3600', 10);
const MAX_PROOF_GENERATION_TIME_MS = 30_000;
const CLAIMS_HASH_PUBLIC_SIGNAL = 'claimsHash';
const CONTEXT_COMMITMENT_PUBLIC_SIGNAL = 'contextCommitment';

// Supported circuits
const CIRCUIT_REGISTRY: Record<string, CircuitConfig> = {
  age_verification: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'age_verification',
      'age_verification.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'age_verification',
      'age_verification_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'age_verification',
      'verification_key.json',
    ),
    maxInputs: 5,
    description:
      'Prove age is above a threshold without revealing exact date of birth',
    publicSignals: [
      'ageThresholdYears',
      'currentTimestamp',
      'credentialHashPublic',
    ],
    // No circuit source or ceremony artifacts exist for this entry, so its
    // public-signal layout and predicate are unknown. `requiredOutputs` is
    // deliberately left undeclared: verification fails closed until the
    // circuit is built and its symbol table pins the real layout.
    publicOutputs: [],
    contextBound: false,
  },
  age_verification_context_v2: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'age_context_v2',
      'age_context_proof_js',
      'age_context_proof.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'age_context_v2',
      'age_context_proof_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'age_context_v2',
      'verification_key.json',
    ),
    maxInputs: 14,
    description:
      'Context-bound age proof with claimsHash and verifier context as fixed public signals',
    publicSignals: [
      'claimsHash',
      'ageThresholdYears',
      'currentTimestamp',
      'contextCommitment',
    ],
    // Verified against the circuit's symbol table: every public signal is an
    // input, and the predicate (expiry, date-of-birth sanity, age threshold,
    // context binding) is asserted in-circuit with `=== `, so there is no
    // output bit a prover could publish as 0.
    publicOutputs: [],
    requiredOutputs: [],
    contextBound: true,
  },
  eligibility_policy_context_v1: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'eligibility_context_v1',
      'eligibility_context_proof_js',
      'eligibility_context_proof.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'eligibility_context_v1',
      'eligibility_context_proof_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'eligibility_context_v1',
      'verification_key.json',
    ),
    maxInputs: 18,
    description:
      'Context-bound eligibility proof with age, residence, policy version, and verifier context signals',
    publicSignals: [
      'claimsHash',
      'ageThresholdYears',
      'residencyCountryCode',
      'currentTimestamp',
      'policyVersionHash',
      'contextCommitment',
    ],
    // Verified against the circuit's symbol table: every public signal is an
    // input, and the predicate (expiry, date-of-birth sanity, age threshold,
    // context binding) is asserted in-circuit with `=== `, so there is no
    // output bit a prover could publish as 0.
    publicOutputs: [],
    requiredOutputs: [],
    contextBound: true,
  },
  nationality_check: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'nationality_check',
      'nationality_check.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'nationality_check',
      'nationality_check_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'nationality_check',
      'verification_key.json',
    ),
    maxInputs: 3,
    description:
      'Prove nationality membership in a set without revealing exact nationality',
    publicSignals: [
      'currentTimestamp',
      'credentialHashPublic',
      'allowedNationalities',
      'merkleRoot',
      'useMerkleMode',
    ],
    // No circuit source or ceremony artifacts exist for this entry, so its
    // public-signal layout and predicate are unknown. `requiredOutputs` is
    // deliberately left undeclared: verification fails closed until the
    // circuit is built and its symbol table pins the real layout.
    publicOutputs: [],
    contextBound: false,
  },
  income_range: {
    wasmPath: path.join(CIRCUITS_DIR, 'income_range', 'income_range.wasm'),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'income_range',
      'income_range_final.zkey',
    ),
    vkeyPath: path.join(CIRCUITS_DIR, 'income_range', 'verification_key.json'),
    maxInputs: 4,
    description: 'Prove income falls within a specified range',
    publicSignals: [],
    // No circuit source or ceremony artifacts exist for this entry, so its
    // public-signal layout and predicate are unknown. `requiredOutputs` is
    // deliberately left undeclared: verification fails closed until the
    // circuit is built and its symbol table pins the real layout.
    publicOutputs: [],
    contextBound: false,
  },
  credential_ownership: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'credential_ownership',
      'credential_ownership.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'credential_ownership',
      'credential_ownership_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'credential_ownership',
      'verification_key.json',
    ),
    maxInputs: 8,
    description:
      'Prove ownership of a credential without revealing its contents',
    publicSignals: [],
    // No circuit source or ceremony artifacts exist for this entry, so its
    // public-signal layout and predicate are unknown. `requiredOutputs` is
    // deliberately left undeclared: verification fails closed until the
    // circuit is built and its symbol table pins the real layout.
    publicOutputs: [],
    contextBound: false,
  },
  selective_disclosure: {
    wasmPath: path.join(
      CIRCUITS_DIR,
      'selective_disclosure',
      'selective_disclosure.wasm',
    ),
    zkeyPath: path.join(
      CIRCUITS_DIR,
      'selective_disclosure',
      'selective_disclosure_final.zkey',
    ),
    vkeyPath: path.join(
      CIRCUITS_DIR,
      'selective_disclosure',
      'verification_key.json',
    ),
    maxInputs: 16,
    description:
      'Selectively reveal specific fields of a credential while hiding others',
    publicSignals: [],
    // No circuit source or ceremony artifacts exist for this entry, so its
    // public-signal layout and predicate are unknown. `requiredOutputs` is
    // deliberately left undeclared: verification fails closed until the
    // circuit is built and its symbol table pins the real layout.
    publicOutputs: [],
    contextBound: false,
  },
};

// ---------------------------------------------------------------------------
// Predicate enforcement
// ---------------------------------------------------------------------------

/**
 * Check a proof's published outputs against the predicate its circuit claims
 * to prove.
 *
 * circom emits public OUTPUTS first and public inputs after, so a required
 * output's index within `circuit.publicOutputs` is also its index in the
 * public-signal vector.
 *
 * Fails closed. A circuit that does not declare `requiredOutputs` has no known
 * predicate, so its proofs are refused; a circuit whose declared schema does
 * not match the vector it was handed has drifted from its artifacts, so no
 * position in that vector can be trusted.
 */
export function evaluateCircuitPredicate(
  circuitName: string,
  circuit: Pick<CircuitConfig, 'publicSignals' | 'publicOutputs' | 'requiredOutputs'>,
  publicSignals: string[],
): PredicateCheck {
  const required = circuit.requiredOutputs;
  if (!required) {
    return {
      satisfied: false,
      reason: `Circuit ${circuitName} does not declare which outputs must hold, so the proof cannot be shown to satisfy its predicate`,
    };
  }

  if (
    circuit.publicSignals.length > 0 &&
    publicSignals.length !== circuit.publicSignals.length
  ) {
    return {
      satisfied: false,
      reason: `Circuit ${circuitName} declares ${circuit.publicSignals.length} public signal(s) but the proof carries ${publicSignals.length}`,
    };
  }

  const unmet: string[] = [];
  for (const name of required) {
    const index = circuit.publicOutputs.indexOf(name);
    if (index === -1) {
      return {
        satisfied: false,
        reason: `Circuit ${circuitName} does not publish a required output named ${name}`,
      };
    }
    if (publicSignals[index] !== '1') {
      unmet.push(name);
    }
  }

  if (unmet.length > 0) {
    return {
      satisfied: false,
      reason: `Circuit ${circuitName} predicate not satisfied: ${unmet.join(', ')} is not 1`,
    };
  }

  return { satisfied: true };
}

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
          () =>
            reject(
              new ZKProofError('Proof generation timed out', 'ZK_TIMEOUT'),
            ),
          MAX_PROOF_GENERATION_TIME_MS,
        );
      });

      const { proof, publicSignals } = await Promise.race([
        proofPromise,
        timeoutPromise,
      ]);

      const generationTimeMs = Date.now() - startTime;

      // Load verification key
      const vkeyContent = fs.readFileSync(circuit.vkeyPath, 'utf-8');
      const vkey = JSON.parse(vkeyContent);

      // Self-verify before returning
      const selfVerified = await snarkjs.groth16.verify(
        vkey,
        publicSignals,
        proof,
      );
      if (!selfVerified) {
        throw new ZKProofError(
          'Self-verification of generated proof failed',
          'ZK_SELF_VERIFY_FAILED',
        );
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
      throw new ZKProofError(
        `Unknown circuit: ${circuitName}`,
        'ZK_UNKNOWN_CIRCUIT',
      );
    }

    try {
      const snarkjs = await this.getSnarkJS();

      // Load verification key
      const vkeyContent = fs.readFileSync(circuit.vkeyPath, 'utf-8');
      const vkey = JSON.parse(vkeyContent);

      // Verify the proof
      const cryptographicallyValid = await snarkjs.groth16.verify(
        vkey,
        publicSignals,
        proof,
      );

      // Cryptographic validity is not the predicate. A circuit that computes
      // its verdict into a public output instead of asserting it produces a
      // perfectly valid proof for a subject who does NOT satisfy the claim, so
      // the published outputs have to be checked too.
      const predicate = cryptographicallyValid
        ? evaluateCircuitPredicate(circuitName, circuit, publicSignals)
        : { satisfied: false, reason: 'Proof verification failed' };

      const result: VerificationResult = {
        valid: cryptographicallyValid && predicate.satisfied,
        proofId,
        circuitName,
        publicSignals,
        verifiedAt: new Date(),
        reason: predicate.satisfied ? undefined : predicate.reason,
      };

      logger.info('zk_proof_verification_complete', {
        proofId,
        circuitName,
        valid: result.valid,
        cryptographicallyValid,
        predicateSatisfied: predicate.satisfied,
      });
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
  listCircuits(): Array<{
    name: string;
    description: string;
    maxInputs: number;
    publicSignals: string[];
    contextBound: boolean;
  }> {
    return Object.entries(CIRCUIT_REGISTRY).map(([name, config]) => ({
      name,
      description: config.description,
      maxInputs: config.maxInputs,
      publicSignals: config.publicSignals,
      contextBound: this.isCircuitContextBound(name),
    }));
  }

  isCircuitContextBound(circuitName: string): boolean {
    const circuit = CIRCUIT_REGISTRY[circuitName];
    if (!circuit?.contextBound) {
      return false;
    }

    return (
      this.isContextBoundPublicSignalSchema(circuit.publicSignals) &&
      this.areCircuitArtifactsAvailable(circuit)
    );
  }

  getCircuitPublicSignalSchema(circuitName: string): string[] | null {
    const circuit = CIRCUIT_REGISTRY[circuitName];
    return circuit ? [...circuit.publicSignals] : null;
  }

  /**
   * The output signals that must equal 1 for a proof from this circuit to
   * carry the meaning the caller attaches to it. `null` means the circuit is
   * unknown or its predicate has not been declared, in which case its proofs
   * are refused.
   */
  getCircuitRequiredOutputs(circuitName: string): string[] | null {
    const required = CIRCUIT_REGISTRY[circuitName]?.requiredOutputs;
    return required ? [...required] : null;
  }

  validateContextBoundPublicSignals(
    circuitName: string,
    publicSignals: string[],
    expected: PublicSignalCommitments,
  ): PublicSignalSchemaValidation {
    const circuit = CIRCUIT_REGISTRY[circuitName];
    if (!circuit) {
      return {
        valid: false,
        code: 'ZK_UNKNOWN_CIRCUIT',
        error: `Unknown circuit: ${circuitName}`,
        statusCode: 400,
      };
    }

    if (!this.isCircuitContextBound(circuitName)) {
      return {
        valid: false,
        code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
        error:
          'ZK circuit is not approved for context-bound production verification',
        statusCode: 503,
      };
    }

    return this.validatePublicSignalsAgainstSchema(
      publicSignals,
      circuit.publicSignals,
      expected,
    );
  }

  validatePublicSignalsAgainstSchema(
    publicSignals: string[],
    publicSignalSchema: string[],
    expected: PublicSignalCommitments,
  ): PublicSignalSchemaValidation {
    if (!this.isContextBoundPublicSignalSchema(publicSignalSchema)) {
      return {
        valid: false,
        code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
        error:
          'Circuit public-signal schema must expose claimsHash first and contextCommitment last',
        statusCode: 503,
      };
    }

    if (publicSignals.length !== publicSignalSchema.length) {
      return {
        valid: false,
        code: 'PROOF_SIGNALS_SCHEMA_INVALID',
        error:
          'Public signals do not match the circuit schema for this context-bound proof',
        statusCode: 400,
      };
    }

    const expectedBySignalName: Record<string, string> = {
      ...expected.publicSignals,
      claimsHash: expected.claimsHash,
      contextCommitment: expected.contextCommitment,
    };

    if (publicSignals[0] !== expectedBySignalName.claimsHash) {
      return {
        valid: false,
        code: 'PROOF_CLAIMS_HASH_NOT_COMMITTED',
        error:
          'Claims commitment is not the first public signal - proof is not bound to the credential',
        statusCode: 400,
      };
    }

    if (
      publicSignals[publicSignals.length - 1] !==
      expectedBySignalName.contextCommitment
    ) {
      return {
        valid: false,
        code: 'PROOF_CONTEXT_NOT_COMMITTED',
        error:
          'Context commitment is not the last public signal - proof is not bound to this context',
        statusCode: 400,
      };
    }

    for (let index = 1; index < publicSignalSchema.length - 1; index += 1) {
      const signalName = publicSignalSchema[index];
      const expectedValue = expectedBySignalName[signalName];

      if (typeof expectedValue !== 'string') {
        return {
          valid: false,
          code: 'PROOF_PUBLIC_SIGNAL_EXPECTATION_MISSING',
          error: `Expected value is missing for public signal: ${signalName}`,
          statusCode: 400,
        };
      }

      if (publicSignals[index] !== expectedValue) {
        return {
          valid: false,
          code: 'PROOF_PUBLIC_SIGNAL_VALUE_MISMATCH',
          error: `Public signal ${signalName} does not match the issued proof context`,
          statusCode: 400,
        };
      }
    }

    return { valid: true };
  }

  private isContextBoundPublicSignalSchema(publicSignals: string[]): boolean {
    return (
      publicSignals.length >= 2 &&
      publicSignals[0] === CLAIMS_HASH_PUBLIC_SIGNAL &&
      publicSignals[publicSignals.length - 1] ===
        CONTEXT_COMMITMENT_PUBLIC_SIGNAL
    );
  }

  private areCircuitArtifactsAvailable(circuit: CircuitConfig): boolean {
    return [circuit.wasmPath, circuit.zkeyPath, circuit.vkeyPath].every(
      (filePath) => fs.existsSync(filePath),
    );
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
    const requiredFiles = [
      circuit.wasmPath,
      circuit.zkeyPath,
      circuit.vkeyPath,
    ];
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
          throw new ZKProofError(
            `Invalid input value for ${key}`,
            'ZK_INVALID_INPUT',
          );
        }
        sanitized[key] = String(value);
      } else {
        // Validate it looks like a numeric string or hex
        if (!/^(0x)?[0-9a-fA-F]+$/.test(value) && !/^\d+$/.test(value)) {
          throw new ZKProofError(
            `Invalid input format for ${key}`,
            'ZK_INVALID_INPUT',
          );
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
      const hash = crypto.createHash('sha256').update(value).digest('hex');
      return (
        BigInt('0x' + hash) %
        BigInt(
          '21888242871839275222246405745257275088548364400416034343698204186575808495617',
        )
      );
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
import crypto from 'crypto';
