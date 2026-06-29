# ZeroID — 90-Day Ecosystem Plan & Integration Contracts

> Operationalises the consultant's 90-day plan: make ZeroID the **identity spine + AI agents' passport** of Aethelred, tightly bound to Cruzible (staking) and the Wallet (custody). Status flags: **[done]** built+tested here · **[gated]** needs live testnet / other repos / infra · **[decide]** product/legal decision.

## Phase 1 (Days 0–30) — Testnet activation & evidence

| Item | Status | Note |
|---|---|---|
| W2c — canonical ZK verification live | [gated] | needs testnet node; confirm snarkjs→arkworks byte format vs a known proof, register vkeys, flip `NEXT_PUBLIC_CANONICAL_VERIFY`/`_VKEYS`. Boundary + adapter already built. |
| W3c — DCAP attestation live | [gated] | needs ≥1 TEE worker exposing raw quotes/PCRs; wire into `attestation.ts`. Adapter built. |
| W4c — PQC signing live | [gated] | inject real ML-DSA-65 provider via `configurePQCProvider`; choose ops (VC issuance, agent creds, Digital Seals). Adapter built. |
| Phase 2b — zkML liveness | [gated] | train small (<15M-param) liveness CNN → ONNX → EZKL circuit/keys → register on-chain; bind to DCAP. Verification lane built. |
| Deploy `ConditionalDisclosure.sol` + `FeeRouter.sol` | [gated] | deploy to testnet, assign roles, set sinks; wire addresses into clients. Contracts built+tested. |
| Testnet evidence pack | [gated] | CI logs (2,367 + AI tests), contract addresses, sample Digital Seals, circuit manifests/hashes, DCAP reports. |

## Phase 2 (Days 30–60) — Integration: ZeroID as the identity spine

### Economic flywheel — **[done] (mechanism)**
`contracts/FeeRouter.sol` (7 Foundry tests): per-operation fee → configurable burn share to protocol burn sink + remainder to Cruzible sink, with `FeeRouted` accounting events. **Deploy-time integration:** set `burnSink` (protocol burn address) + `cruzibleSink` (Cruzible staking pool). **[decide]** exact per-op price ($0.10 equiv) and whether the fee policy sits at protocol or ZeroID-app level.

### Integration 1 — Wallet (custody) ↔ ZeroID
ZeroID-side contract (reuses existing eligibility + conditional-disclosure orchestrators):
- `POST /api/v1/partners/wallet/eligibility` → eligibility decision for an account owner (wraps the human `eligibilityProofHandler`). **[buildable]**
- `POST /api/v1/partners/wallet/disclosure` → orchestrate conditional disclosure under `warrantHash` (wraps `discloseIdentityPath` + on-chain quorum). **[buildable]**
- `GET /api/v1/partners/wallet/evidence/:decisionId` → evidence bundle (Digital Seal). **[buildable]**
- Wallet stores only references (commitments, seal ids, decision ids) — **never raw PII**. **[gated]** (Wallet repo)

### Integration 2 — Cruzible (staking) ↔ ZeroID
- `POST /api/v1/partners/cruzible/pools/:poolId/eligibility` → check staker against the pool's `PolicyDefinition` (accreditation/jurisdiction/sanctions). **[buildable]**
- `POST /api/v1/partners/cruzible/pools/:poolId/agent-scan` → trigger an AI-agent compliance scan (scopes `eligibility.read`/`audit.read`), recording `AgentAction`s + optional Digital Seals. **[buildable]** (reuses AI Agent Passport v1)
- Route a share of pool fees through `FeeRouter`. **[gated]** (Cruzible repo)

### Integration 3 — shared conformance boundary
Replicate `src/lib/aethelred/` (+ the `boundary:check` CI guard) into Cruzible and Wallet so all three share ZK semantics, DCAP, Digital Seals, and PQC key handling. **[gated]** (other repos) — template + README already in ZeroID.

## Phase 3 (Days 60–90) — ADFW-grade packaging

- **Investor pack** [gated on testnet metrics]: ZeroID↔Cruzible↔Wallet↔protocol diagram; fee/burn flow; testnet metrics (eligibility proofs, agent actions, fees routed).
- **Regulator/ADGM pack** [done — foundation]: `docs/compliance/conditional-disclosure-regulatory-memo.md` (FATF/ADGM DPR-2021/GDPR mapping) + AI Agent Passport governance (`docs/policies/agent_identity_v1.md`).
- **ADFW positioning (honest):** "ZeroID is a **testnet-candidate** identity & compliance dApp on Aethelred — fully conformed to protocol primitives, institutional moat features implemented and tested with activation gated on the live testnet for safe rollout, and AI Agent Passport v1 live in Pilot/Preview. In production it sits between Cruzible (staking) and the Wallet (custody) as the eligibility/disclosure/agent-passport spine." Emphasis: *implemented and tested with activation gates* — not "live on mainnet."

## What's built here vs. what needs infra

- **Built + tested now:** conformance boundary (W1–W6), moat features (zkML liveness, conditional disclosure on/off-chain, PQC adapter), AI Agent Passport v1 (backend+frontend), **FeeRouter economic flywheel**, regulatory memo, integration API contract design.
- **Needs the live testnet / TEE-EZKL-PQC infra:** W2c/W3c/W4c/Phase 2b activation; contract deployment; evidence pack.
- **Needs the Cruzible & Wallet repos:** the partner integrations + boundary replication (ZeroID-side endpoints are buildable independently and listed above).
- **Decisions outstanding:** fee price + level (protocol vs app); conditional-disclosure escrow v1 (Shamir) vs v2 (MPC) — see the memo.
