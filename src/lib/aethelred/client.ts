/**
 * ZeroID — Aethelred Conformance Boundary: client factory
 *
 * The single seam through which ZeroID reaches the canonical Aethelred
 * Cosmos-REST plane (verification, seals, attestation, jobs, models) via
 * `@aethelred/sdk`. No other ZeroID module imports `@aethelred/sdk` directly.
 *
 * The EVM contract plane (Solidity calls) continues to use wagmi/viem; this
 * boundary is additive and bridges the canonical service plane.
 */

import {
  createAethelredClient,
  Network,
  VerificationModule,
  SealsModule,
  type AethelredClient,
} from "@aethelred/sdk";

function resolveNetwork(): Network {
  return process.env.NEXT_PUBLIC_AETHELRED_NETWORK === "mainnet"
    ? Network.MAINNET
    : Network.TESTNET;
}

let client: AethelredClient | null = null;

/** Lazily construct and cache the canonical Aethelred client. */
export function getAethelredClient(): AethelredClient {
  if (!client) {
    client = createAethelredClient({ network: resolveNetwork() });
  }
  return client;
}

/** Verification module: on-chain ZK proof + TEE attestation verification. */
export function getVerificationModule(): VerificationModule {
  return new VerificationModule(getAethelredClient());
}

/** Seals module: Digital Seal creation and verification. */
export function getSealsModule(): SealsModule {
  return new SealsModule(getAethelredClient());
}

/** Test seam: drop the cached client so the next call rebuilds it. */
export function resetAethelredClient(): void {
  client = null;
}
