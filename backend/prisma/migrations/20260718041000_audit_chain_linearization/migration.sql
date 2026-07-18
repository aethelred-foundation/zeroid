-- A sealed audit entry must be the only child of its predecessor. Without
-- this constraint, concurrent appenders can both read the same chain tail and
-- permanently fork the purportedly linear integrity chain.
DROP INDEX IF EXISTS "audit_logs_previousHash_idx";

CREATE UNIQUE INDEX "audit_logs_previousHash_key"
ON "audit_logs"("previousHash");
