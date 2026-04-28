import crypto from 'crypto';

export type EnterpriseKmsProvider = 'aws-kms' | 'gcp-kms' | 'azure-kms' | 'local';
export type EnterpriseSigningAlgorithm = 'RS256' | 'PS256' | 'ES256' | 'EdDSA';
type AwsSigningAlgorithmSpec = 'RSASSA_PKCS1_V1_5_SHA_256' | 'RSASSA_PSS_SHA_256' | 'ECDSA_SHA_256';

type AwsKmsClient = {
  send(command: unknown): Promise<Record<string, unknown>>;
};

type LoggerLike = {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export class EnterpriseSigningError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'EnterpriseSigningError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type EnterpriseKeySignerOptions = {
  provider?: EnterpriseKmsProvider;
  keyId?: string;
  keyVersion?: string;
  privateKey?: string;
  publicKey?: string;
  privateKeyEnvKey?: string;
  publicKeyEnvKey?: string;
  verificationMethod?: string;
  verificationMethodEnvKey?: string;
  defaultVerificationMethod: string;
  allowLocalSigning?: boolean;
  localSigningBlockedMessage?: string;
  localSigningBlockedCode?: string;
  signingUnavailableMessage?: string;
  signingUnavailableCode?: string;
  kmsConfigMissingCode?: string;
  kmsUnsupportedProviderCode?: string;
  kmsSignFailedCode?: string;
  kmsPublicKeyFailedCode?: string;
  kmsAuthFailedCode?: string;
  awsSigningAlgorithm?: AwsSigningAlgorithmSpec;
  awsSigningAlgorithmEnvKey?: string;
  gcpAccessTokenEnvKey?: string;
  azureAccessTokenEnvKey?: string;
  azureKeyVaultNameEnvKey?: string;
  azureKeyNameEnvKey?: string;
  azureAlgorithmEnvKey?: string;
  logger?: LoggerLike;
};

const DEFAULT_ERROR_CODES = {
  localSigningBlocked: 'SIGNING_LOCAL_BLOCKED',
  signingUnavailable: 'SIGNING_UNAVAILABLE',
  kmsConfigMissing: 'SIGNING_KMS_CONFIG_MISSING',
  kmsUnsupportedProvider: 'SIGNING_KMS_UNSUPPORTED_PROVIDER',
  kmsSignFailed: 'SIGNING_KMS_SIGN_FAILED',
  kmsPublicKeyFailed: 'SIGNING_KMS_PUBKEY_FAILED',
  kmsAuthFailed: 'SIGNING_KMS_AUTH_FAILED',
};

const KMS_HTTP_TIMEOUT_MS = 10_000;
const KMS_HTTP_RESPONSE_MAX_BYTES = 1024 * 1024;
const KMS_HTTP_ERROR_PREVIEW_BYTES = 2048;

let awsKmsClient: AwsKmsClient | null = null;

function getAwsKmsSdk(): {
  KMSClient: new (config: { region: string }) => AwsKmsClient;
  GetPublicKeyCommand: new (input: { KeyId: string }) => unknown;
  SignCommand: new (input: {
    KeyId: string;
    Message: Buffer;
    MessageType?: 'RAW' | 'DIGEST';
    SigningAlgorithm: AwsSigningAlgorithmSpec;
  }) => unknown;
} {
  try {
    return require('@aws-sdk/client-kms') as {
      KMSClient: new (config: { region: string }) => AwsKmsClient;
      GetPublicKeyCommand: new (input: { KeyId: string }) => unknown;
      SignCommand: new (input: {
        KeyId: string;
        Message: Buffer;
        MessageType?: 'RAW' | 'DIGEST';
        SigningAlgorithm: AwsSigningAlgorithmSpec;
      }) => unknown;
    };
  } catch (error) {
    throw new EnterpriseSigningError(
      `AWS KMS signing requested but @aws-sdk/client-kms is not installed: ${(error as Error).message}`,
      DEFAULT_ERROR_CODES.kmsConfigMissing,
      500,
    );
  }
}

function getAwsKmsClient(): AwsKmsClient {
  if (!awsKmsClient) {
    const { KMSClient } = getAwsKmsSdk();
    awsKmsClient = new KMSClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return awsKmsClient;
}

function fetchWithKmsTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    redirect: 'manual',
    signal: init.signal ?? AbortSignal.timeout(KMS_HTTP_TIMEOUT_MS),
  });
}

async function readKmsJsonResponse<T>(
  response: Response,
  label: string,
  errorCode: string,
): Promise<T> {
  const body = await readKmsResponseBody(
    response,
    label,
    errorCode,
    KMS_HTTP_RESPONSE_MAX_BYTES,
  );

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new EnterpriseSigningError(
      `${label} response was not valid JSON`,
      errorCode,
      502,
    );
  }
}

async function readKmsErrorPreview(response: Response): Promise<string> {
  try {
    const preview = await readKmsResponseBody(
      response,
      'KMS error',
      DEFAULT_ERROR_CODES.kmsSignFailed,
      KMS_HTTP_ERROR_PREVIEW_BYTES,
    );
    return redactKmsErrorPreview(preview);
  } catch {
    return '[unavailable]';
  }
}

async function readKmsResponseBody(
  response: Response,
  label: string,
  errorCode: string,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new EnterpriseSigningError(
        `${label} response exceeded ${maxBytes} byte limit`,
        errorCode,
        502,
      );
    }
  }

  if (!response.body) {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      throw new EnterpriseSigningError(
        `${label} response exceeded ${maxBytes} byte limit`,
        errorCode,
        502,
      );
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        throw new EnterpriseSigningError(
          `${label} response exceeded ${maxBytes} byte limit`,
          errorCode,
          502,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function redactKmsErrorPreview(value: string): string {
  return value.replace(
    /(["']?(?:access_token|refresh_token|id_token|client_secret|api[_-]?key|api[_-]?secret|authorization)["']?\s*[:=]\s*)(["'][^"']+["']|[^,\s&}]+)/gi,
    '$1[redacted]',
  );
}

function requireKmsStringField(
  value: unknown,
  field: string,
  label: string,
  errorCode: string,
): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  throw new EnterpriseSigningError(
    `${label} response missing required field: ${field}`,
    errorCode,
    502,
  );
}

function requireKmsObjectField(
  value: unknown,
  field: string,
  label: string,
  errorCode: string,
): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new EnterpriseSigningError(
    `${label} response missing required object: ${field}`,
    errorCode,
    502,
  );
}

function normalizeKeyMaterial(raw: string): string {
  return raw.trim().replace(/\\n/g, '\n');
}

function parsePrivateKey(raw: string): crypto.KeyObject {
  const trimmed = normalizeKeyMaterial(raw);
  if (trimmed.includes('BEGIN PRIVATE KEY')) {
    return crypto.createPrivateKey(trimmed);
  }
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  return crypto.createPrivateKey({
    key: Buffer.from(normalized, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function parsePublicKey(raw: string): crypto.KeyObject {
  const trimmed = normalizeKeyMaterial(raw);
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

function awsSigningAlgorithmToBundleAlgorithm(
  algorithm: AwsSigningAlgorithmSpec,
): Exclude<EnterpriseSigningAlgorithm, 'EdDSA'> {
  switch (algorithm) {
    case 'RSASSA_PKCS1_V1_5_SHA_256':
      return 'RS256';
    case 'RSASSA_PSS_SHA_256':
      return 'PS256';
    case 'ECDSA_SHA_256':
    default:
      return 'ES256';
  }
}

function keyAlgorithm(key: crypto.KeyObject): EnterpriseSigningAlgorithm {
  switch (key.asymmetricKeyType) {
    case 'ed25519':
    case 'ed448':
      return 'EdDSA';
    case 'ec':
      return 'ES256';
    case 'rsa-pss':
      return 'PS256';
    case 'rsa':
      return 'RS256';
    default:
      throw new EnterpriseSigningError(
        `Unsupported asymmetric signing key type: ${String(key.asymmetricKeyType)}`,
        DEFAULT_ERROR_CODES.kmsUnsupportedProvider,
        500,
      );
  }
}

export function getEnterpriseVerificationKeyInput(
  algorithm: EnterpriseSigningAlgorithm,
  publicKey: crypto.KeyObject,
): crypto.KeyLike | crypto.VerifyKeyObjectInput {
  if (algorithm === 'PS256') {
    return {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    };
  }
  return publicKey;
}

function getEnterpriseSigningKeyInput(
  algorithm: EnterpriseSigningAlgorithm,
  privateKey: crypto.KeyObject,
): crypto.KeyLike | crypto.SignKeyObjectInput {
  if (algorithm === 'PS256') {
    return {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    };
  }
  return privateKey;
}

export function exportEnterprisePublicKeyPem(publicKey: crypto.KeyObject): string {
  return publicKey.export({ format: 'pem', type: 'spki' }).toString();
}

export function computeEnterprisePublicKeyFingerprint(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64url');
}

function encodeDerInteger(value: Buffer): Buffer {
  let normalized = value;
  while (normalized.length > 1 && normalized[0] === 0) {
    normalized = normalized.subarray(1);
  }
  if ((normalized[0] & 0x80) !== 0) {
    normalized = Buffer.concat([Buffer.from([0]), normalized]);
  }
  return Buffer.concat([Buffer.from([0x02, normalized.length]), normalized]);
}

function encodeDerSequence(parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  if (body.length < 128) {
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  }
  const lengthBytes: number[] = [];
  let remaining = body.length;
  while (remaining > 0) {
    lengthBytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.concat([Buffer.from([0x30, 0x80 | lengthBytes.length, ...lengthBytes]), body]);
}

function normalizeAzureSignature(signature: Buffer, algorithm: string): Buffer {
  if (!algorithm.startsWith('ES') || signature.length % 2 !== 0) {
    return signature;
  }
  const partLength = signature.length / 2;
  if (partLength !== 32 && partLength !== 48 && partLength !== 66) {
    return signature;
  }
  return encodeDerSequence([
    encodeDerInteger(signature.subarray(0, partLength)),
    encodeDerInteger(signature.subarray(partLength)),
  ]);
}

export class EnterpriseKeySigner {
  private readonly provider: EnterpriseKmsProvider;
  private readonly keyId: string;
  private keyVersion: string;
  private readonly options: Required<Pick<
    EnterpriseKeySignerOptions,
    | 'defaultVerificationMethod'
    | 'localSigningBlockedMessage'
    | 'localSigningBlockedCode'
    | 'signingUnavailableMessage'
    | 'signingUnavailableCode'
    | 'kmsConfigMissingCode'
    | 'kmsUnsupportedProviderCode'
    | 'kmsSignFailedCode'
    | 'kmsPublicKeyFailedCode'
    | 'kmsAuthFailedCode'
  >> & EnterpriseKeySignerOptions;
  private cachedPublicKey?: crypto.KeyObject;
  private localSigningKey?: crypto.KeyObject;

  constructor(options: EnterpriseKeySignerOptions) {
    this.provider = options.provider ?? 'local';
    this.keyId = options.keyId ?? '';
    this.keyVersion = options.keyVersion ?? '1';
    this.options = {
      ...options,
      localSigningBlockedMessage: options.localSigningBlockedMessage
        ?? 'Local signing is blocked in production. Configure a KMS-backed signer or explicitly allow local signing for controlled deployments.',
      localSigningBlockedCode: options.localSigningBlockedCode ?? DEFAULT_ERROR_CODES.localSigningBlocked,
      signingUnavailableMessage: options.signingUnavailableMessage
        ?? 'Signing private key is not configured.',
      signingUnavailableCode: options.signingUnavailableCode ?? DEFAULT_ERROR_CODES.signingUnavailable,
      kmsConfigMissingCode: options.kmsConfigMissingCode ?? DEFAULT_ERROR_CODES.kmsConfigMissing,
      kmsUnsupportedProviderCode: options.kmsUnsupportedProviderCode ?? DEFAULT_ERROR_CODES.kmsUnsupportedProvider,
      kmsSignFailedCode: options.kmsSignFailedCode ?? DEFAULT_ERROR_CODES.kmsSignFailed,
      kmsPublicKeyFailedCode: options.kmsPublicKeyFailedCode ?? DEFAULT_ERROR_CODES.kmsPublicKeyFailed,
      kmsAuthFailedCode: options.kmsAuthFailedCode ?? DEFAULT_ERROR_CODES.kmsAuthFailed,
    };

    if (process.env.NODE_ENV === 'production' && this.provider === 'local' && options.allowLocalSigning !== true) {
      throw new EnterpriseSigningError(
        this.options.localSigningBlockedMessage,
        this.options.localSigningBlockedCode,
        500,
      );
    }

    if (this.provider !== 'local' && !this.keyId) {
      throw new EnterpriseSigningError(
        `KMS key id is required when provider is '${this.provider}'.`,
        this.options.kmsConfigMissingCode,
        500,
      );
    }
  }

  async sign(message: Buffer): Promise<Buffer> {
    this.options.logger?.info?.('enterprise_sign_operation', {
      provider: this.provider,
      keyVersion: this.keyVersion,
    });

    switch (this.provider) {
      case 'aws-kms':
        return this.signWithAWS(message);
      case 'gcp-kms':
        return this.signWithGCP(message);
      case 'azure-kms':
        return this.signWithAzure(message);
      case 'local':
        return this.signLocal(message);
      default:
        throw new EnterpriseSigningError(
          `Unsupported KMS provider: ${this.provider}`,
          this.options.kmsUnsupportedProviderCode,
          500,
        );
    }
  }

  async getPublicKey(): Promise<crypto.KeyObject> {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey;
    }

    switch (this.provider) {
      case 'aws-kms':
        this.cachedPublicKey = await this.getPublicKeyFromAWS();
        break;
      case 'gcp-kms':
        this.cachedPublicKey = await this.getPublicKeyFromGCP();
        break;
      case 'azure-kms':
        this.cachedPublicKey = await this.getPublicKeyFromAzure();
        break;
      case 'local':
        this.cachedPublicKey = this.getLocalPublicKey();
        break;
      default:
        throw new EnterpriseSigningError(
          `Unsupported KMS provider: ${this.provider}`,
          this.options.kmsUnsupportedProviderCode,
          500,
        );
    }

    return this.cachedPublicKey;
  }

  getProofType(): string {
    if (this.provider === 'local') {
      const key = this.getLocalPublicKey();
      if (key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448') {
        return 'Ed25519Signature2020';
      }
    }
    return 'JsonWebSignature2020';
  }

  async getSigningAlgorithm(): Promise<EnterpriseSigningAlgorithm> {
    if (this.provider === 'aws-kms') {
      return awsSigningAlgorithmToBundleAlgorithm(this.resolveAwsSigningAlgorithm());
    }
    return keyAlgorithm(await this.getPublicKey());
  }

  getVerificationMethod(): string {
    const configured = this.options.verificationMethod
      ?? (this.options.verificationMethodEnvKey ? process.env[this.options.verificationMethodEnvKey] : undefined)
      ?? this.options.defaultVerificationMethod;
    if (this.provider !== 'local') {
      return `${configured}?versionId=${this.keyVersion}`;
    }
    return configured;
  }

  supportsKeyRotation(): boolean {
    return this.provider !== 'local';
  }

  getKeyVersion(): string {
    return this.keyVersion;
  }

  rotateToVersion(newVersion: string): string {
    if (!this.supportsKeyRotation()) {
      throw new EnterpriseSigningError(
        'Key rotation is not supported for the local provider.',
        'SIGNING_ROTATION_UNSUPPORTED',
        400,
      );
    }
    const previousVersion = this.keyVersion;
    this.keyVersion = newVersion;
    this.cachedPublicKey = undefined;
    return previousVersion;
  }

  private async signWithAWS(message: Buffer): Promise<Buffer> {
    try {
      const { SignCommand } = getAwsKmsSdk();
      const result = await getAwsKmsClient().send(new SignCommand({
        KeyId: this.keyId,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: this.resolveAwsSigningAlgorithm(),
      })) as { Signature?: Uint8Array | Buffer };

      if (!result.Signature) {
        throw new EnterpriseSigningError(
          'AWS KMS Sign returned empty signature',
          this.options.kmsSignFailedCode,
          500,
        );
      }

      return Buffer.from(result.Signature);
    } catch (error) {
      if (error instanceof EnterpriseSigningError) throw error;
      this.options.logger?.error?.('aws_kms_sign_failed', { error: (error as Error).message });
      throw new EnterpriseSigningError(
        `AWS KMS signing failed: ${(error as Error).message}`,
        this.options.kmsSignFailedCode,
        500,
      );
    }
  }

  private async getPublicKeyFromAWS(): Promise<crypto.KeyObject> {
    try {
      const { GetPublicKeyCommand } = getAwsKmsSdk();
      const result = await getAwsKmsClient().send(new GetPublicKeyCommand({
        KeyId: this.keyId,
      })) as { PublicKey?: Uint8Array | Buffer };

      if (!result.PublicKey) {
        throw new EnterpriseSigningError(
          'AWS KMS GetPublicKey returned empty key',
          this.options.kmsPublicKeyFailedCode,
          500,
        );
      }

      return crypto.createPublicKey({
        key: Buffer.from(result.PublicKey),
        format: 'der',
        type: 'spki',
      });
    } catch (error) {
      if (error instanceof EnterpriseSigningError) throw error;
      this.options.logger?.error?.('aws_kms_get_public_key_failed', { error: (error as Error).message });
      throw new EnterpriseSigningError(
        `AWS KMS GetPublicKey failed: ${(error as Error).message}`,
        this.options.kmsPublicKeyFailedCode,
        500,
      );
    }
  }

  private async signWithGCP(message: Buffer): Promise<Buffer> {
    const keyName = this.keyId.includes('cryptoKeyVersions')
      ? this.keyId
      : `${this.keyId}/cryptoKeyVersions/${this.keyVersion}`;
    const endpoint = `https://cloudkms.googleapis.com/v1/${keyName}:asymmetricSign`;
    const digest = crypto.createHash('sha256').update(message).digest();
    const response = await fetchWithKmsTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getGCPAccessToken()}`,
      },
      body: JSON.stringify({
        digest: {
          sha256: digest.toString('base64'),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await readKmsErrorPreview(response);
      this.options.logger?.error?.('gcp_kms_sign_failed', { status: response.status, error: errorText });
      throw new EnterpriseSigningError(
        `GCP KMS signing failed: ${response.status}`,
        this.options.kmsSignFailedCode,
        500,
      );
    }

    const result = await readKmsJsonResponse<{ signature: string }>(
      response,
      'GCP KMS signing',
      this.options.kmsSignFailedCode,
    );
    return Buffer.from(
      requireKmsStringField(
        result.signature,
        'signature',
        'GCP KMS signing',
        this.options.kmsSignFailedCode,
      ),
      'base64',
    );
  }

  private async getPublicKeyFromGCP(): Promise<crypto.KeyObject> {
    const keyName = this.keyId.includes('cryptoKeyVersions')
      ? this.keyId
      : `${this.keyId}/cryptoKeyVersions/${this.keyVersion}`;
    const endpoint = `https://cloudkms.googleapis.com/v1/${keyName}:getPublicKey`;
    const response = await fetchWithKmsTimeout(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.getGCPAccessToken()}`,
      },
    });

    if (!response.ok) {
      const errorText = await readKmsErrorPreview(response);
      this.options.logger?.error?.('gcp_kms_get_public_key_failed', { status: response.status, error: errorText });
      throw new EnterpriseSigningError(
        `GCP KMS GetPublicKey failed: ${response.status}`,
        this.options.kmsPublicKeyFailedCode,
        500,
      );
    }

    const result = await readKmsJsonResponse<{ pem: string }>(
      response,
      'GCP KMS public key',
      this.options.kmsPublicKeyFailedCode,
    );
    return crypto.createPublicKey(
      requireKmsStringField(
        result.pem,
        'pem',
        'GCP KMS public key',
        this.options.kmsPublicKeyFailedCode,
      ),
    );
  }

  private async getGCPAccessToken(): Promise<string> {
    const envToken = process.env[this.options.gcpAccessTokenEnvKey ?? 'GCP_ACCESS_TOKEN'];
    if (envToken) return envToken;

    try {
      const metadataResponse = await fetchWithKmsTimeout(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } },
      );
      if (metadataResponse.ok) {
        const tokenData = await readKmsJsonResponse<{ access_token: string }>(
          metadataResponse,
          'GCP metadata token',
          this.options.kmsAuthFailedCode,
        );
        return requireKmsStringField(
          tokenData.access_token,
          'access_token',
          'GCP metadata token',
          this.options.kmsAuthFailedCode,
        );
      }
    } catch {
      // fall through
    }

    throw new EnterpriseSigningError(
      'GCP access token unavailable. Set GCP_ACCESS_TOKEN or run on a GCP instance with workload identity.',
      this.options.kmsAuthFailedCode,
      500,
    );
  }

  private async signWithAzure(message: Buffer): Promise<Buffer> {
    const vaultName = process.env[this.options.azureKeyVaultNameEnvKey ?? 'AZURE_KEYVAULT_NAME'];
    const keyName = process.env[this.options.azureKeyNameEnvKey ?? 'AZURE_KEY_NAME'] || this.keyId;
    if (!vaultName) {
      throw new EnterpriseSigningError(
        'AZURE_KEYVAULT_NAME is required for Azure KMS.',
        this.options.kmsConfigMissingCode,
        500,
      );
    }

    const algorithm = process.env[this.options.azureAlgorithmEnvKey ?? 'AZURE_KMS_ALGORITHM'] || 'ES256';
    const digest = crypto.createHash('sha256').update(message).digest();
    const endpoint = `https://${vaultName}.vault.azure.net/keys/${keyName}/${this.keyVersion}/sign?api-version=7.4`;
    const response = await fetchWithKmsTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAzureAccessToken()}`,
      },
      body: JSON.stringify({
        alg: algorithm,
        value: digest.toString('base64url'),
      }),
    });

    if (!response.ok) {
      const errorText = await readKmsErrorPreview(response);
      this.options.logger?.error?.('azure_kms_sign_failed', { status: response.status, error: errorText });
      throw new EnterpriseSigningError(
        `Azure Key Vault signing failed: ${response.status}`,
        this.options.kmsSignFailedCode,
        500,
      );
    }

    const result = await readKmsJsonResponse<{ value: string }>(
      response,
      'Azure Key Vault signing',
      this.options.kmsSignFailedCode,
    );
    return normalizeAzureSignature(
      Buffer.from(
        requireKmsStringField(
          result.value,
          'value',
          'Azure Key Vault signing',
          this.options.kmsSignFailedCode,
        ),
        'base64url',
      ),
      algorithm,
    );
  }

  private async getPublicKeyFromAzure(): Promise<crypto.KeyObject> {
    const vaultName = process.env[this.options.azureKeyVaultNameEnvKey ?? 'AZURE_KEYVAULT_NAME'];
    const keyName = process.env[this.options.azureKeyNameEnvKey ?? 'AZURE_KEY_NAME'] || this.keyId;
    if (!vaultName) {
      throw new EnterpriseSigningError(
        'AZURE_KEYVAULT_NAME is required for Azure KMS.',
        this.options.kmsConfigMissingCode,
        500,
      );
    }
    const endpoint = `https://${vaultName}.vault.azure.net/keys/${keyName}/${this.keyVersion}?api-version=7.4`;
    const response = await fetchWithKmsTimeout(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.getAzureAccessToken()}`,
      },
    });

    if (!response.ok) {
      const errorText = await readKmsErrorPreview(response);
      this.options.logger?.error?.('azure_kms_get_key_failed', { status: response.status, error: errorText });
      throw new EnterpriseSigningError(
        `Azure Key Vault GetKey failed: ${response.status}`,
        this.options.kmsPublicKeyFailedCode,
        500,
      );
    }

    const result = await readKmsJsonResponse<{
      key: { x: string; y: string; crv: string; kty: string };
    }>(
      response,
      'Azure Key Vault public key',
      this.options.kmsPublicKeyFailedCode,
    );
    const key = requireKmsObjectField(
      result.key,
      'key',
      'Azure Key Vault public key',
      this.options.kmsPublicKeyFailedCode,
    );
    return crypto.createPublicKey({
      key: {
        kty: requireKmsStringField(
          key.kty,
          'key.kty',
          'Azure Key Vault public key',
          this.options.kmsPublicKeyFailedCode,
        ),
        crv: requireKmsStringField(
          key.crv,
          'key.crv',
          'Azure Key Vault public key',
          this.options.kmsPublicKeyFailedCode,
        ),
        x: requireKmsStringField(
          key.x,
          'key.x',
          'Azure Key Vault public key',
          this.options.kmsPublicKeyFailedCode,
        ),
        y: requireKmsStringField(
          key.y,
          'key.y',
          'Azure Key Vault public key',
          this.options.kmsPublicKeyFailedCode,
        ),
      },
      format: 'jwk',
    });
  }

  private async getAzureAccessToken(): Promise<string> {
    const envToken = process.env[this.options.azureAccessTokenEnvKey ?? 'AZURE_ACCESS_TOKEN'];
    if (envToken) return envToken;

    try {
      const imdsResponse = await fetchWithKmsTimeout(
        'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2019-08-01&resource=https://vault.azure.net',
        { headers: { Metadata: 'true' } },
      );
      if (imdsResponse.ok) {
        const tokenData = await readKmsJsonResponse<{ access_token: string }>(
          imdsResponse,
          'Azure managed identity token',
          this.options.kmsAuthFailedCode,
        );
        return requireKmsStringField(
          tokenData.access_token,
          'access_token',
          'Azure managed identity token',
          this.options.kmsAuthFailedCode,
        );
      }
    } catch {
      // fall through
    }

    throw new EnterpriseSigningError(
      'Azure access token unavailable. Set AZURE_ACCESS_TOKEN or run on an Azure instance with managed identity.',
      this.options.kmsAuthFailedCode,
      500,
    );
  }

  private signLocal(message: Buffer): Promise<Buffer> {
    const key = this.getLocalSigningKey();
    const signature = key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448'
      ? crypto.sign(null, message, key)
      : crypto.sign('sha256', message, getEnterpriseSigningKeyInput(keyAlgorithm(key), key));
    return Promise.resolve(signature);
  }

  private getLocalSigningKey(): crypto.KeyObject {
    if (this.localSigningKey) {
      return this.localSigningKey;
    }

    const rawKey = this.options.privateKey
      ?? (this.options.privateKeyEnvKey ? process.env[this.options.privateKeyEnvKey] : undefined);
    if (!rawKey) {
      throw new EnterpriseSigningError(
        this.options.signingUnavailableMessage,
        this.options.signingUnavailableCode,
        500,
      );
    }

    this.localSigningKey = parsePrivateKey(rawKey);
    return this.localSigningKey;
  }

  private getLocalPublicKey(): crypto.KeyObject {
    const rawPublicKey = this.options.publicKey
      ?? (this.options.publicKeyEnvKey ? process.env[this.options.publicKeyEnvKey] : undefined);
    if (rawPublicKey) {
      return parsePublicKey(rawPublicKey);
    }
    return crypto.createPublicKey(this.getLocalSigningKey());
  }

  private resolveAwsSigningAlgorithm(): AwsSigningAlgorithmSpec {
    const configured = this.options.awsSigningAlgorithm
      ?? (this.options.awsSigningAlgorithmEnvKey
        ? process.env[this.options.awsSigningAlgorithmEnvKey] as AwsSigningAlgorithmSpec | undefined
        : undefined)
      ?? 'ECDSA_SHA_256';
    if (
      configured === 'RSASSA_PKCS1_V1_5_SHA_256'
      || configured === 'RSASSA_PSS_SHA_256'
      || configured === 'ECDSA_SHA_256'
    ) {
      return configured;
    }

    throw new EnterpriseSigningError(
      `Unsupported AWS KMS signing algorithm: ${configured}`,
      this.options.kmsConfigMissingCode,
      500,
    );
  }
}
