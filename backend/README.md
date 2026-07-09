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
npx prisma db push             # provision a fresh DB (creates all 35 models)
npm run build && npm start     # or: npm run dev  (ts-node-dev, hot reload)
```

> Schema note: the committed migrations in `prisma/migrations/` are
> **incremental** and assume a baseline that was originally created with
> `prisma db push`, so a fresh database must be provisioned with `db push`
> (not `migrate deploy`, which errors on the missing baseline). Before mainnet,
> baseline a full migration set and switch the Docker entrypoint back to
> `prisma migrate deploy`.

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

## Migrations

Prisma migrations live in `prisma/migrations/`. The Docker entrypoint runs
`prisma migrate deploy` on start; for native runs apply them yourself. New schema
changes: `npm run prisma:migrate` (dev) → commit the generated migration.
