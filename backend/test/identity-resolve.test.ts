import express from 'express';
import request from 'supertest';

const mockIdentityFindUnique = jest.fn();
const mockIdentityFindFirst = jest.fn();
const mockGetVerificationStatus = jest.fn();
const mockIsAttestationValid = jest.fn();

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
      findFirst: mockIdentityFindFirst,
    },
  },
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  generateToken: jest.fn(),
  revokeToken: jest.fn(),
}));

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/government-api', () => ({
  governmentAPIService: {
    getVerificationStatus: mockGetVerificationStatus,
  },
}));

jest.mock('../src/services/tee', () => ({
  teeService: {
    isAttestationValid: mockIsAttestationValid,
  },
}));

import { identityRoutes } from '../src/routes/identity';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/identity', identityRoutes);
  return app;
}

describe('identity DID resolution freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityFindUnique.mockResolvedValue({
      id: 'identity-1',
      did: 'did:aethelred:alice',
      publicKey: 'public-key-1',
      status: 'ACTIVE',
      teeAttestationId: 'attestation-stale',
      createdAt: new Date('2026-04-28T00:00:00.000Z'),
    });
    mockIdentityFindFirst.mockResolvedValue(null);
    mockIsAttestationValid.mockResolvedValue(false);
    mockGetVerificationStatus.mockResolvedValue(null);
  });

  it('resolves deterministic address-backed DIDs for frontend identity lookup', async () => {
    mockIdentityFindFirst.mockResolvedValueOnce({
      id: 'identity-2',
      did: 'did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678',
      publicKey: 'public-key-2',
      status: 'ACTIVE',
      teeAttestationId: 'attestation-current',
      displayName: 'Alice',
      createdAt: new Date('2026-04-28T00:00:00.000Z'),
      updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    });
    mockIsAttestationValid.mockResolvedValueOnce(true);
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const response = await request(createApp())
      .get('/identity/address/0x1234567890abcdef1234567890abcdef12345678')
      .expect(200);

    expect(mockIdentityFindFirst).toHaveBeenCalledWith({
      where: {
        did: {
          in: [
            'did:aethelred:mainnet:0x1234567890abcdef1234567890abcdef12345678',
            'did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678',
            'did:aethelred:devnet:0x1234567890abcdef1234567890abcdef12345678',
          ],
        },
      },
      select: expect.objectContaining({
        did: true,
        publicKey: true,
        status: true,
      }),
    });
    expect(response.body.data).toMatchObject({
      did: 'did:aethelred:testnet:0x1234567890abcdef1234567890abcdef12345678',
      controller: '0x1234567890abcdef1234567890abcdef12345678',
      displayName: 'Alice',
      teeAttested: true,
      governmentVerified: true,
    });
  });

  it('returns 404 when no deterministic address DID is registered', async () => {
    const response = await request(createApp())
      .get('/identity/address/0x1234567890abcdef1234567890abcdef12345678')
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'IDENTITY_ADDRESS_NOT_FOUND',
    });
  });

  it('does not publish stale verification booleans from identity rows', async () => {
    const response = await request(createApp())
      .get('/identity/resolve/did:aethelred:alice')
      .expect(200);

    expect(mockIsAttestationValid).toHaveBeenCalledWith('attestation-stale');
    expect(mockGetVerificationStatus).toHaveBeenCalledWith('identity-1');
    expect(response.body.data).toMatchObject({
      did: 'did:aethelred:alice',
      teeAttested: false,
      governmentVerified: false,
      verificationEvidence: {
        tee: null,
        government: null,
      },
    });
  });

  it('publishes only current verification evidence', async () => {
    mockIsAttestationValid.mockResolvedValueOnce(true);
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-current',
      verifiedFields: ['idNumber'],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const response = await request(createApp())
      .get('/identity/resolve/did:aethelred:alice')
      .expect(200);

    expect(response.body.data).toMatchObject({
      teeAttested: true,
      governmentVerified: true,
      verificationEvidence: {
        tee: { verified: true },
        government: {
          verified: true,
          provider: 'EMIRATES_ID',
        },
      },
    });
  });

  it('does not treat failed government status objects as public verification evidence', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: false,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-failed',
      verifiedFields: [],
      verifiedAt: new Date('2026-04-28T00:00:00.000Z'),
      expiresAt: new Date('2027-04-28T00:00:00.000Z'),
    });

    const response = await request(createApp())
      .get('/identity/resolve/did:aethelred:alice')
      .expect(200);

    expect(response.body.data).toMatchObject({
      governmentVerified: false,
      verificationEvidence: {
        government: null,
      },
    });
  });
});
