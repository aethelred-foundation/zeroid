import express from 'express';
import request from 'supertest';

const mockExportCredentialEvidence = jest.fn();

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  credentialIssuanceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    exportCredentialEvidence: mockExportCredentialEvidence,
  },
}));

jest.mock('../src/index', () => ({
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

  it('sanitizes credential claims and proof for non-owner verifiers', async () => {
    const response = await request(createApp())
      .get('/credentials/11111111-1111-1111-1111-111111111111/evidence')
      .set('x-test-identity-id', 'verifier-9')
      .expect(200);

    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        credentialType: 'KYC_LEVEL_2',
        status: 'ACTIVE',
        issuedAt: '2026-04-21T00:00:00.000Z',
        expiresAt: '2027-04-21T00:00:00.000Z',
      },
      trustLineage: expect.objectContaining({
        enforced: true,
      }),
    });
    expect(response.body.data.credential.claims).toBeUndefined();
    expect(response.body.data.credential.proof).toBeUndefined();
  });
});
