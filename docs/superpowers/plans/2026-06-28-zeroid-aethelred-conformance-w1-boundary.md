# ZeroID × Aethelred Conformance — W1: Conformance Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `src/lib/aethelred/` conformance boundary that wraps `@aethelred/sdk`, reconcile chain IDs to canonical values, and route ZeroID's first chain capability (ZK proof verification) through it.

**Architecture:** Strangler-fig. One internal module (`src/lib/aethelred/`) becomes the single seam for all canonical chain access (verification, seals, attestation). ZeroID keeps wagmi/viem for the EVM contract plane; the boundary adds the canonical Cosmos-REST plane via the SDK. Later workstreams (W2–W6) migrate subsystems behind this seam and delete the bespoke copies.

**Tech Stack:** TypeScript 5.3, Next.js 14, Jest + ts-jest, `@aethelred/sdk` v1.0.0 (Cosmos REST plane), viem/wagmi (EVM plane).

## Global Constraints

- Node.js >= 20.0.0.
- Canonical chain IDs: **mainnet 8821**, **testnet 88210** (source: `aethelred` `ecosystem/manifest.json`). Never invent chain IDs.
- Canonical proving systems: Groth16 / PLONK / EZKL over BN254. Keep ZeroID's existing Circom/Groth16/BN254 circuits and Solidity/EVM contracts unchanged.
- All new canonical chain access goes through `src/lib/aethelred/` — no direct `@aethelred/sdk` imports elsewhere.
- `@aethelred/sdk` is unpublished (`sdk/version-matrix.json: published:false`); resolve via local `file:` link for dev, git-SHA pin for CI (Task 1).
- SDK verification surface (verified): `createAethelredClient(config: Config | string): AethelredClient`; `new VerificationModule(client).verifyZKProof({ proof: string; publicInputs: string[]; verifyingKeyHash: string; proofSystem?: ProofSystem }): Promise<{ valid: boolean; verificationTimeMs: number; error?: string }>`; `Network.MAINNET|TESTNET`.
- Tests: Jest. Run a single test with `npx jest <path> -t "<name>"`.

## File Structure

- Create `src/lib/aethelred/index.ts` — public surface of the boundary (re-exports).
- Create `src/lib/aethelred/client.ts` — singleton `AethelredClient` factory keyed by network/env.
- Create `src/lib/aethelred/zk.ts` — `verifyZkProofCanonical()` mapping ZeroID proof shape → SDK `verifyZKProof`.
- Create `src/lib/aethelred/__tests__/client.test.ts`, `src/lib/aethelred/__tests__/zk.test.ts`.
- Create `src/lib/aethelred/__tests__/sdk-smoke.test.ts` — proves the dependency resolves.
- Modify `package.json` — add `@aethelred/sdk` dependency.
- Modify `src/config/chains.ts:13-15` — chain IDs 7331/7332/7333 → 8821/88210/(devnet).
- Modify `src/config/__tests__/chains.test.ts` — assert canonical IDs.

---

### Task 1: Resolve & wire the `@aethelred/sdk` dependency

**Files:**
- Modify: `package.json` (dependencies)
- Test: `src/lib/aethelred/__tests__/sdk-smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an importable `@aethelred/sdk` exposing `VERSION: string`, `createAethelredClient`, `VerificationModule`, `SealsModule`, `Network`.

- [ ] **Step 1: Build the canonical SDK locally**

Run:
```bash
cd /Users/rameshtamilselvan/Downloads/aethelred/sdk/typescript && npm install && npm run build
```
Expected: `dist/index.js`, `dist/index.d.ts` exist (`ls dist/index.*`).

- [ ] **Step 2: Write the failing smoke test**

Create `src/lib/aethelred/__tests__/sdk-smoke.test.ts`:
```ts
import { VERSION, createAethelredClient } from "@aethelred/sdk";

describe("@aethelred/sdk dependency", () => {
  it("resolves the canonical SDK at v1.0.0", () => {
    expect(VERSION).toBe("1.0.0");
  });
  it("exposes a client factory", () => {
    expect(typeof createAethelredClient).toBe("function");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /Users/rameshtamilselvan/Downloads/zeroid && npx jest src/lib/aethelred/__tests__/sdk-smoke.test.ts`
Expected: FAIL — `Cannot find module '@aethelred/sdk'`.

- [ ] **Step 4: Add the dependency (local file link for dev)**

In `package.json` `dependencies`, add:
```json
"@aethelred/sdk": "file:../aethelred/sdk/typescript",
```
Then run: `cd /Users/rameshtamilselvan/Downloads/zeroid && npm install`
Note for CI/prod: replace with `"@aethelred/sdk": "git+https://github.com/aethelred-foundation/aethelred-sdk-ts.git#<pinned-sha>"` tracked against `sdk/version-matrix.json`.

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `npx jest src/lib/aethelred/__tests__/sdk-smoke.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/aethelred/__tests__/sdk-smoke.test.ts
git commit -m "feat(aethelred): wire @aethelred/sdk dependency (local file link)"
```

---

### Task 2: Conformance boundary client

**Files:**
- Create: `src/lib/aethelred/client.ts`
- Create: `src/lib/aethelred/index.ts`
- Test: `src/lib/aethelred/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `createAethelredClient`, `Network`, `VerificationModule`, `SealsModule` from `@aethelred/sdk`.
- Produces: `getAethelredClient(): AethelredClient`; `getVerificationModule(): VerificationModule`; `getSealsModule(): SealsModule`; `resetAethelredClient(): void` (test seam).

- [ ] **Step 1: Write the failing test**

Create `src/lib/aethelred/__tests__/client.test.ts`:
```ts
import { getAethelredClient, getVerificationModule, resetAethelredClient } from "@/lib/aethelred/client";
import { VerificationModule } from "@aethelred/sdk";

describe("aethelred boundary client", () => {
  afterEach(() => resetAethelredClient());

  it("returns a singleton client", () => {
    expect(getAethelredClient()).toBe(getAethelredClient());
  });

  it("exposes a VerificationModule", () => {
    expect(getVerificationModule()).toBeInstanceOf(VerificationModule);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/lib/aethelred/__tests__/client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/aethelred/client'`.

- [ ] **Step 3: Implement the client factory**

Create `src/lib/aethelred/client.ts`:
```ts
import {
  createAethelredClient,
  Network,
  VerificationModule,
  SealsModule,
  type AethelredClient,
} from "@aethelred/sdk";

function resolveNetwork(): Network {
  return process.env.NEXT_PUBLIC_AETHELRED_NETWORK === "mainnet"
    ? Network.MAINNET
    : Network.TESTNET;
}

let client: AethelredClient | null = null;

export function getAethelredClient(): AethelredClient {
  if (!client) {
    client = createAethelredClient({ network: resolveNetwork() });
  }
  return client;
}

export function getVerificationModule(): VerificationModule {
  return new VerificationModule(getAethelredClient());
}

export function getSealsModule(): SealsModule {
  return new SealsModule(getAethelredClient());
}

export function resetAethelredClient(): void {
  client = null;
}
```

Create `src/lib/aethelred/index.ts`:
```ts
export {
  getAethelredClient,
  getVerificationModule,
  getSealsModule,
  resetAethelredClient,
} from "./client";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/aethelred/__tests__/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/aethelred/client.ts src/lib/aethelred/index.ts src/lib/aethelred/__tests__/client.test.ts
git commit -m "feat(aethelred): conformance boundary client (verification + seals modules)"
```

---

### Task 3: Reconcile chain IDs to canonical values

**Files:**
- Modify: `src/config/chains.ts:13-15`
- Test: `src/config/__tests__/chains.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AETHELRED_MAINNET_ID === 8821`, `AETHELRED_TESTNET_ID === 88210`.

- [ ] **Step 1: Write the failing test**

Add to `src/config/__tests__/chains.test.ts`:
```ts
import { AETHELRED_MAINNET_ID, AETHELRED_TESTNET_ID } from "@/config/chains";

describe("canonical chain IDs (ecosystem/manifest.json)", () => {
  it("mainnet is 8821", () => expect(AETHELRED_MAINNET_ID).toBe(8821));
  it("testnet is 88210", () => expect(AETHELRED_TESTNET_ID).toBe(88210));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/config/__tests__/chains.test.ts -t "canonical chain IDs"`
Expected: FAIL — received 7331 / 7332.

- [ ] **Step 3: Update the constants**

In `src/config/chains.ts`, replace lines 13-15:
```ts
export const AETHELRED_MAINNET_ID = 8821;
export const AETHELRED_TESTNET_ID = 88210;
export const AETHELRED_DEVNET_ID = 88211;
```

- [ ] **Step 4: Run the full chains test to verify it passes and nothing regressed**

Run: `npx jest src/config/__tests__/chains.test.ts`
Expected: PASS (all tests). If an existing test asserts 7332, update it to 88210.

- [ ] **Step 5: Commit**

```bash
git add src/config/chains.ts src/config/__tests__/chains.test.ts
git commit -m "fix(config): reconcile chain IDs to canonical 8821/88210 (ecosystem manifest)"
```

---

### Task 4: Route ZK proof verification through the boundary

**Files:**
- Create: `src/lib/aethelred/zk.ts`
- Modify: `src/lib/aethelred/index.ts`
- Test: `src/lib/aethelred/__tests__/zk.test.ts`

**Interfaces:**
- Consumes: `getVerificationModule()` from `./client`; `VerifyZKProofRequest`/`VerifyZKProofResponse` shapes from `@aethelred/sdk`.
- Produces: `verifyZkProofCanonical(input: ZeroIdProofInput): Promise<{ valid: boolean; verificationTimeMs: number; error?: string }>` where `ZeroIdProofInput = { proof: string; publicInputs: string[]; verifyingKeyHash: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/aethelred/__tests__/zk.test.ts`:
```ts
import { verifyZkProofCanonical } from "@/lib/aethelred/zk";
import * as boundary from "@/lib/aethelred/client";

describe("verifyZkProofCanonical", () => {
  it("maps ZeroID proof input to the SDK request and returns the result", async () => {
    const verifyZKProof = jest
      .fn()
      .mockResolvedValue({ valid: true, verificationTimeMs: 12 });
    jest
      .spyOn(boundary, "getVerificationModule")
      .mockReturnValue({ verifyZKProof } as never);

    const result = await verifyZkProofCanonical({
      proof: "0xabc",
      publicInputs: ["1", "0"],
      verifyingKeyHash: "0xvk",
    });

    expect(verifyZKProof).toHaveBeenCalledWith({
      proof: "0xabc",
      publicInputs: ["1", "0"],
      verifyingKeyHash: "0xvk",
    });
    expect(result.valid).toBe(true);
    expect(result.verificationTimeMs).toBe(12);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/lib/aethelred/__tests__/zk.test.ts`
Expected: FAIL — `Cannot find module '@/lib/aethelred/zk'`.

- [ ] **Step 3: Implement the mapper**

Create `src/lib/aethelred/zk.ts`:
```ts
import { getVerificationModule } from "./client";

export interface ZeroIdProofInput {
  proof: string;
  publicInputs: string[];
  verifyingKeyHash: string;
}

export interface CanonicalVerifyResult {
  valid: boolean;
  verificationTimeMs: number;
  error?: string;
}

export async function verifyZkProofCanonical(
  input: ZeroIdProofInput,
): Promise<CanonicalVerifyResult> {
  const verification = getVerificationModule();
  const res = await verification.verifyZKProof({
    proof: input.proof,
    publicInputs: input.publicInputs,
    verifyingKeyHash: input.verifyingKeyHash,
  });
  return {
    valid: res.valid,
    verificationTimeMs: res.verificationTimeMs,
    error: res.error,
  };
}
```

Add to `src/lib/aethelred/index.ts`:
```ts
export { verifyZkProofCanonical, type ZeroIdProofInput, type CanonicalVerifyResult } from "./zk";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/aethelred/__tests__/zk.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full boundary suite + type-check**

Run: `npx jest src/lib/aethelred && npm run type-check`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aethelred/zk.ts src/lib/aethelred/index.ts src/lib/aethelred/__tests__/zk.test.ts
git commit -m "feat(aethelred): route ZK proof verification through the conformance boundary"
```

---

## Self-Review

- **Spec coverage (W1 of the design spec):** boundary module (Task 2) ✓; SDK dependency resolution / D5 (Task 1) ✓; chain-id reconciliation to 8821/88210 (Task 3) ✓; first capability on the rail (Task 4, thin slice of W2) ✓. W2–W6 and Phases 2–3 are deferred to their own plans (scope-checked).
- **Placeholder scan:** all code steps contain real code; the only deferred value (CI git-SHA dep) is an explicit note with a concrete dev default, not a code placeholder.
- **Type consistency:** `verifyZkProofCanonical` consumes `getVerificationModule()` (Task 2) and the verified `verifyZKProof({proof, publicInputs, verifyingKeyHash})` signature; `Network`/`createAethelredClient` usage matches the SDK `core/config.ts`/`index.ts` exports read during the audit.
- **Open item flagged for protocol team (not a blocker for W1):** confirm whether the EVM JSON-RPC plane exposes chain IDs 8821/88210 identically to the Cosmos `chain_id`; if the EVM numeric id differs, Task 3 values are updated from the authoritative chain config in a follow-up. The manifest value is used as source of truth here.
