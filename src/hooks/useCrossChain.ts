/**
 * Read-only cross-chain capability discovery.
 *
 * ZeroID does not currently ship a relayer submission client or an
 * authoritative destination-chain verifier. This module therefore exposes
 * only configuration/readiness information and destination metadata. It does
 * not manufacture fee quotes, bridge receipts, or verification results.
 */

import { useQuery } from "@tanstack/react-query";
import { CONTRACT_ADDRESSES } from "@/config/constants";

export interface SupportedChain {
  chainId: number;
  name: string;
  shortName: string;
  network: "mainnet" | "testnet";
  explorerUrl: string;
  isActive: boolean;
}

export interface CrossChainCapabilities {
  bridgeContractConfigured: boolean;
  relayerConfigured: boolean;
  destinationVerificationConfigured: boolean;
  infrastructureReady: boolean;
  missingCapabilities: string[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const DESTINATIONS: Array<Omit<SupportedChain, "isActive">> = [
  {
    chainId: 1,
    name: "Ethereum",
    shortName: "eth",
    network: "mainnet",
    explorerUrl: "https://etherscan.io",
  },
  {
    chainId: 137,
    name: "Polygon",
    shortName: "pol",
    network: "mainnet",
    explorerUrl: "https://polygonscan.com",
  },
  {
    chainId: 42161,
    name: "Arbitrum One",
    shortName: "arb",
    network: "mainnet",
    explorerUrl: "https://arbiscan.io",
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    shortName: "sep",
    network: "testnet",
    explorerUrl: "https://sepolia.etherscan.io",
  },
];

function hasBridgeContract(): boolean {
  const address = CONTRACT_ADDRESSES.crossChainBridge?.trim().toLowerCase();
  return Boolean(
    address && address !== ZERO_ADDRESS && /^0x[0-9a-f]{40}$/.test(address),
  );
}

function hasSafeServiceUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;

  try {
    const url = new URL(value);
    const localDevelopmentUrl =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      process.env.NODE_ENV !== "production";

    return (
      (url.protocol === "https:" || localDevelopmentUrl) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function getCrossChainCapabilities(): CrossChainCapabilities {
  const bridgeContractConfigured = hasBridgeContract();
  const relayerConfigured = hasSafeServiceUrl(
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL,
  );
  const destinationVerificationConfigured = hasSafeServiceUrl(
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL,
  );
  const infrastructureReady =
    bridgeContractConfigured &&
    relayerConfigured &&
    destinationVerificationConfigured;

  const missingCapabilities: string[] = [];
  if (!bridgeContractConfigured) missingCapabilities.push("Bridge contract");
  if (!relayerConfigured) missingCapabilities.push("Relayer service");
  if (!destinationVerificationConfigured) {
    missingCapabilities.push("Destination-chain verification");
  }

  return {
    bridgeContractConfigured,
    relayerConfigured,
    destinationVerificationConfigured,
    infrastructureReady,
    missingCapabilities,
  };
}

export function useCrossChainCapabilities(): CrossChainCapabilities {
  return getCrossChainCapabilities();
}

export function useSupportedChains() {
  const capabilities = useCrossChainCapabilities();

  return useQuery({
    queryKey: ["cross-chain", "destinations", capabilities.infrastructureReady],
    queryFn: (): SupportedChain[] =>
      DESTINATIONS.map((destination) => ({
        ...destination,
        // A bridge contract alone does not make a destination operational.
        isActive: capabilities.infrastructureReady,
      })),
    staleTime: 10 * 60_000,
  });
}
