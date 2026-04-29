import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

export interface CircuitArtifactValidationOptions {
  repoRoot?: string;
  requireArtifacts?: boolean;
  requireExpectedDigests?: boolean;
  expectedDigests?: Record<string, string>;
}

export interface CircuitArtifactFileReport {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CircuitArtifactReport {
  name: string;
  publicSignals: string[];
  source: CircuitArtifactFileReport;
  artifactsReady: boolean;
  artifacts: Record<string, CircuitArtifactFileReport>;
  missingArtifacts?: Array<{ label: string; path: string }>;
}

interface CircuitManifest {
  name: string;
  source: string;
  publicSignals: string[];
  noPublicOutputs: boolean;
  artifacts: Record<string, string>;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

const CIRCUIT_MANIFESTS: CircuitManifest[] = [
  {
    name: 'age_verification_context_v2',
    source: 'circuits/age/age_context_proof.circom',
    publicSignals: ['claimsHash', 'ageThresholdYears', 'contextCommitment'],
    noPublicOutputs: true,
    artifacts: {
      r1cs: 'build/circuits/age_context_v2/age_context_proof.r1cs',
      sym: 'build/circuits/age_context_v2/age_context_proof.sym',
      wasm:
        'build/circuits/age_context_v2/age_context_proof_js/age_context_proof.wasm',
      zkey: 'build/circuits/age_context_v2/age_context_proof_final.zkey',
      vkey: 'build/circuits/age_context_v2/verification_key.json',
    },
  },
];

export class CircuitArtifactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitArtifactValidationError';
  }
}

export function circuitArtifactDigestKeys(): string[] {
  return CIRCUIT_MANIFESTS.flatMap((manifest) => [
    digestKey(manifest.name, 'source'),
    ...Object.keys(manifest.artifacts).map((label) => digestKey(manifest.name, label)),
  ]);
}

export function parseExpectedCircuitArtifactDigests(
  rawDigests: string | undefined,
): Record<string, string> {
  const trimmed = rawDigests?.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CircuitArtifactValidationError(
      'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON must be a JSON object',
    );
  }

  const digests = parsed as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(digests).map(([key, value]) => {
      if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
        throw new CircuitArtifactValidationError(
          `Invalid SHA-256 digest for circuit artifact key ${key}`,
        );
      }
      return [key, value.toLowerCase()];
    }),
  );
}

export function validateCircuitArtifacts(
  options: CircuitArtifactValidationOptions = {},
): CircuitArtifactReport[] {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const expectedDigests = options.expectedDigests ?? {};
  const report: CircuitArtifactReport[] = [];

  for (const manifest of CIRCUIT_MANIFESTS) {
    const source = validateSource(repoRoot, manifest, expectedDigests, options);
    const entry: CircuitArtifactReport = {
      name: manifest.name,
      publicSignals: manifest.publicSignals,
      source,
      artifactsReady: false,
      artifacts: {},
    };

    const artifactEntries = Object.entries(manifest.artifacts);
    const missingArtifacts = artifactEntries.filter(
      ([, relativePath]) => !existsSync(absolute(repoRoot, relativePath)),
    );

    if (missingArtifacts.length > 0) {
      if (options.requireArtifacts) {
        throw new CircuitArtifactValidationError(
          `${manifest.name}: missing artifacts: ${missingArtifacts
            .map(([label]) => label)
            .join(', ')}`,
        );
      }
      entry.missingArtifacts = missingArtifacts.map(([label, relativePath]) => ({
        label,
        path: relativePath,
      }));
      report.push(entry);
      continue;
    }

    for (const [label, relativePath] of artifactEntries) {
      entry.artifacts[label] =
        label === 'vkey'
          ? validateVerificationKey(repoRoot, manifest, label, relativePath, expectedDigests, options)
          : validateArtifactFile(repoRoot, manifest, label, relativePath, expectedDigests, options);
    }
    entry.artifactsReady = true;
    report.push(entry);
  }

  return report;
}

function validateSource(
  repoRoot: string,
  manifest: CircuitManifest,
  expectedDigests: Record<string, string>,
  options: CircuitArtifactValidationOptions,
): CircuitArtifactFileReport {
  const sourcePath = absolute(repoRoot, manifest.source);
  assert(existsSync(sourcePath), `${manifest.name}: source missing at ${manifest.source}`);

  const source = readFileSync(sourcePath, 'utf8');
  const expectedPublicDeclaration = `component main {public [${manifest.publicSignals.join(
    ', ',
  )}]}`;

  assert(
    source.includes(expectedPublicDeclaration),
    `${manifest.name}: source public signal declaration must be ${expectedPublicDeclaration}`,
  );

  if (manifest.noPublicOutputs) {
    assert(
      !source.includes('signal output'),
      `${manifest.name}: context-bound verifier expects no public outputs after contextCommitment`,
    );
  }

  return validateArtifactFile(
    repoRoot,
    manifest,
    'source',
    manifest.source,
    expectedDigests,
    options,
  );
}

function validateVerificationKey(
  repoRoot: string,
  manifest: CircuitManifest,
  label: string,
  relativePath: string,
  expectedDigests: Record<string, string>,
  options: CircuitArtifactValidationOptions,
): CircuitArtifactFileReport {
  const artifact = validateArtifactFile(
    repoRoot,
    manifest,
    label,
    relativePath,
    expectedDigests,
    options,
  );
  let parsed: { nPublic?: unknown };
  try {
    parsed = JSON.parse(readFileSync(absolute(repoRoot, relativePath), 'utf8')) as {
      nPublic?: unknown;
    };
  } catch (error) {
    throw new CircuitArtifactValidationError(
      `${manifest.name}: verification key JSON is invalid: ${(error as Error).message}`,
    );
  }

  assert(
    Number(parsed.nPublic) === manifest.publicSignals.length,
    `${manifest.name}: verification key nPublic=${parsed.nPublic} does not match schema length ${manifest.publicSignals.length}`,
  );

  return artifact;
}

function validateArtifactFile(
  repoRoot: string,
  manifest: CircuitManifest,
  label: string,
  relativePath: string,
  expectedDigests: Record<string, string>,
  options: CircuitArtifactValidationOptions,
): CircuitArtifactFileReport {
  const artifactPath = absolute(repoRoot, relativePath);
  assert(existsSync(artifactPath), `${manifest.name}: ${label} artifact missing at ${relativePath}`);

  const stat = statSync(artifactPath);
  assert(stat.size > 0, `${manifest.name}: ${label} artifact is empty`);

  const sha256 = sha256File(artifactPath);
  const key = digestKey(manifest.name, label);
  const expectedDigest = expectedDigests[key];

  if (options.requireExpectedDigests && !expectedDigest) {
    throw new CircuitArtifactValidationError(
      `${manifest.name}: expected digest missing for ${key}`,
    );
  }

  if (expectedDigest && expectedDigest.toLowerCase() !== sha256) {
    throw new CircuitArtifactValidationError(
      `${manifest.name}: ${key} digest mismatch`,
    );
  }

  return {
    path: relativePath,
    bytes: stat.size,
    sha256,
  };
}

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(path.join(current, 'scripts', 'validate-circuit-artifacts.mjs')) &&
      existsSync(path.join(current, 'circuits'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  current = __dirname;
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(path.join(current, 'scripts', 'validate-circuit-artifacts.mjs')) &&
      existsSync(path.join(current, 'circuits'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new CircuitArtifactValidationError('Unable to locate ZeroID repository root');
}

function absolute(repoRoot: string, relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function digestKey(circuitName: string, label: string): string {
  return `${circuitName}.${label}`;
}

function sha256File(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new CircuitArtifactValidationError(message);
  }
}
