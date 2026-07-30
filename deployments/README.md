# ZeroID deployment artifacts

The canonical fresh Aethelred public-testnet procedure is
[`PUBLIC_TESTNET_RUNBOOK.md`](PUBLIC_TESTNET_RUNBOOK.md). Do not deploy from a
branch name or from an older command copied from chat.

## Canonical identity topology

`script/DeployIdentity.s.sol:DeployIdentity` deploys exactly six contracts:

1. `ZeroID`
2. `ZKCredentialVerifier`
3. `AccumulatorRevocation`
4. `GovernanceModule`
5. `CredentialRegistry`
6. `SelectiveDisclosure`

It writes `deployments/<chainId>.json` only when
`ZEROID_WRITE_MANIFEST=true`. The public-testnet runbook first uses
`ZEROID_WRITE_MANIFEST=false` for a mandatory non-broadcast simulation.
`ZEROID_EXPECTED_CHAIN_ID=7332` prevents deployment through an RPC connected to
another chain.

`script/DeploySupplemental.s.sol:DeploySupplemental` is optional and separate.
It deploys `FeeRouter` and `ConditionalDisclosure`; it is not a replacement for
the six-contract identity suite and its addresses do not belong in the identity
manifest.

## Governance model

Every core contract constructor grants `ZEROID_ADMIN` the default admin role
and its operational roles. That account can pause, grant/revoke roles, and
change governed configuration.

- The deployer is a temporary gas payer and must not be the durable admin.
- The deployment script rejects deployer-as-admin unless
  `ZEROID_ALLOW_DEPLOYER_ADMIN=true` is explicitly set for a throwaway
  environment.
- Testnet uses an approved team-controlled governance account.
- A production network requires reviewed multisignature/timelock custody before
  real credentials are issued.

## Manifest format

```json
{
  "chainId": 7332,
  "blockNumber": 0,
  "timestamp": 0,
  "admin": "0x...",
  "deployer": "0x...",
  "identityRegistry": "0x...",
  "zkVerifier": "0x...",
  "accumulatorRevocation": "0x...",
  "governanceModule": "0x...",
  "credentialRegistry": "0x...",
  "selectiveDisclosure": "0x..."
}
```

The manifest is a candidate until bytecode, constructor relationships, admin
custody, governance values, and transaction receipts are verified. Commit an
accepted manifest through a normal review. Never commit private keys or `.env`
files.

Apply an accepted manifest to a copied frontend environment template:

```bash
cp .env.testnet.example .env.production.local
node scripts/apply-deployment-manifest.mjs \
  --manifest deployments/7332.json \
  --chain-id 7332 \
  --env .env.production.local
```

The updater validates the chain ID, all six nonzero unique EVM addresses, and
replaces stale address lines without changing unrelated configuration.

## Operational roles

Delegate only after each actor address and custody arrangement is reviewed:

| Role                        | Contract                | Actor variable                |
| --------------------------- | ----------------------- | ----------------------------- |
| `ISSUER_ROLE`               | `CredentialRegistry`    | `ZEROID_BACKEND_SIGNER`       |
| `CIRCUIT_MANAGER_ROLE`      | `ZKCredentialVerifier`  | `ZEROID_CIRCUIT_MANAGER`      |
| `REVOCATION_AUTHORITY_ROLE` | `AccumulatorRevocation` | `ZEROID_REVOCATION_AUTHORITY` |

`script/GrantRoles.s.sol:GrantRoles` is safe to rerun because it grants only
roles whose actor variables are set. A multisignature/timelock admin must
execute equivalent reviewed calls through its custody process rather than
exporting an admin key.

Register verification keys only after the trusted-setup artifacts and hashes
are approved. See `ceremony/README.md`; key registration is not part of the base
contract broadcast.
