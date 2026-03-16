jest.mock('viem', () => ({
  defineChain: (config: any) => config,
}));

import {
  AETHELRED_MAINNET_ID,
  AETHELRED_TESTNET_ID,
  AETHELRED_DEVNET_ID,
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
  supportedChains,
  activeChain,
} from '../chains';

describe('chains config', () => {
  it('exports correct chain IDs', () => {
    expect(AETHELRED_MAINNET_ID).toBe(7331);
    expect(AETHELRED_TESTNET_ID).toBe(7332);
    expect(AETHELRED_DEVNET_ID).toBe(7333);
  });

  it('defines mainnet chain with correct properties', () => {
    expect(aethelredMainnet).toBeDefined();
    expect(aethelredMainnet.id).toBe(AETHELRED_MAINNET_ID);
    expect(aethelredMainnet.name).toBe('Aethelred');
    expect(aethelredMainnet.nativeCurrency.symbol).toBe('AETHEL');
    expect(aethelredMainnet.nativeCurrency.decimals).toBe(18);
  });

  it('defines testnet chain with testnet flag', () => {
    expect(aethelredTestnet).toBeDefined();
    expect(aethelredTestnet.id).toBe(AETHELRED_TESTNET_ID);
    expect(aethelredTestnet.name).toBe('Aethelred Testnet');
    expect(aethelredTestnet.testnet).toBe(true);
  });

  it('defines devnet chain with localhost RPC', () => {
    expect(aethelredDevnet).toBeDefined();
    expect(aethelredDevnet.id).toBe(AETHELRED_DEVNET_ID);
    expect(aethelredDevnet.rpcUrls.default.http[0]).toBe('http://localhost:8545');
  });

  it('exports supportedChains array with all three chains', () => {
    expect(supportedChains).toHaveLength(3);
    expect(supportedChains).toContain(aethelredMainnet);
    expect(supportedChains).toContain(aethelredTestnet);
    expect(supportedChains).toContain(aethelredDevnet);
  });

  it('exports activeChain defaulting to testnet', () => {
    expect(activeChain).toBeDefined();
    // Default CHAIN_ENV is 'testnet'
    expect(activeChain).toBe(aethelredTestnet);
  });
});

describe('activeChain with mainnet env', () => {
  const origEnv = process.env.NEXT_PUBLIC_CHAIN_ENV;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.NEXT_PUBLIC_CHAIN_ENV;
    } else {
      process.env.NEXT_PUBLIC_CHAIN_ENV = origEnv;
    }
  });

  it('selects mainnet when CHAIN_ENV is mainnet', () => {
    process.env.NEXT_PUBLIC_CHAIN_ENV = 'mainnet';
    jest.isolateModules(() => {
      const { activeChain: mainnetChain, aethelredMainnet: mainnet } = require('../chains');
      expect(mainnetChain).toBe(mainnet);
    });
  });

  it('selects devnet when CHAIN_ENV is devnet', () => {
    process.env.NEXT_PUBLIC_CHAIN_ENV = 'devnet';
    jest.isolateModules(() => {
      const { activeChain: devnetChain, aethelredDevnet: devnet } = require('../chains');
      expect(devnetChain).toBe(devnet);
    });
  });
});
