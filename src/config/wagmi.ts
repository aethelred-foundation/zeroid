/**
 * Wagmi Configuration for ZeroID
 *
 * Configures wallet connectors, transports, and chain setup
 * for the ZeroID dApp with RainbowKit integration.
 */

import { http, createConfig, createStorage } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
  activeChain,
} from "./chains";

// ---------------------------------------------------------------------------
// WalletConnect Project ID
// ---------------------------------------------------------------------------

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

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
// RainbowKit Configuration
// ---------------------------------------------------------------------------

/**
 * RainbowKit-flavoured wagmi config.
 * When a valid WalletConnect project ID is provided, the full RainbowKit
 * modal experience is used. Otherwise we fall back to a manual connector
 * config so the app still works in development without a project ID.
 */
export const wagmiConfig = WALLETCONNECT_PROJECT_ID
  ? getDefaultConfig({
      appName: "ZeroID by Aethelred",
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [aethelredMainnet, aethelredTestnet, aethelredDevnet],
      ssr: true,
    })
  : createFallbackConfig();

// ---------------------------------------------------------------------------
// Fallback Configuration (no WalletConnect project ID)
// ---------------------------------------------------------------------------

function createFallbackConfig() {
  const connectors = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: "ZeroID by Aethelred",
      appLogoUrl: "https://zeroid.aethelred.network/icon.png",
    }),
  ];

  const transports = {
    [aethelredMainnet.id]: http(),
    [aethelredTestnet.id]: http(),
    [aethelredDevnet.id]: http(),
  };

  return createConfig({
    chains: [aethelredMainnet, aethelredTestnet, aethelredDevnet],
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
