-- Add bounded issuance leases. Both columns are nullable so this migration is
-- backwards compatible with existing rows and can be applied without downtime.
ALTER TABLE "oid4vci_token_sessions"
ADD COLUMN "claimId" TEXT,
ADD COLUMN "claimExpiresAt" TIMESTAMP(3);

CREATE INDEX "oid4vci_token_sessions_claimExpiresAt_idx"
ON "oid4vci_token_sessions"("claimExpiresAt");
