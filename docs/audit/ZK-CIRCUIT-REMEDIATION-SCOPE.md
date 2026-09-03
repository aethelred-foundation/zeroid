# ZK circuit remediation — scope

**Status:** scope only. Nothing here is implemented. Four decisions are needed
before work starts; they are marked **DECISION** and are the point of this
document.

Companion to `ZK-PREDICATE-ENFORCEMENT.md`, which covered the consumer-side
gap that was live and is now closed. This covers the circuits themselves.

## Where things stand

Eleven `.circom` files exist. Compiled with circom 2.2.3 against circomlib
2.0.5 (`circom -l node_modules <file> --r1cs`):

| circuit | compiles | non-linear constraints | wired |
| --- | --- | --- | --- |
| `age/age_proof` | yes | 7,931 | **yes — artifacts ship** |
| `age/age_context_proof` | yes | 7,931 | compile script only |
| `eligibility/eligibility_context_proof` | yes | 7,958 | ceremony + manifest |
| `residency/residency_proof` | yes | 7,862 | ceremony, no artifacts |
| `credit/credit_tier_proof` | yes | 8,083 | ceremony, no artifacts |
| `nationality/nationality_proof` | yes | 10,320 | no |
| `composite/composite_proof` | yes | 32,284 | no |
| `accumulator/non_revocation_proof` | yes | 2,783 | no — but see D3 |
| `bbs/bbs_selective_disclosure` | **no** — T2011 | — | no |
| `biometric/biometric_match` | **no** — T2008 | — | no |
| `threshold/threshold_signature_verify` | **no** — T2011 | — | no |

Only `age_proof` has ceremony artifacts on disk
(`public/circuits/age/age_proof_final.zkey`, `verification_key.json`,
`age_proof_js/`). Everything else has none, which is why the defects below are
latent rather than exploitable.

## Three classes of defect

### Class A — the credential trust model is not enforced (blocks ZK launch)

Affects the circuits that are wired or nearly wired: `age_proof`,
`age_context_proof`, `eligibility_context_proof`, `residency_proof`,
`credit_tier_proof`, and also `composite_proof` and `nationality_proof`.

**A1. The issuer public key is a private witness.** Each circuit takes
`issuerPubKeyX` / `issuerPubKeyY` as private inputs, folds them into the
credential commitment, and verifies an EdDSA-Poseidon signature against them.
Nothing binds those coordinates to a known issuer. A prover generates its own
BabyJubJub keypair, signs a credential asserting whatever it likes, and every
constraint is satisfied. The in-circuit signature check proves only that the
prover holds *some* key consistent with the commitment it also chose.

Independently confirmed for `credit_tier_proof` (C-1), `residency_proof` (R-1)
and the age/eligibility family (ZK-03). This is the finding that matters most:
it defeats the credential model rather than weakening it.

**A2. Circuits compute their verdict but never assert it.** `ageVerified <== 1
- ageCompare.out` is a real constraint — a prover cannot lie about the bit —
but the circuit never requires it to be 1. The author knew the idiom:
`age_proof.circom:113` asserts `dobCheck.out === 1` two lines earlier. Consumer
enforcement now covers this (see the companion document), but consumer checks
are defence in depth; the circuit should refuse to produce a proof of a
statement that is false.

**A3. `currentTimestamp` is unchecked at the OID4VP boundary.**
`backend/src/services/oid4vp/zk-predicate.ts` accepts the prover's
`currentTimestamp` public signal without comparing it to wall-clock time, so
the age and expiry predicates can be evaluated at a time of the prover's
choosing. Confirmed (ZK-02), with the correction that the practical effect is
bounded forward-dating up to `expiryTimestamp` plus unbounded backdating —
not the unlimited forward-dating first claimed. This one is backend-only and
needs no circuit change or ceremony.

### Class B — gadgets that verify nothing

**B1. `bbs_selective_disclosure` verifies no signature.** The "signature check"
is `valid <== 1 - IsZero(Poseidon(...).out)`. A Poseidon output is non-zero for
essentially every input, so `valid` is 1 unconditionally, for any issuer key
and any claimed messages. The source says so:
`// (in practice, this would be a pairing check)`.

**B2. `non_revocation_proof` never enforces the Bezout relation.** Same
pattern, same conclusion — `valid <== 1 - IsZero(Poseidon(...).out)`, with the
comment `// (the hash-based abstraction always produces non-zero for valid
inputs)`. A revoked credential proves non-revocation. `HashToPrime` is
similarly vacuous: `credentialPrime` and `hashCounter` are unconstrained
relative to `credentialHash`, so `credentialPrime = 4` is accepted.

**This one has a waiting consumer, which makes it the sharpest item in Class
B.** `contracts/AccumulatorRevocation.sol` documents that "non-membership
proofs are verified via an external IZKVerifier (Groth16)" and exposes
`ZKVerifierUpdated(address verifier, bytes32 circuitId)`. The circuit
*compiles*, so unlike B1 and B3 nothing stops someone generating artifacts and
registering them against a gadget that returns true for everything. Revocation
would then be unenforceable on-chain while appearing to be cryptographically
checked.

**B3. `threshold_signature_verify` is unsatisfiable and verifies no
signature.** Its "pairing check" requires a Poseidon collision, so no honest
prover can produce a witness at all; the public `messageHash` is bound to
nothing; `publicKeySharesX/Y` are never linked to the group key; and the output
`coefficient` is never assigned. It does not compile, so this is currently
representational only.

### Class C — the repository overstates what exists

`README.md:32` and `:34` advertise "9 ZK circuits", and `:88` lists "BBS+
selective disclosure and threshold credentials" as capabilities. Three circuits
do not compile and two of the compiling ones verify nothing. The "Pre-mainnet
… under active development" qualifier at `:34` is fair but does not cover
naming specific features that are placeholder stubs.

## The constraint that shapes sequencing

**Any change to a `.circom` file invalidates that circuit's ceremony artifacts
and requires a fresh trusted setup.** Today only `age_proof` has artifacts, so
the cost is currently at its minimum — one circuit to redo. That argues for
making all intended circuit changes in a single revision rather than
incrementally, and for deciding the disposition of the unwired circuits before
running a ceremony that would otherwise have to be repeated.

The multi-party ceremony is already an open item independent of this work.

## Decisions needed

**DECISION D1 — how are issuers anchored?** (Class A1, blocks ZK launch.)
Options, in ascending cost:

- *(a)* Make the issuer public key a **public input**. Cheapest circuit change;
  the relying party then checks the key against its own trust list off-circuit.
  Leaks which issuer signed, which may be acceptable for a KYC provider and
  not for others.
- *(b)* Prove **membership of the issuer key in a Merkle tree** of approved
  issuers, with the root as a public input. Preserves issuer privacy; adds
  roughly a Poseidon hash per tree level. `nationality_proof` already contains
  a `MerkleInclusionProof` template to reuse.
- *(c)* Bind to the **on-chain issuer registry** — a root published by
  `contracts/CredentialRegistry.sol` or the enterprise issuer-trust routes that
  already exist in the backend.

Recommendation: **(b)**, with the root sourced from (c) once the registry is
the authority. It is the option that does not force a privacy regression and
does not wait on contract work to start.

**DECISION D2 — assert predicates in-circuit as well as at consumers?**
(Class A2.) Recommendation: **yes.** It is a one-line `=== 1` per verdict and
it makes a false proof unconstructible rather than merely refused. Note it
changes the semantics of the public signals — an asserted circuit need not
publish the verdict at all — so it should land in the same revision as D1
rather than causing a second ceremony. Consumer enforcement stays regardless,
since it is what protects circuits whose predicate is not asserted.

**DECISION D3 — what happens to the five unsound, unwired circuits?**
Per circuit, `delete` / `implement` / `quarantine`:

| circuit | recommendation | why |
| --- | --- | --- |
| `bbs_selective_disclosure` | **delete** | Does not compile; the signature check is a stub. A real BBS+ proof is a substantial cryptographic project, not a repair. |
| `threshold_signature_verify` | **delete** | Does not compile; unsatisfiable; verifies nothing. |
| `biometric_match` | **delete** | Does not compile; and even repaired, `freshSample` is bound to nothing, so it proves knowledge of the enrolled template rather than a live capture. Biometric liveness belongs in the TEE path, not a Groth16 circuit. |
| `non_revocation_proof` | **implement or quarantine — needs your call** | It compiles and a contract is waiting for it. Leaving it as-is is the one case where someone could plausibly wire a vacuous gadget into an on-chain gate. |
| `composite_proof` | **defer** | 32,284 constraints, unwired, and inherits A1. Revisit only after D1 lands, since it would otherwise need reworking twice. |

Deleting is not a loss of work if the intent is recorded: keep the files in git
history and note the intended design in `docs/`. What must not persist is a
stub that reads like a working verifier.

**DECISION D4 — does `nationality_proof` stay?** It compiles and is unwired,
but beyond A1 it has a mode-switch bypass: a prover sets `useMerkleMode=1` to
satisfy the Merkle path against a tree of all ISO codes and skip the flat
allowed-set check entirely (N-3). If it stays, the two modes must be made
mutually exclusive under a public policy selector rather than a prover-chosen
one.

## Sequenced program, once decisions are made

**Phase 1 — backend only, no ceremony (small).** Fix A3: check
`currentTimestamp` against wall-clock time with a bounded skew at the OID4VP
boundary, and reject stale or future-dated public signals. Independent of every
decision above; can start immediately.

**Phase 2 — repository honesty (small).** Act on D3/D4: remove or quarantine
the chosen circuits, correct `README.md:32/34/88`, and add a CI step that
compiles every `.circom` under `circuits/` so an uncompilable circuit can never
be committed again. That CI gate is what would have caught B1 and B3 at the
time they were written.

**Phase 3 — the circuit revision (the substantial piece).** Implement D1 and
D2 together across the surviving credential circuits, in one revision:
issuer anchoring, in-circuit predicate assertions, and the D4 mode fix if
`nationality_proof` stays. Update the public-signal schemas in
`src/config/constants.ts` and `backend/src/services/zkproof.ts` — the
descriptors added in the enforcement work already carry the shape, so this is a
data change rather than a redesign. Regenerate artifacts and rerun the ceremony
for every changed circuit.

**Phase 4 — verification.** Per circuit: a witness-level test that the intended
statement cannot be proven false (self-issued credential refused, failed
predicate unprovable), plus a fixture that pins the public-signal layout
against the compiled `.sym` so a future reordering cannot silently relabel a
proof. Then re-run the adversarial pass that produced these findings against
the revised circuits.

## What must be true before ZK verification is enabled

1. `NEXT_PUBLIC_CANONICAL_VERIFY` stays `false` until Phase 3 lands. An
   enabled canonical path over Class-A circuits would accept self-issued
   credentials.
2. Placeholder `CIRCUIT_IDS` in `src/config/constants.ts` are replaced with
   real identifiers. They are currently non-hex strings such as
   `0xage0000…0001`, which is what keeps the on-chain path inert.
3. No verifying key is registered on-chain for `non_revocation_proof` until
   D3 is resolved.
4. Every circuit offered in the UI has ceremony artifacts, a declared
   predicate, and a passing Phase-4 test.

## Evidence

Findings were produced by six independent circuit reviewers plus a
compile/`circomspect`/witness-reproduction pass, and the nine affecting wired
circuits were then put through two independent refuters each. Of those nine:
six confirmed, one refuted (C-3 — not a real defect), one disputed (ZK-04), and
ZK-01 confirmed and since fixed. The Class B claims above were additionally
re-verified against the source while writing this document. Compile results in
the table were reproduced directly.

One external report is **not** the source of any finding here. An unsolicited
email claiming "under-constrained signals `a`, `a1`, `a2`, `a3`" and missing
`Num2Bits_strict` bounds was checked and does not describe this codebase: no
signals `a1`/`a2`/`a3` exist, the only `a` signals are bit-constrained
(`biometric_match.circom:64-65`, verified by rejecting witnesses with `a=2` and
`a=p-1`), there are no `<--` assignments anywhere, and Poseidon requires no
range bound on its inputs.
