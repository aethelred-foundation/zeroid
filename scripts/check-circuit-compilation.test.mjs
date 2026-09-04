import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_GATE_FAILED,
  EXIT_OK,
  EXIT_TOOLCHAIN_MISSING,
  CIRCUITS_DIRECTORY,
  EXPECTED_CIRCUITS,
  KNOWN_COMPILE_FAILURES,
  REPO_ROOT,
  detectCircomVersion,
  discoverCircuits,
  evaluateResults,
  parseCircomStats,
  reportSkippedCircomCases,
  runCircuitCompilationCheck,
} from "./check-circuit-compilation.mjs";

const CIRCOM_BIN = process.env.CIRCOM_BIN || "circom";
const circom = detectCircomVersion(CIRCOM_BIN);
const needsCircom = circom.available
  ? false
  : `circom is unavailable (${circom.reason})`;

/**
 * Cases that cannot run without the circom binary, and every case in the file.
 *
 * Counted rather than hardcoded so the banner below can never claim a number
 * that stopped being true. Registration is synchronous, so both totals are
 * final by the time the file finishes loading.
 */
const circomDependentCases = [];
const allCases = [];

/** Register a case that needs circom; skipped (loudly) when the binary is absent. */
function circomTest(name, fn) {
  circomDependentCases.push(name);
  allCases.push(name);
  test(name, { skip: needsCircom }, fn);
}

/** Register a case that runs anywhere. */
function pureTest(name, fn) {
  allCases.push(name);
  test(name, fn);
}

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

/**
 * Run the gate over a fixture root.
 *
 * `expected` defaults to whatever the fixtures contain, which makes the
 * inventory assertion vacuous — deliberately, so the allowlist cases below stay
 * about the allowlist. The inventory cases pass a list that disagrees on
 * purpose.
 */
function runOnFixtures(rootDirectory, allowlist, expected) {
  const circuitsRoot = path.join(rootDirectory, "circuits");
  return runCircuitCompilationCheck({
    rootDirectory,
    allowlist,
    expected:
      expected ??
      discoverCircuits(circuitsRoot).map((circuit) => `circuits/${circuit}`),
    circomBin: CIRCOM_BIN,
    // The fixtures include nothing, so no circomlib lookup is needed.
    includePaths: [],
  });
}

circomTest("compiles a healthy circuit and reports its constraint counts", (t) => {
  const rootDirectory = makeFixtureRoot(t, { "ok/ok.circom": COMPILING_CIRCUIT });
  const { exitCode, report, results } = runOnFixtures(rootDirectory, []);

  assert.equal(exitCode, EXIT_OK);
  assert.equal(results.length, 1);
  assert.equal(results[0].circuit, "circuits/ok/ok.circom");
  assert.equal(results[0].stats.nonLinearConstraints, 1);
  assert.match(report, /circuits\/ok\/ok\.circom {2}compiled/);
  assert.match(report, /PASS every circuit compiles, the discovered set matches the 1-circuit inventory, and the allowlist is empty\./);
});

circomTest("passes an allowlisted failure and still prints the verbatim circom error", (t) => {
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
    /PASS the compilable circuits compile, the discovered set matches the 2-circuit inventory, and the known-broken set is unchanged\./,
  );
});

circomTest("fails when a circuit that is not allowlisted stops compiling", (t) => {
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

circomTest("fails when an allowlisted circuit now compiles, forcing the list to shrink", (t) => {
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

circomTest("fails when an allowlist entry names a circuit that no longer exists", (t) => {
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

circomTest("fails when an expected circuit is no longer discovered", (t) => {
  // Deleted, renamed, or moved under a dot-directory the walk skips: the run
  // would otherwise compile what is left and report PASS while covering less.
  const rootDirectory = makeFixtureRoot(t, { "ok/ok.circom": COMPILING_CIRCUIT });
  const { exitCode, report } = runOnFixtures(rootDirectory, [], [
    "circuits/ok/ok.circom",
    "circuits/gone/gone.circom",
  ]);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(report, /1 circuits discovered of 2 expected/);
  assert.match(
    report,
    /FAIL circuits\/gone\/gone\.circom is in EXPECTED_CIRCUITS but was not discovered/,
  );
  // Actionable in this direction: say what happened to it and what to edit.
  assert.match(report, /deleted, renamed, or moved somewhere the walk skips/);
});

circomTest("fails when a discovered circuit is not in the expected inventory", (t) => {
  // A new circuit arriving unannounced is the other direction: it compiled, but
  // nobody recorded that the repository now contains it.
  const rootDirectory = makeFixtureRoot(t, {
    "ok/ok.circom": COMPILING_CIRCUIT,
    "extra/extra.circom": COMPILING_CIRCUIT,
  });
  const { exitCode, report } = runOnFixtures(rootDirectory, [], ["circuits/ok/ok.circom"]);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(report, /2 circuits discovered of 1 expected/);
  assert.match(
    report,
    /FAIL circuits\/extra\/extra\.circom was discovered but is not in EXPECTED_CIRCUITS/,
  );
  assert.match(report, /add it there deliberately/);
});

circomTest("a circuit hidden under a dot-directory is reported missing, not ignored", (t) => {
  // discoverCircuits skips dot-directories, so before the inventory existed a
  // circuit moved into one vanished from the gate in complete silence.
  const rootDirectory = makeFixtureRoot(t, {
    "ok/ok.circom": COMPILING_CIRCUIT,
    ".attic/hidden.circom": COMPILING_CIRCUIT,
  });
  const { exitCode, report } = runOnFixtures(rootDirectory, [], [
    "circuits/ok/ok.circom",
    "circuits/.attic/hidden.circom",
  ]);

  assert.equal(exitCode, EXIT_GATE_FAILED);
  assert.match(
    report,
    /FAIL circuits\/\.attic\/hidden\.circom is in EXPECTED_CIRCUITS but was not discovered/,
  );
});

pureTest("a missing circom binary exits differently from a broken circuit", (t) => {
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

pureTest("discovers every circuit recursively, sorted, ignoring other files", (t) => {
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

pureTest("parses the counts circom prints on a successful compile", () => {
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

pureTest("grades both mismatch directions as gate failures", () => {
  const evaluation = evaluateResults(
    [
      { circuit: "circuits/a.circom", compiled: true },
      { circuit: "circuits/b.circom", compiled: false },
      { circuit: "circuits/c.circom", compiled: false },
    ],
    [{ circuit: "circuits/a.circom" }, { circuit: "circuits/b.circom" }],
    ["circuits/a.circom", "circuits/b.circom", "circuits/c.circom"],
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
  assert.deepEqual(evaluation.unexpectedCircuits, []);
  assert.deepEqual(evaluation.missingCircuits, []);
});

pureTest("grades both inventory-drift directions without needing the toolchain", () => {
  const evaluation = evaluateResults(
    [
      { circuit: "circuits/a.circom", compiled: true },
      { circuit: "circuits/new.circom", compiled: true },
    ],
    [],
    ["circuits/a.circom", "circuits/gone.circom"],
  );

  assert.deepEqual(evaluation.unexpectedCircuits, ["circuits/new.circom"]);
  assert.deepEqual(evaluation.missingCircuits, ["circuits/gone.circom"]);
  // Inventory drift is orthogonal to how the circuits compiled.
  assert.deepEqual(evaluation.unexpectedFailures, []);
  assert.deepEqual(evaluation.unexpectedPasses, []);
});

pureTest("the expected inventory holds the eleven circuits in the repository", () => {
  assert.equal(EXPECTED_CIRCUITS.length, 11);
  assert.deepEqual(
    [...EXPECTED_CIRCUITS].sort(),
    [...EXPECTED_CIRCUITS],
    "keep EXPECTED_CIRCUITS sorted so additions are readable in a diff",
  );
  for (const circuit of EXPECTED_CIRCUITS) {
    assert.match(circuit, /^circuits\/[^/]+\/[^/]+\.circom$/);
  }
  // Every allowlisted circuit must be a circuit the repository claims to have.
  for (const entry of KNOWN_COMPILE_FAILURES) {
    assert.ok(
      EXPECTED_CIRCUITS.includes(entry.circuit),
      `${entry.circuit} is allowlisted but not in EXPECTED_CIRCUITS`,
    );
  }
});

pureTest("the expected inventory matches what is actually on disk", () => {
  const discovered = discoverCircuits(
    path.join(REPO_ROOT, CIRCUITS_DIRECTORY),
  ).map((circuit) => `${CIRCUITS_DIRECTORY}/${circuit}`);

  assert.deepEqual(discovered, [...EXPECTED_CIRCUITS]);
});

pureTest("announces skipped circom cases loudly and fails them under CI", () => {
  const { banner, failed } = reportSkippedCircomCases({
    skipped: 5,
    total: 10,
    reason: "spawn circom ENOENT",
    ci: "1",
  });

  // Loud: names the count, the total, and why — impossible to read as a pass.
  assert.match(banner, /5 of 10 circuit-compilation gate test cases DID NOT RUN/);
  assert.match(banner, /spawn circom ENOENT/);
  assert.match(banner, /cargo install --locked --git https:\/\/github\.com\/iden3\/circom/);
  assert.match(banner, /!{20}/);

  // CI must never report green on a half-run suite.
  assert.equal(failed, true);
  // A local run without circom may still skip — loudly.
  assert.equal(
    reportSkippedCircomCases({ skipped: 5, total: 10, reason: "r", ci: undefined }).failed,
    false,
  );
  // Nothing skipped is nothing to complain about, CI or not.
  assert.equal(
    reportSkippedCircomCases({ skipped: 0, total: 10, reason: "r", ci: "1" }).failed,
    false,
  );
});

pureTest("the shipped allowlist holds only the three recorded circuits", () => {
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

/*
 * Registration is done, so the counts are final. If circom was unavailable, say
 * so in a form nobody scrolls past — and in CI, refuse to be a skip at all.
 */
const skipReport = reportSkippedCircomCases({
  skipped: needsCircom ? circomDependentCases.length : 0,
  total: allCases.length,
  reason: circom.reason,
  ci: process.env.CI,
});

if (needsCircom) {
  process.stderr.write(skipReport.banner);
  for (const name of circomDependentCases) {
    process.stderr.write(`!! skipped: ${name}\n`);
  }
  process.stderr.write("\n");
}

test("every circom-dependent case ran, or this is not CI", () => {
  assert.ok(
    !skipReport.failed,
    `${circomDependentCases.length} of ${allCases.length} circuit-compilation gate cases ` +
      `were skipped because circom is unavailable (${circom.reason}). CI must not report a ` +
      "half-run gate suite as green: install circom on the runner, or unset CI to accept a " +
      "knowingly partial local run.",
  );
});
