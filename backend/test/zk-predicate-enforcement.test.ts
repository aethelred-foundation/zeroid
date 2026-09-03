/**
 * ZeroID — ZK predicate enforcement
 *
 * A Groth16 proof is "valid" as soon as the witness satisfies the constraint
 * system. Circuits that compute their verdict into a public OUTPUT instead of
 * asserting it in-circuit therefore produce perfectly valid proofs for
 * subjects who do NOT satisfy the claim — the published output says 0. These
 * tests pin the rule that such a proof is refused, not accepted.
 */

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockGroth16Verify = jest.fn();

jest.mock('snarkjs', () => ({
  groth16: {
    verify: (...args: unknown[]) => mockGroth16Verify(...args),
  },
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

import * as fs from 'fs';
import {
  ZKProofService,
  evaluateCircuitPredicate,
  type SnarkProof,
} from '../src/services/zkproof';

const PROOF: SnarkProof = {
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['1', '0'],
  ],
  pi_c: ['7', '8', '1'],
  protocol: 'groth16',
  curve: 'bn128',
};

/** A circuit that publishes its verdict as an output, as age_proof does. */
const OUTPUT_BEARING_CIRCUIT = {
  // circom order: public OUTPUTS first, then public inputs.
  publicSignals: [
    'ageVerified',
    'credentialValid',
    'ageThresholdYears',
    'currentTimestamp',
    'credentialHashPublic',
  ],
  publicOutputs: ['ageVerified', 'credentialValid'],
  requiredOutputs: ['ageVerified', 'credentialValid'],
};

describe('evaluateCircuitPredicate', () => {
  it('accepts a proof whose required outputs are all 1', () => {
    const result = evaluateCircuitPredicate(
      'age_proof',
      OUTPUT_BEARING_CIRCUIT,
      ['1', '1', '18', '1710460800', '999'],
    );

    expect(result.satisfied).toBe(true);
  });

  it('refuses a proof publishing ageVerified = 0', () => {
    const result = evaluateCircuitPredicate(
      'age_proof',
      OUTPUT_BEARING_CIRCUIT,
      ['0', '1', '18', '1710460800', '999'],
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('ageVerified');
  });

  it('refuses a proof publishing credentialValid = 0', () => {
    const result = evaluateCircuitPredicate(
      'age_proof',
      OUTPUT_BEARING_CIRCUIT,
      ['1', '0', '18', '1710460800', '999'],
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('credentialValid');
  });

  it('reads outputs from the FRONT of the vector, where circom puts them', () => {
    // Signals laid out inputs-first would put "1" at index 2. If the reader
    // assumed that layout it would accept this vector; it must not.
    const result = evaluateCircuitPredicate(
      'age_proof',
      OUTPUT_BEARING_CIRCUIT,
      ['18', '1710460800', '1', '1', '999'],
    );

    expect(result.satisfied).toBe(false);
  });

  it('refuses a circuit that does not declare requiredOutputs', () => {
    const result = evaluateCircuitPredicate(
      'unbuilt_circuit',
      { publicSignals: [], publicOutputs: [] },
      ['1'],
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('does not declare which outputs must hold');
  });

  it('refuses a public-signal vector that does not match the declared schema', () => {
    const result = evaluateCircuitPredicate('age_proof', OUTPUT_BEARING_CIRCUIT, [
      '1',
      '1',
      '18',
    ]);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('declares 5 public signal(s)');
  });

  it('refuses a required output the circuit does not publish', () => {
    const result = evaluateCircuitPredicate(
      'age_proof',
      { ...OUTPUT_BEARING_CIRCUIT, requiredOutputs: ['notAnOutput'] },
      ['1', '1', '18', '1710460800', '999'],
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('notAnOutput');
  });

  it('is satisfied trivially for a circuit that asserts its predicate in-circuit', () => {
    // eligibility_policy_context_v1 publishes no outputs: every public signal
    // is an input and the predicate is enforced with `===` constraints.
    const result = evaluateCircuitPredicate(
      'eligibility_policy_context_v1',
      {
        publicSignals: [
          'claimsHash',
          'ageThresholdYears',
          'residencyCountryCode',
          'currentTimestamp',
          'policyVersionHash',
          'contextCommitment',
        ],
        publicOutputs: [],
        requiredOutputs: [],
      },
      ['c', '18', '784', '1710460800', 'p', 'ctx'],
    );

    expect(result.satisfied).toBe(true);
  });
});

describe('ZKProofService.verifyProof predicate gate', () => {
  let service: ZKProofService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ZKProofService();
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 6 }),
    );
  });

  it('accepts a cryptographically valid proof for an in-circuit-asserted circuit', async () => {
    mockGroth16Verify.mockResolvedValue(true);

    const result = await service.verifyProof(
      PROOF,
      ['c', '18', '784', '1710460800', 'p', 'ctx'],
      'eligibility_policy_context_v1',
    );

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('refuses a cryptographically valid proof for a circuit with no declared predicate', async () => {
    mockGroth16Verify.mockResolvedValue(true);

    const result = await service.verifyProof(
      PROOF,
      ['18', '1710460800', '999'],
      'age_verification',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('does not declare which outputs must hold');
  });

  it('refuses a proof whose public-signal vector does not match the schema', async () => {
    mockGroth16Verify.mockResolvedValue(true);

    const result = await service.verifyProof(
      PROOF,
      ['c', '18', '784'],
      'eligibility_policy_context_v1',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('public signal(s)');
  });

  it('reports a cryptographic failure as invalid', async () => {
    mockGroth16Verify.mockResolvedValue(false);

    const result = await service.verifyProof(
      PROOF,
      ['c', '18', '784', '1710460800', 'p', 'ctx'],
      'eligibility_policy_context_v1',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Proof verification failed');
  });

  it('does not run the predicate check when the proof does not verify', async () => {
    mockGroth16Verify.mockResolvedValue(false);

    const result = await service.verifyProof(
      PROOF,
      ['18', '1710460800', '999'],
      'age_verification',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Proof verification failed');
  });
});

describe('CIRCUIT_REGISTRY predicate declarations', () => {
  const service = new ZKProofService();

  it.each([
    ['age_verification_context_v2'],
    ['eligibility_policy_context_v1'],
  ])(
    'declares an empty predicate for %s, which asserts its outcome in-circuit',
    (circuitName) => {
      expect(service.getCircuitRequiredOutputs(circuitName)).toEqual([]);
    },
  );

  it.each([
    ['age_verification'],
    ['nationality_check'],
    ['income_range'],
    ['credential_ownership'],
    ['selective_disclosure'],
  ])('leaves %s undeclared, so its proofs fail closed', (circuitName) => {
    expect(service.getCircuitRequiredOutputs(circuitName)).toBeNull();
  });

  it('returns null for a circuit that is not registered at all', () => {
    expect(service.getCircuitRequiredOutputs('not_a_circuit')).toBeNull();
  });
});
