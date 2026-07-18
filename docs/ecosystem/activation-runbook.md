# ZeroID — Deployment & Activation Runbook

The operational checklist for a hardened testnet deployment. Several cryptographic
and evidence capabilities intentionally remain unavailable and require reviewed
implementation work; running these commands alone does not make them live.

## Pilot critical path (priority order — consultant 2026-06-29)

De-risk the December (ADFW) timeline by proving the **core ZK loop on-chain**
first. Execute in this exact order; defer the esoteric tech.

1. **Apply every reviewed DB migration** — §2 (`prisma migrate deploy`) against
   a backed-up target database.
2. **Complete the signed-witness eligibility pipeline** — validate a
   provider-signed credential, run the real Groth16 prover, and verify the proof
   against audited, digest-pinned artifacts.
3. **Add durable relying-party challenges and atomic evidence persistence** —
   challenge consumption, state revalidation, proof result, decision, and sealed
   audit evidence must commit together. Agent flows also require a signed,
   one-time agent-operation challenge.
4. **Deploy the foundational contracts** — §1 (`forge script Deploy.s.sol`),
   then record reviewed addresses and roles in deployment evidence.
5. **Close the W2c on-chain verification gate** — verify a known Groth16 proof
   via the target precompile, confirm byte compatibility, and register the exact
   pinned verification key before changing client configuration.
6. **Activate conditional disclosure only after** the persisted quorum escrow
   and end-to-end authorization path are implemented and exercised.

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
# Partner eligibility must fail closed until the proof/challenge gate is complete.
# Confirm the response is HTTP 503 with PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE
# or the upstream ZK availability code; do not accept a decision or receipt.
curl -XPOST $API/api/v1/partners/wallet/eligibility -H "authorization: Bearer $JWT" -d '{...}'
```

Each gate is independent and reversible (flip the flag back). The contracts ship
with `pause()` for incident response.

## 5. Integrator notes

- **Unavailable surfaces:** human, agent, and partner eligibility must not be
  enabled by configuration alone. An `Idempotency-Key` does not replace either
  one-time challenge and must not turn an unavailable response into cached proof
  evidence. Wallet disclosure and partner evidence retrieval also fail closed
  until their durable backing services exist.
- **Errors**: every service maps to a stable `{ "error": <CODE>, "message": ... }`
  envelope via the shared taxonomy in `services/errors.ts`. Canonical codes
  (e.g. `AGENT_NOT_AUTHORIZED` 403, `POLICY_CONDITIONS_NOT_MET` 422,
  `INVALID_IDEMPOTENCY_KEY` 400, `*_NOT_FOUND` 404); unexpected errors are an
  opaque `INTERNAL_ERROR` 500 with no internal details leaked.
