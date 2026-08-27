/**
 * Aethelred Chain Configuration for ZeroID
 *
 * Defines the Aethelred L1 chain for wagmi/viem integration.
 * Supports mainnet, testnet, and local development environments.
 */

import { defineChain } from "viem";

// ---------------------------------------------------------------------------
// Chain IDs
// ---------------------------------------------------------------------------

// Canonical EVM chain IDs. 7332 is the CONFIRMED live Aethelred EVM EIP-155 id
// baked into the x/vm chain config (`eth_chainId` returns 0x1ca4) — the value
// wallets and dApps must use. Testnet and devnet are the SAME chain (7332)
// reached via different endpoints (hosted RPC vs a local
// `aethelredd start --json-rpc.enable` node) and deliberately share the id;
// mainnet keeps a distinct placeholder until a production network exists.
// (Source of truth: aethelred `ecosystem/manifest.json` → protocol.evm_chain_id.
// The prior 8821/88210 values were never-deployed placeholders.)
export const AETHELRED_MAINNET_ID = 7331;
export const AETHELRED_TESTNET_ID = 7332;
export const AETHELRED_DEVNET_ID = 7332;

/**
 * Resolve an RPC endpoint with an optional env override, so an operator can
 * point ZeroID at their own aethelredd node without editing source.
 *
 * IMPORTANT: the override MUST be passed in as a literal `process.env.NEXT_PUBLIC_*`
 * dot-access at the call site — NOT via a dynamic `process.env[key]` lookup here.
 * Next.js inlines client-side env vars only when it can see a literal member
 * expression at build time; a computed key is never substituted and resolves to
 * `undefined` in the browser, silently forcing the fallback. (That bug is why
 * NEXT_PUBLIC_AETHELRED_*_RPC_URL overrides appeared to be ignored no matter what
 * operators set.)
 */
function rpcEndpoint(override: string | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

// ---------------------------------------------------------------------------
// Chain Definitions
// ---------------------------------------------------------------------------

// Mainnet is not deployed yet; the aethelred.network endpoints are placeholders
// for when it launches. They are env-overridable (like testnet/devnet) so nothing
// is hardcoded — an operator can repoint them, and on testnet the active chain
// leads the wagmi list so these are never queried.
const AETHELRED_MAINNET_HTTP = rpcEndpoint(
  process.env.NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL,
  "https://evm-rpc.aethelred.network",
);
const AETHELRED_MAINNET_WS = rpcEndpoint(
  process.env.NEXT_PUBLIC_AETHELRED_MAINNET_WS_URL,
  "wss://evm-ws.aethelred.network",
);
// Hosted testnet RPC — operators point this at a validator's public JSON-RPC.
const AETHELRED_TESTNET_HTTP = rpcEndpoint(
  process.env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL,
  "https://evm-rpc-testnet.aethelred.network",
);
// Local devnet defaults to a `aethelredd start --json-rpc.enable` node.
const AETHELRED_DEVNET_HTTP = rpcEndpoint(
  process.env.NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL,
  "http://127.0.0.1:8545",
);

export const aethelredMainnet = defineChain({
  id: AETHELRED_MAINNET_ID,
  name: "Aethelred",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [AETHELRED_MAINNET_HTTP],
      webSocket: [AETHELRED_MAINNET_WS],
    },
    public: {
      http: [AETHELRED_MAINNET_HTTP],
      webSocket: [AETHELRED_MAINNET_WS],
    },
  },
  blockExplorers: {
    default: {
      name: "Aethelred Explorer",
      url: "https://explorer.aethelred.network",
    },
  },
  contracts: {},
});

export const aethelredTestnet = defineChain({
  id: AETHELRED_TESTNET_ID,
  name: "Aethelred Testnet",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [AETHELRED_TESTNET_HTTP] },
    public: { http: [AETHELRED_TESTNET_HTTP] },
  },
  blockExplorers: {
    default: {
      name: "Aethelred Testnet Explorer",
      url: "https://explorer-testnet.aethelred.network",
    },
  },
  testnet: true,
});

export const aethelredDevnet = defineChain({
  id: AETHELRED_DEVNET_ID,
  name: "Aethelred Devnet",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    // Defaults to a local `aethelredd start --json-rpc.enable` node (which
    // returns chain id 7332); override with the env var for a remote node.
    default: { http: [AETHELRED_DEVNET_HTTP] },
    public: { http: [AETHELRED_DEVNET_HTTP] },
  },
  testnet: true,
});

// ---------------------------------------------------------------------------
// Active Chain Selection
// ---------------------------------------------------------------------------

const CHAIN_ENV = process.env.NEXT_PUBLIC_CHAIN_ENV || "testnet";

export const activeChain =
  CHAIN_ENV === "mainnet"
    ? aethelredMainnet
    : CHAIN_ENV === "devnet"
      ? aethelredDevnet
      : aethelredTestnet;

export const supportedChains = [
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
] as const;
