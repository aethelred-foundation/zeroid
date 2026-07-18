# Golden Enterprise Integration

## OIDC

Enterprise relying parties may use the ZeroID OIDC bridge for login and current status-level government/TEE assurance. ZeroID intentionally omits profile, contact, address, and `verified_claims` values until authoritative provider-returned values are held in an encrypted evidence store. Relying parties must not infer omitted claims from client profile metadata.

Use managed signing keys and a documented rotation procedure. If the environment previously signed metadata-derived identity claims, coordinate a signing-key/JWKS rotation before enabling production clients.

## API

The reserved v1 eligibility endpoint is:

`POST /api/v1/verification/eligibility-proof`

Required request fields:

- `subjectDid`
- `credentialId`
- `policyId`
- `relyingAppId`
- `contextNonce`

It currently fails closed in non-test deployments. Clients must treat its unavailable response as terminal and must not construct a local decision or receipt. Enable it only after a signed credential witness, audited and pinned Groth16 artifacts, a real prover/verifier, a durable one-time relying-party challenge, and atomic proof/decision/evidence persistence are deployed. A future successful response must be schema-validated and cryptographically re-verified before it is trusted.

## Webhooks

Webhook consumers must verify event signatures, enforce tenant-scoped endpoints, and persist decision ids for reconciliation.
