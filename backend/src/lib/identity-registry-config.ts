/**
 * Configuration for the server-side identity registry verifier.
 *
 * Registration is refused (503 IDENTITY_REGISTRY_NOT_CONFIGURED) until the API
 * knows which JSON-RPC node and which deployed registry it must verify against.
 * There is deliberately no fallback to unverified registration.
 */
import { getAddress, JsonRpcProvider, ZeroAddress } from 'ethers';

export const IDENTITY_REGISTRY_NOT_CONFIGURED_CODE =
  'IDENTITY_REGISTRY_NOT_CONFIGURED' as const;

export const DEFAULT_IDENTITY_REGISTRY_MIN_CONFIRMATIONS = 1;
export const DEFAULT_IDENTITY_REGISTRY_RECEIPT_WAIT_MS = 15_000;
export const MAX_IDENTITY_REGISTRY_RECEIPT_WAIT_MS = 120_000;

/**
 * DID network segments accepted per EVM chain id. Testnet and devnet share the
 * public chain id 7332 (same chain, different endpoints); mainnet is 7331.
 * A DID whose segment is not allowed for the configured chain would hash to a
 * value the verifier could still match on-chain, so the policy is enforced
 * before any proof or RPC work.
 */
export const DID_NETWORKS_BY_CHAIN_ID: ReadonlyMap<bigint, readonly string[]> =
  new Map<bigint, readonly string[]>([
    [7331n, ['mainnet']],
    [7332n, ['testnet', 'devnet']],
  ]);

const KNOWN_DID_NETWORKS = new Set(['mainnet', 'testnet', 'devnet']);

export interface IdentityRegistryConfiguration {
  rpcUrl: string;
  chainId: bigint;
  registryAddress: string;
  minimumConfirmations: number;
  receiptWaitMs: number;
  allowedDidNetworks: readonly string[];
  networkAnchorBlock?: bigint;
  networkAnchorHash?: string;
}

export class IdentityRegistryConfigurationError extends Error {
  readonly code = IDENTITY_REGISTRY_NOT_CONFIGURED_CODE;
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'IdentityRegistryConfigurationError';
  }
}

function configurationError(detail: string): IdentityRegistryConfigurationError {
  return new IdentityRegistryConfigurationError(
    `Identity registry verification is not configured: ${detail}`,
  );
}

export function parseIdentityRegistryRpcUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw configurationError('AETHELRED_RPC_URL is required');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError('AETHELRED_RPC_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw configurationError('AETHELRED_RPC_URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw configurationError(
      'AETHELRED_RPC_URL must not contain embedded credentials',
    );
  }
  return value;
}

/**
 * Parsed exactly like the registration-proof chain id so the value embedded
 * in the signed message and the value asserted against eth_chainId can never
 * diverge.
 */
export function parseIdentityRegistryChainId(raw: string | undefined): bigint {
  const chainId = Number(raw ?? '7332');
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw configurationError('AETHELRED_CHAIN_ID must be a positive integer');
  }
  return BigInt(chainId);
}

export function parseIdentityRegistryAddress(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw configurationError('IDENTITY_REGISTRY_ADDRESS is required');
  let address: string;
  try {
    address = getAddress(value.toLowerCase()).toLowerCase();
  } catch {
    throw configurationError(
      'IDENTITY_REGISTRY_ADDRESS must be a 20-byte 0x-prefixed address',
    );
  }
  if (address === ZeroAddress) {
    throw configurationError('IDENTITY_REGISTRY_ADDRESS must not be the zero address');
  }
  return address;
}

function parsePositiveInteger(
  raw: string | undefined,
  label: string,
  fallback: number,
  max?: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw configurationError(`${label} must be an unsigned integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw configurationError(`${label} must be an unsigned integer`);
  }
  if (max !== undefined && parsed > max) {
    throw configurationError(`${label} must not exceed ${max}`);
  }
  return parsed;
}

function parseAnchor(
  env: NodeJS.ProcessEnv,
): Pick<IdentityRegistryConfiguration, 'networkAnchorBlock' | 'networkAnchorHash'> {
  const rawBlock = env.AETHELRED_NETWORK_ANCHOR_BLOCK?.trim();
  const rawHash = env.AETHELRED_NETWORK_ANCHOR_HASH?.trim();
  if (!rawBlock && !rawHash) return {};
  if (!rawBlock || !rawHash) {
    throw configurationError(
      'AETHELRED_NETWORK_ANCHOR_BLOCK and AETHELRED_NETWORK_ANCHOR_HASH must be set together',
    );
  }
  if (!/^\d+$/.test(rawBlock)) {
    throw configurationError(
      'AETHELRED_NETWORK_ANCHOR_BLOCK must be an unsigned integer',
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawHash)) {
    throw configurationError(
      'AETHELRED_NETWORK_ANCHOR_HASH must be a 32-byte 0x-prefixed block hash',
    );
  }
  return {
    networkAnchorBlock: BigInt(rawBlock),
    networkAnchorHash: rawHash.toLowerCase(),
  };
}

export function allowedDidNetworksForChain(
  chainId: bigint,
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const override = env.IDENTITY_REGISTRY_DID_NETWORKS?.trim();
  if (override) {
    const networks = [
      ...new Set(
        override
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (networks.length === 0) {
      throw configurationError(
        'IDENTITY_REGISTRY_DID_NETWORKS must list at least one DID network',
      );
    }
    const unknown = networks.find((network) => !KNOWN_DID_NETWORKS.has(network));
    if (unknown) {
      throw configurationError(
        `IDENTITY_REGISTRY_DID_NETWORKS contains an unknown DID network: ${unknown}`,
      );
    }
    return networks;
  }

  const networks = DID_NETWORKS_BY_CHAIN_ID.get(chainId);
  if (!networks) {
    throw configurationError(
      `no DID network policy is known for chain id ${chainId}; set IDENTITY_REGISTRY_DID_NETWORKS`,
    );
  }
  return networks;
}

export function loadIdentityRegistryConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): IdentityRegistryConfiguration {
  const rpcUrl = parseIdentityRegistryRpcUrl(env.AETHELRED_RPC_URL);
  const chainId = parseIdentityRegistryChainId(env.AETHELRED_CHAIN_ID);
  const registryAddress = parseIdentityRegistryAddress(
    env.IDENTITY_REGISTRY_ADDRESS,
  );
  const minimumConfirmations = parsePositiveInteger(
    env.IDENTITY_REGISTRY_MIN_CONFIRMATIONS,
    'IDENTITY_REGISTRY_MIN_CONFIRMATIONS',
    DEFAULT_IDENTITY_REGISTRY_MIN_CONFIRMATIONS,
  );
  if (minimumConfirmations < 1) {
    throw configurationError(
      'IDENTITY_REGISTRY_MIN_CONFIRMATIONS must be at least 1',
    );
  }
  const receiptWaitMs = parsePositiveInteger(
    env.IDENTITY_REGISTRY_RECEIPT_WAIT_MS,
    'IDENTITY_REGISTRY_RECEIPT_WAIT_MS',
    DEFAULT_IDENTITY_REGISTRY_RECEIPT_WAIT_MS,
    MAX_IDENTITY_REGISTRY_RECEIPT_WAIT_MS,
  );

  return {
    rpcUrl,
    chainId,
    registryAddress,
    minimumConfirmations,
    receiptWaitMs,
    allowedDidNetworks: allowedDidNetworksForChain(chainId, env),
    ...parseAnchor(env),
  };
}

export function isIdentityRegistryConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    loadIdentityRegistryConfiguration(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * The provider is created without a static network on purpose: the verifier
 * asserts eth_chainId against the configured chain id, and a static network
 * would answer that question from configuration instead of from the node.
 */
export function createIdentityRegistryProvider(
  config: IdentityRegistryConfiguration,
): JsonRpcProvider {
  return new JsonRpcProvider(config.rpcUrl);
}

const deployedRegistries = new Set<string>();

function deploymentCacheKey(rpcUrl: string, registryAddress: string): string {
  return `${rpcUrl}|${registryAddress.toLowerCase()}`;
}

export class IdentityRegistryRpcError extends Error {
  readonly code = 'IDENTITY_REGISTRY_RPC_UNAVAILABLE' as const;
  readonly statusCode = 503;

  constructor(message = 'The identity registry RPC is unavailable') {
    super(message);
    this.name = 'IdentityRegistryRpcError';
  }
}

/**
 * Refuse to verify against an address that holds no code. A successful check
 * is memoized per (rpcUrl, address) because the registry is not upgradeable;
 * failures are never cached so a late deployment becomes usable without a
 * restart.
 */
export async function ensureIdentityRegistryDeployed(
  provider: JsonRpcProvider,
  registryAddress: string,
): Promise<void> {
  const rpcUrl = providerUrl(provider);
  const key = deploymentCacheKey(rpcUrl, registryAddress);
  if (deployedRegistries.has(key)) return;

  let code: string;
  try {
    code = await provider.getCode(registryAddress);
  } catch {
    throw new IdentityRegistryRpcError();
  }
  if (typeof code !== 'string' || code.toLowerCase() === '0x' || code === '') {
    throw configurationError(
      `no contract code at IDENTITY_REGISTRY_ADDRESS ${registryAddress}`,
    );
  }
  deployedRegistries.add(key);
}

export function resetIdentityRegistryDeploymentCache(): void {
  deployedRegistries.clear();
}

function providerUrl(provider: JsonRpcProvider): string {
  try {
    const connection = provider._getConnection();
    return connection.url;
  } catch {
    return 'unknown';
  }
}

export type IdentityRegistryReadiness = 'ok' | 'unavailable' | 'degraded';

/**
 * Readiness probe used by /ready: 'unavailable' when the verifier is not
 * configured or the address holds no code, 'degraded' when the RPC cannot be
 * reached or answers with the wrong chain id, 'ok' otherwise.
 */
export async function probeIdentityRegistryReadiness(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 3_000,
  providerFactory: (
    config: IdentityRegistryConfiguration,
  ) => JsonRpcProvider = createIdentityRegistryProvider,
): Promise<IdentityRegistryReadiness> {
  let config: IdentityRegistryConfiguration;
  try {
    config = loadIdentityRegistryConfiguration(env);
  } catch {
    return 'unavailable';
  }

  const provider = providerFactory(config);
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = (async () => {
      const network = await provider.getNetwork();
      if (network.chainId !== config.chainId) return 'degraded' as const;
      await ensureIdentityRegistryDeployed(provider, config.registryAddress);
      return 'ok' as const;
    })();
    const timeout = new Promise<'degraded'>((resolve) => {
      timer = setTimeout(() => resolve('degraded'), timeoutMs);
    });
    return await Promise.race([probe, timeout]);
  } catch (error) {
    return error instanceof IdentityRegistryConfigurationError
      ? 'unavailable'
      : 'degraded';
  } finally {
    if (timer) clearTimeout(timer);
    destroyProvider(provider);
  }
}

/** Stop background network-detection timers once a provider is finished. */
export function destroyProvider(provider: JsonRpcProvider): void {
  try {
    provider.destroy();
  } catch {
    // Destroying an already-closed provider is not an error worth surfacing.
  }
}
