# ZeroID DPIA v1

## Processing Purpose

ZeroID processes identity and eligibility evidence to allow regulated relying parties to receive policy decisions without collecting raw KYC data.

## Data Minimisation

The v1 eligibility workflow returns policy status, proof identifiers, public signals, receipt hashes, audit hashes, manifest digests, and redacted private-input names. Raw birth date, document details, sanctions artifacts, revocation nonce, and issuer signature stay outside the relying-party response.

## Retention

Evidence receipts should be retained for enterprise audit obligations. Raw KYC material should follow issuer retention policy and be deletable independently from derived receipt hashes where legally permissible.

## Cross-Border Transfer

Cross-border deployment requires tenant-specific legal review, data residency controls, and authority-specific reporting configuration before Live status.
