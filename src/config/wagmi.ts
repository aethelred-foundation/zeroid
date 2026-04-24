/**
 * Wagmi Configuration for ZeroID
 *
 * Configures wallet connectors, transports, and chain setup
 * for the ZeroID dApp.
 */

import { http, createConfig, createStorage } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
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
// Wallet Configuration
// ---------------------------------------------------------------------------

/**
 * Sovereign-grade wallet config that keeps connector ownership local. The app
 * can run without WalletConnect in development, and production can enable it
 * by providing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 */
export const wagmiConfig = createZeroIdWalletConfig();

// ---------------------------------------------------------------------------
// Local Wallet Configuration
// ---------------------------------------------------------------------------

function createZeroIdWalletConfig() {
  const connectors = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: "ZeroID by Aethelred",
      appLogoUrl: "https://zeroid.aethelred.network/icon.png",
    }),
  ];

  if (WALLETCONNECT_PROJECT_ID) {
    connectors.push(
      walletConnect({
        projectId: WALLETCONNECT_PROJECT_ID,
      }),
    );
  }

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
