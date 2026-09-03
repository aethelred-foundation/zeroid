# Eligibility Policy v1

Policy id: `zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1`

Circuit manifest: `circuits/manifest/eligibility_v1.json`

## Current availability

This document defines the intended policy contract; it is not evidence that proof issuance is live. The repository contains a source-validated circuit and manifest with production artifacts pending. `POST /api/v1/verification/eligibility-proof` therefore fails closed in non-test deployments, and legacy, pending-artifact, or unverified receipts are not returned as valid evidence.

## Decision Contract

The policy evaluates whether a credential holder is eligible for regulated enterprise data or research access without revealing raw KYC fields to the relying party.

Required checks:

- Minimum age: 21 years.
- Residence: `AE`.
- Nationality: `AE`, `IN`, `US`, `GB`, or `SG`.
- Sanctions screening: `CLEAR`.
- Risk tier: `LOW` or `MEDIUM`.
- Credential status: active, unexpired, and non-revoked.
- TEE evidence: issuer or identity attestation must be present.
- Proof recency: the instant the circuit evaluated the predicates must sit within 300 seconds behind, and 30 seconds ahead of, the verifier's clock.

## Intended public signals

The source manifest declares only:

- `claimsHash`
- `ageThresholdYears`
- `residencyCountryCode`
- `currentTimestamp`
- `policyVersionHash`
- `contextCommitment`

Raw date of birth, nationality, sanctions details, risk tier, revocation nonce, issuer signature, and context witnesses remain private inputs.

`currentTimestamp` is a public *input*: the circuit evaluates the age and expiry predicates at whatever instant the prover supplies. A relying party asking "is eligible now" must therefore pin that instant to its own clock, which is what the recency check above does. Without it, a proof forward-dated towards the credential's expiry would establish only that the holder *would* pass at some later date, and a backdated one only that the credential *had* not yet expired.

## Activation requirements

Issuance remains unavailable until a provider-signed credential witness is integrated, Groth16 artifacts are produced through an audited ceremony and pinned by digest, a real prover and verifier are connected, and a durable one-time relying-party challenge is consumed atomically with the authorization decision and sealed evidence record. Agent-initiated and partner flows additionally require an authenticated, one-time agent-operation challenge where applicable; they may not treat a human bearer session or database credential row as agent proof.
