import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  circuitArtifactDigestKeys,
  parseExpectedCircuitArtifactDigests,
  validateCircuitArtifacts,
} from '../src/services/circuit-artifacts';

function writeFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createCircuitFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroid-circuits-'));
  writeFile(root, 'scripts/validate-circuit-artifacts.mjs', '// marker');
  writeFile(
    root,
    'circuits/age/age_context_proof.circom',
    'pragma circom 2.1.6;\ncomponent main {public [claimsHash, ageThresholdYears, contextCommitment]} = AgeContextProof();\n',
  );
  return root;
}

function writeArtifacts(root: string): Record<string, string> {
  const files: Record<string, string> = {
    'age_verification_context_v2.r1cs': 'r1cs-bytes',
    'age_verification_context_v2.sym': 'sym-bytes',
    'age_verification_context_v2.wasm': 'wasm-bytes',
    'age_verification_context_v2.zkey': 'zkey-bytes',
    'age_verification_context_v2.vkey': JSON.stringify({ nPublic: 3 }),
  };

  writeFile(root, 'build/circuits/age_context_v2/age_context_proof.r1cs', files['age_verification_context_v2.r1cs']);
  writeFile(root, 'build/circuits/age_context_v2/age_context_proof.sym', files['age_verification_context_v2.sym']);
  writeFile(
    root,
    'build/circuits/age_context_v2/age_context_proof_js/age_context_proof.wasm',
    files['age_verification_context_v2.wasm'],
  );
  writeFile(root, 'build/circuits/age_context_v2/age_context_proof_final.zkey', files['age_verification_context_v2.zkey']);
  writeFile(root, 'build/circuits/age_context_v2/verification_key.json', files['age_verification_context_v2.vkey']);

  return {
    'age_verification_context_v2.source': sha256(
      'pragma circom 2.1.6;\ncomponent main {public [claimsHash, ageThresholdYears, contextCommitment]} = AgeContextProof();\n',
    ),
    ...Object.fromEntries(
      Object.entries(files).map(([key, value]) => [key, sha256(value)]),
    ),
  };
}

describe('circuit artifact validation', () => {
  it('fails closed when production requires missing artifacts', () => {
    const root = createCircuitFixture();

    expect(() =>
      validateCircuitArtifacts({ repoRoot: root, requireArtifacts: true }),
    ).toThrow(/missing artifacts/);
  });

  it('validates artifacts and pinned digests', () => {
    const root = createCircuitFixture();
    const expectedDigests = writeArtifacts(root);

    const report = validateCircuitArtifacts({
      repoRoot: root,
      requireArtifacts: true,
      requireExpectedDigests: true,
      expectedDigests,
    });

    expect(report).toHaveLength(1);
    expect(report[0].artifactsReady).toBe(true);
    expect(Object.keys(report[0].artifacts)).toEqual([
      'r1cs',
      'sym',
      'wasm',
      'zkey',
      'vkey',
    ]);
  });

  it('rejects digest manifest mismatches and malformed digest JSON', () => {
    const root = createCircuitFixture();
    const expectedDigests = writeArtifacts(root);

    expect(() =>
      validateCircuitArtifacts({
        repoRoot: root,
        requireArtifacts: true,
        requireExpectedDigests: true,
        expectedDigests: {
          ...expectedDigests,
          [circuitArtifactDigestKeys()[0]]: '0'.repeat(64),
        },
      }),
    ).toThrow(/digest mismatch/);

    expect(() =>
      parseExpectedCircuitArtifactDigests(JSON.stringify({ bad: 'not-a-digest' })),
    ).toThrow(/Invalid SHA-256 digest/);
  });
});
