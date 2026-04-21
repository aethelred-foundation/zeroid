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

jest.mock('prom-client', () => ({
  Registry: jest.fn(() => ({})),
  Counter: jest.fn(() => ({ inc: jest.fn() })),
}), { virtual: true });

jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn(() => ({ send: jest.fn() })),
  SignCommand: jest.fn(),
  GetPublicKeyCommand: jest.fn(),
}), { virtual: true });

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

  it('allows issuance when no issuer trust records exist yet', async () => {
    const credential = await service.issueCredential(baseRequest);
    expect(mockIssuerTrustFindMany).toHaveBeenCalled();
    expect(credential.id).toBe('cred-1');
  });

  it('allows issuance when an accredited trust record permits the credential type', async () => {
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        status: 'ACCREDITED',
        allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
        expiresAt: null,
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);

    const credential = await service.issueCredential(baseRequest);
    expect(credential.id).toBe('cred-1');
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

    await expect(service.issueCredential(baseRequest)).rejects.toMatchObject<Partial<CredentialError>>({
      code: 'CRED_ISSUER_NOT_ACCREDITED_FOR_TYPE',
      statusCode: 403,
    });
  });
});
