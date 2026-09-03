import { Wallet } from 'ethers';

const mockIdentityFindUnique = jest.fn();
const mockIdentityCreate = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockTransaction = jest.fn();
const mockGenerateToken = jest.fn();
const mockRedisSet = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockVerifyIdentityRegistration = jest.fn();
const mockAssertCanonicalChainSnapshot = jest.fn();
const mockCreateProvider = jest.fn();
const mockDestroyProvider = jest.fn();

jest.mock('../src/runtime', () => ({
  prisma: {
    identity: { findUnique: mockIdentityFindUnique, create: mockIdentityCreate },
    auditLog: { create: mockAuditLogCreate },
    $transaction: mockTransaction,
  },
  redis: { set: mockRedisSet, get: jest.fn(), del: jest.fn() },
  logger: mockLogger,
}));

jest.mock('../src/middleware/auth', () => ({
  generateToken: mockGenerateToken,
  revokeToken: jest.fn(),
}));

jest.mock('../src/services/enterprise/oidc-bridge', () => ({
  oidcBridge: { revokePlatformSession: jest.fn() },
}));

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
  createIdentityRegistryProvider: mockCreateProvider,
  destroyProvider: mockDestroyProvider,
}));

import {
  CanonicalTransactionError,
} from '../src/lib/canonical-chain-transaction';
import { IdentityRegistryVerificationError } from '../src/services/identity-registry-verification';
import { IdentityService } from '../src/services/identity';

const ORIGINAL_ENV = { ...process.env };
const ORIGIN = 'https://zeroid.test';
const REGISTRY = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const TX_HASH = `0x${'11'.repeat(32)}`;
const BLOCK_HASH = `0x${'33'.repeat(32)}`;
const RECOVERY_HASH = 'a'.repeat(64);

function walletPublicKey(wallet: Wallet): string {
  return Buffer.from(wallet.signingKey.publicKey.slice(2), 'hex').toString('base64');
}

async function signedRegistration(wallet: Wallet, network = 'testnet') {
  const controller = wallet.address.toLowerCase();
  const did = `did:aethelred:${network}:${controller}`;
  const message = [
    'zeroid.test wants you to register a ZeroID identity with your Ethereum account:',
    controller,
    '',
    'Authorize creation of the wallet-bound ZeroID identity below. This request does not initiate a blockchain transaction.',
    '',
    'URI: https://zeroid.test',
    'Version: 1',
    'Chain ID: 7332',
    `DID: ${did}`,
    `Recovery Hash: ${RECOVERY_HASH}`,
    'Purpose: zeroid.identity.registration',
  ].join('\n');
  return {
    did,
    controller,
    publicKey: walletPublicKey(wallet),
    recoveryHash: RECOVERY_HASH,
    signature: await wallet.signMessage(message),
    txHash: TX_HASH,
    displayName: 'Alice',
    metadata: { didDocument: { id: did } },
  };
}

function evidenceFor(controller: string, did: string) {
  return {
    dataSource: 'CHAIN_IDENTITY_REGISTRY' as const,
    chainId: 7332,
    registryAddress: REGISTRY,
    txHash: TX_HASH,
    blockNumber: 42,
    blockHash: BLOCK_HASH,
    didHash: `0x${'dd'.repeat(32)}`,
    controller,
    eventTimestamp: new Date(1_750_000_000_000),
    confirmations: 2,
    verificationVersion: 'zeroid.identity.registry-verification.v1',
    did,
  };
}

describe('IdentityService.register', () => {
  let service: IdentityService;
  let wallet: Wallet;
  let order: string[];
  const provider = { tag: 'provider' };

  beforeEach(() => {
    jest.clearAllMocks();
    order = [];
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      ZEROID_AUTH_ORIGIN: ORIGIN,
      AETHELRED_CHAIN_ID: '7332',
      AETHELRED_RPC_URL: 'http://127.0.0.1:8545',
      IDENTITY_REGISTRY_ADDRESS: REGISTRY,
    };
    delete process.env.IDENTITY_RECOVERY_HASH_PEPPER;
    service = new IdentityService();
    wallet = Wallet.createRandom();

    mockIdentityFindUnique.mockImplementation(async () => {
      order.push('findUnique');
      return null;
    });
    mockCreateProvider.mockImplementation(() => {
      order.push('createProvider');
      return provider;
    });
    mockVerifyIdentityRegistration.mockImplementation(async (input) => {
      order.push('verify');
      return evidenceFor(input.controller, input.did);
    });
    mockAssertCanonicalChainSnapshot.mockImplementation(async () => {
      order.push('snapshot');
    });
    mockTransaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        identity: {
          create: async (args: unknown) => {
            order.push('identity.create');
            return mockIdentityCreate(args);
          },
        },
        auditLog: {
          create: async (args: unknown) => {
            order.push('auditLog.create');
            return mockAuditLogCreate(args);
          },
        },
      }),
    );
    mockIdentityCreate.mockImplementation(async ({ data }) => ({
      id: 'identity-1',
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      teeAttested: false,
      governmentVerified: false,
    }));
    mockAuditLogCreate.mockResolvedValue({});
    mockGenerateToken.mockImplementation(async () => {
      order.push('generateToken');
      return { token: 'session-token', sessionId: 'session-1' };
    });
    mockRedisSet.mockResolvedValue('OK');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('verifies, persists registry evidence and issues a session only after commit', async () => {
    const registration = await signedRegistration(wallet);

    const result = await service.register(registration);

    expect(result).toMatchObject({
      token: 'session-token',
      sessionId: 'session-1',
      identity: { did: registration.did, status: 'ACTIVE' },
    });
    expect(order).toEqual([
      'findUnique', // did pre-check
      'findUnique', // registryTxHash replay pre-check
      'findUnique', // registryController replay pre-check
      'createProvider',
      'verify',
      'snapshot',
      'identity.create',
      'auditLog.create',
      'generateToken',
    ]);

    expect(mockVerifyIdentityRegistration).toHaveBeenCalledWith(
      {
        txHash: TX_HASH,
        did: registration.did,
        controller: registration.controller,
        recoveryHash: RECOVERY_HASH,
      },
      expect.objectContaining({ registryAddress: REGISTRY, chainId: 7332n }),
      provider,
    );
    expect(mockAssertCanonicalChainSnapshot).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({ chainId: 7332n }),
      42,
      BLOCK_HASH,
      TX_HASH,
      1,
    );

    const persisted = mockIdentityCreate.mock.calls[0][0].data;
    expect(persisted).toMatchObject({
      did: registration.did,
      recoveryHash: RECOVERY_HASH,
      registryChainId: 7332,
      registryAddress: REGISTRY,
      registryTxHash: TX_HASH,
      registryBlockNumber: 42,
      registryBlockHash: BLOCK_HASH,
      registryDidHash: `0x${'dd'.repeat(32)}`,
      registryController: registration.controller,
      registryEventTimestamp: new Date(1_750_000_000_000),
      registryConfirmations: 2,
      registryVerificationVersion: 'zeroid.identity.registry-verification.v1',
    });
    expect(persisted.registryVerifiedAt).toBeInstanceOf(Date);
    expect(persisted.metadata).toEqual({
      didDocument: { id: registration.did },
      controller: registration.controller,
    });

    expect(mockAuditLogCreate.mock.calls[0][0].data.details).toMatchObject({
      dataSource: 'CHAIN_IDENTITY_REGISTRY',
      txHash: TX_HASH,
      blockNumber: 42,
      blockHash: BLOCK_HASH,
      didHash: `0x${'dd'.repeat(32)}`,
      confirmations: 2,
      registryVerificationVersion: 'zeroid.identity.registry-verification.v1',
    });
    expect(mockGenerateToken).toHaveBeenCalledWith('identity-1', registration.did);
    expect(mockDestroyProvider).toHaveBeenCalledWith(provider);
  });

  it('keeps the session when the cache write fails after commit', async () => {
    mockRedisSet.mockRejectedValue(new Error('redis down'));
    const registration = await signedRegistration(wallet);

    const result = await service.register(registration);

    expect(result.token).toBe('session-token');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'identity_cache_write_failed',
      expect.objectContaining({ identityId: 'identity-1' }),
    );
  });

  it('refuses with 503 and no RPC when the verifier is not configured', async () => {
    delete process.env.IDENTITY_REGISTRY_ADDRESS;
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockVerifyIdentityRegistration).not.toHaveBeenCalled();
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('refuses a DID whose network is not served by the configured chain before proof verification', async () => {
    const registration = await signedRegistration(wallet, 'mainnet');

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_DID_NETWORK_MISMATCH',
      statusCode: 400,
    });
    // Only the DID pre-check ran; no replay checks, proof or RPC work.
    expect(mockIdentityFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockVerifyIdentityRegistration).not.toHaveBeenCalled();
  });

  it('rejects an invalid wallet proof before any registry work', async () => {
    const registration = await signedRegistration(wallet);
    registration.signature = (await Wallet.createRandom().signMessage('other')) as string;

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRATION_PROOF_INVALID',
      statusCode: 401,
    });
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockVerifyIdentityRegistration).not.toHaveBeenCalled();
  });

  it('refuses a replayed transaction hash before constructing a provider', async () => {
    mockIdentityFindUnique.mockImplementation(async ({ where }) =>
      where.registryTxHash ? { id: 'identity-0' } : null,
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_TX_ALREADY_USED',
      statusCode: 409,
    });
    expect(mockCreateProvider).not.toHaveBeenCalled();
    expect(mockVerifyIdentityRegistration).not.toHaveBeenCalled();
  });

  it('refuses a controller that already has a verified identity', async () => {
    mockIdentityFindUnique.mockImplementation(async ({ where }) =>
      where.registryController ? { id: 'identity-0' } : null,
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_CONTROLLER_EXISTS',
      statusCode: 409,
    });
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it('persists nothing and issues no session when the verifier refuses', async () => {
    mockVerifyIdentityRegistration.mockRejectedValue(
      new IdentityRegistryVerificationError(
        'not mined',
        'IDENTITY_REGISTRY_TX_NOT_MINED',
        409,
        true,
      ),
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_TX_NOT_MINED',
      statusCode: 409,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockDestroyProvider).toHaveBeenCalledWith(provider);
  });

  it('aborts the transaction when the persistence-boundary snapshot fails', async () => {
    mockAssertCanonicalChainSnapshot.mockRejectedValue(
      new CanonicalTransactionError('CANONICAL_MISMATCH'),
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_CHAIN_MISMATCH',
      statusCode: 422,
    });
    expect(mockIdentityCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('reports an RPC outage at the persistence boundary as 503', async () => {
    mockAssertCanonicalChainSnapshot.mockRejectedValue(
      new CanonicalTransactionError('RPC_UNAVAILABLE'),
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_RPC_UNAVAILABLE',
      statusCode: 503,
    });
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it.each([
    [['registryTxHash'], 'IDENTITY_REGISTRY_TX_ALREADY_USED'],
    [['registryController'], 'IDENTITY_CONTROLLER_EXISTS'],
    [['registryDidHash'], 'IDENTITY_CONTROLLER_EXISTS'],
    [['did'], 'IDENTITY_DID_EXISTS'],
    ['identities_registryTxHash_key', 'IDENTITY_REGISTRY_TX_ALREADY_USED'],
  ])('maps a P2002 on %s to %s', async (target, code) => {
    mockIdentityCreate.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002', meta: { target } }),
    );
    const registration = await signedRegistration(wallet);

    await expect(service.register(registration)).rejects.toMatchObject({
      code,
      statusCode: 409,
    });
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  it('applies the recovery-hash pepper only to the stored value', async () => {
    process.env.IDENTITY_RECOVERY_HASH_PEPPER = 'p'.repeat(64);
    const registration = await signedRegistration(wallet);

    await service.register(registration);

    expect(mockVerifyIdentityRegistration.mock.calls[0][0].recoveryHash).toBe(RECOVERY_HASH);
    const stored = mockIdentityCreate.mock.calls[0][0].data.recoveryHash;
    expect(stored).not.toBe(RECOVERY_HASH);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });
});
