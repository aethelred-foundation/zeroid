import crypto from 'crypto';
import * as net from 'net';
import { circuitArtifactDigestKeys } from './circuit-artifacts';

export interface ProductionSafetyViolation {
  control: string;
  risk: string;
}

const MIN_METRICS_TOKEN_LENGTH = 32;
const MIN_JWT_SECRET_LENGTH = 48;
const MIN_POLICY_RECEIPT_SECRET_LENGTH = 48;
const MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH = 48;
const MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH = 48;
const DEFAULT_DEVELOPMENT_CORS_ORIGINS = ['http://localhost:3000'];
const REQUIRED_SECRET_KEY_BYTES = 32;
const MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS = 24;
const SUPPORTED_OIDC_SIGNING_ALGORITHMS = new Set(['RS256', 'PS256']);
const PRODUCTION_KMS_PROVIDERS = new Set(['aws-kms', 'gcp-kms', 'azure-kms']);
const PRIVATE_HOSTNAME_SUFFIXES = [
  '.corp',
  '.home',
  '.internal',
  '.lan',
  '.local',
  '.localhost',
  '.test',
];
const SGX_MRSIGNER_PATTERN = /^[0-9a-f]{64}$/i;
const SGX_MRENCLAVE_PATTERN = /^[0-9a-f]{64}$/i;
const KNOWN_TEE_TCB_STATUSES = new Set([
  'UpToDate',
  'SWHardeningNeeded',
  'ConfigurationNeeded',
  'ConfigurationAndSWHardeningNeeded',
  'OutOfDate',
  'Revoked',
]);
const REJECTED_PRODUCTION_TEE_TCB_STATUSES = new Set([
  'OutOfDate',
  'Revoked',
]);
const KNOWN_UNSAFE_JWT_SECRETS = new Set([
  'change-me',
  'changeme',
  'dev',
  'development',
  'jwt-secret',
  'secret',
  'test',
  'test-secret',
  'test-secret-that-is-at-least-32-chars!!',
  'zeroid-secret',
]);

const UNSAFE_PRODUCTION_FLAGS: ProductionSafetyViolation[] = [
  {
    control: 'ALLOW_LOCAL_CREDENTIAL_SIGNING',
    risk: 'Bypasses KMS/HSM; signing keys may be loaded from local configuration',
  },
  {
    control: 'ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING',
    risk: 'Enables deprecated HMAC credential verification path',
  },
  {
    control: 'ALLOW_PUBLIC_OIDC_CLIENTS',
    risk: 'Allows OIDC clients without client_secret authentication',
  },
  {
    control: 'ALLOW_UNSAFE_TEE_ATTESTATION',
    risk: 'Disables DCAP quote verification; attestation cannot be trusted',
  },
  {
    control: 'REGULATORY_SUBMISSION_BUNDLE_ALLOW_LOCAL_SIGNING',
    risk: 'Allows local private-key signing for regulatory submission bundles in production',
  },
  {
    control: 'SANCTIONS_SCREENING_DISABLED',
    risk: 'Disables sanctions screening in production compliance workflows',
  },
];

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

function isTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

export function getMetricsAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.METRICS_AUTH_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function isMetricsEndpointDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrue(env.METRICS_PUBLIC_DISABLED);
}

export function isSanctionsScreeningDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrue(env.SANCTIONS_SCREENING_DISABLED);
}

export function isMetricsAccessConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isMetricsEndpointDisabled(env)) return true;
  if (!isProductionRuntime(env)) return true;
  const token = getMetricsAuthToken(env);
  return Boolean(token && token.length >= MIN_METRICS_TOKEN_LENGTH);
}

export function shouldRequireMetricsAuthorization(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getMetricsAuthToken(env));
}

export function isMetricsRequestAuthorized(
  authorizationHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const token = getMetricsAuthToken(env);
  if (!token) return !isProductionRuntime(env);

  const prefix = 'Bearer ';
  if (!authorizationHeader?.startsWith(prefix)) return false;

  const presented = authorizationHeader.slice(prefix.length);
  const expected = Buffer.from(token);
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function checkedProductionSafetyControls(): string[] {
  return [
    ...UNSAFE_PRODUCTION_FLAGS.map((flag) => flag.control),
    'REDIS_URL',
    'REDIS_TLS_REQUIRED',
    'JWT_SECRET',
    'TRUSTED_PROXY',
    'CORS_ORIGINS',
    'METRICS_PUBLIC_DISABLED_OR_METRICS_AUTH_TOKEN',
    'SANCTIONS_SCREENING_DISABLED_OR_SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
    'SANCTIONS_LIST_MAX_AGE_HOURS',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'POLICY_RECEIPT_SIGNING_SECRET',
    'ENTERPRISE_SECRET_HASH_PEPPER',
    'IDENTITY_RECOVERY_HASH_PEPPER',
    'OIDC_ISSUER_URL',
    'OIDC_SIGNING_KEYPAIR',
    'CREDENTIAL_SIGNING_KMS',
    'INTEL_PCS_API_KEY',
    'TRUSTED_MRSIGNERS',
    'TEE_ALLOWED_ENCLAVES_JSON',
    'MIN_ISV_SVN',
    'TEE_TCB_STATUS_POLICY',
    'SCHEMA_GOVERNANCE_THRESHOLDS',
    'ZK_CONTEXT_BOUND_CIRCUITS_READY',
    'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON',
  ];
}

export function getAllowedCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return [...new Set(configured)];
  }

  return [...DEFAULT_DEVELOPMENT_CORS_ORIGINS];
}

export function collectProductionSafetyViolations(
  env: NodeJS.ProcessEnv = process.env,
): ProductionSafetyViolation[] {
  if (!isProductionRuntime(env)) return [];

  const violations = UNSAFE_PRODUCTION_FLAGS
    .filter((flag) => isTrue(env[flag.control]))
    .map((flag) => ({ ...flag }));

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    violations.push({
      control: 'REDIS_URL',
      risk: 'Production Redis connection is missing; rate limiting and session state cannot be enforced reliably',
    });
  } else if (!isTrustedRedisUrl(redisUrl)) {
    violations.push({
      control: 'REDIS_URL',
      risk: 'Production Redis connection must use rediss:// TLS to protect session, OIDC, and rate-limit state',
    });
  }

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    violations.push({
      control: 'JWT_SECRET',
      risk: 'Production API JWT signing secret is missing',
    });
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    violations.push({
      control: 'JWT_SECRET',
      risk: `Production API JWT signing secret must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    });
  } else if (isKnownUnsafeJwtSecret(jwtSecret)) {
    violations.push({
      control: 'JWT_SECRET',
      risk: 'Production API JWT signing secret must not use a known development or test placeholder',
    });
  }

  validateTrustedProxyConfig(env, violations);

  const corsOrigins = getAllowedCorsOrigins(env);
  if (!env.CORS_ORIGINS?.trim()) {
    violations.push({
      control: 'CORS_ORIGINS',
      risk: 'Production CORS allowlist is missing and would fall back to localhost',
    });
  } else {
    const unsafeOrigin = corsOrigins.find(
      (origin) => !isTrustedCorsOrigin(origin),
    );
    if (unsafeOrigin) {
      violations.push({
        control: 'CORS_ORIGINS',
        risk: `Production CORS origin is not allowed: ${unsafeOrigin}`,
      });
    }
  }

  if (!isMetricsEndpointDisabled(env)) {
    const token = getMetricsAuthToken(env);
    if (!token) {
      violations.push({
        control: 'METRICS_AUTH_TOKEN',
        risk: 'Prometheus metrics are exposed without bearer-token protection',
      });
    } else if (token.length < MIN_METRICS_TOKEN_LENGTH) {
      violations.push({
        control: 'METRICS_AUTH_TOKEN',
        risk: `Metrics bearer token must be at least ${MIN_METRICS_TOKEN_LENGTH} characters`,
      });
    }
  }

  if (!isSanctionsScreeningDisabled(env)) {
    const trustedKeys = env.SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON?.trim();
    if (!trustedKeys) {
      violations.push({
        control: 'SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
        risk: 'Sanctions screening is enabled without trusted list-signing keys',
      });
    } else {
      try {
        const parsed = JSON.parse(trustedKeys) as Record<string, string>;
        if (
          !parsed ||
          Array.isArray(parsed) ||
          Object.keys(parsed).length === 0 ||
          Object.values(parsed).some((value) => typeof value !== 'string' || value.trim().length === 0)
        ) {
          violations.push({
            control: 'SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
            risk: 'Trusted sanctions list keys must be a non-empty key-id map',
          });
        }
      } catch {
        violations.push({
          control: 'SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
          risk: 'Trusted sanctions list keys must be valid JSON',
        });
      }
    }

    validateSanctionsListMaxAge(env, violations);
  }

  const webhookSecretKey = env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (!webhookSecretKey) {
    violations.push({
      control: 'WEBHOOK_SECRET_ENCRYPTION_KEY',
      risk: 'Webhook signing secrets would be stored without envelope encryption',
    });
  } else if (!isValidSecretEncryptionKey(webhookSecretKey)) {
    violations.push({
      control: 'WEBHOOK_SECRET_ENCRYPTION_KEY',
      risk: `Webhook secret encryption key must decode to ${REQUIRED_SECRET_KEY_BYTES} bytes`,
    });
  }

  const policyReceiptSecret = env.POLICY_RECEIPT_SIGNING_SECRET?.trim();
  if (!policyReceiptSecret) {
    violations.push({
      control: 'POLICY_RECEIPT_SIGNING_SECRET',
      risk: 'Production policy decision receipts require a dedicated signing secret',
    });
  } else if (policyReceiptSecret.length < MIN_POLICY_RECEIPT_SECRET_LENGTH) {
    violations.push({
      control: 'POLICY_RECEIPT_SIGNING_SECRET',
      risk: `Policy receipt signing secret must be at least ${MIN_POLICY_RECEIPT_SECRET_LENGTH} characters`,
    });
  } else if (isKnownUnsafeJwtSecret(policyReceiptSecret)) {
    violations.push({
      control: 'POLICY_RECEIPT_SIGNING_SECRET',
      risk: 'Policy receipt signing secret must not use a known development or test placeholder',
    });
  }

  const enterpriseSecretHashPepper = env.ENTERPRISE_SECRET_HASH_PEPPER?.trim();
  if (!enterpriseSecretHashPepper) {
    violations.push({
      control: 'ENTERPRISE_SECRET_HASH_PEPPER',
      risk: 'Production enterprise API keys and OAuth client secrets require a deployment pepper to resist offline verification after datastore disclosure',
    });
  } else if (
    enterpriseSecretHashPepper.length < MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH
  ) {
    violations.push({
      control: 'ENTERPRISE_SECRET_HASH_PEPPER',
      risk: `Enterprise secret hash pepper must be at least ${MIN_ENTERPRISE_SECRET_HASH_PEPPER_LENGTH} characters`,
    });
  } else if (isKnownUnsafeJwtSecret(enterpriseSecretHashPepper)) {
    violations.push({
      control: 'ENTERPRISE_SECRET_HASH_PEPPER',
      risk: 'Enterprise secret hash pepper must not use a known development or test placeholder',
    });
  }

  const recoveryHashPepper = env.IDENTITY_RECOVERY_HASH_PEPPER?.trim();
  if (!recoveryHashPepper) {
    violations.push({
      control: 'IDENTITY_RECOVERY_HASH_PEPPER',
      risk: 'Production identity recovery hashes require a deployment pepper to resist offline recovery-proof guessing after datastore disclosure',
    });
  } else if (
    recoveryHashPepper.length < MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH
  ) {
    violations.push({
      control: 'IDENTITY_RECOVERY_HASH_PEPPER',
      risk: `Identity recovery hash pepper must be at least ${MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH} characters`,
    });
  } else if (isKnownUnsafeJwtSecret(recoveryHashPepper)) {
    violations.push({
      control: 'IDENTITY_RECOVERY_HASH_PEPPER',
      risk: 'Identity recovery hash pepper must not use a known development or test placeholder',
    });
  }

  const oidcIssuerUrl = env.OIDC_ISSUER_URL?.trim();
  if (!oidcIssuerUrl) {
    violations.push({
      control: 'OIDC_ISSUER_URL',
      risk: 'Production OIDC issuer URL must be explicitly configured',
    });
  } else if (!isTrustedHttpsUrl(oidcIssuerUrl)) {
    violations.push({
      control: 'OIDC_ISSUER_URL',
      risk: 'Production OIDC issuer URL must use HTTPS and must not target localhost, private, or internal hosts',
    });
  }

  validateOidcSigningConfig(env, violations);
  validateCredentialSigningConfig(env, violations);
  validateTeeAttestationConfig(env, violations);
  validateSchemaGovernanceThresholds(env, violations);

  if (env.ZK_CONTEXT_BOUND_CIRCUITS_READY !== 'true') {
    violations.push({
      control: 'ZK_CONTEXT_BOUND_CIRCUITS_READY',
      risk: 'Production ZK verification requires audited circuits that expose claimsHash and contextCommitment as fixed public signals',
    });
  }
  validateCircuitArtifactDigestPolicy(env, violations);

  return violations;
}

function validateOidcSigningConfig(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const rawPrivateKey = env.OIDC_SIGNING_PRIVATE_KEY?.trim();
  const rawPublicKey = env.OIDC_SIGNING_PUBLIC_KEY?.trim();
  if (!rawPrivateKey || !rawPublicKey) {
    violations.push({
      control: 'OIDC_SIGNING_KEYPAIR',
      risk: 'OIDC token signing requires both OIDC_SIGNING_PRIVATE_KEY and OIDC_SIGNING_PUBLIC_KEY in production',
    });
    return;
  }

  const algorithm = env.OIDC_SIGNING_ALG?.trim() || 'RS256';
  if (!SUPPORTED_OIDC_SIGNING_ALGORITHMS.has(algorithm)) {
    violations.push({
      control: 'OIDC_SIGNING_ALG',
      risk: 'OIDC_SIGNING_ALG must be RS256 or PS256 in production',
    });
    return;
  }

  try {
    const privateKey = parseSigningPrivateKey(rawPrivateKey);
    const publicKey = parseSigningPublicKey(rawPublicKey);
    const derivedPublicKey = crypto.createPublicKey(privateKey);

    if (!publicKeyDerEquals(publicKey, derivedPublicKey)) {
      violations.push({
        control: 'OIDC_SIGNING_KEYPAIR',
        risk: 'OIDC_SIGNING_PUBLIC_KEY does not match OIDC_SIGNING_PRIVATE_KEY',
      });
      return;
    }

    if (!['rsa', 'rsa-pss'].includes(String(privateKey.asymmetricKeyType))) {
      violations.push({
        control: 'OIDC_SIGNING_KEYPAIR',
        risk: 'OIDC signing keys must be RSA keys for RS256/PS256',
      });
    }
  } catch (error) {
    violations.push({
      control: 'OIDC_SIGNING_KEYPAIR',
      risk: `OIDC signing key material is invalid: ${(error as Error).message}`,
    });
  }
}

function validateCredentialSigningConfig(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const provider = env.KMS_PROVIDER?.trim();
  const keyId = env.KMS_KEY_ID?.trim();

  if (!provider || !PRODUCTION_KMS_PROVIDERS.has(provider)) {
    violations.push({
      control: 'CREDENTIAL_SIGNING_KMS',
      risk: 'Production credential issuance must use aws-kms, gcp-kms, or azure-kms',
    });
    return;
  }

  if (!keyId) {
    violations.push({
      control: 'KMS_KEY_ID',
      risk: 'Production credential issuance requires KMS_KEY_ID for the configured KMS provider',
    });
  }
}

function validateTeeAttestationConfig(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const pcsApiKey = env.INTEL_PCS_API_KEY?.trim();
  if (!pcsApiKey) {
    violations.push({
      control: 'INTEL_PCS_API_KEY',
      risk: 'Production TEE attestation requires authenticated Intel PCS collateral access',
    });
  }

  const collateralProviderUrl =
    env.TEE_DCAP_API_URL?.trim() || env.INTEL_PCS_URL?.trim();
  if (
    collateralProviderUrl &&
    !isTrustedHttpsUrl(collateralProviderUrl)
  ) {
    violations.push({
      control: 'TEE_COLLATERAL_PROVIDER_URL',
      risk: 'Production TEE collateral provider URL must use HTTPS and must not target localhost, private, or internal hosts',
    });
  }

  const trustedMrsigners = parseCsv(env.TRUSTED_MRSIGNERS);
  if (trustedMrsigners.length === 0) {
    violations.push({
      control: 'TRUSTED_MRSIGNERS',
      risk: 'Production TEE attestation requires at least one trusted SGX MRSIGNER allowlist entry',
    });
  } else if (
    trustedMrsigners.some((mrsigner) => !SGX_MRSIGNER_PATTERN.test(mrsigner))
  ) {
    violations.push({
      control: 'TRUSTED_MRSIGNERS',
      risk: 'TRUSTED_MRSIGNERS entries must be 32-byte SGX signer hashes encoded as 64 hex characters',
    });
  }

  validateTrustedEnclavePolicy(env, violations);

  const minIsvSvn = env.MIN_ISV_SVN?.trim();
  if (!minIsvSvn) {
    violations.push({
      control: 'MIN_ISV_SVN',
      risk: 'Production TEE attestation requires an explicit minimum ISV SVN policy',
    });
  } else if (!/^[1-9]\d*$/.test(minIsvSvn)) {
    violations.push({
      control: 'MIN_ISV_SVN',
      risk: 'MIN_ISV_SVN must be a positive integer',
    });
  }

  validateTeeTcbStatusPolicy(
    'TEE_ALLOWED_TCB_STATUSES',
    parseCsv(env.TEE_ALLOWED_TCB_STATUSES || 'UpToDate'),
    violations,
  );
  validateTeeTcbStatusPolicy(
    'TEE_ALLOWED_QE_TCB_STATUSES',
    parseCsv(
      env.TEE_ALLOWED_QE_TCB_STATUSES ||
        env.TEE_ALLOWED_TCB_STATUSES ||
        'UpToDate',
    ),
    violations,
  );
}

function validateTrustedEnclavePolicy(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const rawPolicy = env.TEE_ALLOWED_ENCLAVES_JSON?.trim();
  if (!rawPolicy) {
    violations.push({
      control: 'TEE_ALLOWED_ENCLAVES_JSON',
      risk: 'Production TEE attestation requires exact MRENCLAVE, isvProdId, and minIsvSvn allowlist policy',
    });
    return;
  }

  try {
    const parsed = JSON.parse(rawPolicy) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      violations.push({
        control: 'TEE_ALLOWED_ENCLAVES_JSON',
        risk: 'TEE_ALLOWED_ENCLAVES_JSON must be a non-empty JSON array',
      });
      return;
    }

    const invalidEntry = parsed.find((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return true;
      }
      const policy = entry as Record<string, unknown>;
      return (
        typeof policy.mrenclave !== 'string' ||
        !SGX_MRENCLAVE_PATTERN.test(policy.mrenclave) ||
        !Number.isInteger(policy.isvProdId) ||
        (policy.isvProdId as number) < 0 ||
        (policy.isvProdId as number) > 0xffff ||
        !Number.isInteger(policy.minIsvSvn) ||
        (policy.minIsvSvn as number) < 1 ||
        (
          policy.mrsigner !== undefined &&
          (
            typeof policy.mrsigner !== 'string' ||
            !SGX_MRSIGNER_PATTERN.test(policy.mrsigner)
          )
        )
      );
    });

    if (invalidEntry) {
      violations.push({
        control: 'TEE_ALLOWED_ENCLAVES_JSON',
        risk: 'TEE enclave policy entries must include 64-hex mrenclave, uint16 isvProdId, positive minIsvSvn, and optional 64-hex mrsigner',
      });
    }
  } catch {
    violations.push({
      control: 'TEE_ALLOWED_ENCLAVES_JSON',
      risk: 'TEE_ALLOWED_ENCLAVES_JSON must be valid JSON',
    });
  }
}

function validateCircuitArtifactDigestPolicy(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const rawDigests = env.ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON?.trim();
  if (!rawDigests) {
    violations.push({
      control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON',
      risk: 'Production ZK verification requires a pinned SHA-256 digest manifest for circuit source and artifacts',
    });
    return;
  }

  try {
    const parsed = JSON.parse(rawDigests) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      violations.push({
        control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON',
        risk: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON must be a JSON object',
      });
      return;
    }

    const digestManifest = parsed as Record<string, unknown>;
    const missingKey = circuitArtifactDigestKeys().find(
      (key) => typeof digestManifest[key] !== 'string',
    );
    const invalidDigest = Object.entries(digestManifest).find(
      ([, value]) => typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value),
    );

    if (missingKey || invalidDigest) {
      violations.push({
        control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON',
        risk: 'ZK circuit digest manifest must include every required source/artifact key with 64-hex SHA-256 digests',
      });
    }
  } catch {
    violations.push({
      control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON',
      risk: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON must be valid JSON',
    });
  }
}

function validateTeeTcbStatusPolicy(
  control: string,
  statuses: string[],
  violations: ProductionSafetyViolation[],
): void {
  const unknownStatus = statuses.find(
    (status) => !KNOWN_TEE_TCB_STATUSES.has(status),
  );
  if (unknownStatus) {
    violations.push({
      control,
      risk: `Production TEE TCB policy contains an unknown status: ${unknownStatus}`,
    });
    return;
  }

  const rejectedStatus = statuses.find((status) =>
    REJECTED_PRODUCTION_TEE_TCB_STATUSES.has(status),
  );
  if (rejectedStatus) {
    violations.push({
      control,
      risk: `Production TEE TCB policy must not allow ${rejectedStatus} attestations`,
    });
  }
}

function validateSchemaGovernanceThresholds(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  validateMinimumThreshold(
    env.SCHEMA_APPROVAL_THRESHOLD,
    'SCHEMA_APPROVAL_THRESHOLD',
    'Production schema approval requires an explicit multi-party approval threshold',
    violations,
  );
  validateMinimumThreshold(
    env.SCHEMA_REJECTION_THRESHOLD,
    'SCHEMA_REJECTION_THRESHOLD',
    'Production schema rejection requires an explicit multi-party rejection threshold',
    violations,
  );
}

function validateMinimumThreshold(
  rawValue: string | undefined,
  control: string,
  missingRisk: string,
  violations: ProductionSafetyViolation[],
): void {
  const value = rawValue?.trim();
  if (!value) {
    violations.push({
      control,
      risk: missingRisk,
    });
    return;
  }

  if (!/^[2-9]\d*$/.test(value)) {
    violations.push({
      control,
      risk: `${control} must be an integer greater than or equal to 2`,
    });
  }
}

function validateSanctionsListMaxAge(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const value = env.SANCTIONS_LIST_MAX_AGE_HOURS?.trim() || '24';
  const hours = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    hours > MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS
  ) {
    violations.push({
      control: 'SANCTIONS_LIST_MAX_AGE_HOURS',
      risk: `SANCTIONS_LIST_MAX_AGE_HOURS must be an integer from 1 to ${MAX_PRODUCTION_SANCTIONS_LIST_AGE_HOURS}`,
    });
  }
}

function validateTrustedProxyConfig(
  env: NodeJS.ProcessEnv,
  violations: ProductionSafetyViolation[],
): void {
  const trustedProxy = env.TRUSTED_PROXY?.trim();
  if (!trustedProxy) return;

  const entries = parseCsv(trustedProxy);
  const unsafeEntry = entries.find((entry) =>
    entry === '*' ||
    entry === '0.0.0.0/0' ||
    entry === '::/0' ||
    entry.includes('/'),
  );
  if (unsafeEntry) {
    violations.push({
      control: 'TRUSTED_PROXY',
      risk: `TRUSTED_PROXY must list exact proxy peer addresses; unsafe entry: ${unsafeEntry}`,
    });
  }
}

function normalizeKeyMaterial(raw: string): string {
  return raw.trim().replace(/\\n/g, '\n');
}

function parseSigningPrivateKey(raw: string): crypto.KeyObject {
  const normalized = normalizeKeyMaterial(raw);
  if (normalized.includes('BEGIN PRIVATE KEY')) {
    return crypto.createPrivateKey(normalized);
  }

  return crypto.createPrivateKey({
    key: Buffer.from(normalized.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function parseSigningPublicKey(raw: string): crypto.KeyObject {
  const normalized = normalizeKeyMaterial(raw);
  if (normalized.includes('BEGIN PUBLIC KEY')) {
    return crypto.createPublicKey(normalized);
  }

  return crypto.createPublicKey({
    key: Buffer.from(normalized.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function publicKeyDerEquals(
  left: crypto.KeyObject,
  right: crypto.KeyObject,
): boolean {
  const leftDer = left.export({ format: 'der', type: 'spki' });
  const rightDer = right.export({ format: 'der', type: 'spki' });
  return (
    leftDer.length === rightDer.length &&
    crypto.timingSafeEqual(leftDer, rightDer)
  );
}

function isValidSecretEncryptionKey(value: string): boolean {
  return decodeSecretEncryptionKey(value)?.length === REQUIRED_SECRET_KEY_BYTES;
}

function isKnownUnsafeJwtSecret(value: string): boolean {
  return KNOWN_UNSAFE_JWT_SECRETS.has(value.trim().toLowerCase());
}

function decodeSecretEncryptionKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

function isTrustedRedisUrl(
  value: string,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'rediss:') return false;
    const hostname = url.hostname.toLowerCase();
    return !isLocalHostname(hostname);
  } catch {
    return false;
  }
}

function isTrustedHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return !isLocalHostname(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isTrustedCorsOrigin(value: string): boolean {
  if (value === '*') return false;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;
    return !isLocalHostname(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalized);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = extractIpv4MappedAddress(normalized);
    if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4);

    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return (
    !normalized.includes('.') ||
    PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isPrivateIpv4Address(value: string): boolean {
  const octets = value.split('.').map(Number);
  const first = octets[0];
  const second = octets[1];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function extractIpv4MappedAddress(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;

  const high = parseInt(hexadecimal[1], 16);
  const low = parseInt(hexadecimal[2], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const violations = collectProductionSafetyViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `Production startup blocked: ${violations.length} unsafe control(s) detected: ` +
    `${violations.map((violation) => violation.control).join(', ')}. ` +
    'Fix production safety controls before deploying.',
  );
}
