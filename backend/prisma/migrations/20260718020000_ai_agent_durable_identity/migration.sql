-- Make Prisma's ai_agents row the durable source for the public AgentIdentity
-- contract. Public-key/protocol fields remain nullable for pre-existing rows;
-- the service fails those legacy rows closed until operators re-register or
-- explicitly backfill trusted values.
ALTER TABLE "ai_agents"
ADD COLUMN "agentProtocol" TEXT,
ADD COLUMN "publicKey" TEXT,
ADD COLUMN "publicKeyHash" TEXT,
ADD COLUMN "teeAttested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "teeAttestationId" TEXT,
ADD COLUMN "totalActions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "actionsToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "successfulActions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "anomalyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAnomalyAt" TIMESTAMP(3),
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedBy" TEXT,
ADD COLUMN "suspensionReason" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
