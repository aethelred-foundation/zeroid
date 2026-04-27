import crypto from 'crypto';

export interface ProductionSafetyViolation {
  control: string;
  risk: string;
}

const MIN_METRICS_TOKEN_LENGTH = 32;
const DEFAULT_DEVELOPMENT_CORS_ORIGINS = ['http://localhost:3000'];

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
    'CORS_ORIGINS',
    'METRICS_PUBLIC_DISABLED_OR_METRICS_AUTH_TOKEN',
    'SANCTIONS_SCREENING_DISABLED_OR_SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON',
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

  return violations;
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

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const violations = collectProductionSafetyViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `Production startup blocked: ${violations.length} unsafe control(s) detected: ` +
    `${violations.map((violation) => violation.control).join(', ')}. ` +
    'Fix production safety controls before deploying.',
  );
}
