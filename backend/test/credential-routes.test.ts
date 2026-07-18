import express from 'express';
import request from 'supertest';

const mockExportCredentialEvidence = jest.fn();
const mockGetCredential = jest.fn();
const mockVerifyCredential = jest.fn();

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  credentialIssuanceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    exportCredentialEvidence: mockExportCredentialEvidence,
    getCredential: mockGetCredential,
    verifyCredential: mockVerifyCredential,
  },
}));

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: jest.fn(),
    },
  },
}));

import { credentialRoutes } from '../src/routes/credentials';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const identityId = req.get('x-test-identity-id') ?? 'issuer-1';
    (req as any).identity = {
      id: identityId,
      did: 'did:aethelred:test:actor',
      publicKey: 'pub',
      status: 'ACTIVE',
    };
    next();
  });
  app.use('/credentials', credentialRoutes);
  return app;
}

describe('credential evidence routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCredential.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      credentialType: 'KYC_LEVEL_2',
      issuerId: 'issuer-1',
      subjectId: 'subject-1',
      status: 'ACTIVE',
      issuedAt: '2026-04-21T00:00:00.000Z',
      expiresAt: '2027-04-21T00:00:00.000Z',
    });
    mockExportCredentialEvidence.mockResolvedValue({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      exportedAt: '2026-04-21T00:00:00.000Z',
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        credentialType: 'KYC_LEVEL_2',
        issuerId: 'issuer-1',
        subjectId: 'subject-1',
        claims: { level: 'enhanced' },
        claimsHash: 'hash',
        proof: { signatureValue: 'sig' },
        status: 'ACTIVE',
        issuedAt: '2026-04-21T00:00:00.000Z',
        expiresAt: '2027-04-21T00:00:00.000Z',
      },
      verification: {
        valid: true,
        checks: {
          statusActive: true,
          signatureValid: true,
        },
      },
      issuer: {
        identityId: 'issuer-1',
        did: 'did:aethelred:issuer:alpha',
      },
      subject: {
        identityId: 'subject-1',
        did: 'did:aethelred:user:alice',
      },
      trustLineage: {
        enforced: true,
        selectedTrustRecordId: 'trust-1',
        evaluatedJurisdictions: ['UAE'],
        matchedJurisdictions: ['UAE'],
      },
    });
    mockVerifyCredential.mockResolvedValue({
      valid: true,
      checks: {
        statusActive: true,
        signatureValid: true,
      },
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        credentialType: 'KYC_LEVEL_2',
        issuerId: 'issuer-1',
        subjectId: 'subject-1',
        claims: { level: 'enhanced' },
        claimsHash: 'hash',
        proof: { signatureValue: 'sig' },
        status: 'ACTIVE',
        issuedAt: '2026-04-21T00:00:00.000Z',
        expiresAt: '2027-04-21T00:00:00.000Z',
      },
    });
  });

  it('returns the full evidence bundle to the issuer', async () => {
    const response = await request(createApp())
      .get('/credentials/11111111-1111-1111-1111-111111111111/evidence')
      .set('x-test-identity-id', 'issuer-1')
      .expect(200);

    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      credential: expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        claims: { level: 'enhanced' },
        proof: { signatureValue: 'sig' },
      }),
      trustLineage: expect.objectContaining({
        selectedTrustRecordId: 'trust-1',
      }),
    });
  });

  it('hides credential evidence from non-owner verifiers', async () => {
    await request(createApp())
      .get('/credentials/11111111-1111-1111-1111-111111111111/evidence')
      .set('x-test-identity-id', 'verifier-9')
      .expect(404);

    expect(mockExportCredentialEvidence).not.toHaveBeenCalled();
  });

  it('does not reveal whether missing credentials differ from unauthorized credentials', async () => {
    mockGetCredential.mockResolvedValueOnce(null);

    await request(createApp())
      .get('/credentials/11111111-1111-1111-1111-111111111111/evidence')
      .set('x-test-identity-id', 'issuer-1')
      .expect(404);

    expect(mockExportCredentialEvidence).not.toHaveBeenCalled();
  });

  it('verifies credentials for the issuer', async () => {
    const response = await request(createApp())
      .post('/credentials/11111111-1111-1111-1111-111111111111/verify')
      .set('x-test-identity-id', 'issuer-1')
      .send({})
      .expect(200);

    expect(response.body.data).toMatchObject({
      valid: true,
      checks: {
        statusActive: true,
        signatureValid: true,
      },
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        claims: { level: 'enhanced' },
      },
    });
    expect(mockVerifyCredential).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('does not verify or disclose credentials to non-owners', async () => {
    await request(createApp())
      .post('/credentials/11111111-1111-1111-1111-111111111111/verify')
      .set('x-test-identity-id', 'verifier-9')
      .send({})
      .expect(404);

    expect(mockVerifyCredential).not.toHaveBeenCalled();
  });
});
