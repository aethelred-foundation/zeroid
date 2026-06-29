-- AI Agent Passport v1 — additive schema migration (tracked reference copy).
-- The repo gitignores prisma/migrations/, so this tracked copy is the reviewable
-- source of truth. Apply via:  npx prisma migrate dev --name ai_agent_passport_v1
-- (Prisma will generate the equivalent DDL), or apply this SQL directly.
--
-- Additive only: new enum + nullable/defaulted columns; no drops, no backfill,
-- no changes to the human eligibility tables. Safe to apply online.

CREATE TYPE "AgentActionDecision" AS ENUM ('ALLOWED', 'DENIED', 'FAILED');

ALTER TABLE "ai_agents"
  ADD COLUMN "controllerDid" TEXT,
  ADD COLUMN "riskTier" "RiskLevel" NOT NULL DEFAULT 'LOW';

ALTER TABLE "agent_credentials"
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "maxRiskTier" "RiskLevel" NOT NULL DEFAULT 'LOW',
  ADD COLUMN "controllerDid" TEXT,
  ADD COLUMN "revocationNonce" TEXT;

ALTER TABLE "agent_actions"
  ADD COLUMN "controllerDid" TEXT,
  ADD COLUMN "policyId" TEXT,
  ADD COLUMN "decision" "AgentActionDecision";
