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
 */
function rpcEndpoint(envVar: string, fallback: string): string {
  const override = process.env[envVar]?.trim();
  return override && override.length > 0 ? override : fallback;
}

// ---------------------------------------------------------------------------
// Chain Definitions
// ---------------------------------------------------------------------------

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
      http: ["https://evm-rpc.aethelred.network"],
      webSocket: ["wss://evm-ws.aethelred.network"],
    },
    public: {
      http: ["https://evm-rpc.aethelred.network"],
      webSocket: ["wss://evm-ws.aethelred.network"],
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
    default: {
      http: [
        rpcEndpoint(
          "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL",
          "https://evm-rpc-testnet.aethelred.network",
        ),
      ],
    },
    public: {
      http: [
        rpcEndpoint(
          "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL",
          "https://evm-rpc-testnet.aethelred.network",
        ),
      ],
    },
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
    default: {
      http: [
        rpcEndpoint(
          "NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL",
          "http://127.0.0.1:8545",
        ),
      ],
    },
    public: {
      http: [
        rpcEndpoint(
          "NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL",
          "http://127.0.0.1:8545",
        ),
      ],
    },
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
