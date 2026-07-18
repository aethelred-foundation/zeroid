# ZeroID backend

The ZeroID API (`:4003`) the frontend calls via `NEXT_PUBLIC_ZEROID_API_URL`. Express +
Prisma (Postgres) + Redis, with credential signing that switches between a local
dev key (testnet) and a KMS/HSM provider (production). It is self-contained — it
does **not** read the chain directly; on-chain reads happen in the frontend.

## Run it (Docker — one command)

Requires Docker + Docker Compose. Brings up Postgres + Redis + the API, runs
Prisma migrations, then serves.

```bash
cd backend
cp .env.testnet.example .env
# set a real API signing secret (>=32 chars):
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up --build
```

Then:
- Liveness: `curl http://localhost:4003/health` → `{ status: "ok", ... }`
- Readiness: `curl http://localhost:4003/ready` → DB / Redis / production-safety / circuit-artifact checks.

Point the frontend at it with `NEXT_PUBLIC_ZEROID_API_URL=http://localhost:4003` (or the
dApp server's IP:4003 with the port open).

## Run it (native, no Docker)

Requires Node ≥20 and a reachable Postgres + Redis. Set `DATABASE_URL` /
`REDIS_URL` in `.env`, then:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy      # apply the reviewed baseline and later migrations
npm run build && npm start     # or: npm run dev  (ts-node-dev, hot reload)
```

> Existing testnet databases that were previously created with `prisma db push`
> already contain the baseline schema but have no Prisma migration history.
> Back them up, verify that their schema matches `prisma/schema.prisma`, then run
> `npx prisma migrate resolve --applied 20260718000000_zeroid_baseline` exactly
> once before deploying this image. Fresh databases need no special handling.

## Boot requirements

Minimal env to start (see `.env.testnet.example` for the full annotated set):

| Var | Purpose |
| --- | ------- |
| `JWT_SECRET` | API auth signing — **must be ≥32 chars**; startup aborts otherwise |
| `DATABASE_URL` | Postgres (`postgresql://…`) |
| `REDIS_URL` | Redis (`redis://…`) |
| `PORT` | API port (use `4003` to match the frontend default) |
| `KMS_PROVIDER` | `local` for testnet dev signing; `aws-kms`/`gcp-kms`/`azure-kms` for production |
| `NODE_ENV` | keep **non-production** on testnet so local credential signing is permitted |

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

Prisma migrations live in `prisma/migrations/`. The Docker entrypoint runs
`prisma migrate deploy` on start; for native runs apply them yourself. New schema
changes: `npm run prisma:migrate` (dev), inspect the generated SQL, test it
against a restored production snapshot, then commit it. Never use
`db push --accept-data-loss` in a deployed environment.
