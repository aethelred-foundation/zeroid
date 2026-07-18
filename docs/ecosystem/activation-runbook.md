# ZeroID — Deployment & Activation Runbook

The operational checklist to take ZeroID from "implemented & tested" to "live on
testnet". Each step is a concrete command; nothing here needs new code.

## Pilot critical path (priority order — consultant 2026-06-29)

De-risk the December (ADFW) timeline by proving the **core ZK loop on-chain**
first. Execute in this exact order; defer the esoteric tech.

1. **Apply the DB migration** — §2 (`prisma migrate deploy`). *Blocked on: a
   reachable Postgres.*
2. **Deploy the foundational contracts** — §1 (`forge script Deploy.s.sol`),
   then record addresses into `.env`. *Blocked on: a funded testnet key + RPC.*
3. **Close the W2c (ZK verify) gate** — §3: produce a Groth16 proof from a
   ZeroID circuit, verify via the chain precompile, confirm the snarkjs→arkworks
   byte format, register vkeys, then set `NEXT_PUBLIC_CANONICAL_VERIFY=true`.
   *Blocked on: deployed verifier + a real proof.*
4. **Then** the conditional-disclosure path (escrow → quorum → reveal) on the
   deployed `ConditionalDisclosure`.

**Defer (keep flag-gated) until the base ZK + disclosure paths are stable:**
W3c (TEE/DCAP), W4c (PQC), Phase 2b (zkML liveness). Stand up their real
adapters only afterwards — they are differentiators, not the critical path.

## 0. Environment

Smart-contract deploy (`script/Deploy.s.sol`):

```bash
export AETHELRED_RPC="https://evm-rpc-testnet.aethelred.network"
export ZEROID_ADMIN="0x...account with admin/pauser"
export ZEROID_BURN_SINK="0x...protocol burn address"
export ZEROID_CRUZIBLE_SINK="0x...Cruzible staking sink"
export ZEROID_BURN_BPS=5000           # 50% burn / 50% Cruzible
export ZEROID_DISCLOSURE_THRESHOLD=2  # compliance quorum size
```

App / backend (`.env`):

```bash
DATABASE_URL="postgresql://.../zeroid"
NEXT_PUBLIC_AETHELRED_NETWORK="testnet"          # chain 7332 (canonical; see aethelred ecosystem/manifest.json v2.0.0)
NEXT_PUBLIC_CANONICAL_VERIFY="false"             # flip per gate W2c
NEXT_PUBLIC_AETHELRED_VKEYS='{}'                 # circuitId -> registered vkey hash
NEXT_PUBLIC_PQC_SIGNING="false"                  # flip per gate W4c
NEXT_PUBLIC_CONDITIONAL_DISCLOSURE_ADDRESS="0x..." # from step 1
NEXT_PUBLIC_FEE_ROUTER_ADDRESS="0x..."             # from step 1
OID4VCI_ISSUER_JWK='{"kty":"EC","crv":"P-256",...,"d":"...","kid":"issuer-key-1"}'
                                  # REQUIRED in production (private JWK; boot +
                                  # issuance fail closed without it — audit F1)
OID4VCI_STORAGE_HASH_PEPPER="$(openssl rand -hex 32)"
                                  # REQUIRED in production; keep independent
                                  # from JWT/signing keys and preserve across restarts
OID4VP_ISSUER_JWKS='{"issuer-key-1":{...public jwk...}}' # verifier trust store
```

## 1. Deploy contracts

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url "$AETHELRED_RPC" --broadcast --verify
```
Then grant operational roles (admin):
- `ConditionalDisclosure.grantRole(ESCROW_ISSUER_ROLE, <backend signer>)`
- `ConditionalDisclosure.grantRole(COMPLIANCE_OFFICER_ROLE, <each quorum member>)`
- `*.grantRole(PAUSER_ROLE, <incident responders>)`

Record the two addresses into the app `.env` (above).

## 2. Database migration

```bash
cd backend
npx prisma migrate deploy        # applies the committed ZeroID baseline and
                                 # every later reviewed migration
```

For a database previously provisioned with `prisma db push`, first take and
verify a backup, compare it with `prisma/schema.prisma`, and mark the baseline
as already applied exactly once:

```bash
npx prisma migrate resolve --applied 20260718000000_zeroid_baseline
```

Do not run `db push --accept-data-loss` in testnet or production.

The `20260718010000_oid4vci_atomic_issuance` migration adds nullable token
lease columns. Deploying the corresponding application changes stored offer
codes/access tokens to HMAC digests and encrypts c_nonce values. Existing
short-lived OID4VCI offers and token sessions cannot be migrated without their
plaintext client values, so drain their 10-minute TTL (or explicitly purge
those two ephemeral tables during a maintenance window) before enabling the
new application build.

## 3. Activation gates (flip only after end-to-end verification)

| Gate | Verify | Then flip |
|------|--------|-----------|
| **W2c** ZK verify | produce a Groth16 proof from a ZeroID circuit; verify via the chain precompile; confirm snarkjs→arkworks byte format (G2 limb order/compression) against that proof | register vkeys → set `NEXT_PUBLIC_AETHELRED_VKEYS`, then `NEXT_PUBLIC_CANONICAL_VERIFY=true` |
| **W3c** DCAP | TEE worker emits a real quote; `verifyTeeAttestationCanonical` returns valid; bind to a Digital Seal | wire `attestation.ts` call sites |
| **W4c** PQC | inject a real ML-DSA-65 provider; `signHybrid` round-trips a verifiable hybrid signature | `NEXT_PUBLIC_PQC_SIGNING=true` |
| **Phase 2b** zkML | train model → ONNX → EZKL circuit/keys; register `Circuit`; `verifyLivenessProof` passes on a real proof | add the circuit hash to `NEXT_PUBLIC_AETHELRED_VKEYS` |

## 4. Smoke

```bash
# backend
npx jest && npx tsc --noEmit
# contracts
forge test
# boundary guard
cd .. && npm run boundary:check
# partner endpoints (once DB + contracts live)
curl -XPOST $API/api/v1/partners/wallet/eligibility -H "authorization: Bearer $JWT" -d '{...}'
# idempotent retry: same Idempotency-Key returns the prior result, no double side effect
curl -XPOST $API/api/v1/partners/wallet/eligibility \
  -H "authorization: Bearer $JWT" -H "Idempotency-Key: $(uuidgen)" -d '{...}'
```

Each gate is independent and reversible (flip the flag back). The contracts ship
with `pause()` for incident response.

## 5. Integrator notes

- **Idempotency** (opt-in): the write-bearing endpoints — `ai/agents/eligibility/proof`
  and the partner POSTs (`partners/wallet/eligibility`, `partners/wallet/disclosure`,
  `partners/cruzible/pools/:id/{eligibility,agent-scan}`) — accept an
  `Idempotency-Key` header (1–255 chars). A retry with the same key returns the
  prior terminal response instead of recording a second `AgentAction` /
  re-running eligibility / re-deriving an escrow. Keys are namespaced per
  operation; backed by the `idempotency_records` table. Memoization for
  sequential retries — not a distributed lock (see `services/idempotency.ts`).
- **Errors**: every service maps to a stable `{ "error": <CODE>, "message": ... }`
  envelope via the shared taxonomy in `services/errors.ts`. Canonical codes
  (e.g. `AGENT_NOT_AUTHORIZED` 403, `POLICY_CONDITIONS_NOT_MET` 422,
  `INVALID_IDEMPOTENCY_KEY` 400, `*_NOT_FOUND` 404); unexpected errors are an
  opaque `INTERNAL_ERROR` 500 with no internal details leaked.
