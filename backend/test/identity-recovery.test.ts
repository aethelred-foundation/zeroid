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
const mockVerifyIdentityRegistration = jest.fn();
const mockAssertCanonicalChainSnapshot = jest.fn();

jest.mock('../src/services/identity-registry-verification', () => ({
  ...jest.requireActual('../src/services/identity-registry-verification'),
  verifyIdentityRegistration: mockVerifyIdentityRegistration,
}));

jest.mock('../src/lib/canonical-chain-transaction', () => ({
  ...jest.requireActual('../src/lib/canonical-chain-transaction'),
  assertCanonicalChainSnapshot: mockAssertCanonicalChainSnapshot,
}));

jest.mock('../src/lib/identity-registry-config', () => ({
  ...jest.requireActual('../src/lib/identity-registry-config'),
  createIdentityRegistryProvider: jest.fn(() => ({ tag: 'provider' })),
  destroyProvider: jest.fn(),
}));

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
    txHash: REGISTRY_TX_HASH,
  };
}

const REGISTRY_TX_HASH = `0x${'11'.repeat(32)}`;
const REGISTRY_ADDRESS = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

/** The verifier is exercised in its own suite; here it answers with evidence. */
function verifiedEvidence(input: { controller: string; did: string }) {
  return {
    dataSource: 'CHAIN_IDENTITY_REGISTRY' as const,
    chainId: 7332,
    registryAddress: REGISTRY_ADDRESS,
    txHash: REGISTRY_TX_HASH,
    blockNumber: 42,
    blockHash: `0x${'33'.repeat(32)}`,
    didHash: `0x${'dd'.repeat(32)}`,
    controller: input.controller,
    eventTimestamp: new Date('2026-04-28T00:00:00.000Z'),
    confirmations: 1,
    verificationVersion: 'zeroid.identity.registry-verification.v1',
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

describe('IdentityService registration hardening', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      AETHELRED_RPC_URL: 'http://127.0.0.1:8545',
      IDENTITY_REGISTRY_ADDRESS: REGISTRY_ADDRESS,
    };
    jest.clearAllMocks();
    mockVerifyIdentityRegistration.mockImplementation(async (input) =>
      verifiedEvidence(input),
    );
    mockAssertCanonicalChainSnapshot.mockResolvedValue(undefined);
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
    // The DID pre-check sees the row only after the first registration
    // committed; the txHash/controller replay pre-checks stay empty so the
    // second attempt is refused by the DID conflict exactly as before.
    let didLookups = 0;
    mockIdentityFindUnique.mockImplementation(async ({ where }) =>
      where.did ? (didLookups++ === 0 ? null : created) : null,
    );
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

  it('rejects authoritative metadata namespaces before registration persistence', async () => {
    process.env.ZEROID_AUTH_ORIGIN = 'https://zeroid.test';
    process.env.AETHELRED_CHAIN_ID = '7332';
    const registration = await signedRegistration(
      Wallet.createRandom(),
      sha256Hex('reserved metadata registration proof'),
    );
    const service = new IdentityService();

    await expect(service.register({
      ...registration,
      metadata: {
        verified_oidc_claims: { name: 'Attacker Controlled' },
      },
    })).rejects.toMatchObject({
      code: 'IDENTITY_METADATA_RESERVED',
      statusCode: 400,
    });

    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
    expect(mockIdentityCreate).not.toHaveBeenCalled();
  });

  it('rejects authoritative namespaces on service-level profile updates', async () => {
    const service = new IdentityService();

    await expect(service.updateIdentity('identity-1', {
      metadata: {
        verifiedClaims: { email: 'attacker@example.test' },
      },
    })).rejects.toMatchObject({
      code: 'IDENTITY_METADATA_RESERVED',
      statusCode: 400,
    });

    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
    expect(mockIdentityUpdate).not.toHaveBeenCalled();
  });

  it('removes legacy authoritative metadata and restores the DID controller', async () => {
    const controller = '0x1234567890123456789012345678901234567890';
    const identity = baseIdentity({
      did: `did:aethelred:testnet:${controller}`,
      metadata: {
        avatarUri: 'https://example.test/avatar.png',
        controller: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        verified_claims: {
          claims: { name: 'Legacy Attacker Value' },
        },
      },
    });
    mockIdentityFindUnique.mockResolvedValue(identity);
    mockIdentityUpdate.mockImplementation(async ({ data }) => ({
      ...identity,
      ...data,
      updatedAt: new Date('2026-04-28T00:01:00.000Z'),
    }));
    const service = new IdentityService();

    await service.updateIdentity('identity-1', { displayName: 'Alice' });

    expect(mockIdentityUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: {
          avatarUri: 'https://example.test/avatar.png',
          controller,
        },
      }),
    }));
  });

});
