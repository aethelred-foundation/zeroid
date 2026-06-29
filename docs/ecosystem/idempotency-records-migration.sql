-- Idempotency v1 — additive schema migration (tracked reference copy).
-- The repo gitignores prisma/migrations/, so this tracked copy is the reviewable
-- source of truth. Apply via:  npx prisma migrate deploy
-- (or, to regenerate canonically:  npx prisma migrate dev --name idempotency_v1).
--
-- Additive only: one new table; no drops, no backfill, no changes to existing
-- tables. Safe to apply online.

CREATE TABLE "idempotency_records" (
  "key"       TEXT NOT NULL,
  "scope"     TEXT NOT NULL,
  "response"  JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "idempotency_records_scope_createdAt_idx"
  ON "idempotency_records" ("scope", "createdAt");
