# ZeroID Positioning Gap Analysis

Build-state assessment of ZeroID against the consultant "Sovereign Trust Network" (STN) positioning, with a prioritised plan to close the gaps ahead of the Abu Dhabi Finance Week (ADFW) 2027 Token Generation Event.

> Sources: the three consultant documents — Strategic Positioning Report (STN moat, regulatory shield, tokenomics), the zkML Compilation Pipeline spec (PyTorch → ONNX → EZKL/Halo2), and the Aethelred On-Chain Verifier spec (Cosmos-SDK Go + Rust FFI, Halo2/BN254). Build state verified against this repository on the date of writing.

---

## 1. Executive Summary

ZeroID today is a strong, genuinely-built **self-sovereign identity (SSI) + compliance** platform: W3C DIDs, verifiable credentials, BBS+ selective disclosure, 9 Circom/Groth16 attribute circuits, a multi-jurisdiction compliance engine with OFAC screening, a software TEE-attestation crate, and Go/Python SDKs.

The consultants, however, define the "20× moat" around three things that are **not yet built**:

1. **Verifiable AI (zkML)** — a real liveness CNN compiled into a zk circuit (the centrepiece of the pitch).
2. **A native L1 verifier** — a Cosmos-SDK Go module + Rust FFI, not an EVM Solidity contract.
3. **An economic flywheel** — metered B2B lookups in AETHEL with a burn / Cruzible-yield split.

Net: the identity and compliance foundation is real and defensible; the differentiators that justify the institutional valuation narrative are the open work.

**Strategic decision (recorded):** adopt a **Halo2 / EZKL proving track alongside the existing Circom/Groth16 stack** — Groth16 attribute circuits stay; zkML and the native verifier are built on Halo2.

---

## 2. Coverage Matrix

Legend: **Built** (production-shaped, may need hardening) · **Partial** (stub or shallow form exists) · **Missing** (not present).

| # | Capability (consultant pillar) | Status | Coverage | Evidence in repo |
|---|--------------------------------|--------|----------|------------------|
| 1 | Self-sovereign identity core (DID/VC/selective disclosure) | Built | ~90% | `contracts/ZeroID.sol`, `BBSPlusCredential.sol`, `SelectiveDisclosure.sol`, `CredentialRegistry.sol` |
| 2 | ZK attribute / credential proofs | Built | ~85% | `circuits/{age,residency,nationality,credit,eligibility,composite}` (Circom 2.1 / Groth16) |
| 3 | Compliance & sanctions engine | Built | ~80% | `contracts/RegulatoryCompliance.sol`, `backend/src/services/compliance/*` |
| 4 | TEE attestation layer | Partial | ~45% | `crates/zeroid-tee/*` (zero-dep software model), `contracts/TEEAttestationRegistry.sol` |
| 5 | Liveness / behavioral biometrics | Partial | ~35% | `src/components/biometrics/LivenessCheck.tsx`, `backend/src/services/ai/{behavioral-biometrics,risk-scoring}.ts`, `circuits/biometric/biometric_match.circom` |
| 6 | zkML verifiable-AI pipeline | Missing | ~0% | none — no `pytorch`/`onnx`/`ezkl`/`halo2`/`plonkish`/`zkml`/`folding` references exist |
| 7 | Native L1 verifier (Cosmos-SDK + Rust FFI) | Missing | ~15% | EVM only: `contracts/ZKCredentialVerifier.sol` + BN254 lib; `sdk/go/credential/verifier.go` is a client helper, not an on-chain keeper |
| 8 | Tokenomics + custody-wallet flywheel | Missing | ~5% | no fee/burn/Cruzible logic in ZeroID contracts (burn/yield grep hits are OpenZeppelin library boilerplate) |

---

## 3. What Is Built (Strengths to Leverage)

- **SSI core** — W3C DIDs, verifiable credentials, BBS+ selective disclosure, threshold credentials, accumulator-based revocation, cross-chain bridge (EVM + Cosmos). These map directly to the consultants' "enterprise binary verification proofs" (is-over-21? / non-sanctioned? yes/no).
- **9 ZK attribute circuits** (Circom 2.1 / Groth16) with a 210k-gas on-chain verification target already met — matching the consultant benchmark figure, albeit for Groth16 attribute proofs rather than zkML.
- **Compliance engine** — `RegulatoryCompliance.sol` (multi-jurisdiction rules, eIDAS 2.0 markers, `TRAVEL_RULE_ROLE`, sanctions Merkle roots), plus backend jurisdiction engine, OFAC screening, data-sovereignty, and a DPIA (`docs/compliance/dpia-v1.md`).
- **TEE layer (software)** — `crates/zeroid-tee` cleanly models attestation, enclave lifecycle, sealed memory, and a node registry; `TEEAttestationRegistry.sol` records quotes on-chain.
- **Enterprise plumbing** — API gateway, OIDC bridge, SLA monitor, webhooks, Go/Python SDKs, CI readiness gates (`docs/production/zeroid-v1-readiness-gate.md`).

---

## 4. The Gaps (Detail, Evidence, Action)

### GAP 1 — No zkML / verifiable-AI pipeline  *(Missing · highest strategic value)*

The centrepiece of the consultant pitch (Doc 2) does not exist. The `circuits/biometric/biometric_match.circom` circuit is a **Hamming-distance match on a binary feature vector** — classic template matching, not verifiable neural-network inference. There are no references to PyTorch, ONNX, EZKL, Halo2, or proof folding anywhere in the project.

- **Action:** build a zkML liveness proof-of-concept — one small CNN → ONNX → EZKL → verifiable proof — to convert the claim "we do verifiable AI" into a demonstrable artifact for ADFW. Keep the model deliberately small (see reality-check §5).

### GAP 2 — Proving-system mismatch  *(foundational; prerequisite for GAP 1 and GAP 3)*

The stack is **Circom + Groth16**; the consultant vision assumes **Halo2 / PlonKish**. EZKL (the zkML toolchain), proof folding/accumulation for multi-frame video, and avoiding a per-circuit trusted-setup ceremony all assume a Halo2-family backend.

- **Decision (recorded):** add a Halo2/EZKL track **alongside** Circom. Groth16 attribute circuits remain; new zkML and native-verifier work targets Halo2. This unlocks GAP 1 and GAP 3 with one backend choice.

### GAP 3 — Verifier is EVM Solidity, not the native Cosmos-SDK + Rust verifier  *(Missing · ~15%)*

On-chain verification today is `ZKCredentialVerifier.sol` on EVM (a BN254 library exists; the 210k-gas target matches Doc 3). Doc 3 specifies a **Cosmos-SDK Go module + Rust FFI (`snark-verifier`/`halo2_proofs`) running natively on Aethelred L1**. The only Go "verifier" present (`sdk/go/credential/verifier.go`) is a client-side SDK helper, not an on-chain keeper module.

- **Action:** stand up a Cosmos-SDK x/zkverify module wrapping the Rust verifier (Halo2/BN254, Fiat-Shamir transcript, MSM, Ate pairing per Doc 3). Retain the Solidity verifier as the cross-chain/EVM artifact.

### GAP 4 — TEE is simulated, not real confidential compute  *(Partial · ~45%)*

`crates/zeroid-tee` is explicitly zero-dependency — a software *model* of SGX/SEV/TrustZone. There is no real Intel DCAP quote verification or AMD SEV-SNP attestation-report validation against vendor roots.

- **Action:** integrate genuine remote attestation (DCAP / SEV-SNP) behind the existing `AttestationVerifier` interface so the model becomes a real verifier with a production policy.

### GAP 5 — Liveness is shallow  *(Partial · ~35%)*

`LivenessCheck.tsx` is a camera-UX flow (look straight / turn left / blink); `behavioral-biometrics.ts` and `risk-scoring.ts` are off-chain AI heuristics. There is no *verifiable* (zk) liveness proof and no *continuous/background* checking via a custody wallet — both stressed by the consultants.

- **Action:** depends on GAP 1. Once a zkML liveness proof exists, bind it to the wallet flow and define a periodic (not literally continuous) re-attestation cadence.

### GAP 6 — FATF Travel-Rule key-split escrow + quorum  *(Partial · policy-only)*

`RegulatoryCompliance.sol` enforces the Travel Rule as a role/violation gate (`TRAVEL_RULE_ROLE`, `TravelRuleViolation`). The consultants' **asymmetric key-split escrow reconstituted by a multi-sig compliance quorum under subpoena** is not implemented.

- **Action:** assemble the escrow from existing primitives — `SelectiveDisclosure.sol` + `ThresholdCredential.sol` (threshold signatures) provide the quorum and conditional-disclosure building blocks.

### GAP 7 — No tokenomics / economic flywheel  *(Missing · ~5%)*

No `$0.10` lookup fee, burn address, or Cruzible real-yield split exists in ZeroID's own contracts. This mechanic underpins the ARR / 30–40× valuation narrative.

- **Action:** add a metered-lookup fee contract (fee in AETHEL → 50% burn / 50% Cruzible LST yield), plus B2B usage metering in the enterprise API gateway and custody-wallet / Cruzible cross-app SSO.

---

## 5. Reality Check on Consultant Claims

Build to the *intent*, not the literal figures — several claims are positioning narrative:

- **~2.8s edge zk-proof of a 15M-parameter CNN on an iPhone** is optimistic; real EZKL proofs of CNNs that size are far heavier. Plan for a much smaller liveness model, or route heavy inference to the TEE path.
- **"Continuous background ZKML in a wallet"** is compute/battery-prohibitive; in practice this is periodic or TEE-side.
- **TEE floating-point inference + attestation** is a *different trust model* than zk (trusting Intel/AMD vs. trusting math). Be precise with regulators about which proof backs which claim.

Treat GAPs 1–3 as the genuine moat investment, GAP 7 as essential for the investor story, and GAPs 4–6 as hardening of already-stubbed work.

---

## 6. Prioritised Roadmap

1. **Stand up the Halo2/EZKL track (GAP 2)** — add the toolchain alongside Circom; prove a trivial circuit end-to-end. Unlocks everything below.
2. **zkML liveness PoC (GAP 1)** — small CNN → ONNX → EZKL → verifiable proof; demonstrable for ADFW.
3. **Native L1 verifier (GAP 3)** — Cosmos-SDK module wrapping the Rust Halo2/BN254 verifier; keep Solidity verifier as the EVM artifact.
4. **Tokenomics contract (GAP 7)** — metered lookup fee + burn + Cruzible yield split; makes the ARR story credible.
5. **Harden TEE + Travel-Rule escrow (GAPs 4, 6)** — real DCAP/SEV-SNP attestation; key-split escrow from existing threshold/selective-disclosure contracts.
6. **Wallet-bound continuous liveness (GAP 5)** — once GAP 1 lands, bind the zkML proof to the custody-wallet flow.

---

## 7. Open Questions for the Team

- Which liveness model architecture and size keep edge proving within an acceptable window under EZKL?
- Is the native verifier a new Cosmos-SDK module on Aethelred, or a precompile/host-function, given the L1's current runtime?
- Does the tokenomics contract live in ZeroID or in the Aethelred core protocol (fee routing to the burn address and Cruzible)?
- What is the production TEE attestation policy (allowed measurements, vendor roots, freshness window) for `AttestationVerifier`?
