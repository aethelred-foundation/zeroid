# ZK predicate enforcement

Status: remediated in `fix/zk-predicate-enforcement`. Circuit-level gaps
recorded here remain launch-blocking and are **not** closed by this change.

## What was live

The shipped age circuit accepted proofs that said the holder had failed.

`circuits/age/age_proof.circom` computes its verdict into a public output
instead of asserting it:

```circom
ageVerified <== 1 - ageCompare.out;   // :135  computed, never asserted
credentialValid <== expiryCheck.out;  // :145  computed, never asserted
```

Both lines are real R1CS constraints, so a prover cannot lie about the bit —
`ageVerified` is genuinely 0 when the holder is under the threshold. Contrast
`:113`, where the same author *did* assert (`dobCheck.out === 1`). The defect
is that nothing downstream read the published bit.

The consequence was live, not latent:

- Real, matched artifacts ship and are served by Next.js from `public/`:
  `public/circuits/age/age_proof_final.zkey` (5,032,946 bytes),
  `public/circuits/age/verification_key.json` (groth16, bn128, `nPublic: 5`),
  and `public/circuits/age/age_proof_js/`.
- A Groth16 proof carrying `ageVerified = 0` was generated and verified
  against those exact shipped files.
- A holder aged 1.8 years, holding a genuine issuer-signed credential,
  therefore produced a proof the app accepted and submitted as a **successful
  age verification**.

Three separate defects combined:

1. **Rotated labels.** `src/lib/zk/prover.ts` split the public-signal vector
   assuming public *inputs* came first:

   ```ts
   const numPublicInputs = circuit.publicInputs.length;
   const publicInputValues = result.publicSignals.slice(0, numPublicInputs);
   const publicOutputValues = result.publicSignals.slice(numPublicInputs);
   ```

   circom emits public **outputs** first. `age_proof`'s symbol table is
   `[ageVerified, credentialValid, ageThresholdYears, currentTimestamp,
   credentialHashPublic]`, so every proof carried rotated labels: the
   `publicOutputs` field actually held `[currentTimestamp,
   credentialHashPublic]`.

2. **Dead check.** `areOutputsTruthy` in `src/lib/zk/verifier.ts` had zero
   production call sites, and because of defect 1 it would have inspected the
   wrong signals and returned true unconditionally anyway (a timestamp is
   non-zero).

3. **No gate.** `src/contexts/ProofContext.tsx` threw only when the proof
   failed to verify, and otherwise submitted it to the backend via
   `respondToVerification` as a fulfilled verification. It never inspected a
   predicate output.

## The fix

**Layout is declared, then asserted.** `CircuitMeta` gains
`publicOutputCount`, and `src/lib/zk/signals.ts` derives the split from it
rather than inferring one. `splitPublicSignals` refuses a vector whose length
is not `publicOutputCount + publicInputs.length`, and refuses a descriptor
whose `publicOutputCount` disagrees with its own `outputs` list. The halves
can no longer be swapped silently: a mismatch throws instead of relabelling.
`orderPublicSignals` rebuilds the vector as `[...outputs, ...inputs]` wherever
snarkjs or the chain verifier needs the raw signal array — the bespoke
verifier and the canonical wire request previously concatenated them the other
way round.

**The predicate is declared, then enforced.** `CircuitMeta` gains
`requiredOutputs`: the outputs that must equal exactly 1 for the proof to mean
what the UI claims (`ageVerified` and `credentialValid` for the age circuit).
Outputs are resolved by *name* through the descriptor, so the check reads the
signal it means to read.

Enforcement is applied at every point a proof becomes a trust decision:

| Path | Change |
| --- | --- |
| `src/lib/zk/verifier.ts` `verifyProofLocally` | Returns `valid: false` with the failing output named when the predicate does not hold. |
| `src/lib/zk/verifier.ts` `areOutputsTruthy` | Rewritten over `checkProofPredicate`; no longer "any non-zero value is truthy". |
| `src/lib/aethelred/zk.ts` `verifyZeroIdProofCanonical` | The chain verifier answers "does this verify against the registered key", not "does the predicate hold". The predicate is checked here too, so both verification paths refuse the same proofs. |
| `src/contexts/ProofContext.tsx` | `fulfillProofRequest` and `submitProof` refuse with a user-facing error before anything reaches the backend. |
| `backend/src/services/zkproof.ts` `verifyProof` | `valid` is now `cryptographicallyValid && predicate.satisfied`, with a `reason`. Every backend route already gated on `result.valid`, so all of them are closed at once. |
| `backend/src/services/oid4vp/zk-proofservice-verifier.ts` | `result.valid` now folds in the predicate; the OpenID4VP path returns DENIED rather than ALLOWED. |

**Fail closed.** A circuit that does not declare `requiredOutputs`, or that
cannot be resolved in the registry at all, is refused rather than accepted —
on both the frontend and the backend. `src/lib/zk/verifier.ts` `verifyRawProof`
remains a cryptography-only primitive and is documented as such; it has no
production call sites.

**Unwired circuits made honest.** `CircuitMeta` gains `available` and
`unavailableReason`. `getAvailableCircuits()` now returns only circuits whose
ceremony output is published; `getAllCircuits()` exposes the full registry
including the reason each unavailable entry cannot be used, for any surface
that wants to list them. `generateProof` refuses an unavailable circuit before
fetching anything, with a message the UI renders verbatim. No circuit ids were
invented: `CIRCUIT_IDS` values are deliberately mnemonic and therefore not
valid hex, which is now documented at the declaration so they cannot be
mistaken for registered on-chain ids.

## What remains launch-blocking

Neither of the following is fixed. Each needs circuit changes plus a **new
trusted setup**, so they belong to a separate program.

1. **The circuits still do not assert their own predicates.** `age_proof.circom`
   was deliberately left untouched: `ageVerified` and `credentialValid` are
   still computed rather than asserted. Enforcement is currently a property of
   the consumers, not of the constraint system. A verifier that runs
   `snarkjs.groth16.verify` against the shipped verification key without
   checking the published outputs — a third-party integrator, a hand-rolled
   script, a future contract — will still accept a proof carrying
   `ageVerified = 0`. The circuit must assert `ageVerified === 1` and
   `credentialValid === 1`, which changes the constraint system and invalidates
   `age_proof_final.zkey`.

2. **Issuer public keys are private witnesses (ZK-03 / C-1 / R-1).** In every
   credential circuit the issuer key is a private input, so a self-issued
   credential satisfies the in-circuit EdDSA check. Nothing binds the proof to
   an accredited issuer. Confirmed by independent refutation; needs the issuer
   key (or a commitment to an issuer registry root) promoted to a public
   signal, and a new setup.

## Closed since this document was written

**ZK-02 — the OID4VP path did not check `currentTimestamp` against wall-clock
time. FIXED.** A proof could carry an arbitrary `currentTimestamp` public
signal: the context-bound circuits bind nonce and audience, but nothing
rejected a stale or forward-dated evaluation instant. Because the circuit
evaluates the age and expiry predicates *at* that prover-supplied instant, such
a proof is truthful about a statement the verifier never asked — "was eligible
then" rather than "is eligible now".

`verifyZkPredicate` in `backend/src/services/oid4vp/zk-predicate.ts` now checks
the evaluation instant against the verifier's own clock before verifying
anything, and refuses outside the window. The declared window lives on the
policy's ZK binding (`freshness` in
`backend/src/services/oid4vp/policy-presentation.ts`): **300 s backwards, 30 s
ahead**. The backward window matches the proof-context lifetime the human
eligibility path already enforces; the forward allowance covers honest clock
skew only, and is deliberately an order of magnitude smaller because a
predicate evaluated genuinely in the future does not exist.

Three properties make it a real closure rather than a nominal one, each pinned
by `backend/test/oid4vp/zk-predicate-freshness.test.ts`:

- The refusal is a **binding error, not a DENIED decision**. A replayed or
  forward-dated proof must not be audited as a legitimate policy evaluation, so
  it is rejected before `verifyGroth16` is called.
- Every unusable shape of the signal fails closed — absent, empty, signed,
  fractional, exponent or hex notation, and values past `Number.MAX_SAFE_INTEGER`.
- A policy that declares **no** freshness binding is itself refused
  (`INTERNAL_ERROR`), rather than having the check quietly skipped.

Residual dependency: the check is only as strong as the link between the signal
name the policy writes down and the signal the circuit actually publishes.
`verifyZkPredicate` therefore resolves the presented `circuitId` against the
backend circuit registry and refuses unless the circuit declares that signal —
including when the `circuitId` resolves to no known circuit. What that binding
still rests on is the registry itself: each entry's `publicSignals` list is
hand-recorded from the circuit's symbol table (see the note under *Artifact
coverage* below), not derived from the compiled artifact. It must be
re-verified whenever a circuit is rebuilt, and the freshness window is
meaningful only for circuits whose predicates really are evaluated at that
signal.

## Artifact coverage

Only the age circuit has shipped artifacts.

| Circuit | Source | Artifacts | Registry status |
| --- | --- | --- | --- |
| `age_proof` | `circuits/age/age_proof.circom` | wasm + zkey + vkey under `public/circuits/age/` | available |
| `residency_proof` | `circuits/residency/` | none | unavailable |
| `credit_tier_proof` | `circuits/credit/` | none | unavailable |
| `nationality`, `composite`, `threshold`, `bbs`, `accumulator`, `biometric` | `circuits/*` | none | not in the frontend registry |

`circuits/manifest/` holds only `eligibility_v1.json`.

Two backend circuits do have ceremony builds and were verified against their
symbol tables: `age_verification_context_v2`
(`circuits/age/age_context_proof.circom`) and
`eligibility_policy_context_v1`. Both publish **no** public outputs — every
public signal is an input — and both assert their predicate in-circuit
(`expiryCheck.out === 1`, `dobCheck.out === 1`, `ageCompare.out === 0`,
plus the context bindings). They therefore declare `requiredOutputs: []`,
which is satisfied trivially and is not a loosening. The remaining backend
registry entries (`age_verification`, `nationality_check`, `income_range`,
`credential_ownership`, `selective_disclosure`) have no circuit source and no
artifacts; their layout is unknown, so their predicate is left undeclared and
their proofs are refused.

A second, parallel client path exists in `src/hooks/useZKProof.ts`. It fetches
artifacts from `ZK_CIRCUIT_BASE_URL/<circuitType>/` — paths that do not exist —
puts every public signal into `publicInputs` with `publicOutputs: []`, and
verifies on-chain using `circuitId: 0x00…00`. It is inert (no artifacts, no
registered circuit id) and was left alone rather than half-rewired; it must be
either deleted or brought onto the registry before any circuit it names is
built.

## Regression coverage

- `src/lib/zk/__tests__/signals.test.ts` pins `age_proof`'s real layout against
  the `.sym`-derived order and the shipped verification key's `nPublic: 5`
  (cross-checked against the file on disk where `public/circuits/` has been
  deployed — it is gitignored ceremony output), and covers every fail-closed
  branch.
- `src/lib/zk/__tests__/verifier.test.ts` proves a cryptographically valid
  proof carrying `ageVerified = 0` is refused, and that an undeclared or
  unregistered circuit is refused.
- `src/lib/zk/__tests__/prover.test.ts` proves a mis-sized public-signal vector
  is rejected and an unavailable circuit is refused before any fetch.
- `src/lib/aethelred/__tests__/zk-adapter.test.ts` proves the canonical
  on-chain path refuses the same proofs, and pins the outputs-first wire order.
- `src/contexts/__tests__/ProofContext.test.tsx` proves a failing proof is
  never submitted to the backend as a fulfilled verification.
- `backend/test/zk-predicate-enforcement.test.ts` covers the backend gate,
  including a vector laid out inputs-first, which must not be accepted.
