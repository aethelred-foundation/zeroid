# ZeroID deployments

Source of truth for the deployed ZeroID identity contracts and the governance
model behind them. Each `<chainId>.json` in this directory is written by
`script/DeployIdentity.s.sol` and committed — the addresses live here, not in a
paste in someone's `.env`.

## Governance model (read before deploying)

Every core contract's constructor grants the **admin** address
`DEFAULT_ADMIN_ROLE` plus every operational role — it is total authority
(upgrade parameters, pause, grant/revoke roles). Two rules follow:

1. **Admin ≠ deployer.** The deployer is a hot key that only pays gas; it should
   not end up as the permanent authority. Pass `ZEROID_ADMIN` explicitly. The
   deploy script refuses to make the deployer the admin unless you opt in with
   `ZEROID_ALLOW_DEPLOYER_ADMIN=true` (acceptable on a throwaway testnet, never
   for mainnet).
2. **Admin custody scales with the network.**
   - **Testnet:** a team-controlled key (or a simple multisig) is fine.
   - **Mainnet:** the admin MUST be a **multisig (e.g. Safe) behind a timelock**.
     Migrate roles to it before any real credentials are issued.

## Deploy (the one command)

From the repo root, with a **funded deployer** key and a **durable admin**:

```bash
PRIVATE_KEY=0x<funded-gas-payer> \
ZEROID_ADMIN=0x<durable-governance-account> \
forge script script/DeployIdentity.s.sol:DeployIdentity \
  --rpc-url http://<validator-ip>:8545 --broadcast --legacy --slow --gas-estimate-multiplier 200
```

Optional: `ZEROID_VOTING_PERIOD` (governance voting period, seconds; default
3 days), `ZEROID_QUORUM` (default 1).

The run prints the six addresses in `NEXT_PUBLIC_*` form (paste into
`.env.local`, template `.env.testnet.example`) **and** writes
`deployments/<chainId>.json`. Commit that manifest.

## Manifest format (`<chainId>.json`)

```json
{
  "chainId": 7332,
  "blockNumber": 0,
  "timestamp": 0,
  "admin": "0x…",
  "deployer": "0x…",
  "identityRegistry": "0x…",
  "zkVerifier": "0x…",
  "accumulatorRevocation": "0x…",
  "governanceModule": "0x…",
  "credentialRegistry": "0x…",
  "selectiveDisclosure": "0x…"
}
```

## Operational roles (grant when the actors exist)

The deploy gives the admin everything. As real operators come online, the admin
delegates specific roles with `script/GrantRoles.s.sol` (each granted only if its
env var is set, so it is safe to re-run):

| Role | Contract | Actor env var | Who |
| ---- | -------- | ------------- | --- |
| `ISSUER_ROLE` | CredentialRegistry | `ZEROID_BACKEND_SIGNER` | the backend credential signer |
| `CIRCUIT_MANAGER_ROLE` | ZKCredentialVerifier | `ZEROID_CIRCUIT_MANAGER` | registers the trusted-setup verifying keys (`ceremony/`) |
| `REVOCATION_AUTHORITY_ROLE` | AccumulatorRevocation | `ZEROID_REVOCATION_AUTHORITY` | the revocation service |

```bash
ZEROID_ADMIN_KEY=0x<admin-key> \
NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS=0x.. NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=0x.. \
NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS=0x.. \
ZEROID_BACKEND_SIGNER=0x.. \
forge script script/GrantRoles.s.sol:GrantRoles --rpc-url http://<validator-ip>:8545 --broadcast --legacy --slow
```

## Checklist for a "run once, correctly" deploy

- [ ] `ZEROID_ADMIN` set to a durable account (multisig for mainnet).
- [ ] Deployer funded on the target chain.
- [ ] `deployments/<chainId>.json` committed after the run.
- [ ] `.env.local` filled from the printed `NEXT_PUBLIC_*` addresses.
- [ ] Operational roles granted to their actors (`GrantRoles`) once they exist.
- [ ] Verification keys registered on-chain once the ceremony is finalized —
      `ceremony/scripts/07-register-vkeys.sh --broadcast` with the
      `CIRCUIT_MANAGER_ROLE` key (registers into the `ZKCredentialVerifier` from
      this manifest; see `ceremony/README.md`).
- [ ] (Mainnet) admin migrated to a multisig + timelock before real issuance.
