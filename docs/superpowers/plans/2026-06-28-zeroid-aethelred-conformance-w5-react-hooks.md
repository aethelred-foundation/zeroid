# ZeroID × Aethelred Conformance — W5: Canonical React Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Adopt the canonical `@aethelred/sdk/react` hooks for ZeroID's chain operations (seal fetch/verify, job status) via the boundary, instead of bespoke chain-query hooks.

**Architecture:** Strangler-fig. Thin boundary hooks in `src/lib/aethelred/react.ts` inject the boundary client (`getAethelredClient()`) into the SDK's client-parametrized hooks, so ZeroID components consume canonical hooks without managing the client. ZeroID's own backend-domain hooks (credentials/identity against its Express API) are out of scope and unchanged.

**Tech Stack:** TypeScript, React 18, Jest + @testing-library/react.

## Global Constraints

- SDK react hooks (verified): `useSeal(client, sealId, options?)`, `useSealVerification(client, sealId, options?)`, `useJob(client, jobId, options?)`, `useAethelredQuery`. All accept `client | null | undefined` and self-disable when null. Return `AethelredQueryState<T> = { status, data, error, loading, refresh }`.
- All canonical access via `src/lib/aethelred/` only.
- Only chain-operation hooks are adopted; ZeroID backend hooks stay.

---

### Task 1: Boundary react hooks

**Files:** Create `src/lib/aethelred/react.ts`; Test `src/lib/aethelred/__tests__/react.test.tsx`; Modify `src/lib/aethelred/index.ts`.

**Interfaces:**
- Produces: `useSeal(sealId, options?)`, `useSealVerification(sealId, options?)`, `useJob(jobId, options?)` (client injected); re-exports `useAethelredQuery`.

- [ ] Step 1: Write failing test (each wrapper forwards the boundary client to the SDK hook).
- [ ] Step 2: Run, verify fail.
- [ ] Step 3: Implement wrappers; export from index.
- [ ] Step 4: Run, verify pass + type-check.
- [ ] Step 5: Commit (`feat(aethelred): canonical react hooks (client-injected useSeal/useJob)`).

---

## Self-Review

- Spec coverage: spec §6 W5 "adopt @aethelred/sdk/react". Backend-domain hooks intentionally out of scope.
- Placeholders: none.
- Types: option/return types derived from the SDK hooks via `Parameters<>`; no fragile re-typing.
