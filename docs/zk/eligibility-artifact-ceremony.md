# ZeroID Eligibility v1 ZK Artifact Ceremony

This runbook defines the production artifact process for the v1 eligibility policy circuit used by the EDGE, Presight, and TII hero workflow.

## Scope

- Circuit manifest: `circuits/manifest/eligibility_v1.json`
- Circuit source: `circuits/eligibility/eligibility_context_proof.circom`
- Artifact output directory: `build/circuits/eligibility_context_v1/`
- Production startup digest variable: `ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON`

## Required Inputs

- Circom 2.1.x available through `CIRCOM_BIN` or `PATH`.
- `snarkjs` from `node_modules/.bin/snarkjs` or `SNARKJS_BIN`.
- Audited Powers of Tau file supplied as `ELIGIBILITY_PTAU_PATH`, `ZK_PTAU_PATH`, or `PTAU_PATH`.
- Operator-held contribution entropy supplied as `ZEROID_ZKEY_CONTRIBUTION_ENTROPY` or `ZKEY_CONTRIBUTION_ENTROPY`.
- Contributor name supplied as `ZEROID_ZKEY_CONTRIBUTOR_NAME` or `ZKEY_CONTRIBUTOR_NAME`.

The entropy value is secret ceremony material and must not be committed, logged into tickets, or pasted into chat.

## Build Command

```bash
npm run circuits:eligibility:build
```

The command performs:

1. `circom --r1cs --wasm --sym`
2. `snarkjs groth16 setup`
3. `snarkjs zkey contribute`
4. `snarkjs zkey verify`
5. `snarkjs zkey export verificationkey`
6. SHA-256 digest generation for manifest, source, R1CS, SYM, WASM, zkey, and verification key

## Expected Outputs

- `build/circuits/eligibility_context_v1/eligibility_context_proof.r1cs`
- `build/circuits/eligibility_context_v1/eligibility_context_proof.sym`
- `build/circuits/eligibility_context_v1/eligibility_context_proof_js/eligibility_context_proof.wasm`
- `build/circuits/eligibility_context_v1/eligibility_context_proof_final.zkey`
- `build/circuits/eligibility_context_v1/verification_key.json`
- `build/circuits/eligibility_context_v1/artifact-digests.json`
- `build/circuits/eligibility_context_v1/ceremony-log.json`

## Release Validation

After the build:

```bash
npm run circuits:validate:artifacts
npm run readiness:production
```

`artifact-digests.json` contains the exact `ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON` payload required by backend production startup checks. The release owner must pin that JSON in the production secret manager and preserve the generated `ceremony-log.json` with the release evidence bundle.

## Acceptance Criteria

- `verification_key.json` has `nPublic` equal to the manifest public signal count.
- `npm run circuits:validate:artifacts` passes locally and in CI.
- `npm run readiness:production` passes with `ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON` configured.
- External reviewers receive the manifest, source, verification key, digest report, ceremony log, and the exact Powers of Tau provenance.

## Current Local Status

This repository currently contains the source and manifest. Live production remains blocked until the artifact command is run with the approved toolchain and audited Powers of Tau file, and the resulting digest manifest is pinned.
