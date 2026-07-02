jest.mock("viem", () => ({
  defineChain: (config: any) => config,
}));

jest.mock("wagmi", () => ({
  http: jest.fn(() => "http-transport"),
  createConfig: jest.fn((config: any) => ({ ...config, _type: "fallback" })),
  createStorage: jest.fn((opts: any) => ({ ...opts, _type: "storage" })),
}));

// Production wagmi.ts imports the narrow `wagmi/connectors/injected` subpath so
// the bundle never pulls the optional Coinbase/WalletConnect peer SDKs. Mock
// that exact subpath (not the barrel `wagmi/connectors`) or the real ESM module
// loads and jest fails to transform it.
jest.mock("wagmi/connectors/injected", () => ({
  injected: jest.fn(() => "injected-connector"),
}));

import {
  wagmiConfig,
  activeChain,
  noopStorage,
  ssrSafeStorage,
} from "../wagmi";

describe("wagmi config", () => {
  it("exports wagmiConfig", () => {
    expect(wagmiConfig).toBeDefined();
  });

  it("creates a config object with expected shape", () => {
    expect(wagmiConfig).toHaveProperty("chains");
  });

  it("exports activeChain", () => {
    expect(activeChain).toBeDefined();
    expect(activeChain).toHaveProperty("id");
    expect(activeChain).toHaveProperty("name");
  });

  it("registers deduped chains (mainnet + shared testnet/devnet 7332)", () => {
    const config = wagmiConfig as any;
    // Testnet and devnet share EVM id 7332, so wagmi's chain registry collapses
    // to two entries: mainnet (7331) and the single 7332 chain.
    expect(config.chains).toHaveLength(2);
    const ids = config.chains.map((c: any) => c.id).sort();
    expect(ids).toEqual([7331, 7332]);
  });

  it("wires only the audited injected connector (no unaudited peer SDKs)", () => {
    const config = wagmiConfig as any;
    expect(config.connectors).toEqual(["injected-connector"]);
  });

  it("createZeroIdWalletConfig is exercised (function coverage)", () => {
    expect((wagmiConfig as any)._type).toBe("fallback");
  });
});

describe("wagmi config — storage", () => {
  it("uses window.localStorage when window is defined (jsdom)", () => {
    const { createStorage } = require("wagmi");
    expect(createStorage).toHaveBeenCalledWith(
      expect.objectContaining({ key: "zeroid-wallet" }),
    );
  });

  it("ssrSafeStorage resolves to localStorage in jsdom (browser)", () => {
    // In jsdom, window exists, so ssrSafeStorage should be window.localStorage
    expect(ssrSafeStorage).toBe(window.localStorage);
  });

  it("noopStorage.getItem returns null", () => {
    expect(noopStorage.getItem("any-key")).toBeNull();
  });

  it("noopStorage.setItem is a no-op", () => {
    expect(noopStorage.setItem("key", "value")).toBeUndefined();
  });

  it("noopStorage.removeItem is a no-op", () => {
    expect(noopStorage.removeItem("key")).toBeUndefined();
  });

  it("ssrSafeStorage falls back to noopStorage when window is undefined", () => {
    const origWindow = globalThis.window;
    // @ts-ignore — temporarily remove window to simulate SSR
    delete (globalThis as any).window;

    try {
      jest.isolateModules(() => {
        const mod = require("../wagmi");
        // In SSR mode (no window), ssrSafeStorage should be noopStorage
        expect(mod.ssrSafeStorage).toBe(mod.noopStorage);
        expect(mod.ssrSafeStorage.getItem("x")).toBeNull();
      });
    } finally {
      globalThis.window = origWindow;
    }
  });
});
