# ZeroID × Aethelred Conformance — W2: ZK Verification Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Route ZeroID's proof verification through the canonical boundary (chain ZK precompile via `@aethelred/sdk`), retire the bespoke snarkjs *runtime verification* and the bespoke on-chain verifier, while keeping ZeroID's Circom/Groth16 *proving*.

**Architecture:** Strangler-fig continuation of W1. A canonical verification adapter in `src/lib/aethelred/` converts ZeroID `ZKProof` objects to the canonical `VerifyZKProofRequest` wire shape and returns ZeroID's `ProofVerification`. Call sites cut over to the canonical path; the snarkjs path is retained as a labelled fallback until a live-node equivalence test confirms byte-exact wire compatibility (then deleted in W2c).

**Tech Stack:** TypeScript, Jest, `@aethelred/sdk` VerificationModule.

## Global Constraints

- Canonical wire format (source: `aethelred` `proto/aethelred/verify/v1/verify.proto` + `sdk/spec/openapi.yaml`):
  - `VerifyZKProofRequest.proof`: base64 of canonical proof bytes.
  - `publicInputs`: array of base64-encoded 32-byte big-endian field elements.
  - `verifyingKeyHash`: base64 of the on-chain-registered verifying-key hash.
  - `proofSystem`: `ProofSystem.GROTH16 = 'PROOF_SYSTEM_GROTH16'`.
- BN254 field elements are < 2^254 → fixed 32-byte big-endian encoding.
- All canonical access via `src/lib/aethelred/` only.
- **Gate:** do NOT delete the snarkjs runtime-verify path until W2c (live-node equivalence) passes. Byte-exact proof serialization (G2 Fp2 limb order, point compression) is UNVERIFIED until then.

## Staging

- **W2a (this plan):** encoding helpers + `ZKProof → VerifyZKProofRequest` mapper + `verifyZeroIdProofCanonical` returning `ProofVerification`. Unit-tested for everything provable without a node.
- **W2b:** cut over `src/contexts/ProofContext.tsx` to the canonical path behind `NEXT_PUBLIC_CANONICAL_VERIFY`, dual-running with snarkjs for equivalence logging. A verifying-key-hash registry (`circuitId → registered vkey hash`).
- **W2c (gated on live testnet):** equivalence test on a fixture corpus; on green, delete `verifyProofLocally`/`verifyRawProof`/`verifyProofBatch` and the bespoke `ZKCredentialVerifier.sol` verification, leaving the precompile call.

---

### Task 1: Canonical field-element & proof encoding

**Files:**
- Create: `src/lib/aethelred/encoding.ts`
- Test: `src/lib/aethelred/__tests__/encoding.test.ts`

**Interfaces:**
- Produces: `fieldElementToBytes(decimal: string): Uint8Array` (32-byte BE); `toBase64(bytes: Uint8Array): string`; `encodePublicInput(decimal: string): string` (base64 of 32-byte BE); `serializeGroth16ProofUncompressed(proof: { a: [string,string]; b: [[string,string],[string,string]]; c: [string,string] }): string` (base64; G1‖G2‖G1 uncompressed, 256 bytes).

- [ ] **Step 1: Write the failing test** (field element + base64 + proof structure)
- [ ] **Step 2: Run, verify fail** (`npx jest src/lib/aethelred/__tests__/encoding.test.ts`)
- [ ] **Step 3: Implement `encoding.ts`**
- [ ] **Step 4: Run, verify pass**
- [ ] **Step 5: Commit** (`feat(aethelred): canonical ZK wire encoding (field elements, proof bytes)`).

### Task 2: ZKProof → canonical verify adapter

**Files:**
- Modify: `src/lib/aethelred/zk.ts`, `src/lib/aethelred/index.ts`
- Test: `src/lib/aethelred/__tests__/zk-adapter.test.ts`

**Interfaces:**
- Consumes: `encoding.ts`, `getVerificationModule()`, ZeroID `ZKProof`/`ProofVerification` types, SDK `ProofSystem`.
- Produces: `zkProofToVerifyRequest(zkProof: ZKProof, verifyingKeyHash: string): VerifyZKProofRequest`; `verifyZeroIdProofCanonical(zkProof: ZKProof, verifyingKeyHash: string): Promise<ProofVerification>`.

- [ ] **Step 1: Write failing test** (maps proofSystem→GROTH16, encodes public signals, returns ProofVerification with circuitId/proofHash; invalid + error propagation)
- [ ] **Step 2: Run, verify fail**
- [ ] **Step 3: Implement adapter in `zk.ts`, export from `index.ts`**
- [ ] **Step 4: Run, verify pass + `npm run type-check`**
- [ ] **Step 5: Commit** (`feat(aethelred): ZKProof → canonical verify adapter`).

---

## Self-Review

- Spec coverage: W2a maps to spec §6 W2 "route verification to SDK verifyZKProof/precompile" + §8 equivalence gating. W2b/W2c staged.
- Placeholders: none in W2a code; W2c byte-exactness explicitly gated, not guessed.
- Types: `verifyZeroIdProofCanonical` returns ZeroID `ProofVerification` (drop-in for `verifyProofLocally`); consumes verified SDK `VerifyZKProofRequest` shape.
