jest.mock("viem", () => ({
  defineChain: (config: any) => config,
}));

jest.mock("wagmi", () => ({
  http: jest.fn(() => "http-transport"),
  createConfig: jest.fn((config: any) => ({ ...config, _type: "fallback" })),
  createStorage: jest.fn((opts: any) => ({ ...opts, _type: "storage" })),
}));

jest.mock("wagmi/connectors", () => ({
  injected: jest.fn(() => "injected-connector"),
  walletConnect: jest.fn(() => "walletconnect-connector"),
  coinbaseWallet: jest.fn(() => "coinbase-connector"),
}));

jest.mock("@rainbow-me/rainbowkit", () => ({
  getDefaultConfig: jest.fn((config: any) => ({
    ...config,
    _type: "rainbowkit",
  })),
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

  it("includes all three Aethelred chains", () => {
    const config = wagmiConfig as any;
    if (config.chains) {
      expect(config.chains).toHaveLength(3);
    }
  });

  it("createFallbackConfig is exercised (function coverage)", () => {
    expect((wagmiConfig as any)._type).toBe("fallback");
  });
});

describe("wagmi config — WalletConnect branch", () => {
  const origEnv = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    } else {
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = origEnv;
    }
  });

  it("uses RainbowKit config when WALLETCONNECT_PROJECT_ID is set", () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "test-project-id";
    jest.isolateModules(() => {
      const { wagmiConfig: rkConfig } = require("../wagmi");
      expect(rkConfig).toBeDefined();
      expect((rkConfig as any)._type).toBe("rainbowkit");
    });
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
