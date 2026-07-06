import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
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
  version: string;
  policyId: string;
  circuitId: string;
  circuitName: string;
  verificationKeyId: string;
  publicSignals: string[];
  privateInputsRedacted: string[];
  manifest: CircuitArtifactFileReport;
  source: CircuitArtifactFileReport;
  artifactsReady: boolean;
  artifacts: Record<string, CircuitArtifactFileReport>;
  missingArtifacts?: Array<{ label: string; path: string }>;
}

interface CircuitManifest {
  schema: 'zeroid.circuit_manifest.v1';
  name: string;
  version: string;
  policyId: string;
  circuitId: string;
  circuitName: string;
  verificationKeyId: string;
  source: string;
  publicSignals: string[];
  privateInputsRedacted: string[];
  noPublicOutputs: boolean;
  artifacts: Record<string, string>;
  manifestPath: string;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const CIRCUIT_MANIFEST_DIR = 'circuits/manifest';

export class CircuitArtifactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitArtifactValidationError';
  }
}

export function circuitArtifactDigestKeys(): string[] {
  const repoRoot = findRepoRoot();
  return readCircuitManifests(repoRoot).flatMap((manifest) => [
    digestKey(manifest.name, 'manifest'),
    digestKey(manifest.name, 'source'),
    ...Object.keys(manifest.artifacts).map((label) =>
      digestKey(manifest.name, label),
    ),
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
  const manifests = readCircuitManifests(repoRoot);
  const report: CircuitArtifactReport[] = [];

  for (const manifest of manifests) {
    const manifestFile = validateArtifactFile(
      repoRoot,
      manifest,
      'manifest',
      manifest.manifestPath,
      expectedDigests,
      options,
    );
    const source = validateSource(repoRoot, manifest, expectedDigests, options);
    const entry: CircuitArtifactReport = {
      name: manifest.name,
      version: manifest.version,
      policyId: manifest.policyId,
      circuitId: manifest.circuitId,
      circuitName: manifest.circuitName,
      verificationKeyId: manifest.verificationKeyId,
      publicSignals: manifest.publicSignals,
      privateInputsRedacted: manifest.privateInputsRedacted,
      manifest: manifestFile,
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
      entry.missingArtifacts = missingArtifacts.map(
        ([label, relativePath]) => ({
          label,
          path: relativePath,
        }),
      );
      report.push(entry);
      continue;
    }

    for (const [label, relativePath] of artifactEntries) {
      entry.artifacts[label] =
        label === 'vkey'
          ? validateVerificationKey(
              repoRoot,
              manifest,
              label,
              relativePath,
              expectedDigests,
              options,
            )
          : validateArtifactFile(
              repoRoot,
              manifest,
              label,
              relativePath,
              expectedDigests,
              options,
            );
    }
    entry.artifactsReady = true;
    report.push(entry);
  }

  return report;
}

function readCircuitManifests(repoRoot: string): CircuitManifest[] {
  const manifestRoot = absolute(repoRoot, CIRCUIT_MANIFEST_DIR);
  assert(
    existsSync(manifestRoot),
    `Circuit manifest directory missing at ${CIRCUIT_MANIFEST_DIR}`,
  );

  const manifestFiles = readdirSync(manifestRoot)
    .filter((file) => file.endsWith('.json'))
    .sort();

  assert(
    manifestFiles.length > 0,
    `No circuit manifest JSON files found in ${CIRCUIT_MANIFEST_DIR}`,
  );

  return manifestFiles.map((file) => {
    const manifestPath = path.join(CIRCUIT_MANIFEST_DIR, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        readFileSync(absolute(repoRoot, manifestPath), 'utf8'),
      ) as unknown;
    } catch (error) {
      throw new CircuitArtifactValidationError(
        `${manifestPath}: manifest JSON is invalid: ${(error as Error).message}`,
      );
    }

    return validateManifestShape(manifestPath, parsed);
  });
}

function validateManifestShape(
  manifestPath: string,
  value: unknown,
): CircuitManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: manifest must be a JSON object`,
    );
  }

  const record = value as Record<string, unknown>;
  const requiredStringFields = [
    'name',
    'version',
    'policyId',
    'circuitId',
    'circuitName',
    'verificationKeyId',
    'source',
  ];

  for (const field of requiredStringFields) {
    if (
      typeof record[field] !== 'string' ||
      record[field].trim().length === 0
    ) {
      throw new CircuitArtifactValidationError(
        `${manifestPath}: ${field} must be a non-empty string`,
      );
    }
  }

  if (record.schema !== 'zeroid.circuit_manifest.v1') {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: unsupported schema ${String(record.schema)}`,
    );
  }

  if (!isStringArray(record.publicSignals) || record.publicSignals.length < 2) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: publicSignals must be a non-empty string array`,
    );
  }

  if (
    record.publicSignals[0] !== 'claimsHash' ||
    record.publicSignals[record.publicSignals.length - 1] !==
      'contextCommitment'
  ) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: context-bound public signals must start with claimsHash and end with contextCommitment`,
    );
  }

  if (!isStringArray(record.privateInputsRedacted)) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: privateInputsRedacted must be a string array`,
    );
  }

  if (
    !record.artifacts ||
    typeof record.artifacts !== 'object' ||
    Array.isArray(record.artifacts)
  ) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: artifacts must be a JSON object`,
    );
  }

  const artifacts = record.artifacts as Record<string, unknown>;
  if (
    Object.keys(artifacts).length === 0 ||
    Object.values(artifacts).some((artifact) => typeof artifact !== 'string')
  ) {
    throw new CircuitArtifactValidationError(
      `${manifestPath}: artifacts must map labels to relative paths`,
    );
  }

  return {
    schema: 'zeroid.circuit_manifest.v1',
    name: record.name as string,
    version: record.version as string,
    policyId: record.policyId as string,
    circuitId: record.circuitId as string,
    circuitName: record.circuitName as string,
    verificationKeyId: record.verificationKeyId as string,
    source: record.source as string,
    publicSignals: [...record.publicSignals],
    privateInputsRedacted: [...record.privateInputsRedacted],
    noPublicOutputs: record.noPublicOutputs === true,
    artifacts: artifacts as Record<string, string>,
    manifestPath,
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function validateSource(
  repoRoot: string,
  manifest: CircuitManifest,
  expectedDigests: Record<string, string>,
  options: CircuitArtifactValidationOptions,
): CircuitArtifactFileReport {
  const sourcePath = absolute(repoRoot, manifest.source);
  assert(
    existsSync(sourcePath),
    `${manifest.name}: source missing at ${manifest.source}`,
  );

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
    parsed = JSON.parse(
      readFileSync(absolute(repoRoot, relativePath), 'utf8'),
    ) as {
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
  assert(
    existsSync(artifactPath),
    `${manifest.name}: ${label} artifact missing at ${relativePath}`,
  );

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
      existsSync(
        path.join(current, 'scripts', 'validate-circuit-artifacts.mjs'),
      ) &&
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
      existsSync(
        path.join(current, 'scripts', 'validate-circuit-artifacts.mjs'),
      ) &&
      existsSync(path.join(current, 'circuits'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new CircuitArtifactValidationError(
    'Unable to locate ZeroID repository root',
  );
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
