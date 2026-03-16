/**
 * ZeroID — TEE Attestation Client Utilities
 *
 * Provides functions for interacting with TEE (Trusted Execution
 * Environment) nodes in the ZeroID network. Handles attestation
 * verification, node selection, and biometric verification requests.
 */

import type {
  TEEAttestation,
  TEENode,
  TEEPlatform,
  AttestationType,
  Bytes32,
  Address,
} from '@/types';
import {
  TEE_SERVICE_URL,
  TEE_ENDPOINTS,
  TEE_FRESHNESS_REQUIREMENTS,
  TEE_NODE_POLL_INTERVAL_MS,
} from '@/config/constants';
import { withRetry, withTimeout, isExpired } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/** Options for selecting a TEE node */
export interface NodeSelectionOptions {
  /** Preferred platform (optional) */
  preferredPlatform?: TEEPlatform;
  /** Maximum acceptable latency in milliseconds */
  maxLatencyMs?: number;
  /** Minimum required uptime percentage (0-100) */
  minUptimePercent?: number;
  /** Geographic region preference */
  preferredRegion?: string;
}

/** Result of a biometric verification request */
export interface BiometricVerificationResult {
  /** Whether the verification succeeded */
  success: boolean;
  /** Unique verification ID for tracking */
  verificationId: string;
  /** Biometric hash produced by the TEE (if successful) */
  biometricHash?: Bytes32;
  /** Enclave that performed the verification */
  enclaveHash: Bytes32;
  /** Error message (if verification failed) */
  error?: string;
}

/** Payload for a biometric enrollment request */
export interface BiometricEnrollPayload {
  /** DID hash of the subject */
  subjectDidHash: Bytes32;
  /** Base64-encoded biometric data (encrypted for the target enclave) */
  encryptedBiometricData: string;
  /** Target enclave hash */
  enclaveHash: Bytes32;
  /** Biometric modality */
  biometricType: string;
}

// ============================================================================
// Node Discovery & Selection
// ============================================================================

/**
 * Fetch the list of available TEE nodes from the TEE service.
 *
 * @returns Array of TEE nodes with their current status
 * @throws If the TEE service is unreachable
 */
export async function fetchTEENodes(): Promise<TEENode[]> {
  const response = await withRetry(
    async () => {
      const res = await withTimeout(
        fetch(`${TEE_SERVICE_URL}${TEE_ENDPOINTS.NODE_STATUS}`),
        10_000,
        'TEE node status request timed out',
      );
      if (!res.ok) {
        throw new Error(`TEE service returned HTTP ${res.status}`);
      }
      return res.json() as Promise<{ nodes: TEENode[] }>;
    },
    2,
    1000,
  );

  return response.nodes;
}

/**
 * Select the best TEE node based on the given criteria.
 * Filters by online status and attestation validity, then ranks by
 * latency and uptime.
 *
 * @param nodes - Available TEE nodes
 * @param options - Selection criteria
 * @returns The best matching node, or `null` if none qualify
 */
export function selectBestNode(
  nodes: TEENode[],
  options: NodeSelectionOptions = {},
): TEENode | null {
  const {
    preferredPlatform,
    maxLatencyMs = 5000,
    minUptimePercent = 95,
    preferredRegion,
  } = options;

  // Filter to online nodes with valid attestation
  let candidates = nodes.filter(
    (node) =>
      node.isOnline &&
      node.attestation.isValid &&
      !isExpired(node.attestation.expiresAt) &&
      node.avgLatencyMs <= maxLatencyMs &&
      node.uptimePercent >= minUptimePercent,
  );

  if (candidates.length === 0) return null;

  // Prefer specific platform if requested
  if (preferredPlatform !== undefined) {
    const platformMatch = candidates.filter(
      (n) => n.platform === preferredPlatform,
    );
    if (platformMatch.length > 0) {
      candidates = platformMatch;
    }
  }

  // Prefer specific region if requested
  if (preferredRegion) {
    const regionMatch = candidates.filter(
      (n) => n.region.toLowerCase() === preferredRegion.toLowerCase(),
    );
    if (regionMatch.length > 0) {
      candidates = regionMatch;
    }
  }

  // Sort by: lowest latency first, then highest uptime
  candidates.sort((a, b) => {
    const latencyDiff = a.avgLatencyMs - b.avgLatencyMs;
    if (Math.abs(latencyDiff) > 50) return latencyDiff;
    return b.uptimePercent - a.uptimePercent;
  });

  return candidates[0];
}

// ============================================================================
// Attestation Verification
// ============================================================================

/**
 * Verify a TEE attestation report against the TEE service.
 * This is a client-side check; on-chain verification is performed
 * by the ITEEAttestation contract.
 *
 * @param enclaveHash - The enclave hash to verify
 * @returns The attestation report with validity status
 */
export async function verifyAttestation(
  enclaveHash: Bytes32,
): Promise<TEEAttestation> {
  const response = await withRetry(
    async () => {
      const res = await withTimeout(
        fetch(`${TEE_SERVICE_URL}${TEE_ENDPOINTS.ATTESTATION_VERIFY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enclaveHash }),
        }),
        15_000,
        'Attestation verification request timed out',
      );
      if (!res.ok) {
        throw new Error(`Attestation verification failed: HTTP ${res.status}`);
      }
      return res.json() as Promise<{ attestation: TEEAttestation }>;
    },
    2,
    1000,
  );

  return response.attestation;
}

/**
 * Check whether a TEE attestation is fresh enough for a given platform.
 * Uses the platform-specific freshness requirements from constants.
 *
 * @param attestation - The attestation to check
 * @returns `true` if the attestation is within the freshness window
 */
export function isAttestationFresh(attestation: TEEAttestation): boolean {
  const now = Math.floor(Date.now() / 1000);

  // Check basic expiry
  if (now >= attestation.expiresAt) return false;

  // Check platform-specific freshness
  const platformKey = TEEPlatform[attestation.platform] as keyof typeof TEE_FRESHNESS_REQUIREMENTS;
  const maxAge = TEE_FRESHNESS_REQUIREMENTS[platformKey];
  if (maxAge === undefined) return false;

  const age = now - attestation.attestedAt;
  return age <= maxAge;
}

// Re-export the enum so callers don't need a separate import
const TEEPlatform = {
  0: 'Unknown',
  1: 'IntelSGX',
  2: 'AMDSEV',
  3: 'ArmTrustZone',
} as const;

/**
 * Get a human-readable label for a TEE platform.
 *
 * @param platform - TEE platform enum value
 * @returns Human-readable platform name
 */
export function getPlatformLabel(platform: number): string {
  const labels: Record<number, string> = {
    0: 'Unknown',
    1: 'Intel SGX',
    2: 'AMD SEV',
    3: 'ARM TrustZone',
  };
  return labels[platform] ?? 'Unknown';
}

/**
 * Get a human-readable label for an attestation type.
 *
 * @param type - Attestation type
 * @returns Human-readable label
 */
export function getAttestationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    remote: 'Remote Attestation',
    local: 'Local Attestation',
    self: 'Self Attestation (Dev)',
  };
  return labels[type] ?? 'Unknown';
}

// ============================================================================
// Biometric Verification
// ============================================================================

/**
 * Request biometric verification through a TEE node.
 * The biometric data is encrypted client-side for the target enclave
 * and never transmitted in plaintext.
 *
 * @param payload - Biometric verification payload
 * @param authToken - JWT auth token for the request
 * @returns Verification result including the biometric hash (if successful)
 * @throws If the TEE service is unreachable or the request is rejected
 */
export async function requestBiometricVerification(
  payload: BiometricEnrollPayload,
  authToken: string,
): Promise<BiometricVerificationResult> {
  const response = await withTimeout(
    fetch(`${TEE_SERVICE_URL}${TEE_ENDPOINTS.BIOMETRIC_VERIFY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    }),
    30_000,
    'Biometric verification request timed out',
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    return {
      success: false,
      verificationId: '',
      enclaveHash: payload.enclaveHash,
      error:
        (errorBody as Record<string, string>).message ||
        `Biometric verification failed: HTTP ${response.status}`,
    };
  }

  const result = (await response.json()) as BiometricVerificationResult;
  return {
    ...result,
    enclaveHash: payload.enclaveHash,
  };
}

/**
 * Request credential issuance through a TEE node after successful
 * biometric verification.
 *
 * @param verificationId - The biometric verification ID from a prior step
 * @param schemaHash - The credential schema to issue
 * @param attributes - Attribute key-value pairs for the credential
 * @param authToken - JWT auth token
 * @returns The issued credential hash and transaction hash
 */
export async function requestCredentialIssuance(
  verificationId: string,
  schemaHash: Bytes32,
  attributes: Record<string, string>,
  authToken: string,
): Promise<{ credentialHash: Bytes32; txHash: string }> {
  const response = await withTimeout(
    fetch(`${TEE_SERVICE_URL}${TEE_ENDPOINTS.CREDENTIAL_ISSUE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ verificationId, schemaHash, attributes }),
    }),
    30_000,
    'Credential issuance request timed out',
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      (errorBody as Record<string, string>).message ||
      `Credential issuance failed: HTTP ${response.status}`,
    );
  }

  return response.json() as Promise<{ credentialHash: Bytes32; txHash: string }>;
}
