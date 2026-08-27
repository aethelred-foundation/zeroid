# SealAttestationRegistry — Security Model & Self-Audit

**Contract:** `contracts/SealAttestationRegistry.sol` (BUSL-1.1, solc 0.8.28, `--via-ir`)
**Status:** implemented, self-audited, test-covered. **Tier-1 external audit is a
mainnet launch gate (not yet done).** Treat this document as the pre-audit security
narrative, not an audit report.

Base: OpenZeppelin `Ownable2Step`, `Pausable`, `ReentrancyGuard`.

---

## 1. Assets and actors

| Asset                                                                                                             | Why it matters                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Consensus-anchored credentials `_attestations[subject][schema]`                                                   | the thing dApps gate on                 |
| `sealUsed[sealId]`                                                                                                | one-credential-per-seal replay guard    |
| CEAP policy (`_allowedBackends`, `_minVerification`, `_allowedPlatforms`, `_requireVendorRoot`, `_dataResidency`) | the admission rule for every credential |
| Ownership (governance)                                                                                            | can set policy, pause, revoke           |

| Actor                     | Capability                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Subject                   | `attest` for self, self-`revoke`                                                    |
| Relayer                   | `attestFor(subject, …)` — bounded by the seal's purpose binding                     |
| Governance (owner)        | `setCompliancePolicy`, `revoke` any, `pause`/`unpause`, two-step ownership transfer |
| ISeal precompile (0x0900) | the source of truth for seal existence, activity, purpose, and CEAP satisfaction    |

---

## 2. Threats and mitigations

| #   | Threat                                                                                   | Mitigation                                                                                                                             | Test                                                                              |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| T1  | **Replay** — reuse one seal for many credentials                                         | `sealUsed[sealId]` set on first use; second use reverts `SealAlreadyUsed`                                                              | `test_rejects_seal_replay`                                                        |
| T2  | **Mis-attribution** — relayer mints a credential for the wrong subject                   | purpose binds subject; `getSeal.purpose` must equal `zeroid:0x<schema>:0x<subject>` or revert `SealNotBoundToSubject`                  | `test_rejects_seal_bound_to_other_subject`, `test_relayer_can_attest_for_subject` |
| T3  | **Schema re-scoping** — use a seal minted for schema A to mint a credential for schema B | schema is inside the purpose too                                                                                                       | `test_rejects_seal_bound_to_other_schema`                                         |
| T4  | **Policy bypass** — accept a seal that violates jurisdiction/backend/vendor-root         | `requireConfidentiality` delegates to the precompile's consensus-parity `Satisfies()`; `(false, reason)` → revert `PolicyNotSatisfied` | `test_rejects_policy_violation`                                                   |
| T5  | **Stale credential** — seal revoked on-chain but credential still reads valid            | `isCredentialValid` re-checks `verifySeal` live on every call                                                                          | `test_onchain_seal_revocation_invalidates_credential_live`                        |
| T6  | **Inactive/forged seal** — attest against a non-active or non-existent seal              | `verifySeal` must be true (else `SealNotActive`); `getSealIdByJob` reverts for unsealed jobs                                           | `test_rejects_inactive_seal`                                                      |
| T7  | **Unauthorized revocation** — third party revokes someone's credential                   | `revoke` restricted to subject or owner (`NotSubjectOrOwner`)                                                                          | `test_stranger_cannot_revoke`, `test_subject_can_self_revoke`                     |
| T8  | **Unauthorized policy change**                                                           | `setCompliancePolicy` is `onlyOwner`                                                                                                   | `test_only_owner_sets_policy`                                                     |
| T9  | **Reentrancy** during attest                                                             | `nonReentrant` on `attest`/`attestFor`; state written after external precompile reads (which are `view`)                               | (guard present; precompile calls are read-only)                                   |
| T10 | **Ownership takeover / fat-finger transfer**                                             | `Ownable2Step` — new owner must `acceptOwnership`                                                                                      | `test_two_step_ownership_transfer`                                                |
| T11 | **Emergency stop** needed                                                                | `pause` blocks issuance (`whenNotPaused`); verification stays live                                                                     | `test_pause_blocks_attestation`                                                   |
| T12 | **Zero-schema** sentinel confusion                                                       | `schema == 0` reverts `ZeroSchema`                                                                                                     | covered via attest paths                                                          |

**Suite:** `test/foundry/SealAttestationRegistry.t.sol` — **14 tests, all passing**
(`forge test --match-contract SealAttestationRegistry`). Errors carrying string args
are asserted with a bare `vm.expectRevert()` because this forge version does not match
selector-with-args reverts.

---

## 3. Invariants

1. **One credential per seal.** `sealUsed[sealId]` is monotonic (never cleared), so a
   seal backs at most one credential for its lifetime.
2. **Credential ⇒ live seal at read time.** `isCredentialValid` is false whenever the
   backing seal is not `ACTIVE`, regardless of the stored record — consensus
   revocation always wins.
3. **Credential ⇒ purpose-bound seal.** A stored credential can only have been created
   from a seal whose purpose equalled `zeroid:0x<schema>:0x<subject>`.
4. **Credential ⇒ policy-satisfying seal at issuance.** The CEAP policy in force at
   `attest` time was satisfied (policy is evaluated by the precompile, not re-derived
   in Solidity).
5. **No Solidity-side policy divergence.** Policy evaluation is delegated to
   `requireConfidentiality`; the contract never re-implements `Satisfies()`.

---

## 4. Consensus-parity proof (chain repo)

Contract-level tests prove the contract; they cannot prove the _precompile binding is
real_. That is proven in the aethelred repo by
`internal/evmhost/zeroid_test.go` — `TestZeroID_SealAttestation_RealPrecompile` —
which deploys the **vendored, reviewed bytecode** into a real EVM host wired to the
**real `ISeal` precompile and a real seal keeper**, and asserts:

- attest succeeds and the credential reads valid when a policy-satisfying,
  subject+schema-bound seal exists;
- a US-jurisdiction seal is rejected under an EU-only policy **by the precompile**;
- revoking the seal in the keeper invalidates the credential **live**.

This is the guarantee that "consensus-anchored" is behaviour, not documentation. See
`PROTOCOL_SYNC.md` §6.

---

## 5. Trust assumptions (be explicit)

- **Precompile integrity.** The contract trusts `ISeal` at `0x0900` to be the real
  Aethelred precompile. This holds on Aethelred by construction; it does **not** hold
  on a chain where `0x0900` is an ordinary contract. Deploy only to Aethelred (chain id
  7332 and its production successor).
- **Seal strength = backend strength.** A credential is only as strong as the CEAP
  backend that produced the seal. Consult the chain's confidential-execution status
  ledger for which backends are production-operational; do not present a maturing
  backend as fully operational.
- **Governance is trusted** to set a sane CEAP policy and to hold `owner`. Two-step
  ownership and `onlyOwner` gating bound, but do not eliminate, governance risk;
  production should place `owner` behind a multisig/timelock.

---

## 6. Known limitations / honest ledger

- [ ] **Tier-1 external audit** (Trail of Bits / OpenZeppelin class) — required before
      mainnet. Not done.
- [ ] **Per-party MPC topology attestation** — CEAP checks backend/jurisdiction/
      vendor-root, not per-party MPC quorum composition. Tracked upstream.
- [ ] **Owner hardening** — deploy `owner` as a multisig + timelock; not enforced by
      the contract.
- [ ] **Schema registry** — `schema` is a free `bytes32`; a canonical human-readable
      schema registry (and UI) is a follow-up.

---

## 7. Deployment checklist

1. Deploy to Aethelred (chain id **7332** / production successor) only — confirm
   `ISeal` at `0x0900` is the real precompile (`eth_chainId` = `0x1ca4`).
2. Construct with `governance` = the intended multisig/timelock, not an EOA.
3. Call `setCompliancePolicy` with the jurisdiction/backend/vendor-root policy for the
   deployment (empty arrays = "any", which is almost never what a regulated deployment
   wants — set them).
4. Verify `compliancePolicy()` reads back the intended policy.
5. Re-vendor bytecode into the chain repo and confirm `TestZeroID_SealAttestation_RealPrecompile`
   is green in that repo's CI.
6. Publish the deployed address in `ecosystem/manifest.json` / integration docs.
