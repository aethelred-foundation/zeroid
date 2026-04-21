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
const mockCredentialFindUnique = jest.fn();
const mockRevocationFindUnique = jest.fn();
const mockIssuerTrustFindMany = jest.fn();
const mockIssuerKeyHistoryFindMany = jest.fn();
const mockAuditLogCreate = jest.fn();

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
    del: jest.fn().mockResolvedValue(1),
  },
  credentialIssuedCounter: {
    inc: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    credential: {
      findUnique: mockCredentialFindUnique,
    },
    revocationRegistry: {
      findUnique: mockRevocationFindUnique,
    },
    issuerTrustRecord: {
      findMany: mockIssuerTrustFindMany,
    },
    issuerKeyHistory: {
      findMany: mockIssuerKeyHistoryFindMany,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

import { CredentialService } from '../src/services/credential';

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((entry) => canonicalize(entry)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',') + '}';
}

async function hashClaims(claims: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalize(claims)));
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function signForIssuer(issuerDid: string, claimsHash: string): string {
  const message = crypto.createHash('sha256')
    .update(`${issuerDid}:${claimsHash}`)
    .digest();
  const signature = crypto.sign('sha256', message, crypto.createPrivateKey(testKeyPair.privateKey));
  return signature.toString('base64url');
}

describe('Credential evidence export', () => {
  const service = new CredentialService();

  beforeEach(async () => {
    jest.clearAllMocks();

    const claims = {
      level: 'enhanced',
      jurisdiction: 'UAE',
      residencyJurisdiction: 'EU-GDPR',
    };
    const claimsHash = await hashClaims(claims);

    mockCredentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      credentialType: 'kyc_enhanced',
      issuerId: 'issuer-1',
      subjectId: 'subject-1',
      claims,
      claimsHash,
      proof: {
        type: 'JsonWebSignature2020',
        created: '2026-04-21T00:00:00.000Z',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
        proofPurpose: 'assertionMethod',
        issuerDid: 'did:aethelred:issuer:alpha',
        keyVersion: '2',
        signatureValue: signForIssuer('did:aethelred:issuer:alpha', claimsHash),
      },
      status: 'ACTIVE',
      issuedAt: new Date('2026-04-21T00:00:00.000Z'),
      expiresAt: new Date('2027-04-21T00:00:00.000Z'),
    });

    mockIdentityFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'issuer-1' || where.did === 'did:aethelred:issuer:alpha') {
        return {
          id: 'issuer-1',
          did: 'did:aethelred:issuer:alpha',
          publicKey: testKeyPair.publicKey,
          keyVersion: '2',
          keyAlgorithm: 'ES256',
          verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
          status: 'ACTIVE',
        };
      }

      if (where.id === 'subject-1') {
        return {
          id: 'subject-1',
          did: 'did:aethelred:user:alice',
          status: 'ACTIVE',
        };
      }

      return null;
    });

    mockRevocationFindUnique.mockResolvedValue(null);
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-1',
        issuerIdentityId: 'issuer-1',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'QUALIFIED',
        allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
        allowedJurisdictions: ['UAE', 'EU-GDPR'],
        proposedByIdentityId: 'admin-1',
        accreditedByIdentityId: 'admin-2',
        suspensionReason: null,
        metadata: { trustFramework: 'ADGM' },
        accreditedAt: new Date('2026-04-21T00:00:00.000Z'),
        expiresAt: new Date('2027-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      },
    ]);
    mockIssuerKeyHistoryFindMany.mockResolvedValue([
      {
        id: 'hist-2',
        issuerIdentityId: 'issuer-1',
        keyVersion: '2',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-2',
        status: 'ACTIVE',
        validFrom: new Date('2026-04-21T00:00:00.000Z'),
        validUntil: null,
        rotatedByIdentityId: 'admin-2',
        metadata: { hsm: 'aws-kms' },
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
      },
      {
        id: 'hist-1',
        issuerIdentityId: 'issuer-1',
        keyVersion: '1',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:alpha#assertion-key-1',
        status: 'RETIRED',
        validFrom: new Date('2026-03-01T00:00:00.000Z'),
        validUntil: new Date('2026-04-21T00:00:00.000Z'),
        rotatedByIdentityId: 'admin-1',
        metadata: { hsm: 'aws-kms' },
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
  });

  it('exports credential verification evidence with issuer trust and key lineage', async () => {
    const exported = await service.exportCredentialEvidence('cred-1');

    expect(exported).toMatchObject({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      credential: {
        id: 'cred-1',
        credentialType: 'kyc_enhanced',
        issuerId: 'issuer-1',
        subjectId: 'subject-1',
      },
      verification: {
        valid: true,
        checks: expect.objectContaining({
          statusActive: true,
          signatureValid: true,
          issuerActive: true,
          subjectActive: true,
          notRevoked: true,
        }),
      },
      issuer: {
        identityId: 'issuer-1',
        did: 'did:aethelred:issuer:alpha',
        keyVersion: '2',
      },
      subject: {
        identityId: 'subject-1',
        did: 'did:aethelred:user:alice',
      },
      trustLineage: {
        enforced: true,
        selectedTrustRecordId: 'trust-1',
        accreditationScope: 'sovereign',
        assuranceLevel: 'qualified',
        evaluatedJurisdictions: ['UAE', 'EU-GDPR'],
        matchedJurisdictions: ['UAE', 'EU-GDPR'],
        trustRecord: expect.objectContaining({
          trustRecordId: 'trust-1',
          allowedCredentialTypes: ['kyc_enhanced', 'proof_of_residency'],
          allowedJurisdictions: ['UAE', 'EU-GDPR'],
        }),
        keyLineage: expect.objectContaining({
          current: expect.objectContaining({
            keyHistoryId: 'hist-2',
            keyVersion: '2',
            status: 'active',
          }),
          history: [
            expect.objectContaining({ keyHistoryId: 'hist-2' }),
            expect.objectContaining({ keyHistoryId: 'hist-1' }),
          ],
        }),
      },
    });
  });
});
