# ZeroID Phase 2 — Conditional Disclosure (Key-Split Escrow) Design

> **Status:** Phase 2a buildable (implemented). On-chain quorum + warrant flow gated on testnet.
> **Date:** 2026-06-28

## 1. Goal

Implement the FATF travel-rule "asymmetric key-split escrow" (consultant Doc 1): high-value cross-border identity paths are disclosable **only** to a warrant-authorised compliance quorum, while the ledger holds zero PII — and a user's erasure request is honoured cryptographically on an immutable chain.

## 2. Mechanism (`src/lib/aethelred/{shamir,disclosure}.ts`)

1. Generate a random AES-256-GCM key; encrypt the disclosure payload.
2. **Shamir-split** the key into `quorumSize` shares (GF(256)), any `threshold` of which reconstruct it; fewer reveal nothing. Shares go to the compliance quorum.
3. Anchor only `commitment = sha256(ciphertext)` on-chain as a Digital Seal (`createDigitalSeal`) — no PII, just an un-linkable nullifier-style pointer.
4. **Reconstitution** (`reconstituteDisclosure`) requires a quorum of `threshold` shares; it verifies the commitment, recovers the key, and decrypts. Insufficient/invalid shares fail closed (AEAD auth).
5. **Key-shred erasure** (`shredShares`): destroying the shares renders the on-chain commitment permanently un-decryptable — satisfying GDPR / ADGM DPR-2021 right-to-be-forgotten on an immutable ledger.

## 3. Integration

- The on-chain quorum authority is ZeroID's existing `ThresholdCredential` contract; the warrant/audit trail and the commitment are anchored via canonical Digital Seals (`x/seal`).
- Portability: uses Web Crypto (`crypto.subtle`) — runs in the browser and Node 20.

## 4. Verified properties (unit tests)

- Threshold reconstruction (any subset of `threshold` shares agrees).
- Sub-threshold reconstitution fails.
- Tampered commitment is detected.
- Key-shred makes the payload permanently unrecoverable.

## 5. Gated (testnet)

On-chain `ThresholdCredential` quorum wiring, the warrant-authorisation flow, and Seal anchoring of the commitment are exercised end-to-end once the testnet is live. The cryptographic core is complete and tested here.
