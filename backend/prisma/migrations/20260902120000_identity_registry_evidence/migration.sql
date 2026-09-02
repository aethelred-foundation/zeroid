-- Identity registration is accepted only after the API has verified the
-- registerIdentity transaction against the chain. The evidence it verified is
-- persisted next to the identity so the row can be audited without re-reading
-- the chain, and so replays are refused at the database boundary.
--
-- Uniqueness mirrors the registry contract's own invariants: one identity per
-- didHash (IdentityAlreadyExists) and one DID per controller
-- (ControllerAlreadyBound). registryTxHash is unique so a single receipt can
-- verify exactly one identity. Postgres treats NULLs as distinct, so identities
-- created before this migration (no registry evidence) are unaffected.
ALTER TABLE "identities" ADD COLUMN "registryChainId" INTEGER;
ALTER TABLE "identities" ADD COLUMN "registryAddress" TEXT;
ALTER TABLE "identities" ADD COLUMN "registryTxHash" TEXT;
ALTER TABLE "identities" ADD COLUMN "registryBlockNumber" INTEGER;
ALTER TABLE "identities" ADD COLUMN "registryBlockHash" TEXT;
ALTER TABLE "identities" ADD COLUMN "registryDidHash" TEXT;
ALTER TABLE "identities" ADD COLUMN "registryController" TEXT;
ALTER TABLE "identities" ADD COLUMN "registryEventTimestamp" TIMESTAMP(3);
ALTER TABLE "identities" ADD COLUMN "registryConfirmations" INTEGER;
ALTER TABLE "identities" ADD COLUMN "registryVerifiedAt" TIMESTAMP(3);
ALTER TABLE "identities" ADD COLUMN "registryVerificationVersion" TEXT;

CREATE UNIQUE INDEX "identities_registryTxHash_key" ON "identities"("registryTxHash");
CREATE UNIQUE INDEX "identities_registryDidHash_key" ON "identities"("registryDidHash");
CREATE UNIQUE INDEX "identities_registryController_key" ON "identities"("registryController");
