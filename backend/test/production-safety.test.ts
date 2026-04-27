import {
  collectProductionSafetyViolations,
  isMetricsAccessConfigured,
  isMetricsEndpointDisabled,
  isMetricsRequestAuthorized,
  validateProductionConfig,
} from '../src/services/production-safety';

const BASE_ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
const PROD_BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://redis.zeroid.example:6380',
  CORS_ORIGINS: 'https://app.zeroid.example,https://admin.zeroid.example',
  SANCTIONS_SCREENING_DISABLED: 'true',
};

describe('production safety controls', () => {
  it('allows development and test metrics without a token', () => {
    expect(collectProductionSafetyViolations(BASE_ENV)).toEqual([]);
    expect(isMetricsAccessConfigured(BASE_ENV)).toBe(true);
    expect(isMetricsRequestAuthorized(undefined, BASE_ENV)).toBe(true);
  });

  it('blocks production startup when Redis is missing or local', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      REDIS_URL: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'REDIS_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      REDIS_URL: 'redis://localhost:6379',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'REDIS_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      REDIS_URL: 'redis://[::1]:6379',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'REDIS_URL' }),
    ]);
  });

  it('blocks production startup when CORS origins are missing or unsafe', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      CORS_ORIGINS: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'CORS_ORIGINS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      CORS_ORIGINS: 'https://app.zeroid.example,http://localhost:3000',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'CORS_ORIGINS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      CORS_ORIGINS: 'https://app.zeroid.example,https://[::1]:3000',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'CORS_ORIGINS' }),
    ]);
  });

  it('blocks production metrics when neither disabled nor token protected', () => {
    const env = { ...PROD_BASE_ENV };

    const violations = collectProductionSafetyViolations(env);

    expect(violations).toEqual([
      expect.objectContaining({ control: 'METRICS_AUTH_TOKEN' }),
    ]);
    expect(() => validateProductionConfig(env)).toThrow(/METRICS_AUTH_TOKEN/);
    expect(isMetricsAccessConfigured(env)).toBe(false);
    expect(isMetricsRequestAuthorized(undefined, env)).toBe(false);
  });

  it('accepts a strong production metrics bearer token', () => {
    const token = 'm'.repeat(40);
    const env = { ...PROD_BASE_ENV, METRICS_AUTH_TOKEN: token };

    expect(collectProductionSafetyViolations(env)).toEqual([]);
    expect(isMetricsAccessConfigured(env)).toBe(true);
    expect(isMetricsRequestAuthorized(`Bearer ${token}`, env)).toBe(true);
    expect(isMetricsRequestAuthorized('Bearer wrong-token', env)).toBe(false);
  });

  it('allows production deployments to fully disable public metrics', () => {
    const env = { ...PROD_BASE_ENV, METRICS_PUBLIC_DISABLED: 'true' };

    expect(collectProductionSafetyViolations(env)).toEqual([]);
    expect(isMetricsEndpointDisabled(env)).toBe(true);
    expect(isMetricsAccessConfigured(env)).toBe(true);
  });

  it('keeps unsafe production overrides in the startup block list', () => {
    const env = {
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ALLOW_UNSAFE_TEE_ATTESTATION: 'true',
    };

    expect(collectProductionSafetyViolations(env)).toEqual([
      expect.objectContaining({ control: 'ALLOW_UNSAFE_TEE_ATTESTATION' }),
    ]);
  });

  it('requires trusted sanctions list keys when screening is enabled in production', () => {
    const env = {
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_SCREENING_DISABLED: 'false',
    };

    expect(collectProductionSafetyViolations(env)).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON' }),
    ]);
  });
});
