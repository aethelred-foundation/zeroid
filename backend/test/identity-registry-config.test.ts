import {
  allowedDidNetworksForChain,
  ensureIdentityRegistryDeployed,
  IdentityRegistryConfigurationError,
  isIdentityRegistryConfigured,
  loadIdentityRegistryConfiguration,
  probeIdentityRegistryReadiness,
  resetIdentityRegistryDeploymentCache,
} from '../src/lib/identity-registry-config';

const REGISTRY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const BASE_ENV: NodeJS.ProcessEnv = {
  AETHELRED_RPC_URL: 'http://127.0.0.1:8545',
  IDENTITY_REGISTRY_ADDRESS: REGISTRY,
};

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    _getConnection: () => ({ url: 'http://127.0.0.1:8545' }),
    getCode: jest.fn().mockResolvedValue('0x6080'),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 7332n }),
    destroy: jest.fn(),
    ...overrides,
  } as any;
}

describe('loadIdentityRegistryConfiguration', () => {
  beforeEach(() => resetIdentityRegistryDeploymentCache());

  it('loads defaults for the public testnet', () => {
    expect(loadIdentityRegistryConfiguration(BASE_ENV)).toEqual({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 7332n,
      registryAddress: REGISTRY.toLowerCase(),
      minimumConfirmations: 1,
      receiptWaitMs: 15_000,
      allowedDidNetworks: ['testnet', 'devnet'],
    });
    expect(isIdentityRegistryConfigured(BASE_ENV)).toBe(true);
  });

  it('maps chain 7331 to mainnet DIDs', () => {
    expect(
      loadIdentityRegistryConfiguration({ ...BASE_ENV, AETHELRED_CHAIN_ID: '7331' })
        .allowedDidNetworks,
    ).toEqual(['mainnet']);
  });

  it('refuses an unknown chain without an explicit DID network override', () => {
    expect(() =>
      loadIdentityRegistryConfiguration({ ...BASE_ENV, AETHELRED_CHAIN_ID: '31337' }),
    ).toThrow(IdentityRegistryConfigurationError);
    expect(() => allowedDidNetworksForChain(31337n, {})).toThrow(
      /IDENTITY_REGISTRY_DID_NETWORKS/,
    );
  });

  it('parses the DID network override', () => {
    expect(
      allowedDidNetworksForChain(31337n, {
        IDENTITY_REGISTRY_DID_NETWORKS: 'Devnet, testnet,devnet',
      }),
    ).toEqual(['devnet', 'testnet']);
    expect(() =>
      allowedDidNetworksForChain(31337n, { IDENTITY_REGISTRY_DID_NETWORKS: 'lab' }),
    ).toThrow(/unknown DID network/);
  });

  it('parses confirmations, receipt wait and the anchor pair', () => {
    const config = loadIdentityRegistryConfiguration({
      ...BASE_ENV,
      IDENTITY_REGISTRY_MIN_CONFIRMATIONS: '3',
      IDENTITY_REGISTRY_RECEIPT_WAIT_MS: '0',
      AETHELRED_NETWORK_ANCHOR_BLOCK: '12',
      AETHELRED_NETWORK_ANCHOR_HASH: `0x${'AB'.repeat(32)}`,
    });
    expect(config.minimumConfirmations).toBe(3);
    expect(config.receiptWaitMs).toBe(0);
    expect(config.networkAnchorBlock).toBe(12n);
    expect(config.networkAnchorHash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it.each<[string, NodeJS.ProcessEnv, RegExp]>([
    ['missing RPC URL', { ...BASE_ENV, AETHELRED_RPC_URL: '' }, /AETHELRED_RPC_URL is required/],
    ['non-http RPC URL', { ...BASE_ENV, AETHELRED_RPC_URL: 'ws://node:8546' }, /http or https/],
    [
      'credentialed RPC URL',
      { ...BASE_ENV, AETHELRED_RPC_URL: 'http://user:pw@node:8545' },
      /embedded credentials/,
    ],
    [
      'missing registry address',
      { ...BASE_ENV, IDENTITY_REGISTRY_ADDRESS: undefined },
      /IDENTITY_REGISTRY_ADDRESS is required/,
    ],
    [
      'malformed registry address',
      { ...BASE_ENV, IDENTITY_REGISTRY_ADDRESS: '0x1234' },
      /20-byte/,
    ],
    [
      'zero registry address',
      { ...BASE_ENV, IDENTITY_REGISTRY_ADDRESS: `0x${'0'.repeat(40)}` },
      /zero address/,
    ],
    [
      'half-set anchor pair',
      { ...BASE_ENV, AETHELRED_NETWORK_ANCHOR_BLOCK: '1' },
      /set together/,
    ],
    [
      'zero confirmations',
      { ...BASE_ENV, IDENTITY_REGISTRY_MIN_CONFIRMATIONS: '0' },
      /at least 1/,
    ],
    [
      'negative confirmations',
      { ...BASE_ENV, IDENTITY_REGISTRY_MIN_CONFIRMATIONS: '-1' },
      /unsigned integer/,
    ],
    [
      'oversized receipt wait',
      { ...BASE_ENV, IDENTITY_REGISTRY_RECEIPT_WAIT_MS: '999999' },
      /must not exceed/,
    ],
    ['bad chain id', { ...BASE_ENV, AETHELRED_CHAIN_ID: 'seven' }, /AETHELRED_CHAIN_ID/],
  ])('rejects %s', (_label, env, message) => {
    expect(() => loadIdentityRegistryConfiguration(env)).toThrow(message);
    expect(isIdentityRegistryConfigured(env)).toBe(false);
    try {
      loadIdentityRegistryConfiguration(env);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'IDENTITY_REGISTRY_NOT_CONFIGURED',
        statusCode: 503,
      });
    }
  });
});

describe('ensureIdentityRegistryDeployed', () => {
  beforeEach(() => resetIdentityRegistryDeploymentCache());

  it('memoizes a successful code check only', async () => {
    const provider = fakeProvider();
    await ensureIdentityRegistryDeployed(provider, REGISTRY.toLowerCase());
    await ensureIdentityRegistryDeployed(provider, REGISTRY.toLowerCase());
    expect(provider.getCode).toHaveBeenCalledTimes(1);
  });

  it('refuses an address without code and does not cache the failure', async () => {
    const provider = fakeProvider({
      getCode: jest.fn().mockResolvedValueOnce('0x').mockResolvedValueOnce('0x60'),
    });
    await expect(
      ensureIdentityRegistryDeployed(provider, REGISTRY.toLowerCase()),
    ).rejects.toMatchObject({ code: 'IDENTITY_REGISTRY_NOT_CONFIGURED', statusCode: 503 });
    await expect(
      ensureIdentityRegistryDeployed(provider, REGISTRY.toLowerCase()),
    ).resolves.toBeUndefined();
    expect(provider.getCode).toHaveBeenCalledTimes(2);
  });

  it('maps a getCode transport failure to RPC unavailable', async () => {
    const provider = fakeProvider({
      getCode: jest.fn().mockRejectedValue(new Error('offline')),
    });
    await expect(
      ensureIdentityRegistryDeployed(provider, REGISTRY.toLowerCase()),
    ).rejects.toMatchObject({ code: 'IDENTITY_REGISTRY_RPC_UNAVAILABLE', statusCode: 503 });
  });
});

describe('probeIdentityRegistryReadiness', () => {
  beforeEach(() => resetIdentityRegistryDeploymentCache());

  it('reports unavailable when the verifier is not configured', async () => {
    expect(await probeIdentityRegistryReadiness({}, 100)).toBe('unavailable');
  });

  it('reports ok when the chain id matches and the registry has code', async () => {
    const provider = fakeProvider();
    expect(await probeIdentityRegistryReadiness(BASE_ENV, 100, () => provider)).toBe(
      'ok',
    );
    expect(provider.destroy).toHaveBeenCalled();
  });

  it('reports degraded on a chain id mismatch or unreachable RPC', async () => {
    expect(
      await probeIdentityRegistryReadiness(BASE_ENV, 100, () =>
        fakeProvider({ getNetwork: jest.fn().mockResolvedValue({ chainId: 1n }) }),
      ),
    ).toBe('degraded');
    expect(
      await probeIdentityRegistryReadiness(BASE_ENV, 100, () =>
        fakeProvider({ getNetwork: jest.fn().mockRejectedValue(new Error('offline')) }),
      ),
    ).toBe('degraded');
    expect(
      await probeIdentityRegistryReadiness(BASE_ENV, 20, () =>
        fakeProvider({ getNetwork: jest.fn(() => new Promise(() => {})) }),
      ),
    ).toBe('degraded');
  });

  it('reports unavailable when the registry address holds no code', async () => {
    expect(
      await probeIdentityRegistryReadiness(BASE_ENV, 100, () =>
        fakeProvider({ getCode: jest.fn().mockResolvedValue('0x') }),
      ),
    ).toBe('unavailable');
  });
});
