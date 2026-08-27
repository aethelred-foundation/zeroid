-- Tracked reference copy (prisma/migrations/ is gitignored). Apply via prisma migrate deploy.
-- OpenID4VP / OpenID4VCI persistence v1 — additive (3 new tables, no changes to
-- existing tables). Safe to apply online.
--   npx prisma migrate deploy   (or: npx prisma migrate dev --name oid4vp_oid4vci_v1)

CREATE TABLE "oid4vp_presentation_requests" (
  "state"     TEXT NOT NULL,
  "nonce"     TEXT NOT NULL,
  "policyId"  TEXT NOT NULL,
  "audience"  TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "decision"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oid4vp_presentation_requests_pkey" PRIMARY KEY ("state")
);
CREATE UNIQUE INDEX "oid4vp_presentation_requests_nonce_key"
  ON "oid4vp_presentation_requests" ("nonce");
CREATE INDEX "oid4vp_presentation_requests_status_expiresAt_idx"
  ON "oid4vp_presentation_requests" ("status", "expiresAt");

CREATE TABLE "oid4vci_offers" (
  "preAuthCode" TEXT NOT NULL,
  "configId"    TEXT NOT NULL,
  "subjectDid"  TEXT NOT NULL,
  "txCode"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oid4vci_offers_pkey" PRIMARY KEY ("preAuthCode")
);

CREATE TABLE "oid4vci_token_sessions" (
  "accessToken" TEXT NOT NULL,
  "configId"    TEXT NOT NULL,
  "subjectDid"  TEXT NOT NULL,
  "cNonce"      TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oid4vci_token_sessions_pkey" PRIMARY KEY ("accessToken")
);
