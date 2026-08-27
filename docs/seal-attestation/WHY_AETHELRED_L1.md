# Why ZeroID's Identity Layer Requires Aethelred to Be an L1

**Audience:** regulators, auditors, enterprise architects, and developers evaluating
"why not just deploy this on Ethereum / an L2?"

**Short answer:** ZeroID's highest assurance tier — the `SealAttestationRegistry` —
anchors a credential to a **Digital Seal minted by the chain's own validator quorum**
and re-checks that seal's live status through a **consensus-native precompile**. Those
two properties are consensus-layer facts. An L2 or an app-chain-on-someone-else's-L1
cannot provide them, because they are not the entity that runs the attested compute,
mints the seal, or finalizes it. ZeroID is the default identity layer for
sovereign/regulated clients _because_ it sits on an L1 that treats attested,
confidential computation as a first-class consensus artifact.

This is the identity-layer companion to the chain's own
[ADR-0004: Aethelred is a Sovereign L1, Not an Ethereum L2](../../../aethelred-demo/docs/architecture/ADR-0004-sovereign-l1-not-l2.md).

---

## The reviewer test

For each property, ask: _would this still hold if Aethelred were a rollup settling to
Ethereum?_ If the answer is "no," the property is a genuine L1 requirement, not
L1-vanity.

### 1. The credential's root of trust is a consensus-minted attestation

A ZeroID seal-anchored credential is not an issuer's signature that happens to live
on-chain. It is anchored to a Digital Seal that the **validator set produced** when a
PoUW compliance job ran under a Confidential Execution & Attestation Protocol (CEAP)
policy — FHE/TEE/MPC backend, jurisdiction, vendor-root trust. The attestation _is_
the block-producing work.

> **Rollup test:** A rollup does not run its own attested compute as consensus; it
> posts transactions to L1 for data availability and inherits L1 settlement. There is
> no "quorum-minted attestation" to anchor to — you would be back to trusting an
> issuer's signature or an off-chain KYC oracle. **Fails.**

### 2. Live revocation propagates from consensus, not from a ZeroID transaction

`isCredentialValid` re-reads `ISeal.verifySeal` on every call. When the chain revokes
the underlying seal (compliance lapse, jurisdiction change, key compromise), the
credential is invalid on the very next read — no ZeroID transaction, no keeper cron,
no re-issuance. Revocation is a consensus state transition that the credential
observes directly.

> **Rollup test:** On an L2, seal state would either be foreign state reached over a
> bridge (asynchronous, trust-added) or duplicated app state (can drift from the
> attester). Instant, trustless revocation-from-consensus is not available. **Fails.**

### 3. Verification is bridge-free — the precompile reads consensus-native state

`ISeal` (0x0900) is a precompile: Solidity calls it and it reads the seal keeper's
state in the same execution as the EVM call. No message bridge, no light client, no
oracle relay sits between the credential check and the truth.

> **Rollup test:** An L2 reaching L1 seal state needs a bridge or a proof relay — new
> trust and new latency, and a new bridge attack surface (the dominant loss category
> in the ecosystem). **Fails.**

### 4. Sovereignty and data residency are enforced at the layer that runs the compute

Regulated identity (eIDAS, KYC/AML, VARA, sector rules) demands provable jurisdiction
and provable confidentiality of the underlying processing. CEAP encodes
`dataResidency`, `allowedBackends`, `requireVendorRoot` into the seal, and the
validator set enforces them where the computation happens. The registry's
`setCompliancePolicy` then makes those the admission rule for credentials.

> **Rollup test:** A rollup inherits the base layer's validator set and its
> jurisdiction; it cannot promise a sovereign operator "these attestations were
> produced by validators under your control, in your jurisdiction, on vendor-rooted
> hardware." **Fails.**

### 5. Post-quantum finality on the identity attestation itself

Digital Seals are quorum-signed with PQC (ML-DSA) via ABCI++ vote extensions. An
identity attestation minted today is finalized under a signature scheme meant to
survive a store-now-decrypt-later adversary — the correct posture for credentials that
must remain sound for decades.

> **Rollup test:** A rollup's finality is the base layer's finality and signature
> scheme; you cannot unilaterally give your identity attestations PQC finality.
> **Fails.**

---

## What this is _not_

It is not "another L1 for its own sake." ZeroID runs a full EVM surface and standard
Solidity tooling (Foundry, OpenZeppelin, wagmi/viem) — an integrator's mental model is
ordinary. The L1 requirement is narrow and load-bearing: the _root of trust for a
credential_ is a consensus-minted, PQC-finalized, confidentially-attested seal, checked
bridge-free. Everything an L2 _can_ do (EVM execution, cheap transactions, familiar
tooling), Aethelred also does. The five properties above are the things an L2
structurally _cannot_ do — and they are exactly the things a sovereign or regulated
identity program buys ZeroID for.

## The honest boundary

- The strength of a credential is the strength of the seal behind it. A seal is only
  as strong as the CEAP backend that produced it. Backends are attested and
  policy-gated, but see the chain's confidential-execution status ledger for which
  backends are production-operational vs. maturing — do not represent a maturing
  backend as fully operational.
- `SealAttestationRegistry` is the top assurance tier. ZeroID's role-based
  `CredentialRegistry` (issuer-signed) remains the right tool where a human/legal
  issuer, not the chain, is the intended attester. Use the tier that matches the
  trust you actually have.
- The contracts await a Tier-1 external audit before mainnet (a launch gate). See
  `SECURITY.md`.
