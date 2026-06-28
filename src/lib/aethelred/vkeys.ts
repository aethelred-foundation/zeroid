/**
 * ZeroID — Aethelred Conformance Boundary: verifying-key registry
 *
 * Maps a ZeroID circuit id to its on-chain-registered verifying-key hash
 * (base64), as registered with the chain's `x/verify` module
 * (proto VerifyingKey.hash). Sourced from `NEXT_PUBLIC_AETHELRED_VKEYS`, a JSON
 * object: { "<circuitId>": "<base64 vkey hash>" }.
 *
 * Returns null when a circuit's verifying key has not been registered yet, so
 * callers can fall back to the bespoke verifier until registration lands.
 */

import type { Bytes32 } from "@/types";

let cache: Record<string, string> | null = null;

function loadRegistry(): Record<string, string> {
  if (cache) return cache;
  const raw = process.env.NEXT_PUBLIC_AETHELRED_VKEYS;
  try {
    cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Registered verifying-key hash for a circuit, or null if unregistered. */
export function getVerifyingKeyHash(circuitId: Bytes32): string | null {
  return loadRegistry()[circuitId] ?? null;
}

/** Test seam: clear the cached registry so the next call re-reads the env. */
export function resetVkeyRegistry(): void {
  cache = null;
}
