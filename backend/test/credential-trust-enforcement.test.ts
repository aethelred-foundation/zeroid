import * as crypto from 'crypto';

const testKeyPair = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.CREDENTIAL_SIGNING_PRIVATE_KEY = testKeyPair.privateKey;
process.env.CREDENTIAL_SIGNING_PUBLIC_KEY = testKeyPair.publicKey;
process.env.KMS_PROVIDER = 'local';
process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';

jest.mock(
  'prom-client',
  () => ({
    Registry: jest.fn(() => ({})),
    Counter: jest.fn(() => ({ inc: jest.fn() })),
  }),
  { virtual: true },
);

jest.mock(
  '@aws-sdk/client-kms',
  () => ({
    KMSClient: jest.fn(() => ({ send: jest.fn() })),
    SignCommand: jest.fn(),
    GetPublicKeyCommand: jest.fn(),
  }),
  { virtual: true },
);

const mockIdentityFindUnique = jest.fn();
const mockCredentialFindFirst = jest.fn();
const mockCredentialCreate = jest.fn();
const mockSchemaFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockIssuerTrustFindMany = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: mockRedisDel,
  },
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    credential: {
      findFirst: mockCredentialFindFirst,
      create: mockCredentialCreate,
    },
    schemaGovernance: {
      findUnique: mockSchemaFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
    issuerTrustRecord: {
      findMany: mockIssuerTrustFindMany,
    },
  },
  credentialIssuedCounter: {
    inc: jest.fn(),
  },
}));

import { CredentialService, CredentialError } from '../src/services/credential';

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (key) => JSON.stringify(key) + ':' + canonicalize(obj[key]),
  );
  return '{' + entries.join(',') + '}';
}

function hashClaims(claims: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalize(claims)).digest('hex');
}

function buildCredentialBinding(
  request: {
    credentialType: string;
    issuerId: string;
    issuerDid: string;
    subjectId: string;
    subjectDid: string;
    claims: Record<string, unknown>;
  },
  claimsHash = hashClaims(request.claims),
) {
  return {
    version: 'zeroid.credential.signature.v2' as const,
    proofPurpose: 'assertionMethod' as const,
    issuerDid: request.issuerDid,
    issuerId: request.issuerId,
    subjectDid: request.subjectDid,
    subjectId: request.subjectId,
    credentialType: request.credentialType,
    schemaId: null,
    expiresAt: null,
    claimsHash,
  };
}

function signCredentialBinding(
  binding: ReturnType<typeof buildCredentialBinding>,
): string {
  const message = crypto
    .createHash('sha256')
    .update(canonicalize(binding))
    .digest();
  return crypto
    .sign('sha256', message, crypto.createPrivateKey(testKeyPair.privateKey))
    .toString('base64url');
}

describe('Credential trust enforcement', () => {
  let service: CredentialService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';

    mockIdentityFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'issuer-1') {
        return {
          id: 'issuer-1',
          did: 'did:aethelred:issuer:alpha',
          publicKey: testKeyPair.publicKey,
          keyVersion: '1',
          keyAlgorithm: 'ES256',
          verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-1',
          status: 'ACTIVE',
        };
      }

      if (where.id === 'subject-1') {
        return {
          id: 'subject-1',
          did: 'did:aethelred:user:alice',
          publicKey: 'subject-public-key',
          status: 'ACTIVE',
        };
      }

      return null;
    });

    mockCredentialFindFirst.mockResolvedValue(null);
    mockCredentialCreate.mockImplementation(async ({ data }: any) => ({
      id: 'cred-1',
      ...data,
      issuedAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    }));
    mockSchemaFindUnique.mockResolvedValue(null);
    mockAuditLogCreate.mockResolvedValue({});
    mockIssuerTrustFindMany.mockResolvedValue([]);
    mockRedisDel.mockResolvedValue(1);

    service = new CredentialService();
  });

  const baseRequest = {
    credentialType: 'kyc_enhanced',
    issuerId: 'issuer-1',
    issuerDid: 'did:aethelred:issuer:alpha',
    subjectId: 'subject-1',
    subjectDid: 'did:aethelred:user:alice',
    claims: {
      level: 'enhanced',
      jurisdiction: 'UAE',
    },
  };

  function buildIssuerProof(overrides: Record<string, unknown> = {}) {
    const claimsHash = hashClaims(baseRequest.claims);
    const credentialBinding = buildCredentialBinding(baseRequest, claimsHash);
    return {
      type: 'DataIntegrityProof',
      proofPurpose: 'assertionMethod' as const,
      issuerDid: baseRequest.issuerDid,
      keyVersion: '1',
      verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-1',
      credentialBinding,
      signatureValue: signCredentialBinding(credentialBinding),
      ...overrides,
    };
  }

  it('allows issuance when no issuer trust records exist yet', async () => {
    const credential = await service.issueCredential(baseRequest);
    expect(mockIssuerTrustFindMany).toHaveBeenCalled();
    expect(credential.id).toBe('cred-1');
  });

  it('stores an issuer-submitted credential proof validated against the issuer key', async () => {
    const issuerProof = buildIssuerProof();

    const credential = await service.issueCredential({
      ...baseRequest,
      issuerProof,
    });

    expect(credential.id).toBe('cred-1');
    expect(mockCredentialCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proof: expect.objectContaining({
            issuerDid: baseRequest.issuerDid,
            verificationMethod: issuerProof.verificationMethod,
            keyVersion: issuerProof.keyVersion,
            signatureValue: issuerProof.signatureValue,
          }),
        }),
      }),
    );
  });

  it('requires an issuer-submitted proof for production issuance', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KMS_PROVIDER = 'aws-kms';
    process.env.KMS_KEY_ID = 'arn:aws:kms:us-east-1:111122223333:key/test-credential-signer';
    delete process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING;

    try {
      service = new CredentialService();

      await expect(service.issueCredential(baseRequest)).rejects.toMatchObject<
        Partial<CredentialError>
      >({
        code: 'CRED_ISSUER_SIGNATURE_REQUIRED',
      });
    } finally {
      process.env.NODE_ENV = 'test';
      process.env.KMS_PROVIDER = 'local';
      process.env.ALLOW_LOCAL_CREDENTIAL_SIGNING = 'true';
      delete process.env.KMS_KEY_ID;
    }
  });

  it('rejects an issuer-submitted proof with an invalid signature', async () => {
    const credentialBinding = buildCredentialBinding(baseRequest);
    const issuerProof = buildIssuerProof({
      credentialBinding,
      signatureValue: signCredentialBinding({
        ...credentialBinding,
        claimsHash: 'f'.repeat(64),
      }),
    });

    await expect(
      service.issueCredential({
        ...baseRequest,
        issuerProof,
      }),
    ).rejects.toMatchObject<Partial<CredentialError>>({
      code: 'CRED_ISSUER_PROOF_SIGNATURE_INVALID',
    });
  });

  it('rejects an issuer-submitted proof replayed onto a different credential envelope', async () => {
    const replayedBinding = buildCredentialBinding({
      ...baseRequest,
      subjectId: 'subject-2',
      subjectDid: 'did:aethelred:user:bob',
    });
    const issuerProof = buildIssuerProof({
      credentialBinding: replayedBinding,
      signatureValue: signCredentialBinding(replayedBinding),
    });

    await expect(
      service.issueCredential({
        ...baseRequest,
        issuerProof,
      }),
    ).rejects.toMatchObject<Partial<CredentialError>>({
      code: 'CRED_ISSUER_PROOF_BINDING_MISMATCH',
    });
  });

  it('allows issuance when an accredited trust record permits the credential type', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        status: 'ACCREDITED',
        accreditationScope: 'ENTERPRISE',
        assuranceLevel: 'ADVANCED',
        allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
        allowedJurisdictions: ['UAE', 'EU'],
        expiresAt: null,
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);

    const credential = await service.issueCredential(baseRequest);
    expect(credential.id).toBe('cred-1');
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            issuerTrustPolicy: expect.objectContaining({
              trustRecordId: 'trust-1',
              accreditationScope: 'enterprise',
              assuranceLevel: 'advanced',
              matchedJurisdictions: ['UAE'],
            }),
          }),
        }),
      }),
    );
  });

  it('rejects issuance when trust governance exists but does not accredit the credential type', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        status: 'ACCREDITED',
        allowedCredentialTypes: ['proof_of_income'],
        expiresAt: null,
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
      {
        id: 'trust-2',
        status: 'SUSPENDED',
        allowedCredentialTypes: ['kyc_enhanced'],
        expiresAt: null,
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
      },
    ]);

    await expect(service.issueCredential(baseRequest)).rejects.toMatchObject<
      Partial<CredentialError>
    >({
      code: 'CRED_ISSUER_NOT_ACCREDITED_FOR_TYPE',
      statusCode: 403,
    });
  });

  it('rejects issuance when the credential jurisdiction is outside the accredited trust scope', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'QUALIFIED',
        allowedCredentialTypes: ['kyc_enhanced'],
        allowedJurisdictions: ['EU-GDPR'],
        expiresAt: null,
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);

    await expect(service.issueCredential(baseRequest)).rejects.toMatchObject<
      Partial<CredentialError>
    >({
      code: 'CRED_ISSUER_NOT_ACCREDITED_FOR_JURISDICTION',
      statusCode: 403,
    });
  });

  it('prefers the strongest active accreditation when multiple trust anchors match', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        status: 'ACCREDITED',
        accreditationScope: 'ENTERPRISE',
        assuranceLevel: 'ADVANCED',
        allowedCredentialTypes: ['kyc_enhanced'],
        allowedJurisdictions: ['UAE'],
        expiresAt: null,
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
      },
      {
        id: 'trust-2',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'SOVEREIGN',
        allowedCredentialTypes: ['kyc_enhanced'],
        allowedJurisdictions: ['UAE', 'EU-GDPR'],
        expiresAt: null,
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);

    await service.issueCredential(baseRequest);

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            issuerTrustPolicy: expect.objectContaining({
              trustRecordId: 'trust-2',
              accreditationScope: 'sovereign',
              assuranceLevel: 'sovereign',
              matchedJurisdictions: ['UAE'],
            }),
          }),
        }),
      }),
    );
  });
});
