import { Wallet } from 'ethers';

const mockIdentityFindFirst = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockGenerateToken = jest.fn();
const mockRevokeToken = jest.fn();
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const challengeStore = new Map<string, string>();

const mockRedisSet = jest.fn(
  async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && challengeStore.has(key)) return null;
    challengeStore.set(key, value);
    return 'OK';
  },
);
const mockRedisEval = jest.fn(
  async (_script: string, _keyCount: number, key: string) => {
    const value = challengeStore.get(key) ?? null;
    challengeStore.delete(key);
    return value;
  },
);

jest.mock('../src/runtime', () => ({
  prisma: {
    identity: {
      findFirst: mockIdentityFindFirst,
      findUnique: mockIdentityFindUnique,
    },
    auditLog: { create: mockAuditLogCreate },
  },
  redis: {
    set: mockRedisSet,
    eval: mockRedisEval,
  },
  logger: mockLogger,
}));

jest.mock('../src/middleware/auth', () => ({
  generateToken: mockGenerateToken,
  revokeToken: mockRevokeToken,
}));

import {
  IdentityAuthError,
  IdentityAuthService,
} from '../src/services/identity-auth';

const ORIGINAL_ENV = { ...process.env };

function identityFor(wallet: Wallet, status = 'ACTIVE') {
  return {
    id: 'identity-1',
    did: `did:aethelred:testnet:${wallet.address.toLowerCase()}`,
    status,
  };
}

describe('IdentityAuthService', () => {
  let service: IdentityAuthService;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      ZEROID_AUTH_ORIGIN: 'https://zeroid.test',
      AETHELRED_CHAIN_ID: '7332',
    };
    challengeStore.clear();
    jest.clearAllMocks();
    service = new IdentityAuthService();
    mockAuditLogCreate.mockResolvedValue({});
    mockGenerateToken.mockResolvedValue({
      token: 'access-token',
      sessionId: 'session-1',
    });
    mockRevokeToken.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('issues and atomically consumes a wallet-bound sign-in challenge', async () => {
    const wallet = Wallet.createRandom();
    const identity = identityFor(wallet);
    mockIdentityFindFirst.mockResolvedValue(identity);
    mockIdentityFindUnique.mockResolvedValue(identity);

    const challenge = await service.createChallenge(wallet.address);
    expect(challenge.challengeId).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.message).toContain(wallet.address.toLowerCase());
    expect(challenge.message).toContain('URI: https://zeroid.test');
    expect(challenge.message).toContain('Chain ID: 7332');
    expect(challenge.message).toContain(identity.did);
    expect(mockRedisSet).toHaveBeenCalledWith(
      `identity:auth:challenge:${challenge.challengeId}`,
      expect.any(String),
      'EX',
      300,
      'NX',
    );

    const signature = await wallet.signMessage(challenge.message);
    await expect(
      service.authenticate({
        challengeId: challenge.challengeId,
        signature,
      }),
    ).resolves.toMatchObject({
      token: 'access-token',
      sessionId: 'session-1',
      identity,
    });
    expect(mockGenerateToken).toHaveBeenCalledWith(identity.id, identity.did);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: identity.id,
        action: 'AUTH_LOGIN',
        resourceId: 'session-1',
      }),
    });

    await expect(
      service.authenticate({
        challengeId: challenge.challengeId,
        signature,
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_AUTH_CHALLENGE_INVALID',
      statusCode: 401,
    });
  });

  it('rejects a signature from a different wallet and consumes the challenge', async () => {
    const controller = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const identity = identityFor(controller);
    mockIdentityFindFirst.mockResolvedValue(identity);
    mockIdentityFindUnique.mockResolvedValue(identity);

    const challenge = await service.createChallenge(controller.address);
    const attackerSignature = await attacker.signMessage(challenge.message);

    await expect(
      service.authenticate({
        challengeId: challenge.challengeId,
        signature: attackerSignature,
      }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_AUTH_SIGNATURE_INVALID',
      statusCode: 401,
    });
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(challengeStore).toHaveProperty('size', 0);
  });

  it('rejects inactive identities before creating a challenge', async () => {
    const wallet = Wallet.createRandom();
    mockIdentityFindFirst.mockResolvedValue(identityFor(wallet, 'SUSPENDED'));

    await expect(service.createChallenge(wallet.address)).rejects.toMatchObject({
      code: 'IDENTITY_AUTH_IDENTITY_INACTIVE',
      statusCode: 403,
    });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('fails closed when a production authentication origin is missing', async () => {
    const wallet = Wallet.createRandom();
    mockIdentityFindFirst.mockResolvedValue(identityFor(wallet));
    process.env.NODE_ENV = 'production';
    delete process.env.ZEROID_AUTH_ORIGIN;

    await expect(service.createChallenge(wallet.address)).rejects.toEqual(
      expect.objectContaining<Partial<IdentityAuthError>>({
        code: 'IDENTITY_AUTH_NOT_CONFIGURED',
        statusCode: 503,
      }),
    );
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('revokes a newly-created session when durable login audit fails', async () => {
    const wallet = Wallet.createRandom();
    const identity = identityFor(wallet);
    mockIdentityFindFirst.mockResolvedValue(identity);
    mockIdentityFindUnique.mockResolvedValue(identity);
    mockAuditLogCreate.mockRejectedValue(new Error('audit store unavailable'));

    const challenge = await service.createChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge.message);

    await expect(
      service.authenticate({ challengeId: challenge.challengeId, signature }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_AUTH_AUDIT_FAILED',
      statusCode: 503,
    });
    expect(mockRevokeToken).toHaveBeenCalledWith('session-1');
  });
});
