# ZeroID — Deployment & Activation Runbook

The operational checklist to take ZeroID from "implemented & tested" to "live on
testnet". Each step is a concrete command; nothing here needs new code.

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
NEXT_PUBLIC_AETHELRED_NETWORK="testnet"          # chain 88210
NEXT_PUBLIC_CANONICAL_VERIFY="false"             # flip per gate W2c
NEXT_PUBLIC_AETHELRED_VKEYS='{}'                 # circuitId -> registered vkey hash
NEXT_PUBLIC_PQC_SIGNING="false"                  # flip per gate W4c
NEXT_PUBLIC_CONDITIONAL_DISCLOSURE_ADDRESS="0x..." # from step 1
NEXT_PUBLIC_FEE_ROUTER_ADDRESS="0x..."             # from step 1
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
npx prisma migrate deploy        # applies migrations/20260629000000_ai_agent_passport_v1
# (or, to regenerate canonically:  npx prisma migrate dev --name ai_agent_passport_v1)
```

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
```

Each gate is independent and reversible (flip the flag back). The contracts ship
with `pause()` for incident response.
