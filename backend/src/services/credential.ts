import { prisma, logger, redis, credentialIssuedCounter } from "../index";
import { CredentialStatus } from "@prisma/client";
import crypto from "crypto";
import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
  type SigningAlgorithmSpec,
} from "@aws-sdk/client-kms";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Custom error (declared early so KMS classes can reference it)
// ---------------------------------------------------------------------------
export class CredentialError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = "CredentialError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// KMS Provider Types
// ---------------------------------------------------------------------------
type KMSProvider = "aws-kms" | "gcp-kms" | "azure-kms" | "local";

// ---------------------------------------------------------------------------
// Credential Signer Interface
// ---------------------------------------------------------------------------
interface CredentialSigner {
  sign(message: Buffer): Promise<Buffer>;
  getPublicKey(): Promise<crypto.KeyObject>;
  getProofType(): string;
  getVerificationMethod(): string;
  supportsKeyRotation(): boolean;
  getKeyVersion(): string;
}

// ---------------------------------------------------------------------------
// KMS Credential Signer
// ---------------------------------------------------------------------------
class KMSCredentialSigner implements CredentialSigner {
  private readonly provider: KMSProvider;
  private readonly keyId: string;
  private keyVersion: string;
  private cachedPublicKey?: crypto.KeyObject;
  private localSigningKey?: crypto.KeyObject;

  constructor() {
    this.provider = (process.env.KMS_PROVIDER as KMSProvider) || "local";
    this.keyId = process.env.KMS_KEY_ID || "";
    this.keyVersion = process.env.KMS_KEY_VERSION || "1";

    if (
      IS_PRODUCTION &&
      this.provider === "local" &&
      process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING !== "true"
    ) {
      throw new CredentialError(
        "Local credential signing is blocked in production. Configure AWS/GCP/Azure KMS or explicitly set ALLOW_LOCAL_CREDENTIAL_SIGNING=true for a controlled break-glass deployment.",
        "CRED_LOCAL_SIGNING_BLOCKED",
        500,
      );
    }

    if (
      IS_PRODUCTION &&
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === "true"
    ) {
      throw new CredentialError(
        "Legacy HMAC credential verification is blocked in production. Migrate all credentials to asymmetric signatures before launch.",
        "CRED_LEGACY_SIGNING_BLOCKED",
        500,
      );
    }

    if (this.provider !== "local" && !this.keyId) {
      throw new CredentialError(
        `KMS_KEY_ID is required when KMS_PROVIDER is '${this.provider}'.`,
        "CRED_KMS_CONFIG_MISSING",
        500,
      );
    }

    logger.info("kms_signer_initialized", {
      provider: this.provider,
      keyVersion: this.keyVersion,
      // Never log keyId in full — log only a safe prefix
      keyIdPrefix: this.keyId ? this.keyId.substring(0, 12) + "..." : "n/a",
    });
  }

  async sign(message: Buffer): Promise<Buffer> {
    logger.info("credential_sign_operation", {
      provider: this.provider,
      keyVersion: this.keyVersion,
    });

    switch (this.provider) {
      case "aws-kms":
        return this.signWithAWS(message);
      case "gcp-kms":
        return this.signWithGCP(message);
      case "azure-kms":
        return this.signWithAzure(message);
      case "local":
        return this.signLocal(message);
      default:
        throw new CredentialError(
          `Unsupported KMS provider: ${this.provider}`,
          "CRED_KMS_UNSUPPORTED_PROVIDER",
          500,
        );
    }
  }

  async getPublicKey(): Promise<crypto.KeyObject> {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey;
    }

    switch (this.provider) {
      case "aws-kms":
        this.cachedPublicKey = await this.getPublicKeyFromAWS();
        break;
      case "gcp-kms":
        this.cachedPublicKey = await this.getPublicKeyFromGCP();
        break;
      case "azure-kms":
        this.cachedPublicKey = await this.getPublicKeyFromAzure();
        break;
      case "local":
        this.cachedPublicKey = this.getLocalPublicKey();
        break;
      default:
        throw new CredentialError(
          `Unsupported KMS provider: ${this.provider}`,
          "CRED_KMS_UNSUPPORTED_PROVIDER",
          500,
        );
    }

    return this.cachedPublicKey;
  }

  getProofType(): string {
    if (this.provider === "local") {
      const key = this.getLocalPublicKey();
      if (
        key.asymmetricKeyType === "ed25519" ||
        key.asymmetricKeyType === "ed448"
      ) {
        return "Ed25519Signature2020";
      }
    }
    // KMS providers typically use ECDSA or RSA
    return "JsonWebSignature2020";
  }

  getVerificationMethod(): string {
    const base =
      process.env.CREDENTIAL_SIGNING_VERIFICATION_METHOD ??
      "did:aethelred:zeroid:credential-signer#key-1";
    // Append key version for KMS-backed keys to support rotation
    if (this.provider !== "local") {
      return `${base}?versionId=${this.keyVersion}`;
    }
    return base;
  }

  supportsKeyRotation(): boolean {
    return this.provider !== "local";
  }

  getKeyVersion(): string {
    return this.keyVersion;
  }

  /**
   * Rotate to a new key version. Only supported for KMS-backed providers.
   * Returns the previous key version for audit purposes.
   */
  rotateToVersion(newVersion: string): string {
    if (!this.supportsKeyRotation()) {
      throw new CredentialError(
        "Key rotation is not supported for the local provider.",
        "CRED_ROTATION_UNSUPPORTED",
        400,
      );
    }
    const previousVersion = this.keyVersion;
    this.keyVersion = newVersion;
    // Invalidate cached public key so next call fetches the new version
    this.cachedPublicKey = undefined;

    logger.info("kms_key_rotated", {
      provider: this.provider,
      previousVersion,
      newVersion,
    });

    return previousVersion;
  }

  // ---------------------------------------------------------------------------
  // AWS KMS via official SDK (SigV4 signing, credential chain, retries)
  // ---------------------------------------------------------------------------
  private _kmsClient: KMSClient | null = null;

  private getKMSClient(): KMSClient {
    if (!this._kmsClient) {
      // The SDK resolves credentials via the standard chain:
      // env vars → shared credentials file → ECS/EC2 instance role → SSO
      this._kmsClient = new KMSClient({
        region: process.env.AWS_REGION || "us-east-1",
      });
    }
    return this._kmsClient;
  }

  private async signWithAWS(message: Buffer): Promise<Buffer> {
    try {
      const result = await this.getKMSClient().send(
        new SignCommand({
          KeyId: this.keyId,
          Message: message,
          MessageType: "RAW",
          SigningAlgorithm: (process.env.AWS_KMS_SIGNING_ALGORITHM ||
            "ECDSA_SHA_256") as SigningAlgorithmSpec,
        }),
      );

      if (!result.Signature) {
        throw new CredentialError(
          "AWS KMS Sign returned empty signature",
          "CRED_KMS_SIGN_FAILED",
          500,
        );
      }

      return Buffer.from(result.Signature);
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      logger.error("aws_kms_sign_failed", { error: (err as Error).message });
      throw new CredentialError(
        `AWS KMS signing failed: ${(err as Error).message}`,
        "CRED_KMS_SIGN_FAILED",
        500,
      );
    }
  }

  private async getPublicKeyFromAWS(): Promise<crypto.KeyObject> {
    try {
      const result = await this.getKMSClient().send(
        new GetPublicKeyCommand({
          KeyId: this.keyId,
        }),
      );

      if (!result.PublicKey) {
        throw new CredentialError(
          "AWS KMS GetPublicKey returned empty key",
          "CRED_KMS_PUBKEY_FAILED",
          500,
        );
      }

      return crypto.createPublicKey({
        key: Buffer.from(result.PublicKey),
        format: "der",
        type: "spki",
      });
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      logger.error("aws_kms_get_public_key_failed", {
        error: (err as Error).message,
      });
      throw new CredentialError(
        `AWS KMS GetPublicKey failed: ${(err as Error).message}`,
        "CRED_KMS_PUBKEY_FAILED",
        500,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // GCP Cloud KMS via REST API
  // ---------------------------------------------------------------------------
  private async signWithGCP(message: Buffer): Promise<Buffer> {
    // keyId format: projects/{project}/locations/{location}/keyRings/{ring}/cryptoKeys/{key}/cryptoKeyVersions/{version}
    const keyName = this.keyId.includes("cryptoKeyVersions")
      ? this.keyId
      : `${this.keyId}/cryptoKeyVersions/${this.keyVersion}`;
    const endpoint = `https://cloudkms.googleapis.com/v1/${keyName}:asymmetricSign`;

    // GCP expects the digest, not the raw message
    const digest = crypto.createHash("sha256").update(message).digest();
    const body = JSON.stringify({
      digest: {
        sha256: digest.toString("base64"),
      },
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await this.getGCPAccessToken()}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("gcp_kms_sign_failed", {
        status: response.status,
        error: errorText,
      });
      throw new CredentialError(
        `GCP KMS signing failed: ${response.status}`,
        "CRED_KMS_SIGN_FAILED",
        500,
      );
    }

    const result = (await response.json()) as { signature: string };
    return Buffer.from(result.signature, "base64");
  }

  private async getPublicKeyFromGCP(): Promise<crypto.KeyObject> {
    const keyName = this.keyId.includes("cryptoKeyVersions")
      ? this.keyId
      : `${this.keyId}/cryptoKeyVersions/${this.keyVersion}`;
    const endpoint = `https://cloudkms.googleapis.com/v1/${keyName}:getPublicKey`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.getGCPAccessToken()}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("gcp_kms_get_public_key_failed", {
        status: response.status,
        error: errorText,
      });
      throw new CredentialError(
        `GCP KMS GetPublicKey failed: ${response.status}`,
        "CRED_KMS_PUBKEY_FAILED",
        500,
      );
    }

    const result = (await response.json()) as { pem: string };
    return crypto.createPublicKey(result.pem);
  }

  private async getGCPAccessToken(): Promise<string> {
    // Use the GCP metadata server for workload identity, or fall back to env var
    const envToken = process.env.GCP_ACCESS_TOKEN;
    if (envToken) return envToken;

    try {
      const metadataResponse = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" } },
      );
      if (metadataResponse.ok) {
        const tokenData = (await metadataResponse.json()) as {
          access_token: string;
        };
        return tokenData.access_token;
      }
    } catch {
      // Not running on GCP — fall through
    }

    throw new CredentialError(
      "GCP access token unavailable. Set GCP_ACCESS_TOKEN or run on a GCP instance with workload identity.",
      "CRED_KMS_AUTH_FAILED",
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // Azure Key Vault via REST API
  // ---------------------------------------------------------------------------
  private async signWithAzure(message: Buffer): Promise<Buffer> {
    const vaultName = process.env.AZURE_KEYVAULT_NAME;
    const keyName = process.env.AZURE_KEY_NAME || this.keyId;
    if (!vaultName) {
      throw new CredentialError(
        "AZURE_KEYVAULT_NAME is required for Azure KMS.",
        "CRED_KMS_CONFIG_MISSING",
        500,
      );
    }

    const digest = crypto.createHash("sha256").update(message).digest();
    const endpoint = `https://${vaultName}.vault.azure.net/keys/${keyName}/${this.keyVersion}/sign?api-version=7.4`;
    const body = JSON.stringify({
      alg: process.env.AZURE_KMS_ALGORITHM || "ES256",
      value: digest.toString("base64url"),
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await this.getAzureAccessToken()}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("azure_kms_sign_failed", {
        status: response.status,
        error: errorText,
      });
      throw new CredentialError(
        `Azure Key Vault signing failed: ${response.status}`,
        "CRED_KMS_SIGN_FAILED",
        500,
      );
    }

    const result = (await response.json()) as { value: string };
    return Buffer.from(result.value, "base64url");
  }

  private async getPublicKeyFromAzure(): Promise<crypto.KeyObject> {
    const vaultName = process.env.AZURE_KEYVAULT_NAME;
    const keyName = process.env.AZURE_KEY_NAME || this.keyId;
    if (!vaultName) {
      throw new CredentialError(
        "AZURE_KEYVAULT_NAME is required for Azure KMS.",
        "CRED_KMS_CONFIG_MISSING",
        500,
      );
    }

    const endpoint = `https://${vaultName}.vault.azure.net/keys/${keyName}/${this.keyVersion}?api-version=7.4`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.getAzureAccessToken()}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("azure_kms_get_key_failed", {
        status: response.status,
        error: errorText,
      });
      throw new CredentialError(
        `Azure Key Vault GetKey failed: ${response.status}`,
        "CRED_KMS_PUBKEY_FAILED",
        500,
      );
    }

    const result = (await response.json()) as {
      key: { x: string; y: string; crv: string; kty: string };
    };
    // Convert JWK to KeyObject
    return crypto.createPublicKey({
      key: {
        kty: result.key.kty,
        crv: result.key.crv,
        x: result.key.x,
        y: result.key.y,
      },
      format: "jwk",
    });
  }

  private async getAzureAccessToken(): Promise<string> {
    const envToken = process.env.AZURE_ACCESS_TOKEN;
    if (envToken) return envToken;

    // Try Azure IMDS (managed identity)
    try {
      const imdsResponse = await fetch(
        "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2019-08-01&resource=https://vault.azure.net",
        { headers: { Metadata: "true" } },
      );
      if (imdsResponse.ok) {
        const tokenData = (await imdsResponse.json()) as {
          access_token: string;
        };
        return tokenData.access_token;
      }
    } catch {
      // Not running on Azure — fall through
    }

    throw new CredentialError(
      "Azure access token unavailable. Set AZURE_ACCESS_TOKEN or run on an Azure instance with managed identity.",
      "CRED_KMS_AUTH_FAILED",
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // Local signing (dev/test only)
  // ---------------------------------------------------------------------------
  private signLocal(message: Buffer): Promise<Buffer> {
    const key = this.getLocalSigningKey();
    let signature: Buffer;
    if (
      key.asymmetricKeyType === "ed25519" ||
      key.asymmetricKeyType === "ed448"
    ) {
      signature = crypto.sign(null, message, key);
    } else {
      signature = crypto.sign("sha256", message, key);
    }
    return Promise.resolve(signature);
  }

  private getLocalSigningKey(): crypto.KeyObject {
    if (this.localSigningKey) {
      return this.localSigningKey;
    }

    const rawKey = process.env.CREDENTIAL_SIGNING_PRIVATE_KEY;
    if (!rawKey) {
      throw new CredentialError(
        "CREDENTIAL_SIGNING_PRIVATE_KEY not configured. Credential issuance is disabled until signing is configured.",
        "CRED_SIGNING_UNAVAILABLE",
        500,
      );
    }

    const trimmed = rawKey.trim();
    if (trimmed.includes("BEGIN PRIVATE KEY")) {
      this.localSigningKey = crypto.createPrivateKey(trimmed);
    } else {
      const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      this.localSigningKey = crypto.createPrivateKey({
        key: Buffer.from(normalized, "base64"),
        format: "der",
        type: "pkcs8",
      });
    }

    return this.localSigningKey;
  }

  private getLocalPublicKey(): crypto.KeyObject {
    const rawPublicKey = process.env.CREDENTIAL_SIGNING_PUBLIC_KEY;
    if (rawPublicKey) {
      const trimmed = rawPublicKey.trim();
      if (trimmed.includes("BEGIN PUBLIC KEY")) {
        return crypto.createPublicKey(trimmed);
      }
      const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      return crypto.createPublicKey({
        key: Buffer.from(normalized, "base64"),
        format: "der",
        type: "spki",
      });
    }
    return crypto.createPublicKey(this.getLocalSigningKey());
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
    logger.info("credential_issuance_start", {
      credentialType: request.credentialType,
      issuerId: request.issuerId,
      subjectId: request.subjectId,
    });

    // Verify issuer exists and is active
    const issuer = await prisma.identity.findUnique({
      where: { id: request.issuerId },
    });
    if (!issuer || issuer.status !== "ACTIVE") {
      throw new CredentialError(
        "Issuer identity is not active",
        "CRED_ISSUER_INACTIVE",
      );
    }

    // Verify subject exists and is active
    const subject = await prisma.identity.findUnique({
      where: { id: request.subjectId },
    });
    if (!subject || subject.status !== "ACTIVE") {
      throw new CredentialError(
        "Subject identity is not active",
        "CRED_SUBJECT_INACTIVE",
      );
    }

    // Validate schema if provided
    if (request.schemaId) {
      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: request.schemaId },
      });
      if (!schema || schema.status !== "APPROVED") {
        throw new CredentialError(
          "Schema not found or not approved",
          "CRED_SCHEMA_INVALID",
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
        status: "ACTIVE",
      },
    });
    if (existing) {
      throw new CredentialError(
        "Duplicate credential already exists",
        "CRED_DUPLICATE",
      );
    }

    // Build a publicly verifiable credential proof. The proof is scoped to
    // the issuer's DID, binding the signature to the specific issuer rather
    // than a platform-wide key. External verifiers can resolve the issuer's
    // public key from their DID document or the platform's issuer key registry.
    const issuerVerificationMethod = `${request.issuerDid}#assertion-key-${this.signer.getKeyVersion()}`;
    const proof = {
      type: this.signer.getProofType(),
      created: new Date().toISOString(),
      verificationMethod: issuerVerificationMethod,
      proofPurpose: "assertionMethod",
      issuerDid: request.issuerDid,
      keyVersion: this.signer.getKeyVersion(),
      // Sign over issuerDid + claimsHash to bind the credential to the issuer
      signatureValue: await this.signCredentialForIssuer(
        request.issuerDid,
        claimsHash,
      ),
    };

    // Create the credential
    const credential = await prisma.credential.create({
      data: {
        credentialType: request.credentialType,
        issuerId: request.issuerId,
        subjectId: request.subjectId,
        schemaId: request.schemaId,
        claims: request.claims as any,
        claimsHash,
        proof,
        expiresAt: request.expiresAt,
        status: "ACTIVE",
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        identityId: request.issuerId,
        action: "CREDENTIAL_ISSUED",
        resourceType: "credential",
        resourceId: credential.id,
        details: {
          credentialType: request.credentialType,
          subjectId: request.subjectId,
          subjectDid: request.subjectDid,
          schemaId: request.schemaId,
          keyVersion: this.signer.getKeyVersion(),
        },
      },
    });

    // Invalidate cached credential lists
    await redis.del(`creds:subject:${request.subjectId}`);
    await redis.del(`creds:issuer:${request.issuerId}`);

    credentialIssuedCounter.inc();

    logger.info("credential_issued", {
      credentialId: credential.id,
      credentialType: request.credentialType,
      subjectId: request.subjectId,
      keyVersion: this.signer.getKeyVersion(),
    });

    return this.formatCredential(credential);
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
      credential.status === "ACTIVE"
    ) {
      await prisma.credential.update({
        where: { id: credentialId },
        data: { status: "EXPIRED" },
      });
      credential.status = "EXPIRED";
    }

    const formatted = this.formatCredential(credential);

    // Cache for 5 minutes
    await redis.set(
      `cred:${credentialId}`,
      JSON.stringify(formatted),
      "EX",
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
        orderBy: { issuedAt: "desc" },
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
      throw new CredentialError("Credential not found", "CRED_NOT_FOUND", 404);
    }

    if (credential.status === "REVOKED") {
      throw new CredentialError(
        "Credential already revoked",
        "CRED_ALREADY_REVOKED",
      );
    }

    // Only the issuer can revoke
    if (credential.issuerId !== request.revokedBy) {
      throw new CredentialError(
        "Only the issuer can revoke a credential",
        "CRED_UNAUTHORIZED",
        403,
      );
    }

    const previousState = { status: credential.status };

    const updated = await prisma.credential.update({
      where: { id: request.credentialId },
      data: {
        status: "REVOKED",
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
        action: "CREDENTIAL_REVOKED",
        resourceType: "credential",
        resourceId: request.credentialId,
        previousState,
        newState: { status: "REVOKED" },
        details: { reason: request.reason },
      },
    });

    // Invalidate caches
    await redis.del(`cred:${request.credentialId}`);
    await redis.del(`creds:subject:${credential.subjectId}`);
    await redis.del(`creds:issuer:${credential.issuerId}`);

    logger.info("credential_revoked", {
      credentialId: request.credentialId,
      revokedBy: request.revokedBy,
      reason: request.reason,
    });

    return this.formatCredential(updated);
  }

  // -------------------------------------------------------------------------
  // Verify a credential (check validity, signature, revocation)
  // -------------------------------------------------------------------------
  async verifyCredential(credentialId: string): Promise<{
    valid: boolean;
    credential: CredentialResponse;
    checks: Record<string, boolean>;
  }> {
    const credential = await prisma.credential.findUnique({
      where: { id: credentialId },
    });

    if (!credential) {
      throw new CredentialError("Credential not found", "CRED_NOT_FOUND", 404);
    }

    const checks: Record<string, boolean> = {};

    // 1. Status check
    checks.statusActive = credential.status === "ACTIVE";

    // 2. Expiry check
    checks.notExpired =
      !credential.expiresAt || credential.expiresAt > new Date();

    // 3. Claims integrity check
    const currentHash = await this.hashClaims(
      credential.claims as Record<string, unknown>,
    );
    checks.integrityValid = currentHash === credential.claimsHash;

    // 4. Proof/signature verification
    checks.signatureValid = await this.verifyProofSignature(
      currentHash,
      credential.issuerId,
      credential.proof as Record<string, unknown>,
    );

    // 5. Issuer active check
    const issuer = await prisma.identity.findUnique({
      where: { id: credential.issuerId },
    });
    checks.issuerActive = issuer?.status === "ACTIVE";

    // 6. Subject active check
    const subject = await prisma.identity.findUnique({
      where: { id: credential.subjectId },
    });
    checks.subjectActive = subject?.status === "ACTIVE";

    // 7. Revocation registry check
    const revocation = await prisma.revocationRegistry.findUnique({
      where: { credentialId },
    });
    checks.notRevoked = revocation === null;

    const valid = Object.values(checks).every(Boolean);

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "CREDENTIAL_VERIFIED",
        resourceType: "credential",
        resourceId: credentialId,
        details: { valid, checks },
      },
    });

    return {
      valid,
      credential: this.formatCredential(credential),
      checks,
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
        action: "SIGNING_KEY_ROTATED",
        resourceType: "signing_key",
        resourceId: `kms-key-version-${newVersion}`,
        previousState: { keyVersion: previousVersion },
        newState: { keyVersion: newVersion },
        details: {
          provider: process.env.KMS_PROVIDER || "local",
          rotatedAt: new Date().toISOString(),
        },
      },
    });

    logger.info("signing_key_rotation_complete", {
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

  private async hashClaims(claims: Record<string, unknown>): Promise<string> {
    // Use deterministic JSON serialization that handles nested objects
    const canonical = this.canonicalize(claims);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(canonical),
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Produce a canonical JSON string with recursively sorted keys.
   * This ensures nested objects are fully included and deterministically ordered.
   */
  private canonicalize(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return "[" + value.map((v) => this.canonicalize(v)).join(",") + "]";
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(
      (k) => JSON.stringify(k) + ":" + this.canonicalize(obj[k]),
    );
    return "{" + entries.join(",") + "}";
  }

  /**
   * Sign a credential binding the signature to a specific issuer DID.
   * The signed message is SHA-256(issuerDid || claimsHash), ensuring the
   * credential cannot be re-attributed to a different issuer without
   * invalidating the signature.
   */
  private async signCredentialForIssuer(
    issuerDid: string,
    claimsHash: string,
  ): Promise<string> {
    const message = crypto
      .createHash("sha256")
      .update(`${issuerDid}:${claimsHash}`)
      .digest();
    const signature = await this.signer.sign(message);
    return signature.toString("base64url");
  }

  private async verifyProofSignature(
    claimsHash: string,
    issuerId: string,
    proof: Record<string, unknown>,
  ): Promise<boolean> {
    const signatureValue = proof?.signatureValue as string;
    if (!signatureValue) {
      return false;
    }

    if (proof?.proofPurpose !== "assertionMethod") {
      return false;
    }

    const signature = Buffer.from(signatureValue, "base64url");
    const publicKey = await this.resolveVerificationPublicKey(proof);
    if (!publicKey) {
      logger.warn("credential_verify_no_public_key", { issuerId });
      return false;
    }

    // Issuer-scoped verification: if the proof contains an issuerDid field,
    // the signed message is SHA-256(issuerDid:claimsHash). This ensures
    // credentials are bound to the issuer and cannot be re-attributed.
    const issuerDid = proof?.issuerDid as string | undefined;
    if (issuerDid) {
      const issuerScopedMessage = crypto
        .createHash("sha256")
        .update(`${issuerDid}:${claimsHash}`)
        .digest();
      if (this.verifyMessage(issuerScopedMessage, signature, publicKey)) {
        // Verify the issuerDid in the proof matches the credential's issuerId
        const issuer = await prisma.identity.findUnique({
          where: { id: issuerId },
        });
        if (issuer && issuer.did === issuerDid) {
          return true;
        }
        logger.warn("credential_issuer_did_mismatch", {
          proofIssuerDid: issuerDid,
          credentialIssuerId: issuerId,
        });
        return false;
      }
    }

    // Fallback: legacy platform-scoped verification for pre-migration
    // credentials that were signed with just the claimsHash.
    // CRED-01: Block this path in production — credentials MUST have issuer-DID binding.
    if (IS_PRODUCTION) {
      logger.warn("credential_legacy_platform_scope_blocked", {
        issuerId,
        note: "Legacy platform-scoped verification is blocked in production. Credential must be re-issued with issuer-DID binding.",
      });
      return false;
    }

    try {
      const legacyMessage = Buffer.from(claimsHash, "hex");
      if (this.verifyMessage(legacyMessage, signature, publicKey)) {
        logger.warn(
          "credential_verified_with_legacy_platform_scope_DEPRECATED",
          {
            issuerId,
            note:
              "DEPRECATION WARNING: Credential was signed with platform-scoped key without issuer-DID binding. " +
              "This legacy fallback will be removed in a future release. Re-issue the credential with issuer-scoped binding.",
          },
        );
        return true;
      }
    } catch {
      // Fall through
    }

    // IMPORTANT: This flag MUST be removed before external audit.
    if (
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      logger.error(
        "CRITICAL_SECURITY_WARNING: legacy_hmac_credential_signing_enabled — " +
          "this MUST NOT be used in production and must be removed before external audit",
      );
      return this.verifyLegacyProofSignature(claimsHash, issuerId, proof);
    }

    if (
      process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING === "true" &&
      process.env.NODE_ENV === "production"
    ) {
      logger.error(
        "CRITICAL_SECURITY_VIOLATION: legacy HMAC credential signing is blocked in production",
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
            publicKey: true,
            keyVersion: true,
            keyAlgorithm: true,
            verificationMethod: true,
          },
        });

        if (issuerIdentity && issuerIdentity.publicKey) {
          // Key-version pinning: if the proof specifies a keyVersion, it must
          // match the issuer's current keyVersion. This prevents replaying a
          // credential signed with a rotated-out key.
          const proofKeyVersion = proof?.keyVersion as string | undefined;
          if (
            proofKeyVersion &&
            proofKeyVersion !== issuerIdentity.keyVersion
          ) {
            logger.warn("credential_verify_issuer_key_version_mismatch", {
              issuerDid,
              proofKeyVersion,
              issuerKeyVersion: issuerIdentity.keyVersion,
            });
            return null;
          }

          // Optional verificationMethod check: if the proof references a
          // specific verificationMethod id, it must match the issuer's record.
          const proofVerificationMethod = proof?.verificationMethod as
            | string
            | undefined;
          if (
            proofVerificationMethod &&
            issuerIdentity.verificationMethod &&
            proofVerificationMethod !== issuerIdentity.verificationMethod
          ) {
            logger.warn("credential_verify_verification_method_mismatch", {
              issuerDid,
              proofVerificationMethod,
              issuerVerificationMethod: issuerIdentity.verificationMethod,
            });
            return null;
          }

          logger.info("credential_verify_issuer_key_resolved", {
            issuerDid,
            keyVersion: issuerIdentity.keyVersion,
            keyAlgorithm: issuerIdentity.keyAlgorithm,
            verificationMethod: issuerIdentity.verificationMethod ?? "none",
            source: "identity_table",
          });
          return this.parseVerificationPublicKey(issuerIdentity.publicKey);
        }

        logger.warn("credential_verify_issuer_key_not_found", {
          issuerDid,
          note: "No identity found for issuerDid or publicKey is empty.",
        });
      } catch (err) {
        logger.warn("credential_verify_issuer_key_lookup_failed", {
          issuerDid,
          error: (err as Error).message,
        });
      }

      // In production, REFUSE to fall back to platform key when an issuerDid
      // was present — the issuer must have their own key material registered.
      if (IS_PRODUCTION) {
        logger.error("credential_verify_issuer_key_required_in_production", {
          issuerDid,
          note:
            "Platform-wide key fallback is blocked in production for credentials with issuerDid. " +
            "Register the issuer's publicKey, keyVersion, and verificationMethod in the identity table.",
        });
        return null;
      }

      // Non-production: allow fallback but log deprecation warning.
      logger.warn("credential_verify_platform_key_fallback_DEPRECATED", {
        issuerDid,
        note:
          "DEPRECATION WARNING: Falling back to platform-wide signing key. " +
          "This fallback will be removed in production.",
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: Platform-wide key fallback (backward compatibility, non-production only for issuerDid credentials)
    // -----------------------------------------------------------------------
    const proofKeyVersion =
      typeof proof?.keyVersion === "string"
        ? proof.keyVersion
        : this.signer.getKeyVersion();

    if (proofKeyVersion === this.signer.getKeyVersion()) {
      return this.signer.getPublicKey();
    }

    const rawVersionedKeys = process.env.CREDENTIAL_SIGNING_PUBLIC_KEYS_JSON;
    if (!rawVersionedKeys) {
      logger.warn("credential_public_key_version_missing", {
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
        "CRED_PUBKEY_CONFIG_INVALID",
        500,
      );
    }

    const rawKey = parsedKeys[proofKeyVersion];
    if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
      logger.warn("credential_public_key_not_found", {
        requestedVersion: proofKeyVersion,
      });
      return null;
    }

    return this.parseVerificationPublicKey(rawKey);
  }

  private parseVerificationPublicKey(rawKey: string): crypto.KeyObject {
    const trimmed = rawKey.trim();
    if (trimmed.includes("BEGIN PUBLIC KEY")) {
      return crypto.createPublicKey(trimmed);
    }

    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    return crypto.createPublicKey({
      key: Buffer.from(normalized, "base64"),
      format: "der",
      type: "spki",
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
    const hmac = crypto.createHmac("sha256", signingKey);
    hmac.update(claimsHash);
    const expected = hmac.digest("base64");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signatureValue, "base64"),
        Buffer.from(expected, "base64"),
      );
    } catch {
      return false;
    }
  }

  private deriveLegacyIssuerKey(issuerId: string): Buffer {
    const masterSecret = process.env.CREDENTIAL_SIGNING_SECRET;
    if (!masterSecret) {
      throw new CredentialError(
        "Legacy credential signing is unavailable without CREDENTIAL_SIGNING_SECRET.",
        "CRED_SIGNING_UNAVAILABLE",
        500,
      );
    }
    return crypto
      .createHmac("sha256", masterSecret)
      .update(`zeroid:issuer-key:${issuerId}`)
      .digest();
  }

  private verifyMessage(
    message: Buffer,
    signature: Buffer,
    key: crypto.KeyObject,
  ): boolean {
    if (
      key.asymmetricKeyType === "ed25519" ||
      key.asymmetricKeyType === "ed448"
    ) {
      return crypto.verify(null, message, key, signature);
    }

    return crypto.verify("sha256", message, key, signature);
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
          "CRED_SCHEMA_VALIDATION",
        );
      }
    }
  }
}

export const credentialService = new CredentialService();
