const mockAuditLogCreate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockCredentialFindMany = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisLrange = jest.fn();
const mockRedisLpush = jest.fn();
const mockRedisLtrim = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    auditLog: {
      create: mockAuditLogCreate,
    },
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    credential: {
      findMany: mockCredentialFindMany,
    },
  },
  redis: {
    get: mockRedisGet,
    lrange: mockRedisLrange,
    lpush: mockRedisLpush,
    ltrim: mockRedisLtrim,
    expire: mockRedisExpire,
    set: mockRedisSet,
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { RiskScoringService } from '../src/services/ai/risk-scoring';

function activeIdentity(credentials: unknown[] = []) {
  return {
    id: 'identity-1',
    status: 'ACTIVE',
    teeAttested: true,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    credentials,
  };
}

function verifiedCredential(id: string) {
  return {
    id,
    credentialType: 'NATIONAL_ID',
    issuedAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-16T00:00:00.000Z'),
  };
}

describe('RiskScoringService evidence gap guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisLrange.mockResolvedValue([]);
    mockRedisLpush.mockResolvedValue(1);
    mockRedisLtrim.mockResolvedValue('OK');
    mockRedisExpire.mockResolvedValue(1);
    mockRedisSet.mockResolvedValue('OK');
    mockCredentialFindMany.mockResolvedValue([
      {
        id: 'credential-1',
        credentialType: 'NATIONAL_ID',
        issuerId: 'issuer-1',
        issuedAt: new Date('2026-04-15T00:00:00.000Z'),
        expiresAt: new Date('2027-04-15T00:00:00.000Z'),
        status: 'ACTIVE',
        updatedAt: new Date('2026-04-16T00:00:00.000Z'),
        claims: { givenName: 'Example' },
      },
      {
        id: 'credential-2',
        credentialType: 'PASSPORT',
        issuerId: 'issuer-1',
        issuedAt: new Date('2026-04-20T00:00:00.000Z'),
        expiresAt: new Date('2027-04-20T00:00:00.000Z'),
        status: 'ACTIVE',
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
        claims: { givenName: 'Example' },
      },
    ]);
  });

  it('does not approve a transaction when transaction signals are missing', async () => {
    mockIdentityFindUnique.mockResolvedValue(
      activeIdentity([verifiedCredential('credential-1'), verifiedCredential('credential-2')]),
    );

    const assessment = await new RiskScoringService().assessRisk(
      'identity-1',
      'transaction',
      'US',
    );

    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'transaction_data_unavailable',
        normalizedScore: 65,
      }),
    ]));
    expect(assessment.compositeScore).toBeGreaterThanOrEqual(55);
    expect(assessment.decision).toBe('review');
  });

  it('does not approve an identity with no active credentials', async () => {
    mockIdentityFindUnique.mockResolvedValue(activeIdentity([]));
    mockCredentialFindMany.mockResolvedValue([]);

    const assessment = await new RiskScoringService().assessRisk(
      'identity-1',
      'identity',
      'US',
    );

    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'no_credentials',
        normalizedScore: 60,
      }),
    ]));
    expect(assessment.compositeScore).toBeGreaterThanOrEqual(55);
    expect(assessment.decision).toBe('review');
  });

  it('does not approve when credential risk cannot be computed', async () => {
    mockCredentialFindMany.mockRejectedValue(new Error('datastore unavailable'));

    const assessment = await new RiskScoringService().assessRisk(
      'credential-1',
      'credential',
      'US',
    );

    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'credential_data_unavailable',
        normalizedScore: 70,
      }),
    ]));
    expect(assessment.compositeScore).toBeGreaterThanOrEqual(55);
    expect(assessment.decision).toBe('review');
  });
});
