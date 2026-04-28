const mockCredentialFindUnique = jest.fn();
const mockCredentialUpdate = jest.fn();
const mockRevocationFindUnique = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    credential: {
      findUnique: mockCredentialFindUnique,
      update: mockCredentialUpdate,
    },
    revocationRegistry: {
      findUnique: mockRevocationFindUnique,
    },
  },
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
  credentialIssuedCounter: {
    inc: jest.fn(),
  },
}));

import { CredentialService } from '../src/services/credential';

function credentialRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'credential-1',
    credentialType: 'KYC_LEVEL_2',
    issuerId: 'issuer-1',
    subjectId: 'subject-1',
    schemaId: null,
    claims: { level: 2 },
    claimsHash: 'a'.repeat(64),
    proof: { type: 'DataIntegrityProof' },
    status: 'ACTIVE',
    issuedAt: new Date('2026-04-28T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

describe('Credential cache expiry enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockCredentialFindUnique.mockResolvedValue(null);
    mockCredentialUpdate.mockResolvedValue({});
    mockRevocationFindUnique.mockResolvedValue(null);
  });

  it('marks cached active credentials expired before returning them', async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify(credentialRecord({ expiresAt: expiredAt })),
    );
    const service = new CredentialService();

    const result = await service.getCredential('credential-1');

    expect(result?.status).toBe('EXPIRED');
    expect(mockCredentialUpdate).toHaveBeenCalledWith({
      where: { id: 'credential-1' },
      data: { status: 'EXPIRED' },
    });
    expect(mockCredentialFindUnique).not.toHaveBeenCalled();
  });

  it('caps active credential cache ttl to the remaining expiry window', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mockCredentialFindUnique.mockResolvedValueOnce(
      credentialRecord({ expiresAt }),
    );
    const service = new CredentialService();

    await service.getCredential('credential-1');

    expect(mockRedisSet).toHaveBeenCalledWith(
      'cred:credential-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    const ttl = mockRedisSet.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('does not return cached active credentials after durable revocation', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(credentialRecord()));
    mockRevocationFindUnique.mockResolvedValueOnce({
      credentialId: 'credential-1',
      reason: 'compromised',
    });
    const service = new CredentialService();

    const result = await service.getCredential('credential-1');

    expect(result?.status).toBe('REVOKED');
    expect(mockCredentialFindUnique).not.toHaveBeenCalled();
    expect(mockCredentialUpdate).toHaveBeenCalledWith({
      where: { id: 'credential-1' },
      data: { status: 'REVOKED' },
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'cred:credential-1',
      expect.stringContaining('"status":"REVOKED"'),
      'EX',
      300,
    );
  });
});
