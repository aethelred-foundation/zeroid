# ZeroID Incident Response Runbook

## Severity Triggers

- Eligibility receipt hash mismatch.
- Circuit manifest or verification key digest mismatch.
- Unauthorized tenant access.
- Suspected credential signing key exposure.
- TEE quote verifier revocation or enclave measurement failure.
- UAE Pass/government OAuth state replay.

## Immediate Actions

1. Freeze affected policy version or integration client.
2. Preserve audit logs, receipt hashes, request ids, and SIEM exports.
3. Rotate affected JWT, webhook, credential, OAuth, or KMS keys.
4. Revoke affected credentials or policy receipts when required.
5. Notify enterprise tenant owners with impacted decision ids and timestamps.

## Recovery Criteria

- Root cause is documented.
- High and critical findings are fixed or formally accepted.
- New regression tests cover the incident path.
- Production readiness gates pass before re-enable.
