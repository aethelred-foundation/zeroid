import {
  collectProductionSafetyViolations,
  isProductionRuntime,
  isMetricsAccessConfigured,
  isMetricsEndpointDisabled,
  isMetricsRequestAuthorized,
  validateProductionConfig,
} from '../src/services/production-safety';
import { circuitArtifactDigestKeys } from '../src/services/circuit-artifacts';
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
const apiJwtKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const apiJwtPrivateKey = apiJwtKeyPair.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;
const apiJwtPublicKey = apiJwtKeyPair.publicKey.export({
  type: 'spki',
  format: 'pem',
}) as string;

const oid4vciKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const oid4vciIssuerJwk = oid4vciKeyPair.privateKey.export({ format: 'jwk' });
const oid4vciIssuerPublicJwk = oid4vciKeyPair.publicKey.export({ format: 'jwk' });

const BASE_ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
const circuitDigestManifest = Object.fromEntries(
  circuitArtifactDigestKeys().map((key, index) => [
    key,
    (index + 1).toString(16).repeat(64).slice(0, 64),
  ]),
);
const PROD_BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://redis.zeroid.example:6380',
  TRUSTED_PROXY: '10.0.0.10',
  API_JWT_SIGNING_PRIVATE_KEY: apiJwtPrivateKey,
  API_JWT_VERIFICATION_PUBLIC_KEY: apiJwtPublicKey,
  API_JWT_ALGORITHM: 'RS256',
  API_JWT_KEY_ID: 'api-jwt-key-1',
  CORS_ORIGINS: 'https://app.zeroid.example,https://admin.zeroid.example',
  SANCTIONS_SCREENING_DISABLED: 'false',
  SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON: JSON.stringify({
    sovereign_list_signer: '-----BEGIN PUBLIC KEY-----trusted-sanctions-list-key-----END PUBLIC KEY-----',
  }),
  SANCTIONS_LIST_MAX_AGE_HOURS: '24',
  SANCTIONS_SCREENING_STORE_FILE: '/var/lib/zeroid/sanctions-screening/state.json',
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  POLICY_RECEIPT_SIGNING_SECRET: 'r'.repeat(64),
  REGULATORY_REPORT_STORE_DIR: '/var/lib/zeroid/regulatory-reports',
  DATA_SOVEREIGNTY_STORE_FILE: '/var/lib/zeroid/data-sovereignty/state.json',
  SLA_MONITOR_STORE_FILE: '/var/lib/zeroid/sla-monitor/state.json',
  ENTERPRISE_SECRET_HASH_PEPPER: 'e'.repeat(64),
  IDENTITY_RECOVERY_HASH_PEPPER: 'i'.repeat(64),
  GOVERNMENT_CACHE_HASH_PEPPER: 'g'.repeat(64),
  OIDC_ISSUER_URL: 'https://id.zeroid.example/enterprise/oidc',
  OIDC_SIGNING_PRIVATE_KEY: oidcPrivateKey,
  OIDC_SIGNING_PUBLIC_KEY: oidcPublicKey,
  KMS_PROVIDER: 'aws-kms',
  KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/zeroid-credential-signer',
  INTEL_PCS_API_KEY: 'pcs_' + 'p'.repeat(40),
  TRUSTED_MRSIGNERS: 'a'.repeat(64),
  TEE_ALLOWED_ENCLAVES_JSON: JSON.stringify([
    {
      mrenclave: 'b'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 1,
      minIsvSvn: 1,
    },
  ]),
  MIN_ISV_SVN: '1',
  SCHEMA_APPROVAL_THRESHOLD: '3',
  SCHEMA_REJECTION_THRESHOLD: '3',
  ZK_CONTEXT_BOUND_CIRCUITS_READY: 'true',
  ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON: JSON.stringify(circuitDigestManifest),
  OID4VCI_ISSUER_JWK: JSON.stringify(oid4vciIssuerJwk),
};

describe('production safety controls', () => {
  it('allows development and test metrics without a token', () => {
    expect(collectProductionSafetyViolations(BASE_ENV)).toEqual([]);
    expect(isMetricsAccessConfigured(BASE_ENV)).toBe(true);
    expect(isMetricsRequestAuthorized(undefined, BASE_ENV)).toBe(true);
  });

  it('treats explicit ZeroID production runtime as production even when NODE_ENV is not set', () => {
    expect(isProductionRuntime({ ZEROID_ENV: 'production' })).toBe(true);
    expect(collectProductionSafetyViolations({ ZEROID_ENV: 'production' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: 'REDIS_URL' }),
        expect.objectContaining({ control: 'API_JWT_ASYMMETRIC_KEYS' }),
      ]),
    );
  });

  it('flags conflicting Node and ZeroID production runtime markers', () => {
    expect(
      collectProductionSafetyViolations({
        ...PROD_BASE_ENV,
        NODE_ENV: 'test',
        ZEROID_ENV: 'production',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          control: 'NODE_ENV_ZEROID_ENV_CONSISTENCY',
        }),
      ]),
    );

    expect(
      collectProductionSafetyViolations({
        ...PROD_BASE_ENV,
        NODE_ENV: 'production',
        ZEROID_ENV: 'staging',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          control: 'NODE_ENV_ZEROID_ENV_CONSISTENCY',
        }),
      ]),
    );
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

  it('requires TLS Redis for production state without plaintext overrides', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      REDIS_URL: 'redis://redis.zeroid.example:6379',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'REDIS_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      REDIS_URL: 'redis://redis.zeroid.example:6379',
      ALLOW_PLAINTEXT_REDIS_IN_PRODUCTION: 'true',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'REDIS_URL' }),
    ]);
  });

  it('requires asymmetric API JWT signing keys in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_SIGNING_PRIVATE_KEY: '',
      API_JWT_VERIFICATION_PUBLIC_KEY: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_ASYMMETRIC_KEYS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_VERIFICATION_PUBLIC_KEY: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_ASYMMETRIC_KEYS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_ALGORITHM: 'HS256',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_ALGORITHM' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_KEY_ID: 'short',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_KEY_ID' }),
    ]);
  });

  it('requires API JWT key material to import and pass a sign-verify canary', () => {
    const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPublicKey = otherKeyPair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_VERIFICATION_PUBLIC_KEY: otherPublicKey,
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_KEYPAIR_CANARY' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      API_JWT_SIGNING_PRIVATE_KEY: 'not-a-private-key',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'API_JWT_KEYPAIR_CANARY' }),
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

  it('rejects wildcard trusted proxy configuration in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      TRUSTED_PROXY: '',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'TRUSTED_PROXY' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      TRUSTED_PROXY: '',
      DIRECT_CLIENT_IP_MODE: 'true',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      TRUSTED_PROXY: '*',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'TRUSTED_PROXY' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      TRUSTED_PROXY: '10.0.0.0/8',
      METRICS_PUBLIC_DISABLED: 'true',
    })).toEqual([
      expect.objectContaining({ control: 'TRUSTED_PROXY' }),
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

  it('caps sanctions list freshness windows in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_LIST_MAX_AGE_HOURS: '168',
    })).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_LIST_MAX_AGE_HOURS' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_LIST_MAX_AGE_HOURS: 'not-a-number',
    })).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_LIST_MAX_AGE_HOURS' }),
    ]);
  });

  it('requires durable sanctions screening storage in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SANCTIONS_SCREENING_STORE_FILE: '',
    })).toEqual([
      expect.objectContaining({ control: 'SANCTIONS_SCREENING_STORE_FILE' }),
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

  it('requires durable regulatory report storage in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      REGULATORY_REPORT_STORE_DIR: '',
    })).toEqual([
      expect.objectContaining({ control: 'REGULATORY_REPORT_STORE_DIR' }),
    ]);
  });

  it('requires durable data-sovereignty storage in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      DATA_SOVEREIGNTY_STORE_FILE: '',
    })).toEqual([
      expect.objectContaining({ control: 'DATA_SOVEREIGNTY_STORE_FILE' }),
    ]);
  });

  it('requires durable SLA monitor storage in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      SLA_MONITOR_STORE_FILE: '',
    })).toEqual([
      expect.objectContaining({ control: 'SLA_MONITOR_STORE_FILE' }),
    ]);
  });

  it('requires a strong enterprise secret hash pepper in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ENTERPRISE_SECRET_HASH_PEPPER: '',
    })).toEqual([
      expect.objectContaining({ control: 'ENTERPRISE_SECRET_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ENTERPRISE_SECRET_HASH_PEPPER: 'short-pepper',
    })).toEqual([
      expect.objectContaining({ control: 'ENTERPRISE_SECRET_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ENTERPRISE_SECRET_HASH_PEPPER: 'change-me',
    })).toEqual([
      expect.objectContaining({ control: 'ENTERPRISE_SECRET_HASH_PEPPER' }),
    ]);
  });

  it('requires a strong identity recovery hash pepper in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      IDENTITY_RECOVERY_HASH_PEPPER: '',
    })).toEqual([
      expect.objectContaining({ control: 'IDENTITY_RECOVERY_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      IDENTITY_RECOVERY_HASH_PEPPER: 'short-pepper',
    })).toEqual([
      expect.objectContaining({ control: 'IDENTITY_RECOVERY_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      IDENTITY_RECOVERY_HASH_PEPPER: 'change-me',
    })).toEqual([
      expect.objectContaining({ control: 'IDENTITY_RECOVERY_HASH_PEPPER' }),
    ]);
  });

  it('requires a strong government cache hash pepper in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      GOVERNMENT_CACHE_HASH_PEPPER: '',
    })).toEqual([
      expect.objectContaining({ control: 'GOVERNMENT_CACHE_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      GOVERNMENT_CACHE_HASH_PEPPER: 'short-pepper',
    })).toEqual([
      expect.objectContaining({ control: 'GOVERNMENT_CACHE_HASH_PEPPER' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      GOVERNMENT_CACHE_HASH_PEPPER: 'change-me',
    })).toEqual([
      expect.objectContaining({ control: 'GOVERNMENT_CACHE_HASH_PEPPER' }),
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

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: 'https://10.0.0.5/enterprise/oidc',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_ISSUER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: 'https://100.64.0.5/enterprise/oidc',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_ISSUER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: 'https://metadata.google.internal/enterprise/oidc',
    })).toEqual([
      expect.objectContaining({ control: 'OIDC_ISSUER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      OIDC_ISSUER_URL: 'https://user:pass@id.zeroid.example/enterprise/oidc',
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

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_DCAP_API_URL: 'https://10.0.0.5',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_COLLATERAL_PROVIDER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_DCAP_API_URL: 'https://100.64.0.5',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_COLLATERAL_PROVIDER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_DCAP_API_URL: 'https://metadata.google.internal',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_COLLATERAL_PROVIDER_URL' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_DCAP_API_URL: 'https://[::ffff:0a00:0005]',
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

  it('requires exact TEE enclave allowlist policy in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_ALLOWED_ENCLAVES_JSON: '',
    })).toEqual([
      expect.objectContaining({ control: 'TEE_ALLOWED_ENCLAVES_JSON' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_ALLOWED_ENCLAVES_JSON: JSON.stringify([
        { mrenclave: 'not-hex', isvProdId: 1, minIsvSvn: 1 },
      ]),
    })).toEqual([
      expect.objectContaining({ control: 'TEE_ALLOWED_ENCLAVES_JSON' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      TEE_ALLOWED_ENCLAVES_JSON: JSON.stringify([
        { mrenclave: 'b'.repeat(64), isvProdId: 70000, minIsvSvn: 1 },
      ]),
    })).toEqual([
      expect.objectContaining({ control: 'TEE_ALLOWED_ENCLAVES_JSON' }),
    ]);
  });

  it('requires pinned ZK circuit artifact digests in production', () => {
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON: '',
    })).toEqual([
      expect.objectContaining({ control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON' }),
    ]);

    const missingDigestManifest = { ...circuitDigestManifest };
    delete missingDigestManifest[circuitArtifactDigestKeys()[0]];
    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON: JSON.stringify(missingDigestManifest),
    })).toEqual([
      expect.objectContaining({ control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON' }),
    ]);

    expect(collectProductionSafetyViolations({
      ...PROD_BASE_ENV,
      METRICS_PUBLIC_DISABLED: 'true',
      ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON: JSON.stringify({
        ...circuitDigestManifest,
        [circuitArtifactDigestKeys()[0]]: 'not-a-digest',
      }),
    })).toEqual([
      expect.objectContaining({ control: 'ZK_CIRCUIT_ARTIFACT_DIGESTS_JSON' }),
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

describe('OpenID4VCI / OpenID4VP production controls', () => {
  const cleanProdEnv: NodeJS.ProcessEnv = {
    ...PROD_BASE_ENV,
    METRICS_PUBLIC_DISABLED: 'true',
  };

  it('blocks production startup when OID4VCI_ISSUER_JWK is missing (ephemeral-key fail-open)', () => {
    const { OID4VCI_ISSUER_JWK: _omit, ...withoutKey } = cleanProdEnv;
    expect(collectProductionSafetyViolations(withoutKey)).toEqual([
      expect.objectContaining({ control: 'OID4VCI_ISSUER_JWK' }),
    ]);
  });

  it('rejects a malformed OID4VCI_ISSUER_JWK', () => {
    expect(
      collectProductionSafetyViolations({ ...cleanProdEnv, OID4VCI_ISSUER_JWK: 'not-json' }),
    ).toEqual([expect.objectContaining({ control: 'OID4VCI_ISSUER_JWK' })]);
  });

  it('rejects a public-only OID4VCI_ISSUER_JWK (no private component)', () => {
    expect(
      collectProductionSafetyViolations({
        ...cleanProdEnv,
        OID4VCI_ISSUER_JWK: JSON.stringify(oid4vciIssuerPublicJwk),
      }),
    ).toEqual([expect.objectContaining({ control: 'OID4VCI_ISSUER_JWK' })]);
  });

  it('accepts a valid private OID4VCI_ISSUER_JWK (no violations)', () => {
    expect(collectProductionSafetyViolations(cleanProdEnv)).toEqual([]);
  });

  it('flags OID4VP_ISSUER_JWKS only when set but malformed (absence is fail-closed by design)', () => {
    expect(
      collectProductionSafetyViolations({ ...cleanProdEnv, OID4VP_ISSUER_JWKS: '{broken' }),
    ).toEqual([expect.objectContaining({ control: 'OID4VP_ISSUER_JWKS' })]);
    expect(collectProductionSafetyViolations(cleanProdEnv)).toEqual([]);
  });
});
