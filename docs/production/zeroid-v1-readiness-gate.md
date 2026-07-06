# ZeroID v1 Production Readiness Gate

ZeroID v1 is gated around one hero workflow: DID holder -> KYC credential -> UAE Pass/government-backed identity status -> eligibility proof -> durable evidence receipt.

## Release Modes

- Configured pre-production: `npm run readiness:check` must pass. This proves the repository has CI gates, manifest/source validation, consultant-required security/compliance documents, and visible product maturity labels.
- Live production: `npm run readiness:production` must pass. This additionally requires compiled ZK artifacts and pinned SHA-256 digests for the eligibility circuit manifest, source, R1CS, WASM, zkey, and verification key.

## Mandatory Gates

- Frontend: `npm run type-check`, `npm run test:ci`, `npm run build`.
- Backend: `npm --prefix backend run type-check`, `npm --prefix backend test`, `npm --prefix backend run build`.
- Circuits: `npm run circuits:validate`; live production additionally requires `npm run circuits:eligibility:build` with the approved Circom/snarkjs/PTAU toolchain, then `npm run circuits:validate:artifacts`.
- Contracts: `forge test`.
- Security: `npm run security:audit:all`, Rust `cargo audit`, Go `govulncheck`.
- Product scope: every primary route must have a readiness label from `src/lib/product/readiness.ts`.

## Current Status

The v1 hero workflow is configured for enterprise demonstration and backend-backed evidence receipts. It is not Live production until the missing compiled Groth16 artifacts under `build/circuits/eligibility_context_v1/` are generated with `npm run circuits:eligibility:build`, reviewed, pinned in `ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON`, and validated by `npm run readiness:production`.

Artifact ceremony details live in `docs/zk/eligibility-artifact-ceremony.md`.
