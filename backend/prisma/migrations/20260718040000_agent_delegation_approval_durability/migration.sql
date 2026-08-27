-- Persist AI agent delegation grants, server-issued verification challenges,
-- operation-bound approval decisions, and authorization rate windows in
-- PostgreSQL. Redis remains a cache/notification layer and is intentionally
-- not imported because existing cache records do not provide a trustworthy
-- transactional migration source.

CREATE TYPE "AgentDelegationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
CREATE TYPE "AgentApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED');
CREATE TYPE "AgentVerificationChallengeStatus" AS ENUM ('ISSUED', 'CONSUMED', 'EXPIRED');
CREATE TYPE "AgentAuthorizationWindow" AS ENUM ('HOUR', 'DAY');
CREATE TYPE "AgentAuthorizationOperationStatus" AS ENUM ('PENDING_APPROVAL', 'AUTHORIZED');

ALTER TABLE "ai_agents"
ADD COLUMN "authorizationVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ai_agents"
ADD CONSTRAINT "ai_agents_authorization_version_check" CHECK ("authorizationVersion" >= 0);

CREATE TABLE "agent_delegations" (
    "id" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "capabilities" TEXT[] NOT NULL,
    "constraints" JSONB NOT NULL,
    "depth" INTEGER NOT NULL,
    "maxDepth" INTEGER NOT NULL,
    "status" "AgentDelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentDelegationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "authorizationCount" INTEGER NOT NULL DEFAULT 0,
    "lastAuthorizedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_delegations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_delegations_distinct_agents_check" CHECK ("fromAgentId" <> "toAgentId"),
    CONSTRAINT "agent_delegations_capabilities_check" CHECK (cardinality("capabilities") > 0),
    CONSTRAINT "agent_delegations_depth_check" CHECK ("depth" BETWEEN 1 AND 5 AND "maxDepth" BETWEEN 1 AND 5 AND "depth" <= "maxDepth"),
    CONSTRAINT "agent_delegations_lifetime_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "agent_delegations_authorization_count_check" CHECK ("authorizationCount" >= 0),
    CONSTRAINT "agent_delegations_version_check" CHECK ("version" >= 0),
    CONSTRAINT "agent_delegations_revocation_check" CHECK (
        ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND coalesce(length(trim("revokedBy")), 0) > 0)
        OR
        ("status" <> 'REVOKED' AND "revokedAt" IS NULL AND "revokedBy" IS NULL)
    )
);

CREATE TABLE "agent_approval_requests" (
    "id" TEXT NOT NULL,
    "approvalGroupId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationDigest" TEXT NOT NULL,
    "authorizationSnapshotDigest" TEXT NOT NULL,
    "requestedCapabilities" TEXT[] NOT NULL,
    "requiredApproverIds" TEXT[] NOT NULL,
    "agentId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "status" "AgentApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "responseNote" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByChallengeId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_approval_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_approval_requests_lifetime_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "agent_approval_requests_fields_check" CHECK (
        length(trim("approvalGroupId")) > 0 AND length(trim("operationId")) > 0
        AND length(trim("operationDigest")) = 64 AND length(trim("authorizationSnapshotDigest")) = 64
        AND cardinality("requestedCapabilities") > 0
        AND cardinality("requiredApproverIds") > 0 AND length(trim("action")) > 0
        AND length(trim("resourceType")) > 0 AND length(trim("resourceId")) > 0
    ),
    CONSTRAINT "agent_approval_requests_risk_check" CHECK ("riskLevel" IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT "agent_approval_requests_context_check" CHECK (jsonb_typeof("context") = 'object'),
    CONSTRAINT "agent_approval_requests_version_check" CHECK ("version" >= 0),
    CONSTRAINT "agent_approval_requests_response_check" CHECK (
        ("status" IN ('PENDING', 'EXPIRED') AND "respondedAt" IS NULL AND "respondedBy" IS NULL AND "responseNote" IS NULL AND "consumedAt" IS NULL AND "consumedByChallengeId" IS NULL)
        OR
        ("status" IN ('APPROVED', 'REJECTED') AND "respondedAt" IS NOT NULL AND coalesce(length(trim("respondedBy")), 0) > 0 AND coalesce(length(trim("responseNote")), 0) > 0 AND "consumedAt" IS NULL AND "consumedByChallengeId" IS NULL)
        OR
        ("status" = 'CONSUMED' AND "respondedAt" IS NOT NULL AND coalesce(length(trim("respondedBy")), 0) > 0 AND coalesce(length(trim("responseNote")), 0) > 0 AND "consumedAt" IS NOT NULL AND coalesce(length(trim("consumedByChallengeId")), 0) > 0)
    )
);

CREATE TABLE "agent_verification_challenges" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationDigest" TEXT NOT NULL,
    "requestedCapabilities" TEXT[] NOT NULL,
    "context" JSONB NOT NULL,
    "approvalGroupId" TEXT,
    "status" "AgentVerificationChallengeStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_verification_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_verification_challenges_nonceHash_key" UNIQUE ("nonceHash"),
    CONSTRAINT "agent_verification_challenges_lifetime_check" CHECK ("expiresAt" > "issuedAt"),
    CONSTRAINT "agent_verification_challenges_fields_check" CHECK (
        length(trim("operationId")) > 0 AND length(trim("operationDigest")) = 64
        AND length(trim("nonceHash")) = 64
        AND cardinality("requestedCapabilities") > 0 AND jsonb_typeof("context") = 'object'
    ),
    CONSTRAINT "agent_verification_challenges_version_check" CHECK ("version" >= 0),
    CONSTRAINT "agent_verification_challenges_consumption_check" CHECK (
        ("status" = 'ISSUED' AND "consumedAt" IS NULL)
        OR ("status" = 'EXPIRED' AND "consumedAt" IS NULL)
        OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL)
    )
);

CREATE TABLE "agent_authorization_usage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "delegationId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "windowType" "AgentAuthorizationWindow" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_authorization_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_authorization_usage_count_check" CHECK ("count" >= 0),
    CONSTRAINT "agent_authorization_usage_fields_check" CHECK (length(trim("scopeKey")) > 0 AND length(trim("capability")) > 0)
);

CREATE TABLE "agent_verification_failure_windows" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastChallengeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_verification_failure_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_verification_failure_windows_count_check" CHECK ("count" >= 0),
    CONSTRAINT "agent_verification_failure_windows_fields_check" CHECK (
        length(trim("lastChallengeId")) > 0
    )
);

CREATE TABLE "agent_authorization_operations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationDigest" TEXT NOT NULL,
    "status" "AgentAuthorizationOperationStatus" NOT NULL,
    "approvalGroupId" TEXT,
    "initialChallengeId" TEXT NOT NULL,
    "initialVerificationId" TEXT NOT NULL,
    "authorizedChallengeId" TEXT,
    "authorizationVerificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_authorization_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_authorization_operations_fields_check" CHECK (
        length(trim("operationId")) > 0 AND length(trim("operationDigest")) = 64
        AND length(trim("initialChallengeId")) > 0 AND length(trim("initialVerificationId")) > 0
    ),
    CONSTRAINT "agent_authorization_operations_version_check" CHECK ("version" >= 0),
    CONSTRAINT "agent_authorization_operations_state_check" CHECK (
        ("status" = 'PENDING_APPROVAL' AND coalesce(length(trim("approvalGroupId")), 0) > 0
            AND "authorizedChallengeId" IS NULL AND "authorizationVerificationId" IS NULL AND "authorizedAt" IS NULL)
        OR
        ("status" = 'AUTHORIZED' AND coalesce(length(trim("authorizedChallengeId")), 0) > 0
            AND coalesce(length(trim("authorizationVerificationId")), 0) > 0 AND "authorizedAt" IS NOT NULL)
    )
);

CREATE INDEX "agent_delegations_fromAgentId_status_expiresAt_idx"
ON "agent_delegations"("fromAgentId", "status", "expiresAt");

CREATE INDEX "agent_delegations_toAgentId_status_expiresAt_idx"
ON "agent_delegations"("toAgentId", "status", "expiresAt");

CREATE INDEX "agent_delegations_parentDelegationId_idx"
ON "agent_delegations"("parentDelegationId");

CREATE INDEX "agent_approval_requests_operatorId_status_createdAt_idx"
ON "agent_approval_requests"("operatorId", "status", "createdAt");

CREATE UNIQUE INDEX "agent_approval_requests_approvalGroupId_operatorId_key"
ON "agent_approval_requests"("approvalGroupId", "operatorId");

CREATE INDEX "agent_approval_requests_approvalGroupId_status_idx"
ON "agent_approval_requests"("approvalGroupId", "status");

CREATE INDEX "agent_approval_requests_operationDigest_idx"
ON "agent_approval_requests"("operationDigest");

CREATE INDEX "agent_approval_requests_audienceId_status_idx"
ON "agent_approval_requests"("audienceId", "status");

CREATE INDEX "agent_approval_requests_agentId_status_idx"
ON "agent_approval_requests"("agentId", "status");

CREATE INDEX "agent_approval_requests_status_expiresAt_idx"
ON "agent_approval_requests"("status", "expiresAt");

CREATE INDEX "agent_verification_challenges_agentId_status_expiresAt_idx"
ON "agent_verification_challenges"("agentId", "status", "expiresAt");

CREATE INDEX "agent_verification_challenges_audienceId_status_expiresAt_idx"
ON "agent_verification_challenges"("audienceId", "status", "expiresAt");

CREATE INDEX "agent_verification_challenges_operationDigest_idx"
ON "agent_verification_challenges"("operationDigest");

CREATE UNIQUE INDEX "agent_verification_failure_audience_agent_window_key"
ON "agent_verification_failure_windows"("audienceId", "agentId", "windowStart");

CREATE INDEX "agent_verification_failure_windows_agentId_windowStart_idx"
ON "agent_verification_failure_windows"("agentId", "windowStart");

CREATE INDEX "agent_verification_failure_windows_windowStart_idx"
ON "agent_verification_failure_windows"("windowStart");

CREATE UNIQUE INDEX "agent_authorization_operation_scope_key"
ON "agent_authorization_operations"("agentId", "audienceId", "operationId");

CREATE UNIQUE INDEX "agent_authorization_operations_operationDigest_key"
ON "agent_authorization_operations"("operationDigest");

CREATE INDEX "agent_authorization_operations_agentId_status_createdAt_idx"
ON "agent_authorization_operations"("agentId", "status", "createdAt");

CREATE INDEX "agent_authorization_operations_audienceId_status_createdAt_idx"
ON "agent_authorization_operations"("audienceId", "status", "createdAt");

CREATE UNIQUE INDEX "agent_auth_usage_scope_window_key"
ON "agent_authorization_usage"("agentId", "scopeKey", "capability", "windowType", "windowStart");

CREATE INDEX "agent_authorization_usage_delegationId_windowStart_idx"
ON "agent_authorization_usage"("delegationId", "windowStart");

CREATE INDEX "agent_authorization_usage_windowStart_idx"
ON "agent_authorization_usage"("windowStart");

ALTER TABLE "agent_delegations"
ADD CONSTRAINT "agent_delegations_fromAgentId_fkey"
FOREIGN KEY ("fromAgentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_delegations"
ADD CONSTRAINT "agent_delegations_toAgentId_fkey"
FOREIGN KEY ("toAgentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_delegations"
ADD CONSTRAINT "agent_delegations_parentDelegationId_fkey"
FOREIGN KEY ("parentDelegationId") REFERENCES "agent_delegations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_approval_requests"
ADD CONSTRAINT "agent_approval_requests_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_approval_requests"
ADD CONSTRAINT "agent_approval_requests_operatorId_fkey"
FOREIGN KEY ("operatorId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_approval_requests"
ADD CONSTRAINT "agent_approval_requests_audienceId_fkey"
FOREIGN KEY ("audienceId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_verification_challenges"
ADD CONSTRAINT "agent_verification_challenges_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_verification_challenges"
ADD CONSTRAINT "agent_verification_challenges_audienceId_fkey"
FOREIGN KEY ("audienceId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_verification_failure_windows"
ADD CONSTRAINT "agent_verification_failure_windows_audienceId_fkey"
FOREIGN KEY ("audienceId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_verification_failure_windows"
ADD CONSTRAINT "agent_verification_failure_windows_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_authorization_operations"
ADD CONSTRAINT "agent_authorization_operations_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_authorization_operations"
ADD CONSTRAINT "agent_authorization_operations_audienceId_fkey"
FOREIGN KEY ("audienceId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_authorization_usage"
ADD CONSTRAINT "agent_authorization_usage_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_authorization_usage"
ADD CONSTRAINT "agent_authorization_usage_delegationId_fkey"
FOREIGN KEY ("delegationId") REFERENCES "agent_delegations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
