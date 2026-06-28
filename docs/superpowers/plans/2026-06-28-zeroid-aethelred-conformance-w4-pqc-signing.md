# ZeroID × Aethelred Conformance — W4: PQC Hybrid Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add post-quantum (ML-DSA-65 + ECDSA hybrid) signing for ZeroID's on-chain identity/attestation interactions via the canonical `@aethelred/sdk` PQC provider, with safe fallback to classical ECDSA.

**Architecture:** Strangler-fig. A boundary signer in `src/lib/aethelred/signing.ts` augments ZeroID's existing wallet ECDSA signature with an ML-DSA-65 signature when a PQC backend is configured and the feature flag is on; otherwise returns a classical-only envelope. The heavy PQC primitive comes from the canonical SDK (provider-injection), not a ZeroID re-implementation.

**Tech Stack:** TypeScript, Jest, `@aethelred/sdk/crypto` (PQC provider API).

## Global Constraints

- Canonical PQC: SDK ships the `PQCProvider` interface + orchestration; the ML-DSA backend is **injected** (`configurePQCProvider`), and fails closed if absent. Canonical signature algorithm: `ML-DSA-65` (= Dilithium3; security level 3, paired with ML-KEM-768).
- Protocol prerequisite (done): SDK exports PQC from `./crypto` (aethelred `feat/sdk-export-pqc`).
- All canonical access via `src/lib/aethelred/` only.
- ZeroID does NOT re-implement ECDSA or ML-DSA; the wallet provides ECDSA, the SDK provider provides ML-DSA.
- **Activation gate (W4c):** a real ML-DSA-65 backend (WASM/native) must be injected as the `PQCProvider` in production; until then signing falls back to ECDSA. Do not remove the classical path.

---

### Task 1: PQC hybrid signing boundary adapter

**Files:** Create `src/lib/aethelred/signing.ts`; Test `src/lib/aethelred/__tests__/signing.test.ts`; Modify `src/lib/aethelred/index.ts`.

**Interfaces:**
- Produces: `isPqcSigningEnabled(): boolean`; `signHybrid(message: Uint8Array, classicalSignature: string, pqcSecretKey?: Uint8Array): Promise<HybridSignature>` where `HybridSignature = { scheme: 'hybrid-mldsa65-ecdsa' | 'ecdsa'; classical: string; pqc?: string }`. Re-exports `configurePQCProvider`, `hasConfiguredPQCProvider`, type `PQCProvider` from the SDK.

- [ ] Step 1: Write failing test (hybrid when enabled+provider+key; classical-only when disabled, no provider, or no key).
- [ ] Step 2: Run, verify fail.
- [ ] Step 3: Implement adapter; export from index.
- [ ] Step 4: Run, verify pass + type-check.
- [ ] Step 5: Commit (`feat(aethelred): PQC hybrid signing adapter (ML-DSA-65 + ECDSA)`).

---

## Self-Review

- Spec coverage: spec §6 W4 "ECDSA → ML-DSA-65 + ECDSA hybrid via SDK crypto". W4c activation gated.
- Placeholders: none; backend injection + flag explicit.
- Types: imports the canonical PQC surface from `@aethelred/sdk/crypto`; `HybridSignature` is local and stable.
