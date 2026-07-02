/**
 * Wagmi Configuration for ZeroID
 *
 * Configures wallet connectors, transports, and chain setup
 * for the ZeroID dApp.
 */

import { http, createConfig, createStorage } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import {
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
  activeChain,
} from "./chains";

// ---------------------------------------------------------------------------
// SSR-Safe Storage
// ---------------------------------------------------------------------------

/** No-op storage adapter for server-side rendering. */
export const noopStorage = {
  getItem: () => null as string | null,
  setItem: () => {},
  removeItem: () => {},
};

/** SSR-safe storage adapter: uses localStorage in browsers, no-ops on server. */
export const ssrSafeStorage =
  typeof window !== "undefined" ? window.localStorage : noopStorage;

// ---------------------------------------------------------------------------
// Wallet Configuration
// ---------------------------------------------------------------------------

/**
 * Sovereign-grade wallet config that keeps connector ownership local. The app
 * compiles without optional connector peer SDKs. Coinbase, Safe, WalletConnect,
 * and Tempo can be enabled after their SDKs are explicitly installed and
 * audited.
 */
export const wagmiConfig = createZeroIdWalletConfig();

// ---------------------------------------------------------------------------
// Local Wallet Configuration
// ---------------------------------------------------------------------------

function createZeroIdWalletConfig() {
  const connectors = [injected({ shimDisconnect: true })];

  // Testnet and devnet share the confirmed EVM chain id (7332), so one 7332
  // transport covers both; mainnet is the distinct id.
  const transports = {
    [aethelredMainnet.id]: http(),
    [aethelredTestnet.id]: http(), // 7332 — also serves aethelredDevnet
  };

  // wagmi rejects duplicate chain ids in its chains tuple. Testnet and devnet
  // share id 7332 (same chain, different endpoints), so dedupe by id — but keep
  // `activeChain` first so the surviving 7332 object carries the RPC for the
  // environment we're actually running (hosted testnet vs local devnet).
  const uniqueChains = [
    aethelredMainnet,
    activeChain,
    aethelredTestnet,
    aethelredDevnet,
  ].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);

  return createConfig({
    chains: uniqueChains as unknown as readonly [
      typeof aethelredMainnet,
      ...(typeof aethelredMainnet)[],
    ],
    connectors,
    transports,
    storage: createStorage({
      storage: ssrSafeStorage,
      key: "zeroid-wallet",
    }),
    ssr: true,
  });
}

export { activeChain };
