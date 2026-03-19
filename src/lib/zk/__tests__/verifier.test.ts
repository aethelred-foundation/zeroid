/**
 * ZeroID — Verifier Module Tests
 *
 * Comprehensive test suite for client-side Groth16 proof verification,
 * batch verification, output truthiness checks, expiry detection,
 * and verification-key caching.
 */

// ---------------------------------------------------------------------------
// Mock setup (must precede module-under-test import)
// ---------------------------------------------------------------------------

// Mock withTimeout — default: pass-through
jest.mock("@/lib/utils", () => ({
  withTimeout: jest.fn(
    (promise: Promise<unknown>, _timeout: number, _msg?: string) => promise,
  ),
}));

// Mock CIRCUITS
jest.mock("@/config/constants", () => ({
  CIRCUITS: {
    "0xage01": {
      circuitId: "0xage01",
      name: "Age Proof",
      description: "Proves age >= threshold",
      publicInputs: ["ageThreshold", "currentTimestamp"],
      privateInputs: ["dateOfBirth", "nonce"],
      outputs: ["ageVerified"],
      wasmPath: "/circuits/age/age.wasm",
      zkeyPath: "/circuits/age/age.zkey",
      vkeyPath: "/circuits/age/vkey.json",
      estimatedProvingTimeMs: 3000,
    },
  },
}));

const MOCK_CIRCUITS = jest.requireMock("@/config/constants").CIRCUITS;

// Mock snarkjs dynamic import
const mockVerify = jest.fn();

jest.mock("snarkjs", () => ({
  groth16: {
    verify: (...args: unknown[]) => mockVerify(...args),
  },
}));

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

const MOCK_VKEY = {
  protocol: "groth16",
  curve: "bn128",
  nPublic: 3,
  vk_alpha_1: ["1", "2", "3"],
  vk_beta_2: [
    ["4", "5"],
    ["6", "7"],
  ],
  vk_gamma_2: [
    ["8", "9"],
    ["10", "11"],
  ],
  vk_delta_2: [
    ["12", "13"],
    ["14", "15"],
  ],
  vk_alphabeta_12: [[["16", "17"]]],
  IC: [
    ["18", "19"],
    ["20", "21"],
  ],
};

// ---------------------------------------------------------------------------
// Import module-under-test AFTER mocks
// ---------------------------------------------------------------------------

import {
  verifyProofLocally,
  verifyRawProof,
  verifyProofBatch,
  areOutputsTruthy,
  clearVerificationKeyCache,
} from "../verifier";
import { withTimeout } from "@/lib/utils";
import type { ZKProof, Groth16Proof, Bytes32 } from "@/types";

const mockedWithTimeout = withTimeout as jest.MockedFunction<
  typeof withTimeout
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGroth16Proof(): Groth16Proof {
  return {
    a: ["111", "222"],
    b: [
      ["333", "444"],
      ["555", "666"],
    ],
    c: ["777", "888"],
  };
}

function makeZKProof(overrides: Partial<ZKProof> = {}): ZKProof {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "proof-test-001",
    circuitId: "0xage01" as Bytes32,
    circuitName: "Age Proof",
    proofSystem: "groth16" as ZKProof["proofSystem"],
    proof: makeGroth16Proof(),
    publicInputs: ["18", "1710460800"],
    publicOutputs: ["1"],
    generatedAt: now,
    validityDuration: 86400,
    proofHash:
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Bytes32,
    ...overrides,
  };
}

function makeFetchVkeyResponse(ok = true, status = 200): Partial<Response> {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(MOCK_VKEY),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearVerificationKeyCache();

    mockFetch.mockResolvedValue(makeFetchVkeyResponse());
    globalThis.fetch = mockFetch;

    mockVerify.mockResolvedValue(true);
  });

  afterEach(() => {
    // @ts-ignore
    delete globalThis.fetch;
  });

  // =========================================================================
  // verifyProofLocally
  // =========================================================================

  describe("verifyProofLocally", () => {
    it("returns valid=true when snarkjs.verify returns true", async () => {
      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(true);
      expect(result.circuitId).toBe("0xage01");
      expect(result.proofHash).toBe(
        "0xdeadbeef00000000000000000000000000000000000000000000000000000000",
      );
      expect(result.error).toBeUndefined();
      expect(typeof result.verifiedAt).toBe("number");
    });

    it("returns valid=false when snarkjs.verify returns false", async () => {
      mockVerify.mockResolvedValue(false);

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Proof verification failed");
    });

    it("fetches the verification key for the circuit", async () => {
      await verifyProofLocally(makeZKProof());

      expect(mockFetch).toHaveBeenCalledWith("/circuits/age/vkey.json");
    });

    it('converts proof to snarkjs format with trailing "1" values', async () => {
      await verifyProofLocally(makeZKProof());

      expect(mockVerify).toHaveBeenCalledTimes(1);
      const [_vkey, _signals, snarkjsProof] = mockVerify.mock.calls[0];

      expect(snarkjsProof.pi_a).toEqual(["111", "222", "1"]);
      expect(snarkjsProof.pi_b).toEqual([
        ["333", "444"],
        ["555", "666"],
        ["1", "0"],
      ]);
      expect(snarkjsProof.pi_c).toEqual(["777", "888", "1"]);
      expect(snarkjsProof.protocol).toBe("groth16");
      expect(snarkjsProof.curve).toBe("bn128");
    });

    it("combines publicInputs and publicOutputs for verification signals", async () => {
      const proof = makeZKProof({
        publicInputs: ["18", "1710460800"],
        publicOutputs: ["1", "0"],
      });

      await verifyProofLocally(proof);

      const [_vkey, signals] = mockVerify.mock.calls[0];
      expect(signals).toEqual(["18", "1710460800", "1", "0"]);
    });

    it("wraps verify with a 10-second timeout", async () => {
      await verifyProofLocally(makeZKProof());

      expect(withTimeout).toHaveBeenCalledWith(
        expect.any(Promise),
        10_000,
        "Local proof verification timed out",
      );
    });

    // --- Expired proof detection ---

    it("returns valid=false for an expired proof", async () => {
      const expired = makeZKProof({
        generatedAt: Math.floor(Date.now() / 1000) - 200_000,
        validityDuration: 86400,
      });

      const result = await verifyProofLocally(expired);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Proof has expired");
      // snarkjs.verify should NOT be called for expired proofs
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("does not expire proofs with validityDuration=0 (forever)", async () => {
      const foreverProof = makeZKProof({
        generatedAt: 1_000_000, // very old
        validityDuration: 0,
      });

      const result = await verifyProofLocally(foreverProof);

      expect(result.valid).toBe(true);
      expect(mockVerify).toHaveBeenCalled();
    });

    it("accepts a proof that is still within its validity window", async () => {
      const freshProof = makeZKProof({
        generatedAt: Math.floor(Date.now() / 1000) - 100,
        validityDuration: 86400,
      });

      const result = await verifyProofLocally(freshProof);
      expect(result.valid).toBe(true);
    });

    // --- Error handling ---

    it("returns valid=false when fetch for vkey fails", async () => {
      mockFetch.mockResolvedValue(makeFetchVkeyResponse(false, 404));

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Failed to fetch verification key/);
    });

    it("returns valid=false when snarkjs throws", async () => {
      mockVerify.mockRejectedValue(new Error("Invalid curve point"));

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid curve point");
    });

    it("returns valid=false with generic message for non-Error throws", async () => {
      mockVerify.mockRejectedValue("string error");

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Unknown verification error");
    });

    it("returns valid=false when withTimeout rejects (timeout)", async () => {
      mockedWithTimeout.mockRejectedValueOnce(
        new Error("Local proof verification timed out"),
      );

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/timed out/);
    });

    it("returns valid=false when circuit is unknown", async () => {
      const unknownCircuit = makeZKProof({
        circuitId: "0xunknown" as Bytes32,
      });

      const result = await verifyProofLocally(unknownCircuit);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Unknown circuit/);
    });

    it("returns valid=false when snarkjs import fails", async () => {
      mockVerify.mockImplementation(() => {
        throw new Error("Module not found");
      });

      const result = await verifyProofLocally(makeZKProof());

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Module not found");
    });
  });

  // =========================================================================
  // verifyRawProof
  // =========================================================================

  describe("verifyRawProof", () => {
    const circuitId = "0xage01" as Bytes32;
    const proof = makeGroth16Proof();
    const signals = ["18", "1710460800", "1"];

    it("returns true when snarkjs.verify returns true", async () => {
      const result = await verifyRawProof(circuitId, proof, signals);
      expect(result).toBe(true);
    });

    it("returns false when snarkjs.verify returns false", async () => {
      mockVerify.mockResolvedValue(false);
      const result = await verifyRawProof(circuitId, proof, signals);
      expect(result).toBe(false);
    });

    it("fetches the verification key", async () => {
      await verifyRawProof(circuitId, proof, signals);
      expect(mockFetch).toHaveBeenCalledWith("/circuits/age/vkey.json");
    });

    it("converts proof to snarkjs format before passing to verify", async () => {
      await verifyRawProof(circuitId, proof, signals);

      const [_vkey, _signals, snarkjsProof] = mockVerify.mock.calls[0];
      expect(snarkjsProof.pi_a[2]).toBe("1");
      expect(snarkjsProof.pi_c[2]).toBe("1");
      expect(snarkjsProof.pi_b[2]).toEqual(["1", "0"]);
    });

    it("throws for an unknown circuit", async () => {
      await expect(
        verifyRawProof("0xbadid" as Bytes32, proof, signals),
      ).rejects.toThrow(/Unknown circuit/);
    });

    it("throws when fetch for vkey fails", async () => {
      mockFetch.mockResolvedValue(makeFetchVkeyResponse(false, 500));

      await expect(verifyRawProof(circuitId, proof, signals)).rejects.toThrow(
        /Failed to fetch verification key/,
      );
    });

    it("propagates snarkjs errors", async () => {
      mockVerify.mockRejectedValue(new Error("BN128 pairing failed"));

      await expect(verifyRawProof(circuitId, proof, signals)).rejects.toThrow(
        "BN128 pairing failed",
      );
    });
  });

  // =========================================================================
  // verifyProofBatch
  // =========================================================================

  describe("verifyProofBatch", () => {
    it("verifies multiple proofs and returns results in order", async () => {
      const proofs = [makeZKProof({ id: "p1" }), makeZKProof({ id: "p2" })];

      const results = await verifyProofBatch(proofs);

      expect(results).toHaveLength(2);
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(true);
    });

    it("returns empty array for empty input", async () => {
      const results = await verifyProofBatch([]);
      expect(results).toEqual([]);
    });

    it("individual failures do not prevent others from verifying", async () => {
      // First call succeeds, second fails
      mockVerify
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("bad proof"));

      const proofs = [makeZKProof({ id: "p1" }), makeZKProof({ id: "p2" })];
      const results = await verifyProofBatch(proofs);

      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(false);
      expect(results[1].error).toBe("bad proof");
    });

    it("handles a mix of expired and valid proofs", async () => {
      const expired = makeZKProof({
        id: "expired",
        generatedAt: Math.floor(Date.now() / 1000) - 200_000,
        validityDuration: 86400,
      });
      const valid = makeZKProof({ id: "valid" });

      const results = await verifyProofBatch([expired, valid]);

      expect(results[0].valid).toBe(false);
      expect(results[0].error).toBe("Proof has expired");
      expect(results[1].valid).toBe(true);
    });
  });

  // =========================================================================
  // areOutputsTruthy
  // =========================================================================

  describe("areOutputsTruthy", () => {
    it("returns true when all outputs are non-zero and non-empty", () => {
      const proof = makeZKProof({ publicOutputs: ["1", "42", "999"] });
      expect(areOutputsTruthy(proof)).toBe(true);
    });

    it('returns false when an output is "0"', () => {
      const proof = makeZKProof({ publicOutputs: ["1", "0", "1"] });
      expect(areOutputsTruthy(proof)).toBe(false);
    });

    it("returns false when an output is empty string", () => {
      const proof = makeZKProof({ publicOutputs: ["1", "", "1"] });
      expect(areOutputsTruthy(proof)).toBe(false);
    });

    it("returns true for empty outputs array (vacuously true)", () => {
      const proof = makeZKProof({ publicOutputs: [] });
      expect(areOutputsTruthy(proof)).toBe(true);
    });

    it('returns false when all outputs are "0"', () => {
      const proof = makeZKProof({ publicOutputs: ["0", "0"] });
      expect(areOutputsTruthy(proof)).toBe(false);
    });

    it("returns true for single truthy output", () => {
      const proof = makeZKProof({ publicOutputs: ["1"] });
      expect(areOutputsTruthy(proof)).toBe(true);
    });

    it("treats non-zero numeric strings as truthy", () => {
      const proof = makeZKProof({
        publicOutputs: [
          "21888242871839275222246405745257275088696311157297823662689037894645226208583",
        ],
      });
      expect(areOutputsTruthy(proof)).toBe(true);
    });
  });

  // =========================================================================
  // Verification key caching
  // =========================================================================

  describe("verification key caching", () => {
    it("caches vkey after first fetch", async () => {
      await verifyProofLocally(makeZKProof());
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      await verifyProofLocally(makeZKProof());
      // Should use cache — no additional fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches again after clearVerificationKeyCache", async () => {
      await verifyProofLocally(makeZKProof());
      expect(mockFetch).toHaveBeenCalledTimes(1);

      clearVerificationKeyCache();
      mockFetch.mockClear();

      await verifyProofLocally(makeZKProof());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("caches per circuit ID", async () => {
      // Add a second circuit for this test
      MOCK_CIRCUITS["0xres01"] = {
        circuitId: "0xres01" as `0x${string}`,
        name: "Residency Proof",
        description: "Proves residency",
        publicInputs: ["targetCountryHash"],
        privateInputs: ["country", "nonce"],
        outputs: ["residencyVerified"],
        wasmPath: "/circuits/res/res.wasm",
        zkeyPath: "/circuits/res/res.zkey",
        vkeyPath: "/circuits/res/vkey.json",
        estimatedProvingTimeMs: 4000,
      };

      await verifyProofLocally(
        makeZKProof({ circuitId: "0xage01" as Bytes32 }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      await verifyProofLocally(
        makeZKProof({ circuitId: "0xres01" as Bytes32 }),
      );
      // Different circuit => different vkey => new fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith("/circuits/res/vkey.json");

      // Clean up
      delete MOCK_CIRCUITS["0xres01"];
    });
  });

  // =========================================================================
  // clearVerificationKeyCache
  // =========================================================================

  describe("clearVerificationKeyCache", () => {
    it("does not throw when cache is empty", () => {
      expect(() => clearVerificationKeyCache()).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      clearVerificationKeyCache();
      clearVerificationKeyCache();
      clearVerificationKeyCache();
    });
  });
});
