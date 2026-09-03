# ZK circuit remediation scope

Status: open. Three circuits under `circuits/` do not compile. They are
referenced elsewhere in the repository as working features. Nothing compiled
them, so nothing noticed.

`scripts/check-circuit-compilation.mjs` (`npm run circuits:compile:check`) now
compiles every `.circom` file under `circuits/` on every run and holds the
three below in an explicit allowlist. The allowlist may only shrink: the gate
fails if a circuit that is not listed stops compiling, and it also fails if a
listed circuit starts compiling, so a fix cannot land without deleting its
entry from this scope.

## Verified state

circom 2.2.3, circomlib 2.0.5, `circom -l node_modules <file> --r1cs`.

| Circuit                                                 | Result   | Non-linear constraints |
| ------------------------------------------------------- | -------- | ---------------------- |
| `circuits/accumulator/non_revocation_proof.circom`      | compiles | 2,783                  |
| `circuits/age/age_context_proof.circom`                 | compiles | 7,931                  |
| `circuits/age/age_proof.circom`                         | compiles | 7,931                  |
| `circuits/bbs/bbs_selective_disclosure.circom`          | fails    | —                      |
| `circuits/biometric/biometric_match.circom`             | fails    | —                      |
| `circuits/composite/composite_proof.circom`             | compiles | 32,284                 |
| `circuits/credit/credit_tier_proof.circom`              | compiles | 8,083                  |
| `circuits/eligibility/eligibility_context_proof.circom` | compiles | 7,958                  |
| `circuits/nationality/nationality_proof.circom`         | compiles | 10,320                 |
| `circuits/residency/residency_proof.circom`             | compiles | 7,862                  |
| `circuits/threshold/threshold_signature_verify.circom`  | fails    | —                      |

## The three failures

### `circuits/bbs/bbs_selective_disclosure.circom` — `error[T2011]`

> Signal, bus or component declaration inside While scope. Signals, buses and
> components can only be defined in the initial scope or in If scopes with
> known condition

Four declarations sit inside `for` bodies, which circom lowers to while
scopes: `signal selected` (`:75`), `signal accum[N + 1]` (`:76`),
`signal revealedCheck[R + 1]` (`:260`) and `component eqChecks[R]` (`:262`).

Remediation: hoist each declaration into the template's initial scope as an
array indexed by the loop variable — `signal selected[R]`,
`signal accum[R][N + 1]`, and so on — and rewrite the assignments to use the
extra index. The loop bounds `R` and `N` are template parameters, so the array
sizes are known at compile time and no restructuring of the algorithm is
required.

### `circuits/threshold/threshold_signature_verify.circom` — `error[T2011]`

Same error, same cause: `signal numFactor` (`:67`), `signal diff` (`:73`) and
`signal denomFactor` (`:75`) are declared inside the Lagrange-coefficient
loop.

Remediation: hoist the three into the initial scope as `signal numFactor[T]`,
`signal diff[T]` and `signal denomFactor[T]`, indexed by the loop variable
`j`.

### `circuits/biometric/biometric_match.circom` — `error[T2008]`

> Duplicated callable symbol … `LessEqThan` is already in use

The file defines its own `template LessEqThan(n)` at `:80` while also
including `circomlib/circuits/comparators.circom`, which defines the same
template. circom rejects the whole compilation unit; the reported location is
the circomlib definition, not the local one.

Remediation: delete the local `LessEqThan` and use circomlib's, which is
behaviourally the same (`LessThan(n)` on `in[1] + 1`). If the local variant is
kept for any reason, it has to be renamed.

## Scope limits

Compiling is a floor, not a correctness statement. `ZK-PREDICATE-ENFORCEMENT.md`
records circuits that compile and still do not assert their own predicates.
Removing an entry from the allowlist means the file compiles — it does not mean
the circuit has been reviewed, has trusted-setup artifacts, or is safe to
deploy.
