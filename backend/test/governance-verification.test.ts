import express from 'express';
import request from 'supertest';

const mockSchemaFindUnique = jest.fn();
const mockSchemaUpdate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockGetVerificationStatus = jest.fn();
const mockIsAttestationValid = jest.fn();

jest.mock('../src/middleware/rateLimit', () => ({
  governanceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    schemaGovernance: {
      findUnique: mockSchemaFindUnique,
      update: mockSchemaUpdate,
    },
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
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

import { governanceRoutes } from '../src/routes/governance';

const SCHEMA_ID = '11111111-1111-4111-8111-111111111111';

function createApp(identityId = 'voter-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).identity = {
      id: identityId,
      did: `did:aethelred:test:${identityId}`,
      publicKey: 'pub',
      status: 'ACTIVE',
    };
    next();
  });
  app.use('/governance', governanceRoutes);
  return app;
}

function proposedSchema() {
  return {
    id: SCHEMA_ID,
    status: 'PROPOSED',
    voters: [],
    proposedBy: 'proposer-1',
    approvalVotes: 0,
    rejectionVotes: 0,
  };
}

describe('governance voter verification freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchemaFindUnique.mockResolvedValue(proposedSchema());
    mockSchemaUpdate.mockResolvedValue({
      ...proposedSchema(),
      voters: ['voter-1'],
      approvalVotes: 1,
    });
    mockIdentityFindUnique.mockResolvedValue({ teeAttestationId: 'attestation-1' });
    mockIsAttestationValid.mockResolvedValue(false);
    mockGetVerificationStatus.mockResolvedValue(null);
    mockAuditLogCreate.mockResolvedValue({});
  });

  it('rejects stale TEE and government verification flags without current evidence', async () => {
    await request(createApp())
      .post(`/governance/schemas/${SCHEMA_ID}/vote`)
      .send({ approve: true })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('SCHEMA_VOTER_UNVERIFIED');
      });

    expect(mockIsAttestationValid).toHaveBeenCalledWith('attestation-1');
    expect(mockGetVerificationStatus).toHaveBeenCalledWith('voter-1');
    expect(mockSchemaUpdate).not.toHaveBeenCalled();
  });

  it('allows voting when current government verification evidence exists', async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-current',
      verifiedFields: ['idNumber'],
      verifiedAt: new Date('2026-04-01T00:00:00.000Z'),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    const response = await request(createApp())
      .post(`/governance/schemas/${SCHEMA_ID}/vote`)
      .send({ approve: true })
      .expect(200);

    expect(response.body.data.voters).toEqual(['voter-1']);
    expect(mockSchemaUpdate).toHaveBeenCalledWith({
      where: { id: SCHEMA_ID },
      data: {
        voters: ['voter-1'],
        approvalVotes: 1,
      },
    });
  });
});
