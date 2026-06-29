# Conditional Disclosure — Regulatory Mapping Memo

> **Status:** Technical → regulatory mapping for legal review. **Not legal advice.** Prepared to support ADGM/FATF diligence on ZeroID's key-split escrow.
> **Scope:** ZeroID conditional disclosure ("asymmetric key-split escrow") — `shamir.ts`, `disclosure.ts`, `contracts/ConditionalDisclosure.sol`.

## 1. The mechanism (as implemented and tested)

1. A disclosure payload (e.g. a cross-border identity/KYC path) is encrypted with a one-time **AES-256-GCM** key.
2. The key is split with **Shamir t-of-n secret sharing** (GF(256)); shares are distributed to a compliance quorum. Fewer than `t` shares reveal nothing.
3. Only `sha256(ciphertext)` — a **commitment** — plus an un-linkable **nullifier** are written on-chain (`ConditionalDisclosure.sol`). **No PII, and no hash of PII, is on-chain.**
4. Disclosure requires a **warrant-bound, t-of-n compliance-officer quorum** on-chain (`requestDisclosure(warrantHash)` → `approveDisclosure` ×t → authorised). Off-chain, the quorum reconstitutes the key and decrypts; the commitment is verified before decryption.
5. **Key-shred erasure:** destroying the shares makes the ciphertext permanently undecryptable, rendering the on-chain commitment permanently un-linkable.

All five properties are covered by tests (GF(256) reconstruction + sub-threshold failure; AEAD round-trip; commitment-tamper detection; key-shred irrecoverability; 6 Foundry tests for the on-chain quorum/erasure).

## 2. FATF Travel Rule (R.16) mapping

| Requirement | How the design satisfies it |
|---|---|
| Originator/beneficiary information available to obliged entities | The identity path is escrowed and **reconstitutable on demand by an authorised quorum** — information is *available* without being broadcast. |
| Disclosure only to authorised parties | Reconstitution requires **t-of-n** compliance-officer approvals bound to a `warrantHash`; no single party (incl. ZeroID) can disclose unilaterally. |
| Auditability of who disclosed what, when, why | Every `requestDisclosure`/`approveDisclosure`/authorisation is an on-chain event bound to the warrant hash → a tamper-evident audit trail. |
| Minimise exposure of sensitive data in transit/at rest | Payload is AEAD-encrypted; only a ciphertext commitment is persisted on-chain. |

**Net:** conditional, warrant-gated disclosure to an authorised quorum — the Travel Rule's "available to authorities, not exposed to the public" intent, enforced cryptographically rather than by policy alone.

## 3. ADGM DPR 2021 / GDPR mapping

| Requirement | How the design satisfies it |
|---|---|
| Data minimisation | On-chain state = commitment + nullifier only; raw PII never leaves the off-chain encrypted payload. |
| Purpose limitation / lawful access | Decryption is gated on a warrant-bound quorum; access is purpose-bound and recorded. |
| **Right to erasure** (the hard one on an immutable ledger) | **Cryptographic erasure:** destroying the key shares (`shredShares`) makes the ciphertext permanently undecryptable. The immutable on-chain commitment becomes a hash of forever-unreadable data — i.e. permanently un-linkable to any person. Erasure is achieved **without mutating the ledger**, which is otherwise the core tension for identity-on-chain. |
| Integrity / non-repudiation | sha256 commitment + AEAD tag detect tampering; on-chain quorum events are non-repudiable. |
| Cross-border controls | The quorum + warrant model provides a controllable, auditable gate for cross-border reconstitution. |

## 4. Open question for legal — escrow primitive choice

- **v1 (implemented):** Shamir-of-symmetric-key. Simple, audited, tested; the quorum jointly reconstitutes one AES key.
- **Possible v2:** threshold / MPC encryption (e.g. threshold ECIES), where no party ever sees the full key even transiently during reconstitution. Stronger, more complex.

**Recommendation:** keep v1 for the pilot (it already meets the requirements above); commission a v2 design only if ADGM/counsel prefer no-single-point key reconstitution. This memo + the test evidence should support a v1 sign-off.

## 5. Evidence references

- Implementation: `src/lib/aethelred/{shamir,disclosure,disclosure-contract,disclose}.ts`; `contracts/ConditionalDisclosure.sol`.
- Design: `docs/superpowers/specs/2026-06-28-zeroid-conditional-disclosure-design.md`.
- Tests: Shamir + escrow unit tests; `ConditionalDisclosureTest` (6 Foundry tests).
