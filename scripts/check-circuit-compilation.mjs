#!/usr/bin/env node

/**
 * Compile every circom circuit under circuits/ and fail if the set of
 * uncompilable circuits differs from the recorded allowlist below.
 *
 * Three circuits shipped as documented features while being uncompilable, and
 * nothing in the repository would have noticed. This gate is the check that
 * would have caught them at authoring time.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const CIRCUITS_DIRECTORY = "circuits";
export const REMEDIATION_SCOPE_DOC =
  "docs/audit/ZK-CIRCUIT-REMEDIATION-SCOPE.md";
export const CIRCOM_INSTALL_INSTRUCTION =
  "install circom 2.2.x: cargo install --locked --git https://github.com/iden3/circom --tag v2.2.3 circom (see https://docs.circom.io/getting-started/installation/)";

/** Every circuit behaved as recorded. */
export const EXIT_OK = 0;
/** A circuit broke the gate: an unexpected failure, or a stale allowlist entry. */
export const EXIT_GATE_FAILED = 1;
/** The toolchain is missing, so the gate proved nothing. Distinct from a broken circuit. */
export const EXIT_TOOLCHAIN_MISSING = 2;

/**
 * Circuits known not to compile, recorded so the gate can still run today.
 *
 * This list may only ever shrink. Fixing a circuit means deleting its entry:
 * the gate fails when a listed circuit starts compiling, so the list cannot go
 * stale without CI saying so. Remediation scope and owner per circuit:
 * docs/audit/ZK-CIRCUIT-REMEDIATION-SCOPE.md.
 */
export const KNOWN_COMPILE_FAILURES = Object.freeze([
  Object.freeze({
    circuit: "circuits/bbs/bbs_selective_disclosure.circom",
    code: "T2011",
    error:
      "error[T2011] signal/component declared inside a while scope (selected, accum, revealedCheck, eqChecks)",
  }),
  Object.freeze({
    circuit: "circuits/biometric/biometric_match.circom",
    // circom aborts at the first error, so T2008 is all it reports. Removing
    // the duplicate symbol does NOT make this compile: lines 104, 111 and 259
    // are loop-scoped signal declarations, so it then fails T2011 like the
    // other two. Verified by renaming the local template and recompiling.
    code: "T2008",
    error:
      "error[T2008] duplicated callable symbol: it defines LessEqThan, which circomlib/circuits/comparators.circom also defines. Also fails T2011 once that is resolved (loop-scoped signals at :104, :111, :259)",
  }),
  Object.freeze({
    circuit: "circuits/threshold/threshold_signature_verify.circom",
    code: "T2011",
    error:
      "error[T2011] signal declared inside a while scope (numFactor, diff, denomFactor)",
  }),
]);

const ANSI_PATTERN = new RegExp("\\u001B\\[[0-9;]*m", "g");

export function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

/** Every .circom file under `circuitsRoot`, as sorted paths relative to it. */
export function discoverCircuits(circuitsRoot) {
  const found = [];

  const walk = (absoluteDirectory, relativeDirectory) => {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(absoluteDirectory, entry.name);
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        walk(absolute, relative);
      } else if (entry.isFile() && entry.name.endsWith(".circom")) {
        found.push(relative);
      }
    }
  };

  walk(circuitsRoot, "");
  return found.sort();
}

const STAT_FIELDS = Object.freeze([
  ["template instances", "templateInstances"],
  ["non-linear constraints", "nonLinearConstraints"],
  ["linear constraints", "linearConstraints"],
  ["public inputs", "publicInputs"],
  ["private inputs", "privateInputs"],
  ["public outputs", "publicOutputs"],
  ["wires", "wires"],
  ["labels", "labels"],
]);

/** Pull the counts circom prints on a successful compile. */
export function parseCircomStats(stdout) {
  const clean = stripAnsi(stdout);
  const stats = {};
  for (const [label, key] of STAT_FIELDS) {
    const match = clean.match(new RegExp(`^${label}:\\s*(\\d+)\\s*$`, "im"));
    stats[key] = match ? Number.parseInt(match[1], 10) : null;
  }
  return stats;
}

/**
 * Locate the node_modules directory that satisfies the circuits'
 * `include "circomlib/circuits/..."` lines. circomlib is a declared dependency,
 * so a clean `npm ci` puts it wherever npm hoists it: resolve, never hardcode.
 */
export function resolveCircomlibIncludeRoot(fromDirectory = REPO_ROOT) {
  const requireFrom = createRequire(path.join(fromDirectory, "package.json"));
  const manifest = requireFrom.resolve("circomlib/package.json");
  // The include lines are written as "circomlib/circuits/...", so circom needs
  // the directory *containing* circomlib on its include path.
  return path.dirname(path.dirname(manifest));
}

/** Run `circom --version`, reporting a missing binary rather than throwing. */
export function detectCircomVersion(circomBin) {
  const result = spawnSync(circomBin, ["--version"], { encoding: "utf8" });
  if (result.error) {
    return { available: false, version: null, reason: result.error.message };
  }
  if (result.status !== 0) {
    return {
      available: false,
      version: null,
      reason: `${circomBin} --version exited with ${result.status}`,
    };
  }
  return {
    available: true,
    version: stripAnsi(`${result.stdout}${result.stderr}`).trim(),
    reason: null,
  };
}

/** Compile one circuit into `outputDirectory`. Never throws on a circom error. */
export function compileCircuit({
  circomBin,
  circuit,
  cwd,
  includePaths,
  outputDirectory,
}) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const args = [];
  for (const includePath of includePaths) {
    args.push("-l", includePath);
  }
  args.push(circuit, "--r1cs", "-o", outputDirectory);

  const result = spawnSync(circomBin, args, { cwd, encoding: "utf8" });
  if (result.error) {
    return {
      circuit,
      compiled: false,
      output: result.error.message,
      stats: null,
    };
  }
  const output = stripAnsi(
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
  ).trim();
  return {
    circuit,
    compiled: result.status === 0,
    output,
    stats: result.status === 0 ? parseCircomStats(result.stdout ?? "") : null,
  };
}

/** Grade results against the allowlist. Both mismatch directions are failures. */
export function evaluateResults(results, allowlist) {
  const allowed = new Map(allowlist.map((entry) => [entry.circuit, entry]));
  const compiled = [];
  const allowlistedFailures = [];
  const unexpectedFailures = [];
  const unexpectedPasses = [];

  for (const result of results) {
    const entry = allowed.get(result.circuit);
    if (result.compiled) {
      compiled.push(result);
      if (entry) unexpectedPasses.push(result);
    } else if (entry) {
      /*
       * Allowlisted on path AND on the error it was allowlisted for. Matching
       * the path alone would swallow a NEW breakage in a circuit that already
       * happened to be listed: a fresh T2011 in a circuit listed for T2008
       * would read as "known broken" and pass the gate. The recorded code has
       * to still be the reason it fails.
       */
      if (entry.code && !stripAnsi(result.output ?? "").includes(`error[${entry.code}]`)) {
        unexpectedFailures.push({
          ...result,
          reason:
            `allowlisted for ${entry.code}, but it now fails for a different reason. ` +
            `Re-check the circuit and update its KNOWN_COMPILE_FAILURES entry.`,
        });
      } else {
        allowlistedFailures.push(result);
      }
    } else {
      unexpectedFailures.push(result);
    }
  }

  const missingAllowlistEntries = allowlist
    .map((entry) => entry.circuit)
    .filter((circuit) => !results.some((result) => result.circuit === circuit));

  return {
    compiled,
    allowlistedFailures,
    unexpectedFailures,
    unexpectedPasses,
    missingAllowlistEntries,
  };
}

const TABLE_HEADER = Object.freeze([
  "Circuit",
  "Result",
  "Non-linear",
  "Linear",
  "Wires",
]);

function renderTable(rows) {
  const widths = TABLE_HEADER.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => String(row[column]).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, column) =>
        column <= 1
          ? String(cell).padEnd(widths[column])
          : String(cell).padStart(widths[column]),
      )
      .join("  ")
      .trimEnd();

  return [
    line(TABLE_HEADER),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ];
}

export function renderReport({
  circomVersion,
  includePaths,
  allowlist,
  results,
  evaluation,
}) {
  const allowed = new Set(allowlist.map((entry) => entry.circuit));
  const lines = [];

  lines.push(`Circuit compilation gate: ${circomVersion}`);
  lines.push(
    `Include paths: ${includePaths.length > 0 ? includePaths.join(", ") : "(none)"}`,
  );
  lines.push("");
  lines.push(
    `Known-broken allowlist, ${allowlist.length} ${
      allowlist.length === 1 ? "entry" : "entries"
    } (may only shrink; scope in ${REMEDIATION_SCOPE_DOC}):`,
  );
  if (allowlist.length === 0) {
    lines.push("  (empty: every circuit is expected to compile)");
  }
  for (const entry of allowlist) {
    lines.push(`  ${entry.circuit}`);
    lines.push(`    ${entry.error}`);
  }
  lines.push("");

  lines.push(
    ...renderTable(
      results.map((result) => [
        result.circuit,
        result.compiled
          ? allowed.has(result.circuit)
            ? "COMPILED (allowlisted)"
            : "compiled"
          : allowed.has(result.circuit)
            ? "failed (allowlisted)"
            : "FAILED",
        result.stats?.nonLinearConstraints ?? "-",
        result.stats?.linearConstraints ?? "-",
        result.stats?.wires ?? "-",
      ]),
    ),
  );
  lines.push("");

  const failures = [
    ...evaluation.unexpectedFailures,
    ...evaluation.allowlistedFailures,
  ].sort((left, right) => left.circuit.localeCompare(right.circuit));

  for (const failure of failures) {
    lines.push(
      `--- circom output: ${failure.circuit} ${
        allowed.has(failure.circuit) ? "(allowlisted)" : "(NOT allowlisted)"
      }`,
    );
    lines.push(failure.output === "" ? "(no output)" : failure.output);
    lines.push("");
  }

  lines.push(
    `${results.length} circuits: ${evaluation.compiled.length} compiled, ` +
      `${evaluation.allowlistedFailures.length} allowlisted failures, ` +
      `${evaluation.unexpectedFailures.length} unexpected failures, ` +
      `${evaluation.unexpectedPasses.length} stale allowlist entries.`,
  );

  for (const failure of evaluation.unexpectedFailures) {
    lines.push(
      failure.reason
        ? `FAIL ${failure.circuit} ${failure.reason}`
        : `FAIL ${failure.circuit} does not compile and is not on the allowlist. Fix the circuit rather than adding it to the list.`,
    );
  }
  for (const pass of evaluation.unexpectedPasses) {
    lines.push(
      `FAIL ${pass.circuit} now compiles but is still on the known-broken allowlist. Delete its KNOWN_COMPILE_FAILURES entry in scripts/check-circuit-compilation.mjs.`,
    );
  }
  for (const circuit of evaluation.missingAllowlistEntries) {
    lines.push(
      `FAIL ${circuit} is on the known-broken allowlist but no such circuit was discovered. Delete or correct its entry.`,
    );
  }

  if (
    evaluation.unexpectedFailures.length === 0 &&
    evaluation.unexpectedPasses.length === 0 &&
    evaluation.missingAllowlistEntries.length === 0
  ) {
    lines.push(
      allowlist.length === 0
        ? "PASS every circuit compiles and the allowlist is empty."
        : "PASS the compilable circuits compile and the known-broken set is unchanged.",
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Compile every discovered circuit and grade the run against `allowlist`.
 * Returns an exit code and a report rather than exiting, so it stays testable.
 */
export function runCircuitCompilationCheck({
  rootDirectory = REPO_ROOT,
  circuitsRoot = path.join(rootDirectory, CIRCUITS_DIRECTORY),
  allowlist = KNOWN_COMPILE_FAILURES,
  circomBin = process.env.CIRCOM_BIN || "circom",
  includePaths,
} = {}) {
  const circom = detectCircomVersion(circomBin);
  if (!circom.available) {
    return {
      exitCode: EXIT_TOOLCHAIN_MISSING,
      report:
        `Circuit compilation gate did not run: circom is unavailable (${circom.reason}).\n` +
        `${CIRCOM_INSTALL_INSTRUCTION}\n`,
      results: [],
    };
  }

  let resolvedIncludePaths = includePaths;
  if (resolvedIncludePaths === undefined) {
    try {
      resolvedIncludePaths = [resolveCircomlibIncludeRoot(rootDirectory)];
    } catch (error) {
      return {
        exitCode: EXIT_TOOLCHAIN_MISSING,
        report:
          `Circuit compilation gate did not run: circomlib is not installed (${
            error instanceof Error ? error.message : String(error)
          }).\n` + "run npm ci\n",
        results: [],
      };
    }
  }

  // Compile from the repository root with root-relative paths, so circom's
  // own diagnostics quote the same paths a reader would use to open the file.
  const prefix = path
    .relative(rootDirectory, circuitsRoot)
    .split(path.sep)
    .filter(Boolean)
    .join("/");
  const circuits = discoverCircuits(circuitsRoot).map((circuit) =>
    prefix ? `${prefix}/${circuit}` : circuit,
  );

  const workRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "circuit-compile-gate-"),
  );
  let results;
  try {
    results = circuits.map((circuit, index) =>
      compileCircuit({
        circomBin,
        circuit,
        cwd: rootDirectory,
        includePaths: resolvedIncludePaths,
        outputDirectory: path.join(workRoot, String(index)),
      }),
    );
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }

  const evaluation = evaluateResults(results, allowlist);
  const report = renderReport({
    circomVersion: circom.version,
    includePaths: resolvedIncludePaths,
    allowlist,
    results,
    evaluation,
  });

  const gateFailed =
    evaluation.unexpectedFailures.length > 0 ||
    evaluation.unexpectedPasses.length > 0 ||
    evaluation.missingAllowlistEntries.length > 0;

  return {
    exitCode: gateFailed ? EXIT_GATE_FAILED : EXIT_OK,
    report,
    results,
    evaluation,
  };
}

export function main() {
  const { exitCode, report } = runCircuitCompilationCheck();
  if (exitCode === EXIT_OK) {
    process.stdout.write(report);
  } else {
    process.stderr.write(report);
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main();
}
