import { Wallet } from 'ethers';
import {
  resetIdentityRegistryDeploymentCache,
  type IdentityRegistryConfiguration,
} from '../src/lib/identity-registry-config';
import {
  computeRegistryDidHash,
  IDENTITY_REGISTERED_TOPIC,
  IDENTITY_REGISTRY_INTERFACE,
  IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS,
  IDENTITY_REGISTRY_VERIFICATION_VERSION,
  IDENTITY_STATUS_ACTIVE,
  REGISTER_IDENTITY_SELECTOR,
  verifyIdentityRegistration,
} from '../src/services/identity-registry-verification';

const REGISTRY = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const OTHER_CONTRACT = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
const CONTROLLER_WALLET = new Wallet(`0x${'7'.repeat(64)}`);
const CONTROLLER = CONTROLLER_WALLET.address.toLowerCase();
const OTHER_CONTROLLER = `0x${'ab'.repeat(20)}`;
const DID = `did:aethelred:testnet:${CONTROLLER}`;
const DID_HASH = computeRegistryDidHash(DID);
const RECOVERY_HASH = 'c'.repeat(64);
const TX_HASH = `0x${'11'.repeat(32)}`;
const BLOCK_HASH = `0x${'33'.repeat(32)}`;
const ANCHOR_HASH = `0x${'aa'.repeat(32)}`;
const BLOCK_TIMESTAMP = 1_750_000_000;

const CONFIG: IdentityRegistryConfiguration = {
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 7332n,
  registryAddress: REGISTRY,
  minimumConfirmations: 1,
  receiptWaitMs: 15_000,
  allowedDidNetworks: ['testnet', 'devnet'],
};

const RESOLVE_BY_CONTROLLER_SELECTOR =
  IDENTITY_REGISTRY_INTERFACE.getFunction('resolveByController')!.selector;
const RESOLVE_IDENTITY_SELECTOR =
  IDENTITY_REGISTRY_INTERFACE.getFunction('resolveIdentity')!.selector;

function registeredLog(
  overrides: { address?: string; controller?: string; timestamp?: number; didHash?: string } = {},
) {
  const encoded = IDENTITY_REGISTRY_INTERFACE.encodeEventLog('IdentityRegistered', [
    overrides.didHash ?? DID_HASH,
    overrides.controller ?? CONTROLLER,
    BigInt(overrides.timestamp ?? BLOCK_TIMESTAMP),
  ]);
  return {
    address: overrides.address ?? REGISTRY,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function registerCalldata(didHash = DID_HASH, recoveryHash = `0x${RECOVERY_HASH}`) {
  return IDENTITY_REGISTRY_INTERFACE.encodeFunctionData('registerIdentity', [
    didHash,
    recoveryHash,
  ]);
}

function identityTuple(
  overrides: Partial<{
    controller: string;
    status: number;
    recoveryHash: string;
  }> = {},
) {
  return [
    DID_HASH,
    overrides.controller ?? CONTROLLER,
    BigInt(BLOCK_TIMESTAMP),
    BigInt(BLOCK_TIMESTAMP),
    overrides.status ?? IDENTITY_STATUS_ACTIVE,
    overrides.recoveryHash ?? `0x${RECOVERY_HASH}`,
    0,
    0,
  ];
}

function callException() {
  return Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
}

function fixture() {
  const receipt: any = {
    hash: TX_HASH,
    status: 1,
    blockNumber: 42,
    blockHash: BLOCK_HASH,
    logs: [registeredLog()],
    confirmations: jest.fn().mockResolvedValue(2),
  };
  const transaction: any = {
    hash: TX_HASH,
    from: CONTROLLER_WALLET.address,
    to: REGISTRY.toUpperCase().replace('0X', '0x'),
    data: registerCalldata(),
    blockNumber: 42,
    blockHash: BLOCK_HASH,
  };
  const block: any = { number: 42, hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP };
  const anchorBlock: any = { number: 1, hash: ANCHOR_HASH };
  const views = {
    resolveByController: DID_HASH,
    resolveIdentity: identityTuple(),
  };
  const provider: any = {
    _getConnection: () => ({ url: CONFIG.rpcUrl }),
    getCode: jest.fn().mockResolvedValue('0x6080'),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 7332n }),
    getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
    getTransaction: jest.fn().mockResolvedValue(transaction),
    getBlock: jest.fn((tag: number | bigint) =>
      Promise.resolve(tag === 1n ? anchorBlock : block),
    ),
    call: jest.fn(async (request: { to: string; data: string }) => {
      const selector = request.data.slice(0, 10);
      if (selector === RESOLVE_BY_CONTROLLER_SELECTOR) {
        return IDENTITY_REGISTRY_INTERFACE.encodeFunctionResult('resolveByController', [
          views.resolveByController,
        ]);
      }
      if (selector === RESOLVE_IDENTITY_SELECTOR) {
        return IDENTITY_REGISTRY_INTERFACE.encodeFunctionResult('resolveIdentity', [
          views.resolveIdentity,
        ]);
      }
      throw new Error(`unexpected call ${selector}`);
    }),
    destroy: jest.fn(),
  };
  return { provider, receipt, transaction, block, anchorBlock, views };
}

type Fixture = ReturnType<typeof fixture>;

function verify(current: Fixture, overrides: Partial<IdentityRegistryConfiguration> = {}) {
  let clock = 0;
  const sleep = jest.fn(async (ms: number) => {
    clock += ms;
  });
  const promise = verifyIdentityRegistration(
    { txHash: TX_HASH, did: DID, controller: CONTROLLER, recoveryHash: RECOVERY_HASH },
    { ...CONFIG, ...overrides },
    current.provider,
    { sleep, now: () => clock },
  );
  return Object.assign(promise, { sleep });
}

beforeEach(() => resetIdentityRegistryDeploymentCache());

describe('verifyIdentityRegistration', () => {
  it('pins the ABI surface the verifier relies on', () => {
    expect(REGISTER_IDENTITY_SELECTOR).toBe('0x3ffb0036');
    expect(RESOLVE_BY_CONTROLLER_SELECTOR).toBe('0x274124d3');
    expect(IDENTITY_REGISTERED_TOPIC).toBe(
      '0x79c1aabf34648938e33bd2bfd9cf03443f66796c2efdc5c9ff9d48a63bd927f4',
    );
    expect(IDENTITY_STATUS_ACTIVE).toBe(1);
    // The Identity tuple decodes with uint32 credentialCount / uint32 nonce.
    const encoded = IDENTITY_REGISTRY_INTERFACE.encodeFunctionResult('resolveIdentity', [
      identityTuple(),
    ]);
    expect(encoded.length).toBe(2 + 8 * 64);
  });

  it('computes didHash from the normalized DID string only', () => {
    expect(
      computeRegistryDidHash('did:aethelred:testnet:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'),
    ).toBe('0xc9233cf0daf09067e818f22a66a8f6ec1c1e325d8d24feacecbd738052841c39');
  });

  it('returns verified evidence for a canonical registerIdentity receipt', async () => {
    const current = fixture();
    await expect(verify(current)).resolves.toEqual({
      dataSource: 'CHAIN_IDENTITY_REGISTRY',
      chainId: 7332,
      registryAddress: REGISTRY,
      txHash: TX_HASH,
      blockNumber: 42,
      blockHash: BLOCK_HASH,
      didHash: DID_HASH,
      controller: CONTROLLER,
      eventTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
      confirmations: 2,
      verificationVersion: IDENTITY_REGISTRY_VERIFICATION_VERSION,
    });
    expect(current.provider.getCode).toHaveBeenCalledWith(REGISTRY);
    expect(current.provider.getNetwork).toHaveBeenCalled();
    expect(current.provider.call).toHaveBeenCalledTimes(2);
    expect(current.provider.call).toHaveBeenCalledWith(
      expect.objectContaining({ to: REGISTRY, blockTag: 'latest' }),
    );
  });

  it('accepts checksum-cased chain values and a mixed-case tx hash', async () => {
    const current = fixture();
    current.receipt.logs = [registeredLog({ address: REGISTRY.toUpperCase().replace('0X', '0x') })];
    await expect(
      verifyIdentityRegistration(
        {
          txHash: TX_HASH.toUpperCase().replace('0X', '0x'),
          did: DID,
          controller: CONTROLLER_WALLET.address,
          recoveryHash: RECOVERY_HASH.toUpperCase(),
        },
        CONFIG,
        current.provider,
        { sleep: async () => {}, now: () => 0 },
      ),
    ).resolves.toMatchObject({ txHash: TX_HASH, controller: CONTROLLER });
  });

  it('asserts the anchor block when configured', async () => {
    const current = fixture();
    await expect(
      verify(current, { networkAnchorBlock: 1n, networkAnchorHash: ANCHOR_HASH }),
    ).resolves.toMatchObject({ didHash: DID_HASH });
    expect(current.provider.getBlock).toHaveBeenCalledWith(1n);
    current.anchorBlock.hash = `0x${'bb'.repeat(32)}`;
    await expect(
      verify(current, { networkAnchorBlock: 1n, networkAnchorHash: ANCHOR_HASH }),
    ).rejects.toMatchObject({ code: 'IDENTITY_REGISTRY_CHAIN_MISMATCH', statusCode: 422 });
  });

  it('refuses when the registry address holds no code', async () => {
    const current = fixture();
    current.provider.getCode.mockResolvedValue('0x');
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(current.provider.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('maps an unreachable RPC to 503 without leaking transport details', async () => {
    const current = fixture();
    current.provider.getCode.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1'));
    const error = await verify(current).catch((e) => e);
    expect(error).toMatchObject({ code: 'IDENTITY_REGISTRY_RPC_UNAVAILABLE', statusCode: 503 });
    expect(error.message).not.toContain('10.0.0.1');

    const later = fixture();
    later.provider.getNetwork.mockRejectedValue(new Error('offline'));
    await expect(verify(later)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_RPC_UNAVAILABLE',
    });
  });

  it('polls within the receipt window and answers 409 retryable once it elapses', async () => {
    const current = fixture();
    current.provider.getTransactionReceipt.mockResolvedValue(null);
    const attempt = verify(current);
    await expect(attempt).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_TX_NOT_MINED',
      statusCode: 409,
      retryable: true,
    });
    // One initial read plus one read after each in-window sleep: the poll
    // never sleeps past the configured window.
    const expectedSleeps = Math.floor(
      CONFIG.receiptWaitMs / IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS,
    );
    expect(attempt.sleep).toHaveBeenCalledTimes(expectedSleeps);
    expect(attempt.sleep).toHaveBeenCalledWith(IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS);
    expect(current.provider.getTransactionReceipt).toHaveBeenCalledTimes(expectedSleeps + 1);
  });

  it('does not sleep at all when the receipt window is zero', async () => {
    const current = fixture();
    current.provider.getTransactionReceipt.mockResolvedValue(null);
    const attempt = verify(current, { receiptWaitMs: 0 });
    await expect(attempt).rejects.toMatchObject({ code: 'IDENTITY_REGISTRY_TX_NOT_MINED' });
    expect(attempt.sleep).not.toHaveBeenCalled();
  });

  it('answers 409 retryable when confirmations stay below the minimum', async () => {
    const current = fixture();
    current.receipt.confirmations.mockResolvedValue(0);
    await expect(verify(current, { receiptWaitMs: 3_000 })).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_TX_NOT_CONFIRMED',
      statusCode: 409,
      retryable: true,
    });
  });

  it('succeeds when the receipt appears within the window', async () => {
    const current = fixture();
    current.provider.getTransactionReceipt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(current.receipt);
    const attempt = verify(current);
    await expect(attempt).resolves.toMatchObject({ didHash: DID_HASH });
    expect(attempt.sleep).toHaveBeenCalledTimes(2);
  });

  it('refuses a reverted transaction', async () => {
    const current = fixture();
    current.receipt.status = 0;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_TX_REVERTED',
      statusCode: 422,
      retryable: false,
    });
  });

  it('refuses a chain id mismatch', async () => {
    const current = fixture();
    current.provider.getNetwork.mockResolvedValue({ chainId: 7331n });
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_CHAIN_MISMATCH',
      statusCode: 422,
    });
  });

  it('refuses non-canonical receipt evidence', async () => {
    const current = fixture();
    current.transaction.blockHash = `0x${'44'.repeat(32)}`;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_CHAIN_MISMATCH',
    });
  });

  it('refuses a transaction that targets another contract', async () => {
    const current = fixture();
    current.transaction.to = OTHER_CONTRACT;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_WRONG_TARGET',
      statusCode: 422,
    });
    current.transaction.to = null;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_WRONG_TARGET',
    });
  });

  it('refuses a transaction sent by someone other than the controller', async () => {
    const current = fixture();
    current.transaction.from = OTHER_CONTROLLER;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_SENDER_MISMATCH',
      statusCode: 422,
    });
  });

  it('refuses batchRegister and any other function', async () => {
    const current = fixture();
    const batchSelector = '0xd6ffa4be';
    current.transaction.data = `${batchSelector}${'0'.repeat(64)}`;
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_WRONG_FUNCTION',
      statusCode: 422,
    });
  });

  it('refuses calldata whose arguments differ from the request', async () => {
    const wrongDid = fixture();
    wrongDid.transaction.data = registerCalldata(`0x${'55'.repeat(32)}`);
    await expect(verify(wrongDid)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_ARGUMENT_MISMATCH',
      statusCode: 422,
    });

    const wrongRecovery = fixture();
    wrongRecovery.transaction.data = registerCalldata(DID_HASH, `0x${'d'.repeat(64)}`);
    await expect(verify(wrongRecovery)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_ARGUMENT_MISMATCH',
    });

    const truncated = fixture();
    truncated.transaction.data = `${REGISTER_IDENTITY_SELECTOR}${'0'.repeat(10)}`;
    await expect(verify(truncated)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_ARGUMENT_MISMATCH',
    });
  });

  it('requires exactly one IdentityRegistered event from the registry for this DID', async () => {
    const missing = fixture();
    missing.receipt.logs = [];
    await expect(verify(missing)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISSING',
      statusCode: 422,
    });

    const foreign = fixture();
    foreign.receipt.logs = [registeredLog({ address: OTHER_CONTRACT })];
    await expect(verify(foreign)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISSING',
    });

    const otherDid = fixture();
    otherDid.receipt.logs = [registeredLog({ didHash: `0x${'55'.repeat(32)}` })];
    await expect(verify(otherDid)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISSING',
    });

    const duplicated = fixture();
    duplicated.receipt.logs = [registeredLog(), registeredLog()];
    await expect(verify(duplicated)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISMATCH',
      statusCode: 422,
    });
  });

  it('refuses an event whose controller or timestamp disagrees with the chain', async () => {
    const controller = fixture();
    controller.receipt.logs = [registeredLog({ controller: OTHER_CONTROLLER })];
    await expect(verify(controller)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISMATCH',
    });

    const timestamp = fixture();
    timestamp.receipt.logs = [registeredLog({ timestamp: BLOCK_TIMESTAMP + 1 })];
    await expect(verify(timestamp)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_EVENT_MISMATCH',
    });
  });

  it('cross-checks resolveByController and resolveIdentity', async () => {
    const unbound = fixture();
    unbound.views.resolveByController = `0x${'0'.repeat(64)}`;
    await expect(verify(unbound)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_STATE_MISMATCH',
      statusCode: 422,
    });

    const reverted = fixture();
    reverted.provider.call.mockImplementation(async (request: { data: string }) => {
      if (request.data.startsWith(RESOLVE_IDENTITY_SELECTOR)) throw callException();
      return IDENTITY_REGISTRY_INTERFACE.encodeFunctionResult('resolveByController', [DID_HASH]);
    });
    await expect(verify(reverted)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_STATE_MISMATCH',
    });

    const wrongController = fixture();
    wrongController.views.resolveIdentity = identityTuple({ controller: OTHER_CONTROLLER });
    await expect(verify(wrongController)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_STATE_MISMATCH',
    });

    const suspended = fixture();
    suspended.views.resolveIdentity = identityTuple({ status: 2 });
    await expect(verify(suspended)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_STATE_MISMATCH',
    });

    const recovery = fixture();
    recovery.views.resolveIdentity = identityTuple({ recoveryHash: `0x${'d'.repeat(64)}` });
    await expect(verify(recovery)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_STATE_MISMATCH',
    });
  });

  it('maps a view transport failure to 503', async () => {
    const current = fixture();
    current.provider.call.mockRejectedValue(new Error('socket hang up'));
    await expect(verify(current)).rejects.toMatchObject({
      code: 'IDENTITY_REGISTRY_RPC_UNAVAILABLE',
      statusCode: 503,
    });
  });
});
