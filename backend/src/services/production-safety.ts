import crypto from 'crypto';

export interface ProductionSafetyViolation {
  control: string;
  risk: string;
}

const MIN_METRICS_TOKEN_LENGTH = 32;
const MIN_JWT_SECRET_LENGTH = 48;
const MIN_POLICY_RECEIPT_SECRET_LENGTH = 48;
const DEFAULT_DEVELOPMENT_CORS_ORIGINS = ['http://localhost:3000'];
const REQUIRED_SECRET_KEY_BYTES = 32;
const SUPPORTED_OIDC_SIGNING_ALGORITHMS = new Set(['RS256', 'PS256']);
const PRODUCTION_KMS_PROVIDERS = new Set(['aws-kms', 'gcp-kms', 'azure-kms']);
const SGX_MRSIGNER_PATTERN = /^[0-9a-f]{64}$/i;
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
    'JWT_SECRET',
    'CORS_ORIGINS',
    'METRICS_PUBLIC_DISABLED_OR_METRICS_AUTH_TOKEN',
    'SANCTIONS_SCREENING_DISABLED_OR_SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'POLICY_RECEIPT_SIGNING_SECRET',
    'OIDC_ISSUER_URL',
    'OIDC_SIGNING_KEYPAIR',
    'CREDENTIAL_SIGNING_KMS',
    'INTEL_PCS_API_KEY',
    'TRUSTED_MRSIGNERS',
    'MIN_ISV_SVN',
    'TEE_TCB_STATUS_POLICY',
    'SCHEMA_GOVERNANCE_THRESHOLDS',
    'ZK_CONTEXT_BOUND_CIRCUITS_READY',
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
      risk: 'Production Redis connection must use a non-local redis:// or rediss:// endpoint',
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

  const oidcIssuerUrl = env.OIDC_ISSUER_URL?.trim();
  if (!oidcIssuerUrl) {
    violations.push({
      control: 'OIDC_ISSUER_URL',
      risk: 'Production OIDC issuer URL must be explicitly configured',
    });
  } else if (!isTrustedHttpsUrl(oidcIssuerUrl)) {
    violations.push({
      control: 'OIDC_ISSUER_URL',
      risk: 'Production OIDC issuer URL must use HTTPS and must not target localhost',
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
      risk: 'Production TEE collateral provider URL must use HTTPS and must not target localhost',
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

function isTrustedRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return false;
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

  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized.endsWith('.localhost')
  );
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
