import {
  assertCanonicalChainSnapshot,
  CanonicalTransactionError,
  getCanonicalTransaction,
  identityRegistryNetworkMatches,
} from '../src/lib/canonical-chain-transaction';

const TX_HASH = `0x${'11'.repeat(32)}`;
const OTHER_TX_HASH = `0x${'22'.repeat(32)}`;
const BLOCK_HASH = `0x${'33'.repeat(32)}`;
const OTHER_BLOCK_HASH = `0x${'44'.repeat(32)}`;
const ANCHOR_HASH = `0x${'aa'.repeat(32)}`;

function fixture() {
  const receipt: any = {
    hash: TX_HASH,
    status: 1,
    blockNumber: 42,
    blockHash: BLOCK_HASH,
    confirmations: jest.fn().mockResolvedValue(3),
  };
  const transaction: any = {
    hash: TX_HASH,
    blockNumber: 42,
    blockHash: BLOCK_HASH,
  };
  const block: any = {
    number: 42,
    hash: BLOCK_HASH,
    timestamp: 1_750_000_000,
  };
  const provider: any = {
    getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
    getTransaction: jest.fn().mockResolvedValue(transaction),
    getBlock: jest.fn().mockResolvedValue(block),
  };
  return { provider, receipt, transaction, block };
}

type Fixture = ReturnType<typeof fixture>;

async function expectReason(
  current: Fixture,
  reason: CanonicalTransactionError['reason'],
) {
  await expect(
    getCanonicalTransaction(current.provider, TX_HASH, 2),
  ).rejects.toMatchObject({ reason });
}

describe('getCanonicalTransaction', () => {
  it('re-fetches after confirmation and returns only mutually consistent canonical evidence', async () => {
    const current = fixture();
    await expect(
      getCanonicalTransaction(current.provider, TX_HASH.toUpperCase(), 2),
    ).resolves.toEqual({
      receipt: current.receipt,
      transaction: current.transaction,
      block: current.block,
      confirmations: 3,
    });
    expect(current.provider.getTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(current.receipt.confirmations).toHaveBeenCalledTimes(2);
    expect(current.provider.getTransaction).toHaveBeenCalledTimes(1);
    expect(current.provider.getBlock).toHaveBeenCalledWith(42);
  });

  it('does not read transaction or canonical block before the required depth', async () => {
    const current = fixture();
    current.receipt.confirmations.mockResolvedValueOnce(1);
    await expectReason(current, 'INSUFFICIENT_CONFIRMATIONS');
    expect(current.provider.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(current.provider.getTransaction).not.toHaveBeenCalled();
    expect(current.provider.getBlock).not.toHaveBeenCalled();
  });

  it('fails closed if the re-fetched receipt loses confirmation depth', async () => {
    const current = fixture();
    current.receipt.confirmations
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    await expectReason(current, 'INSUFFICIENT_CONFIRMATIONS');
    expect(current.provider.getBlock).not.toHaveBeenCalled();
  });

  it('rejects a substituted receipt returned by the post-confirmation re-fetch', async () => {
    const current = fixture();
    current.provider.getTransactionReceipt
      .mockResolvedValueOnce(current.receipt)
      .mockResolvedValueOnce({ ...current.receipt, hash: OTHER_TX_HASH });
    await expectReason(current, 'HASH_MISMATCH');
    expect(current.provider.getBlock).not.toHaveBeenCalled();
  });

  it.each<[string, (f: Fixture) => void, CanonicalTransactionError['reason']]>([
    [
      'missing initial receipt',
      (f) => f.provider.getTransactionReceipt.mockResolvedValueOnce(null),
      'NOT_MINED',
    ],
    [
      'missing canonical receipt',
      (f) =>
        f.provider.getTransactionReceipt
          .mockResolvedValueOnce(f.receipt)
          .mockResolvedValueOnce(null),
      'NOT_MINED',
    ],
    [
      'missing transaction',
      (f) => f.provider.getTransaction.mockResolvedValue(null),
      'NOT_MINED',
    ],
    [
      'wrong receipt hash',
      (f) => {
        f.receipt.hash = OTHER_TX_HASH;
      },
      'HASH_MISMATCH',
    ],
    [
      'wrong transaction hash',
      (f) => {
        f.transaction.hash = OTHER_TX_HASH;
      },
      'HASH_MISMATCH',
    ],
    [
      'reverted receipt',
      (f) => {
        f.receipt.status = 0;
      },
      'REVERTED',
    ],
    [
      'receipt/transaction block-number mismatch',
      (f) => {
        f.transaction.blockNumber = 41;
      },
      'CANONICAL_MISMATCH',
    ],
    [
      'receipt/transaction block-hash mismatch',
      (f) => {
        f.transaction.blockHash = OTHER_BLOCK_HASH;
      },
      'CANONICAL_MISMATCH',
    ],
    [
      'unmined transaction block hash',
      (f) => {
        f.transaction.blockHash = null;
      },
      'CANONICAL_MISMATCH',
    ],
    [
      'canonical block number mismatch',
      (f) => {
        f.block.number = 41;
      },
      'CANONICAL_MISMATCH',
    ],
    [
      'orphaned receipt block',
      (f) => {
        f.block.hash = OTHER_BLOCK_HASH;
      },
      'CANONICAL_MISMATCH',
    ],
    [
      'missing canonical block',
      (f) => f.provider.getBlock.mockResolvedValue(null),
      'BLOCK_NOT_FOUND',
    ],
  ])('rejects %s', async (_label, mutate, reason) => {
    const current = fixture();
    mutate(current);
    await expectReason(current, reason);
  });

  it.each<[string, (f: Fixture) => void]>([
    [
      'initial receipt',
      (f) =>
        f.provider.getTransactionReceipt.mockRejectedValueOnce(
          new Error('offline'),
        ),
    ],
    [
      'receipt confirmation',
      (f) => f.receipt.confirmations.mockRejectedValueOnce(new Error('offline')),
    ],
    [
      'canonical transaction',
      (f) => f.provider.getTransaction.mockRejectedValueOnce(new Error('offline')),
    ],
    [
      'canonical block',
      (f) => f.provider.getBlock.mockRejectedValueOnce(new Error('offline')),
    ],
  ])('maps %s RPC failure without leaking provider details', async (_label, mutate) => {
    const current = fixture();
    mutate(current);
    await expectReason(current, 'RPC_UNAVAILABLE');
  });
});

describe('identityRegistryNetworkMatches', () => {
  it('binds by chain id alone when no anchor is configured', () => {
    expect(
      identityRegistryNetworkMatches({ chainId: 7332n }, { chainId: 7332n }, null),
    ).toBe(true);
    expect(
      identityRegistryNetworkMatches({ chainId: 7332n }, { chainId: 7331n }, null),
    ).toBe(false);
  });

  it('asserts the anchor block hash when configured', () => {
    const config = {
      chainId: 7332n,
      networkAnchorBlock: 1n,
      networkAnchorHash: ANCHOR_HASH,
    };
    expect(
      identityRegistryNetworkMatches(
        config,
        { chainId: 7332n },
        { number: 1, hash: ANCHOR_HASH.toUpperCase() },
      ),
    ).toBe(true);
    expect(
      identityRegistryNetworkMatches(
        config,
        { chainId: 7332n },
        { number: 1, hash: OTHER_BLOCK_HASH },
      ),
    ).toBe(false);
    expect(
      identityRegistryNetworkMatches(
        config,
        { chainId: 7332n },
        { number: 2, hash: ANCHOR_HASH },
      ),
    ).toBe(false);
    expect(identityRegistryNetworkMatches(config, { chainId: 7332n }, null)).toBe(
      false,
    );
  });

  it('refuses a half-configured anchor', () => {
    expect(
      identityRegistryNetworkMatches(
        { chainId: 7332n, networkAnchorHash: ANCHOR_HASH },
        { chainId: 7332n },
        null,
      ),
    ).toBe(false);
    expect(
      identityRegistryNetworkMatches(
        { chainId: 7332n, networkAnchorBlock: 1n },
        { chainId: 7332n },
        { number: 1, hash: ANCHOR_HASH },
      ),
    ).toBe(false);
  });
});

describe('assertCanonicalChainSnapshot', () => {
  function snapshotFixture() {
    const current = fixture();
    current.provider.getNetwork = jest.fn().mockResolvedValue({ chainId: 7332n });
    current.provider.getBlock.mockImplementation((blockTag: number | bigint) =>
      Promise.resolve(
        blockTag === 1n ? { number: 1, hash: ANCHOR_HASH } : current.block,
      ),
    );
    return current;
  }

  const anchored = {
    chainId: 7332n,
    networkAnchorBlock: 1n,
    networkAnchorHash: ANCHOR_HASH,
  };

  it('accepts a consistent snapshot and re-reads receipt depth', async () => {
    const current = snapshotFixture();
    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        anchored,
        42,
        BLOCK_HASH,
        TX_HASH,
        2,
      ),
    ).resolves.toBeUndefined();
    expect(current.provider.getBlock).toHaveBeenCalledWith(1n);
    expect(current.receipt.confirmations).toHaveBeenCalledTimes(1);
  });

  it('does not read the anchor block when no anchor is configured', async () => {
    const current = snapshotFixture();
    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        { chainId: 7332n },
        42,
        BLOCK_HASH,
        TX_HASH,
        2,
      ),
    ).resolves.toBeUndefined();
    expect(current.provider.getBlock).not.toHaveBeenCalledWith(1n);
    expect(current.provider.getBlock).toHaveBeenCalledWith(42);
  });

  it('rejects a chain id mismatch', async () => {
    const current = snapshotFixture();
    current.provider.getNetwork.mockResolvedValue({ chainId: 7331n });
    await expect(
      assertCanonicalChainSnapshot(current.provider, { chainId: 7332n }, 42, BLOCK_HASH),
    ).rejects.toMatchObject({ reason: 'CANONICAL_MISMATCH' });
  });

  it('rejects an anchor hash mismatch when configured', async () => {
    const current = snapshotFixture();
    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        { ...anchored, networkAnchorHash: OTHER_BLOCK_HASH },
        42,
        BLOCK_HASH,
      ),
    ).rejects.toMatchObject({ reason: 'CANONICAL_MISMATCH' });
  });

  it('rejects a receipt whose block no longer matches the verified snapshot', async () => {
    const current = snapshotFixture();
    current.transaction.blockHash = OTHER_BLOCK_HASH;
    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        anchored,
        42,
        BLOCK_HASH,
        TX_HASH,
        2,
      ),
    ).rejects.toMatchObject({ reason: 'CANONICAL_MISMATCH' });
  });

  it('re-reads and enforces receipt depth at the final persistence boundary', async () => {
    const current = snapshotFixture();
    current.receipt.confirmations.mockResolvedValue(1);

    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        anchored,
        42,
        BLOCK_HASH,
        TX_HASH,
        2,
      ),
    ).rejects.toMatchObject({
      reason: 'INSUFFICIENT_CONFIRMATIONS',
      confirmations: 1,
    });
    expect(current.receipt.confirmations).toHaveBeenCalledTimes(1);
  });

  it('keeps a final confirmation RPC failure distinct from shallow depth', async () => {
    const current = snapshotFixture();
    current.receipt.confirmations.mockRejectedValue(new Error('offline'));

    await expect(
      assertCanonicalChainSnapshot(
        current.provider,
        anchored,
        42,
        BLOCK_HASH,
        TX_HASH,
        2,
      ),
    ).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
  });

  it('maps a snapshot read failure to RPC_UNAVAILABLE', async () => {
    const current = snapshotFixture();
    current.provider.getNetwork.mockRejectedValue(new Error('offline'));
    await expect(
      assertCanonicalChainSnapshot(current.provider, anchored, 42, BLOCK_HASH),
    ).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
  });
});
