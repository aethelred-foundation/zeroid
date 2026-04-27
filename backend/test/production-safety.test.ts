import {
  collectProductionSafetyViolations,
  isMetricsAccessConfigured,
  isMetricsEndpointDisabled,
  isMetricsRequestAuthorized,
  validateProductionConfig,
} from '../src/services/production-safety';
import crypto from 'crypto';

const oidcKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const oidcPrivateKey = oidcKeyPair.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;
const oidcPublicKey = oidcKeyPair.publicKey.export({
  type: 'spki',
  format: 'pem',
}) as string;

const BASE_ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
const PROD_BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://redis.zeroid.example:6380',
  JWT_SECRET: 'j'.repeat(64),
  CORS_ORIGINS: 'https://app.zeroid.example,https://admin.zeroid.example',
  SANCTIONS_SCREENING_DISABLED: 'false',
  SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON: JSON.stringify({
    sovereign_list_signer: '-----BEGIN PUBLIC KEY-----trusted-sanctions-list-key-----END PUBLIC KEY-----',
  }),
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  POLICY_RECEIPT_SIGNING_SECRET: 'r'.repeat(64),
  OIDC_ISSUER_URL: 'https://id.zeroid.example/enterprise/oidc',
  OIDC_SIGNING_PRIVATE_KEY: oidcPrivateKey,
  OIDC_SIGNING_PUBLIC_KEY: oidcPublicKey,
  KMS_PROVIDER: 'aws-kms',
  KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/zeroid-credential-signer',
  INTEL_PCS_API_KEY: 'pcs_' + 'p'.repeat(40),
  TRUSTED_MRSIGNERS: 'a'.repeat(64),
  MIN_ISV_SVN: '1',
  SCHEMA_APPROVAL_THRESHOLD: '3',
  SCHEMA_REJECTION_THRESHOLD: '3',
  ZK_CONTEXT_BOUND_CIRCUITS_READY: 'true',
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

  it('requires a strong JWT signing secret in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      JWT_SECRET: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'JWT_SECRET' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      JWT_SECRET: 'short-secret',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'JWT_SECRET' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      JWT_SECRET: 'test-secret-that-is-at-least-32-chars!!',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'JWT_SECRET' }),
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
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ALLOW_UNSAFE_TEE_ATTESTATION: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'ALLOW_UNSAFE_TEE_ATTESTATION' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      REGULATORY_SUBMISSION_BUNDLE_ALLOW_LOCAL_SIGNING: 'true',
    })).toEqual([
      expect.objectContaining({
        control: 'REGULATORY_SUBMISSION_BUNDLE_ALLOW_LOCAL_SIGNING',
      }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_SCREENING_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_SCREENING_DISABLED' }),
    ]);
  });

  it('requires trusted sanctions list keys when screening is enabled in production', () => {
    const env = {
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_SCREENING_DISABLED: 'false',
      SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON: '',
    };

    expect(collectProductionSafetyViolations(env)).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON' }),
    ]);
  });

  it('requires an envelope key for webhook signing secrets in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      WEBHOOK_SECRET_ENCRYPTION_KEY: '',
    })).toEqual([
      expect.objectContaining({ control: 'WEBHOOK_SECRET_ENCRYPTION_KEY' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
    })).toEqual([
      expect.objectContaining({ control: 'WEBHOOK_SECRET_ENCRYPTION_KEY' }),
    ]);
  });

  it('requires a dedicated policy receipt signing secret in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      POLICY_RECEIPT_SIGNING_SECRET: '',
    })).toEqual([
      expect.objectContaining({ control: 'POLICY_RECEIPT_SIGNING_SECRET' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      POLICY_RECEIPT_SIGNING_SECRET: 'short-receipt-secret',
    })).toEqual([
      expect.objectContaining({ control: 'POLICY_RECEIPT_SIGNING_SECRET' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      POLICY_RECEIPT_SIGNING_SECRET: 'change-me',
    })).toEqual([
      expect.objectContaining({ control: 'POLICY_RECEIPT_SIGNING_SECRET' }),
    ]);
  });

  it('requires valid OIDC signing key material in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_SIGNING_PRIVATE_KEY: '',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_SIGNING_KEYPAIR' }),
    ]);

    const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_SIGNING_PUBLIC_KEY: otherKeyPair.publicKey.export({
        type: 'spki',
        format: 'pem',
      }) as string,
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_SIGNING_KEYPAIR' }),
    ]);
  });

  it('requires an explicit trusted OIDC issuer URL in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: '',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_ISSUER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: 'http://localhost:4000/enterprise/oidc',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_ISSUER_URL' }),
    ]);
  });

  it('requires KMS-backed credential signing in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      KMS_PROVIDER: 'local',
    })).toEqual([
      expect.objectContaining({ control: 'CREDENTIAL_SIGNING_KMS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      KMS_KEY_ID: '',
    })).toEqual([
      expect.objectContaining({ control: 'KMS_KEY_ID' }),
    ]);
  });

  it('requires authenticated TEE collateral access in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      INTEL_PCS_API_KEY: '',
    })).toEqual([
      expect.objectContaining({ control: 'INTEL_PCS_API_KEY' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_DCAP_API_URL: 'http://localhost:8081',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_COLLATERAL_PROVIDER_URL' }),
    ]);
  });

  it('requires explicit trusted TEE signer and ISV SVN policies in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TRUSTED_MRSIGNERS: '',
    })).toEqual([
      expect.objectContaining({ control: 'TRUSTED_MRSIGNERS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TRUSTED_MRSIGNERS: 'not-a-signer',
    })).toEqual([
      expect.objectContaining({ control: 'TRUSTED_MRSIGNERS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      MIN_ISV_SVN: '',
    })).toEqual([
      expect.objectContaining({ control: 'MIN_ISV_SVN' }),
    ]);
  });

  it('rejects unsafe TEE TCB status policies in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_ALLOWED_TCB_STATUSES: 'UpToDate,Revoked',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_ALLOWED_TCB_STATUSES' }),
      expect.objectContaining({ control: 'TEE_ALLOWED_QE_TCB_STATUSES' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_ALLOWED_QE_TCB_STATUSES: 'DefinitelyNotAStatus',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_ALLOWED_QE_TCB_STATUSES' }),
    ]);
  });

  it('requires multi-party schema governance thresholds in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SCHEMA_APPROVAL_THRESHOLD: '',
    })).toEqual([
      expect.objectContaining({ control: 'SCHEMA_APPROVAL_THRESHOLD' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SCHEMA_APPROVAL_THRESHOLD: '1',
    })).toEqual([
      expect.objectContaining({ control: 'SCHEMA_APPROVAL_THRESHOLD' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SCHEMA_REJECTION_THRESHOLD: 'not-a-number',
    })).toEqual([
      expect.objectContaining({ control: 'SCHEMA_REJECTION_THRESHOLD' }),
    ]);
  });

  it('requires explicit context-bound ZK circuit readiness in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ZK_CONTEXT_BOUND_CIRCUITS_READY: '',
    })).toEqual([
      expect.objectContaining({ control: 'ZK_CONTEXT_BOUND_CIRCUITS_READY' }),
    ]);
  });
});
