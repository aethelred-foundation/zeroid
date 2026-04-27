import { prisma, logger, redis, credentialIssuedCounter } from '../index';
import { CredentialStatus } from '@prisma/client';
import crypto from 'crypto';
import {
  EnterpriseKeySigner,
  EnterpriseSigningError,
  type EnterpriseKmsProvider,
} from './enterprise/enterprise-key-signer';

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Custom error (declared early so KMS classes can reference it)
// ---------------------------------------------------------------------------
export class CredentialError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Credential Signer Adapter
// ---------------------------------------------------------------------------
class KMSCredentialSigner {
  private readonly signer: EnterpriseKeySigner;
  private readonly provider: EnterpriseKmsProvider;

  constructor() {
    if (
      isProductionRuntime() &&
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === 'true'
    ) {
      throw new CredentialError(
        'Legacy HMAC credential verification is blocked in production. Migrate all credentials to asymmetric signatures before launch.',
        'CRED_LEGACY_SIGNING_BLOCKED',
        500,
      );
    }

    this.provider =
      (process.env.KMS_PROVIDER as EnterpriseKmsProvider) || 'local';
    try {
      this.signer = new EnterpriseKeySigner({
        provider: this.provider,
        keyId: process.env.KMS_KEY_ID || '',
        keyVersion: process.env.KMS_KEY_VERSION || '1',
        privateKeyEnvKey: 'CREDENTIAL_SIGNING_PRIVATE_KEY',
        publicKeyEnvKey: 'CREDENTIAL_SIGNING_PUBLIC_KEY',
        verificationMethodEnvKey: 'CREDENTIAL_SIGNING_VERIFICATION_METHOD',
        defaultVerificationMethod:
          'did:aethelred:zeroid:credential-signer#key-1',
        allowLocalSigning: !isProductionRuntime(),
        localSigningBlockedMessage:
          'Local credential signing is blocked in production. Configure AWS/GCP/Azure KMS.',
        localSigningBlockedCode: 'CRED_LOCAL_SIGNING_BLOCKED',
        signingUnavailableMessage:
          'CREDENTIAL_SIGNING_PRIVATE_KEY not configured. Credential issuance is disabled until signing is configured.',
        signingUnavailableCode: 'CRED_SIGNING_UNAVAILABLE',
        kmsConfigMissingCode: 'CRED_KMS_CONFIG_MISSING',
        kmsUnsupportedProviderCode: 'CRED_KMS_UNSUPPORTED_PROVIDER',
        kmsSignFailedCode: 'CRED_KMS_SIGN_FAILED',
        kmsPublicKeyFailedCode: 'CRED_KMS_PUBKEY_FAILED',
        kmsAuthFailedCode: 'CRED_KMS_AUTH_FAILED',
        awsSigningAlgorithmEnvKey: 'AWS_KMS_SIGNING_ALGORITHM',
        gcpAccessTokenEnvKey: 'GCP_ACCESS_TOKEN',
        azureAccessTokenEnvKey: 'AZURE_ACCESS_TOKEN',
        azureKeyVaultNameEnvKey: 'AZURE_KEYVAULT_NAME',
        azureKeyNameEnvKey: 'AZURE_KEY_NAME',
        azureAlgorithmEnvKey: 'AZURE_KMS_ALGORITHM',
        logger,
      });
    } catch (error) {
      throw this.toCredentialError(error);
    }

    logger.info('kms_signer_initialized', {
      provider: this.provider,
      keyVersion: this.signer.getKeyVersion(),
      keyIdPrefix: process.env.KMS_KEY_ID
        ? process.env.KMS_KEY_ID.substring(0, 12) + '...'
        : 'n/a',
    });
  }

  async sign(message: Buffer): Promise<Buffer> {
    try {
      return await this.signer.sign(message);
    } catch (error) {
      throw this.toCredentialError(error);
    }
  }

  async getPublicKey(): Promise<crypto.KeyObject> {
    try {
      return await this.signer.getPublicKey();
    } catch (error) {
      throw this.toCredentialError(error);
    }
  }

  getProofType(): string {
    return this.signer.getProofType();
  }

  getVerificationMethod(): string {
    return this.signer.getVerificationMethod();
  }

  supportsKeyRotation(): boolean {
    return this.signer.supportsKeyRotation();
  }

  getKeyVersion(): string {
    return this.signer.getKeyVersion();
  }

  rotateToVersion(newVersion: string): string {
    try {
      const previousVersion = this.signer.rotateToVersion(newVersion);
      logger.info('kms_key_rotated', {
        provider: this.provider,
        previousVersion,
        newVersion,
      });
      return previousVersion;
    } catch (error) {
      throw this.toCredentialError(error, 'CRED_ROTATION_UNSUPPORTED');
    }
  }

  private toCredentialError(
    error: unknown,
    fallbackCode?: string,
  ): CredentialError {
    if (error instanceof CredentialError) {
      return error;
    }
    if (error instanceof EnterpriseSigningError) {
      return new CredentialError(
        error.message,
        fallbackCode ?? error.code,
        error.statusCode,
      );
    }
    return new CredentialError(
      (error as Error).message,
      fallbackCode ?? 'CRED_KMS_SIGN_FAILED',
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface IssueCredentialRequest {
  credentialType: string;
  issuerId: string;
  issuerDid: string;
  subjectId: string;
  subjectDid: string;
  claims: Record<string, unknown>;
  expiresAt?: Date;
  schemaId?: string;
  issuerProof?: IssuerCredentialProof;
}

export interface IssuerCredentialProof {
  type?: string;
  created?: string;
  verificationMethod?: string;
  proofPurpose?: 'assertionMethod';
  issuerDid?: string;
  keyVersion?: string;
  credentialBinding?: CredentialSignatureBinding;
  signatureValue: string;
}

export interface CredentialSignatureBinding {
  version: 'zeroid.credential.signature.v2';
  proofPurpose: 'assertionMethod';
  issuerDid: string;
  issuerId: string;
  subjectDid: string;
  subjectId: string;
  credentialType: string;
  schemaId: string | null;
  expiresAt: string | null;
  claimsHash: string;
}

export interface CredentialResponse {
  id: string;
  credentialType: string;
  issuerId: string;
  subjectId: string;
  claims: Record<string, unknown>;
  claimsHash: string;
  proof: unknown;
  status: string;
  issuedAt: Date;
  expiresAt: Date | null;
}

export interface CredentialVerificationResult {
  valid: boolean;
  credential: CredentialResponse;
  checks: Record<string, boolean>;
}

export interface CredentialEvidenceExport {
  formatVersion: 'zeroid.credential_evidence_export.v1';
  exportedAt: string;
  credential: CredentialResponse;
  verification: {
    valid: boolean;
    checks: Record<string, boolean>;
  };
  issuer: {
    identityId: string;
    did?: string;
    status?: string;
    keyVersion?: string;
    keyAlgorithm?: string;
    verificationMethod?: string | null;
  };
  subject: {
    identityId: string;
    did?: string;
    status?: string;
  };
  trustLineage?: {
    enforced: boolean;
    selectedTrustRecordId?: string;
    accreditationScope?: string;
    assuranceLevel?: string;
    evaluatedJurisdictions: string[];
    matchedJurisdictions: string[];
    trustRecord?: {
      trustRecordId: string;
      status: string;
      accreditationScope?: string;
      assuranceLevel?: string;
      allowedCredentialTypes: string[];
      allowedJurisdictions: string[];
      proposedByIdentityId?: string | null;
      accreditedByIdentityId?: string | null;
      suspensionReason?: string | null;
      metadata?: Record<string, unknown> | null;
      accreditedAt?: string;
      expiresAt?: string;
      updatedAt?: string;
    };
    keyLineage?: {
      current?: {
        keyHistoryId: string;
        keyVersion: string;
        keyAlgorithm: string;
        verificationMethod: string;
        status: string;
        validFrom: string;
        validUntil?: string | null;
        rotatedByIdentityId?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string;
      };
      history: Array<{
        keyHistoryId: string;
        keyVersion: string;
        keyAlgorithm: string;
        verificationMethod: string;
        status: string;
        validFrom: string;
        validUntil?: string | null;
        rotatedByIdentityId?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string;
      }>;
    };
  };
}

export interface CredentialQuery {
  subjectId?: string;
  issuerId?: string;
  credentialType?: string;
  status?: CredentialStatus;
  page: number;
  limit: number;
}

export interface RevocationRequest {
  credentialId: string;
  revokedBy: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Credential Service
// ---------------------------------------------------------------------------
export class CredentialService {
  private readonly signer: KMSCredentialSigner;

  constructor() {
    this.signer = new KMSCredentialSigner();
  }

  // -------------------------------------------------------------------------
  // Issue a new credential
  // -------------------------------------------------------------------------
  async issueCredential(
    request: IssueCredentialRequest,
  ): Promise<CredentialResponse> {
    logger.info('credential_issuance_start', {
      credentialType: request.credentialType,
      issuerId: request.issuerId,
      subjectId: request.subjectId,
    });

    // Verify issuer exists and is active
    const issuer = await prisma.identity.findUnique({
      where: { id: request.issuerId },
    });
    if (!issuer || issuer.status !== 'ACTIVE') {
      throw new CredentialError(
        'Issuer identity is not active',
        'CRED_ISSUER_INACTIVE',
      );
    }
    if (issuer.did !== request.issuerDid) {
      throw new CredentialError(
        'Issuer DID does not match authenticated issuer identity',
        'CRED_ISSUER_DID_MISMATCH',
        403,
      );
    }

    // Verify subject exists and is active
    const subject = await prisma.identity.findUnique({
      where: { id: request.subjectId },
    });
    if (!subject || subject.status !== 'ACTIVE') {
      throw new CredentialError(
        'Subject identity is not active',
        'CRED_SUBJECT_INACTIVE',
      );
    }
    if (subject.did !== request.subjectDid) {
      throw new CredentialError(
        'Subject DID does not match the requested subject identity',
        'CRED_SUBJECT_DID_MISMATCH',
        400,
      );
    }

    const evaluatedJurisdictions = this.extractCredentialJurisdictions(
      request.claims,
    );
    const trustPolicy = await this.resolveIssuerTrustPolicy(
      request.issuerId,
      request.credentialType,
      evaluatedJurisdictions,
    );
    if (trustPolicy.enforced && !trustPolicy.accredited) {
      if (trustPolicy.denialReason === 'jurisdiction_not_accredited') {
        throw new CredentialError(
          'Issuer is not accredited to issue this credential in the requested jurisdiction',
          'CRED_ISSUER_NOT_ACCREDITED_FOR_JURISDICTION',
          403,
        );
      }
      throw new CredentialError(
        'Issuer is not accredited to issue this credential type',
        'CRED_ISSUER_NOT_ACCREDITED_FOR_TYPE',
        403,
      );
    }

    // Validate schema if provided
    if (request.schemaId) {
      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: request.schemaId },
      });
      if (!schema || schema.status !== 'APPROVED') {
        throw new CredentialError(
          'Schema not found or not approved',
          'CRED_SCHEMA_INVALID',
        );
      }
      this.validateClaimsAgainstSchema(
        request.claims,
        schema.schemaDefinition as Record<string, unknown>,
      );
    }

    // Hash claims for integrity verification
    const claimsHash = await this.hashClaims(request.claims);

    // Check for duplicate credential
    const existing = await prisma.credential.findFirst({
      where: {
        credentialType: request.credentialType,
        issuerId: request.issuerId,
        subjectId: request.subjectId,
        claimsHash,
        status: 'ACTIVE',
      },
    });
    if (existing) {
      throw new CredentialError(
        'Duplicate credential already exists',
        'CRED_DUPLICATE',
      );
    }

    const proof = await this.buildCredentialProof(request, issuer, claimsHash);

    // Create the credential
    const credential = await prisma.credential.create({
      data: {
        credentialType: request.credentialType,
        issuerId: request.issuerId,
        subjectId: request.subjectId,
        schemaId: request.schemaId,
        claims: request.claims as any,
        claimsHash,
        proof: proof as any,
        expiresAt: request.expiresAt,
        status: 'ACTIVE',
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        identityId: request.issuerId,
        action: 'CREDENTIAL_ISSUED',
        resourceType: 'credential',
        resourceId: credential.id,
        details: {
          credentialType: request.credentialType,
          subjectId: request.subjectId,
          subjectDid: request.subjectDid,
          schemaId: request.schemaId,
          keyVersion: this.signer.getKeyVersion(),
          issuerTrustPolicy: {
            enforced: trustPolicy.enforced,
            accredited: trustPolicy.accredited,
            trustRecordId: trustPolicy.trustRecordId ?? null,
            accreditationScope: trustPolicy.accreditationScope ?? null,
            assuranceLevel: trustPolicy.assuranceLevel ?? null,
            evaluatedJurisdictions: trustPolicy.evaluatedJurisdictions,
            matchedJurisdictions: trustPolicy.matchedJurisdictions,
          },
        },
      },
    });

    // Invalidate cached credential lists
    await redis.del(`creds:subject:${request.subjectId}`);
    await redis.del(`creds:issuer:${request.issuerId}`);

    credentialIssuedCounter.inc();

    logger.info('credential_issued', {
      credentialId: credential.id,
      credentialType: request.credentialType,
      subjectId: request.subjectId,
      keyVersion: this.signer.getKeyVersion(),
      trustPolicyEnforced: trustPolicy.enforced,
      issuerTrustRecordId: trustPolicy.trustRecordId ?? null,
      issuerTrustAssuranceLevel: trustPolicy.assuranceLevel ?? null,
      issuerTrustMatchedJurisdictions: trustPolicy.matchedJurisdictions,
    });

    return this.formatCredential(credential);
  }

  private async resolveIssuerTrustPolicy(
    issuerId: string,
    credentialType: string,
    evaluatedJurisdictions: string[] = [],
  ): Promise<{
    enforced: boolean;
    accredited: boolean;
    trustRecordId?: string;
    accreditationScope?: string;
    assuranceLevel?: string;
    matchedJurisdictions: string[];
    evaluatedJurisdictions: string[];
    denialReason?:
      | 'credential_type_not_accredited'
      | 'jurisdiction_not_accredited';
  }> {
    const issuerTrustModel = (prisma as any).issuerTrustRecord;
    if (!issuerTrustModel?.findMany) {
      return {
        enforced: false,
        accredited: true,
        matchedJurisdictions: [],
        evaluatedJurisdictions,
      };
    }

    const records = await issuerTrustModel.findMany({
      where: {
        issuerIdentityId: issuerId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!Array.isArray(records) || records.length === 0) {
      return {
        enforced: false,
        accredited: true,
        matchedJurisdictions: [],
        evaluatedJurisdictions,
      };
    }

    const {
      activeAccreditations,
      typedAccreditations,
      selectedAccreditation: matchingAccreditation,
    } = this.selectIssuerTrustAccreditation(
      records,
      credentialType,
      evaluatedJurisdictions,
    );

    if (matchingAccreditation) {
      return {
        enforced: true,
        accredited: true,
        trustRecordId: matchingAccreditation.record.id,
        accreditationScope: String(
          matchingAccreditation.record.accreditationScope ?? 'ENTERPRISE',
        ).toLowerCase(),
        assuranceLevel: String(
          matchingAccreditation.record.assuranceLevel ?? 'STANDARD',
        ).toLowerCase(),
        matchedJurisdictions: matchingAccreditation.matchedJurisdictions,
        evaluatedJurisdictions,
      };
    }

    logger.warn('credential_issuer_trust_policy_denied', {
      issuerId,
      credentialType,
      activeAccreditationCount: activeAccreditations.length,
      evaluatedJurisdictions,
      denialReason:
        typedAccreditations.length > 0
          ? 'jurisdiction_not_accredited'
          : 'credential_type_not_accredited',
    });

    return {
      enforced: true,
      accredited: false,
      matchedJurisdictions: [],
      evaluatedJurisdictions,
      denialReason:
        typedAccreditations.length > 0
          ? 'jurisdiction_not_accredited'
          : 'credential_type_not_accredited',
    };
  }

  private extractCredentialJurisdictions(
    claims: Record<string, unknown>,
  ): string[] {
    const candidates: unknown[] = [
      claims.jurisdiction,
      claims.jurisdictions,
      claims.country,
      claims.countryCode,
      claims.countries,
      claims.residencyJurisdiction,
      claims.residencyCountry,
    ];

    return [
      ...new Set(
        candidates.flatMap((value) => this.normalizeJurisdictionValues(value)),
      ),
    ];
  }

  private normalizeJurisdictionValues(value: unknown): string[] {
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      return normalized.length > 0 ? [normalized] : [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.normalizeJurisdictionValues(entry));
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return [
        ...this.normalizeJurisdictionValues(record.code),
        ...this.normalizeJurisdictionValues(record.jurisdiction),
        ...this.normalizeJurisdictionValues(record.countryCode),
      ];
    }

    return [];
  }

  private intersectJurisdictions(
    requestedJurisdictions: string[],
    allowedJurisdictions: string[],
  ): string[] {
    if (
      requestedJurisdictions.length === 0 ||
      allowedJurisdictions.length === 0
    ) {
      return [];
    }

    const allowed = new Set(
      allowedJurisdictions.map((value) => String(value).trim().toUpperCase()),
    );
    return [
      ...new Set(
        requestedJurisdictions
          .map((value) => String(value).trim().toUpperCase())
          .filter((value) => allowed.has(value)),
      ),
    ];
  }

  private rankAssuranceLevel(level: unknown): number {
    switch (String(level ?? '').toUpperCase()) {
      case 'SOVEREIGN':
        return 3;
      case 'QUALIFIED':
        return 2;
      case 'ADVANCED':
        return 1;
      default:
        return 0;
    }
  }

  private selectIssuerTrustAccreditation(
    records: any[],
    credentialType: string,
    evaluatedJurisdictions: string[],
  ): {
    activeAccreditations: any[];
    typedAccreditations: any[];
    selectedAccreditation?: {
      record: any;
      matchedJurisdictions: string[];
    };
  } {
    const now = new Date();
    const activeAccreditations = Array.isArray(records)
      ? records.filter(
          (record: any) =>
            record.status === 'ACCREDITED' &&
            (!record.expiresAt || new Date(record.expiresAt) > now),
        )
      : [];

    const typedAccreditations = activeAccreditations.filter(
      (record: any) =>
        Array.isArray(record.allowedCredentialTypes) &&
        record.allowedCredentialTypes.includes(credentialType),
    );

    const selectedAccreditation = typedAccreditations
      .map((record: any) => ({
        record,
        matchedJurisdictions: this.intersectJurisdictions(
          evaluatedJurisdictions,
          Array.isArray(record.allowedJurisdictions)
            ? record.allowedJurisdictions
            : [],
        ),
      }))
      .filter(
        ({ record, matchedJurisdictions }) =>
          matchedJurisdictions.length > 0 ||
          !Array.isArray(record.allowedJurisdictions) ||
          record.allowedJurisdictions.length === 0 ||
          evaluatedJurisdictions.length === 0,
      )
      .sort((left, right) => {
        const assuranceDelta =
          this.rankAssuranceLevel(right.record.assuranceLevel) -
          this.rankAssuranceLevel(left.record.assuranceLevel);
        if (assuranceDelta !== 0) {
          return assuranceDelta;
        }
        return (
          new Date(right.record.updatedAt ?? 0).getTime() -
          new Date(left.record.updatedAt ?? 0).getTime()
        );
      })[0];

    return {
      activeAccreditations,
      typedAccreditations,
      ...(selectedAccreditation ? { selectedAccreditation } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Get credential by ID
  // -------------------------------------------------------------------------
  async getCredential(
    credentialId: string,
  ): Promise<CredentialResponse | null> {
    // Check cache
    const cached = await redis.get(`cred:${credentialId}`);
    if (cached) {
      return JSON.parse(cached) as CredentialResponse;
    }

    const credential = await prisma.credential.findUnique({
      where: { id: credentialId },
    });

    if (!credential) return null;

    // Check if expired
    if (
      credential.expiresAt &&
      credential.expiresAt < new Date() &&
      credential.status === 'ACTIVE'
    ) {
      await prisma.credential.update({
        where: { id: credentialId },
        data: { status: 'EXPIRED' },
      });
      credential.status = 'EXPIRED';
    }

    const formatted = this.formatCredential(credential);

    // Cache for 5 minutes
    await redis.set(
      `cred:${credentialId}`,
      JSON.stringify(formatted),
      'EX',
      300,
    );

    return formatted;
  }

  // -------------------------------------------------------------------------
  // Query credentials
  // -------------------------------------------------------------------------
  async queryCredentials(
    query: CredentialQuery,
  ): Promise<{ credentials: CredentialResponse[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.issuerId) where.issuerId = query.issuerId;
    if (query.credentialType) where.credentialType = query.credentialType;
    if (query.status) where.status = query.status;

    const [credentials, total] = await Promise.all([
      prisma.credential.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.credential.count({ where }),
    ]);

    return {
      credentials: credentials.map((c) => this.formatCredential(c)),
      total,
    };
  }

  // -------------------------------------------------------------------------
  // Revoke a credential
  // -------------------------------------------------------------------------
  async revokeCredential(
    request: RevocationRequest,
  ): Promise<CredentialResponse> {
    const credential = await prisma.credential.findUnique({
      where: { id: request.credentialId },
    });

    if (!credential) {
      throw new CredentialError('Credential not found', 'CRED_NOT_FOUND', 404);
    }

    if (credential.status === 'REVOKED') {
      throw new CredentialError(
        'Credential already revoked',
        'CRED_ALREADY_REVOKED',
      );
    }

    // Only the issuer can revoke
    if (credential.issuerId !== request.revokedBy) {
      throw new CredentialError(
        'Only the issuer can revoke a credential',
        'CRED_UNAUTHORIZED',
        403,
      );
    }

    const previousState = { status: credential.status };

    const updated = await prisma.credential.update({
      where: { id: request.credentialId },
      data: {
        status: 'REVOKED',
        revocationReason: request.reason,
      },
    });

    // Add to revocation registry
    await prisma.revocationRegistry.create({
      data: {
        credentialId: request.credentialId,
        reason: request.reason,
        revokedBy: request.revokedBy,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        identityId: request.revokedBy,
        action: 'CREDENTIAL_REVOKED',
        resourceType: 'credential',
        resourceId: request.credentialId,
        previousState,
        newState: { status: 'REVOKED' },
        details: { reason: request.reason },
      },
    });

    // Invalidate caches
    await redis.del(`cred:${request.credentialId}`);
    await redis.del(`creds:subject:${credential.subjectId}`);
    await redis.del(`creds:issuer:${credential.issuerId}`);

    logger.info('credential_revoked', {
      credentialId: request.credentialId,
      revokedBy: request.revokedBy,
      reason: request.reason,
    });

    return this.formatCredential(updated);
  }

  // -------------------------------------------------------------------------
  // Verify a credential (check validity, signature, revocation)
  // -------------------------------------------------------------------------
  async verifyCredential(
    credentialId: string,
  ): Promise<CredentialVerificationResult> {
    const credential = await prisma.credential.findUnique({
      where: { id: credentialId },
    });

    if (!credential) {
      throw new CredentialError('Credential not found', 'CRED_NOT_FOUND', 404);
    }

    const verification = await this.evaluateCredentialVerification(credential);

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'CREDENTIAL_VERIFIED',
        resourceType: 'credential',
        resourceId: credentialId,
        details: { valid: verification.valid, checks: verification.checks },
      },
    });

    return verification;
  }

  async exportCredentialEvidence(
    credentialId: string,
  ): Promise<CredentialEvidenceExport> {
    const credential = await prisma.credential.findUnique({
      where: { id: credentialId },
    });

    if (!credential) {
      throw new CredentialError('Credential not found', 'CRED_NOT_FOUND', 404);
    }

    const verification = await this.evaluateCredentialVerification(credential);
    const issuer = await prisma.identity.findUnique({
      where: { id: credential.issuerId },
      select: {
        id: true,
        did: true,
        status: true,
        keyVersion: true,
        keyAlgorithm: true,
        verificationMethod: true,
      },
    });
    const subject = await prisma.identity.findUnique({
      where: { id: credential.subjectId },
      select: {
        id: true,
        did: true,
        status: true,
      },
    });

    const trustLineage = await this.buildCredentialTrustLineage({
      issuerId: credential.issuerId,
      credentialType: credential.credentialType,
      claims: credential.claims as Record<string, unknown>,
    });

    return {
      formatVersion: 'zeroid.credential_evidence_export.v1',
      exportedAt: new Date().toISOString(),
      credential: verification.credential,
      verification: {
        valid: verification.valid,
        checks: verification.checks,
      },
      issuer: {
        identityId: credential.issuerId,
        ...(issuer?.did ? { did: issuer.did } : {}),
        ...(issuer?.status ? { status: issuer.status } : {}),
        ...(issuer?.keyVersion ? { keyVersion: issuer.keyVersion } : {}),
        ...(issuer?.keyAlgorithm ? { keyAlgorithm: issuer.keyAlgorithm } : {}),
        ...(issuer?.verificationMethod !== undefined
          ? { verificationMethod: issuer.verificationMethod ?? null }
          : {}),
      },
      subject: {
        identityId: credential.subjectId,
        ...(subject?.did ? { did: subject.did } : {}),
        ...(subject?.status ? { status: subject.status } : {}),
      },
      ...(trustLineage ? { trustLineage } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Key rotation
  // -------------------------------------------------------------------------

  /**
   * Rotate the signing key to a new version. Only supported when using a
   * KMS-backed provider (aws-kms, gcp-kms, azure-kms).
   *
   * The previous key version remains valid for verification of existing
   * credentials — the keyVersion stored in each credential's proof metadata
   * allows the verifier to select the correct public key.
   */
  async rotateSigningKey(
    newVersion: string,
    rotatedBy: string,
  ): Promise<{ previousVersion: string; newVersion: string }> {
    const previousVersion = this.signer.rotateToVersion(newVersion);

    // Audit log for key rotation event
    await prisma.auditLog.create({
      data: {
        identityId: rotatedBy,
        action: 'SIGNING_KEY_ROTATED',
        resourceType: 'signing_key',
        resourceId: `kms-key-version-${newVersion}`,
        previousState: { keyVersion: previousVersion },
        newState: { keyVersion: newVersion },
        details: {
          provider: process.env.KMS_PROVIDER || 'local',
          rotatedAt: new Date().toISOString(),
        },
      },
    });

    logger.info('signing_key_rotation_complete', {
      previousVersion,
      newVersion,
      rotatedBy,
    });

    return { previousVersion, newVersion };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private formatCredential(credential: {
    id: string;
    credentialType: string;
    issuerId: string;
    subjectId: string;
    schemaId?: string | null;
    claims: unknown;
    claimsHash: string;
    proof: unknown;
    status: string;
    issuedAt: Date;
    expiresAt: Date | null;
  }): CredentialResponse {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      issuerId: credential.issuerId,
      subjectId: credential.subjectId,
      claims: credential.claims as Record<string, unknown>,
      claimsHash: credential.claimsHash,
      proof: credential.proof,
      status: credential.status,
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
    };
  }

  private async evaluateCredentialVerification(credential: {
    id: string;
    credentialType: string;
    issuerId: string;
    subjectId: string;
    schemaId?: string | null;
    claims: unknown;
    claimsHash: string;
    proof: unknown;
    status: string;
    issuedAt: Date;
    expiresAt: Date | null;
  }): Promise<CredentialVerificationResult> {
    const checks: Record<string, boolean> = {};

    checks.statusActive = credential.status === 'ACTIVE';
    checks.notExpired =
      !credential.expiresAt || credential.expiresAt > new Date();

    const currentHash = await this.hashClaims(
      credential.claims as Record<string, unknown>,
    );
    checks.integrityValid = currentHash === credential.claimsHash;

    const issuer = await prisma.identity.findUnique({
      where: { id: credential.issuerId },
    });
    checks.issuerActive = issuer?.status === 'ACTIVE';

    const subject = await prisma.identity.findUnique({
      where: { id: credential.subjectId },
    });
    checks.subjectActive = subject?.status === 'ACTIVE';

    checks.signatureValid = await this.verifyProofSignature(
      currentHash,
      credential.issuerId,
      credential.proof as Record<string, unknown>,
      {
        credentialType: credential.credentialType,
        expiresAt: credential.expiresAt,
        issuerDid: issuer?.did,
        schemaId: credential.schemaId ?? null,
        subjectDid: subject?.did,
        subjectId: credential.subjectId,
      },
    );

    const revocation = await prisma.revocationRegistry.findUnique({
      where: { credentialId: credential.id },
    });
    checks.notRevoked = revocation === null;

    return {
      valid: Object.values(checks).every(Boolean),
      credential: this.formatCredential(credential),
      checks,
    };
  }

  private async buildCredentialTrustLineage(credential: {
    issuerId: string;
    credentialType: string;
    claims: Record<string, unknown>;
  }): Promise<CredentialEvidenceExport['trustLineage'] | undefined> {
    const issuerTrustModel = (prisma as any).issuerTrustRecord;
    const issuerKeyHistoryModel = (prisma as any).issuerKeyHistory;
    if (!issuerTrustModel?.findMany && !issuerKeyHistoryModel?.findMany) {
      return undefined;
    }

    const evaluatedJurisdictions = this.extractCredentialJurisdictions(
      credential.claims,
    );
    const records = issuerTrustModel?.findMany
      ? await issuerTrustModel.findMany({
          where: {
            issuerIdentityId: credential.issuerId,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        })
      : [];

    const { selectedAccreditation } = this.selectIssuerTrustAccreditation(
      records,
      credential.credentialType,
      evaluatedJurisdictions,
    );

    const keyHistory = issuerKeyHistoryModel?.findMany
      ? await issuerKeyHistoryModel.findMany({
          where: {
            issuerIdentityId: credential.issuerId,
          },
          orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
        })
      : [];

    const currentKey =
      keyHistory.find(
        (record: any) => String(record.status ?? '').toUpperCase() === 'ACTIVE',
      ) ?? keyHistory[0];

    if (
      (!Array.isArray(records) || records.length === 0) &&
      keyHistory.length === 0
    ) {
      return undefined;
    }

    return {
      enforced: Array.isArray(records) && records.length > 0,
      ...(selectedAccreditation?.record?.id
        ? { selectedTrustRecordId: selectedAccreditation.record.id }
        : {}),
      ...(selectedAccreditation?.record?.accreditationScope !== undefined
        ? {
            accreditationScope: String(
              selectedAccreditation.record.accreditationScope,
            ).toLowerCase(),
          }
        : {}),
      ...(selectedAccreditation?.record?.assuranceLevel !== undefined
        ? {
            assuranceLevel: String(
              selectedAccreditation.record.assuranceLevel,
            ).toLowerCase(),
          }
        : {}),
      evaluatedJurisdictions,
      matchedJurisdictions: selectedAccreditation?.matchedJurisdictions ?? [],
      ...(selectedAccreditation?.record
        ? {
            trustRecord: this.serializeCredentialTrustRecord(
              selectedAccreditation.record,
            ),
          }
        : {}),
      ...(keyHistory.length > 0
        ? {
            keyLineage: {
              ...(currentKey
                ? {
                    current:
                      this.serializeCredentialKeyHistoryRecord(currentKey),
                  }
                : {}),
              history: keyHistory.map((record: any) =>
                this.serializeCredentialKeyHistoryRecord(record),
              ),
            },
          }
        : {}),
    };
  }

  private serializeCredentialTrustRecord(
    record: any,
  ): NonNullable<CredentialEvidenceExport['trustLineage']>['trustRecord'] {
    return {
      trustRecordId: String(record.id),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      ...(record.accreditationScope !== undefined
        ? {
            accreditationScope: String(record.accreditationScope).toLowerCase(),
          }
        : {}),
      ...(record.assuranceLevel !== undefined
        ? { assuranceLevel: String(record.assuranceLevel).toLowerCase() }
        : {}),
      allowedCredentialTypes: Array.isArray(record.allowedCredentialTypes)
        ? record.allowedCredentialTypes
        : [],
      allowedJurisdictions: Array.isArray(record.allowedJurisdictions)
        ? record.allowedJurisdictions
        : [],
      ...(record.proposedByIdentityId !== undefined
        ? { proposedByIdentityId: record.proposedByIdentityId ?? null }
        : {}),
      ...(record.accreditedByIdentityId !== undefined
        ? { accreditedByIdentityId: record.accreditedByIdentityId ?? null }
        : {}),
      ...(record.suspensionReason !== undefined
        ? { suspensionReason: record.suspensionReason ?? null }
        : {}),
      ...(record.metadata !== undefined && record.metadata !== null
        ? { metadata: record.metadata as Record<string, unknown> }
        : {}),
      ...(record.accreditedAt
        ? { accreditedAt: new Date(record.accreditedAt).toISOString() }
        : {}),
      ...(record.expiresAt
        ? { expiresAt: new Date(record.expiresAt).toISOString() }
        : {}),
      ...(record.updatedAt
        ? { updatedAt: new Date(record.updatedAt).toISOString() }
        : {}),
    };
  }

  private serializeCredentialKeyHistoryRecord(
    record: any,
  ): NonNullable<
    NonNullable<CredentialEvidenceExport['trustLineage']>['keyLineage']
  >['history'][number] {
    return {
      keyHistoryId: String(record.id),
      keyVersion: String(record.keyVersion),
      keyAlgorithm: String(record.keyAlgorithm),
      verificationMethod: String(record.verificationMethod),
      status: String(record.status ?? 'UNKNOWN').toLowerCase(),
      validFrom: new Date(record.validFrom).toISOString(),
      ...(record.validUntil
        ? { validUntil: new Date(record.validUntil).toISOString() }
        : {}),
      ...(record.rotatedByIdentityId !== undefined
        ? { rotatedByIdentityId: record.rotatedByIdentityId ?? null }
        : {}),
      ...(record.metadata !== undefined && record.metadata !== null
        ? { metadata: record.metadata as Record<string, unknown> }
        : {}),
      createdAt: new Date(record.createdAt).toISOString(),
    };
  }

  private async hashClaims(claims: Record<string, unknown>): Promise<string> {
    // Use deterministic JSON serialization that handles nested objects
    const canonical = this.canonicalize(claims);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(canonical),
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Produce a canonical JSON string with recursively sorted keys.
   * This ensures nested objects are fully included and deterministically ordered.
   */
  private canonicalize(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalize(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(
      (k) => JSON.stringify(k) + ':' + this.canonicalize(obj[k]),
    );
    return '{' + entries.join(',') + '}';
  }

  private async signCredentialForIssuer(
    request: IssueCredentialRequest,
    claimsHash: string,
  ): Promise<string> {
    const message = this.buildCredentialSignatureMessage(
      this.buildCredentialSignatureBinding(request, claimsHash),
    );
    const signature = await this.signer.sign(message);
    return signature.toString('base64url');
  }

  private async buildCredentialProof(
    request: IssueCredentialRequest,
    issuer: {
      did: string;
      publicKey: string;
      keyVersion: string;
      keyAlgorithm: string;
      verificationMethod: string | null;
    },
    claimsHash: string,
  ): Promise<Record<string, unknown>> {
    if (request.issuerProof) {
      return this.validateIssuerSubmittedProof(request, issuer, claimsHash);
    }

    if (isProductionRuntime()) {
      throw new CredentialError(
        'Issuer-controlled credential proof is required in production',
        'CRED_ISSUER_SIGNATURE_REQUIRED',
        400,
      );
    }

    const keyVersion = issuer.keyVersion || this.signer.getKeyVersion();
    const verificationMethod =
      issuer.verificationMethod ||
      `${request.issuerDid}#assertion-key-${keyVersion}`;
    const credentialBinding = this.buildCredentialSignatureBinding(
      request,
      claimsHash,
    );

    return {
      type: this.signer.getProofType(),
      created: new Date().toISOString(),
      verificationMethod,
      proofPurpose: 'assertionMethod',
      issuerDid: request.issuerDid,
      keyVersion,
      credentialBinding,
      signatureValue: await this.signCredentialForIssuer(
        request,
        claimsHash,
      ),
    };
  }

  private validateIssuerSubmittedProof(
    request: IssueCredentialRequest,
    issuer: {
      did: string;
      publicKey: string;
      keyVersion: string;
      keyAlgorithm: string;
      verificationMethod: string | null;
    },
    claimsHash: string,
  ): Record<string, unknown> {
    const proof = request.issuerProof!;
    const proofIssuerDid = proof.issuerDid ?? request.issuerDid;
    if (proofIssuerDid !== request.issuerDid || proofIssuerDid !== issuer.did) {
      throw new CredentialError(
        'Issuer proof DID does not match the issuing identity',
        'CRED_ISSUER_PROOF_DID_MISMATCH',
        403,
      );
    }

    if (proof.proofPurpose && proof.proofPurpose !== 'assertionMethod') {
      throw new CredentialError(
        'Issuer proof must use assertionMethod proof purpose',
        'CRED_ISSUER_PROOF_PURPOSE_INVALID',
        400,
      );
    }

    const keyVersion = proof.keyVersion ?? issuer.keyVersion;
    if (keyVersion !== issuer.keyVersion) {
      throw new CredentialError(
        'Issuer proof key version does not match the active issuer key',
        'CRED_ISSUER_PROOF_KEY_VERSION_INVALID',
        400,
      );
    }

    const verificationMethod =
      proof.verificationMethod ||
      issuer.verificationMethod ||
      `${request.issuerDid}#assertion-key-${keyVersion}`;
    if (
      issuer.verificationMethod &&
      verificationMethod !== issuer.verificationMethod
    ) {
      throw new CredentialError(
        'Issuer proof verification method does not match the active issuer key',
        'CRED_ISSUER_PROOF_METHOD_INVALID',
        400,
      );
    }

    if (!issuer.publicKey) {
      throw new CredentialError(
        'Issuer public key is required to validate credential proof',
        'CRED_ISSUER_PUBLIC_KEY_REQUIRED',
        400,
      );
    }

    const expectedBinding = this.buildCredentialSignatureBinding(
      request,
      claimsHash,
    );
    const suppliedBinding = this.parseCredentialSignatureBinding(
      proof.credentialBinding,
    );
    if (!suppliedBinding) {
      throw new CredentialError(
        'Issuer proof must include a credential binding envelope',
        'CRED_ISSUER_PROOF_BINDING_REQUIRED',
        400,
      );
    }
    if (
      this.canonicalize(suppliedBinding) !==
      this.canonicalize(expectedBinding)
    ) {
      throw new CredentialError(
        'Issuer proof credential binding does not match the requested credential',
        'CRED_ISSUER_PROOF_BINDING_MISMATCH',
        400,
      );
    }

    const signature = Buffer.from(proof.signatureValue, 'base64url');
    const publicKey = this.parseVerificationPublicKey(issuer.publicKey);
    if (
      !this.verifyMessage(
        this.buildCredentialSignatureMessage(expectedBinding),
        signature,
        publicKey,
      )
    ) {
      throw new CredentialError(
        'Issuer credential proof signature is invalid',
        'CRED_ISSUER_PROOF_SIGNATURE_INVALID',
        400,
      );
    }

    return {
      type: proof.type ?? this.signer.getProofType(),
      created: proof.created ?? new Date().toISOString(),
      verificationMethod,
      proofPurpose: 'assertionMethod',
      issuerDid: request.issuerDid,
      keyVersion,
      credentialBinding: expectedBinding,
      signatureValue: proof.signatureValue,
    };
  }

  private buildCredentialSignatureBinding(
    request: IssueCredentialRequest,
    claimsHash: string,
  ): CredentialSignatureBinding {
    return {
      version: 'zeroid.credential.signature.v2',
      proofPurpose: 'assertionMethod',
      issuerDid: request.issuerDid,
      issuerId: request.issuerId,
      subjectDid: request.subjectDid,
      subjectId: request.subjectId,
      credentialType: request.credentialType,
      schemaId: request.schemaId ?? null,
      expiresAt: request.expiresAt ? request.expiresAt.toISOString() : null,
      claimsHash,
    };
  }

  private buildCredentialSignatureMessage(
    binding: CredentialSignatureBinding,
  ): Buffer {
    return crypto
      .createHash('sha256')
      .update(this.canonicalize(binding))
      .digest();
  }

  private parseCredentialSignatureBinding(
    value: unknown,
  ): CredentialSignatureBinding | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const binding = value as Record<string, unknown>;
    if (
      binding.version !== 'zeroid.credential.signature.v2' ||
      binding.proofPurpose !== 'assertionMethod' ||
      typeof binding.issuerDid !== 'string' ||
      typeof binding.issuerId !== 'string' ||
      typeof binding.subjectDid !== 'string' ||
      typeof binding.subjectId !== 'string' ||
      typeof binding.credentialType !== 'string' ||
      typeof binding.claimsHash !== 'string' ||
      !(typeof binding.schemaId === 'string' || binding.schemaId === null) ||
      !(typeof binding.expiresAt === 'string' || binding.expiresAt === null)
    ) {
      return null;
    }

    return {
      version: 'zeroid.credential.signature.v2',
      proofPurpose: 'assertionMethod',
      issuerDid: binding.issuerDid,
      issuerId: binding.issuerId,
      subjectDid: binding.subjectDid,
      subjectId: binding.subjectId,
      credentialType: binding.credentialType,
      schemaId: binding.schemaId,
      expiresAt: binding.expiresAt,
      claimsHash: binding.claimsHash,
    };
  }

  private credentialBindingMatchesContext(
    binding: CredentialSignatureBinding,
    context: {
      claimsHash: string;
      credentialType?: string;
      expiresAt?: Date | null;
      issuerDid?: string;
      issuerId: string;
      schemaId?: string | null;
      subjectDid?: string;
      subjectId?: string;
    },
  ): boolean {
    return (
      binding.claimsHash === context.claimsHash &&
      binding.issuerId === context.issuerId &&
      (!context.issuerDid || binding.issuerDid === context.issuerDid) &&
      (!context.subjectId || binding.subjectId === context.subjectId) &&
      (!context.subjectDid || binding.subjectDid === context.subjectDid) &&
      (!context.credentialType ||
        binding.credentialType === context.credentialType) &&
      binding.schemaId === (context.schemaId ?? null) &&
      binding.expiresAt ===
        (context.expiresAt ? context.expiresAt.toISOString() : null)
    );
  }

  private buildIssuerScopedMessage(
    issuerDid: string,
    claimsHash: string,
  ): Buffer {
    return crypto
      .createHash('sha256')
      .update(`${issuerDid}:${claimsHash}`)
      .digest();
  }

  private async verifyProofSignature(
    claimsHash: string,
    issuerId: string,
    proof: Record<string, unknown>,
    credentialContext?: {
      credentialType?: string;
      expiresAt?: Date | null;
      issuerDid?: string;
      schemaId?: string | null;
      subjectDid?: string;
      subjectId?: string;
    },
  ): Promise<boolean> {
    const signatureValue = proof?.signatureValue as string;
    if (!signatureValue) {
      return false;
    }

    if (proof?.proofPurpose !== 'assertionMethod') {
      return false;
    }

    const signature = Buffer.from(signatureValue, 'base64url');
    const publicKey = await this.resolveVerificationPublicKey(proof, issuerId);
    if (!publicKey) {
      logger.warn('credential_verify_no_public_key', { issuerId });
      return false;
    }

    const issuerDid = proof?.issuerDid as string | undefined;
    if (issuerDid) {
      const binding = this.parseCredentialSignatureBinding(
        proof.credentialBinding,
      );
      if (binding) {
        if (
          !this.credentialBindingMatchesContext(binding, {
            claimsHash,
            issuerId,
            ...credentialContext,
          })
        ) {
          logger.warn('credential_binding_context_mismatch', {
            issuerId,
            issuerDid,
            credentialType: credentialContext?.credentialType,
          });
          return false;
        }

        if (
          this.verifyMessage(
            this.buildCredentialSignatureMessage(binding),
            signature,
            publicKey,
          )
        ) {
          const issuer = await prisma.identity.findUnique({
            where: { id: issuerId },
          });
          if (
            issuer &&
            issuer.did === issuerDid &&
            binding.issuerDid === issuer.did
          ) {
            return true;
          }
          logger.warn('credential_issuer_did_mismatch', {
            proofIssuerDid: issuerDid,
            bindingIssuerDid: binding.issuerDid,
            credentialIssuerId: issuerId,
          });
          return false;
        }

        logger.warn('credential_binding_signature_invalid', {
          issuerId,
          issuerDid,
        });
        return false;
      }

      if (isProductionRuntime()) {
        logger.warn('credential_binding_required_in_production', {
          issuerId,
          issuerDid,
        });
        return false;
      }

      // Non-production compatibility for credentials issued before envelope
      // binding. Production refuses this path above.
      const issuerScopedMessage = this.buildIssuerScopedMessage(
        issuerDid,
        claimsHash,
      );
      if (this.verifyMessage(issuerScopedMessage, signature, publicKey)) {
        // Verify the issuerDid in the proof matches the credential's issuerId
        const issuer = await prisma.identity.findUnique({
          where: { id: issuerId },
        });
        if (issuer && issuer.did === issuerDid) {
          return true;
        }
        logger.warn('credential_issuer_did_mismatch', {
          proofIssuerDid: issuerDid,
          credentialIssuerId: issuerId,
        });
        return false;
      }
    }

    // Fallback: legacy platform-scoped verification for pre-migration
    // credentials that were signed with just the claimsHash.
    // CRED-01: Block this path in production — credentials MUST have issuer-DID binding.
    if (isProductionRuntime()) {
      logger.warn('credential_legacy_platform_scope_blocked', {
        issuerId,
        note: 'Legacy platform-scoped verification is blocked in production. Credential must be re-issued with issuer-DID binding.',
      });
      return false;
    }

    try {
      const legacyMessage = Buffer.from(claimsHash, 'hex');
      if (this.verifyMessage(legacyMessage, signature, publicKey)) {
        logger.warn(
          'credential_verified_with_legacy_platform_scope_DEPRECATED',
          {
            issuerId,
            note:
              'DEPRECATION WARNING: Credential was signed with platform-scoped key without issuer-DID binding. ' +
              'This legacy fallback will be removed in a future release. Re-issue the credential with issuer-scoped binding.',
          },
        );
        return true;
      }
    } catch {
      // Fall through
    }

    // IMPORTANT: This flag MUST be removed before external audit.
    if (
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      logger.error(
        'CRITICAL_SECURITY_WARNING: legacy_hmac_credential_signing_enabled — ' +
          'this MUST NOT be used in production and must be removed before external audit',
      );
      return this.verifyLegacyProofSignature(claimsHash, issuerId, proof);
    }

    if (
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === 'true' &&
      process.env.NODE_ENV === 'production'
    ) {
      logger.error(
        'CRITICAL_SECURITY_VIOLATION: legacy HMAC credential signing is blocked in production',
      );
    }

    return false;
  }

  /**
   * CRED-03: Issuer-owned key resolution for credential verification.
   *
   * Resolution order:
   * 1. If the proof contains an `issuerDid`, look up the issuer's identity
   *    in the database and use their per-issuer `publicKey`, `keyVersion`,
   *    `keyAlgorithm`, and `verificationMethod`. The proof's `keyVersion`
   *    must match the issuer record's `keyVersion` (prevents stale-key replay).
   * 2. Fall back to the platform-wide KMS signer / versioned key map for
   *    backward compatibility with credentials issued before issuer-specific
   *    key resolution was deployed. This path is blocked in production when
   *    the proof contains an `issuerDid`.
   */
  private async resolveVerificationPublicKey(
    proof: Record<string, unknown>,
    issuerId: string,
  ): Promise<crypto.KeyObject | null> {
    // -----------------------------------------------------------------------
    // Step 1: Per-issuer key resolution from identity table
    // -----------------------------------------------------------------------
    const issuerDid = proof?.issuerDid as string | undefined;
    if (issuerDid) {
      try {
        const issuerIdentity = await prisma.identity.findUnique({
          where: { did: issuerDid },
          select: {
            id: true,
            publicKey: true,
            keyVersion: true,
            keyAlgorithm: true,
            verificationMethod: true,
          },
        });

        if (issuerIdentity && issuerIdentity.publicKey) {
          const proofKeyVersion = proof?.keyVersion as string | undefined;
          const proofVerificationMethod = proof?.verificationMethod as
            | string
            | undefined;
          const matchesCurrentKeyVersion =
            !proofKeyVersion || proofKeyVersion === issuerIdentity.keyVersion;
          const matchesCurrentVerificationMethod =
            !proofVerificationMethod ||
            !issuerIdentity.verificationMethod ||
            proofVerificationMethod === issuerIdentity.verificationMethod;

          if (!matchesCurrentKeyVersion || !matchesCurrentVerificationMethod) {
            const historicalKey = await this.resolveHistoricalIssuerKey(
              issuerIdentity.id ?? issuerId,
              issuerDid,
              proofKeyVersion,
              proofVerificationMethod,
            );
            if (historicalKey) {
              return historicalKey;
            }

            if (!matchesCurrentKeyVersion) {
              logger.warn('credential_verify_issuer_key_version_mismatch', {
                issuerDid,
                proofKeyVersion,
                issuerKeyVersion: issuerIdentity.keyVersion,
              });
            }

            if (!matchesCurrentVerificationMethod) {
              logger.warn('credential_verify_verification_method_mismatch', {
                issuerDid,
                proofVerificationMethod,
                issuerVerificationMethod: issuerIdentity.verificationMethod,
              });
            }

            return null;
          }

          logger.info('credential_verify_issuer_key_resolved', {
            issuerDid,
            keyVersion: issuerIdentity.keyVersion,
            keyAlgorithm: issuerIdentity.keyAlgorithm,
            verificationMethod: issuerIdentity.verificationMethod ?? 'none',
            source: 'identity_table',
          });
          return this.parseVerificationPublicKey(issuerIdentity.publicKey);
        }

        logger.warn('credential_verify_issuer_key_not_found', {
          issuerDid,
          note: 'No identity found for issuerDid or publicKey is empty.',
        });
      } catch (err) {
        logger.warn('credential_verify_issuer_key_lookup_failed', {
          issuerDid,
          error: (err as Error).message,
        });
      }

      // In production, REFUSE to fall back to platform key when an issuerDid
      // was present — the issuer must have their own key material registered.
      if (isProductionRuntime()) {
        logger.error('credential_verify_issuer_key_required_in_production', {
          issuerDid,
          note:
            'Platform-wide key fallback is blocked in production for credentials with issuerDid. ' +
            "Register the issuer's publicKey, keyVersion, and verificationMethod in the identity table.",
        });
        return null;
      }

      // Non-production: allow fallback but log deprecation warning.
      logger.warn('credential_verify_platform_key_fallback_DEPRECATED', {
        issuerDid,
        note:
          'DEPRECATION WARNING: Falling back to platform-wide signing key. ' +
          'This fallback will be removed in production.',
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: Platform-wide key fallback (backward compatibility, non-production only for issuerDid credentials)
    // -----------------------------------------------------------------------
    const proofKeyVersion =
      typeof proof?.keyVersion === 'string'
        ? proof.keyVersion
        : this.signer.getKeyVersion();

    if (proofKeyVersion === this.signer.getKeyVersion()) {
      return this.signer.getPublicKey();
    }

    const rawVersionedKeys = process.env.CREDENTIAL_SIGNING_PUBLIC_KEYS_JSON;
    if (!rawVersionedKeys) {
      logger.warn('credential_public_key_version_missing', {
        requestedVersion: proofKeyVersion,
      });
      return null;
    }

    let parsedKeys: Record<string, unknown>;
    try {
      parsedKeys = JSON.parse(rawVersionedKeys) as Record<string, unknown>;
    } catch (error) {
      throw new CredentialError(
        `CREDENTIAL_SIGNING_PUBLIC_KEYS_JSON is not valid JSON: ${(error as Error).message}`,
        'CRED_PUBKEY_CONFIG_INVALID',
        500,
      );
    }

    const rawKey = parsedKeys[proofKeyVersion];
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      logger.warn('credential_public_key_not_found', {
        requestedVersion: proofKeyVersion,
      });
      return null;
    }

    return this.parseVerificationPublicKey(rawKey);
  }

  private async resolveHistoricalIssuerKey(
    issuerIdentityId: string,
    issuerDid: string,
    proofKeyVersion?: string,
    proofVerificationMethod?: string,
  ): Promise<crypto.KeyObject | null> {
    const issuerKeyHistoryModel = (prisma as any).issuerKeyHistory;
    if (!issuerKeyHistoryModel?.findFirst) {
      return null;
    }

    const historicalRecord = await issuerKeyHistoryModel.findFirst({
      where: {
        issuerIdentityId,
        issuerDid,
        ...(proofKeyVersion ? { keyVersion: proofKeyVersion } : {}),
        ...(proofVerificationMethod
          ? { verificationMethod: proofVerificationMethod }
          : {}),
        status: { in: ['ACTIVE', 'RETIRED'] },
      },
      orderBy: {
        validFrom: 'desc',
      },
    });

    if (!historicalRecord?.publicKey) {
      return null;
    }

    logger.info('credential_verify_issuer_historical_key_resolved', {
      issuerDid,
      keyVersion: historicalRecord.keyVersion,
      verificationMethod: historicalRecord.verificationMethod,
      status: historicalRecord.status,
      source: 'issuer_key_history',
    });

    return this.parseVerificationPublicKey(historicalRecord.publicKey);
  }

  private parseVerificationPublicKey(rawKey: string): crypto.KeyObject {
    const trimmed = rawKey.trim();
    if (trimmed.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey(trimmed);
    }

    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    return crypto.createPublicKey({
      key: Buffer.from(normalized, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }

  /**
   * Legacy verifier for pre-migration credentials. Disabled by default because it
   * relies on a server-held shared secret rather than a public verification key.
   */
  private verifyLegacyProofSignature(
    claimsHash: string,
    issuerId: string,
    proof: Record<string, unknown>,
  ): boolean {
    const signatureValue = proof?.signatureValue as string;
    if (!signatureValue) {
      return false;
    }

    const signingKey = this.deriveLegacyIssuerKey(issuerId);
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(claimsHash);
    const expected = hmac.digest('base64');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signatureValue, 'base64'),
        Buffer.from(expected, 'base64'),
      );
    } catch {
      return false;
    }
  }

  private deriveLegacyIssuerKey(issuerId: string): Buffer {
    const masterSecret = process.env.CREDENTIAL_SIGNING_SECRET;
    if (!masterSecret) {
      throw new CredentialError(
        'Legacy credential signing is unavailable without CREDENTIAL_SIGNING_SECRET.',
        'CRED_SIGNING_UNAVAILABLE',
        500,
      );
    }
    return crypto
      .createHmac('sha256', masterSecret)
      .update(`zeroid:issuer-key:${issuerId}`)
      .digest();
  }

  private verifyMessage(
    message: Buffer,
    signature: Buffer,
    key: crypto.KeyObject,
  ): boolean {
    if (
      key.asymmetricKeyType === 'ed25519' ||
      key.asymmetricKeyType === 'ed448'
    ) {
      return crypto.verify(null, message, key, signature);
    }
    if (key.asymmetricKeyType === 'rsa-pss') {
      return crypto.verify(
        'sha256',
        message,
        {
          key,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      );
    }

    return crypto.verify('sha256', message, key, signature);
  }

  private validateClaimsAgainstSchema(
    claims: Record<string, unknown>,
    schemaDefinition: Record<string, unknown>,
  ): void {
    const requiredFields = (schemaDefinition.required as string[]) ?? [];
    for (const field of requiredFields) {
      if (!(field in claims)) {
        throw new CredentialError(
          `Missing required field: ${field}`,
          'CRED_SCHEMA_VALIDATION',
        );
      }
    }
  }
}

export const credentialService = new CredentialService();
