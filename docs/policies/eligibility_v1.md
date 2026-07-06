# Eligibility Policy v1

Policy id: `zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1`

Circuit manifest: `circuits/manifest/eligibility_v1.json`

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

## Public Signals

The pinned circuit manifest exposes only:

- `claimsHash`
- `ageThresholdYears`
- `residencyCountryCode`
- `currentTimestamp`
- `policyVersionHash`
- `contextCommitment`

Raw date of birth, nationality, sanctions details, risk tier, revocation nonce, issuer signature, and context witnesses remain private inputs.
