# Golden Enterprise Integration

## OIDC

Enterprise relying parties should use the ZeroID OIDC bridge for login and `userinfo` claims that reference eligibility decisions by receipt id rather than raw KYC fields.

## API

The v1 eligibility endpoint is:

`POST /api/v1/verification/eligibility-proof`

Required request fields:

- `subjectDid`
- `credentialId`
- `policyId`
- `relyingAppId`
- `contextNonce`

The response must include `decisionId`, `proof.proofId`, `proof.circuitId`, `proof.verificationKeyId`, `evidence.receiptHash`, `evidence.manifestDigest`, `evidence.policyBindingDigest`, and `evidence.artifactStatus`.

## Webhooks

Webhook consumers must verify event signatures, enforce tenant-scoped endpoints, and persist decision ids for reconciliation.
