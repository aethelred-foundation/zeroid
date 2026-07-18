import { hashMessage, recoverPublicKey, type Hex } from "viem";
import { activeChain } from "@/config/chains";
import type { Address, Bytes32 } from "@/types";

/**
 * Wallet identities register under the canonical address-bound form
 * `did:aethelred:<network>:<0x-address>`. The pattern is deliberately strict:
 * a looser one once let the wizard's `did:aethelred:pending` placeholder
 * through, registering a literal "pending" identity that then squatted the
 * DID for every wallet (409 on retry, 404 on address lookup).
 */
const WALLET_DID_PATTERN =
  /^did:aethelred:(mainnet|testnet|devnet):(0x[0-9a-fA-F]{40})$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
const IDENTITY_AUTH_TOKEN_STORAGE_KEY = "zeroid.identity.authToken";
const ALLOW_BROWSER_TOKEN_STORAGE_FLAG =
  "NEXT_PUBLIC_ZEROID_ALLOW_BROWSER_TOKEN_STORAGE";

let inMemoryIdentityAuthToken: string | undefined;

type RegistrationPublicKeyRecord = Record<string, unknown>;

export interface BackendIdentityRegistrationPayload {
  did: string;
  controller: Address;
  publicKey: string;
  recoveryHash: string;
  signature: Hex;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface RegistrationAuthContext {
  origin: string;
  chainId: number;
}

export interface BackendIdentityRegistrationResult {
  identity: unknown;
  token: string;
  sessionId: string;
}

export function getIdentityAuthToken(): string | undefined {
  if (inMemoryIdentityAuthToken) return inMemoryIdentityAuthToken;
  if (!isBrowserSessionAuthStorageAllowed()) return undefined;
  return (
    window.sessionStorage.getItem(IDENTITY_AUTH_TOKEN_STORAGE_KEY) ?? undefined
  );
}

export function storeIdentityAuthToken(token: string | undefined): void {
  inMemoryIdentityAuthToken = token;
  if (!token || !isBrowserSessionAuthStorageAllowed()) return;
  window.sessionStorage.setItem(IDENTITY_AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearIdentityAuthToken(): void {
  inMemoryIdentityAuthToken = undefined;
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(IDENTITY_AUTH_TOKEN_STORAGE_KEY);
}

function isBrowserSessionAuthStorageAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env[ALLOW_BROWSER_TOKEN_STORAGE_FLAG] !== "true") return false;
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ZEROID_ENV !== "production"
  );
}

export function getRegistrationDid(
  didDocument: Record<string, unknown>,
  address?: Address,
  network = "testnet",
): string {
  const did = typeof didDocument.id === "string" ? didDocument.id : undefined;
  const canonical = did?.match(WALLET_DID_PATTERN);
  if (canonical) {
    // Normalize the address segment so registration and the backend's
    // lowercase address lookup can never disagree on case.
    return `did:aethelred:${canonical[1]}:${canonical[2].toLowerCase()}`;
  }

  // Anything else (placeholders like did:aethelred:pending, malformed ids) is
  // ignored and the DID is derived from the connected wallet.
  if (!address) {
    throw new Error("Wallet address is required to derive the identity DID.");
  }

  return `did:aethelred:${network}:${address.toLowerCase()}`;
}

export function normalizeRecoveryHash(value: Bytes32): string {
  const recoveryHash = value.replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(recoveryHash)) {
    throw new Error("Identity recovery hash must be a valid bytes32 value.");
  }
  return recoveryHash.toLowerCase();
}

/**
 * Bind registration to the exact browser origin and configured Aethelred
 * chain. The backend independently resolves the same values from
 * ZEROID_AUTH_ORIGIN and AETHELRED_CHAIN_ID; neither value is trusted from the
 * request payload.
 */
export function getRegistrationAuthContext(): RegistrationAuthContext {
  if (typeof window === "undefined") {
    throw new Error("Wallet registration must be started in a browser.");
  }

  const origin = normalizeRegistrationOrigin(window.location.origin);
  if (!Number.isSafeInteger(activeChain.id) || activeChain.id <= 0) {
    throw new Error("The active wallet chain is not valid for registration.");
  }

  return { origin: origin.origin, chainId: activeChain.id };
}

export function extractRegistrationPublicKey(
  publicKeys: unknown[] | undefined,
): string | undefined {
  for (const candidate of publicKeys ?? []) {
    const normalized = normalizePublicKeyCandidate(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

export function buildRegistrationMessage(params: {
  did: string;
  controller: Address;
  recoveryHash: string;
  origin: string;
  chainId: number;
}): string {
  const didMatch = params.did.match(WALLET_DID_PATTERN);
  if (!didMatch) {
    throw new Error("Identity DID must contain a canonical wallet address.");
  }
  const did = `did:aethelred:${didMatch[1]}:${didMatch[2].toLowerCase()}`;
  const controller = params.controller.toLowerCase();
  const recoveryHash = params.recoveryHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recoveryHash)) {
    throw new Error("Identity recovery hash must be a valid bytes32 value.");
  }
  if (did.slice(did.lastIndexOf(":") + 1) !== controller) {
    throw new Error("Wallet controller must match the identity DID.");
  }
  if (!Number.isSafeInteger(params.chainId) || params.chainId <= 0) {
    throw new Error("The active wallet chain is not valid for registration.");
  }
  const origin = normalizeRegistrationOrigin(params.origin);

  return [
    `${origin.host} wants you to register a ZeroID identity with your Ethereum account:`,
    controller,
    "",
    "Authorize creation of the wallet-bound ZeroID identity below. This request does not initiate a blockchain transaction.",
    "",
    `URI: ${origin.origin}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `DID: ${did}`,
    `Recovery Hash: ${recoveryHash}`,
    "Purpose: zeroid.identity.registration",
  ].join("\n");
}

export async function recoverRegistrationPublicKey(
  message: string,
  signature: Hex,
): Promise<string> {
  const publicKey = await recoverPublicKey({
    hash: hashMessage(message),
    signature,
  });
  return hexToBase64(publicKey);
}

function normalizePublicKeyCandidate(candidate: unknown): string | undefined {
  if (typeof candidate === "string") {
    return normalizePublicKeyString(candidate);
  }

  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const record = candidate as RegistrationPublicKeyRecord;
  const fields = [
    "publicKeyBase64",
    "publicKey",
    "publicKeyPem",
    "publicKeyHex",
  ];

  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const normalized = normalizePublicKeyString(value);
    if (normalized) return normalized;
  }

  return undefined;
}

function normalizePublicKeyString(value: string): string | undefined {
  const trimmed = value.trim();
  if (isBackendPublicKey(trimmed)) {
    return trimmed;
  }

  if (/^0x[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 66) {
    return hexToBase64(trimmed);
  }

  return undefined;
}

function isBackendPublicKey(value: string): boolean {
  return (
    value.length >= 32 && value.length <= 512 && BASE64_PATTERN.test(value)
  );
}

function hexToBase64(value: string): string {
  const hex = value.replace(/^0x/i, "");
  const bytes = hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16));
  if (!bytes?.length || bytes.some((byte) => Number.isNaN(byte))) {
    throw new Error("Public key hex encoding is invalid.");
  }

  return btoa(String.fromCharCode(...bytes));
}

function normalizeRegistrationOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("The ZeroID registration origin is invalid.");
  }

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "")
  ) {
    throw new Error("The ZeroID registration origin is invalid.");
  }

  return origin;
}
