# ZeroID Threat Model v1

## Primary Assets

- Holder DID and credential state.
- KYC claims and hashes.
- Eligibility proof receipts.
- ZK proving and verification artifacts.
- TEE attestation evidence.
- Enterprise tenant policies, API keys, OIDC clients, and webhooks.

## Main Threats

- Proof transplant or replay across relying apps.
- Credential ownership bypass between identities or tenants.
- Fake readiness evidence in demo or production mode.
- Browser token persistence after XSS or local compromise.
- ZK artifact drift between policy, verifier, and UI.
- TEE quote acceptance without production verifier policy.
- Tenant data leakage through API keys, webhooks, policy receipts, or reporting.

## Implemented Controls

- Eligibility proof requests bind subject DID, credential id, policy id, relying app id, nonce, context hash, manifest digest, and policy-binding digest.
- Production route execution requires backend mode and production startup safety gates.
- Backend proof route checks authenticated identity ownership before credential use.
- Circuit manifest/source validation is checked by CI; live production requires compiled artifacts and pinned digests.
- Feature readiness labels prevent Preview and Configured surfaces from being presented as Live.
