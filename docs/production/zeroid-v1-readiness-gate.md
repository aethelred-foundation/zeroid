# ZeroID v1 Production Readiness Gate

The target hero workflow is DID holder -> provider-backed KYC credential -> eligibility proof -> durable evidence receipt. The repository currently fails closed before eligibility proof issuance; it must not be described as a live proof service.

## Release modes

- `npm run readiness:check` validates repository controls, source manifests, required documents, and configured CI gates. Passing it does not activate eligibility issuance or establish production readiness.
- `npm run readiness:production` additionally requires a Playwright configuration scoped to a dedicated `e2e/` or `tests/e2e/` suite, at least one E2E specification, pinned circuit artifacts, and removal of the explicit signed-witness prover block. Passing it is necessary, but the workflow acceptance criteria below must also be evidenced in the target environment.

## Mandatory technical gates

- Frontend: `npm run type-check`, `npm run test:ci`, `npm run build`.
- Backend: `npm --prefix backend run type-check`, `npm --prefix backend test`, `npm --prefix backend run build`.
- E2E: `npm run test:e2e` against an explicitly scoped Playwright suite; a package script by itself is not test evidence.
- Circuits: `npm run circuits:validate`; production also requires an audited ceremony, `npm run circuits:eligibility:build`, and `npm run circuits:validate:artifacts`.
- Contracts: `forge test`.
- Security: `npm run security:audit:all`, Rust `cargo audit`, Go `govulncheck`.
- Product scope: every primary route must have a readiness label in `src/lib/product/readiness.ts`.

## Eligibility issuance gate

`POST /api/v1/verification/eligibility-proof` is intentionally unavailable in non-test deployments. Agent and Wallet/Cruzible partner eligibility paths are also unavailable. Do not enable any of them until all of the following are complete:

1. A provider-signed credential is validated and converted into the circuit's private witness without trusting client-mutable profile metadata.
2. The R1CS, WASM, zkey, and verification key are produced from an audited Powers of Tau ceremony, independently reviewed, and pinned by digest.
3. A real Groth16 prover runs and its output is cryptographically verified against the pinned verification key before any decision is returned.
4. The relying party issues a durable, one-time challenge bound to the subject, credential, policy version, audience, and proof context. Agent requests additionally require a durable, one-time agent-operation challenge and agent signature.
5. Challenge consumption, authorization state checks, proof verification result, decision, and sealed audit/evidence records commit atomically. A retry or partial failure must not create reusable or contradictory evidence.

Stored legacy, pending-artifact, or unverified receipts must continue to fail closed. Ceremony instructions are in `docs/zk/eligibility-artifact-ceremony.md`.

## OIDC claim gate

OIDC tokens currently omit `name`, contact, address, and `verified_claims` values. Client-writable identity metadata is not authoritative; only current status-level government/TEE assurance claims may be emitted. Profile/contact claims remain unavailable until provider-returned values are stored in a dedicated encrypted, access-controlled evidence store with provenance, expiry, retention, and deletion controls.

For an environment that previously signed metadata-derived identity claims, plan an OIDC signing-key rotation with a coordinated JWKS overlap/cache window before enabling production relying parties. A fresh environment must still use deploy-time managed signing keys and a documented rotation procedure.
