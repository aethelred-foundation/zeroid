import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireArtifacts = process.argv.includes('--require-artifacts');

const manifests = [
  {
    name: 'age_verification_context_v2',
    source: 'circuits/age/age_context_proof.circom',
    publicSignals: [
      'claimsHash',
      'ageThresholdYears',
      'currentTimestamp',
      'contextCommitment',
    ],
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

function absolute(relativePath) {
  return path.join(repoRoot, relativePath);
}

function sha256File(relativePath) {
  return createHash('sha256')
    .update(readFileSync(absolute(relativePath)))
    .digest('hex');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateSource(manifest) {
  const sourcePath = absolute(manifest.source);
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

  return {
    source: manifest.source,
    sha256: sha256File(manifest.source),
  };
}

function validateArtifactFile(manifest, label, relativePath) {
  const artifactPath = absolute(relativePath);
  assert(
    existsSync(artifactPath),
    `${manifest.name}: ${label} artifact missing at ${relativePath}`,
  );

  const stat = statSync(artifactPath);
  assert(stat.size > 0, `${manifest.name}: ${label} artifact is empty`);

  return {
    path: relativePath,
    bytes: stat.size,
    sha256: sha256File(relativePath),
  };
}

function validateVerificationKey(manifest, relativePath) {
  const artifact = validateArtifactFile(manifest, 'verification key', relativePath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute(relativePath), 'utf8'));
  } catch (error) {
    throw new Error(
      `${manifest.name}: verification key JSON is invalid: ${error.message}`,
    );
  }

  assert(
    Number(parsed.nPublic) === manifest.publicSignals.length,
    `${manifest.name}: verification key nPublic=${parsed.nPublic} does not match schema length ${manifest.publicSignals.length}`,
  );

  return artifact;
}

const report = [];

try {
  for (const manifest of manifests) {
    const entry = {
      name: manifest.name,
      publicSignals: manifest.publicSignals,
      source: validateSource(manifest),
      artifactsReady: false,
      artifacts: {},
    };

    const artifactEntries = Object.entries(manifest.artifacts);
    const missingArtifacts = artifactEntries.filter(
      ([, relativePath]) => !existsSync(absolute(relativePath)),
    );

    if (missingArtifacts.length > 0) {
      if (requireArtifacts) {
        throw new Error(
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
          ? validateVerificationKey(manifest, relativePath)
          : validateArtifactFile(manifest, label, relativePath);
    }
    entry.artifactsReady = true;
    report.push(entry);
  }

  console.log(JSON.stringify({ ok: true, requireArtifacts, circuits: report }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        requireArtifacts,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
