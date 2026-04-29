import crypto from 'crypto';

const mockIdentityFindUnique = jest.fn();
const mockIdentityCreate = jest.fn();
const mockIdentityUpdate = jest.fn();
const mockSessionFindMany = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockGenerateToken = jest.fn();
const mockRevokeToken = jest.fn();

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
      create: mockIdentityCreate,
      update: mockIdentityUpdate,
    },
    session: {
      findMany: mockSessionFindMany,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
  redis: {
    set: mockRedisSet,
    del: mockRedisDel,
  },
}));

jest.mock('../src/middleware/auth', () => ({
  generateToken: mockGenerateToken,
  revokeToken: mockRevokeToken,
}));

import { IdentityService } from '../src/services/identity';

const ORIGINAL_ENV = { ...process.env };

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function protectedRecoveryHash(recoveryHash: string): string {
  return crypto
    .createHmac(
      'sha256',
      process.env.IDENTITY_RECOVERY_HASH_PEPPER as string,
    )
    .update('zeroid:identity-recovery:v2:')
    .update(recoveryHash)
    .digest('hex');
}

function publicKey(): string {
  return Buffer.from(crypto.randomBytes(32)).toString('base64');
}

function baseIdentity(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-28T00:00:00.000Z');
  return {
    id: 'identity-1',
    did: 'did:aethelred:alice',
    publicKey: publicKey(),
    recoveryHash: sha256Hex('valid recovery proof with enough entropy'),
    displayName: null,
    status: 'ACTIVE',
    teeAttested: false,
    governmentVerified: false,
    delegatedTo: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('IdentityService recovery hardening', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
    mockSessionFindMany.mockResolvedValue([]);
    mockIdentityCreate.mockResolvedValue(baseIdentity());
    mockAuditLogCreate.mockResolvedValue({});
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockGenerateToken.mockResolvedValue({
      token: 'session-token',
      sessionId: 'session-1',
    });
  });

  it('does not self-reactivate suspended identities during recovery', async () => {
    mockIdentityFindUnique.mockResolvedValue(
      baseIdentity({ status: 'SUSPENDED' }),
    );
    const service = new IdentityService();

    await expect(
      service.recoverIdentity({
        did: 'did:aethelred:alice',
        recoveryProof: 'valid recovery proof with enough entropy',
        newPublicKey: publicKey(),
        newRecoveryHash: sha256Hex('new recovery proof with enough entropy'),
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_RECOVERY_BLOCKED',
      statusCode: 403,
    });

    expect(mockIdentityUpdate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        identityId: 'identity-1',
        details: expect.objectContaining({
          success: false,
          reason: 'identity_status_not_recoverable',
          status: 'SUSPENDED',
        }),
      }),
    }));
  });

  it('rejects invalid replacement recovery hashes before rotating keys', async () => {
    mockIdentityFindUnique.mockResolvedValue(baseIdentity());
    const service = new IdentityService();

    await expect(
      service.recoverIdentity({
        did: 'did:aethelred:alice',
        recoveryProof: 'valid recovery proof with enough entropy',
        newPublicKey: publicKey(),
        newRecoveryHash: 'not-a-sha256-digest',
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_INVALID_RECOVERY_HASH',
    });

    expect(mockIdentityUpdate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('stores peppered recovery hashes for production registrations', async () => {
    process.env.NODE_ENV = 'production';
    process.env.IDENTITY_RECOVERY_HASH_PEPPER = 'r'.repeat(64);
    const recoveryHash = sha256Hex('new identity recovery proof');
    const createdAt = new Date('2026-04-28T00:00:00.000Z');
    mockIdentityFindUnique.mockResolvedValue(null);
    mockIdentityCreate.mockImplementation(async ({ data }) => ({
      id: 'identity-1',
      did: data.did,
      publicKey: data.publicKey,
      recoveryHash: data.recoveryHash,
      displayName: data.displayName ?? null,
      status: data.status,
      teeAttested: false,
      governmentVerified: false,
      delegatedTo: data.delegatedTo,
      createdAt,
      updatedAt: createdAt,
    }));
    const service = new IdentityService();

    await service.register({
      did: 'did:aethelred:new-user',
      publicKey: publicKey(),
      recoveryHash,
    });

    expect(mockIdentityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recoveryHash: protectedRecoveryHash(recoveryHash),
      }),
    }));
  });

  it('requires a recovery hash pepper before production recovery verification', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.IDENTITY_RECOVERY_HASH_PEPPER;
    mockIdentityFindUnique.mockResolvedValue(baseIdentity());
    const service = new IdentityService();

    await expect(
      service.recoverIdentity({
        did: 'did:aethelred:alice',
        recoveryProof: 'valid recovery proof with enough entropy',
        newPublicKey: publicKey(),
        newRecoveryHash: sha256Hex('new recovery proof with enough entropy'),
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_RECOVERY_HASH_PEPPER_MISSING',
      statusCode: 500,
    });

    expect(mockIdentityUpdate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('verifies and rotates peppered production recovery hashes', async () => {
    process.env.NODE_ENV = 'production';
    process.env.IDENTITY_RECOVERY_HASH_PEPPER = 'r'.repeat(64);
    const recoveryProof = 'valid recovery proof with enough entropy';
    const nextRecoveryHash = sha256Hex('new recovery proof with enough entropy');
    const nextPublicKey = publicKey();
    const currentIdentity = baseIdentity({
      recoveryHash: protectedRecoveryHash(sha256Hex(recoveryProof)),
    });
    mockIdentityFindUnique.mockResolvedValue(currentIdentity);
    mockIdentityUpdate
      .mockResolvedValueOnce(baseIdentity({
        publicKey: nextPublicKey,
        recoveryHash: protectedRecoveryHash(nextRecoveryHash),
        status: 'RECOVERED',
      }))
      .mockResolvedValueOnce(baseIdentity({
        publicKey: nextPublicKey,
        recoveryHash: protectedRecoveryHash(nextRecoveryHash),
        status: 'ACTIVE',
      }));
    const service = new IdentityService();

    await expect(
      service.recoverIdentity({
        did: 'did:aethelred:alice',
        recoveryProof,
        newPublicKey: nextPublicKey,
        newRecoveryHash: nextRecoveryHash,
      }),
    ).resolves.toMatchObject({
      sessionId: 'session-1',
    });

    expect(mockIdentityUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'identity-1' },
      data: expect.objectContaining({
        publicKey: nextPublicKey,
        recoveryHash: protectedRecoveryHash(nextRecoveryHash),
      }),
    });
  });
});
