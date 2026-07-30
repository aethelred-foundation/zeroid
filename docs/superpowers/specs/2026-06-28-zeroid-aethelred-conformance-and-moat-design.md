# ZeroID × Aethelred — Canonical Conformance & 20× Moat

> **Status:** Design (approved direction, delegated execution)
> **Date:** 2026-06-28
> **Owner:** ZeroID / Aethelred protocol team
> **Related:** `ecosystem/manifest.json` (aethelred), `docs/governance/repo-source-of-truth-matrix.md` (aethelred), `docs/positioning-gap-analysis.md` (zeroid)

---

## 1. Problem & Context

ZeroID and the Aethelred L1 were built without coordination, so ZeroID re-implemented capabilities the protocol already provides natively. ZeroID must (a) **conform** to the canonical Aethelred stack before testnet, and (b) deliver a **world-class, 20× institutional moat** versus identity incumbents (Worldcoin, Civic, Quadrata).

**Canonical Aethelred stack (the single source of truth — `aethelred-foundation/aethelred`):**

- Cosmos SDK v0.50 / CometBFT v0.38 L1 (Go 1.24/1.25), Proof-of-Useful-Work.
- Custom Rust VM (`crates/vm`) with **EVM-compatible** Solidity 0.8.20 contracts.
- On-chain ZK precompiles: **Groth16 + PLONK + EZKL over BN254/BLS12-381** (arkworks).
- **EZKL** zkML prover; verifiable model inference via Freivalds.
- Real **DCAP TEE attestation**, hardware-agnostic across 6 platforms; **Digital Seals** (`x/seal`), `x/vault`.
- Post-quantum crypto: **ML-DSA-65 + ECDSA hybrid signatures, ML-KEM-768**, BLS12-381, HSM.
- Canonical multi-language SDKs (`@aethelred/sdk` TS, plus Py/Go/Rust) governed by `sdk/version-matrix.json` (release train 2026.Q1, OpenAPI v1, REST v1).
- Hub-and-spoke governance: dApps are standalone repos registered in `ecosystem/manifest.json`, pinned by SHA, validated by compatibility CI. Chain IDs **8821** (mainnet) / **88210** (testnet).

**Key correction recorded:** earlier analyses targeted Halo2/Cosmos (consultant docs) and zk-STARK/Rust (a stale `aethelred-core` scaffold). Both were wrong. The canonical proving system is **Groth16/PLONK + EZKL on BN254** — which is the SNARK/BN254 family ZeroID already uses. ZeroID is therefore **already cryptographically aligned**; the work is conformance, not a rewrite.

---

## 2. Goals & Non-Goals

**Goals**
- All ZeroID chain access flows through canonical Aethelred capabilities (SDK + precompiles + Seals + DCAP + PQC).
- Delete ZeroID's parallel re-implementations (bespoke verifier, simulated TEE, hand-rolled chain clients/SDKs).
- ZeroID passes Aethelred ecosystem compatibility CI and is re-pinned in the manifest.
- The 20× moat is delivered by exposing canonical hardware+crypto capabilities as identity features.
- ZeroID keeps running throughout; every increment is independently shippable to testnet.

**Non-Goals**
- Rewriting ZeroID in Go/Rust or as a Cosmos module. dApps stay TS/Solidity.
- Replacing Circom/Groth16/BN254 circuits or the EVM contracts (already canonical-compatible).
- Building bespoke cryptography. We consume the protocol's primitives.
- Tokenomics flywheel ($0.10/burn/Cruzible) in Phase 1 — it is cross-app and scheduled later.

---

## 3. Key Decisions (with rationale)

- **D1 — Strangler-fig conformance boundary.** Introduce one internal module `src/lib/aethelred/` wrapping `@aethelred/sdk`. All chain/ZK/TEE/Seal/signing access routes through it. Migrate subsystems behind it one at a time, deleting bespoke code as each lands. *Why:* safe, reviewable, testnet-shippable increments; the boundary becomes the reusable conformance template for Cruzible/TerraQura/NoblePay/Shiora — directly fixing the root coordination problem.
- **D2 — Conformance is the moat path.** Inherit DCAP/EZKL/PQC/Seals from the protocol rather than rebuilding. *Why:* protocol-native hardware+crypto is the defensible moat; bespoke copies are weaker and unmaintainable.
- **D3 — Keep Circom/Groth16/BN254 + Solidity/EVM.** They already match the chain's verifier precompile and VM. *Why:* zero benefit to churning compatible code.
- **D4 — Proving lanes:** Groth16/PLONK for general ZK (attribute/credential proofs), **EZKL** for zkML (liveness). Not Halo2-first, not STARK. *Why:* matches the chain's precompile set.
- **D5 — SDK dependency resolution.** `@aethelred/sdk` is currently unpublished (`version-matrix.json: published:false`). ZeroID will consume it via a pinned git/workspace dependency until published, tracked against the version matrix. *Why:* unblock conformance now without waiting on a registry release.
- **D6 — PQC-hybrid on-chain identity.** On-chain identity binding, attestation, and tx signing adopt **ML-DSA-65 + ECDSA hybrid** via the SDK crypto/tx modules. App-session JWT may remain off-chain. *Why:* quantum-resistant sovereign identity is a core moat pillar and a protocol requirement.
- **D7 — Conditional disclosure via Digital Seals + threshold quorum.** FATF Travel-Rule conditional disclosure is implemented as a chain-anchored `x/seal` Digital Seal plus ZeroID's existing `ThresholdCredential`/`SelectiveDisclosure` for the multi-sig compliance quorum, not a bespoke escrow. *Why:* reuses protocol evidence + existing primitives; auditable, warrant-based.

---

## 4. Target Architecture

```
ZeroID app (Next.js / Express / Solidity-EVM — unchanged shells)
        │  (all chain access — the ONLY seam)
        ▼
  src/lib/aethelred/   ← conformance boundary (wraps @aethelred/sdk)
   ├─ client      (chain client, chain-id 8821/88210, RPC)
   ├─ zk          (verifyZKProof → Groth16/PLONK/EZKL precompile)
   ├─ seals       (createSeal / verifySeal — Digital Seal evidence)
   ├─ attestation (verifyTEEAttestation — DCAP, 6 platforms)
   ├─ crypto/tx   (ML-DSA-65 + ECDSA hybrid signing)
   └─ react       (re-export @aethelred/sdk/react hooks)
        │
        ▼
  Aethelred L1: ZK precompiles · x/seal · x/verify · x/vault · DCAP workers · PQC
```

Everything chain-facing in ZeroID (`src/lib/{zk,tee,crypto}`, backend `services/tee.ts`, bespoke hooks) collapses onto this single boundary, then the parallel code is removed.

---

## 5. The 20× Moat — delivered on canonical rails

| Consultant moat pillar | Canonical Aethelred capability | ZeroID feature on the rail |
|---|---|---|
| Hardware isolation (TEE) | DCAP attestation, 6 platforms, `x/vault` | Identity onboarding inside attested enclaves; raw PII never leaves hardware |
| Verifiable AI (zkML) | EZKL prover + ZK precompile | Liveness/anti-deepfake as an **EZKL zkML proof** verified on-chain |
| Zero-PII / right-to-be-forgotten | `x/seal` + nullifiers + `x/verify` | Only un-linkable nullifiers + Seal hashes on-chain; key-shred erasure |
| Conditional jurisdictional disclosure (FATF) | Digital Seals + threshold quorum | Warrant-based reconstitution via `ThresholdCredential` over a Seal |
| Quantum-resistant sovereign identity | ML-DSA-65 + ECDSA hybrid, ML-KEM-768 | PQC-hybrid DID keys + attestation signing |
| Continuous verification | PoUW jobs + attestation | Periodic re-attestation jobs anchored as Seals |

The moat is **structural**: it requires owning an L1 that ships DCAP + EZKL + PQC + Seals. Incumbents cannot replicate without re-architecting their entire base layer.

---

## 6. Workstreams (units, interfaces, boundaries)

- **W1 — Conformance boundary** (`src/lib/aethelred/`): the wrapper + typed interface; chain-id reconciliation to 8821/88210; `@aethelred/sdk` dependency wired (D5).
- **W2 — ZK verification:** route verification to SDK `verifyZKProof`/precompile; keep circuits + proving; retire snarkjs runtime-verify + bespoke `ZKCredentialVerifier.sol` path. Equivalence-tested against the old path.
- **W3 — TEE + Digital Seals:** replace simulated `crates/zeroid-tee` + `lib/tee/attestation.ts` + `backend/services/tee.ts` with SDK `verifyTEEAttestation` + `seals.*`. `zeroid-tee` demoted to a local-dev mock behind the boundary, or deleted.
- **W4 — Signing / PQC:** on-chain identity/attestation signing → SDK crypto/tx ML-DSA-65+ECDSA hybrid (D6).
- **W5 — SDK & hooks:** adopt `@aethelred/sdk/react`; deprecate ZeroID's own `sdk/go` + `sdk/python` (thin-wrap canonical or remove).
- **W6 — Ecosystem/repo conformance:** version-matrix alignment (OpenAPI v1, release train 2026.Q1), manifest pin refresh, compatibility CI workflow, lockfile/build-command conventions.
- **W7 (moat) — EZKL zkML liveness:** move the biometric Hamming circuit onto the EZKL zkML lane; verify via precompile.
- **W8 (moat) — Conditional disclosure:** Travel-Rule key-split reconstitution via Seals + threshold quorum (D7); key-shred erasure flow.
- **W9 (cross-app, later) — Tokenomics flywheel:** metered lookup fee → burn / Cruzible yield; requires Cruzible + protocol coordination.

---

## 7. Phasing & Testnet Gate

- **Phase 1 — Conformance (pre-testnet, foundation):** W1 → W2 → W3 → W4 → W5 → W6. Each increment shippable. **Testnet gate:** ZeroID green on Aethelred compatibility CI; all chain access via the boundary; bespoke verifier/TEE/SDK removed.
- **Phase 2 — Moat features:** W7 (EZKL liveness), W8 (conditional disclosure), PQC identity hardening.
- **Phase 3 — Cross-app & economics:** W9 tokenomics; extend the `src/lib/aethelred/` template to the other four dApps to lock in standardization.

---

## 8. Testing Strategy

- TDD throughout (failing test → implement → pass).
- **Equivalence tests** for W2/W3: canonical path must produce identical accept/reject decisions to the bespoke path on a fixture corpus before the bespoke path is deleted (selective dual-run per Approach C, scoped to verification).
- **Contract tests** against `sdk/spec/openapi.yaml` (v1) for every SDK surface ZeroID consumes.
- **Compatibility CI** against the protocol at the pinned SHA.
- No regression to the running app: existing ZeroID unit/integration/E2E suites stay green per increment.

---

## 9. Risks & Mitigations

- **`@aethelred/sdk` unpublished** → pin via git/workspace dep (D5); track version matrix; raise publication as a protocol task.
- **Precompile / Seal / verify interfaces may evolve** → isolate them entirely behind `src/lib/aethelred/`; pin protocol SHA in CI.
- **DCAP / PQC signer availability for local testing** → boundary exposes a dev-mock; equivalence tests run in CI where infra exists.
- **Breaking the live app mid-migration** → strangler-fig + per-increment green suites + feature-flagged cutover for verification paths.
- **Scope creep into a rewrite** → Non-Goals are binding; Circom/Groth16 + Solidity stay.

---

## 10. Success Criteria

1. ZeroID consumes only canonical capabilities for chain/ZK/TEE/Seal/signing; no parallel implementations remain.
2. ZeroID passes Aethelred ecosystem compatibility CI and is re-pinned in `ecosystem/manifest.json`.
3. The six moat pillars (Section 5) are live on canonical rails on testnet.
4. `src/lib/aethelred/` is documented as the reusable dApp conformance template for the other four apps.
