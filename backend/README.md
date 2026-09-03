# ZeroID backend

The ZeroID API (`:4003`) the frontend calls via `NEXT_PUBLIC_ZEROID_API_URL`. Express +
Prisma (Postgres) + Redis, with credential signing that switches between a local
dev key (testnet) and a KMS/HSM provider (production). It is self-contained — it
does **not** read the chain directly; on-chain reads happen in the frontend.

## Run it (Docker — one command)

Requires Docker + Docker Compose. Brings up Postgres + Redis, runs the
read-only database preflight and Prisma migrations in a one-shot `migrate`
service, then starts the API only after migration succeeds.

```bash
cd backend
cp .env.testnet.example .env
# Replace every REPLACE_ value. Use independent random values for the database
# password, JWT secret, and OID4VCI storage pepper.
docker compose up --build
```

Then:

- Migration result: `docker compose logs --no-color migrate`
- Liveness: `curl http://localhost:4003/health` → `{ status: "ok", ... }`
- Readiness: `curl http://localhost:4003/ready` → DB / Redis / production-safety / circuit-artifact checks.

Point the frontend at it with `NEXT_PUBLIC_ZEROID_API_URL=http://localhost:4003` (or the
dApp server's IP:4003 with the port open).

The bounded webhook retry worker starts inside the API process and stops during
graceful API shutdown. There is no separate worker service to deploy. The Rust
TEE crate is a library/test target, not a network daemon.

## Run it (native, no Docker)

Requires Node ≥20 and a reachable Postgres + Redis. Set `DATABASE_URL` /
`REDIS_URL` in `.env`, then:

```bash
npm ci
npx prisma generate
npm run build
npm run database:preflight   # read-only; blocks an untracked non-empty schema
npx prisma migrate deploy    # apply the reviewed baseline and later migrations
npm start                    # or: npm run dev  (ts-node-dev, hot reload)
```

Fresh databases need no special handling. An existing database created with
`prisma db push` must follow the audited baseline procedure below; do not assume
that marking only the first migration is sufficient.

## Boot requirements

Minimal env to start (see `.env.testnet.example` for the full annotated set):

| Var                  | Purpose                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `JWT_SECRET`         | API auth signing — **must be ≥32 chars**; startup aborts otherwise              |
| `DATABASE_URL`       | Postgres (`postgresql://…`)                                                     |
| `REDIS_URL`          | Redis (`redis://…`)                                                             |
| `PORT`               | API port (use `4003` to match the frontend default)                             |
| `KMS_PROVIDER`       | `local` for testnet dev signing; `aws-kms`/`gcp-kms`/`azure-kms` for production |
| `NODE_ENV`           | keep **non-production** on testnet so local credential signing is permitted     |
| `AETHELRED_CHAIN_ID` | `7332` for wallet registration and sign-in domain separation                    |
| `CORS_ORIGINS`       | comma-separated, exact frontend origins; wildcards are ignored                  |
| `ZEROID_AUTH_ORIGIN` | exact frontend origin embedded in wallet sign-in messages                       |
| `AETHELRED_RPC_URL`  | JSON-RPC node the registration verifier reads; registration answers 503 until set |
| `IDENTITY_REGISTRY_ADDRESS` | deployed registry from the accepted manifest (same value as the frontend's `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS`); `eth_getCode` must be non-empty |
| `IDENTITY_REGISTRY_MIN_CONFIRMATIONS` | optional, default `1` (CometBFT per-block finality)                    |
| `IDENTITY_REGISTRY_RECEIPT_WAIT_MS` | optional, default `15000`; bounded server-side receipt wait              |
| `AETHELRED_NETWORK_ANCHOR_BLOCK` / `_HASH` | optional pair; when set, the anchor block hash is asserted on every verification |
| `IDENTITY_REGISTRY_DID_NETWORKS` | optional override of the DID-network-per-chain-id table                     |

## Registry verification

`POST /api/v1/identity/register` requires the hash of the wallet's
`registerIdentity(bytes32 didHash, bytes32 recoveryHash)` transaction and
creates no identity and issues no session until the API has verified that
transaction itself, from `AETHELRED_RPC_URL`. The verifier
(`src/services/identity-registry-verification.ts`) binds, in order:

1. configuration present and `eth_getCode(IDENTITY_REGISTRY_ADDRESS)` non-empty
   (else `503 IDENTITY_REGISTRY_NOT_CONFIGURED`);
2. the DID's network segment allowed for `AETHELRED_CHAIN_ID`
   (else `400 IDENTITY_DID_NETWORK_MISMATCH`), then the EIP-191 wallet proof;
3. replay pre-checks: the txHash and the controller are not already bound to a
   verified identity (`409 IDENTITY_REGISTRY_TX_ALREADY_USED`,
   `409 IDENTITY_CONTROLLER_EXISTS`) — before any RPC call;
4. a canonical receipt (double receipt read, receipt/transaction/block hash
   agreement, `status == 1`, confirmations ≥ minimum) inside a bounded poll of
   `IDENTITY_REGISTRY_RECEIPT_WAIT_MS`;
5. `eth_chainId` equals `AETHELRED_CHAIN_ID` and, if configured, the anchor
   block hash matches (`422 IDENTITY_REGISTRY_CHAIN_MISMATCH`);
6. `tx.to` is the registry, `tx.from` is the proven controller, the selector is
   `registerIdentity` (so `batchRegister` is excluded) and the calldata carries
   `keccak256(utf8(did))` and the request's recovery hash;
7. exactly one `IdentityRegistered` event from the registry for that didHash,
   whose controller is the sender and whose timestamp is the block's;
8. `resolveByController(controller) == didHash` and `resolveIdentity(didHash)`
   is Active with the same controller and recovery hash
   (`422 IDENTITY_REGISTRY_STATE_MISMATCH`);
9. the chain snapshot re-asserted inside the same database transaction as the
   identity and audit rows; the session token is issued only after commit.

The evidence is persisted in the identity's `registry*` columns. `registryTxHash`,
`registryDidHash` and `registryController` are unique, so a receipt verifies
exactly one identity.

Two refusals are **retryable** and expected during normal operation when the
browser's RPC leads the API's: `409 IDENTITY_REGISTRY_TX_NOT_MINED` and
`409 IDENTITY_REGISTRY_TX_NOT_CONFIRMED`. The frontend keeps the signed and
submitted artifacts and re-POSTs them on the next click; no new signature or
transaction is needed. `503 IDENTITY_REGISTRY_NOT_CONFIGURED`,
`503 IDENTITY_REGISTRY_RPC_UNAVAILABLE` and
`503 IDENTITY_REGISTRATION_NOT_CONFIGURED` are returned with their code (not
masked as `Internal server error`) so the browser can tell "retry later" from a
server fault.

`GET /ready` reports `checks.identityRegistry` as `ok`, `unavailable` (not
configured, or no code at the address) or `degraded` (RPC unreachable or wrong
chain id at probe time). `/register` has its own limiter (5 per 15 minutes per
client) because each attempt costs roughly ten RPC calls.

Operators can run the exact verification against a real transaction, or just
prove egress to the RPC, with:

```bash
node dist/ops/identity-registry-smoke.js --probe
node dist/ops/identity-registry-smoke.js <txHash> <did> <controller> <recoveryHash> [--dump <dir>]
```

## Signing custody (testnet vs production)

`production-safety.ts` only enforces KMS-backed signing when
`NODE_ENV`/`ZEROID_ENV` is `production`. So on testnet (`NODE_ENV=development`)
the API uses a **local dev signing key** with no violation; for production you
set a real `KMS_PROVIDER` + `KMS_KEY_ID` and the local-signing gates must stay
`false`. This is the env-switch — same code, custody scales with the environment.

## Enterprise features (optional, off by default on testnet)

Government identity (UAE Pass / Emirates ID), Intel SGX TEE attestation, the OIDC
provider, sanctions feeds, and regulatory submission each need real external
credentials and are **not** required to boot or serve the core identity API.
Leave their env vars unset on testnet; enable them per feature as credentials
become available.

### Eligibility availability

Human, agent, and Wallet/Cruzible partner eligibility proof issuance currently
fails closed. Database credentials and source-only circuit manifests are not
proof evidence. Keep issuance disabled until provider-signed credential
witnesses, audited and digest-pinned Groth16 artifacts, a real prover/verifier,
durable one-time relying-party and agent challenges, and atomic evidence/audit
persistence are integrated. See
`docs/production/zeroid-v1-readiness-gate.md`.

### OIDC claim boundary

OIDC tokens omit profile, contact, address, and `verified_claims` values because
identity profile metadata is client-mutable. Status-level government/TEE
assurance claims require current authoritative evidence. Do not enable profile
or contact scopes until provider-returned values have a dedicated encrypted,
access-controlled evidence store with provenance and expiry.

If an existing environment previously signed metadata-derived identity claims,
coordinate an OIDC signing-key rotation and JWKS cache/overlap window during the
hardened deployment. New production deployments still require managed signing
keys and a tested rotation procedure.

## Migrations

Prisma migrations live in `prisma/migrations/`. Compose runs them in the
one-shot `migrate` service; the API is not started unless that service exits
successfully. For native runs, apply them yourself. New schema changes:
`npm run prisma:migrate` (dev), inspect the generated SQL, test it against a
restored production snapshot, then commit it. Never use
`db push --accept-data-loss` in a deployed environment.

### Safe database migration and P3005 recovery

The preflight is read-only. It permits an empty schema or one with applied
Prisma history that is an exact name/checksum prefix of this release and whose
schema effects agree with that prefix. It blocks a non-empty schema without
history before `prisma migrate deploy` can raise P3005, pending migrations whose
effects already appeared through `db push`, divergent/unfinished history, and
missing applied effects. No baseline is inferred or written. Because
`migrate` is a one-shot service and `api` depends on its successful completion,
a blocked database leaves the API stopped instead of entering a restart loop:

```bash
docker compose ps --all migrate api
docker compose logs --no-color migrate
```

Choose exactly one of the following paths.

#### A. New empty public-testnet database, preserving the existing volume

Changing `POSTGRES_DB` does not create another database after the Postgres
volume has initialized. Create a distinct database in the same cluster first.
The example name is intentionally explicit; replace the date before running it:

```bash
docker compose stop api
docker compose up -d postgres
docker compose exec -T postgres sh -eu -c \
  'createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" zeroid_testnet_20260731'
```

Update both `POSTGRES_DB` and the database-name component of `DATABASE_URL` in
`backend/.env` to `zeroid_testnet_20260731`, then recreate the services. This
preserves the old database and the named volume:

```bash
docker compose up -d --build
docker compose logs --no-color migrate
docker compose ps
```

Do not run `docker compose down --volumes`, `docker volume rm`, `dropdb`, or
`prisma migrate reset` as a migration workaround.

#### B. Preserve and explicitly baseline an existing database

Start only Postgres, create a backup outside the repository, check that its
archive is readable, and capture the live schema. These commands do not print
the database password:

```bash
docker compose stop api
docker compose up -d postgres
install -d -m 700 /secure/backup
chmod 700 /secure/backup
umask 077
docker compose exec -T postgres sh -eu -c \
  'pg_dump --username "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' \
  > /secure/backup/zeroid-before-baseline.dump
docker compose exec -T postgres pg_restore --list \
  < /secure/backup/zeroid-before-baseline.dump > /dev/null
docker compose exec -T postgres sh -eu -c \
  'pg_dump --username "$POSTGRES_USER" --schema-only --no-owner --no-privileges "$POSTGRES_DB"' \
  > /secure/backup/zeroid-before-baseline-schema.sql
docker compose run --rm --no-deps migrate sh -eu -c \
  'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script' \
  > /secure/backup/zeroid-live-to-current.sql
```

`pg_restore --list` is only an archive-integrity check. Before changing
migration history, restore the dump into an isolated, disposable Postgres
container with no published port:

```bash
docker run --detach --rm \
  --name zeroid-baseline-restore-audit \
  --env POSTGRES_PASSWORD=restore-audit-only \
  --env POSTGRES_DB=zeroid_restore \
  postgres:16-alpine
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if docker exec zeroid-baseline-restore-audit \
    pg_isready --username postgres --dbname zeroid_restore
  then
    break
  fi
  if test "$attempt" -eq 20; then
    docker logs zeroid-baseline-restore-audit
    exit 1
  fi
  sleep 1
done
docker exec --interactive zeroid-baseline-restore-audit \
  pg_restore --username postgres --dbname zeroid_restore \
  --exit-on-error --single-transaction --no-owner --no-privileges \
  < /secure/backup/zeroid-before-baseline.dump
docker exec zeroid-baseline-restore-audit \
  psql --username postgres --dbname zeroid_restore --no-psqlrc \
  --command "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema = 'public';"
```

Review expected table and row counts on the restored copy, then remove only
that explicitly disposable audit container:

```bash
docker stop zeroid-baseline-restore-audit
```

The `migrate diff` output is audit evidence; do not pipe it into
`prisma db execute` or otherwise execute it against the reused database.

Review the backup, the schema dump, the generated diff, and every SQL file in
`prisma/migrations/`. Stop and prepare a reviewed data migration if the live
objects do not match the committed migration history. Never edit
`_prisma_migrations` directly.

Only after the audit proves the baseline SQL effects are already present, mark
the baseline applied:

```bash
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718000000_zeroid_baseline
```

For each later migration whose complete SQL effects are also already present,
mark that migration applied in order. Run only the commands supported by the
audit; leave absent changes unresolved so `migrate deploy` applies them:

```bash
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718010000_oid4vci_atomic_issuance
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718020000_ai_agent_durable_identity
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718030000_schema_vote_audit_action
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718040000_agent_delegation_approval_durability
docker compose run --rm --no-deps migrate \
  npx prisma migrate resolve --applied 20260718041000_audit_chain_linearization
```

Finally, run the one-shot migration and start the API:

```bash
docker compose run --rm migrate
docker compose up -d
docker compose logs --no-color migrate
docker compose ps
```
