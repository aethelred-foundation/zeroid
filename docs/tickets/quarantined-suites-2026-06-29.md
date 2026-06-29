# Quarantined test suites — tracking tickets

Opened 2026-06-29, per consultant guidance: quarantine the two failing suites so
they stop blocking CI / the testnet pilot, and resolve **before mainnet**. Both
failures are pre-existing (verified independent of recent idempotency / error-
taxonomy work by stash isolation) and neither is a regression.

---

## ZER-CI-1 — `backend/test/circuit-artifacts.test.ts` (HIGH, pre-mainnet)

**State:** quarantined via `describe.skip(...)` (the suite loads fine; only its
assertions fail).

**Symptom:** 3 tests fail with `Circuit manifest directory missing at
circuits/manifest`.

**Root cause:** `validateCircuitArtifacts()` resolves the circuit manifest
relative to the process working directory. Under Jest the cwd is `backend/`, so
it looks for `backend/circuits/manifest`, but the artifacts live at the repo
root (`circuits/manifest`, `circuits/eligibility`). The path is not anchored.

**Fix options:**
- Make the manifest root injectable (pass an explicit base path; default to a
  repo-root anchor resolved from `__dirname`, not `process.cwd()`), **or**
- Have the test build a self-contained circuit fixture (it already has a
  `createCircuitFixture()` helper) and point validation at it.

**Acceptance:** remove `.skip`; `npx jest circuit-artifacts` green from any cwd.

---

## ZER-CI-2 — `backend/test/enterprise-compliance-receipts.test.ts` (HIGH, pre-mainnet)

**State:** quarantined by renaming to
`enterprise-compliance-receipts.test.ts.quarantined` (jest `testMatch` is
`**/*.test.ts`, so the suffix excludes it). `describe.skip` is insufficient
because the suite crashes at **import time**, before any `describe` runs.

**Symptom:** "Test suite failed to run — `TypeError: Cannot read properties of
undefined (reading 'operationType')` at `src/routes/enterprise/compliance.ts:114`",
triggered by the side-effect import `import '../src/routes/enterprise/compliance'`.

**Root cause:** the test mocks the module that exports
`ComplianceEvaluationRequestSchema`. At module load, `compliance.ts:114` does
`ComplianceEvaluationRequestSchema.shape.operationType.optional().default(...)`;
with the mock in place `.shape` is `undefined`, so reading `.operationType`
throws. **This is a test-harness defect, not a product boot bug** — the real
zod schema has `.shape`, so the route imports correctly in the running server.

**Fix options:**
- In the test, mock the schema module with `jest.requireActual(...)` (or provide
  a stub whose `ComplianceEvaluationRequestSchema.shape.operationType` is a real
  zod field), **or**
- Refactor `compliance.ts` so the request schemas are built lazily (inside the
  handler / a factory) rather than at module top-level, removing import-time
  coupling to `.shape`.

**Acceptance:** rename back to `.test.ts`; the suite loads and passes.

---

_When both are resolved, delete this file._
