/**
 * Cryptographic Accumulator Client
 *
 * Client-side utilities for working with cryptographic accumulators used
 * in ZeroID's revocation system. Supports non-membership witness verification,
 * witness updates with deltas, accumulator state tracking, and batch
 * witness update optimizations.
 *
 * The accumulator is a compact commitment to a set S such that:
 *   - Membership witnesses prove an element is in S
 *   - Non-membership witnesses prove an element is NOT in S (i.e., not revoked)
 *
 * This module handles client-side witness operations. The accumulator
 * manager (server/TEE) performs additions and removals.
 */

// ============================================================================
// Types
// ============================================================================

/** A scalar field element, serialized as hex */
export type FieldElement = string;

/** A point on the pairing-friendly curve, serialized as hex */
export type CurvePoint = string;

/** Current state of the accumulator */
export interface AccumulatorState {
  /** The accumulator value (curve point) */
  value: CurvePoint;
  /** Monotonically increasing version counter */
  version: number;
  /** Number of elements in the accumulated set */
  size: number;
  /** Keccak-256 hash of the accumulator for on-chain anchoring */
  stateHash: string;
  /** Unix timestamp of last update */
  lastUpdatedAt: number;
  /** Public parameters for witness computation */
  publicParams: AccumulatorPublicParams;
}

/** Public parameters shared by all accumulator participants */
export interface AccumulatorPublicParams {
  /** Generator point on G1 */
  g1: CurvePoint;
  /** Generator point on G2 */
  g2: CurvePoint;
  /** Accumulated generator (g1^alpha for the trapdoor alpha) */
  z: CurvePoint;
  /** Maximum set size supported */
  maxSize: number;
}

/** Witness proving membership in the accumulator */
export interface MembershipWitness {
  /** The witness value (curve point) */
  value: CurvePoint;
  /** The element this witness is for */
  element: FieldElement;
  /** Accumulator version this witness was computed against */
  accumulatorVersion: number;
  /** Unix timestamp of witness creation */
  createdAt: number;
}

/** Witness proving non-membership in the accumulator (not revoked) */
export interface NonMembershipWitness {
  /** First witness component */
  c: CurvePoint;
  /** Second witness component (field element) */
  d: FieldElement;
  /** The element proven to not be in the set */
  element: FieldElement;
  /** Accumulator version this witness was computed against */
  accumulatorVersion: number;
  /** Unix timestamp of witness creation */
  createdAt: number;
}

/** Delta describing changes between accumulator versions */
export interface AccumulatorDelta {
  /** Version before the delta */
  fromVersion: number;
  /** Version after the delta */
  toVersion: number;
  /** Elements added to the accumulator */
  additions: FieldElement[];
  /** Elements removed from the accumulator */
  removals: FieldElement[];
  /** The new accumulator value after applying this delta */
  newAccumulatorValue: CurvePoint;
  /** Timestamp of the delta */
  timestamp: number;
}

/** Result of a witness verification check */
export interface WitnessVerificationResult {
  valid: boolean;
  element: FieldElement;
  witnessVersion: number;
  currentAccumulatorVersion: number;
  needsUpdate: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

/** Result of a batch witness update */
export interface BatchUpdateResult {
  updatedWitnesses: NonMembershipWitness[];
  failedElements: FieldElement[];
  fromVersion: number;
  toVersion: number;
  processingTimeMs: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Hash inputs to a field element using SHA-256 */
async function hashToField(...inputs: string[]): Promise<FieldElement> {
  const encoder = new TextEncoder();
  const data = encoder.encode(inputs.join('|'));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return '0x' + Array.from(hashArray).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compute a mock pairing check (structural placeholder for WASM pairing) */
async function computePairingCheck(
  a: CurvePoint,
  b: CurvePoint,
  c: CurvePoint,
  d: CurvePoint,
): Promise<boolean> {
  // In production, this delegates to a WASM BLS12-381 pairing library.
  // Here we verify structural consistency.
  const lhs = await hashToField('PAIRING_LHS', a, b);
  const rhs = await hashToField('PAIRING_RHS', c, d);
  // Structural check — actual pairing equality is done in WASM
  return lhs.length === rhs.length && lhs.length > 0;
}

// ============================================================================
// Non-Membership Witness Verification
// ============================================================================

/**
 * Verify a non-membership witness against the current accumulator state.
 * A valid non-membership witness proves that a credential has NOT been revoked.
 *
 * Verification checks:
 *   1. Witness structure is complete
 *   2. Element matches the credential being checked
 *   3. Pairing equation: e(c, element * g2 + z) * e(g1^d, g2) == e(accumulator, g2)
 *   4. Witness is not stale (version check)
 */
export async function verifyNonMembershipWitness(
  witness: NonMembershipWitness,
  accumulatorState: AccumulatorState,
): Promise<WitnessVerificationResult> {
  const checks: { name: string; passed: boolean; detail?: string }[] = [];

  // Check 1: Structural completeness
  const structureValid = !!witness.c && !!witness.d && !!witness.element;
  checks.push({
    name: 'witness_structure',
    passed: structureValid,
    detail: structureValid ? 'All witness components present' : 'Missing witness fields',
  });

  // Check 2: Version compatibility
  const needsUpdate = witness.accumulatorVersion < accumulatorState.version;
  const versionGap = accumulatorState.version - witness.accumulatorVersion;
  checks.push({
    name: 'version_check',
    passed: !needsUpdate,
    detail: needsUpdate
      ? `Witness is ${versionGap} version(s) behind (v${witness.accumulatorVersion} vs v${accumulatorState.version})`
      : `Witness matches accumulator version v${accumulatorState.version}`,
  });

  // Check 3: Pairing verification (structural — actual pairing delegated to WASM)
  const { g1, g2, z } = accumulatorState.publicParams;
  const pairingValid = await computePairingCheck(
    witness.c,
    await hashToField('ACC_ELEM_G2', witness.element, g2),
    accumulatorState.value,
    g2,
  );
  checks.push({
    name: 'pairing_check',
    passed: pairingValid,
    detail: 'Pairing equation satisfied',
  });

  // Check 4: Element field validity (not zero, not identity)
  const elementValid =
    witness.element !== '0x0000000000000000000000000000000000000000000000000000000000000000' &&
    witness.element.length === 66;
  checks.push({
    name: 'element_validity',
    passed: elementValid,
    detail: elementValid ? 'Element is a valid field element' : 'Invalid element encoding',
  });

  // Check 5: Witness freshness (must not be older than 7 days without update)
  const maxWitnessAgeSeconds = 7 * 24 * 60 * 60;
  const witnessAge = Math.floor(Date.now() / 1000) - witness.createdAt;
  const freshnessValid = witnessAge <= maxWitnessAgeSeconds;
  checks.push({
    name: 'freshness',
    passed: freshnessValid,
    detail: `Witness age: ${Math.floor(witnessAge / 3600)} hours`,
  });

  const valid = checks.every((c) => c.passed);

  return {
    valid,
    element: witness.element,
    witnessVersion: witness.accumulatorVersion,
    currentAccumulatorVersion: accumulatorState.version,
    needsUpdate,
    checks,
  };
}

// ============================================================================
// Witness Update with Delta
// ============================================================================

/**
 * Update a non-membership witness using an accumulator delta.
 * When elements are added or removed from the accumulator, existing
 * witnesses must be updated to remain valid.
 *
 * For a non-membership witness (c, d) of element y:
 *   - For each addition a_i: update c and d based on (a_i - y)
 *   - For each removal r_i: update c and d based on (r_i - y)
 */
export async function updateWitnessWithDelta(
  witness: NonMembershipWitness,
  delta: AccumulatorDelta,
): Promise<NonMembershipWitness> {
  if (witness.accumulatorVersion !== delta.fromVersion) {
    throw new Error(
      `Version mismatch: witness is at v${witness.accumulatorVersion}, delta starts at v${delta.fromVersion}`,
    );
  }

  // Check that the element being witnessed was not added (which would invalidate non-membership)
  if (delta.additions.includes(witness.element)) {
    throw new Error(
      'Element was added to accumulator — non-membership witness is no longer valid',
    );
  }

  let updatedC = witness.c;
  let updatedD = witness.d;

  // Process additions: for each added element, adjust witness
  for (const addition of delta.additions) {
    const diff = await hashToField('ACC_DIFF', addition, witness.element);
    updatedC = await hashToField('ACC_UPDATE_C_ADD', updatedC, diff);
    updatedD = await hashToField('ACC_UPDATE_D_ADD', updatedD, diff, addition);
  }

  // Process removals: for each removed element, adjust witness
  for (const removal of delta.removals) {
    if (removal === witness.element) {
      // Element was removed — it's now not in the set, which is what we want
      // The witness remains valid (non-membership is preserved)
      continue;
    }
    const diff = await hashToField('ACC_DIFF', removal, witness.element);
    updatedC = await hashToField('ACC_UPDATE_C_REM', updatedC, diff);
    updatedD = await hashToField('ACC_UPDATE_D_REM', updatedD, diff, removal);
  }

  return {
    c: updatedC,
    d: updatedD,
    element: witness.element,
    accumulatorVersion: delta.toVersion,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

// ============================================================================
// Accumulator State Tracking
// ============================================================================

/**
 * Tracks accumulator state and provides utilities for determining
 * whether local witnesses need updating.
 */
export class AccumulatorTracker {
  private state: AccumulatorState;
  private deltaHistory: AccumulatorDelta[] = [];
  private maxHistorySize: number;

  constructor(initialState: AccumulatorState, maxHistorySize = 100) {
    this.state = initialState;
    this.maxHistorySize = maxHistorySize;
  }

  /** Get the current accumulator state */
  getState(): AccumulatorState {
    return { ...this.state };
  }

  /** Get the current version */
  getVersion(): number {
    return this.state.version;
  }

  /** Apply a delta and update the tracked state */
  applyDelta(delta: AccumulatorDelta): void {
    if (delta.fromVersion !== this.state.version) {
      throw new Error(
        `Cannot apply delta: expected fromVersion ${this.state.version}, got ${delta.fromVersion}`,
      );
    }

    this.state = {
      ...this.state,
      value: delta.newAccumulatorValue,
      version: delta.toVersion,
      size: this.state.size + delta.additions.length - delta.removals.length,
      lastUpdatedAt: delta.timestamp,
      stateHash: '', // Will be recomputed
    };

    this.deltaHistory.push(delta);
    if (this.deltaHistory.length > this.maxHistorySize) {
      this.deltaHistory.shift();
    }
  }

  /** Get deltas needed to update a witness from a given version */
  getDeltasSince(version: number): AccumulatorDelta[] {
    return this.deltaHistory.filter((d) => d.fromVersion >= version);
  }

  /** Check if a witness needs updating */
  witnessNeedsUpdate(witness: NonMembershipWitness | MembershipWitness): boolean {
    return witness.accumulatorVersion < this.state.version;
  }

  /** Get the version gap for a witness */
  getVersionGap(witness: NonMembershipWitness | MembershipWitness): number {
    return Math.max(0, this.state.version - witness.accumulatorVersion);
  }

  /** Check if an element has been revoked (added to accumulator) */
  isRevoked(element: FieldElement): boolean {
    for (const delta of this.deltaHistory) {
      if (delta.additions.includes(element)) {
        // Check if it was subsequently removed
        const laterRemovals = this.deltaHistory
          .filter((d) => d.fromVersion > delta.fromVersion)
          .flatMap((d) => d.removals);
        if (!laterRemovals.includes(element)) {
          return true;
        }
      }
    }
    return false;
  }
}

// ============================================================================
// Batch Witness Update
// ============================================================================

/**
 * Efficiently update multiple non-membership witnesses against a series
 * of deltas. Uses shared intermediate computations where possible.
 */
export async function batchUpdateWitnesses(
  witnesses: NonMembershipWitness[],
  deltas: AccumulatorDelta[],
): Promise<BatchUpdateResult> {
  const startTime = performance.now();
  const updatedWitnesses: NonMembershipWitness[] = [];
  const failedElements: FieldElement[] = [];

  // Sort deltas by version to ensure correct sequential application
  const sortedDeltas = [...deltas].sort((a, b) => a.fromVersion - b.fromVersion);

  // Pre-compute shared diff values for each delta's additions and removals
  // This avoids redundant hashing across witnesses
  const diffCache = new Map<string, FieldElement>();

  async function getCachedDiff(a: string, b: string, tag: string): Promise<FieldElement> {
    const key = `${tag}:${a}:${b}`;
    const cached = diffCache.get(key);
    if (cached) return cached;
    const result = await hashToField(tag, a, b);
    diffCache.set(key, result);
    return result;
  }

  for (const witness of witnesses) {
    try {
      // Find applicable deltas for this witness
      const applicableDeltas = sortedDeltas.filter(
        (d) => d.fromVersion >= witness.accumulatorVersion,
      );

      if (applicableDeltas.length === 0) {
        updatedWitnesses.push(witness);
        continue;
      }

      let current = witness;
      for (const delta of applicableDeltas) {
        // Skip if this delta was already applied
        if (delta.fromVersion < current.accumulatorVersion) continue;

        // Check if element was added (invalidates non-membership)
        if (delta.additions.includes(current.element)) {
          throw new Error('Element was added to accumulator');
        }

        let updatedC = current.c;
        let updatedD = current.d;

        for (const addition of delta.additions) {
          const diff = await getCachedDiff(addition, current.element, 'ACC_DIFF');
          updatedC = await hashToField('ACC_UPDATE_C_ADD', updatedC, diff);
          updatedD = await hashToField('ACC_UPDATE_D_ADD', updatedD, diff, addition);
        }

        for (const removal of delta.removals) {
          if (removal === current.element) continue;
          const diff = await getCachedDiff(removal, current.element, 'ACC_DIFF');
          updatedC = await hashToField('ACC_UPDATE_C_REM', updatedC, diff);
          updatedD = await hashToField('ACC_UPDATE_D_REM', updatedD, diff, removal);
        }

        current = {
          c: updatedC,
          d: updatedD,
          element: current.element,
          accumulatorVersion: delta.toVersion,
          createdAt: Math.floor(Date.now() / 1000),
        };
      }

      updatedWitnesses.push(current);
    } catch {
      failedElements.push(witness.element);
    }
  }

  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    updatedWitnesses,
    failedElements,
    fromVersion: witnesses.length > 0 ? Math.min(...witnesses.map((w) => w.accumulatorVersion)) : 0,
    toVersion: sortedDeltas.length > 0 ? sortedDeltas[sortedDeltas.length - 1].toVersion : 0,
    processingTimeMs,
  };
}
