import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_GATE_FAILED,
  EXIT_OK,
  EXIT_TOOLCHAIN_MISSING,
  KNOWN_COMPILE_FAILURES,
  detectCircomVersion,
  discoverCircuits,
  evaluateResults,
  parseCircomStats,
  runCircuitCompilationCheck,
} from "./check-circuit-compilation.mjs";

const CIRCOM_BIN = process.env.CIRCOM_BIN || "circom";
const circom = detectCircomVersion(CIRCOM_BIN);
const needsCircom = circom.available
  ? false
  : `circom is unavailable (${circom.reason})`;

// A circuit that compiles: one non-linear constraint, no circomlib include.
const COMPILING_CIRCUIT = `pragma circom 2.1.0;

template Square() {
    signal input a;
    signal output b;
    b <== a * a;
}

component main = Square();
`;

// The same error[T2011] shape as the three known-broken repository circuits:
// a signal declared inside a while scope.
const FAILING_CIRCUIT = `pragma circom 2.1.0;

template Broken(n) {
    signal input in[n];
    signal output out;

    var i = 0;
    while (i < n) {
        signal scratch;
        scratch <== in[i];
        i = i + 1;
    }

    out <== in[0];
}

component main = Broken(2);
`;

/** Build a throwaway repository root holding only the named fixtures. */
function makeFixtureRoot(t, circuits) {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "circuit-gate-fixtures-"),
  );
  t.after(() => fs.rmSync(rootDirectory, { recursive: true, force: true }));

  for (const [relativePath, source] of Object.entries(circuits)) {
    const target = path.join(rootDirectory, "circuits", relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return rootDirectory;
}

function runOnFixtures(rootDirectory, allowlist) {
  return runCircuitCompilationCheck({
    rootDirectory,
    allowlist,
    circomBin: CIRCOM_BIN,
    // The fixtures include nothing, so no circomlib lookup is needed.
    includePaths: [],
  });
}

test("compiles a healthy circuit and reports its constraint counts", { skip: needsCircom }, (t) => {
  const rootDirectory = makeFixtureRoot(t, { "ok/ok.circom": COMPILING_CIRCUIT });
  const { exitCode, report, results } = runOnFixtures(rootDirectory, []);

  assert.equal(exitCode, EXIT_OK);
  assert.equal(results.length, 1);
  assert.equal(results[0].circuit, "circuits/ok/ok.circom");
  assert.equal(results[0].stats.nonLinearConstraints, 1);
  assert.match(report, /circuits\/ok\/ok\.circom {2}compiled/);
  assert.match(report, /PASS every circuit compiles and the allowlist is empty\./);
});

test("passes an allowlisted failure and still prints the verbatim circom error", { skip: needsCircom }, (t) => {
  const rootDirectory = makeFixtureRoot(t, {
    "ok/ok.circom": COMPILING_CIRCUIT,
    "bad/bad.circom": FAILING_CIRCUIT,
  });
  const { exitCode, report } = runOnFixtures(rootDirectory, [
    { circuit: "circuits/bad/bad.circom", error: "error[T2011] fixture" },
  ]);

  assert.equal(exitCode, EXIT_OK);
  // The allowlist is printed on every run, so a pass is never silent.
  assert.match(report, /Known-broken allowlist, 1 entry/);
  assert.match(report, /circuits\/bad\/bad\.circom\n {4}error\[T2011\] fixture/);
  assert.match(report, /failed \(allowlisted\)/);
  assert.match(report, /error\[T2011\]: Signal, bus or component declaration inside While scope/);
  assert.match(report, /signal scratch;/);
  assert.match(
    report,
    /PASS the compilable circuits compile and the known-broken set is unchanged\./,
  );
});

test("fails when a circuit that is not allowlisted stops compiling", { skip: needsCircom }, (t) => {
  const rootDirectory = makeFixtureRoot(t, {
    "ok/ok.circom": COMPILING_CIRCUIT,
    "bad/bad.circom": FAILING_CIRCUIT,
  });
  const { exitCode, report } = runOnFixtures(rootDirectory, []);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(report, /circuits\/bad\/bad\.circom {2}FAILED/);
  assert.match(report, /\(NOT allowlisted\)/);
  assert.match(
    report,
    /FAIL circuits\/bad\/bad\.circom does not compile and is not on the allowlist\./,
  );
});

test("fails when an allowlisted circuit now compiles, forcing the list to shrink", { skip: needsCircom }, (t) => {
  const rootDirectory = makeFixtureRoot(t, { "ok/ok.circom": COMPILING_CIRCUIT });
  const { exitCode, report } = runOnFixtures(rootDirectory, [
    { circuit: "circuits/ok/ok.circom", error: "error[T2011] fixture" },
  ]);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(report, /COMPILED \(allowlisted\)/);
  assert.match(
    report,
    /FAIL circuits\/ok\/ok\.circom now compiles but is still on the known-broken allowlist\./,
  );
});

test("fails when an allowlist entry names a circuit that no longer exists", { skip: needsCircom }, (t) => {
  const rootDirectory = makeFixtureRoot(t, { "ok/ok.circom": COMPILING_CIRCUIT });
  const { exitCode, report } = runOnFixtures(rootDirectory, [
    { circuit: "circuits/gone/gone.circom", error: "error[T2011] fixture" },
  ]);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(
    report,
    /FAIL circuits\/gone\/gone\.circom is on the known-broken allowlist but no such circuit was discovered\./,
  );
});

test("a missing circom binary exits differently from a broken circuit", (t) => {
  const rootDirectory = makeFixtureRoot(t, { "bad/bad.circom": FAILING_CIRCUIT });
  const { exitCode, report } = runCircuitCompilationCheck({
    rootDirectory,
    allowlist: [],
    circomBin: path.join(rootDirectory, "no-such-circom-binary"),
    includePaths: [],
  });

  assert.equal(exitCode, EXIT_TOOLCHAIN_MISSING);
  assert.notEqual(EXIT_TOOLCHAIN_MISSING, EXIT_GATE_FAILED);
  assert.match(report, /circom is unavailable/);
  assert.match(report, /cargo install --locked --git https:\/\/github\.com\/iden3\/circom/);
});

test("discovers every circuit recursively, sorted, ignoring other files", (t) => {
  const rootDirectory = makeFixtureRoot(t, {
    "z/last.circom": COMPILING_CIRCUIT,
    "a/nested/first.circom": COMPILING_CIRCUIT,
    "a/notes.md": "not a circuit",
  });

  assert.deepEqual(discoverCircuits(path.join(rootDirectory, "circuits")), [
    "a/nested/first.circom",
    "z/last.circom",
  ]);
});

test("parses the counts circom prints on a successful compile", () => {
  const stats = parseCircomStats(
    [
      "template instances: 179",
      "non-linear constraints: 7931",
      "linear constraints: 1330",
      "public inputs: 3",
      "private inputs: 9",
      "public outputs: 2",
      "wires: 9261",
      "labels: 23059",
      "Written successfully: /tmp/out/age_proof.r1cs",
    ].join("\n"),
  );

  assert.equal(stats.nonLinearConstraints, 7931);
  assert.equal(stats.linearConstraints, 1330);
  assert.equal(stats.wires, 9261);
  assert.equal(stats.templateInstances, 179);
});

test("grades both mismatch directions as gate failures", () => {
  const evaluation = evaluateResults(
    [
      { circuit: "circuits/a.circom", compiled: true },
      { circuit: "circuits/b.circom", compiled: false },
      { circuit: "circuits/c.circom", compiled: false },
    ],
    [{ circuit: "circuits/a.circom" }, { circuit: "circuits/b.circom" }],
  );

  assert.deepEqual(
    evaluation.unexpectedPasses.map((entry) => entry.circuit),
    ["circuits/a.circom"],
  );
  assert.deepEqual(
    evaluation.allowlistedFailures.map((entry) => entry.circuit),
    ["circuits/b.circom"],
  );
  assert.deepEqual(
    evaluation.unexpectedFailures.map((entry) => entry.circuit),
    ["circuits/c.circom"],
  );
  assert.deepEqual(evaluation.missingAllowlistEntries, []);
});

test("the shipped allowlist holds only the three recorded circuits", () => {
  assert.deepEqual(
    KNOWN_COMPILE_FAILURES.map((entry) => entry.circuit),
    [
      "circuits/bbs/bbs_selective_disclosure.circom",
      "circuits/biometric/biometric_match.circom",
      "circuits/threshold/threshold_signature_verify.circom",
    ],
  );
  for (const entry of KNOWN_COMPILE_FAILURES) {
    assert.match(entry.error, /^error\[T20\d\d\]/);
  }
});
