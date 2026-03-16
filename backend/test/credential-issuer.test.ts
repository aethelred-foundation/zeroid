/**
 * CRED-01: Issuer-scoped credential verification hardening test suite
 *
 * Tests that credentials are bound to their issuer DID and that legacy
 * verification fallbacks are blocked in production.
 */
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Generate a fresh EC P-256 key pair for each test run
// ---------------------------------------------------------------------------
const testKeyPair = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Set up env vars BEFORE any module import
process.env.CREDENTIAL_SIGNING_PRIVATE_KEY = testKeyPair.privateKey;
process.env.CREDENTIAL_SIGNING_PUBLIC_KEY = testKeyPair.publicKey;
process.env.KMS_PROVIDER = 'local';
process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';

// ---------------------------------------------------------------------------
// Mock ../src/index exports (prisma, redis, logger, metricsRegistry)
// ---------------------------------------------------------------------------
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockIdentityFindUnique = jest.fn();

jest.mock('../src/index', () => {
  const { Registry, Counter } = require('prom-client');
  const registry = new Registry();
  return {
    logger: mockLogger,
    redis: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    },
    prisma: {
      identity: {
        findUnique: mockIdentityFindUnique,
      },
      credential: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({
          id: 'cred-test-id',
          ...args.data,
          issuedAt: new Date(),
        })),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      schemaGovernance: { findUnique: jest.fn().mockResolvedValue(null) },
      revocationRegistry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    },
    metricsRegistry: registry,
    credentialIssuedCounter: new Counter({
      name: 'zeroid_test_credentials_issued_total',
      help: 'test counter',
      registers: [registry],
    }),
  };
});

import { CredentialService } from '../src/services/credential';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hash claims the same way CredentialService does internally. */
async function hashClaims(claims: Record<string, unknown>): Promise<string> {
  const canonical = canonicalize(claims);
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]));
  return '{' + entries.join(',') + '}';
}

/** Sign issuerDid:claimsHash with the test private key (mirrors signCredentialForIssuer). */
function signForIssuer(issuerDid: string, claimsHash: string): string {
  const message = crypto.createHash('sha256')
    .update(`${issuerDid}:${claimsHash}`)
    .digest();
  const privateKey = crypto.createPrivateKey(testKeyPair.privateKey);
  const signature = crypto.sign('sha256', message, privateKey);
  return signature.toString('base64url');
}

/** Sign with just the raw claimsHash (legacy platform-scoped, no issuer binding). */
function signLegacyPlatformScoped(claimsHash: string): string {
  const message = Buffer.from(claimsHash, 'hex');
  const privateKey = crypto.createPrivateKey(testKeyPair.privateKey);
  const signature = crypto.sign('sha256', message, privateKey);
  return signature.toString('base64url');
}

/** Create an HMAC legacy signature. */
function signLegacyHMAC(claimsHash: string, issuerId: string, secret: string): string {
  const signingKey = crypto.createHmac('sha256', secret)
    .update(`zeroid:issuer-key:${issuerId}`)
    .digest();
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(claimsHash);
  return hmac.digest('base64');
}

function buildProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'JsonWebSignature2020',
    created: new Date().toISOString(),
    verificationMethod: 'did:aethelred:zeroid:credential-signer#key-1',
    proofPurpose: 'assertionMethod',
    keyVersion: '1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('CRED-01: Issuer-scoped credential verification', () => {
  let service: CredentialService;

  const ISSUER_DID_A = 'did:aethelred:issuer:alpha';
  const ISSUER_DID_B = 'did:aethelred:issuer:beta';
  const ISSUER_ID = 'issuer-001';
  const CLAIMS = { name: 'Alice', level: 'gold' };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: identity lookup returns matching DID with per-issuer key material
    mockIdentityFindUnique.mockResolvedValue({
      id: ISSUER_ID,
      did: ISSUER_DID_A,
      publicKey: testKeyPair.publicKey,
      keyVersion: '1',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:zeroid:credential-signer#key-1',
      status: 'ACTIVE',
    });

    // Reset NODE_ENV to test
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING;

    service = new CredentialService();
  });

  afterAll(() => {
    process.env.NODE_ENV = 'test';
  });

  // -------------------------------------------------------------------------
  // 1. Issuer-scoped verification succeeds
  // -------------------------------------------------------------------------
  it('should verify a credential signed with matching issuerDid binding', async () => {
    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    const proof = buildProof({
      issuerDid: ISSUER_DID_A,
      signatureValue,
    });

    const result = await (service as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Issuer DID mismatch rejected
  // -------------------------------------------------------------------------
  it('should reject when proof issuerDid does not match credential issuer DID', async () => {
    const claimsHash = await hashClaims(CLAIMS);
    // Sign with DID A
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    const proof = buildProof({
      issuerDid: ISSUER_DID_A,
      signatureValue,
    });

    // But the identity lookup returns DID B
    mockIdentityFindUnique.mockResolvedValue({
      id: ISSUER_ID,
      did: ISSUER_DID_B,
      publicKey: testKeyPair.publicKey,
      keyVersion: '1',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:zeroid:credential-signer#key-1',
      status: 'ACTIVE',
    });

    const result = await (service as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'credential_issuer_did_mismatch',
      expect.objectContaining({
        proofIssuerDid: ISSUER_DID_A,
        credentialIssuerId: ISSUER_ID,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 3. Cross-issuer credential swap rejected
  // -------------------------------------------------------------------------
  it('should reject a credential from issuer A verified as if from issuer B', async () => {
    const claimsHash = await hashClaims(CLAIMS);

    // Credential was signed by issuer A
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    // But proof claims issuer B
    const proof = buildProof({
      issuerDid: ISSUER_DID_B,
      signatureValue,
    });

    // Identity lookup returns issuer B (attempting swap)
    mockIdentityFindUnique.mockResolvedValue({
      id: 'issuer-002',
      did: ISSUER_DID_B,
      publicKey: testKeyPair.publicKey,
      keyVersion: '1',
      keyAlgorithm: 'ES256',
      verificationMethod: 'did:aethelred:zeroid:credential-signer#key-1',
      status: 'ACTIVE',
    });

    // Signature verification itself will fail because the signature was
    // over ISSUER_DID_A:claimsHash but we're verifying ISSUER_DID_B:claimsHash
    const result = await (service as any).verifyProofSignature(claimsHash, 'issuer-002', proof);
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. Legacy fallback blocked in production
  // -------------------------------------------------------------------------
  it('should block legacy platform-scoped verification in production', async () => {
    process.env.NODE_ENV = 'production';
    // Need a fresh service since IS_PRODUCTION is captured at module level,
    // so we access verifyProofSignature on the existing instance but
    // the module-level IS_PRODUCTION was set at import time.
    // We need to re-require the module with NODE_ENV=production.

    // Instead, test the behavior by calling verifyProofSignature with a
    // credential that has no issuerDid in the proof (legacy platform-scoped).
    // The issuer-scoped check will be skipped (no issuerDid), and the legacy
    // fallback should be blocked.

    // We need to re-import with production env
    jest.resetModules();

    // Re-set mocks and env
    process.env.NODE_ENV = 'production';
    process.env.CREDENTIAL_SIGNING_PRIVATE_KEY = testKeyPair.privateKey;
    process.env.CREDENTIAL_SIGNING_PUBLIC_KEY = testKeyPair.publicKey;
    process.env.KMS_PROVIDER = 'local';
    process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';

    jest.mock('../src/index', () => {
      const { Registry, Counter } = require('prom-client');
      const registry = new Registry();
      return {
        logger: mockLogger,
        redis: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1),
        },
        prisma: {
          identity: { findUnique: mockIdentityFindUnique },
          credential: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((args: any) => Promise.resolve({
              id: 'cred-test-id',
              ...args.data,
              issuedAt: new Date(),
            })),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
          schemaGovernance: { findUnique: jest.fn().mockResolvedValue(null) },
          revocationRegistry: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        },
        metricsRegistry: registry,
        credentialIssuedCounter: new Counter({
          name: 'zeroid_test_prod_credentials_issued_total',
          help: 'test counter',
          registers: [registry],
        }),
      };
    });

    const { CredentialService: ProdCredentialService } = require('../src/services/credential');
    const prodService = new ProdCredentialService();

    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signLegacyPlatformScoped(claimsHash);

    // No issuerDid in proof — legacy platform-scoped credential
    const proof = buildProof({ signatureValue });

    const result = await (prodService as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'credential_legacy_platform_scope_blocked',
      expect.objectContaining({
        issuerId: ISSUER_ID,
      }),
    );

    // Restore
    process.env.NODE_ENV = 'test';
  });

  // -------------------------------------------------------------------------
  // 5. Legacy fallback works in non-production
  // -------------------------------------------------------------------------
  it('should allow legacy platform-scoped verification in non-production', async () => {
    process.env.NODE_ENV = 'test';

    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signLegacyPlatformScoped(claimsHash);

    // No issuerDid in proof — legacy platform-scoped credential
    const proof = buildProof({ signatureValue });

    const result = await (service as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'credential_verified_with_legacy_platform_scope_DEPRECATED',
      expect.objectContaining({
        issuerId: ISSUER_ID,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 6. Key version mismatch rejected
  // -------------------------------------------------------------------------
  it('should reject when proof keyVersion does not match issuer keyVersion', async () => {
    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    // Proof claims keyVersion "2" but issuer record has keyVersion "1"
    const proof = buildProof({
      issuerDid: ISSUER_DID_A,
      keyVersion: '2',
      signatureValue,
    });

    const result = await (service as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'credential_verify_issuer_key_version_mismatch',
      expect.objectContaining({
        issuerDid: ISSUER_DID_A,
        proofKeyVersion: '2',
        issuerKeyVersion: '1',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 7. Verification method mismatch rejected
  // -------------------------------------------------------------------------
  it('should reject when proof verificationMethod does not match issuer record', async () => {
    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    const proof = buildProof({
      issuerDid: ISSUER_DID_A,
      keyVersion: '1',
      verificationMethod: 'did:aethelred:zeroid:WRONG-SIGNER#key-99',
      signatureValue,
    });

    const result = await (service as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'credential_verify_verification_method_mismatch',
      expect.objectContaining({
        issuerDid: ISSUER_DID_A,
        proofVerificationMethod: 'did:aethelred:zeroid:WRONG-SIGNER#key-99',
        issuerVerificationMethod: 'did:aethelred:zeroid:credential-signer#key-1',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 8. Production blocks platform fallback when issuerDid present
  // -------------------------------------------------------------------------
  it('should block platform key fallback in production when issuerDid is present but identity has no key', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.CREDENTIAL_SIGNING_PRIVATE_KEY = testKeyPair.privateKey;
    process.env.CREDENTIAL_SIGNING_PUBLIC_KEY = testKeyPair.publicKey;
    process.env.KMS_PROVIDER = 'local';
    process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';

    // Identity exists but has no publicKey
    mockIdentityFindUnique.mockResolvedValue({
      id: ISSUER_ID,
      did: ISSUER_DID_A,
      publicKey: null,
      keyVersion: 'v1',
      keyAlgorithm: 'ES256',
      verificationMethod: null,
      status: 'ACTIVE',
    });

    jest.mock('../src/index', () => {
      const { Registry, Counter } = require('prom-client');
      const registry = new Registry();
      return {
        logger: mockLogger,
        redis: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1),
        },
        prisma: {
          identity: { findUnique: mockIdentityFindUnique },
          credential: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((args: any) => Promise.resolve({
              id: 'cred-test-id', ...args.data, issuedAt: new Date(),
            })),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
          schemaGovernance: { findUnique: jest.fn().mockResolvedValue(null) },
          revocationRegistry: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        },
        metricsRegistry: registry,
        credentialIssuedCounter: new Counter({
          name: 'zeroid_test_prod_fallback_blocked_total',
          help: 'test counter',
          registers: [registry],
        }),
      };
    });

    const { CredentialService: ProdCredentialService } = require('../src/services/credential');
    const prodService = new ProdCredentialService();

    const claimsHash = await hashClaims(CLAIMS);
    const signatureValue = signForIssuer(ISSUER_DID_A, claimsHash);

    const proof = buildProof({
      issuerDid: ISSUER_DID_A,
      keyVersion: '1',
      signatureValue,
    });

    const result = await (prodService as any).verifyProofSignature(claimsHash, ISSUER_ID, proof);
    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'credential_verify_issuer_key_required_in_production',
      expect.objectContaining({
        issuerDid: ISSUER_DID_A,
      }),
    );

    process.env.NODE_ENV = 'test';
  });

  // -------------------------------------------------------------------------
  // 9. HMAC legacy path blocked in production
  // -------------------------------------------------------------------------
  it('should block HMAC legacy path in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();

    process.env.CREDENTIAL_SIGNING_PRIVATE_KEY = testKeyPair.privateKey;
    process.env.CREDENTIAL_SIGNING_PUBLIC_KEY = testKeyPair.publicKey;
    process.env.KMS_PROVIDER = 'local';
    process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';
    process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING = 'true';
    process.env.CREDENTIAL_SIGNING_SECRET = 'test-hmac-secret';

    jest.mock('../src/index', () => {
      const { Registry, Counter } = require('prom-client');
      const registry = new Registry();
      return {
        logger: mockLogger,
        redis: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1),
        },
        prisma: {
          identity: { findUnique: mockIdentityFindUnique },
          credential: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((args: any) => Promise.resolve({
              id: 'cred-test-id',
              ...args.data,
              issuedAt: new Date(),
            })),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
          schemaGovernance: { findUnique: jest.fn().mockResolvedValue(null) },
          revocationRegistry: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        },
        metricsRegistry: registry,
        credentialIssuedCounter: new Counter({
          name: 'zeroid_test_hmac_credentials_issued_total',
          help: 'test counter',
          registers: [registry],
        }),
      };
    });

    // The KMSCredentialSigner constructor throws in production when
    // ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING is true — this IS the block.
    // The module-level `credentialService` export triggers instantiation at
    // require time, so we must catch the require itself.
    expect(() => {
      require('../src/services/credential');
    }).toThrow('Legacy HMAC credential verification is blocked in production');

    // Restore
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_LEGACY_HMAC_CREDENTIAL_SIGNING;
    delete process.env.CREDENTIAL_SIGNING_SECRET;
  });
});
