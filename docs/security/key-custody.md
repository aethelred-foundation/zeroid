# ZeroID Key Custody

Production ZeroID deployments must not store signing, encryption, OAuth, or TEE attestation secrets in browser storage or committed files.

## Custody Requirements

- API JWT signing uses asymmetric keys with a stable key id.
- Credential signing uses KMS/HSM providers only in production: AWS KMS, GCP KMS, or Azure KMS.
- Webhook signing secrets, policy receipt signing secrets, and enterprise secret peppers must meet configured minimum entropy gates in `backend/src/services/production-safety.ts`.
- Browser clients may hold only short-lived bearer tokens in memory; refresh/session continuity belongs in the backend/BFF layer.
- Rotation must include key id rollout, dual-verification window, revocation plan, and audit event.

## Production Gate

`collectProductionSafetyViolations()` blocks startup when local signing bypasses, weak secrets, missing KMS configuration, or missing digest pins are detected.
