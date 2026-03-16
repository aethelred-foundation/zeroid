/**
 * ZeroID — Shared Utility Functions
 *
 * General-purpose helpers used throughout the ZeroID frontend.
 * Includes class-name merging, address formatting, date formatting,
 * hex utilities, and DID helpers.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, fromUnixTime } from 'date-fns';
import { keccak256, toHex, toBytes } from 'viem';
import type { Address, Bytes32, DID, UnixTimestamp } from '@/types';
import { DID_METHOD_PREFIX } from '@/config/constants';

// ============================================================================
// Class Name Utility
// ============================================================================

/**
 * Merge Tailwind CSS class names with conflict resolution.
 * Combines `clsx` conditional class joining with `tailwind-merge`
 * deduplication.
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-blue-500', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Address & Hash Formatting
// ============================================================================

/**
 * Truncate an EVM address or hex hash for display.
 *
 * @param address - Full hex string (e.g. `0xAbC...123`)
 * @param prefixLen - Characters to keep at the start (default 6)
 * @param suffixLen - Characters to keep at the end (default 4)
 * @returns Truncated string, e.g. `0xAbC...0123`
 */
export function formatAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4,
): string {
  if (!address) return '';
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

/**
 * Format a bytes32 hash for display, showing first and last segments.
 *
 * @param hash - Full 66-character bytes32 hex string
 * @returns Truncated hash, e.g. `0x1a2b...4d5e`
 */
export function formatHash(hash: string): string {
  return formatAddress(hash, 6, 4);
}

/**
 * Check whether a string is a valid EVM hex address.
 */
export function isValidAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Check whether a string is a valid bytes32 hex value.
 */
export function isValidBytes32(value: string): value is Bytes32 {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

// ============================================================================
// Date & Time Formatting
// ============================================================================

/**
 * Format a Unix timestamp (seconds) into a human-readable date string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param pattern - date-fns format pattern (default `MMM d, yyyy`)
 * @returns Formatted date string
 */
export function formatDate(
  timestamp: UnixTimestamp,
  pattern = 'MMM d, yyyy',
): string {
  if (!timestamp || timestamp <= 0) return 'N/A';
  try {
    return format(fromUnixTime(timestamp), pattern);
  } catch {
    return 'Invalid date';
  }
}

/**
 * Format a Unix timestamp as a full date-time string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns E.g. `Mar 15, 2026 at 2:30 PM`
 */
export function formatDateTime(timestamp: UnixTimestamp): string {
  return formatDate(timestamp, "MMM d, yyyy 'at' h:mm a");
}

/**
 * Format a Unix timestamp as a relative time string.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns E.g. `3 hours ago`, `in 2 days`
 */
export function formatRelativeTime(timestamp: UnixTimestamp): string {
  if (!timestamp || timestamp <= 0) return 'N/A';
  try {
    return formatDistanceToNow(fromUnixTime(timestamp), { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

/**
 * Check whether a credential/attestation has expired.
 *
 * @param expiresAt - Expiry Unix timestamp in seconds
 * @returns `true` if the current time is past the expiry
 */
export function isExpired(expiresAt: UnixTimestamp): boolean {
  return Math.floor(Date.now() / 1000) >= expiresAt;
}

// ============================================================================
// DID Utilities
// ============================================================================

/**
 * Construct a ZeroID DID object from a raw hex identifier and network.
 *
 * @param identifier - Hex identifier (without the `did:aethelred:...` prefix)
 * @param network - Target network
 * @returns A fully-formed `DID` object
 */
export function createDID(
  identifier: string,
  network: DID['network'] = 'mainnet',
): DID {
  const uri = `${DID_METHOD_PREFIX}:${network}:${identifier}`;
  const hash = keccak256(toBytes(uri)) as Bytes32;
  return { uri, identifier, hash, network };
}

/**
 * Parse a DID URI string into a structured `DID` object.
 *
 * @param uri - Full DID URI, e.g. `did:aethelred:testnet:0xabc...`
 * @returns Parsed DID or `null` if the URI is invalid
 */
export function parseDID(uri: string): DID | null {
  const parts = uri.split(':');
  if (parts.length !== 4 || parts[0] !== 'did' || parts[1] !== 'aethelred') {
    return null;
  }
  const network = parts[2] as DID['network'];
  if (!['mainnet', 'testnet', 'devnet'].includes(network)) {
    return null;
  }
  const identifier = parts[3];
  if (!identifier) return null;
  const hash = keccak256(toBytes(uri)) as Bytes32;
  return { uri, identifier, hash, network };
}

/**
 * Compute the keccak-256 hash of a DID URI (used as the on-chain key).
 */
export function hashDID(uri: string): Bytes32 {
  return keccak256(toBytes(uri)) as Bytes32;
}

// ============================================================================
// Number Formatting
// ============================================================================

/**
 * Format a number with compact notation (K, M, B suffixes).
 *
 * @param n - The number to format
 * @param decimals - Decimal places for values below 1K (default 0)
 */
export function formatNumber(n: number, decimals = 0): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals > 0 ? decimals : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals > 0 ? decimals : 1)}K`;
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a percentage with fixed decimal places.
 *
 * @param value - The percentage value (e.g. 95.5)
 * @param decimals - Decimal places (default 1)
 * @returns Formatted string, e.g. `95.5%`
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// ============================================================================
// Clipboard
// ============================================================================

/**
 * Copy text to the system clipboard.
 * Silently catches errors (e.g. when Clipboard API is unavailable).
 *
 * @param text - Text to copy
 * @returns `true` if the copy succeeded, `false` otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Hex Utilities
// ============================================================================

/**
 * Convert a UTF-8 string to a bytes32 hex value (keccak-256 hash).
 *
 * @param value - The string to hash
 * @returns keccak-256 hash as a `0x`-prefixed hex string
 */
export function stringToBytes32(value: string): Bytes32 {
  return keccak256(toBytes(value)) as Bytes32;
}

/**
 * Convert a number to a hex-encoded uint256 string suitable for
 * use as a ZK circuit public input.
 *
 * @param n - The number or bigint to convert
 * @returns `0x`-prefixed hex string
 */
export function numberToHex(n: number | bigint): string {
  return toHex(BigInt(n));
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for a specified duration.
 *
 * @param ms - Milliseconds to wait
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param baseDelayMs - Initial delay in milliseconds (default 1000)
 * @returns The resolved value of `fn`
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Run a promise with a timeout. Rejects if the promise does not
 * resolve within the specified duration.
 *
 * @param promise - The promise to race against the timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Error message on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
