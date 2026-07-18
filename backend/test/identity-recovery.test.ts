import crypto from 'crypto';
import { Wallet } from 'ethers';

const mockIdentityFindUnique = jest.fn();
const mockIdentityCreate = jest.fn();
const mockIdentityUpdate = jest.fn();
const mockSessionFindMany = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockGenerateToken = jest.fn();
const mockRevokeToken = jest.fn();
const mockRevokePlatformSession = jest.fn();
const mockRevokeSubjectSessions = jest.fn();
const mockPrismaTransaction = jest.fn();

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    $transaction: mockPrismaTransaction,
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

jest.mock('../src/services/enterprise/oidc-bridge', () => ({
  oidcBridge: {
    revokePlatformSession: mockRevokePlatformSession,
    revokeSubjectSessions: mockRevokeSubjectSessions,
  },
}));

import { IdentityService } from '../src/services/identity';
import { buildWalletRegistrationMessage } from '../src/services/identity-registration-proof';

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

async function signedRegistration(wallet: Wallet, recoveryHash: string) {
  const controller = wallet.address.toLowerCase();
  const did = `did:aethelred:testnet:${controller}`;
  const message = buildWalletRegistrationMessage({
    origin: new URL(process.env.ZEROID_AUTH_ORIGIN as string),
    chainId: Number(process.env.AETHELRED_CHAIN_ID),
    did,
    controller,
    recoveryHash,
  });

  return {
    did,
    controller,
    publicKey: Buffer.from(wallet.signingKey.publicKey.slice(2), 'hex').toString(
      'base64',
    ),
    recoveryHash,
    signature: await wallet.signMessage(message),
  };
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
    mockRevokePlatformSession.mockResolvedValue({ revokedSessions: 0 });
    mockRevokeSubjectSessions.mockResolvedValue({ revokedSessions: 0 });
    mockPrismaTransaction.mockImplementation(async (operation: any) =>
      operation({
        identity: {
          create: mockIdentityCreate,
          update: mockIdentityUpdate,
        },
        auditLog: {
          create: mockAuditLogCreate,
        },
      }),
    );
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
    process.env.ZEROID_AUTH_ORIGIN = 'https://zeroid.test';
    process.env.AETHELRED_CHAIN_ID = '7332';
    const recoveryHash = sha256Hex('new identity recovery proof');
    const registration = await signedRegistration(
      Wallet.createRandom(),
      recoveryHash,
    );
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

    await service.register(registration);

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockIdentityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recoveryHash: protectedRecoveryHash(recoveryHash),
      }),
    }));
  });

  it('returns an idempotent 409 when a signed registration is replayed', async () => {
    process.env.ZEROID_AUTH_ORIGIN = 'https://zeroid.test';
    process.env.AETHELRED_CHAIN_ID = '7332';
    const registration = await signedRegistration(
      Wallet.createRandom(),
      sha256Hex('replay-safe recovery proof'),
    );
    const createdAt = new Date('2026-04-28T00:00:00.000Z');
    const created = baseIdentity({
      did: registration.did,
      publicKey: registration.publicKey,
      recoveryHash: registration.recoveryHash,
      createdAt,
      updatedAt: createdAt,
    });
    mockIdentityFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    mockIdentityCreate.mockResolvedValue(created);
    const service = new IdentityService();

    await expect(service.register(registration)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_DID_EXISTS',
      statusCode: 409,
    });

    expect(mockIdentityCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
  });

  it('maps a concurrent duplicate registration race to the same 409', async () => {
    process.env.ZEROID_AUTH_ORIGIN = 'https://zeroid.test';
    process.env.AETHELRED_CHAIN_ID = '7332';
    const registration = await signedRegistration(
      Wallet.createRandom(),
      sha256Hex('concurrent replay recovery proof'),
    );
    mockIdentityFindUnique.mockResolvedValue(null);
    mockPrismaTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const service = new IdentityService();

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_DID_EXISTS',
      statusCode: 409,
    });
    expect(mockGenerateToken).not.toHaveBeenCalled();
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
    mockIdentityUpdate.mockResolvedValueOnce(
      baseIdentity({
        publicKey: nextPublicKey,
        recoveryHash: protectedRecoveryHash(nextRecoveryHash),
        status: 'ACTIVE',
      }),
    );
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

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockIdentityUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'identity-1' },
      data: expect.objectContaining({
        publicKey: nextPublicKey,
        recoveryHash: protectedRecoveryHash(nextRecoveryHash),
        status: 'ACTIVE',
      }),
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'IDENTITY_RECOVERED',
        resourceId: 'identity-1',
        details: { success: true },
      }),
    }));
  });
});
