# ZeroID public-testnet deployment runbook

Status: deployment candidate; no transaction has been broadcast from this
repository branch.

This is the only ZeroID fresh-deployment procedure for the Aethelred public
testnet. `deployments/README.md`, `.env.example`,
`.env.testnet.example`, and `backend/.env.testnet.example` are subordinate to
this runbook.

## 1. Scope and non-goals

The public-testnet deployment is exactly this dependency-ordered identity
topology:

1. `ZeroID` - identity registry
2. `ZKCredentialVerifier` - registered circuit verification keys
3. `AccumulatorRevocation` - revocation state
4. `GovernanceModule` - identity governance
5. `CredentialRegistry` - constructed with `ZeroID` and `GovernanceModule`
6. `SelectiveDisclosure` - constructed with `CredentialRegistry` and
   `ZKCredentialVerifier`

The deploy entry point is
`script/DeployIdentity.s.sol:DeployIdentity`.

`script/DeploySupplemental.s.sol:DeploySupplemental` is a separate, optional
deployment for `FeeRouter` and `ConditionalDisclosure`. Do not run it as part
of this procedure and do not add its addresses to the identity manifest.

This procedure:

- does not reset the chain, replace genesis, or delete application data;
- does not require a chain upgrade handler or a software-upgrade proposal;
- does not change EVM parameters;
- does not depend on the staking/distribution precompile activation proposal;
- does not activate unfinished cryptographic or external-provider surfaces by
  configuration alone.

## 2. Immutable release and toolchain

Use these reviewed pins. A branch name is not a deployment input.

```bash
export ZEROID_RELEASE_SHA="<approved-40-character-sha>"
export AETHELRED_SDK_SHA=20d6060adc91860736f4ba619fe29cbda54b2cf7
```

Both values must contain exactly 40 lowercase hexadecimal characters:

```bash
case "$ZEROID_RELEASE_SHA" in
  (*[!0-9a-f]*|"") echo "invalid ZEROID_RELEASE_SHA"; exit 1 ;;
esac
test "${#ZEROID_RELEASE_SHA}" -eq 40
test "${#AETHELRED_SDK_SHA}" -eq 40
```

Validated toolchain:

| Tool                      | Version                             |
| ------------------------- | ----------------------------------- |
| Git                       | 2.50.1                              |
| Node.js                   | 20.19.5                             |
| npm                       | 10.8.2                              |
| Foundry (`forge`, `cast`) | 1.5.1                               |
| Solidity compiler         | 0.8.28 (enforced by `foundry.toml`) |
| Rust                      | 1.85.0                              |
| Go                        | 1.25.12                             |
| Docker Engine             | 28.4.0                              |
| Docker Compose            | 2.39.4                              |
| jq                        | 1.7.1                               |

Use the exact Node/npm versions for release builds. Rust and Go are needed for
the complete repository validation gate, not to run the frontend or API. Shell
commands in this runbook assume Bash.

## 3. Required operator inputs

Do not start the broadcast until every required input has an owner and a
reviewed value.

| Input                         | Required | Rule                                                                                                  |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| EVM RPC URL                   | yes      | Must return chain ID `7332`; operator browsers must be able to reach the configured browser RPC       |
| Gas-paying deployer           | yes      | Dedicated testnet key, funded with native AETHEL; not the long-lived admin                            |
| `ZEROID_ADMIN`                | yes      | Durable governance account; must not be the deployer                                                  |
| Voting period                 | yes      | Seconds, within the contract's 1-to-30-day bounds; recommended testnet value `259200`                 |
| Quorum                        | yes      | Positive integer approved by the governance owner                                                     |
| Frontend origin               | yes      | Exact scheme, host, and port; canonical service port is `3003`                                        |
| API origin                    | yes      | Exact scheme, host, and port; canonical service port is `4003`                                        |
| Database storage/backup owner | yes      | Persistent Postgres volume and a tested backup location                                               |
| TLS/reverse-proxy decision    | yes      | HTTPS is preferred; direct HTTP requires the explicit testnet gate                                    |
| Backend secrets               | yes      | Three independent random values: database password, JWT secret, OID4VCI storage pepper                |
| Operational role accounts     | later    | Backend issuer, circuit manager, and revocation authority; roles may remain with admin until reviewed |
| Circuit artifacts and digests | later    | Required before canonical proof verification can be marked ready                                      |

Current public-testnet endpoints supplied by the operations team are:

```text
EVM RPC:       http://54.165.44.130:8545
Frontend:      http://93.127.132.52:3003
Backend API:   http://93.127.132.52:4003
EVM chain ID:  7332 (0x1ca4)
```

Treat these as operator inputs, not permanent protocol constants. Confirm them
again before building because frontend URLs are compiled into the browser
bundle.

## 4. Fresh immutable checkout

Use sibling checkouts because ZeroID consumes the Aethelred TypeScript SDK by
file path.

```bash
install -d "$PWD/zeroid-release"
cd "$PWD/zeroid-release"

git clone https://github.com/aethelred-foundation/aethelred.git aethelred
git -C aethelred fetch --prune origin "$AETHELRED_SDK_SHA"
git -C aethelred switch --detach "$AETHELRED_SDK_SHA"
test "$(git -C aethelred rev-parse HEAD)" = "$AETHELRED_SDK_SHA"

git clone https://github.com/aethelred-foundation/zeroid.git zeroid
git -C zeroid fetch --prune origin "$ZEROID_RELEASE_SHA"
git -C zeroid switch --detach "$ZEROID_RELEASE_SHA"
test "$(git -C zeroid rev-parse HEAD)" = "$ZEROID_RELEASE_SHA"
test -z "$(git -C zeroid status --porcelain)"
```

Do not deploy from a working directory with uncommitted changes. Record both
full SHAs in the deployment evidence.

Build the pinned sibling SDK before installing ZeroID:

```bash
cd aethelred/sdk/typescript
npm ci
npm run build
cd ../../../zeroid
```

## 5. Source validation gate

No command in this section broadcasts a transaction.

```bash
npm ci
npm --prefix backend ci

npm run lint
npm run type-check
npm run format:check
npm run boundary:check
npm run circuits:validate
npm run routes:validate
npm run workflows:validate
npm run deployments:test
npm run test:ci
npm run build

npm --prefix backend run lint
npm --prefix backend run type-check
npm --prefix backend test
npm --prefix backend run build

forge clean
forge build
forge test -vv

(cd crates/zeroid-tee && cargo fmt -- --check && cargo test)
(cd sdk/go && go test ./...)
```

Stop if any required gate fails. Do not serve an older `.next`, `dist`, or
contract artifact directory after a failed build.

## 6. Read-only network preflight

```bash
export AETHELRED_RPC_URL=http://54.165.44.130:8545
export ZEROID_EXPECTED_CHAIN_ID=7332

test "$(cast chain-id --rpc-url "$AETHELRED_RPC_URL")" = "7332"
cast block-number --rpc-url "$AETHELRED_RPC_URL"
cast block latest --rpc-url "$AETHELRED_RPC_URL"
```

Confirm that the RPC is stable, the block height advances, and all validators
report the agreed chain revision. ZeroID does not need a new upgrade handler.
If a separate governance proposal is in progress, wait for its final status and
post-proposal network-health checks before choosing the contract deployment
window.

Load the deployer key from the approved secret store into the current shell
without putting it in a repository file or shell-history command. Then:

```bash
export ZEROID_ADMIN=0x<durable-governance-address>
export ZEROID_VOTING_PERIOD=259200
export ZEROID_QUORUM=1
export ZEROID_ALLOW_DEPLOYER_ADMIN=false

export DEPLOYER_ADDRESS
DEPLOYER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"
test "${DEPLOYER_ADDRESS,,}" != "${ZEROID_ADMIN,,}"
cast balance "$DEPLOYER_ADDRESS" --ether --rpc-url "$AETHELRED_RPC_URL"
```

Stop if the deployer balance is insufficient or if deployer and admin match.

## 7. Mandatory non-broadcast simulation

The script writes no deployment manifest during this simulation:

```bash
export ZEROID_WRITE_MANIFEST=false

forge script script/DeployIdentity.s.sol:DeployIdentity \
  --rpc-url "$AETHELRED_RPC_URL" \
  --legacy \
  --slow \
  --gas-estimate-multiplier 200 \
  -vvvv
```

Review:

- chain ID is `7332`;
- all six constructors simulate successfully in the documented order;
- the printed admin equals `ZEROID_ADMIN`;
- no contract address is zero or duplicated;
- gas requirement is covered with an agreed reserve;
- `git status --porcelain` contains no unexpected source or manifest change.

A successful simulation is approval evidence, not a deployment.

## 8. Broadcast and interrupted-run handling

Open a controlled deployment window. Record the start height, release SHA,
deployer address, admin address, and reviewer names.

```bash
export ZEROID_WRITE_MANIFEST=true

forge script script/DeployIdentity.s.sol:DeployIdentity \
  --rpc-url "$AETHELRED_RPC_URL" \
  --broadcast \
  --legacy \
  --slow \
  --gas-estimate-multiplier 200 \
  -vvvv

unset PRIVATE_KEY
unset ZEROID_WRITE_MANIFEST
```

Do not use `--verify` unless an approved explorer verifier is configured. An
explorer-verification failure must not be confused with an EVM deployment
failure.

If the process is interrupted:

1. stop; do not rerun the script from the beginning;
2. inspect `broadcast/DeployIdentity.s.sol/7332/run-latest.json`;
3. verify every recorded receipt and deployed address against the RPC;
4. confirm the deployer account's next nonce;
5. use the same release SHA, RPC, deployer, and arguments with Foundry
   `--resume` only when the evidence shows a resumable partial broadcast;
6. if any constructor reverted or the nonce history is ambiguous, escalate for
   review rather than guessing.

The chain must not be reset to recover from an application deployment.

## 9. Accept the deployment manifest

The broadcast writes `deployments/7332.json`. It is a candidate until the
following checks pass.

```bash
export MANIFEST=deployments/7332.json

jq -e '.chainId == 7332' "$MANIFEST"
node scripts/apply-deployment-manifest.mjs \
  --manifest "$MANIFEST" \
  --chain-id 7332 \
  --print

export IDENTITY_REGISTRY
export ZK_VERIFIER
export ACCUMULATOR_REVOCATION
export GOVERNANCE_MODULE
export CREDENTIAL_REGISTRY
export SELECTIVE_DISCLOSURE

IDENTITY_REGISTRY="$(jq -r .identityRegistry "$MANIFEST")"
ZK_VERIFIER="$(jq -r .zkVerifier "$MANIFEST")"
ACCUMULATOR_REVOCATION="$(jq -r .accumulatorRevocation "$MANIFEST")"
GOVERNANCE_MODULE="$(jq -r .governanceModule "$MANIFEST")"
CREDENTIAL_REGISTRY="$(jq -r .credentialRegistry "$MANIFEST")"
SELECTIVE_DISCLOSURE="$(jq -r .selectiveDisclosure "$MANIFEST")"

for address in \
  "$IDENTITY_REGISTRY" \
  "$ZK_VERIFIER" \
  "$ACCUMULATOR_REVOCATION" \
  "$GOVERNANCE_MODULE" \
  "$CREDENTIAL_REGISTRY" \
  "$SELECTIVE_DISCLOSURE"
do
  test "$(cast code "$address" --rpc-url "$AETHELRED_RPC_URL")" != "0x"
done
```

Verify constructor relationships:

```bash
assert_address_eq() {
  local actual="$1"
  local expected="$2"
  local relationship="$3"

  [[ "$actual" =~ ^0x[0-9a-fA-F]{40}$ ]]
  [[ "$expected" =~ ^0x[0-9a-fA-F]{40}$ ]]
  if test "${actual,,}" != "${expected,,}"; then
    echo "$relationship mismatch: expected $expected, received $actual" >&2
    return 1
  fi
}

assert_address_eq "$(
  cast call "$CREDENTIAL_REGISTRY" \
    "identityRegistry()(address)" \
    --rpc-url "$AETHELRED_RPC_URL"
)" "$IDENTITY_REGISTRY" "CredentialRegistry.identityRegistry"

assert_address_eq "$(
  cast call "$CREDENTIAL_REGISTRY" \
    "governanceModule()(address)" \
    --rpc-url "$AETHELRED_RPC_URL"
)" "$GOVERNANCE_MODULE" "CredentialRegistry.governanceModule"

assert_address_eq "$(
  cast call "$SELECTIVE_DISCLOSURE" \
    "credentialRegistry()(address)" \
    --rpc-url "$AETHELRED_RPC_URL"
)" "$CREDENTIAL_REGISTRY" "SelectiveDisclosure.credentialRegistry"

assert_address_eq "$(
  cast call "$SELECTIVE_DISCLOSURE" \
    "zkVerifier()(address)" \
    --rpc-url "$AETHELRED_RPC_URL"
)" "$ZK_VERIFIER" "SelectiveDisclosure.zkVerifier"
```

The helper validates both values as 20-byte addresses and compares them without
checksum-letter-case ambiguity.

Verify admin custody on all six contracts:

```bash
export DEFAULT_ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000

for address in \
  "$IDENTITY_REGISTRY" \
  "$ZK_VERIFIER" \
  "$ACCUMULATOR_REVOCATION" \
  "$GOVERNANCE_MODULE" \
  "$CREDENTIAL_REGISTRY" \
  "$SELECTIVE_DISCLOSURE"
do
  test "$(
    cast call "$address" \
      "hasRole(bytes32,address)(bool)" \
      "$DEFAULT_ADMIN_ROLE" \
      "$ZEROID_ADMIN" \
      --rpc-url "$AETHELRED_RPC_URL"
  )" = "true"
done
```

Verify governance values:

```bash
cast call "$GOVERNANCE_MODULE" "votingPeriod()(uint64)" \
  --rpc-url "$AETHELRED_RPC_URL"
cast call "$GOVERNANCE_MODULE" "quorumRequired()(uint256)" \
  --rpc-url "$AETHELRED_RPC_URL"
```

Archive the broadcast receipts in the controlled deployment-evidence store.
Commit only the reviewed `deployments/7332.json` through a normal pull request.
Do not commit private keys, backend secrets, `.env` files, or raw secret-store
output.

## 10. Operational roles

The admin initially holds all operational roles. Delegate only after each actor
address and custody arrangement is reviewed:

| Contract                | Role                        | Environment variable          |
| ----------------------- | --------------------------- | ----------------------------- |
| `CredentialRegistry`    | `ISSUER_ROLE`               | `ZEROID_BACKEND_SIGNER`       |
| `ZKCredentialVerifier`  | `CIRCUIT_MANAGER_ROLE`      | `ZEROID_CIRCUIT_MANAGER`      |
| `AccumulatorRevocation` | `REVOCATION_AUTHORITY_ROLE` | `ZEROID_REVOCATION_AUTHORITY` |

For a testnet admin controlled by a dedicated signing key:

```bash
export ZEROID_ADMIN_KEY
export ZEROID_BACKEND_SIGNER=0x<reviewed-issuer-address>
export ZEROID_CIRCUIT_MANAGER=0x<reviewed-circuit-manager-address>
export ZEROID_REVOCATION_AUTHORITY=0x<reviewed-revocation-address>
export NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS="$CREDENTIAL_REGISTRY"
export NEXT_PUBLIC_ZK_VERIFIER_ADDRESS="$ZK_VERIFIER"
export NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS="$ACCUMULATOR_REVOCATION"

forge script script/GrantRoles.s.sol:GrantRoles \
  --rpc-url "$AETHELRED_RPC_URL" \
  --broadcast \
  --legacy \
  --slow

unset ZEROID_ADMIN_KEY
```

The three contract-address variables used by `GrantRoles` must be loaded from
the accepted manifest. If the admin is a multisignature or timelock, do not use
`ZEROID_ADMIN_KEY`; prepare, review, and execute the equivalent role-grant
calls through that custody system.

Verification keys are a separate activation. Run
`ceremony/scripts/07-register-vkeys.sh --broadcast` only after the ceremony
artifacts, hashes, and circuit-manager authority are approved.

## 11. Backend setup and hosting

The API is an Express process on port `4003`. Postgres and Redis are required.
The bounded webhook retry worker runs inside that API process; there is no
separate worker service. `crates/zeroid-tee` is a library/test target, not a
deployable network daemon.

For a fresh testnet database:

```bash
cd backend
cp .env.testnet.example .env
chmod 600 .env
```

Replace every `REPLACE_` value in `.env`. Use independent random values:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Assign them separately:

- `POSTGRES_PASSWORD` and the matching password component in `DATABASE_URL`;
- `JWT_SECRET`;
- `OID4VCI_STORAGE_HASH_PEPPER`.

Also confirm:

```dotenv
NODE_ENV=development
ZEROID_ENV=testnet
PORT=4003
AETHELRED_CHAIN_ID=7332
CORS_ORIGINS=http://93.127.132.52:3003
ZEROID_AUTH_ORIGIN=http://93.127.132.52:3003
KMS_PROVIDER=local
```

`NODE_ENV=development` is intentional for the public testnet's local credential
signer. It is not acceptable for production. A production environment must
provide the complete managed-signing, asymmetric session-key, external-service,
artifact-digest, persistence, proxy, and monitoring controls enforced by
`backend/src/services/production-safety.ts`.

Validate and start:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:4003/health; then
    break
  fi
  if test "$attempt" -eq 30; then
    docker compose logs --no-color api
    exit 1
  fi
  sleep 2
done
```

The API container runs `prisma migrate deploy` before startup. A fresh database
needs no baseline repair. For any reused database:

1. take and verify a backup;
2. compare the schema with `backend/prisma/schema.prisma`;
3. if it was created by `prisma db push`, follow the one-time baseline procedure
   in `backend/README.md`;
4. never use `db push --accept-data-loss`.

On the base testnet, `/ready` may correctly return HTTP `503` with
`circuitArtifacts: degraded` while audited proving artifacts are absent. That
fail-closed result means proof issuance is not ready; it is not permission to
bypass the check. `/health` must still return HTTP `200`.

Prefer a TLS reverse proxy and expose only ports `80/443`. If the temporary
direct-HTTP topology is used, restrict ports `3003` and `4003` at the firewall
to the approved test audience and remove that exposure after TLS is available.

## 12. Frontend setup and hosting

From the ZeroID repository root:

```bash
cp .env.testnet.example .env.production.local
chmod 600 .env.production.local

node scripts/apply-deployment-manifest.mjs \
  --manifest deployments/7332.json \
  --chain-id 7332 \
  --env .env.production.local

npm ci
npm run type-check
npm run build
```

Before the build, confirm these values in `.env.production.local`:

```dotenv
NEXT_PUBLIC_CHAIN_ENV=testnet
NEXT_PUBLIC_AETHELRED_NETWORK=testnet
NEXT_PUBLIC_ZEROID_ENV=testnet
NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL=http://54.165.44.130:8545
NEXT_PUBLIC_ZEROID_API_URL=http://93.127.132.52:4003
NEXT_PUBLIC_API_URL=http://93.127.132.52:4003
ZEROID_BACKEND_API_URL=http://127.0.0.1:4003
ZEROID_ALLOW_PLAINTEXT_HTTP=true
NEXT_PUBLIC_CANONICAL_VERIFY=false
NEXT_PUBLIC_AETHELRED_VKEYS={}
NEXT_PUBLIC_PQC_SIGNING=false
```

The six address values must match the accepted manifest. Keep optional contract
addresses empty unless separate reviewed manifests exist. Do not place secrets
in any `NEXT_PUBLIC_` value.

Test the compiled server before installing the service:

```bash
npm run start
```

In another shell:

```bash
curl --fail http://127.0.0.1:3003/api/health
ZEROID_FRONTEND_ORIGIN=http://127.0.0.1:3003 npm run smoke:production
```

Install the systemd unit from
`deployments/zeroid-frontend.service.example` after changing its user, group,
and working directory to the release host:

```bash
sudo cp deployments/zeroid-frontend.service.example \
  /etc/systemd/system/zeroid-frontend.service
sudo systemctl daemon-reload
sudo systemctl enable --now zeroid-frontend
sudo systemctl status zeroid-frontend
```

The service must run `npm run start`, not the development server. Preserve the
previous immutable release directory until all smoke checks pass.

## 13. End-to-end smoke checks

Read-only checks:

```bash
test "$(cast chain-id --rpc-url "$AETHELRED_RPC_URL")" = "7332"
curl --fail http://93.127.132.52:4003/health
curl --fail http://93.127.132.52:3003/api/health
ZEROID_FRONTEND_ORIGIN=http://93.127.132.52:3003 npm run smoke:production
```

Browser checks:

1. open the frontend with a clean browser profile;
2. connect the approved Aethelred-compatible wallet on chain `7332`;
3. verify the connected address and native balance;
4. confirm the app reads from each configured core contract without console
   errors;
5. submit one low-value test identity registration only after the read-only
   checks pass;
6. confirm the wallet prompts before signing and the receipt succeeds;
7. resolve the new identity from a second session;
8. keep proof issuance and optional external-provider flows disabled until
   their readiness gates pass.

Record block number, transaction hash, wallet address, HTTP results, screenshot,
and operator/reviewer names. Do not record seed phrases, private keys, bearer
tokens, or backend secrets.

## 14. Rollback and recovery

Contracts are not upgradeable by this runbook. There is no in-place bytecode
rollback.

- Before frontend activation, the old accepted manifest remains authoritative.
- If verification of a new six-contract deployment fails, do not propagate its
  addresses. Preserve receipts for investigation. A replacement requires a new
  complete six-contract deployment and manifest; never mix old and new
  addresses.
- Roll back the frontend by restoring the previous immutable release directory
  or service working-directory symlink, then restart and rerun the smoke.
- Roll back the API image only when its database schema remains compatible.
  Database migrations are forward operations; restore from the verified backup
  under an approved recovery plan rather than editing migration history.
- For an interrupted Foundry broadcast, use the evidence-driven `--resume`
  procedure in section 8. Never reset the chain.

## 15. Completion and current blockers

A public-testnet setup is complete only when:

- the exact release and SDK SHAs are recorded;
- every source validation gate passes;
- all six contract receipts and bytecodes are verified;
- constructor relationships and admin custody match the manifest;
- the manifest is reviewed and committed;
- the API `/health` check passes and the `/ready` result is understood;
- the frontend production smoke passes with all compiled addresses and URLs;
- one wallet-confirmed registration succeeds;
- logs show no repeated errors;
- rollback owners and evidence locations are recorded.

Known blockers that cannot be supplied by source code:

- final approval of the ZeroID release SHA;
- gas-funded deployer and durable admin custody;
- approved voting period and quorum;
- final RPC/frontend/API hostnames and TLS certificates;
- database backup/storage ownership;
- backend secrets and optional external-provider credentials;
- operational role addresses;
- finalized, audited circuit artifacts and on-chain verification-key
  registrations.

Do not represent the blocked cryptographic or external-provider flows as live.
