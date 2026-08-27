-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('IDENTITY_CREATED', 'IDENTITY_UPDATED', 'IDENTITY_RECOVERED', 'IDENTITY_SUSPENDED', 'IDENTITY_REVOKED', 'CREDENTIAL_ISSUED', 'CREDENTIAL_VERIFIED', 'CREDENTIAL_REVOKED', 'CREDENTIAL_SUSPENDED', 'CREDENTIAL_EXPIRED', 'VERIFICATION_REQUESTED', 'VERIFICATION_COMPLETED', 'VERIFICATION_FAILED', 'DELEGATION_GRANTED', 'DELEGATION_REVOKED', 'SCHEMA_PROPOSED', 'SCHEMA_APPROVED', 'SCHEMA_REJECTED', 'SCHEMA_REVOKED', 'TEE_ATTESTATION_VERIFIED', 'GOV_API_CALLED', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_FAILED', 'RATE_LIMIT_HIT', 'SIGNING_KEY_ROTATED', 'AGENT_REGISTERED', 'AGENT_CAPABILITIES_UPDATED', 'AGENT_DELEGATION_CREATED', 'AGENT_SUSPENDED', 'AGENT_ACTION_APPROVED', 'AGENT_ACTION_REJECTED', 'RISK_ASSESSMENT', 'FRAUD_ASSESSMENT', 'FRAUD_ALERT_RESOLVED', 'BIOMETRIC_ANALYSIS', 'COMPLIANCE_ADVISOR_QUERY', 'SANCTIONS_SCREENING', 'AUDIT_LOG_ACCESSED', 'AUDIT_LOG_EXPORTED');

-- CreateEnum
CREATE TYPE "SchemaStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "AgentActionDecision" AS ENUM ('ALLOWED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplianceScreeningResult" AS ENUM ('CLEAR', 'POTENTIAL_MATCH', 'CONFIRMED_MATCH', 'FALSE_POSITIVE', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FAILING', 'DISABLED');

-- CreateEnum
CREATE TYPE "IssuerTrustStatus" AS ENUM ('PENDING_REVIEW', 'ACCREDITED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "IssuerKeyStatus" AS ENUM ('ACTIVE', 'RETIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PolicyReceiptType" AS ENUM ('COMPLIANCE_EVALUATION', 'REGULATORY_REPORT', 'CROSS_BORDER_ASSESSMENT', 'PRIVACY_IMPACT_ASSESSMENT', 'BREACH_NOTIFICATION', 'SANCTIONS_SCREENING');

-- CreateEnum
CREATE TYPE "PolicyDefinitionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'DEPRECATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PolicyExceptionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "BridgeStatus" AS ENUM ('INITIATED', 'SOURCE_CONFIRMED', 'RELAYING', 'DESTINATION_CONFIRMED', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL DEFAULT 'v1',
    "keyAlgorithm" TEXT NOT NULL DEFAULT 'ES256',
    "verificationMethod" TEXT,
    "recoveryHash" TEXT NOT NULL,
    "displayName" TEXT,
    "metadata" JSONB,
    "status" "IdentityStatus" NOT NULL DEFAULT 'PENDING',
    "teeAttested" BOOLEAN NOT NULL DEFAULT false,
    "teeAttestationId" TEXT,
    "governmentVerified" BOOLEAN NOT NULL DEFAULT false,
    "governmentRefId" TEXT,
    "delegatedTo" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "credentialType" TEXT NOT NULL,
    "schemaId" TEXT,
    "issuerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "claimsHash" TEXT NOT NULL,
    "proof" JSONB,
    "zkProofId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "revocationReason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT,
    "verifierId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "verificationType" TEXT NOT NULL,
    "zkProofData" JSONB,
    "teeAttestation" JSONB,
    "result" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "resultDetails" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "identityId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "previousState" JSONB,
    "newState" JSONB,
    "previousHash" TEXT,
    "entryHash" TEXT,
    "integrityVersion" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_governance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "schemaDefinition" JSONB NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "status" "SchemaStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalVotes" INTEGER NOT NULL DEFAULT 0,
    "rejectionVotes" INTEGER NOT NULL DEFAULT 0,
    "voters" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schema_governance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revocation_registry" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "revokedBy" TEXT NOT NULL,

    CONSTRAINT "revocation_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "agentDid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "operatorId" TEXT NOT NULL,
    "controllerDid" TEXT,
    "riskTier" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "agentType" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "delegationChain" JSONB,
    "maxDelegationDepth" INTEGER NOT NULL DEFAULT 3,
    "reputationScore" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "humanApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
    "metadata" JSONB,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetResource" TEXT,
    "controllerDid" TEXT,
    "policyId" TEXT,
    "decision" "AgentActionDecision",
    "parameters" JSONB,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN,
    "approvedBy" TEXT,
    "result" JSONB,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_credentials" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "credentialType" TEXT NOT NULL,
    "capabilities" TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxRiskTier" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "controllerDid" TEXT,
    "revocationNonce" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "identityRisk" DOUBLE PRECISION,
    "credentialRisk" DOUBLE PRECISION,
    "transactionRisk" DOUBLE PRECISION,
    "networkRisk" DOUBLE PRECISION,
    "behavioralRisk" DOUBLE PRECISION,
    "level" "RiskLevel" NOT NULL,
    "factors" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioral_profiles" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "keystrokeProfile" JSONB,
    "mouseProfile" JSONB,
    "touchProfile" JSONB,
    "deviceFingerprints" JSONB,
    "sessionPatterns" JSONB,
    "baselineScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavioral_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_screenings" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "screeningType" TEXT NOT NULL,
    "queryName" TEXT NOT NULL,
    "queryDetails" JSONB,
    "result" "ComplianceScreeningResult" NOT NULL DEFAULT 'UNDER_REVIEW',
    "matchScore" DOUBLE PRECISION,
    "matches" JSONB,
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,
    "listsChecked" TEXT[],
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "nextScreeningDue" TIMESTAMP(3),

    CONSTRAINT "compliance_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_alerts" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entityId" TEXT,
    "entityType" TEXT,
    "actionRequired" BOOLEAN NOT NULL DEFAULT true,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_compliance" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "jurisdictionCode" TEXT NOT NULL,
    "requiredCredentials" JSONB NOT NULL,
    "heldCredentials" JSONB NOT NULL,
    "complianceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gapAnalysis" JSONB,
    "dataResidency" TEXT,
    "lastAssessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jurisdiction_compliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_reports" (
    "id" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "jurisdictionCode" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "reportData" JSONB NOT NULL,
    "filingReference" TEXT,
    "filedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "legalBasis" TEXT NOT NULL,
    "dataCategories" TEXT[],
    "processorId" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
    "ipAllowlist" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "jurisdictions" TEXT[],
    "settings" JSONB,
    "billingEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuer_trust_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "issuerDid" TEXT NOT NULL,
    "status" "IssuerTrustStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "accreditationScope" TEXT NOT NULL DEFAULT 'enterprise',
    "assuranceLevel" TEXT NOT NULL DEFAULT 'standard',
    "allowedCredentialTypes" TEXT[],
    "allowedJurisdictions" TEXT[],
    "proposedByIdentityId" TEXT NOT NULL,
    "accreditedByIdentityId" TEXT,
    "suspensionReason" TEXT,
    "metadata" JSONB,
    "accreditedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuer_trust_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuer_key_history" (
    "id" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "issuerDid" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "status" "IssuerKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "rotatedByIdentityId" TEXT,
    "metadata" JSONB,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_key_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decision_ledger" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorIdentityId" TEXT NOT NULL,
    "receiptType" "PolicyReceiptType" NOT NULL,
    "policyName" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyDefinitionId" TEXT,
    "policyReference" TEXT,
    "policyApprovedByIdentityId" TEXT,
    "policyEffectiveFrom" TIMESTAMP(3),
    "policyExpiresAt" TIMESTAMP(3),
    "policyGovernanceProfileId" TEXT,
    "policyGovernanceProfileLabel" TEXT,
    "policyGovernancePackId" TEXT,
    "policyGovernancePackVersion" TEXT,
    "policyGovernancePackLabel" TEXT,
    "policyGovernanceRationale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subjectEntityId" TEXT,
    "policyExceptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policyExceptionCount" INTEGER NOT NULL DEFAULT 0,
    "jurisdictionCodes" TEXT[],
    "decisionSummary" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "outputDigest" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "integrityHash" TEXT NOT NULL,
    "integrityToken" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_decision_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PolicyDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalMode" TEXT NOT NULL DEFAULT 'single_admin',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "requiredApprovalRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredApprovalClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredApprovalJurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "governanceProfileId" TEXT,
    "governanceProfileLabel" TEXT,
    "governancePackId" TEXT,
    "governancePackVersion" TEXT,
    "governancePackLabel" TEXT,
    "governanceProfileRationale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalTrail" JSONB,
    "definition" JSONB NOT NULL,
    "changeSummary" TEXT,
    "proposedByIdentityId" TEXT NOT NULL,
    "approvedByIdentityId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "deprecatedAt" TIMESTAMP(3),
    "deprecatedByIdentityId" TEXT,
    "deprecationReason" TEXT,
    "supersededByPolicyDefinitionId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByIdentityId" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_exceptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyDefinitionId" TEXT,
    "policyName" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyReference" TEXT NOT NULL,
    "subjectEntityId" TEXT,
    "scope" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "conditions" JSONB,
    "approvalMode" TEXT NOT NULL DEFAULT 'single_admin',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "requiredApprovalRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredApprovalClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredApprovalJurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "governanceProfileId" TEXT,
    "governanceProfileLabel" TEXT,
    "governancePackId" TEXT,
    "governancePackVersion" TEXT,
    "governancePackLabel" TEXT,
    "governanceProfileRationale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalTrail" JSONB,
    "status" "PolicyExceptionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "requestedByIdentityId" TEXT NOT NULL,
    "approvedByIdentityId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByIdentityId" TEXT,
    "revocationReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "permissions" TEXT[],
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "responseTimeMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage_logs" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "requestSize" INTEGER,
    "responseSize" INTEGER,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_transactions" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "sourceChain" TEXT NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "sourceAddress" TEXT NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "status" "BridgeStatus" NOT NULL DEFAULT 'INITIATED',
    "sourceTxHash" TEXT,
    "destinationTxHash" TEXT,
    "relayerAddress" TEXT,
    "fee" TEXT,
    "fraudProofWindow" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "bridge_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_issuers" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "jurisdictions" TEXT[],
    "specializations" TEXT[],
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "credentialsIssued" INTEGER NOT NULL DEFAULT 0,
    "verificationsCompleted" INTEGER NOT NULL DEFAULT 0,
    "averageIssuanceTimeSec" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_issuers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "schemaId" TEXT,
    "credentialType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" TEXT,
    "stakingRequired" TEXT,
    "jurisdictions" TEXT[],
    "requirements" JSONB,
    "estimatedTimeMin" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "oid4vp_presentation_requests" (
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decision" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oid4vp_presentation_requests_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "oid4vci_offers" (
    "preAuthCode" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "subjectDid" TEXT NOT NULL,
    "txCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oid4vci_offers_pkey" PRIMARY KEY ("preAuthCode")
);

-- CreateTable
CREATE TABLE "oid4vci_token_sessions" (
    "accessToken" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "subjectDid" TEXT NOT NULL,
    "cNonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oid4vci_token_sessions_pkey" PRIMARY KEY ("accessToken")
);

-- CreateIndex
CREATE UNIQUE INDEX "identities_did_key" ON "identities"("did");

-- CreateIndex
CREATE INDEX "identities_did_idx" ON "identities"("did");

-- CreateIndex
CREATE INDEX "identities_status_idx" ON "identities"("status");

-- CreateIndex
CREATE INDEX "identities_createdAt_idx" ON "identities"("createdAt");

-- CreateIndex
CREATE INDEX "credentials_subjectId_idx" ON "credentials"("subjectId");

-- CreateIndex
CREATE INDEX "credentials_issuerId_idx" ON "credentials"("issuerId");

-- CreateIndex
CREATE INDEX "credentials_credentialType_idx" ON "credentials"("credentialType");

-- CreateIndex
CREATE INDEX "credentials_status_idx" ON "credentials"("status");

-- CreateIndex
CREATE INDEX "credentials_expiresAt_idx" ON "credentials"("expiresAt");

-- CreateIndex
CREATE INDEX "verifications_verifierId_idx" ON "verifications"("verifierId");

-- CreateIndex
CREATE INDEX "verifications_subjectId_idx" ON "verifications"("subjectId");

-- CreateIndex
CREATE INDEX "verifications_result_idx" ON "verifications"("result");

-- CreateIndex
CREATE INDEX "verifications_requestedAt_idx" ON "verifications"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_entryHash_key" ON "audit_logs"("entryHash");

-- CreateIndex
CREATE INDEX "audit_logs_identityId_idx" ON "audit_logs"("identityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_previousHash_idx" ON "audit_logs"("previousHash");

-- CreateIndex
CREATE INDEX "schema_governance_status_idx" ON "schema_governance"("status");

-- CreateIndex
CREATE INDEX "schema_governance_proposedBy_idx" ON "schema_governance"("proposedBy");

-- CreateIndex
CREATE UNIQUE INDEX "schema_governance_name_version_key" ON "schema_governance"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_identityId_idx" ON "sessions"("identityId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "revocation_registry_credentialId_key" ON "revocation_registry"("credentialId");

-- CreateIndex
CREATE INDEX "revocation_registry_credentialId_idx" ON "revocation_registry"("credentialId");

-- CreateIndex
CREATE INDEX "revocation_registry_revokedAt_idx" ON "revocation_registry"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_agentDid_key" ON "ai_agents"("agentDid");

-- CreateIndex
CREATE INDEX "ai_agents_operatorId_idx" ON "ai_agents"("operatorId");

-- CreateIndex
CREATE INDEX "ai_agents_status_idx" ON "ai_agents"("status");

-- CreateIndex
CREATE INDEX "ai_agents_agentType_idx" ON "ai_agents"("agentType");

-- CreateIndex
CREATE INDEX "ai_agents_reputationScore_idx" ON "ai_agents"("reputationScore");

-- CreateIndex
CREATE INDEX "agent_actions_agentId_idx" ON "agent_actions"("agentId");

-- CreateIndex
CREATE INDEX "agent_actions_actionType_idx" ON "agent_actions"("actionType");

-- CreateIndex
CREATE INDEX "agent_actions_requiresApproval_approved_idx" ON "agent_actions"("requiresApproval", "approved");

-- CreateIndex
CREATE INDEX "agent_actions_createdAt_idx" ON "agent_actions"("createdAt");

-- CreateIndex
CREATE INDEX "agent_credentials_agentId_idx" ON "agent_credentials"("agentId");

-- CreateIndex
CREATE INDEX "agent_credentials_status_idx" ON "agent_credentials"("status");

-- CreateIndex
CREATE INDEX "risk_assessments_entityId_entityType_idx" ON "risk_assessments"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "risk_assessments_level_idx" ON "risk_assessments"("level");

-- CreateIndex
CREATE INDEX "risk_assessments_assessedAt_idx" ON "risk_assessments"("assessedAt");

-- CreateIndex
CREATE INDEX "risk_assessments_decision_idx" ON "risk_assessments"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "behavioral_profiles_identityId_key" ON "behavioral_profiles"("identityId");

-- CreateIndex
CREATE INDEX "behavioral_profiles_identityId_idx" ON "behavioral_profiles"("identityId");

-- CreateIndex
CREATE INDEX "compliance_screenings_entityId_entityType_idx" ON "compliance_screenings"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "compliance_screenings_result_idx" ON "compliance_screenings"("result");

-- CreateIndex
CREATE INDEX "compliance_screenings_screenedAt_idx" ON "compliance_screenings"("screenedAt");

-- CreateIndex
CREATE INDEX "compliance_screenings_nextScreeningDue_idx" ON "compliance_screenings"("nextScreeningDue");

-- CreateIndex
CREATE INDEX "compliance_alerts_severity_idx" ON "compliance_alerts"("severity");

-- CreateIndex
CREATE INDEX "compliance_alerts_acknowledged_idx" ON "compliance_alerts"("acknowledged");

-- CreateIndex
CREATE INDEX "compliance_alerts_createdAt_idx" ON "compliance_alerts"("createdAt");

-- CreateIndex
CREATE INDEX "compliance_alerts_alertType_idx" ON "compliance_alerts"("alertType");

-- CreateIndex
CREATE INDEX "jurisdiction_compliance_identityId_idx" ON "jurisdiction_compliance"("identityId");

-- CreateIndex
CREATE INDEX "jurisdiction_compliance_jurisdictionCode_idx" ON "jurisdiction_compliance"("jurisdictionCode");

-- CreateIndex
CREATE INDEX "jurisdiction_compliance_complianceScore_idx" ON "jurisdiction_compliance"("complianceScore");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_compliance_identityId_jurisdictionCode_key" ON "jurisdiction_compliance"("identityId", "jurisdictionCode");

-- CreateIndex
CREATE INDEX "regulatory_reports_reportType_idx" ON "regulatory_reports"("reportType");

-- CreateIndex
CREATE INDEX "regulatory_reports_jurisdictionCode_idx" ON "regulatory_reports"("jurisdictionCode");

-- CreateIndex
CREATE INDEX "regulatory_reports_entityId_idx" ON "regulatory_reports"("entityId");

-- CreateIndex
CREATE INDEX "regulatory_reports_status_idx" ON "regulatory_reports"("status");

-- CreateIndex
CREATE INDEX "consent_records_identityId_idx" ON "consent_records"("identityId");

-- CreateIndex
CREATE INDEX "consent_records_purpose_idx" ON "consent_records"("purpose");

-- CreateIndex
CREATE INDEX "consent_records_revokedAt_idx" ON "consent_records"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "api_keys"("organizationId");

-- CreateIndex
CREATE INDEX "api_keys_isActive_idx" ON "api_keys"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_domain_key" ON "organizations"("domain");

-- CreateIndex
CREATE INDEX "organizations_domain_idx" ON "organizations"("domain");

-- CreateIndex
CREATE INDEX "issuer_trust_records_organizationId_idx" ON "issuer_trust_records"("organizationId");

-- CreateIndex
CREATE INDEX "issuer_trust_records_issuerIdentityId_idx" ON "issuer_trust_records"("issuerIdentityId");

-- CreateIndex
CREATE INDEX "issuer_trust_records_status_idx" ON "issuer_trust_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "issuer_trust_records_organizationId_issuerIdentityId_key" ON "issuer_trust_records"("organizationId", "issuerIdentityId");

-- CreateIndex
CREATE INDEX "issuer_key_history_issuerIdentityId_idx" ON "issuer_key_history"("issuerIdentityId");

-- CreateIndex
CREATE INDEX "issuer_key_history_issuerDid_keyVersion_idx" ON "issuer_key_history"("issuerDid", "keyVersion");

-- CreateIndex
CREATE INDEX "issuer_key_history_status_idx" ON "issuer_key_history"("status");

-- CreateIndex
CREATE UNIQUE INDEX "issuer_key_history_issuerIdentityId_keyVersion_key" ON "issuer_key_history"("issuerIdentityId", "keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "policy_decision_ledger_receiptId_key" ON "policy_decision_ledger"("receiptId");

-- CreateIndex
CREATE INDEX "policy_decision_ledger_organizationId_createdAt_idx" ON "policy_decision_ledger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "policy_decision_ledger_actorIdentityId_createdAt_idx" ON "policy_decision_ledger"("actorIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "policy_decision_ledger_receiptType_createdAt_idx" ON "policy_decision_ledger"("receiptType", "createdAt");

-- CreateIndex
CREATE INDEX "policy_decision_ledger_subjectEntityId_idx" ON "policy_decision_ledger"("subjectEntityId");

-- CreateIndex
CREATE INDEX "policy_definitions_organizationId_name_status_idx" ON "policy_definitions"("organizationId", "name", "status");

-- CreateIndex
CREATE INDEX "policy_definitions_effectiveFrom_idx" ON "policy_definitions"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "policy_definitions_organizationId_name_version_key" ON "policy_definitions"("organizationId", "name", "version");

-- CreateIndex
CREATE INDEX "policy_exceptions_organizationId_policyName_status_idx" ON "policy_exceptions"("organizationId", "policyName", "status");

-- CreateIndex
CREATE INDEX "policy_exceptions_subjectEntityId_status_idx" ON "policy_exceptions"("subjectEntityId", "status");

-- CreateIndex
CREATE INDEX "policy_exceptions_effectiveFrom_expiresAt_idx" ON "policy_exceptions"("effectiveFrom", "expiresAt");

-- CreateIndex
CREATE INDEX "organization_members_identityId_idx" ON "organization_members"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_identityId_key" ON "organization_members"("organizationId", "identityId");

-- CreateIndex
CREATE INDEX "webhooks_organizationId_idx" ON "webhooks"("organizationId");

-- CreateIndex
CREATE INDEX "webhooks_status_idx" ON "webhooks"("status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_idx" ON "webhook_deliveries"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_success_idx" ON "webhook_deliveries"("success");

-- CreateIndex
CREATE INDEX "webhook_deliveries_deliveredAt_idx" ON "webhook_deliveries"("deliveredAt");

-- CreateIndex
CREATE INDEX "api_usage_logs_apiKeyId_idx" ON "api_usage_logs"("apiKeyId");

-- CreateIndex
CREATE INDEX "api_usage_logs_endpoint_idx" ON "api_usage_logs"("endpoint");

-- CreateIndex
CREATE INDEX "api_usage_logs_timestamp_idx" ON "api_usage_logs"("timestamp");

-- CreateIndex
CREATE INDEX "bridge_transactions_credentialId_idx" ON "bridge_transactions"("credentialId");

-- CreateIndex
CREATE INDEX "bridge_transactions_sourceChain_destinationChain_idx" ON "bridge_transactions"("sourceChain", "destinationChain");

-- CreateIndex
CREATE INDEX "bridge_transactions_status_idx" ON "bridge_transactions"("status");

-- CreateIndex
CREATE INDEX "bridge_transactions_initiatedAt_idx" ON "bridge_transactions"("initiatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_issuers_identityId_key" ON "marketplace_issuers"("identityId");

-- CreateIndex
CREATE INDEX "marketplace_issuers_trustScore_idx" ON "marketplace_issuers"("trustScore");

-- CreateIndex
CREATE INDEX "marketplace_issuers_isVerified_idx" ON "marketplace_issuers"("isVerified");

-- CreateIndex
CREATE INDEX "marketplace_listings_issuerId_idx" ON "marketplace_listings"("issuerId");

-- CreateIndex
CREATE INDEX "marketplace_listings_credentialType_idx" ON "marketplace_listings"("credentialType");

-- CreateIndex
CREATE INDEX "marketplace_listings_isActive_idx" ON "marketplace_listings"("isActive");

-- CreateIndex
CREATE INDEX "idempotency_records_scope_createdAt_idx" ON "idempotency_records"("scope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "oid4vp_presentation_requests_nonce_key" ON "oid4vp_presentation_requests"("nonce");

-- CreateIndex
CREATE INDEX "oid4vp_presentation_requests_status_expiresAt_idx" ON "oid4vp_presentation_requests"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "schema_governance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schema_governance" ADD CONSTRAINT "schema_governance_proposedBy_fkey" FOREIGN KEY ("proposedBy") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "risk_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuer_trust_records" ADD CONSTRAINT "issuer_trust_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuer_trust_records" ADD CONSTRAINT "issuer_trust_records_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuer_key_history" ADD CONSTRAINT "issuer_key_history_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decision_ledger" ADD CONSTRAINT "policy_decision_ledger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decision_ledger" ADD CONSTRAINT "policy_decision_ledger_actorIdentityId_fkey" FOREIGN KEY ("actorIdentityId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_definitions" ADD CONSTRAINT "policy_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_exceptions" ADD CONSTRAINT "policy_exceptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_exceptions" ADD CONSTRAINT "policy_exceptions_policyDefinitionId_fkey" FOREIGN KEY ("policyDefinitionId") REFERENCES "policy_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "marketplace_issuers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
