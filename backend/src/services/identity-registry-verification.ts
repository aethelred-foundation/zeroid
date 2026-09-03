/**
 * Server-side verification of a ZeroID registerIdentity transaction.
 *
 * The browser submits the transaction and reports its hash; nothing else it
 * says about the chain is trusted. This module binds the hash to the request
 * (DID, controller, recovery hash) by reading the receipt, the transaction,
 * the containing block, the emitted IdentityRegistered event and the
 * registry's own view functions from the API's configured JSON-RPC node.
 * Every check fails closed with a stable code; none of them fall back to an
 * unverified registration.
 */
import { Interface, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import {
  CanonicalTransactionError,
  getCanonicalTransaction,
  identityRegistryNetworkMatches,
  type CanonicalTransaction,
} from '../lib/canonical-chain-transaction';
import {
  ensureIdentityRegistryDeployed,
  IdentityRegistryConfigurationError,
  IdentityRegistryRpcError,
  type IdentityRegistryConfiguration,
} from '../lib/identity-registry-config';

/**
 * The exact ABI surface the verifier depends on. The Identity tuple mirrors
 * contracts/interfaces/IZeroID.sol (uint32 credentialCount, uint32 nonce).
 */
export const IDENTITY_REGISTRY_INTERFACE = new Interface([
  'event IdentityRegistered(bytes32 indexed didHash,address indexed controller,uint64 timestamp)',
  'function registerIdentity(bytes32 didHash,bytes32 recoveryHash)',
  'function resolveByController(address controller) view returns (bytes32)',
  'function resolveIdentity(bytes32 didHash) view returns (tuple(bytes32 didHash,address controller,uint64 createdAt,uint64 updatedAt,uint8 status,bytes32 recoveryHash,uint32 credentialCount,uint32 nonce))',
]);

/** IdentityStatus.Active — enum IdentityStatus { Inactive, Active, Suspended, Revoked } (IZeroID.sol). */
export const IDENTITY_STATUS_ACTIVE = 1;

export const IDENTITY_REGISTRY_VERIFICATION_VERSION =
  'zeroid.identity.registry-verification.v1';

/** Poll cadence for the bounded server-side receipt wait. */
export const IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS = 1_500;

const REGISTER_IDENTITY_FRAGMENT =
  IDENTITY_REGISTRY_INTERFACE.getFunction('registerIdentity')!;
const IDENTITY_REGISTERED_FRAGMENT =
  IDENTITY_REGISTRY_INTERFACE.getEvent('IdentityRegistered')!;

export const REGISTER_IDENTITY_SELECTOR = REGISTER_IDENTITY_FRAGMENT.selector;
export const IDENTITY_REGISTERED_TOPIC = IDENTITY_REGISTERED_FRAGMENT.topicHash;

export type IdentityRegistryVerificationFailure =
  | 'IDENTITY_REGISTRY_NOT_CONFIGURED'
  | 'IDENTITY_REGISTRY_RPC_UNAVAILABLE'
  | 'IDENTITY_REGISTRY_TX_NOT_MINED'
  | 'IDENTITY_REGISTRY_TX_NOT_CONFIRMED'
  | 'IDENTITY_REGISTRY_TX_REVERTED'
  | 'IDENTITY_REGISTRY_CHAIN_MISMATCH'
  | 'IDENTITY_REGISTRY_WRONG_TARGET'
  | 'IDENTITY_REGISTRY_SENDER_MISMATCH'
  | 'IDENTITY_REGISTRY_WRONG_FUNCTION'
  | 'IDENTITY_REGISTRY_ARGUMENT_MISMATCH'
  | 'IDENTITY_REGISTRY_EVENT_MISSING'
  | 'IDENTITY_REGISTRY_EVENT_MISMATCH'
  | 'IDENTITY_REGISTRY_STATE_MISMATCH';

export class IdentityRegistryVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: IdentityRegistryVerificationFailure,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'IdentityRegistryVerificationError';
  }
}

export interface IdentityRegistryVerificationInput {
  /** 0x-prefixed 32-byte transaction hash (any case). */
  txHash: string;
  /** Normalized DID: did:aethelred:<network>:<0x-lowercase-address>. */
  did: string;
  /** Lowercase controller address that signed the registration proof. */
  controller: string;
  /** Plaintext (pre-pepper) recovery hash as bare 64-hex. */
  recoveryHash: string;
}

export interface VerifiedIdentityRegistration {
  dataSource: 'CHAIN_IDENTITY_REGISTRY';
  chainId: number;
  registryAddress: string;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  didHash: string;
  controller: string;
  eventTimestamp: Date;
  confirmations: number;
  verificationVersion: string;
}

export interface IdentityRegistryVerificationOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * didHash is an off-chain convention shared with the browser: the keccak256 of
 * the UTF-8 bytes of the normalized DID string. The contract stores whatever
 * bytes32 it is given, so the server recomputes it and never accepts a
 * client-supplied value.
 */
export function computeRegistryDidHash(normalizedDid: string): string {
  return keccak256(toUtf8Bytes(normalizedDid)).toLowerCase();
}

function lower(value: string | null | undefined): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function failure(
  message: string,
  code: IdentityRegistryVerificationFailure,
  statusCode = 422,
  retryable = false,
): IdentityRegistryVerificationError {
  return new IdentityRegistryVerificationError(
    message,
    code,
    statusCode,
    retryable,
  );
}

function rpcUnavailable(): IdentityRegistryVerificationError {
  return failure(
    'The identity registry RPC is unavailable',
    'IDENTITY_REGISTRY_RPC_UNAVAILABLE',
    503,
  );
}

export function mapCanonicalFailure(
  error: CanonicalTransactionError,
  config: IdentityRegistryConfiguration,
): IdentityRegistryVerificationError {
  switch (error.reason) {
    case 'NOT_MINED':
      return failure(
        'The registry transaction has not been mined on the verification RPC yet; retry shortly',
        'IDENTITY_REGISTRY_TX_NOT_MINED',
        409,
        true,
      );
    case 'INSUFFICIENT_CONFIRMATIONS':
      return failure(
        `The registry transaction has ${error.confirmations ?? 0} confirmation(s); ${config.minimumConfirmations} required. Retry shortly`,
        'IDENTITY_REGISTRY_TX_NOT_CONFIRMED',
        409,
        true,
      );
    case 'REVERTED':
      return failure(
        'The registry transaction reverted on-chain; no identity was registered',
        'IDENTITY_REGISTRY_TX_REVERTED',
      );
    case 'RPC_UNAVAILABLE':
      return rpcUnavailable();
    default:
      return failure(
        'The registry transaction is not canonical on the configured chain',
        'IDENTITY_REGISTRY_CHAIN_MISMATCH',
      );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded server-side wait for the receipt. Only NOT_MINED and
 * INSUFFICIENT_CONFIRMATIONS are retried; every other failure is final.
 */
async function waitForCanonicalRegistration(
  provider: JsonRpcProvider,
  txHash: string,
  config: IdentityRegistryConfiguration,
  options: IdentityRegistryVerificationOptions,
): Promise<CanonicalTransaction> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();

  for (;;) {
    try {
      return await getCanonicalTransaction(
        provider,
        txHash,
        config.minimumConfirmations,
      );
    } catch (error) {
      if (!(error instanceof CanonicalTransactionError)) throw error;
      const retryable =
        error.reason === 'NOT_MINED' ||
        error.reason === 'INSUFFICIENT_CONFIRMATIONS';
      const elapsed = now() - startedAt;
      if (
        !retryable ||
        elapsed + IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS >
          config.receiptWaitMs
      ) {
        throw mapCanonicalFailure(error, config);
      }
      await sleep(IDENTITY_REGISTRY_RECEIPT_POLL_INTERVAL_MS);
    }
  }
}

async function assertChainIdentity(
  provider: JsonRpcProvider,
  config: IdentityRegistryConfiguration,
): Promise<void> {
  let network: { chainId: bigint };
  let anchorBlock: { number: number; hash: string | null } | null = null;
  try {
    [network, anchorBlock] = await Promise.all([
      provider.getNetwork(),
      config.networkAnchorBlock !== undefined
        ? provider.getBlock(config.networkAnchorBlock)
        : Promise.resolve(null),
    ]);
  } catch {
    throw rpcUnavailable();
  }
  if (!identityRegistryNetworkMatches(config, network, anchorBlock)) {
    throw failure(
      'The verification RPC does not serve the configured Aethelred network',
      'IDENTITY_REGISTRY_CHAIN_MISMATCH',
    );
  }
}

function assertTransactionBinding(
  canonical: CanonicalTransaction,
  config: IdentityRegistryConfiguration,
  input: IdentityRegistryVerificationInput,
  expectedDidHash: string,
): void {
  const { transaction } = canonical;

  if (lower(transaction.to) !== config.registryAddress) {
    throw failure(
      'The transaction did not target the configured identity registry',
      'IDENTITY_REGISTRY_WRONG_TARGET',
    );
  }
  if (lower(transaction.from) !== input.controller) {
    throw failure(
      'The transaction was not sent by the identity controller',
      'IDENTITY_REGISTRY_SENDER_MISMATCH',
    );
  }

  const data = lower(transaction.data);
  if (data.slice(0, 10) !== REGISTER_IDENTITY_SELECTOR) {
    throw failure(
      'The transaction did not call registerIdentity(bytes32,bytes32)',
      'IDENTITY_REGISTRY_WRONG_FUNCTION',
    );
  }

  let args: ReadonlyArray<unknown>;
  try {
    args = IDENTITY_REGISTRY_INTERFACE.decodeFunctionData(
      REGISTER_IDENTITY_FRAGMENT,
      data,
    );
  } catch {
    throw failure(
      'The registerIdentity calldata could not be decoded',
      'IDENTITY_REGISTRY_ARGUMENT_MISMATCH',
    );
  }
  const [calldataDidHash, calldataRecoveryHash] = args as [string, string];
  if (
    lower(calldataDidHash) !== expectedDidHash ||
    lower(calldataRecoveryHash) !== `0x${input.recoveryHash}`
  ) {
    throw failure(
      'The registerIdentity arguments do not match this registration request',
      'IDENTITY_REGISTRY_ARGUMENT_MISMATCH',
    );
  }
}

function assertRegisteredEvent(
  canonical: CanonicalTransaction,
  config: IdentityRegistryConfiguration,
  input: IdentityRegistryVerificationInput,
  expectedDidHash: string,
): bigint {
  const matching = canonical.receipt.logs.filter(
    (log) =>
      lower(log.address) === config.registryAddress &&
      lower(log.topics[0]) === IDENTITY_REGISTERED_TOPIC &&
      lower(log.topics[1]) === expectedDidHash,
  );
  if (matching.length === 0) {
    throw failure(
      'The receipt carries no IdentityRegistered event for this DID from the configured registry',
      'IDENTITY_REGISTRY_EVENT_MISSING',
    );
  }
  if (matching.length > 1) {
    throw failure(
      'The receipt carries more than one IdentityRegistered event for this DID',
      'IDENTITY_REGISTRY_EVENT_MISMATCH',
    );
  }

  let parsed;
  try {
    parsed = IDENTITY_REGISTRY_INTERFACE.parseLog({
      topics: [...matching[0].topics],
      data: matching[0].data,
    });
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.name !== 'IdentityRegistered') {
    throw failure(
      'The IdentityRegistered event could not be decoded',
      'IDENTITY_REGISTRY_EVENT_MISMATCH',
    );
  }

  const eventController = lower(parsed.args.controller as string);
  const eventTimestamp = parsed.args.timestamp as bigint;
  if (eventController !== input.controller) {
    throw failure(
      'The IdentityRegistered event names a different controller',
      'IDENTITY_REGISTRY_EVENT_MISMATCH',
    );
  }
  if (Number(eventTimestamp) !== canonical.block.timestamp) {
    throw failure(
      'The IdentityRegistered event timestamp does not match its block',
      'IDENTITY_REGISTRY_EVENT_MISMATCH',
    );
  }
  return eventTimestamp;
}

function isCallException(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'CALL_EXCEPTION';
}

function stateMismatch(detail: string): IdentityRegistryVerificationError {
  return failure(
    `The registry state does not match this registration: ${detail}`,
    'IDENTITY_REGISTRY_STATE_MISMATCH',
  );
}

async function readRegistry(
  provider: JsonRpcProvider,
  config: IdentityRegistryConfiguration,
  functionName: 'resolveByController' | 'resolveIdentity',
  args: unknown[],
): Promise<string> {
  const data = IDENTITY_REGISTRY_INTERFACE.encodeFunctionData(
    functionName,
    args,
  );
  try {
    return await provider.call({
      to: config.registryAddress,
      data,
      blockTag: 'latest',
    });
  } catch (error) {
    if (isCallException(error)) {
      throw stateMismatch(`${functionName} reverted`);
    }
    throw rpcUnavailable();
  }
}

async function assertRegistryState(
  provider: JsonRpcProvider,
  config: IdentityRegistryConfiguration,
  input: IdentityRegistryVerificationInput,
  expectedDidHash: string,
): Promise<void> {
  const controllerRaw = await readRegistry(
    provider,
    config,
    'resolveByController',
    [input.controller],
  );
  let boundDidHash: string;
  try {
    [boundDidHash] = IDENTITY_REGISTRY_INTERFACE.decodeFunctionResult(
      'resolveByController',
      controllerRaw,
    ) as unknown as [string];
  } catch {
    throw stateMismatch('resolveByController returned no value');
  }
  if (lower(boundDidHash) !== expectedDidHash) {
    throw stateMismatch('the controller is not bound to this DID');
  }

  const identityRaw = await readRegistry(provider, config, 'resolveIdentity', [
    expectedDidHash,
  ]);
  let identity: {
    controller: string;
    status: bigint;
    recoveryHash: string;
  };
  try {
    const [decoded] = IDENTITY_REGISTRY_INTERFACE.decodeFunctionResult(
      'resolveIdentity',
      identityRaw,
    ) as unknown as [
      { controller: string; status: bigint; recoveryHash: string },
    ];
    identity = decoded;
  } catch {
    throw stateMismatch('resolveIdentity returned no identity');
  }
  if (lower(identity.controller) !== input.controller) {
    throw stateMismatch('the on-chain identity has a different controller');
  }
  if (Number(identity.status) !== IDENTITY_STATUS_ACTIVE) {
    throw stateMismatch('the on-chain identity is not active');
  }
  if (lower(identity.recoveryHash) !== `0x${input.recoveryHash}`) {
    throw stateMismatch('the on-chain recovery hash differs from the request');
  }
}

/**
 * Execute every binding in order. The caller owns the provider lifecycle and
 * must re-run assertCanonicalChainSnapshot at its persistence boundary.
 */
export async function verifyIdentityRegistration(
  input: IdentityRegistryVerificationInput,
  config: IdentityRegistryConfiguration,
  provider: JsonRpcProvider,
  options: IdentityRegistryVerificationOptions = {},
): Promise<VerifiedIdentityRegistration> {
  const txHash = input.txHash.toLowerCase();
  const controller = input.controller.toLowerCase();
  const recoveryHash = input.recoveryHash.toLowerCase();
  const normalizedInput: IdentityRegistryVerificationInput = {
    txHash,
    did: input.did,
    controller,
    recoveryHash,
  };
  const expectedDidHash = computeRegistryDidHash(input.did);

  try {
    await ensureIdentityRegistryDeployed(provider, config.registryAddress);
  } catch (error) {
    if (error instanceof IdentityRegistryConfigurationError) {
      throw failure(error.message, 'IDENTITY_REGISTRY_NOT_CONFIGURED', 503);
    }
    if (error instanceof IdentityRegistryRpcError) throw rpcUnavailable();
    throw error;
  }

  const canonical = await waitForCanonicalRegistration(
    provider,
    txHash,
    config,
    options,
  );
  await assertChainIdentity(provider, config);
  assertTransactionBinding(canonical, config, normalizedInput, expectedDidHash);
  const eventTimestamp = assertRegisteredEvent(
    canonical,
    config,
    normalizedInput,
    expectedDidHash,
  );
  await assertRegistryState(provider, config, normalizedInput, expectedDidHash);

  return {
    dataSource: 'CHAIN_IDENTITY_REGISTRY',
    chainId: Number(config.chainId),
    registryAddress: config.registryAddress,
    txHash,
    blockNumber: canonical.receipt.blockNumber,
    blockHash: lower(canonical.receipt.blockHash),
    didHash: expectedDidHash,
    controller,
    eventTimestamp: new Date(Number(eventTimestamp) * 1000),
    confirmations: canonical.confirmations,
    verificationVersion: IDENTITY_REGISTRY_VERIFICATION_VERSION,
  };
}
