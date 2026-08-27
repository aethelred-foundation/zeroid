# ZeroID ↔ Aethelred Protocol Sync — Seal-Anchored Identity

**Contract:** `contracts/SealAttestationRegistry.sol` (BUSL-1.1, solc 0.8.28, `--via-ir`)
**Chain:** Aethelred L1 — EVM EIP-155 chain id **7332** (`eth_chainId` → `0x1ca4`)
**Precompile:** `ISeal` at `0x0000000000000000000000000000000000000900`

This document is the contract-of-record for how ZeroID's highest assurance tier
binds to Aethelred consensus. It exists so an auditor or an enterprise integrator
can confirm — without reading the whole codebase — that a `SealAttestationRegistry`
credential is anchored to the chain's own Proof-of-Useful-Work (PoUW) pipeline and
not to an off-chain allowlist.

---

## 1. Trust model in one paragraph

A ZeroID _seal-anchored credential_ is valid iff a **Digital Seal** — an artifact
minted by the Aethelred validator quorum when a PoUW compliance/KYC job completes —
exists, is `ACTIVE`, was bound to **this exact subject and schema**, and carries a
CEAP confidentiality attestation that satisfies the registry's policy. Every one of
those checks is evaluated **inside the EVM by the `ISeal` precompile**, which reads
consensus-native state directly. There is no bridge, no oracle, and no KYC server in
the verification path. When the chain revokes the seal, the credential goes invalid
on the next `isCredentialValid` call — liveness flows from consensus, not from a
ZeroID transaction.

---

## 2. The four ISeal touchpoints

The registry uses exactly these precompile methods (see the aethelred repo
`precompiles/seal/ISeal.sol`, vendored verbatim at
`contracts/interfaces/ISeal.sol`):

| Call                                                                                                     | Used for                                            | Failure semantics                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| `getSealIdByJob(jobId)`                                                                                  | resolve the seal minted for a PoUW job              | reverts if the job is unsealed   |
| `verifySeal(sealId)`                                                                                     | is the seal `ACTIVE` right now                      | `false` → not active / revoked   |
| `getSeal(sealId)`                                                                                        | read the `purpose` field for subject+schema binding | —                                |
| `requireConfidentiality(sealId, backends, minVerification, platforms, requireVendorRoot, dataResidency)` | CEAP policy check with **consensus parity**         | `(false, reason)` → policy unmet |

`requireConfidentiality` is the important one: it runs the **same `Satisfies()`
logic** the chain uses when it decides whether a job may be sealed. The Solidity
side does not re-implement policy evaluation — it delegates to the precompile so the
on-chain and in-EVM answers can never diverge.

---

## 3. The purpose binding (anti-replay, anti-mis-attribution)

A seal only backs a credential if its `purpose` string equals, byte-for-byte:

```
zeroid:0x<schema-hex-64>:0x<subject-address-hex-40>
```

- `<schema-hex-64>` — the 32-byte `schema` (e.g. `keccak/sha256("kyc-tier-2")`), lowercase, unchecksummed.
- `<subject-address-hex-40>` — the subject's 20-byte address, lowercase.

This is what makes the relayer path (`attestFor`) safe: a relayer cannot mint a
credential for anyone the seal was not issued to, because the subject is _inside the
purpose the quorum signed_. It also blocks re-scoping a seal to a different credential
type — the schema is bound too. `expectedPurpose(subject, schema)` returns this exact
string for issuers, relayers, and UIs to construct the PoUW job.

Each seal admits **exactly one** credential (`sealUsed[sealId]`), so a seal cannot be
replayed into multiple credentials.

---

## 4. Lifecycle

```
  ┌── off-chain / PoUW ──────────────────┐        ┌── EVM (chain id 7332) ─────────────┐
  │ 1. submit PoUW job, purpose =         │        │ 3. subject/relayer → attest(schema,│
  │    zeroid:0x<schema>:0x<subject>,     │        │    jobId)                          │
  │    CEAP policy (jurisdiction/backend) │        │      ISeal.getSealIdByJob          │
  │ 2. validator quorum verifies →        │  seal  │      ISeal.verifySeal (ACTIVE)     │
  │    mints Digital Seal (PQC-signed),   │ ─────► │      ISeal.getSeal → purpose match │
  │    binds purpose + attestation        │        │      ISeal.requireConfidentiality  │
  └───────────────────────────────────────┘        │    → record credential            │
                                                    │ 4. any dApp → isCredentialValid    │
                                                    │      re-checks ISeal.verifySeal    │
                                                    │      (live revocation)             │
                                                    └────────────────────────────────────┘
```

---

## 5. Wallet / dApp wiring (chain id 7332)

- `src/config/chains.ts` — mainnet `7331` (placeholder until a production network
  exists), testnet/devnet **both `7332`** (same chain, different endpoints). RPC
  endpoints are env-overridable:
  - `NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL` (default hosted testnet RPC)
  - `NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL` (default `http://127.0.0.1:8545`, a local
    `aethelredd start --json-rpc.enable` node)
- `src/config/wagmi.ts` — because testnet and devnet share id `7332`, the chain list
  is deduped by id with `activeChain` kept first, so the surviving `7332` chain object
  carries the RPC for whichever environment (`NEXT_PUBLIC_CHAIN_ENV`) is active. Only
  the audited `injected` connector is wired; Coinbase/WalletConnect are intentionally
  left out until their peer SDKs are audited.

Source of truth for the chain id: aethelred `ecosystem/manifest.json` →
`protocol.evm_chain_id`. The earlier `8821/88210` values were never-deployed
placeholders and have been reconciled to `7332` there.

---

## 6. How this stays in sync with the chain (drift protection)

The binding is protected against silent drift by two artifacts checked into the
**aethelred** repo:

1. **Vendored bytecode** — `internal/evmhost/testdata/zeroid/SealAttestationRegistry.{abi,bin}`
   is the exact reviewed contract, compiled with `forge build` (0.8.28, via-ir) and
   copied over. If the Solidity changes, re-vendor.
2. **Real-precompile proof** — `internal/evmhost/zeroid_test.go`
   (`TestZeroID_SealAttestation_RealPrecompile`) deploys that bytecode into a real EVM
   host wired to the **real `ISeal` precompile and a real seal keeper**, then proves:
   - a policy-satisfying, subject+schema-bound seal attests and the credential reads valid;
   - a US-jurisdiction seal is rejected under an EU-only policy _by the precompile_;
   - revoking the seal in the keeper (`seal.Revoke(); k.UpdateSeal(...)`) invalidates
     the credential live, with no ZeroID transaction.

If the ABI or the purpose format changes without updating both sides, this Go test
fails in the chain repo's CI. That is the guarantee that "seal-anchored" is not just
a comment.

The contract-side behaviour is independently locked by the Foundry suite
`test/foundry/SealAttestationRegistry.t.sol` (see `SECURITY.md`).
