/**
 * ZeroID — Public-signal layout and predicate tests
 *
 * These run against the REAL circuit registry, not a mock: their whole point
 * is to pin the shipped `age_proof` circuit's public-signal layout, which the
 * prover previously split the wrong way round.
 */

import * as fs from "fs";
import * as path from "path";

import {
  checkPredicateOutputs,
  expectedPublicSignalCount,
  orderPublicSignals,
  splitPublicSignals,
} from "../signals";
import { CIRCUITS, CIRCUIT_IDS } from "@/config/constants";
import type { Bytes32, CircuitMeta, ZKProof } from "@/types";

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------

/**
 * age_proof's public-signal vector, taken from the compiled circuit's symbol
 * table (`age_proof.sym`):
 *
 *   1,1,178,main.ageVerified
 *   2,2,178,main.credentialValid
 *   3,3,178,main.ageThresholdYears
 *   4,4,178,main.currentTimestamp
 *   5,5,178,main.credentialHashPublic
 *
 * circom emits public OUTPUTS first, then public inputs — the two outputs
 * precede the three inputs.
 */
const AGE_PROOF_SIGNAL_LAYOUT = [
  "ageVerified",
  "credentialValid",
  "ageThresholdYears",
  "currentTimestamp",
  "credentialHashPublic",
];

/** `nPublic` in the shipped public/circuits/age/verification_key.json. */
const AGE_PROOF_N_PUBLIC = 5;

const ageCircuit = CIRCUITS[CIRCUIT_IDS.AGE_PROOF];

function makeProof(overrides: Partial<ZKProof> = {}): ZKProof {
  return {
    id: "proof-1",
    circuitId: CIRCUIT_IDS.AGE_PROOF,
    circuitName: "Age Proof",
    proofSystem: "groth16" as ZKProof["proofSystem"],
    proof: {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    },
    publicInputs: ["18", "1710460800", "0xcred"],
    publicOutputs: ["1", "1"],
    generatedAt: 1710460800,
    validityDuration: 86400,
    proofHash: "0xdeadbeef" as Bytes32,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("age_proof public-signal layout", () => {
  it("declares outputs first, then inputs, matching the circuit symbol table", () => {
    expect([...ageCircuit.outputs, ...ageCircuit.publicInputs]).toEqual(
      AGE_PROOF_SIGNAL_LAYOUT,
    );
  });

  it("declares a signal count equal to the verification key's nPublic", () => {
    expect(expectedPublicSignalCount(ageCircuit)).toBe(AGE_PROOF_N_PUBLIC);
    expect(ageCircuit.publicOutputCount).toBe(2);
    expect(ageCircuit.publicInputs).toHaveLength(3);
  });

  it("agrees with the shipped verification key when it is present on disk", () => {
    // public/circuits/ holds ceremony OUTPUT and is gitignored, so this only
    // runs where the artifacts have actually been deployed.
    const vkeyPath = path.join(
      process.cwd(),
      "public",
      "circuits",
      "age",
      "verification_key.json",
    );
    if (!fs.existsSync(vkeyPath)) return;

    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8")) as {
      protocol: string;
      curve: string;
      nPublic: number;
    };
    expect(vkey.protocol).toBe("groth16");
    expect(vkey.curve).toBe("bn128");
    expect(vkey.nPublic).toBe(expectedPublicSignalCount(ageCircuit));
  });

  it("keeps publicOutputCount and the outputs list in step for every circuit", () => {
    for (const circuit of Object.values(CIRCUITS)) {
      expect(circuit.publicOutputCount).toBe(circuit.outputs.length);
    }
  });
});

describe("splitPublicSignals", () => {
  it("takes the OUTPUTS from the front of the vector and the inputs after", () => {
    const signals = ["1", "1", "18", "1710460800", "999"];

    expect(splitPublicSignals(ageCircuit, signals)).toEqual({
      publicOutputs: ["1", "1"],
      publicInputs: ["18", "1710460800", "999"],
    });
  });

  it("rejects a public-signal vector that is too short", () => {
    expect(() =>
      splitPublicSignals(ageCircuit, ["1", "1", "18", "1710460800"]),
    ).toThrow(/Public signal count mismatch for Age Proof/);
  });

  it("rejects a public-signal vector that is too long", () => {
    expect(() =>
      splitPublicSignals(ageCircuit, [
        "1",
        "1",
        "18",
        "1710460800",
        "999",
        "7",
      ]),
    ).toThrow(/but the proof carries 6/);
  });

  it("rejects a descriptor whose output count contradicts its output names", () => {
    const inconsistent: CircuitMeta = { ...ageCircuit, publicOutputCount: 1 };

    expect(() =>
      splitPublicSignals(inconsistent, ["1", "18", "1710460800", "999"]),
    ).toThrow(/inconsistent/);
  });
});

describe("orderPublicSignals", () => {
  it("rebuilds the vector as outputs then inputs", () => {
    expect(orderPublicSignals(makeProof())).toEqual([
      "1",
      "1",
      "18",
      "1710460800",
      "0xcred",
    ]);
  });

  it("round-trips with splitPublicSignals", () => {
    const signals = ["1", "1", "18", "1710460800", "999"];
    const split = splitPublicSignals(ageCircuit, signals);

    expect(orderPublicSignals(makeProof(split))).toEqual(signals);
  });
});

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

describe("checkPredicateOutputs", () => {
  it("accepts a proof whose required outputs are all 1", () => {
    expect(checkPredicateOutputs(makeProof(), ageCircuit)).toEqual({
      satisfied: true,
    });
  });

  it("refuses a proof carrying ageVerified = 0", () => {
    // The live hole: a holder aged 1.8 years with a genuine issuer-signed
    // credential produces a Groth16 proof that verifies against the shipped
    // verification key while publishing ageVerified = 0.
    const result = checkPredicateOutputs(
      makeProof({ publicOutputs: ["0", "1"] }),
      ageCircuit,
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("ageVerified");
  });

  it("refuses a proof carrying credentialValid = 0", () => {
    const result = checkPredicateOutputs(
      makeProof({ publicOutputs: ["1", "0"] }),
      ageCircuit,
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("credentialValid");
  });

  it("names every unmet output", () => {
    const result = checkPredicateOutputs(
      makeProof({ publicOutputs: ["0", "0"] }),
      ageCircuit,
    );

    expect(result.reason).toContain("ageVerified");
    expect(result.reason).toContain("credentialValid");
  });

  it("refuses an output that is neither 0 nor 1", () => {
    expect(
      checkPredicateOutputs(
        makeProof({ publicOutputs: ["2", "1"] }),
        ageCircuit,
      ).satisfied,
    ).toBe(false);
  });

  it("refuses a descriptor with no requiredOutputs declaration", () => {
    const undeclared: CircuitMeta = { ...ageCircuit };
    delete undeclared.requiredOutputs;

    const result = checkPredicateOutputs(makeProof(), undeclared);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("does not declare which outputs must hold");
  });

  it("refuses an unresolvable circuit", () => {
    const result = checkPredicateOutputs(makeProof(), undefined);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("Unknown circuit");
  });

  it("refuses a proof carrying the wrong number of outputs", () => {
    const result = checkPredicateOutputs(
      makeProof({ publicOutputs: ["1"] }),
      ageCircuit,
    );

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("public output");
  });

  it("refuses a required output the circuit does not publish", () => {
    const mismatched: CircuitMeta = {
      ...ageCircuit,
      requiredOutputs: ["notAnOutput"],
    };

    const result = checkPredicateOutputs(makeProof(), mismatched);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("notAnOutput");
  });

  it("is satisfied trivially for a circuit that asserts its predicate in-circuit", () => {
    const asserted: CircuitMeta = {
      ...ageCircuit,
      outputs: [],
      publicOutputCount: 0,
      requiredOutputs: [],
    };

    expect(
      checkPredicateOutputs(makeProof({ publicOutputs: [] }), asserted),
    ).toEqual({ satisfied: true });
  });
});

// ---------------------------------------------------------------------------
// Registry honesty
// ---------------------------------------------------------------------------

describe("circuit registry", () => {
  it("declares requiredOutputs for every registered circuit", () => {
    for (const circuit of Object.values(CIRCUITS)) {
      expect(circuit.requiredOutputs).toBeDefined();
    }
  });

  it("only marks a circuit available when its artifact paths are declared", () => {
    for (const circuit of Object.values(CIRCUITS)) {
      if (circuit.available) {
        expect(circuit.wasmPath).toBeTruthy();
        expect(circuit.zkeyPath).toBeTruthy();
        expect(circuit.vkeyPath).toBeTruthy();
      } else {
        expect(circuit.unavailableReason).toBeTruthy();
      }
    }
  });

  it("marks only the age circuit available — it is the only one with a ceremony output", () => {
    const available = Object.values(CIRCUITS)
      .filter((circuit) => circuit.available)
      .map((circuit) => circuit.circuitId);

    expect(available).toEqual([CIRCUIT_IDS.AGE_PROOF]);
  });
});
