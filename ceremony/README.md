# ZeroID trusted-setup ceremony

ZeroID's selective-disclosure proofs use **Groth16** on the **BN254** curve
(verified on-chain by `contracts/ZKCredentialVerifier.sol` via the pairing
precompiles). Groth16 needs a per-circuit **structured reference string (SRS)**,
produced by a two-phase trusted setup. This directory is the tooling and the
public record for that setup.

## Why a ceremony (and what makes it real)

A Groth16 setup produces secret randomness — "toxic waste." **Anyone who knows
it can forge proofs** (mint a valid ZeroID credential proof for a claim that was
never true). The ceremony's job is to make sure nobody knows the full toxic
waste.

It works by **many independent people each contributing** randomness and then
destroying their own piece. The resulting parameters are secure **as long as at
least one contributor was honest and independent** — no single party (including
whoever runs the tooling) can compromise it alone.

This has one hard consequence, and we hold to it:

> **The ceremony is only genuinely "multi-party" if the contributors are
> genuinely different, independent people.** A single actor generating several
> contributions is NOT a multi-party ceremony — it is one party in costume, and
> it provides none of the security. We do not do that. Every contribution in
> `TRANSCRIPT.md` is from a distinct, named participant.

For a testnet, contributors from within the team are acceptable and honest.
Adding one or more **external, independent** contributors is what makes the
setup genuinely trust-minimized, and is required before mainnet.

## The two phases

- **Phase 1 (Powers of Tau)** is universal — the same SRS works for any circuit
  up to a size bound. We do **not** re-run it: we reuse the community
  **Perpetual Powers of Tau**, already a ceremony with hundreds of contributors.
  The file lives at `ptau/pot14.ptau`. Verify it with
  `snarkjs powersoftau verify ptau/pot14.ptau`. (If a larger circuit needs it,
  swap in a higher-power `.ptau` from the same perpetual ceremony and update
  `scripts/lib.sh`.)
- **Phase 2** is circuit-specific and **is the ceremony we run here** — each
  contributor folds entropy into every circuit's `.zkey`.

## Circuits in this ceremony

Configured in `scripts/lib.sh` (`CIRCUITS`): `eligibility_context_proof` (the
flagship age + jurisdiction + sanctions + risk proof), `age_proof`,
`residency_proof`, `credit_tier_proof`. Keep this list in sync with
`package.json` `circuits:compile` and `circuits/manifest/`.

## Running it

Prerequisites: `npm install` (brings `snarkjs` + `circomlib`) and
[`circom` 2.1.x](https://docs.circom.io/getting-started/installation/).

| Stage | Who | Command |
| ----- | --- | ------- |
| 1. Compile circuits | coordinator, once | `scripts/01-compile.sh` |
| 2. Coordinator init (0000.zkey) | coordinator, once | `scripts/02-coordinator-init.sh` |
| 3. Contribute | **each participant** | `scripts/03-contribute.sh <your-handle>` |
| 4. Verify | anyone, any time | `scripts/04-verify.sh` |
| 5. Finalize (beacon + export) | coordinator, once | `scripts/05-finalize.sh <beaconHashHex>` |
| 6. Deploy artifacts (frontend + backend) | coordinator, once | `scripts/06-deploy-artifacts.sh` |
| 7. Register vkeys on-chain | coordinator, once | `scripts/07-register-vkeys.sh [--broadcast]` |

### If you are a contributor

1. Receive the current `contributions/*_NNNN.zkey` files from the previous
   contributor (or the coordinator, for the first contribution).
2. `git pull` (for the scripts) and run `scripts/03-contribute.sh <your-handle>`.
   snarkjs prompts you for random text — **type a lot of unpredictable
   keystrokes**. Don't script it, don't reuse it, don't keep a copy.
3. Send your new `contributions/*_MMMM.zkey` files to the next contributor (or
   the coordinator to finalize). Your line is appended to `TRANSCRIPT.md`.

For an automated (non-interactive) contribution — e.g. the coordinator's first
contribution or a CI participant — set `CEREMONY_ENTROPY` to fresh OS randomness
instead of typing at the prompt:
`CEREMONY_ENTROPY=$(openssl rand -hex 64) scripts/03-contribute.sh <handle>`.
The entropy is used once and not retained. This is still real entropy; the
multi-party security comes from having independent contributors, not from
whether they typed or piped.

The `.zkey` contribution files are large and are **not** committed
(`contributions/` is git-ignored); they are passed between participants. The
committed public record is `TRANSCRIPT.md`. The finalized `artifacts/`
(verification keys + Solidity verifiers) are the public trust anchor and are
published at finalization — the directory is git-ignored during the ceremony so
that throwaway or dev-beacon runs are never committed by accident; the
coordinator force-adds the real vkeys once the ceremony is genuinely closed.

## Finalization

After the last contributor, the coordinator applies a **public random beacon**
(a value fixed in the future and unpredictable — e.g. a Bitcoin block hash at an
announced height) to close the ceremony, then exports each circuit's
`verification_key.json` and `Verifier.sol` into `artifacts/`. Those verifying
keys are what the app and the on-chain verifier trust; the proving keys
(`*_final.zkey`) are distributed to whoever generates proofs.

## Deploying the finalized artifacts

Finalization produces the artifacts; two scripts distribute them to their
runtime consumers. Both are idempotent and run against a finalized ceremony.

**`06-deploy-artifacts.sh`** copies each circuit's `wasm` + `_final.zkey` (+
`vkey`) to where the code expects them:

- **Frontend** — `public/circuits/<age|residency|credit>/…` for browser-side
  snarkjs proof generation (paths per `src/config/constants.ts`). These are
  ceremony output, not source: they are git-ignored and re-materialised here.
- **Backend** — the flagship `eligibility_context_proof` only, to the paths its
  manifest (`circuits/manifest/eligibility_v1.json`) declares under
  `build/circuits/eligibility_context_v1/`. Landing these flips the API's
  `/ready` `circuitArtifacts` check from `degraded` to `ok`.

It writes `artifacts/deployment-manifest.json` (sha256 of every deployed file)
so a deployment ties back to `TRANSCRIPT.md`.

**`07-register-vkeys.sh`** registers each verification key on-chain in
`ZKCredentialVerifier.setVerificationKey` (`CIRCUIT_MANAGER_ROLE`). It is
**dry-run by default** — it validates every curve point, checks
`IC == nPublic + 1`, derives the canonical `circuitId = keccak256(utf8(name))`,
writes `artifacts/circuit-ids.json` (the ids the frontend must call
`verifyProof` with), and prints the calldata without touching a chain. Add
`--broadcast` with `RPC_URL`, `ZKVERIFIER_ADDRESS`, and a
`CIRCUIT_MANAGER_PRIVATE_KEY` to send.

> **G2 coordinate order.** snarkjs stores a G2 element `c0 + c1·u` as `[c0, c1]`;
> the EVM pairing precompile wants `[c1, c0]`. `ZKCredentialVerifier` stores keys
> in snarkjs order and swaps internally, so `register-vkeys.mjs` maps the vkey
> **element-for-element with no reordering** — and a submitted proof's `b` point
> must likewise be in native snarkjs order.

The full pipeline — finalize → deploy → register → generate a proof →
on-chain `verifyProof` (accepts a valid proof, rejects a tampered one) — is the
acceptance test to run against the real finalized artifacts.

## Status

**Testnet ceremony.** Contributions to date are recorded in `TRANSCRIPT.md`.
Before mainnet: include at least one external independent contributor, use a
higher-power perpetual `.ptau` if any circuit grows past the current bound, and
publish the full transcript for public audit.
