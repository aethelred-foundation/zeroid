# ZeroID Phase 2 — EZKL zkML Liveness Design

> **Status:** Design (Phase 2a buildable now; Phase 2b gated on EZKL toolchain)
> **Date:** 2026-06-28
> **Depends on:** Phase 1 conformance boundary (`src/lib/aethelred/`), canonical EZKL precompile + DCAP attestation + Digital Seals.

## 1. Goal

Deliver the consultant centerpiece — verifiable AI liveness — on the canonical Aethelred EZKL rail: prove a face-liveness inference in zero-knowledge, verify it on-chain, bind it to a hardware (DCAP) attestation, and anchor the result as a Digital Seal. The result is an institutional, un-spoofable liveness claim incumbents cannot replicate without owning the L1.

## 2. Canonical model (from `proto/aethelred/verify/v1/verify.proto`)

- A liveness model is registered as a `Circuit { hash, model_hash, proof_system=EZKL, input_schema, output_schema }`, yielding a `verifying_key_hash`.
- An inference produces a `ZKMLProof { proof_system, proof_bytes, public_inputs, verifying_key_hash, circuit_hash }`.
- On-chain verification returns `VerificationResult { zk_proof_verified, tee_attestation_verified, ... }`.

The liveness public output convention (consultant Doc 2): `publicInputs[0]` carries the "liveness threshold clear" flag (field element `1` = live).

## 3. Phase 2a — buildable now (this increment)

Boundary module `src/lib/aethelred/liveness.ts`:
- `verifyLivenessProof(input)`: verify an EZKL zkML proof via the chain (`proofSystem: EZKL`); `live = zkVerified && publicInputs[0] == 1`.
- `verifyLivenessWithAttestation(input, attestation?, expectedEnclaveHash?)`: combine zkML + DCAP attestation; when an attestation is supplied, `live` requires BOTH (the full moat claim).
- Anchoring uses the existing `createDigitalSeal` (W3) for the audit trail.
- Unit-tested against the mocked verification/attestation modules.

## 4. Phase 2b — gated (EZKL toolchain + model)

The proof-production pipeline, scaffolded as a spec, not runnable here:
1. Liveness CNN (shallow, ZK-friendly: quadratic activations / LUTs) → ONNX export.
2. EZKL: `gen-settings` → `compile-circuit` → `setup` (proving/verifying keys).
3. Register the `Circuit` + `VerifyingKey` on-chain (`x/verify`); record `verifying_key_hash` into `NEXT_PUBLIC_AETHELRED_VKEYS`.
4. Edge proving (Wasm) in the custody wallet; TEE-node fallback for low-power devices.

**Activation gates:** EZKL toolchain availability; a trained liveness model; on-chain circuit registration; live testnet. Until then Phase 2a verification is exercised with fixtures/mocks.

## 5. Non-Goals

- Training the liveness model or shipping EZKL artifacts in this increment.
- Replacing the existing camera `LivenessCheck.tsx` UX (it becomes the capture front-end feeding the proof pipeline later).

## 6. Success Criteria

1. `verifyLivenessProof` / `verifyLivenessWithAttestation` route through the canonical EZKL + DCAP rails via the boundary, unit-tested.
2. A liveness claim can be anchored as a Digital Seal (zk + TEE evidence).
3. Phase 2b pipeline documented with explicit activation gates.
