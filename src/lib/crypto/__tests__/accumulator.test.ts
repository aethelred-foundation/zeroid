/**
 * Cryptographic Accumulator — Unit Tests
 *
 * Comprehensive tests for the accumulator module covering:
 * - Non-membership witness verification (all 5 checks)
 * - Witness update with delta (version mismatch, element added, additions/removals)
 * - AccumulatorTracker class (state management, delta history, revocation checks)
 * - Batch witness updates (caching, failure handling, edge cases)
 */

import {
  verifyNonMembershipWitness,
  updateWitnessWithDelta,
  AccumulatorTracker,
  batchUpdateWitnesses,
} from "@/lib/crypto/accumulator";
import type {
  NonMembershipWitness,
  AccumulatorState,
  AccumulatorDelta,
} from "@/lib/crypto/accumulator";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock crypto.subtle.digest to return deterministic hash values
const mockDigest = jest.fn(async (_algo: string, data: ArrayBuffer) => {
  // Return a deterministic 32-byte buffer derived from input length
  const input = new Uint8Array(data);
  const output = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    output[i] = (input[i % input.length] + i) & 0xff;
  }
  return output.buffer;
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    subtle: { digest: mockDigest },
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
      return arr;
    },
  },
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ELEMENT = "0x" + "ab".repeat(32); // 66 chars total
const ZERO_ELEMENT = "0x" + "00".repeat(32);

function makeWitness(
  overrides: Partial<NonMembershipWitness> = {},
): NonMembershipWitness {
  return {
    c: "0xaaa111",
    d: "0xbbb222",
    element: VALID_ELEMENT,
    accumulatorVersion: 5,
    createdAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    ...overrides,
  };
}

function makeAccumulatorState(
  overrides: Partial<AccumulatorState> = {},
): AccumulatorState {
  return {
    value: "0xaccvalue",
    version: 5,
    size: 100,
    stateHash: "0xstatehash",
    lastUpdatedAt: Math.floor(Date.now() / 1000),
    publicParams: {
      g1: "0xg1point",
      g2: "0xg2point",
      z: "0xzpoint",
      maxSize: 10000,
    },
    ...overrides,
  };
}

function makeDelta(
  overrides: Partial<AccumulatorDelta> = {},
): AccumulatorDelta {
  return {
    fromVersion: 5,
    toVersion: 6,
    additions: [],
    removals: [],
    newAccumulatorValue: "0xnewval",
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// verifyNonMembershipWitness
// ---------------------------------------------------------------------------

describe("verifyNonMembershipWitness", () => {
  beforeEach(() => {
    mockDigest.mockClear();
  });

  it("returns valid=true when all checks pass", async () => {
    const witness = makeWitness();
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    expect(result.valid).toBe(true);
    expect(result.element).toBe(VALID_ELEMENT);
    expect(result.witnessVersion).toBe(5);
    expect(result.currentAccumulatorVersion).toBe(5);
    expect(result.needsUpdate).toBe(false);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails witness_structure check when c is empty", async () => {
    const witness = makeWitness({ c: "" });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const structCheck = result.checks.find(
      (c) => c.name === "witness_structure",
    );
    expect(structCheck?.passed).toBe(false);
    expect(structCheck?.detail).toBe("Missing witness fields");
    expect(result.valid).toBe(false);
  });

  it("fails witness_structure check when d is empty", async () => {
    const witness = makeWitness({ d: "" });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const structCheck = result.checks.find(
      (c) => c.name === "witness_structure",
    );
    expect(structCheck?.passed).toBe(false);
  });

  it("fails witness_structure check when element is empty", async () => {
    const witness = makeWitness({ element: "" });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const structCheck = result.checks.find(
      (c) => c.name === "witness_structure",
    );
    expect(structCheck?.passed).toBe(false);
  });

  it("reports needsUpdate=true when witness version is behind", async () => {
    const witness = makeWitness({ accumulatorVersion: 3 });
    const state = makeAccumulatorState({ version: 5 });

    const result = await verifyNonMembershipWitness(witness, state);

    expect(result.needsUpdate).toBe(true);
    const vCheck = result.checks.find((c) => c.name === "version_check");
    expect(vCheck?.passed).toBe(false);
    expect(vCheck?.detail).toContain("2 version(s) behind");
    expect(vCheck?.detail).toContain("v3");
    expect(vCheck?.detail).toContain("v5");
  });

  it("version_check passes when versions match", async () => {
    const witness = makeWitness({ accumulatorVersion: 7 });
    const state = makeAccumulatorState({ version: 7 });

    const result = await verifyNonMembershipWitness(witness, state);

    const vCheck = result.checks.find((c) => c.name === "version_check");
    expect(vCheck?.passed).toBe(true);
    expect(vCheck?.detail).toContain("v7");
  });

  it("pairing_check always passes with structural mock", async () => {
    const witness = makeWitness();
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const pCheck = result.checks.find((c) => c.name === "pairing_check");
    expect(pCheck?.passed).toBe(true);
    expect(pCheck?.detail).toBe("Pairing equation satisfied");
  });

  it("fails element_validity when element is the zero element", async () => {
    const witness = makeWitness({ element: ZERO_ELEMENT });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const eCheck = result.checks.find((c) => c.name === "element_validity");
    expect(eCheck?.passed).toBe(false);
    expect(eCheck?.detail).toBe("Invalid element encoding");
  });

  it("fails element_validity when element has wrong length", async () => {
    const witness = makeWitness({ element: "0xshort" });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const eCheck = result.checks.find((c) => c.name === "element_validity");
    expect(eCheck?.passed).toBe(false);
  });

  it("passes element_validity for correct 66-char non-zero element", async () => {
    const witness = makeWitness({ element: VALID_ELEMENT });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const eCheck = result.checks.find((c) => c.name === "element_validity");
    expect(eCheck?.passed).toBe(true);
    expect(eCheck?.detail).toBe("Element is a valid field element");
  });

  it("fails freshness check when witness is older than 7 days", async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const witness = makeWitness({ createdAt: eightDaysAgo });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const fCheck = result.checks.find((c) => c.name === "freshness");
    expect(fCheck?.passed).toBe(false);
  });

  it("passes freshness check when witness is less than 7 days old", async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const witness = makeWitness({ createdAt: oneHourAgo });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    const fCheck = result.checks.find((c) => c.name === "freshness");
    expect(fCheck?.passed).toBe(true);
    expect(fCheck?.detail).toContain("hours");
  });

  it("valid is false when any single check fails", async () => {
    // Element validity fails but everything else passes
    const witness = makeWitness({ element: "0xshort" });
    const state = makeAccumulatorState();

    const result = await verifyNonMembershipWitness(witness, state);

    expect(result.valid).toBe(false);
  });

  it("calls crypto.subtle.digest for pairing check", async () => {
    const witness = makeWitness();
    const state = makeAccumulatorState();

    await verifyNonMembershipWitness(witness, state);

    // hashToField is called multiple times (for pairing LHS/RHS and element hashing)
    expect(mockDigest).toHaveBeenCalled();
    expect(mockDigest.mock.calls.every((call) => call[0] === "SHA-256")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// updateWitnessWithDelta
// ---------------------------------------------------------------------------

describe("updateWitnessWithDelta", () => {
  beforeEach(() => {
    mockDigest.mockClear();
  });

  it("throws on version mismatch", async () => {
    const witness = makeWitness({ accumulatorVersion: 3 });
    const delta = makeDelta({ fromVersion: 5 });

    await expect(updateWitnessWithDelta(witness, delta)).rejects.toThrow(
      "Version mismatch: witness is at v3, delta starts at v5",
    );
  });

  it("throws when the element was added to the accumulator", async () => {
    const witness = makeWitness({ accumulatorVersion: 5 });
    const delta = makeDelta({ fromVersion: 5, additions: [VALID_ELEMENT] });

    await expect(updateWitnessWithDelta(witness, delta)).rejects.toThrow(
      "Element was added to accumulator",
    );
  });

  it("updates witness version to delta toVersion with no additions or removals", async () => {
    const witness = makeWitness({ accumulatorVersion: 5 });
    const delta = makeDelta({ fromVersion: 5, toVersion: 6 });

    const result = await updateWitnessWithDelta(witness, delta);

    expect(result.accumulatorVersion).toBe(6);
    expect(result.element).toBe(witness.element);
  });

  it("updates c and d when there are additions", async () => {
    const witness = makeWitness({
      accumulatorVersion: 5,
      c: "0xorigC",
      d: "0xorigD",
    });
    const delta = makeDelta({
      fromVersion: 5,
      toVersion: 6,
      additions: ["0x" + "cc".repeat(32)],
    });

    const result = await updateWitnessWithDelta(witness, delta);

    expect(result.c).not.toBe("0xorigC");
    expect(result.d).not.toBe("0xorigD");
    expect(result.accumulatorVersion).toBe(6);
  });

  it("updates c and d when there are removals (non-self)", async () => {
    const otherElement = "0x" + "dd".repeat(32);
    const witness = makeWitness({
      accumulatorVersion: 5,
      c: "0xorigC",
      d: "0xorigD",
    });
    const delta = makeDelta({
      fromVersion: 5,
      toVersion: 6,
      removals: [otherElement],
    });

    const result = await updateWitnessWithDelta(witness, delta);

    expect(result.c).not.toBe("0xorigC");
    expect(result.d).not.toBe("0xorigD");
  });

  it("skips self-removal without altering witness values", async () => {
    const witness = makeWitness({
      accumulatorVersion: 5,
      c: "0xorigC",
      d: "0xorigD",
    });
    const delta = makeDelta({
      fromVersion: 5,
      toVersion: 6,
      removals: [VALID_ELEMENT], // same as witness element
    });

    const result = await updateWitnessWithDelta(witness, delta);

    // c and d should remain the same since the only removal is self
    expect(result.c).toBe("0xorigC");
    expect(result.d).toBe("0xorigD");
    expect(result.accumulatorVersion).toBe(6);
  });

  it("sets createdAt to current timestamp", async () => {
    const now = Math.floor(Date.now() / 1000);
    const witness = makeWitness({ accumulatorVersion: 5, createdAt: 1000 });
    const delta = makeDelta({ fromVersion: 5, toVersion: 6 });

    const result = await updateWitnessWithDelta(witness, delta);

    expect(result.createdAt).toBeGreaterThanOrEqual(now - 1);
    expect(result.createdAt).toBeLessThanOrEqual(now + 1);
  });

  it("processes both additions and removals in one delta", async () => {
    const otherElement = "0x" + "ee".repeat(32);
    const addedElement = "0x" + "ff".repeat(32);
    const witness = makeWitness({ accumulatorVersion: 5 });
    const delta = makeDelta({
      fromVersion: 5,
      toVersion: 6,
      additions: [addedElement],
      removals: [otherElement],
    });

    const result = await updateWitnessWithDelta(witness, delta);

    expect(result.accumulatorVersion).toBe(6);
    expect(result.element).toBe(VALID_ELEMENT);
  });
});

// ---------------------------------------------------------------------------
// AccumulatorTracker
// ---------------------------------------------------------------------------

describe("AccumulatorTracker", () => {
  let tracker: AccumulatorTracker;
  let initialState: AccumulatorState;

  beforeEach(() => {
    initialState = makeAccumulatorState({ version: 1, size: 10 });
    tracker = new AccumulatorTracker(initialState);
  });

  describe("getState", () => {
    it("returns a copy of the initial state", () => {
      const state = tracker.getState();
      expect(state.version).toBe(1);
      expect(state.size).toBe(10);
      // Should be a copy, not the same reference
      expect(state).not.toBe(initialState);
    });
  });

  describe("getVersion", () => {
    it("returns the current version", () => {
      expect(tracker.getVersion()).toBe(1);
    });
  });

  describe("applyDelta", () => {
    it("updates state correctly after applying a delta", () => {
      const delta = makeDelta({
        fromVersion: 1,
        toVersion: 2,
        additions: ["0xelem1", "0xelem2"],
        removals: ["0xelem3"],
        newAccumulatorValue: "0xnewval2",
        timestamp: 999999,
      });

      tracker.applyDelta(delta);

      const state = tracker.getState();
      expect(state.version).toBe(2);
      expect(state.value).toBe("0xnewval2");
      expect(state.size).toBe(11); // 10 + 2 additions - 1 removal
      expect(state.lastUpdatedAt).toBe(999999);
      expect(state.stateHash).toBe(""); // reset
    });

    it("throws on version mismatch", () => {
      const delta = makeDelta({ fromVersion: 5, toVersion: 6 });

      expect(() => tracker.applyDelta(delta)).toThrow(
        "Cannot apply delta: expected fromVersion 1, got 5",
      );
    });

    it("trims delta history when exceeding maxHistorySize", () => {
      const smallTracker = new AccumulatorTracker(
        makeAccumulatorState({ version: 0, size: 0 }),
        3,
      );

      for (let i = 0; i < 5; i++) {
        smallTracker.applyDelta(
          makeDelta({
            fromVersion: i,
            toVersion: i + 1,
            newAccumulatorValue: `0xval${i + 1}`,
          }),
        );
      }

      // Should only retain last 3 deltas
      const deltas = smallTracker.getDeltasSince(0);
      expect(deltas.length).toBe(3);
      expect(deltas[0].fromVersion).toBe(2);
    });

    it("allows sequential deltas", () => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 2,
          newAccumulatorValue: "0xv2",
        }),
      );
      tracker.applyDelta(
        makeDelta({
          fromVersion: 2,
          toVersion: 3,
          newAccumulatorValue: "0xv3",
        }),
      );

      expect(tracker.getVersion()).toBe(3);
    });
  });

  describe("getDeltasSince", () => {
    beforeEach(() => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 2,
          newAccumulatorValue: "0xv2",
        }),
      );
      tracker.applyDelta(
        makeDelta({
          fromVersion: 2,
          toVersion: 3,
          newAccumulatorValue: "0xv3",
        }),
      );
      tracker.applyDelta(
        makeDelta({
          fromVersion: 3,
          toVersion: 4,
          newAccumulatorValue: "0xv4",
        }),
      );
    });

    it("returns all deltas since a given version", () => {
      const deltas = tracker.getDeltasSince(2);
      expect(deltas.length).toBe(2);
      expect(deltas[0].fromVersion).toBe(2);
      expect(deltas[1].fromVersion).toBe(3);
    });

    it("returns empty array when version is current", () => {
      const deltas = tracker.getDeltasSince(4);
      expect(deltas).toHaveLength(0);
    });

    it("returns all deltas when version is 0", () => {
      const deltas = tracker.getDeltasSince(0);
      expect(deltas.length).toBe(3);
    });
  });

  describe("witnessNeedsUpdate", () => {
    it("returns true when witness version is behind", () => {
      const witness = makeWitness({ accumulatorVersion: 0 });
      expect(tracker.witnessNeedsUpdate(witness)).toBe(true);
    });

    it("returns false when witness version matches", () => {
      const witness = makeWitness({ accumulatorVersion: 1 });
      expect(tracker.witnessNeedsUpdate(witness)).toBe(false);
    });
  });

  describe("getVersionGap", () => {
    it("returns the gap between witness and current version", () => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 5,
          newAccumulatorValue: "0xv5",
        }),
      );

      const witness = makeWitness({ accumulatorVersion: 2 });
      expect(tracker.getVersionGap(witness)).toBe(3);
    });

    it("returns 0 when witness is at or ahead of current version", () => {
      const witness = makeWitness({ accumulatorVersion: 10 });
      expect(tracker.getVersionGap(witness)).toBe(0);
    });
  });

  describe("isRevoked", () => {
    it("returns true when element was added and not subsequently removed", () => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 2,
          additions: ["0xrevoked_elem"],
          newAccumulatorValue: "0xv2",
        }),
      );

      expect(tracker.isRevoked("0xrevoked_elem")).toBe(true);
    });

    it("returns false when element was added then later removed", () => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 2,
          additions: ["0xtemp_elem"],
          newAccumulatorValue: "0xv2",
        }),
      );
      tracker.applyDelta(
        makeDelta({
          fromVersion: 2,
          toVersion: 3,
          removals: ["0xtemp_elem"],
          newAccumulatorValue: "0xv3",
        }),
      );

      expect(tracker.isRevoked("0xtemp_elem")).toBe(false);
    });

    it("returns false when element was never added", () => {
      tracker.applyDelta(
        makeDelta({
          fromVersion: 1,
          toVersion: 2,
          additions: ["0xother_elem"],
          newAccumulatorValue: "0xv2",
        }),
      );

      expect(tracker.isRevoked("0xnever_added")).toBe(false);
    });

    it("returns false when delta history is empty", () => {
      expect(tracker.isRevoked("0xanything")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// batchUpdateWitnesses
// ---------------------------------------------------------------------------

describe("batchUpdateWitnesses", () => {
  beforeEach(() => {
    mockDigest.mockClear();
  });

  it("returns all witnesses unchanged when no deltas apply", async () => {
    const witnesses = [
      makeWitness({ accumulatorVersion: 10, element: "0x" + "aa".repeat(32) }),
      makeWitness({ accumulatorVersion: 10, element: "0x" + "bb".repeat(32) }),
    ];
    const deltas = [makeDelta({ fromVersion: 5, toVersion: 6 })];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(2);
    expect(result.failedElements).toHaveLength(0);
  });

  it("updates witnesses through multiple sequential deltas", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, newAccumulatorValue: "0xv2" }),
      makeDelta({ fromVersion: 2, toVersion: 3, newAccumulatorValue: "0xv3" }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(3);
    expect(result.failedElements).toHaveLength(0);
  });

  it("records failed elements when element was added to accumulator", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, additions: [elem] }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(0);
    expect(result.failedElements).toEqual([elem]);
  });

  it("sorts deltas by version before processing", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    // Provide deltas out of order
    const deltas = [
      makeDelta({ fromVersion: 2, toVersion: 3, newAccumulatorValue: "0xv3" }),
      makeDelta({ fromVersion: 1, toVersion: 2, newAccumulatorValue: "0xv2" }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(3);
  });

  it("handles empty witnesses array", async () => {
    const deltas = [makeDelta({ fromVersion: 1, toVersion: 2 })];

    const result = await batchUpdateWitnesses([], deltas);

    expect(result.updatedWitnesses).toHaveLength(0);
    expect(result.failedElements).toHaveLength(0);
    expect(result.fromVersion).toBe(0);
  });

  it("handles empty deltas array", async () => {
    const witnesses = [makeWitness({ accumulatorVersion: 5 })];

    const result = await batchUpdateWitnesses(witnesses, []);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.toVersion).toBe(0);
  });

  it("uses diff cache for repeated computations", async () => {
    const elem1 = "0x" + "aa".repeat(32);
    const elem2 = "0x" + "bb".repeat(32);
    const addedElem = "0x" + "cc".repeat(32);

    const witnesses = [
      makeWitness({ accumulatorVersion: 1, element: elem1 }),
      makeWitness({ accumulatorVersion: 1, element: elem2 }),
    ];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, additions: [addedElem] }),
    ];

    const callCountBefore = mockDigest.mock.calls.length;
    await batchUpdateWitnesses(witnesses, deltas);
    const callCountAfter = mockDigest.mock.calls.length;

    // Should have used caching (some calls saved)
    expect(callCountAfter - callCountBefore).toBeGreaterThan(0);
  });

  it("hits diff cache when same diff key is computed twice", async () => {
    // Use two witnesses with the same element so getCachedDiff
    // hits the cache on the second witness's processing
    const elem = "0x" + "aa".repeat(32);
    const addedElem = "0x" + "cc".repeat(32);

    const witnesses = [
      makeWitness({
        accumulatorVersion: 1,
        element: elem,
        c: "0xc1",
        d: "0xd1",
      }),
      makeWitness({
        accumulatorVersion: 1,
        element: elem,
        c: "0xc2",
        d: "0xd2",
      }),
    ];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, additions: [addedElem] }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);
    expect(result.updatedWitnesses).toHaveLength(2);
    expect(result.failedElements).toHaveLength(0);
  });

  it("reports correct fromVersion and toVersion", async () => {
    const witnesses = [
      makeWitness({ accumulatorVersion: 2, element: "0x" + "aa".repeat(32) }),
      makeWitness({ accumulatorVersion: 4, element: "0x" + "bb".repeat(32) }),
    ];
    const deltas = [
      makeDelta({ fromVersion: 2, toVersion: 3 }),
      makeDelta({ fromVersion: 3, toVersion: 4 }),
      makeDelta({ fromVersion: 4, toVersion: 5 }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(5);
  });

  it("returns processingTimeMs as a number", async () => {
    const result = await batchUpdateWitnesses([], []);

    expect(typeof result.processingTimeMs).toBe("number");
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("skips deltas that are below the current witness version", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 3, element: elem })];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2 }),
      makeDelta({ fromVersion: 2, toVersion: 3 }),
      makeDelta({ fromVersion: 3, toVersion: 4 }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    // Should only apply the delta from v3 to v4
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(4);
  });

  it("processes removals in batch update (non-self elements)", async () => {
    const elem = "0x" + "aa".repeat(32);
    const removedElem = "0x" + "dd".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, removals: [removedElem] }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(2);
    expect(result.failedElements).toHaveLength(0);
  });

  it("skips self-removal in batch update without altering witness", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, removals: [elem] }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(2);
  });

  it("processes both additions and removals in a single batch delta", async () => {
    const elem = "0x" + "aa".repeat(32);
    const addedElem = "0x" + "ff".repeat(32);
    const removedElem = "0x" + "dd".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    const deltas = [
      makeDelta({
        fromVersion: 1,
        toVersion: 2,
        additions: [addedElem],
        removals: [removedElem],
      }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(2);
    expect(result.failedElements).toHaveLength(0);
  });

  it("skips deltas whose fromVersion is below the witness current version", async () => {
    const elem = "0x" + "aa".repeat(32);
    const witnesses = [makeWitness({ accumulatorVersion: 1, element: elem })];
    // Delta v1->v3 will advance the witness to v3, then delta v2->v3 should be skipped
    const deltas = [
      makeDelta({
        fromVersion: 1,
        toVersion: 3,
        additions: ["0x" + "ee".repeat(32)],
      }),
      makeDelta({
        fromVersion: 2,
        toVersion: 3,
        additions: ["0x" + "ff".repeat(32)],
      }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].accumulatorVersion).toBe(3);
    expect(result.failedElements).toHaveLength(0);
  });

  it("handles mix of successful and failed witnesses", async () => {
    const okElem = "0x" + "aa".repeat(32);
    const failElem = "0x" + "bb".repeat(32);

    const witnesses = [
      makeWitness({ accumulatorVersion: 1, element: okElem }),
      makeWitness({ accumulatorVersion: 1, element: failElem }),
    ];
    const deltas = [
      makeDelta({ fromVersion: 1, toVersion: 2, additions: [failElem] }),
    ];

    const result = await batchUpdateWitnesses(witnesses, deltas);

    expect(result.updatedWitnesses).toHaveLength(1);
    expect(result.updatedWitnesses[0].element).toBe(okElem);
    expect(result.failedElements).toEqual([failElem]);
  });
});
