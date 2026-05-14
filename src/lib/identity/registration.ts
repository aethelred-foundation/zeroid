import { hashMessage, recoverPublicKey, type Hex } from "viem";
import type { Address, Bytes32 } from "@/types";

const DID_PATTERN = /^did:aethelred:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
const IDENTITY_AUTH_TOKEN_STORAGE_KEY = "zeroid.identity.authToken";

type RegistrationPublicKeyRecord = Record<string, unknown>;

export interface BackendIdentityRegistrationPayload {
  did: string;
  publicKey: string;
  recoveryHash: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface BackendIdentityRegistrationResult {
  identity: unknown;
  token: string;
  sessionId: string;
}

export function getIdentityAuthToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.sessionStorage.getItem(IDENTITY_AUTH_TOKEN_STORAGE_KEY) ?? undefined
  );
}

export function storeIdentityAuthToken(token: string | undefined): void {
  if (!token || typeof window === "undefined") return;
  window.sessionStorage.setItem(IDENTITY_AUTH_TOKEN_STORAGE_KEY, token);
}

export function getRegistrationDid(
  didDocument: Record<string, unknown>,
  address?: Address,
  network = "testnet",
): string {
  const did = typeof didDocument.id === "string" ? didDocument.id : undefined;
  if (did && DID_PATTERN.test(did)) {
    return did;
  }

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
  return recoveryHash;
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
}): string {
  return [
    "ZeroID identity registration",
    `DID: ${params.did}`,
    `Controller: ${params.controller.toLowerCase()}`,
    `Recovery hash: ${params.recoveryHash}`,
    "Purpose: bind this wallet controller key to the DID.",
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
    value.length >= 32 &&
    value.length <= 512 &&
    BASE64_PATTERN.test(value)
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
