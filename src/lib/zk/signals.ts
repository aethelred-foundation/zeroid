/**
 * ZeroID — Public-signal layout and predicate enforcement
 *
 * Two facts about Groth16 proofs over circom circuits drive this module:
 *
 * 1. circom lays the public-signal vector out as public OUTPUTS FIRST, then
 *    public inputs. `age_proof`'s symbol table is
 *    `[ageVerified, credentialValid, ageThresholdYears, currentTimestamp,
 *    credentialHashPublic]` — the two outputs precede the three inputs, and
 *    its verification key declares `nPublic: 5`. Splitting the vector the
 *    other way around silently rotates every label on the proof.
 *
 * 2. A proof is "valid" as soon as the witness satisfies the constraint
 *    system. `age_proof` constrains `ageVerified <== 1 - ageCompare.out` but
 *    never asserts the result, so an under-age holder with a genuine
 *    issuer-signed credential produces a cryptographically valid proof that
 *    publishes `ageVerified = 0`. Validity is therefore NOT the predicate:
 *    the published output has to be checked as well.
 *
 * Both checks live here so the prover, the bespoke verifier, the canonical
 * on-chain verifier and the UI all apply exactly the same rule.
 */

import type { CircuitMeta, ZKProof } from "@/types";

// ============================================================================
// Types
// ============================================================================

/** Outcome of checking a proof's published predicate outputs. */
export interface PredicateCheck {
  /** True only when every required output is present and equal to 1. */
  satisfied: boolean;
  /** Human-readable reason the predicate was not satisfied. */
  reason?: string;
}

/** A public-signal vector split into its output and input halves. */
export interface SplitPublicSignals {
  /** Public output values, in `circuit.outputs` order. */
  publicOutputs: string[];
  /** Public input values, in `circuit.publicInputs` order. */
  publicInputs: string[];
}

// ============================================================================
// Layout
// ============================================================================

/**
 * Total number of public signals a circuit emits — its `nPublic`.
 * Outputs precede inputs.
 */
export function expectedPublicSignalCount(circuit: CircuitMeta): number {
  return circuit.publicOutputCount + circuit.publicInputs.length;
}

/**
 * Split a snarkjs public-signal vector into public outputs and public inputs.
 *
 * The split point is the circuit's declared `publicOutputCount`, never an
 * inference from the array itself. A descriptor that disagrees with its own
 * `outputs` list, or a vector whose length disagrees with the descriptor, is
 * refused — a mis-sized vector means the descriptor and the shipped artifact
 * have drifted apart and no label on the proof can be trusted.
 *
 * @throws {Error} If the descriptor is self-inconsistent or the vector length
 *         does not match `publicOutputCount + publicInputs.length`.
 */
export function splitPublicSignals(
  circuit: CircuitMeta,
  publicSignals: readonly string[],
): SplitPublicSignals {
  if (circuit.publicOutputCount !== circuit.outputs.length) {
    throw new Error(
      `Circuit descriptor for ${circuit.name} is inconsistent: publicOutputCount ` +
        `${circuit.publicOutputCount} does not match ${circuit.outputs.length} declared output name(s)`,
    );
  }

  const expected = expectedPublicSignalCount(circuit);
  if (publicSignals.length !== expected) {
    throw new Error(
      `Public signal count mismatch for ${circuit.name}: circuit declares ${expected} ` +
        `(${circuit.publicOutputCount} output(s) then ${circuit.publicInputs.length} input(s)) ` +
        `but the proof carries ${publicSignals.length}`,
    );
  }

  return {
    publicOutputs: publicSignals.slice(0, circuit.publicOutputCount),
    publicInputs: publicSignals.slice(circuit.publicOutputCount),
  };
}

/**
 * Rebuild the snarkjs public-signal vector from a `ZKProof`, in the order the
 * circuit emits it: outputs first, then inputs. Verification against the
 * verification key fails if the halves are concatenated the other way round.
 */
export function orderPublicSignals(zkProof: ZKProof): string[] {
  return [...zkProof.publicOutputs, ...zkProof.publicInputs];
}

// ============================================================================
// Predicate
// ============================================================================

/**
 * Check a proof's published outputs against the circuit's declared predicate.
 *
 * Fails closed: an unknown circuit, or a circuit whose descriptor does not
 * declare `requiredOutputs`, is refused rather than accepted. A circuit that
 * asserts its predicate in-circuit and publishes no outputs declares `[]`,
 * which is satisfied trivially.
 *
 * @param zkProof - The proof whose outputs to inspect
 * @param circuit - The circuit descriptor, or `undefined` if unresolvable
 */
export function checkPredicateOutputs(
  zkProof: Pick<ZKProof, "circuitId" | "publicOutputs">,
  circuit: CircuitMeta | undefined,
): PredicateCheck {
  if (!circuit) {
    return {
      satisfied: false,
      reason: `Unknown circuit ${zkProof.circuitId}: the proof's predicate cannot be checked`,
    };
  }

  const required = circuit.requiredOutputs;
  if (!required) {
    return {
      satisfied: false,
      reason:
        `Circuit ${circuit.name} does not declare which outputs must hold, so the proof ` +
        `cannot be shown to satisfy its predicate`,
    };
  }

  if (zkProof.publicOutputs.length !== circuit.publicOutputCount) {
    return {
      satisfied: false,
      reason:
        `Circuit ${circuit.name} emits ${circuit.publicOutputCount} public output(s) but the ` +
        `proof carries ${zkProof.publicOutputs.length}`,
    };
  }

  const unmet: string[] = [];
  for (const name of required) {
    const index = circuit.outputs.indexOf(name);
    if (index === -1) {
      return {
        satisfied: false,
        reason: `Circuit ${circuit.name} does not publish a required output named ${name}`,
      };
    }
    if (zkProof.publicOutputs[index] !== "1") {
      unmet.push(name);
    }
  }

  if (unmet.length > 0) {
    return {
      satisfied: false,
      reason: `${circuit.name} did not hold: ${unmet.join(", ")} not satisfied`,
    };
  }

  return { satisfied: true };
}
