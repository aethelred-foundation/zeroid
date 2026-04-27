import crypto from 'crypto';
import {
  EnterpriseKeySigner,
  computeEnterprisePublicKeyFingerprint,
  exportEnterprisePublicKeyPem,
  getEnterpriseVerificationKeyInput,
  type EnterpriseKmsProvider,
  type EnterpriseSigningAlgorithm,
} from './enterprise-key-signer';

export type RegulatorySubmissionSigningScope = 'organization_authority' | 'authority' | 'jurisdiction' | 'global';
export type RegulatorySubmissionSigningAlgorithm = 'hmac-sha256' | 'RS256' | 'PS256' | 'ES256' | 'EdDSA';

export type RegulatorySubmissionScopeInput = {
  organizationId: string;
  authority?: string;
  filingJurisdiction: string;
};

export type RegulatorySubmissionDetachedSignature = {
  algorithm: RegulatorySubmissionSigningAlgorithm;
  signedAt: string;
  keyId: string;
  scope: RegulatorySubmissionSigningScope;
  encoding: 'base64url';
  keyVersion?: string;
  verificationMethod?: string;
  publicKeyFingerprint?: string;
  publicKeyPem?: string;
  token: string;
};

export type RegulatorySubmissionSignatureVerificationResult = {
  signatureValid: boolean;
  signingScopeMatched: boolean;
  verificationKeyMatched: boolean;
  signingAlgorithm?: RegulatorySubmissionSigningAlgorithm;
  signingKeyId?: string;
  signingScope?: RegulatorySubmissionSigningScope;
  signingKeyVersion?: string;
  signingVerificationMethod?: string;
  issues: string[];
};

type AsymmetricBundleAlgorithm = Exclude<RegulatorySubmissionSigningAlgorithm, 'hmac-sha256'>;

type RegulatorySubmissionSigningContext =
  | {
    mode: 'hmac';
    algorithm: 'hmac-sha256';
    keyId: string;
    scope: RegulatorySubmissionSigningScope;
    secret: string;
  }
  | {
    mode: 'enterprise-signer';
    algorithm: AsymmetricBundleAlgorithm;
    keyId: string;
    scope: RegulatorySubmissionSigningScope;
    keyVersion: string;
    verificationMethod: string;
    signer: EnterpriseKeySigner;
    publicKey: crypto.KeyObject;
    publicKeyFingerprint: string;
    publicKeyPem: string;
  };

type RegulatorySubmissionEnvCandidate = {
  scope: RegulatorySubmissionSigningScope;
  defaultKeyId: string;
  secretEnvKey: string;
  privateKeyEnvKey: string;
  publicKeyEnvKey: string;
  algorithmEnvKey: string;
  keyIdEnvKey: string;
  keyVersionEnvKey: string;
  verificationMethodEnvKey: string;
  kmsProviderEnvKey: string;
  kmsKeyIdEnvKey: string;
  awsKmsKeyIdEnvKey: string;
  awsKmsAlgorithmEnvKey: string;
  gcpAccessTokenEnvKey: string;
  azureAccessTokenEnvKey: string;
  azureKeyVaultNameEnvKey: string;
  azureKeyNameEnvKey: string;
  azureAlgorithmEnvKey: string;
};

const DEV_REGULATORY_SUBMISSION_SIGNING_KEYPAIR = crypto.generateKeyPairSync('ed25519');
const DEV_REGULATORY_SUBMISSION_PRIVATE_KEY_PEM = DEV_REGULATORY_SUBMISSION_SIGNING_KEYPAIR.privateKey
  .export({ format: 'pem', type: 'pkcs8' })
  .toString();
const DEV_REGULATORY_SUBMISSION_PUBLIC_KEY_PEM = DEV_REGULATORY_SUBMISSION_SIGNING_KEYPAIR.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString();

function sanitizeSigningSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildDefaultBundleKeyId(
  scope: RegulatorySubmissionSigningScope,
  organizationId: string,
  authoritySegment: string,
  jurisdictionSegment: string,
): string {
  switch (scope) {
    case 'organization_authority':
      return `org:${organizationId}:authority:${authoritySegment.toLowerCase()}`;
    case 'authority':
      return `authority:${authoritySegment.toLowerCase()}`;
    case 'jurisdiction':
      return `jurisdiction:${jurisdictionSegment.toLowerCase()}`;
    case 'global':
    default:
      return 'global:default';
  }
}

function buildDefaultBundleVerificationMethod(keyId: string): string {
  const sanitizedKeyId = keyId.replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `urn:zeroid:regulatory-submission:${sanitizedKeyId}`;
}

function validateConfiguredAlgorithm(
  configuredAlgorithm: string | undefined,
  resolvedAlgorithm: EnterpriseSigningAlgorithm,
): AsymmetricBundleAlgorithm {
  if (!configuredAlgorithm) {
    return resolvedAlgorithm;
  }
  if (
    configuredAlgorithm !== 'RS256'
    && configuredAlgorithm !== 'PS256'
    && configuredAlgorithm !== 'ES256'
    && configuredAlgorithm !== 'EdDSA'
  ) {
    throw new Error(`Unsupported regulatory submission signing algorithm: ${configuredAlgorithm}`);
  }
  if (configuredAlgorithm !== resolvedAlgorithm) {
    throw new Error(
      `Configured regulatory submission signing algorithm ${configuredAlgorithm} does not match resolved key algorithm ${resolvedAlgorithm}`,
    );
  }
  return configuredAlgorithm;
}

function resolveKmsProvider(candidate: RegulatorySubmissionEnvCandidate): EnterpriseKmsProvider | null {
  const configuredProvider = process.env[candidate.kmsProviderEnvKey]?.trim() as EnterpriseKmsProvider | undefined;
  const scopedKmsKeyId = process.env[candidate.kmsKeyIdEnvKey]?.trim();
  const awsKmsKeyId = process.env[candidate.awsKmsKeyIdEnvKey]?.trim();
  if (configuredProvider) {
    if (
      configuredProvider !== 'aws-kms'
      && configuredProvider !== 'gcp-kms'
      && configuredProvider !== 'azure-kms'
      && configuredProvider !== 'local'
    ) {
      throw new Error(`Unsupported regulatory submission KMS provider: ${configuredProvider}`);
    }
    return configuredProvider;
  }
  if (scopedKmsKeyId || awsKmsKeyId) {
    return 'aws-kms';
  }
  return null;
}

function buildEnvCandidates(input: RegulatorySubmissionScopeInput): RegulatorySubmissionEnvCandidate[] {
  const authoritySegment = input.authority ? sanitizeSigningSegment(input.authority) : '';
  const jurisdictionSegment = sanitizeSigningSegment(input.filingJurisdiction);
  const organizationSegment = sanitizeSigningSegment(input.organizationId);

  return [
    ...(authoritySegment.length > 0 ? [{
      scope: 'organization_authority' as const,
      defaultKeyId: buildDefaultBundleKeyId('organization_authority', input.organizationId, authoritySegment, jurisdictionSegment),
      secretEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      privateKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      publicKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      algorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      keyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      keyVersionEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      verificationMethodEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      kmsProviderEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_PROVIDER__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      kmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_KEY_ID__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      awsKmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_KEY_ID__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      awsKmsAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_ALGORITHM__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      gcpAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_GCP_ACCESS_TOKEN__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      azureAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_ACCESS_TOKEN__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      azureKeyVaultNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEYVAULT_NAME__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      azureKeyNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEY_NAME__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
      azureAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KMS_ALGORITHM__ORG__${organizationSegment}__AUTHORITY__${authoritySegment}`,
    }] : []),
    ...(authoritySegment.length > 0 ? [{
      scope: 'authority' as const,
      defaultKeyId: buildDefaultBundleKeyId('authority', input.organizationId, authoritySegment, jurisdictionSegment),
      secretEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET__AUTHORITY__${authoritySegment}`,
      privateKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY__AUTHORITY__${authoritySegment}`,
      publicKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY__AUTHORITY__${authoritySegment}`,
      algorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM__AUTHORITY__${authoritySegment}`,
      keyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID__AUTHORITY__${authoritySegment}`,
      keyVersionEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION__AUTHORITY__${authoritySegment}`,
      verificationMethodEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD__AUTHORITY__${authoritySegment}`,
      kmsProviderEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_PROVIDER__AUTHORITY__${authoritySegment}`,
      kmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_KEY_ID__AUTHORITY__${authoritySegment}`,
      awsKmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_KEY_ID__AUTHORITY__${authoritySegment}`,
      awsKmsAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_ALGORITHM__AUTHORITY__${authoritySegment}`,
      gcpAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_GCP_ACCESS_TOKEN__AUTHORITY__${authoritySegment}`,
      azureAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_ACCESS_TOKEN__AUTHORITY__${authoritySegment}`,
      azureKeyVaultNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEYVAULT_NAME__AUTHORITY__${authoritySegment}`,
      azureKeyNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEY_NAME__AUTHORITY__${authoritySegment}`,
      azureAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KMS_ALGORITHM__AUTHORITY__${authoritySegment}`,
    }] : []),
    {
      scope: 'jurisdiction',
      defaultKeyId: buildDefaultBundleKeyId('jurisdiction', input.organizationId, authoritySegment, jurisdictionSegment),
      secretEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET__JURISDICTION__${jurisdictionSegment}`,
      privateKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY__JURISDICTION__${jurisdictionSegment}`,
      publicKeyEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY__JURISDICTION__${jurisdictionSegment}`,
      algorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM__JURISDICTION__${jurisdictionSegment}`,
      keyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID__JURISDICTION__${jurisdictionSegment}`,
      keyVersionEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION__JURISDICTION__${jurisdictionSegment}`,
      verificationMethodEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD__JURISDICTION__${jurisdictionSegment}`,
      kmsProviderEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_PROVIDER__JURISDICTION__${jurisdictionSegment}`,
      kmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_KEY_ID__JURISDICTION__${jurisdictionSegment}`,
      awsKmsKeyIdEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_KEY_ID__JURISDICTION__${jurisdictionSegment}`,
      awsKmsAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_ALGORITHM__JURISDICTION__${jurisdictionSegment}`,
      gcpAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_GCP_ACCESS_TOKEN__JURISDICTION__${jurisdictionSegment}`,
      azureAccessTokenEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_ACCESS_TOKEN__JURISDICTION__${jurisdictionSegment}`,
      azureKeyVaultNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEYVAULT_NAME__JURISDICTION__${jurisdictionSegment}`,
      azureKeyNameEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEY_NAME__JURISDICTION__${jurisdictionSegment}`,
      azureAlgorithmEnvKey: `REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KMS_ALGORITHM__JURISDICTION__${jurisdictionSegment}`,
    },
    {
      scope: 'global',
      defaultKeyId: buildDefaultBundleKeyId('global', input.organizationId, authoritySegment, jurisdictionSegment),
      secretEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET',
      privateKeyEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY',
      publicKeyEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY',
      algorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM',
      keyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID',
      keyVersionEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION',
      verificationMethodEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD',
      kmsProviderEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_PROVIDER',
      kmsKeyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_KEY_ID',
      awsKmsKeyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_KEY_ID',
      awsKmsAlgorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_ALGORITHM',
      gcpAccessTokenEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_GCP_ACCESS_TOKEN',
      azureAccessTokenEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_ACCESS_TOKEN',
      azureKeyVaultNameEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEYVAULT_NAME',
      azureKeyNameEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEY_NAME',
      azureAlgorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KMS_ALGORITHM',
    },
  ];
}

async function buildEnterpriseSigningContext(
  candidate: RegulatorySubmissionEnvCandidate,
  keyId: string,
  provider: EnterpriseKmsProvider,
  options?: {
    privateKey?: string;
    publicKey?: string;
    kmsKeyId?: string;
    keyVersion?: string;
    allowLocalSigning?: boolean;
  },
): Promise<Extract<RegulatorySubmissionSigningContext, { mode: 'enterprise-signer' }>> {
  const signer = new EnterpriseKeySigner({
    provider,
    keyId: options?.kmsKeyId ?? keyId,
    keyVersion: options?.keyVersion
      ?? process.env[candidate.keyVersionEnvKey]?.trim()
      ?? (provider === 'local' ? '1' : 'kms'),
    privateKey: options?.privateKey,
    publicKey: options?.publicKey,
    defaultVerificationMethod: buildDefaultBundleVerificationMethod(keyId),
    verificationMethod: process.env[candidate.verificationMethodEnvKey]?.trim(),
    allowLocalSigning: options?.allowLocalSigning ?? process.env.NODE_ENV !== 'production',
    signingUnavailableMessage: 'Regulatory submission bundle signing private key is not configured.',
    signingUnavailableCode: 'REG_SUBMISSION_SIGNING_UNAVAILABLE',
    kmsConfigMissingCode: 'REG_SUBMISSION_KMS_CONFIG_MISSING',
    kmsUnsupportedProviderCode: 'REG_SUBMISSION_KMS_UNSUPPORTED_PROVIDER',
    kmsSignFailedCode: 'REG_SUBMISSION_KMS_SIGN_FAILED',
    kmsPublicKeyFailedCode: 'REG_SUBMISSION_KMS_PUBKEY_FAILED',
    kmsAuthFailedCode: 'REG_SUBMISSION_KMS_AUTH_FAILED',
    localSigningBlockedMessage: 'Local regulatory submission bundle signing is blocked in production. Configure KMS-backed signing.',
    localSigningBlockedCode: 'REG_SUBMISSION_LOCAL_SIGNING_BLOCKED',
    awsSigningAlgorithmEnvKey: candidate.awsKmsAlgorithmEnvKey,
    gcpAccessTokenEnvKey: candidate.gcpAccessTokenEnvKey,
    azureAccessTokenEnvKey: candidate.azureAccessTokenEnvKey,
    azureKeyVaultNameEnvKey: candidate.azureKeyVaultNameEnvKey,
    azureKeyNameEnvKey: candidate.azureKeyNameEnvKey,
    azureAlgorithmEnvKey: candidate.azureAlgorithmEnvKey,
  });
  const publicKey = await signer.getPublicKey();
  const resolvedAlgorithm = await signer.getSigningAlgorithm();
  return {
    mode: 'enterprise-signer',
    algorithm: validateConfiguredAlgorithm(process.env[candidate.algorithmEnvKey]?.trim(), resolvedAlgorithm),
    keyId,
    scope: candidate.scope,
    keyVersion: signer.getKeyVersion(),
    verificationMethod: signer.getVerificationMethod(),
    signer,
    publicKey,
    publicKeyFingerprint: computeEnterprisePublicKeyFingerprint(publicKey),
    publicKeyPem: exportEnterprisePublicKeyPem(publicKey),
  };
}

async function resolveRegulatorySubmissionSigningContext(
  input: RegulatorySubmissionScopeInput,
): Promise<RegulatorySubmissionSigningContext> {
  for (const candidate of buildEnvCandidates(input)) {
    const keyId = process.env[candidate.keyIdEnvKey]?.trim() || candidate.defaultKeyId;
    const rawPrivateKey = process.env[candidate.privateKeyEnvKey];
    if (rawPrivateKey && rawPrivateKey.trim().length > 0) {
      return buildEnterpriseSigningContext(candidate, keyId, 'local', {
        privateKey: rawPrivateKey,
        publicKey: process.env[candidate.publicKeyEnvKey],
        allowLocalSigning: process.env.NODE_ENV !== 'production',
      });
    }

    const provider = resolveKmsProvider(candidate);
    if (provider && provider !== 'local') {
      return buildEnterpriseSigningContext(candidate, keyId, provider, {
        kmsKeyId: process.env[candidate.kmsKeyIdEnvKey]?.trim()
          || process.env[candidate.awsKmsKeyIdEnvKey]?.trim()
          || keyId,
      });
    }

    const secret = process.env[candidate.secretEnvKey];
    if (secret && secret.length >= 16) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('HMAC regulatory submission bundle signing is blocked in production. Configure asymmetric signing material.');
      }
      return {
        mode: 'hmac',
        algorithm: 'hmac-sha256',
        keyId,
        scope: candidate.scope,
        secret,
      };
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const authoritySegment = input.authority ? sanitizeSigningSegment(input.authority) : '';
    const jurisdictionSegment = sanitizeSigningSegment(input.filingJurisdiction);
    const fallbackScope: RegulatorySubmissionSigningScope = authoritySegment.length > 0
      ? 'organization_authority'
      : 'jurisdiction';
    const fallbackKeyId = buildDefaultBundleKeyId(
      fallbackScope,
      input.organizationId,
      authoritySegment,
      jurisdictionSegment,
    );
    const fallbackCandidate: RegulatorySubmissionEnvCandidate = {
      scope: fallbackScope,
      defaultKeyId: fallbackKeyId,
      secretEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_SECRET',
      privateKeyEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_PRIVATE_KEY',
      publicKeyEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_PUBLIC_KEY',
      algorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_ALGORITHM',
      keyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_ID',
      keyVersionEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KEY_VERSION',
      verificationMethodEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_VERIFICATION_METHOD',
      kmsProviderEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_PROVIDER',
      kmsKeyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_KMS_KEY_ID',
      awsKmsKeyIdEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_KEY_ID',
      awsKmsAlgorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AWS_KMS_ALGORITHM',
      gcpAccessTokenEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_GCP_ACCESS_TOKEN',
      azureAccessTokenEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_ACCESS_TOKEN',
      azureKeyVaultNameEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEYVAULT_NAME',
      azureKeyNameEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KEY_NAME',
      azureAlgorithmEnvKey: 'REGULATORY_SUBMISSION_BUNDLE_SIGNING_AZURE_KMS_ALGORITHM',
    };
    return buildEnterpriseSigningContext(fallbackCandidate, fallbackKeyId, 'local', {
      privateKey: DEV_REGULATORY_SUBMISSION_PRIVATE_KEY_PEM,
      publicKey: DEV_REGULATORY_SUBMISSION_PUBLIC_KEY_PEM,
      keyVersion: 'dev-ed25519-1',
      allowLocalSigning: true,
    });
  }

  throw new Error('Scoped regulatory submission bundle asymmetric signing key must be configured in production');
}

async function computeSignatureToken(
  digest: string,
  signedAt: string,
  signingContext: RegulatorySubmissionSigningContext,
): Promise<string> {
  if (signingContext.mode === 'hmac') {
    return crypto.createHmac('sha256', signingContext.secret).update(`${digest}:${signedAt}`).digest('base64url');
  }

  const payload = Buffer.from(`${digest}:${signedAt}`);
  return (await signingContext.signer.sign(payload)).toString('base64url');
}

async function verifySignatureToken(
  digest: string,
  signedAt: string,
  token: string,
  signingContext: RegulatorySubmissionSigningContext,
): Promise<boolean> {
  if (signingContext.mode === 'hmac') {
    const expected = Buffer.from(await computeSignatureToken(digest, signedAt, signingContext), 'base64url');
    const actual = Buffer.from(token, 'base64url');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  const payload = Buffer.from(`${digest}:${signedAt}`);
  const signature = Buffer.from(token, 'base64url');
  if (signingContext.algorithm === 'EdDSA') {
    return crypto.verify(null, payload, signingContext.publicKey, signature);
  }
  return crypto.verify(
    'sha256',
    payload,
    getEnterpriseVerificationKeyInput(signingContext.algorithm, signingContext.publicKey),
    signature,
  );
}

export async function createRegulatorySubmissionBundleSignature(
  digest: string,
  input: RegulatorySubmissionScopeInput,
): Promise<RegulatorySubmissionDetachedSignature> {
  const signingContext = await resolveRegulatorySubmissionSigningContext(input);
  const signedAt = new Date().toISOString();
  const token = await computeSignatureToken(digest, signedAt, signingContext);

  return {
    algorithm: signingContext.algorithm,
    signedAt,
    keyId: signingContext.keyId,
    scope: signingContext.scope,
    encoding: 'base64url',
    ...(signingContext.mode !== 'hmac'
      ? {
        keyVersion: signingContext.keyVersion,
        verificationMethod: signingContext.verificationMethod,
        publicKeyFingerprint: signingContext.publicKeyFingerprint,
        publicKeyPem: signingContext.publicKeyPem,
      }
      : {}),
    token,
  };
}

export async function verifyRegulatorySubmissionBundleSignature(
  digest: string,
  signature: unknown,
  input: RegulatorySubmissionScopeInput,
): Promise<RegulatorySubmissionSignatureVerificationResult> {
  const issues: string[] = [];
  const record = (signature && typeof signature === 'object' && !Array.isArray(signature))
    ? signature as Record<string, unknown>
    : {};

  if (
    record.algorithm !== 'hmac-sha256'
    && record.algorithm !== 'RS256'
    && record.algorithm !== 'PS256'
    && record.algorithm !== 'ES256'
    && record.algorithm !== 'EdDSA'
  ) {
    issues.push('unsupported bundleSignature.algorithm');
  }
  if (typeof record.signedAt !== 'string' || record.signedAt.length === 0) {
    issues.push('bundleSignature.signedAt missing');
  }

  let signingScopeMatched = false;
  let verificationKeyMatched = false;
  let signatureValid = false;

  try {
    const signingContext = await resolveRegulatorySubmissionSigningContext(input);
    signingScopeMatched = (
      record.keyId === signingContext.keyId
      && record.scope === signingContext.scope
      && record.algorithm === signingContext.algorithm
      && (signingContext.mode === 'hmac'
        || (
          record.keyVersion === signingContext.keyVersion
          && record.verificationMethod === signingContext.verificationMethod
        ))
    );
    if (!signingScopeMatched) {
      issues.push('bundleSignature signing scope does not match resolved signing context');
    }

    verificationKeyMatched = signingContext.mode === 'hmac'
      ? record.publicKeyFingerprint === undefined && record.publicKeyPem === undefined
      : record.publicKeyFingerprint === signingContext.publicKeyFingerprint
        && record.publicKeyPem === signingContext.publicKeyPem;
    if (!verificationKeyMatched) {
      issues.push('bundleSignature verification key material does not match resolved signing context');
    }

    if (
      typeof record.signedAt === 'string'
      && typeof record.token === 'string'
      && digest.length === 64
    ) {
      signatureValid = await verifySignatureToken(digest, record.signedAt, record.token, signingContext);
      if (!signatureValid) {
        issues.push('bundleSignature token verification failed');
      }
    }
  } catch (error) {
    issues.push((error as Error).message);
  }

  return {
    signatureValid,
    signingScopeMatched,
    verificationKeyMatched,
    issues,
    ...(record.algorithm === 'hmac-sha256'
      || record.algorithm === 'RS256'
      || record.algorithm === 'PS256'
      || record.algorithm === 'ES256'
      || record.algorithm === 'EdDSA'
      ? { signingAlgorithm: record.algorithm as RegulatorySubmissionSignatureVerificationResult['signingAlgorithm'] }
      : {}),
    ...(typeof record.keyId === 'string' && record.keyId.length > 0
      ? { signingKeyId: record.keyId }
      : {}),
    ...(record.scope === 'organization_authority'
      || record.scope === 'authority'
      || record.scope === 'jurisdiction'
      || record.scope === 'global'
      ? { signingScope: record.scope as RegulatorySubmissionSignatureVerificationResult['signingScope'] }
      : {}),
    ...(typeof record.keyVersion === 'string' && record.keyVersion.length > 0
      ? { signingKeyVersion: record.keyVersion }
      : {}),
    ...(typeof record.verificationMethod === 'string' && record.verificationMethod.length > 0
      ? { signingVerificationMethod: record.verificationMethod }
      : {}),
  };
}
