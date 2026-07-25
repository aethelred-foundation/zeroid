# `src/lib/aethelred/` — Aethelred Conformance Boundary

The single, enforced seam through which ZeroID reaches the canonical Aethelred
protocol. Every canonical capability — ZK verification, TEE/DCAP attestation,
Digital Seals, post-quantum signing, React data hooks, zkML liveness, and
conditional-disclosure escrow — is consumed **only** here. No other file in
`src/` may import `@aethelred/sdk` (enforced by CI; see [Guard](#guard)).

This is the reusable conformance template for the other ecosystem dApps
(Cruzible, TerraQura, NoblePay, Shiora): replicate this folder + the guard.

> Design specs and per-workstream plans: [`docs/superpowers/specs`](../../../docs/superpowers/specs) and [`docs/superpowers/plans`](../../../docs/superpowers/plans).

---

## Why a boundary

ZeroID and the protocol were built without coordination, so ZeroID re-implemented
capabilities the chain already provides (its own ZK verifier, simulated TEE,
hand-rolled SDK). The fix is a **strangler-fig boundary**: route all canonical
access through one module, migrate subsystem-by-subsystem, and delete the
parallel copies — without ever breaking the running app. Cryptographically,
ZeroID was already aligned (Groth16/BN254 + EVM); the work was conformance, not a
rewrite.

The deep payoff: the protocol owns the hard parts (DCAP hardware attestation,
EZKL zkML, ML-DSA-65 PQC, Digital Seals), so ZeroID's "20× moat" features
_compose_ canonical primitives instead of reinventing weaker ones.

---

## Module map

| Module                     | Purpose                                                        | Key exports                                                                      |
| -------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `client.ts`                | Canonical SDK client (network/chain)                           | `getAethelredClient`, `getVerificationModule`, `getSealsModule`                  |
| `encoding.ts`              | Canonical ZK wire encoding (32-byte BE field elements, base64) | `fieldElementToBytes`, `encodePublicInput`, `serializeGroth16ProofUncompressed`  |
| `zk.ts`                    | ZK proof → canonical verify (Groth16)                          | `verifyZkProofCanonical`, `zkProofToVerifyRequest`, `verifyZeroIdProofCanonical` |
| `vkeys.ts`                 | Circuit → registered verifying-key hash                        | `getVerifyingKeyHash`                                                            |
| `verify.ts`                | Flag-gated canonical-vs-bespoke strategy                       | `isCanonicalVerifyEnabled`, `verifyProofPreferCanonical`                         |
| `attestation.ts`           | TEE/DCAP attestation verify + platform map                     | `verifyTeeAttestationCanonical`, `mapTeePlatform`                                |
| `seals.ts`                 | Digital Seals (`x/seal`)                                       | `createDigitalSeal`, `verifyDigitalSeal`, `getDigitalSeal`                       |
| `signing.ts`               | PQC hybrid (ML-DSA-65 + ECDSA)                                 | `signHybrid`, `isPqcSigningEnabled`, `configurePQCProvider`                      |
| `react.ts` _(client-only)_ | Canonical React hooks                                          | `useSeal`, `useSealVerification`, `useJob`                                       |
| `liveness.ts`              | EZKL zkML liveness (zkML + DCAP)                               | `verifyLivenessProof`, `verifyLivenessWithAttestation`                           |
| `shamir.ts`                | GF(256) t-of-n secret sharing                                  | `splitSecret`, `combineShares`                                                   |
| `disclosure.ts`            | Key-split escrow (AEAD + commitment + erasure)                 | `createDisclosureEscrow`, `reconstituteDisclosure`, `shredShares`                |
| `disclosure-contract.ts`   | `ConditionalDisclosure.sol` viem client                        | `registerEscrowOnChain`, `approveDisclosureOnChain`, …                           |
| `disclose.ts`              | End-to-end disclosure orchestrator                             | `discloseIdentityPath`                                                           |
| `index.ts`                 | Public barrel (server-safe; hooks excluded)                    | —                                                                                |

`react.ts` is intentionally **not** re-exported from `index.ts` — it is
`"use client"`. Import hooks directly from `@/lib/aethelred/react` so server
imports of the barrel stay React-free.

---

## Guard

`scripts/check-aethelred-boundary.mjs` fails CI if any file outside this folder
imports `@aethelred/sdk`. Run it locally:

```bash
npm run boundary:check
```

It is wired into `npm run validate` and the `Aethelred Compatibility` workflow
(`.github/workflows/aethelred-compatibility.yml`), which builds ZeroID against
the pinned protocol SDK.

---

## Configuration

| Env var                         | Values                                         | Effect                                                              |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_AETHELRED_NETWORK` | `mainnet` \| `testnet` (default)               | Canonical client network                                            |
| `NEXT_PUBLIC_CANONICAL_VERIFY`  | `true`                                         | Prefer canonical on-chain ZK verify (else bespoke fallback)         |
| `NEXT_PUBLIC_AETHELRED_VKEYS`   | JSON `{ "<circuitId>": "<base64 vkey hash>" }` | Registered verifying-key hashes                                     |
| `NEXT_PUBLIC_PQC_SIGNING`       | `true`                                         | Enable ML-DSA-65 + ECDSA hybrid signing (requires injected backend) |

Canonical chain IDs: **mainnet 8821 / testnet 88210** (source: aethelred
`ecosystem/manifest.json`).

---

## Activation runbook

Most canonical paths are built, tested, and **flag-gated off** so nothing breaks
pre-testnet. Activation is configuration, not code, with zero regression risk.

### Gate W2c — canonical ZK verification

1. On a live node, run a snarkjs→arkworks proof equivalence test to confirm the
   byte-exact proof format (G2 Fp2 limb order / compression in `encoding.ts`).
2. Register each circuit's verifying key on-chain (`x/verify`); collect the
   `verifying_key_hash` values.
3. Set `NEXT_PUBLIC_AETHELRED_VKEYS={"<circuitId>":"<hash>",…}`.
4. Set `NEXT_PUBLIC_CANONICAL_VERIFY=true`.
5. Verification now routes to the chain precompile; the snarkjs path remains as
   per-circuit fallback until you delete it (W2c cleanup).

### Gate W3c — DCAP attestation + Digital Seals

1. Have the TEE worker surface the raw DCAP `quote` + `pcrValues` (ZeroID's
   contract-view attestation lacks them).
2. Map them to the SDK `TEEAttestation` shape and call
   `verifyTeeAttestationCanonical` at the `verifyAttestation` call sites.
3. Anchor identity-issuance evidence via `createDigitalSeal`.

### Gate W4c — PQC hybrid signing

1. Inject a real ML-DSA-65 backend: `configurePQCProvider(provider)` (WASM/native).
2. Set `NEXT_PUBLIC_PQC_SIGNING=true`. `signHybrid` then augments wallet ECDSA
   with ML-DSA-65; otherwise it returns classical-only.

### Gate Phase 2b — EZKL zkML liveness

1. Train a ZK-friendly liveness CNN → ONNX → EZKL circuit → proving/verifying keys.
2. Register the `Circuit` + `VerifyingKey` on-chain; add its hash to
   `NEXT_PUBLIC_AETHELRED_VKEYS`.
3. `verifyLivenessProof` / `verifyLivenessWithAttestation` verify it on the EZKL rail.

### On-chain conditional disclosure

1. Deploy `contracts/ConditionalDisclosure.sol`; grant `ESCROW_ISSUER_ROLE` and
   `COMPLIANCE_OFFICER_ROLE`; set the quorum threshold.
2. Wire a viem `WalletClient`/`PublicClient` as the `DisclosureContractRunner`
   (its `address` = the deployed contract).
3. Use `discloseIdentityPath(runner, escrowId, nullifier, payload, policy)` for
   the full flow; distribute `escrow.shares` to the quorum off-chain.

---

## Testing

```bash
npx jest src/lib/aethelred            # boundary unit tests (15 suites)
forge test --match-contract ConditionalDisclosureTest   # on-chain quorum
npm run type-check && npm run boundary:check            # types + guard
```

Tests needing `crypto.subtle` (e.g. `disclosure`) use `@jest-environment node`.

---

## Replicating for another dApp

1. Copy `src/lib/aethelred/` and adapt `client.ts` (network) + any app-specific
   adapters.
2. Copy `scripts/check-aethelred-boundary.mjs` and add `boundary:check` to the
   app's `validate` script + CI.
3. Add the app's `Aethelred Compatibility` workflow, pinned to the protocol SHA.
4. Register the app in the protocol `ecosystem/manifest.json` (repo, pinned SHA,
   build commands).
