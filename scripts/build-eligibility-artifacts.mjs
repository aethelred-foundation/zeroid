import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const manifestPath =
  process.env.ZEROID_ELIGIBILITY_MANIFEST ??
  'circuits/manifest/eligibility_v1.json';
const outputDir =
  process.env.ZEROID_ELIGIBILITY_BUILD_DIR ??
  'build/circuits/eligibility_context_v1';
const ptauPath =
  process.env.ELIGIBILITY_PTAU_PATH ??
  process.env.ZK_PTAU_PATH ??
  process.env.PTAU_PATH;
const contributionEntropy =
  process.env.ZEROID_ZKEY_CONTRIBUTION_ENTROPY ??
  process.env.ZKEY_CONTRIBUTION_ENTROPY;
const contributorName =
  process.env.ZEROID_ZKEY_CONTRIBUTOR_NAME ??
  process.env.ZKEY_CONTRIBUTOR_NAME ??
  'ZeroID eligibility artifact operator';

const manifest = readJson(manifestPath);
const sourcePath = manifest.source;
const absoluteOutputDir = absolute(outputDir);
const sourceBasename = path.basename(sourcePath, '.circom');
const r1csPath = path.join(outputDir, `${sourceBasename}.r1cs`);
const symPath = path.join(outputDir, `${sourceBasename}.sym`);
const wasmPath = path.join(
  outputDir,
  `${sourceBasename}_js`,
  `${sourceBasename}.wasm`,
);
const initialZkeyPath = path.join(outputDir, `${sourceBasename}_0000.zkey`);
const finalZkeyPath = manifest.artifacts.zkey;
const verificationKeyPath = manifest.artifacts.vkey;
const digestReportPath = path.join(outputDir, 'artifact-digests.json');
const ceremonyLogPath = path.join(outputDir, 'ceremony-log.json');

const circomBin = resolveBinary('CIRCOM_BIN', 'circom');
const snarkjsBin = resolveBinary(
  'SNARKJS_BIN',
  path.join('node_modules', '.bin', 'snarkjs'),
  'snarkjs',
);

assertManifestMatchesExpectedOutput();
assertExecutable(circomBin, ['--version'], 'circom');
assertExecutable(snarkjsBin, ['--version'], 'snarkjs');
assertFileExists(sourcePath, 'eligibility circuit source');
assertFileExists(manifestPath, 'eligibility circuit manifest');

if (!ptauPath) {
  fail(
    'ELIGIBILITY_PTAU_PATH, ZK_PTAU_PATH, or PTAU_PATH must point to the audited Powers of Tau file.',
  );
}
assertFileExists(ptauPath, 'Powers of Tau file');

if (!contributionEntropy || contributionEntropy.trim().length < 32) {
  fail(
    'ZEROID_ZKEY_CONTRIBUTION_ENTROPY or ZKEY_CONTRIBUTION_ENTROPY must contain at least 32 characters for the zkey contribution.',
  );
}

mkdirSync(absoluteOutputDir, { recursive: true });

run(circomBin, [sourcePath, '--r1cs', '--wasm', '--sym', '-o', outputDir]);
run(snarkjsBin, ['groth16', 'setup', r1csPath, ptauPath, initialZkeyPath]);
run(snarkjsBin, [
  'zkey',
  'contribute',
  initialZkeyPath,
  finalZkeyPath,
  '--name',
  contributorName,
  '-e',
  contributionEntropy,
]);
run(snarkjsBin, ['zkey', 'verify', r1csPath, ptauPath, finalZkeyPath]);
run(snarkjsBin, [
  'zkey',
  'export',
  'verificationkey',
  finalZkeyPath,
  verificationKeyPath,
]);

const digestManifest = buildDigestManifest();
const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  manifest: {
    path: manifestPath,
    name: manifest.name,
    version: manifest.version,
    circuitId: manifest.circuitId,
    circuitName: manifest.circuitName,
    verificationKeyId: manifest.verificationKeyId,
  },
  source: sourcePath,
  ptau: {
    path: ptauPath,
    sha256: sha256File(ptauPath),
  },
  artifacts: Object.fromEntries(
    Object.entries(manifest.artifacts).map(([label, relativePath]) => [
      label,
      describeFile(relativePath),
    ]),
  ),
  digestManifest,
  env: {
    ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON: JSON.stringify(digestManifest),
  },
};

writeFileSync(
  absolute(digestReportPath),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
  absolute(ceremonyLogPath),
  `${JSON.stringify(
    {
      schema: 'zeroid.zk_artifact_ceremony_log.v1',
      generatedAt: report.generatedAt,
      contributorName,
      manifestPath,
      sourcePath,
      ptauSha256: report.ptau.sha256,
      verificationKeyId: manifest.verificationKeyId,
      digestManifest,
      commands: [
        'circom --r1cs --wasm --sym',
        'snarkjs groth16 setup',
        'snarkjs zkey contribute',
        'snarkjs zkey verify',
        'snarkjs zkey export verificationkey',
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(JSON.stringify(report, null, 2));

function assertManifestMatchesExpectedOutput() {
  const expectedArtifacts = {
    r1cs: r1csPath,
    sym: symPath,
    wasm: wasmPath,
    zkey: finalZkeyPath,
    vkey: verificationKeyPath,
  };

  for (const [label, expectedPath] of Object.entries(expectedArtifacts)) {
    if (manifest.artifacts?.[label] !== expectedPath) {
      fail(`Manifest artifact path for ${label} must be ${expectedPath}`, {
        actual: manifest.artifacts?.[label],
      });
    }
  }
}

function buildDigestManifest() {
  return {
    [`${manifest.name}.manifest`]: sha256File(manifestPath),
    [`${manifest.name}.source`]: sha256File(sourcePath),
    ...Object.fromEntries(
      Object.entries(manifest.artifacts).map(([label, relativePath]) => [
        `${manifest.name}.${label}`,
        sha256File(relativePath),
      ]),
    ),
  };
}

function describeFile(relativePath) {
  const stat = statSync(absolute(relativePath));
  return {
    path: relativePath,
    bytes: stat.size,
    sha256: sha256File(relativePath),
  };
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(absolute(relativePath), 'utf8'));
  } catch (error) {
    fail(`${relativePath} is not valid JSON`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveBinary(envName, preferredPath, fallbackName = preferredPath) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;

  const preferredAbsolutePath = absolute(preferredPath);
  if (existsSync(preferredAbsolutePath)) return preferredAbsolutePath;

  return fallbackName;
}

function assertExecutable(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error?.code === 'ENOENT') {
    fail(`${label} executable was not found`, {
      command,
      remediation:
        label === 'circom'
          ? 'Install circom 2.1.x and set CIRCOM_BIN if it is not on PATH.'
          : 'Run npm install or set SNARKJS_BIN to a snarkjs executable.',
    });
  }

  if (result.status !== 0) {
    fail(`${label} executable check failed`, {
      command,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    fail(`Command failed to start: ${command}`, {
      reason: result.error.message,
    });
  }

  if (result.status !== 0) {
    fail(`Command failed: ${command} ${redactedArgs(args).join(' ')}`, {
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    });
  }
}

function redactedArgs(args) {
  return args.map((arg, index) => {
    if (args[index - 1] === '-e') return '[redacted-entropy]';
    return arg;
  });
}

function assertFileExists(relativeOrAbsolutePath, label) {
  const filePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : absolute(relativeOrAbsolutePath);
  if (!existsSync(filePath)) {
    fail(`${label} is missing`, { path: relativeOrAbsolutePath });
  }
}

function sha256File(relativeOrAbsolutePath) {
  const filePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : absolute(relativeOrAbsolutePath);
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function absolute(relativePath) {
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.join(repoRoot, relativePath);
}

function fail(error, details = {}) {
  console.error(JSON.stringify({ ok: false, error, ...details }, null, 2));
  process.exit(1);
}
