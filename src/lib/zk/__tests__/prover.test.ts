/**
 * ZeroID — Prover Module Tests
 *
 * Comprehensive test suite for client-side Groth16 proof generation,
 * calldata serialisation, artifact caching, and circuit lookup.
 */

// ---------------------------------------------------------------------------
// Mock module paths (must precede imports of the module-under-test)
// ---------------------------------------------------------------------------

// Mock viem utilities used for proofHash computation
jest.mock('viem', () => ({
  keccak256: jest.fn(() => '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
  toBytes: jest.fn((_hex: string) => new Uint8Array([1, 2, 3])),
  toHex: jest.fn((_bytes: Uint8Array) => '0x010203'),
}));

// Mock withTimeout — by default just resolves the promise unchanged
jest.mock('@/lib/utils', () => ({
  withTimeout: jest.fn(
    (promise: Promise<unknown>, _timeout: number, _msg?: string) => promise,
  ),
}));

// Mock CIRCUITS and PROOF_GENERATION_TIMEOUT_MS
jest.mock('@/config/constants', () => ({
  CIRCUITS: {
    '0xage01': {
      circuitId: '0xage01',
      name: 'Age Proof',
      description: 'Proves age >= threshold',
      publicInputs: ['ageThreshold', 'currentTimestamp'],
      privateInputs: ['dateOfBirth', 'nonce'],
      outputs: ['ageVerified'],
      wasmPath: '/circuits/age/age.wasm',
      zkeyPath: '/circuits/age/age.zkey',
      vkeyPath: '/circuits/age/vkey.json',
      estimatedProvingTimeMs: 3000,
    },
    '0xres01': {
      circuitId: '0xres01',
      name: 'Residency Proof',
      description: 'Proves residency',
      publicInputs: ['targetCountryHash'],
      privateInputs: ['country', 'nonce'],
      outputs: ['residencyVerified'],
      wasmPath: '/circuits/res/res.wasm',
      zkeyPath: '/circuits/res/res.zkey',
      vkeyPath: '/circuits/res/vkey.json',
      estimatedProvingTimeMs: 4000,
    },
  },
  PROOF_GENERATION_TIMEOUT_MS: 60_000,
}));

const MOCK_CIRCUITS = jest.requireMock('@/config/constants').CIRCUITS;

// ---------------------------------------------------------------------------
// Mock snarkjs dynamic import
// ---------------------------------------------------------------------------

const mockFullProve = jest.fn();

jest.mock('snarkjs', () => ({
  groth16: {
    fullProve: (...args: unknown[]) => mockFullProve(...args),
  },
}));

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

// ---------------------------------------------------------------------------
// Import the module-under-test AFTER all mocks are in place
// ---------------------------------------------------------------------------

import {
  generateProof,
  proofToCalldata,
  estimateProvingTime,
  getAvailableCircuits,
  clearArtifactCache,
} from '../prover';
import { withTimeout } from '@/lib/utils';

const mockedWithTimeout = withTimeout as jest.MockedFunction<typeof withTimeout>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArrayBuffer(size = 8): ArrayBuffer {
  return new ArrayBuffer(size);
}

function makeFetchResponse(ok: boolean, status = 200): Partial<Response> {
  return {
    ok,
    status,
    arrayBuffer: jest.fn().mockResolvedValue(makeArrayBuffer()),
  };
}

const SNARKJS_PROOF_RESULT = {
  proof: {
    pi_a: ['111', '222', '1'],
    pi_b: [['333', '444'], ['555', '666'], ['1', '0']],
    pi_c: ['777', '888', '1'],
    protocol: 'groth16',
    curve: 'bn128',
  },
  publicSignals: ['10', '1710460800', '1'],
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('prover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearArtifactCache();

    // Default: fetch succeeds for any path
    mockFetch.mockResolvedValue(makeFetchResponse(true));
    globalThis.fetch = mockFetch;

    // Default: snarkjs.fullProve resolves successfully
    mockFullProve.mockResolvedValue(SNARKJS_PROOF_RESULT);
  });

  afterEach(() => {
    // @ts-ignore
    delete globalThis.fetch;
  });

  // =========================================================================
  // generateProof
  // =========================================================================

  describe('generateProof', () => {
    const circuitId = '0xage01' as `0x${string}`;

    const privateInputs = { dateOfBirth: '946684800', nonce: '12345' };
    const publicInputs = { ageThreshold: '18', currentTimestamp: '1710460800' };

    it('generates a valid ZKProof for a known circuit', async () => {
      const proof = await generateProof(circuitId, privateInputs, publicInputs);

      expect(proof).toBeDefined();
      expect(proof.circuitId).toBe(circuitId);
      expect(proof.circuitName).toBe('Age Proof');
      expect(proof.proofSystem).toBe('groth16');
      expect(proof.proof.a).toEqual(['111', '222']);
      expect(proof.proof.b).toEqual([['333', '444'], ['555', '666']]);
      expect(proof.proof.c).toEqual(['777', '888']);
      expect(proof.proofHash).toBeDefined();
      expect(proof.id).toMatch(/^proof-/);
      expect(proof.validityDuration).toBe(86400);
      expect(typeof proof.generatedAt).toBe('number');
    });

    it('splits publicSignals into publicInputs and publicOutputs based on circuit config', async () => {
      // AGE circuit has 2 publicInputs, so first 2 signals => publicInputs, rest => publicOutputs
      const proof = await generateProof(circuitId, privateInputs, publicInputs);

      expect(proof.publicInputs).toEqual(['10', '1710460800']);
      expect(proof.publicOutputs).toEqual(['1']);
    });

    it('throws for an unknown circuit ID', async () => {
      await expect(
        generateProof('0xunknown' as `0x${string}`, {}, {}),
      ).rejects.toThrow(/Unknown circuit.*0xunknown/);
    });

    it('throws when required inputs are missing', async () => {
      // Omit 'nonce' from private inputs
      await expect(
        generateProof(circuitId, { dateOfBirth: '946684800' }, publicInputs),
      ).rejects.toThrow(/Missing circuit inputs.*nonce/);
    });

    it('throws when public inputs are missing', async () => {
      await expect(
        generateProof(circuitId, privateInputs, { ageThreshold: '18' }),
      ).rejects.toThrow(/Missing circuit inputs.*currentTimestamp/);
    });

    it('throws when all inputs are missing', async () => {
      await expect(
        generateProof(circuitId, {}, {}),
      ).rejects.toThrow(/Missing circuit inputs/);
    });

    it('calls the onProgress callback at each stage', async () => {
      const onProgress = jest.fn();
      await generateProof(circuitId, privateInputs, publicInputs, onProgress);

      expect(onProgress).toHaveBeenCalledWith(5, 'Loading circuit artifacts');
      expect(onProgress).toHaveBeenCalledWith(15, 'Fetching WASM proving circuit');
      expect(onProgress).toHaveBeenCalledWith(40, 'Preparing witness inputs');
      expect(onProgress).toHaveBeenCalledWith(50, expect.stringContaining('Generating ZK proof'));
      expect(onProgress).toHaveBeenCalledWith(90, 'Packaging proof');
      expect(onProgress).toHaveBeenCalledWith(100, 'Proof generated successfully');
    });

    it('works without an onProgress callback (undefined)', async () => {
      // Should not throw when onProgress is not provided
      const proof = await generateProof(circuitId, privateInputs, publicInputs);
      expect(proof).toBeDefined();
    });

    it('fetches WASM and zkey artifacts', async () => {
      await generateProof(circuitId, privateInputs, publicInputs);

      expect(mockFetch).toHaveBeenCalledWith('/circuits/age/age.wasm');
      expect(mockFetch).toHaveBeenCalledWith('/circuits/age/age.zkey');
    });

    it('passes merged witness inputs to snarkjs.groth16.fullProve', async () => {
      await generateProof(circuitId, privateInputs, publicInputs);

      expect(mockFullProve).toHaveBeenCalledTimes(1);
      const [witnessInput, wasmBytes, zkeyBytes] = mockFullProve.mock.calls[0];
      expect(witnessInput).toEqual({
        ageThreshold: '18',
        currentTimestamp: '1710460800',
        dateOfBirth: '946684800',
        nonce: '12345',
      });
      expect(wasmBytes).toBeInstanceOf(Uint8Array);
      expect(zkeyBytes).toBeInstanceOf(Uint8Array);
    });

    it('wraps fullProve with withTimeout', async () => {
      await generateProof(circuitId, privateInputs, publicInputs);

      expect(withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        60_000,
        expect.stringContaining('timed out'),
      );
    });

    it('throws when fetch for WASM artifact fails', async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse(false, 404));

      await expect(
        generateProof(circuitId, privateInputs, publicInputs),
      ).rejects.toThrow(/Failed to fetch circuit artifact.*404/);
    });

    it('throws when fetch for zkey artifact fails', async () => {
      // First call (wasm) succeeds, second call (zkey) fails
      mockFetch
        .mockResolvedValueOnce(makeFetchResponse(true))
        .mockResolvedValueOnce(makeFetchResponse(false, 500));

      await expect(
        generateProof(circuitId, privateInputs, publicInputs),
      ).rejects.toThrow(/Failed to fetch circuit artifact.*500/);
    });

    it('throws when snarkjs fullProve rejects', async () => {
      mockFullProve.mockRejectedValue(new Error('Witness generation failed'));

      await expect(
        generateProof(circuitId, privateInputs, publicInputs),
      ).rejects.toThrow('Witness generation failed');
    });

    it('propagates timeout errors from withTimeout', async () => {
      mockedWithTimeout.mockRejectedValueOnce(
        new Error('Proof generation timed out after 60s for circuit Age Proof'),
      );

      await expect(
        generateProof(circuitId, privateInputs, publicInputs),
      ).rejects.toThrow(/timed out/);
    });

    it('throws when snarkjs dynamic import fails', async () => {
      mockFullProve.mockImplementation(() => {
        throw new Error('Cannot find module snarkjs');
      });

      await expect(
        generateProof(circuitId, privateInputs, publicInputs),
      ).rejects.toThrow('Cannot find module snarkjs');
    });
  });

  // =========================================================================
  // Artifact caching
  // =========================================================================

  describe('artifact caching', () => {
    const circuitId = '0xage01' as `0x${string}`;
    const privateInputs = { dateOfBirth: '946684800', nonce: '12345' };
    const publicInputs = { ageThreshold: '18', currentTimestamp: '1710460800' };

    it('caches artifacts after first fetch', async () => {
      await generateProof(circuitId, privateInputs, publicInputs);
      // fetch called twice (wasm + zkey)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Generate again — should reuse cache
      mockFetch.mockClear();
      await generateProof(circuitId, privateInputs, publicInputs);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches again after clearArtifactCache', async () => {
      await generateProof(circuitId, privateInputs, publicInputs);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      clearArtifactCache();
      mockFetch.mockClear();

      await generateProof(circuitId, privateInputs, publicInputs);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not share cache between different circuits', async () => {
      const resCircuitId = '0xres01' as `0x${string}`;
      const resPrivate = { country: 'US', nonce: '99' };
      const resPublic = { targetCountryHash: '0xabc' };

      await generateProof(circuitId, privateInputs, publicInputs);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      mockFetch.mockClear();
      await generateProof(resCircuitId, resPrivate, resPublic);
      // Different circuit => different artifact paths => fetched again
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // proofToCalldata
  // =========================================================================

  describe('proofToCalldata', () => {
    const proof = {
      a: ['111', '222'] as [string, string],
      b: [['333', '444'], ['555', '666']] as [[string, string], [string, string]],
      c: ['777', '888'] as [string, string],
    };

    it('converts proof elements to BigInt', () => {
      const calldata = proofToCalldata(proof, ['10', '20']);

      expect(calldata.a).toEqual([111n, 222n]);
      expect(calldata.b).toEqual([[333n, 444n], [555n, 666n]]);
      expect(calldata.c).toEqual([777n, 888n]);
      expect(calldata.inputs).toEqual([10n, 20n]);
    });

    it('handles empty public inputs array', () => {
      const calldata = proofToCalldata(proof, []);
      expect(calldata.inputs).toEqual([]);
    });

    it('handles large numeric strings', () => {
      const largeProof = {
        a: ['21888242871839275222246405745257275088696311157297823662689037894645226208583', '1'] as [string, string],
        b: [['1', '2'], ['3', '4']] as [[string, string], [string, string]],
        c: ['5', '6'] as [string, string],
      };

      const calldata = proofToCalldata(largeProof, ['999999999999999999999']);

      expect(calldata.a[0]).toBe(
        21888242871839275222246405745257275088696311157297823662689037894645226208583n,
      );
      expect(calldata.inputs[0]).toBe(999999999999999999999n);
    });

    it('converts zero values correctly', () => {
      const zeroProof = {
        a: ['0', '0'] as [string, string],
        b: [['0', '0'], ['0', '0']] as [[string, string], [string, string]],
        c: ['0', '0'] as [string, string],
      };

      const calldata = proofToCalldata(zeroProof, ['0']);
      expect(calldata.a).toEqual([0n, 0n]);
      expect(calldata.inputs).toEqual([0n]);
    });
  });

  // =========================================================================
  // estimateProvingTime
  // =========================================================================

  describe('estimateProvingTime', () => {
    it('returns estimatedProvingTimeMs for a known circuit', () => {
      expect(estimateProvingTime('0xage01' as `0x${string}`)).toBe(3000);
      expect(estimateProvingTime('0xres01' as `0x${string}`)).toBe(4000);
    });

    it('returns -1 for an unknown circuit', () => {
      expect(estimateProvingTime('0xunknown' as `0x${string}`)).toBe(-1);
    });
  });

  // =========================================================================
  // getAvailableCircuits
  // =========================================================================

  describe('getAvailableCircuits', () => {
    it('returns all circuit metadata entries', () => {
      const circuits = getAvailableCircuits();
      expect(circuits).toHaveLength(2);
      expect(circuits.map((c) => c.name)).toContain('Age Proof');
      expect(circuits.map((c) => c.name)).toContain('Residency Proof');
    });

    it('each circuit has required fields', () => {
      const circuits = getAvailableCircuits();
      for (const c of circuits) {
        expect(c.circuitId).toBeDefined();
        expect(c.name).toBeDefined();
        expect(c.publicInputs).toBeInstanceOf(Array);
        expect(c.privateInputs).toBeInstanceOf(Array);
        expect(c.wasmPath).toBeDefined();
        expect(c.zkeyPath).toBeDefined();
        expect(c.vkeyPath).toBeDefined();
        expect(typeof c.estimatedProvingTimeMs).toBe('number');
      }
    });
  });

  // =========================================================================
  // clearArtifactCache
  // =========================================================================

  describe('clearArtifactCache', () => {
    it('does not throw when called on an empty cache', () => {
      expect(() => clearArtifactCache()).not.toThrow();
    });

    it('can be called multiple times without error', () => {
      clearArtifactCache();
      clearArtifactCache();
      clearArtifactCache();
    });
  });
});
