export interface EligibilityRequestBinding {
  subjectDid: string;
  credentialId: string;
  policyId: string;
  policyVersion: string;
  relyingAppId: string;
  contextHash: `0x${string}`;
}

export function validateBackendEligibilityResult(
  result: unknown,
  binding?: EligibilityRequestBinding,
): string[] {
  const violations: string[] = [];
  const root = asRecord(result);
  const data = asRecord(root?.data);
  const proof = asRecord(data?.proof);
  const evidence = asRecord(data?.evidence);
  const disclosurePolicy = asRecord(proof?.disclosurePolicy);
  const disclosureBudget = asRecord(disclosurePolicy?.disclosureBudget);
  const publicSignals = asRecord(proof?.publicSignals);
  const groth16Proof = asRecord(proof?.groth16Proof);

  if (!data) violations.push('data:required');
  if (data && data.status !== 'ALLOWED' && data.status !== 'DENIED') {
    violations.push('data.status:ALLOWED_OR_DENIED_REQUIRED');
  }
  if (!proof) violations.push('proof:required');
  if (!evidence) violations.push('evidence:required');
  if (proof?.verified !== true) {
    violations.push('proof.verified:true_required');
  }
  if (!isGroth16Proof(groth16Proof)) {
    violations.push('proof.groth16Proof:valid_required');
  }
  if (!isHexHash(evidence?.receiptHash)) {
    violations.push('evidence.receiptHash:sha256_hex_required');
  }
  if (!isHexHash(evidence?.manifestDigest)) {
    violations.push('evidence.manifestDigest:sha256_hex_required');
  }
  if (!isHexHash(evidence?.sourceDigest)) {
    violations.push('evidence.sourceDigest:sha256_hex_required');
  }
  if (!isHexHash(evidence?.policyBindingDigest)) {
    violations.push('evidence.policyBindingDigest:sha256_hex_required');
  }
  if (evidence?.receiptHashAlgorithm !== 'sha256-canonical-json-v1') {
    violations.push('evidence.receiptHashAlgorithm:unsupported');
  }
  if (evidence?.artifactStatus !== 'PINNED_PRODUCTION_ARTIFACTS') {
    violations.push('evidence.artifactStatus:pinned_required');
  }
  if (proof?.manifestDigest !== evidence?.manifestDigest) {
    violations.push('proof.manifestDigest:evidence_mismatch');
  }
  if (proof?.policyBindingDigest !== evidence?.policyBindingDigest) {
    violations.push('proof.policyBindingDigest:evidence_mismatch');
  }
  if (!publicSignals || Object.keys(publicSignals).length === 0) {
    violations.push('proof.publicSignals:non_empty_object_required');
  }
  if (!disclosurePolicy) {
    violations.push('proof.disclosurePolicy:required');
  }

  if (!Array.isArray(disclosurePolicy?.rawFieldsDisclosed)) {
    violations.push('proof.disclosurePolicy.rawFieldsDisclosed:array_required');
  } else if (disclosurePolicy.rawFieldsDisclosed.length > 0) {
    violations.push('proof.disclosurePolicy.rawFieldsDisclosed:must_be_empty');
  }

  if (!Array.isArray(disclosurePolicy?.provedPredicates)) {
    violations.push('proof.disclosurePolicy.provedPredicates:array_required');
  }
  if (!Array.isArray(disclosurePolicy?.privateInputsRedacted)) {
    violations.push(
      'proof.disclosurePolicy.privateInputsRedacted:array_required',
    );
  }

  if (!disclosureBudget) {
    violations.push('proof.disclosurePolicy.disclosureBudget:required');
  }
  if (disclosureBudget?.rawFieldCount !== 0) {
    violations.push(
      'proof.disclosurePolicy.disclosureBudget.rawFieldCount:must_be_zero',
    );
  }
  if (
    publicSignals &&
    disclosureBudget?.publicSignalCount !== Object.keys(publicSignals).length
  ) {
    violations.push(
      'proof.disclosurePolicy.disclosureBudget.publicSignalCount:mismatch',
    );
  }

  if (binding && data) {
    const exactBindings: Array<[string, unknown, string]> = [
      ['subjectDid', data.subjectDid, binding.subjectDid],
      ['credentialId', data.credentialId, binding.credentialId],
      ['policyId', data.policyId, binding.policyId],
      ['policyVersion', data.policyVersion, binding.policyVersion],
      ['relyingAppId', data.relyingAppId, binding.relyingAppId],
      ['proof.contextHash', proof?.contextHash, binding.contextHash],
      [
        'proof.publicSignals.contextCommitment',
        publicSignals?.contextCommitment,
        binding.contextHash,
      ],
    ];
    for (const [field, actual, expected] of exactBindings) {
      if (actual !== expected) {
        violations.push(`${field}:request_mismatch`);
      }
    }
  }

  return violations;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isHexHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
}

function isGroth16Proof(value: Record<string, unknown> | null): boolean {
  return Boolean(
    value &&
    value.protocol === 'groth16' &&
    value.curve === 'bn128' &&
    isStringArray(value.pi_a, 2) &&
    Array.isArray(value.pi_b) &&
    value.pi_b.length >= 2 &&
    value.pi_b.every((row) => isStringArray(row, 2)) &&
    isStringArray(value.pi_c, 2),
  );
}

function isStringArray(value: unknown, minimumLength: number): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}
