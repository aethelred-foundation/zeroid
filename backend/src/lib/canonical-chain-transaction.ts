/**
 * Canonical transaction resolution against a JSON-RPC provider.
 *
 * Ported from the NoblePay settlement backend
 * (backend/src/lib/canonical-chain-transaction.ts at
 * 7fbcb696ce37d7f349c01466387f25cc85590449, branch release-work). The receipt,
 * transaction and block cross-checks are kept verbatim; the only change is the
 * network-identity contract, which here makes the immutable anchor block
 * optional so a deployment can bind the network by chain id alone.
 */
import { JsonRpcProvider } from 'ethers';

type MinedReceipt = NonNullable<
  Awaited<ReturnType<JsonRpcProvider['getTransactionReceipt']>>
>;
type MinedTransaction = NonNullable<
  Awaited<ReturnType<JsonRpcProvider['getTransaction']>>
>;
type CanonicalBlock = NonNullable<
  Awaited<ReturnType<JsonRpcProvider['getBlock']>>
>;

export type CanonicalTransactionFailure =
  | 'RPC_UNAVAILABLE'
  | 'NOT_MINED'
  | 'HASH_MISMATCH'
  | 'REVERTED'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'CANONICAL_MISMATCH'
  | 'BLOCK_NOT_FOUND';

export class CanonicalTransactionError extends Error {
  constructor(
    public readonly reason: CanonicalTransactionFailure,
    public readonly confirmations?: number,
  ) {
    super(reason);
    this.name = 'CanonicalTransactionError';
  }
}

export interface CanonicalTransaction {
  receipt: MinedReceipt;
  transaction: MinedTransaction;
  block: CanonicalBlock;
  confirmations: number;
}

/**
 * The network a verifier is allowed to accept evidence from. The chain id is
 * always asserted; the anchor block hash is asserted only when both halves
 * are configured (the deployment runbook records one once it exists).
 */
export interface IdentityRegistryNetworkIdentity {
  chainId: bigint;
  networkAnchorBlock?: bigint;
  networkAnchorHash?: string;
}

export interface RpcAnchorBlock {
  number: bigint | number | string;
  hash?: string | null;
}

export function identityRegistryNetworkMatches(
  config: IdentityRegistryNetworkIdentity,
  network: { chainId: bigint },
  anchorBlock: RpcAnchorBlock | null,
): boolean {
  if (network.chainId !== config.chainId) return false;
  if (config.networkAnchorBlock === undefined) {
    return config.networkAnchorHash === undefined;
  }
  if (!config.networkAnchorHash || !anchorBlock) return false;
  try {
    return (
      BigInt(anchorBlock.number) === config.networkAnchorBlock &&
      anchorBlock.hash?.toLowerCase() === config.networkAnchorHash.toLowerCase()
    );
  } catch {
    return false;
  }
}

function normalizedHash(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function assertReceipt(receipt: MinedReceipt, requestedHash: string): void {
  if (normalizedHash(receipt.hash) !== requestedHash) {
    throw new CanonicalTransactionError('HASH_MISMATCH');
  }
  if (receipt.status !== 1) {
    throw new CanonicalTransactionError('REVERTED');
  }
}

async function receiptConfirmations(receipt: MinedReceipt): Promise<number> {
  try {
    return await receipt.confirmations();
  } catch {
    throw new CanonicalTransactionError('RPC_UNAVAILABLE');
  }
}

/**
 * Resolve a transaction only from a receipt that is still canonical after the
 * configured confirmation depth. The second receipt read is intentional: a
 * receipt observed before the confirmation check may have been orphaned while
 * the chain head advanced.
 */
export async function getCanonicalTransaction(
  provider: JsonRpcProvider,
  transactionHash: string,
  minimumConfirmations: number,
): Promise<CanonicalTransaction> {
  const requestedHash = transactionHash.toLowerCase();
  let initialReceipt: MinedReceipt | null;
  try {
    initialReceipt = await provider.getTransactionReceipt(transactionHash);
  } catch {
    throw new CanonicalTransactionError('RPC_UNAVAILABLE');
  }
  if (!initialReceipt) {
    throw new CanonicalTransactionError('NOT_MINED');
  }
  assertReceipt(initialReceipt, requestedHash);

  const initialConfirmations = await receiptConfirmations(initialReceipt);
  if (initialConfirmations < minimumConfirmations) {
    throw new CanonicalTransactionError(
      'INSUFFICIENT_CONFIRMATIONS',
      initialConfirmations,
    );
  }

  let receipt: MinedReceipt | null;
  let transaction: MinedTransaction | null;
  try {
    [receipt, transaction] = await Promise.all([
      provider.getTransactionReceipt(transactionHash),
      provider.getTransaction(transactionHash),
    ]);
  } catch {
    throw new CanonicalTransactionError('RPC_UNAVAILABLE');
  }
  if (!receipt || !transaction) {
    throw new CanonicalTransactionError('NOT_MINED');
  }
  assertReceipt(receipt, requestedHash);
  if (normalizedHash(transaction.hash) !== requestedHash) {
    throw new CanonicalTransactionError('HASH_MISMATCH');
  }

  const confirmations = await receiptConfirmations(receipt);
  if (confirmations < minimumConfirmations) {
    throw new CanonicalTransactionError(
      'INSUFFICIENT_CONFIRMATIONS',
      confirmations,
    );
  }

  if (
    receipt.blockNumber !== transaction.blockNumber ||
    !receipt.blockHash ||
    normalizedHash(receipt.blockHash) !== normalizedHash(transaction.blockHash)
  ) {
    throw new CanonicalTransactionError('CANONICAL_MISMATCH');
  }

  let block: CanonicalBlock | null;
  try {
    block = await provider.getBlock(receipt.blockNumber);
  } catch {
    throw new CanonicalTransactionError('RPC_UNAVAILABLE');
  }
  if (!block) {
    throw new CanonicalTransactionError('BLOCK_NOT_FOUND');
  }
  if (
    block.number !== receipt.blockNumber ||
    normalizedHash(block.hash) !== normalizedHash(receipt.blockHash)
  ) {
    throw new CanonicalTransactionError('CANONICAL_MISMATCH');
  }

  return { receipt, transaction, block, confirmations };
}

/** Recheck chain identity, immutable anchor and receipt block before writes. */
export function assertCanonicalChainSnapshot(
  provider: JsonRpcProvider,
  identity: IdentityRegistryNetworkIdentity,
  blockNumber: number,
  blockHash: string | null | undefined,
  transactionHash: string,
  minimumConfirmations: number,
): Promise<void>;
export function assertCanonicalChainSnapshot(
  provider: JsonRpcProvider,
  identity: IdentityRegistryNetworkIdentity,
  blockNumber: number,
  blockHash: string | null | undefined,
  transactionHash?: undefined,
  minimumConfirmations?: undefined,
): Promise<void>;
export async function assertCanonicalChainSnapshot(
  provider: JsonRpcProvider,
  identity: IdentityRegistryNetworkIdentity,
  blockNumber: number,
  blockHash: string | null | undefined,
  transactionHash?: string,
  minimumConfirmations?: number,
): Promise<void> {
  let network;
  let anchorBlock: RpcAnchorBlock | null = null;
  let block;
  let receipt: MinedReceipt | null = null;
  let transaction: MinedTransaction | null = null;
  try {
    [network, anchorBlock, block, receipt, transaction] = await Promise.all([
      provider.getNetwork(),
      identity.networkAnchorBlock !== undefined
        ? provider.getBlock(identity.networkAnchorBlock)
        : Promise.resolve(null),
      provider.getBlock(blockNumber),
      transactionHash
        ? provider.getTransactionReceipt(transactionHash)
        : Promise.resolve(null),
      transactionHash
        ? provider.getTransaction(transactionHash)
        : Promise.resolve(null),
    ]);
  } catch {
    throw new CanonicalTransactionError('RPC_UNAVAILABLE');
  }
  if (
    !identityRegistryNetworkMatches(identity, network, anchorBlock) ||
    !block ||
    block.number !== blockNumber ||
    normalizedHash(block.hash) !== normalizedHash(blockHash)
  ) {
    throw new CanonicalTransactionError('CANONICAL_MISMATCH');
  }

  if (transactionHash) {
    const requestedHash = transactionHash.toLowerCase();
    if (
      !receipt ||
      !transaction ||
      normalizedHash(receipt.hash) !== requestedHash ||
      receipt.status !== 1 ||
      normalizedHash(transaction.hash) !== requestedHash ||
      receipt.blockNumber !== blockNumber ||
      transaction.blockNumber !== blockNumber ||
      normalizedHash(receipt.blockHash) !== normalizedHash(blockHash) ||
      normalizedHash(transaction.blockHash) !== normalizedHash(blockHash)
    ) {
      throw new CanonicalTransactionError('CANONICAL_MISMATCH');
    }

    // A receipt can lose depth between the initial verification and the final
    // persistence boundary (for example when the RPC switches to a shorter
    // canonical head). Re-read depth from this final receipt rather than
    // trusting the confirmation count returned by getCanonicalTransaction.
    const confirmations = await receiptConfirmations(receipt);
    if (
      minimumConfirmations === undefined ||
      confirmations < minimumConfirmations
    ) {
      throw new CanonicalTransactionError(
        'INSUFFICIENT_CONFIRMATIONS',
        confirmations,
      );
    }
  }
}
