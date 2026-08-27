# ZeroID — 90-Day Ecosystem Plan and Integration Gates

> This is the current operational plan, not a historical status report. Flags: **[available]** code may be enabled after migrations/configuration and release gates · **[unavailable]** intentionally fails closed · **[gated]** needs external infrastructure or another repository · **[decide]** needs a product/legal decision.

## Phase 1 (Days 0–30) — trusted testnet evidence

| Item | Status | Exit evidence |
| --- | --- | --- |
| Human eligibility proof issuance | [unavailable] | Provider-signed credential witness, audited and pinned Groth16 artifacts, real prover/verifier, durable one-time relying-party challenge, and atomic challenge/decision/evidence persistence. |
| Agent and partner eligibility issuance | [unavailable] | All human-proof evidence above plus durable agent-operation challenges, agent signatures, and atomic agent authorization/audit persistence. |
| Agent identity control plane | [available] | Reviewed Prisma migrations applied; challenge, delegation, approval, suspension, and audit tests pass against the deployment database. |
| OIDC login/status assurance | [available] | Managed signing keys, HTTPS issuer, registered confidential clients, and current government/TEE status evidence. Profile/contact claims remain omitted pending an encrypted provider evidence store. |
| Canonical on-chain ZK verification | [gated] | Known Groth16 vector verified through the target precompile; verification keys registered and client configuration pinned. |
| DCAP, PQC, and zkML activation | [gated] | Real worker/provider/model evidence, registered keys/circuits, and end-to-end verification records. |
| Contract deployment and evidence pack | [gated] | Addresses, roles, sinks, manifests, hashes, CI logs, and operational runbooks captured from the target testnet. |

An environment that previously emitted OIDC identity values from client-mutable metadata should include a coordinated signing-key/JWKS rotation in its deployment plan.

## Phase 2 (Days 30–60) — Wallet and Cruzible integration

### Wallet (custody) <-> ZeroID

- `POST /api/v1/partners/wallet/eligibility` is **[unavailable]** and must return an explicit unavailable error until a one-time relying-party challenge is atomically bound to verified proof evidence.
- `GET /api/v1/partners/wallet/evidence/:decisionId` is **[unavailable]** until it can load a verified, sealed, subject-bound receipt rather than synthesize a bundle.
- `POST /api/v1/partners/wallet/disclosure` is **[unavailable]** until a durable quorum escrow is configured.
- The Wallet should persist only commitments and receipt/seal identifiers, never raw provider PII. Counterpart wiring is **[gated]** on the Wallet repository.

### Cruzible (staking) <-> ZeroID

- `POST /api/v1/partners/cruzible/pools/:poolId/eligibility` is **[unavailable]** under the same proof/challenge gate as Wallet eligibility.
- `POST /api/v1/partners/cruzible/pools/:poolId/agent-scan` is **[unavailable]** until both agent-operation and relying-party challenges, proof verification, and durable evidence commit atomically.
- Fee routing and the counterpart integration remain **[gated]** on reviewed contract deployment and the Cruzible repository.

### Shared conformance boundary

Replicating the reviewed Aethelred boundary and CI guard into Wallet and Cruzible is **[gated]** on those repositories. Shared types or adapters do not by themselves establish cryptographic interoperability; validate with known proofs and deployed contracts.

## Phase 3 (Days 60–90) — release packaging

- Publish testnet metrics only from durable, queryable evidence. Do not count unavailable requests as proofs, decisions, or agent actions.
- Keep regulatory and security documents tied to the deployed control set and recorded operational evidence.
- Position ZeroID as a hardened testnet candidate with agent identity foundations. Do not describe ZK eligibility issuance, partner eligibility, conditional disclosure, DCAP/PQC/zkML activation, or mainnet operation as live until their gates above have closed.

## Outstanding decisions

- Fee price and whether policy lives at protocol or application level.
- Conditional-disclosure escrow design and operator/quorum model.
- OIDC provider-evidence schema, encryption/key custody, retention, deletion, and relying-party claim minimization.
