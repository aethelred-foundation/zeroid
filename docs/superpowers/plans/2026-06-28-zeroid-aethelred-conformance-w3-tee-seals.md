# ZeroID × Aethelred Conformance — W3: TEE → DCAP + Digital Seals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Route ZeroID TEE attestation verification through the canonical chain (DCAP-backed `verifyTEEAttestation`) and add chain-anchored Digital Seals (`x/seal`) via `@aethelred/sdk` — replacing the simulated `crates/zeroid-tee` path.

**Architecture:** Strangler-fig continuation. Boundary adapters in `src/lib/aethelred/` wrap the SDK `VerificationModule.verifyTEEAttestation` and `SealsModule`. The simulated attestation path is retained until activation gates pass (raw DCAP quote availability + live node).

**Tech Stack:** TypeScript, Jest, `@aethelred/sdk` (VerificationModule, SealsModule).

## Global Constraints

- Canonical TEE platform enum (`@aethelred/sdk` TEEPlatform): `INTEL_SGX`, `AMD_SEV`, `AWS_NITRO`, `ARM_TRUSTZONE`, `UNSPECIFIED`. ZeroID numeric enum: Unknown=0, IntelSGX=1, AMDSEV=2, ArmTrustZone=3.
- Canonical attestation input (`@aethelred/sdk` TEEAttestation): `{ platform, quote, enclaveHash, timestamp, pcrValues, nonce? }`. Verified via `verifyTEEAttestation(attestation, expectedEnclaveHash?)`.
- Digital Seal anchors a PoUW `jobId`: `SealsModule.create({ jobId, regulatoryInfo?, expiresInBlocks?, metadata? })`, `.verify(sealId)`, `.get(sealId)`.
- All canonical access via `src/lib/aethelred/` only.
- **Activation gates (not in this plan):** (G1) the TEE worker must surface the raw DCAP `quote` + `pcrValues` (ZeroID's contract-view `TEEAttestation` lacks them); (G2) live-node confirmation. Until both pass, keep the simulated path; do not delete `crates/zeroid-tee` or `src/lib/tee/attestation.ts` verification.

## Staging

- **W3a (this plan):** attestation boundary adapter + platform mapper. Unit-tested.
- **W3b (this plan):** Digital Seals boundary adapter (create/verify/get). Unit-tested.
- **W3c (gated):** wire `verifyAttestation` call sites to prefer canonical once raw quotes are surfaced; anchor identity-issuance evidence as Seals; then retire the simulated path.

---

### Task 1: TEE attestation boundary adapter

**Files:** Create `src/lib/aethelred/attestation.ts`; Test `src/lib/aethelred/__tests__/attestation.test.ts`; Modify `src/lib/aethelred/index.ts`.

**Interfaces:**
- Produces: `mapTeePlatform(zeroidPlatform: number): TEEPlatform`; `verifyTeeAttestationCanonical(attestation: TEEAttestation, expectedEnclaveHash?: string): Promise<VerifyTEEResult>` where `VerifyTEEResult = { valid: boolean; platform: TEEPlatform; enclaveHash?: string; error?: string }`.

- [ ] Step 1: Write failing test (platform mapping for 0..3 + unknown; verify delegates to module and returns result).
- [ ] Step 2: Run, verify fail.
- [ ] Step 3: Implement adapter; export from index.
- [ ] Step 4: Run, verify pass + type-check.
- [ ] Step 5: Commit (`feat(aethelred): TEE attestation boundary adapter (DCAP verify + platform map)`).

### Task 2: Digital Seals boundary adapter

**Files:** Create `src/lib/aethelred/seals.ts`; Test `src/lib/aethelred/__tests__/seals.test.ts`; Modify `src/lib/aethelred/index.ts`.

**Interfaces:**
- Produces: `createDigitalSeal(request: CreateSealRequest): Promise<DigitalSeal>`; `verifyDigitalSeal(sealId: string): Promise<VerifySealResponse>`; `getDigitalSeal(sealId: string): Promise<DigitalSeal>`.

- [ ] Step 1: Write failing test (create/verify/get delegate to SealsModule).
- [ ] Step 2: Run, verify fail.
- [ ] Step 3: Implement adapter; export from index.
- [ ] Step 4: Run, verify pass + type-check.
- [ ] Step 5: Commit (`feat(aethelred): Digital Seals boundary adapter (x/seal)`).

---

## Self-Review

- Spec coverage: spec §6 W3 "simulated TEE → SDK verifyTEEAttestation + seals.*". W3c wiring gated (G1/G2).
- Placeholders: none; activation gates explicit, not guessed.
- Types: canonical inputs/outputs imported from `@aethelred/sdk`; `VerifyTEEResult` mirrors SDK `VerifyTEEResponse`.
