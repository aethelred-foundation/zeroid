/**
 * TEE Attestation Client — Unit Tests
 *
 * Comprehensive tests for the TEE attestation module covering:
 * - fetchTEENodes (retry, timeout, HTTP errors)
 * - selectBestNode (filtering, platform/region preference, sorting)
 * - verifyAttestation (POST, retry, error handling)
 * - isAttestationFresh (platform-specific freshness, expiry)
 * - getPlatformLabel (all platform values)
 * - getAttestationTypeLabel (all attestation types)
 * - requestBiometricVerification (success, HTTP error, error body parsing)
 * - requestCredentialIssuance (success, HTTP error, thrown errors)
 */

import {
  fetchTEENodes,
  selectBestNode,
  verifyAttestation,
  isAttestationFresh,
  getPlatformLabel,
  getAttestationTypeLabel,
  requestBiometricVerification,
  requestCredentialIssuance,
} from '@/lib/tee/attestation';
import type {
  NodeSelectionOptions,
  BiometricEnrollPayload,
} from '@/lib/tee/attestation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock utils — withRetry calls fn directly, withTimeout resolves the promise, isExpired checks timestamp
const mockWithRetry = jest.fn(async (fn: () => Promise<unknown>) => fn());
const mockWithTimeout = jest.fn(
  async <T>(promise: Promise<T>): Promise<T> => promise,
);
const mockIsExpired = jest.fn((expiresAt: number) => {
  const now = Math.floor(Date.now() / 1000);
  return now >= expiresAt;
});

jest.mock('@/lib/utils', () => ({
  withRetry: (...args: unknown[]) => mockWithRetry(args[0] as () => Promise<unknown>),
  withTimeout: (...args: unknown[]) => mockWithTimeout(args[0] as Promise<unknown>),
  isExpired: (expiresAt: number) => mockIsExpired(expiresAt),
}));

jest.mock('@/config/constants', () => ({
  TEE_SERVICE_URL: 'https://tee.test.local',
  TEE_ENDPOINTS: {
    NODE_STATUS: '/api/v1/tee/nodes/status',
    ATTESTATION_VERIFY: '/api/v1/tee/attestation/verify',
    BIOMETRIC_VERIFY: '/api/v1/tee/biometric/verify',
    CREDENTIAL_ISSUE: '/api/v1/tee/credential/issue',
  },
  TEE_FRESHNESS_REQUIREMENTS: {
    IntelSGX: 86400,
    AMDSEV: 86400,
    ArmTrustZone: 43200,
  },
  TEE_NODE_POLL_INTERVAL_MS: 30000,
}));

const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    operator: '0xoperator1',
    attestation: {
      enclaveHash: '0xenclave1',
      platform: 1,
      attestedAt: NOW_SECONDS - 3600,
      expiresAt: NOW_SECONDS + 86400,
      reportDataHash: '0xreport1',
      nodeOperator: '0xoperator1',
      isValid: true,
      attestationType: 'remote',
    },
    platform: 1,
    name: 'Node Alpha',
    region: 'us-east',
    isOnline: true,
    uptimePercent: 99.5,
    verificationsProcessed: 1000,
    avgLatencyMs: 120,
    ...overrides,
  };
}

function makeAttestation(overrides: Record<string, unknown> = {}) {
  return {
    enclaveHash: '0xenclave1',
    platform: 1,
    attestedAt: NOW_SECONDS - 3600,
    expiresAt: NOW_SECONDS + 86400,
    reportDataHash: '0xreport1',
    nodeOperator: '0xoperator1',
    isValid: true,
    attestationType: 'remote',
    ...overrides,
  };
}

function makeBiometricPayload(): BiometricEnrollPayload {
  return {
    subjectDidHash: '0xsubject1',
    encryptedBiometricData: 'base64data',
    enclaveHash: '0xenclave1',
    biometricType: 'fingerprint',
  };
}

// ---------------------------------------------------------------------------
// fetchTEENodes
// ---------------------------------------------------------------------------

describe('fetchTEENodes', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWithRetry.mockClear();
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockWithTimeout.mockClear();
    mockWithTimeout.mockImplementation(async <T>(p: Promise<T>) => p);
  });

  it('returns nodes from a successful response', async () => {
    const nodes = [makeNode(), makeNode({ id: 'node-2' })];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes }),
    });

    const result = await fetchTEENodes();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('node-1');
    expect(result[1].id).toBe('node-2');
  });

  it('calls fetch with correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });

    await fetchTEENodes();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tee.test.local/api/v1/tee/nodes/status',
    );
  });

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(fetchTEENodes()).rejects.toThrow('TEE service returned HTTP 503');
  });

  it('uses withRetry for retry logic', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });

    await fetchTEENodes();

    expect(mockWithRetry).toHaveBeenCalled();
  });

  it('uses withTimeout for timeout handling', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [] }),
    });

    await fetchTEENodes();

    expect(mockWithTimeout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectBestNode
// ---------------------------------------------------------------------------

describe('selectBestNode', () => {
  beforeEach(() => {
    mockIsExpired.mockImplementation((expiresAt: number) => {
      const now = Math.floor(Date.now() / 1000);
      return now >= expiresAt;
    });
  });

  it('returns the best node by latency', () => {
    const nodes = [
      makeNode({ id: 'slow', avgLatencyMs: 500 }),
      makeNode({ id: 'fast', avgLatencyMs: 50 }),
      makeNode({ id: 'medium', avgLatencyMs: 200 }),
    ];

    const result = selectBestNode(nodes);

    expect(result?.id).toBe('fast');
  });

  it('returns null when no nodes are available', () => {
    expect(selectBestNode([])).toBeNull();
  });

  it('filters out offline nodes', () => {
    const nodes = [
      makeNode({ id: 'offline', isOnline: false }),
    ];

    expect(selectBestNode(nodes)).toBeNull();
  });

  it('filters out nodes with invalid attestation', () => {
    const nodes = [
      makeNode({
        id: 'invalid',
        attestation: { ...makeAttestation(), isValid: false },
      }),
    ];

    expect(selectBestNode(nodes)).toBeNull();
  });

  it('filters out nodes with expired attestation', () => {
    mockIsExpired.mockReturnValue(true);
    const nodes = [makeNode()];

    expect(selectBestNode(nodes)).toBeNull();
  });

  it('filters out nodes exceeding maxLatencyMs', () => {
    const nodes = [makeNode({ avgLatencyMs: 6000 })];

    expect(selectBestNode(nodes, { maxLatencyMs: 5000 })).toBeNull();
  });

  it('filters out nodes below minUptimePercent', () => {
    const nodes = [makeNode({ uptimePercent: 90 })];

    expect(selectBestNode(nodes, { minUptimePercent: 95 })).toBeNull();
  });

  it('prefers specified platform when available', () => {
    const nodes = [
      makeNode({ id: 'sgx', platform: 1, avgLatencyMs: 200 }),
      makeNode({ id: 'sev', platform: 2, avgLatencyMs: 100 }),
    ];

    const result = selectBestNode(nodes, { preferredPlatform: 1 });

    expect(result?.id).toBe('sgx');
  });

  it('falls back to other platforms when preferred is unavailable', () => {
    const nodes = [
      makeNode({ id: 'sev', platform: 2, avgLatencyMs: 100 }),
    ];

    const result = selectBestNode(nodes, { preferredPlatform: 1 });

    expect(result?.id).toBe('sev');
  });

  it('prefers specified region when available', () => {
    const nodes = [
      makeNode({ id: 'us', region: 'us-east', avgLatencyMs: 200 }),
      makeNode({ id: 'eu', region: 'eu-west', avgLatencyMs: 100 }),
    ];

    const result = selectBestNode(nodes, { preferredRegion: 'us-east' });

    expect(result?.id).toBe('us');
  });

  it('region matching is case-insensitive', () => {
    const nodes = [
      makeNode({ id: 'us', region: 'US-East', avgLatencyMs: 200 }),
      makeNode({ id: 'eu', region: 'eu-west', avgLatencyMs: 100 }),
    ];

    const result = selectBestNode(nodes, { preferredRegion: 'us-east' });

    expect(result?.id).toBe('us');
  });

  it('falls back to other regions when preferred is unavailable', () => {
    const nodes = [
      makeNode({ id: 'eu', region: 'eu-west', avgLatencyMs: 100 }),
    ];

    const result = selectBestNode(nodes, { preferredRegion: 'us-east' });

    expect(result?.id).toBe('eu');
  });

  it('sorts by uptime when latency difference is within 50ms', () => {
    const nodes = [
      makeNode({ id: 'low-uptime', avgLatencyMs: 100, uptimePercent: 96 }),
      makeNode({ id: 'high-uptime', avgLatencyMs: 120, uptimePercent: 99.9 }),
    ];

    const result = selectBestNode(nodes);

    // 20ms diff < 50ms threshold, so uptime wins
    expect(result?.id).toBe('high-uptime');
  });

  it('sorts by latency when difference exceeds 50ms', () => {
    const nodes = [
      makeNode({ id: 'fast', avgLatencyMs: 50, uptimePercent: 96 }),
      makeNode({ id: 'slow', avgLatencyMs: 200, uptimePercent: 99.9 }),
    ];

    const result = selectBestNode(nodes);

    expect(result?.id).toBe('fast');
  });

  it('uses default options when none provided', () => {
    const nodes = [makeNode({ avgLatencyMs: 4999, uptimePercent: 95.01 })];

    const result = selectBestNode(nodes);

    expect(result).not.toBeNull();
  });

  it('handles combined platform and region preferences', () => {
    const nodes = [
      makeNode({ id: 'match-both', platform: 1, region: 'us-east', avgLatencyMs: 300 }),
      makeNode({ id: 'match-platform', platform: 1, region: 'eu-west', avgLatencyMs: 100 }),
      makeNode({ id: 'match-neither', platform: 2, region: 'ap-south', avgLatencyMs: 50 }),
    ];

    const result = selectBestNode(nodes, {
      preferredPlatform: 1,
      preferredRegion: 'us-east',
    });

    expect(result?.id).toBe('match-both');
  });
});

// ---------------------------------------------------------------------------
// verifyAttestation
// ---------------------------------------------------------------------------

describe('verifyAttestation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWithRetry.mockClear();
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockWithTimeout.mockClear();
    mockWithTimeout.mockImplementation(async <T>(p: Promise<T>) => p);
  });

  it('returns attestation from a successful response', async () => {
    const attestation = makeAttestation();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ attestation }),
    });

    const result = await verifyAttestation('0xenclave1');

    expect(result).toEqual(attestation);
  });

  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ attestation: makeAttestation() }),
    });

    await verifyAttestation('0xenclave_hash');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tee.test.local/api/v1/tee/attestation/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enclaveHash: '0xenclave_hash' }),
      },
    );
  });

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
    });

    await expect(verifyAttestation('0xbad')).rejects.toThrow(
      'Attestation verification failed: HTTP 400',
    );
  });

  it('uses withRetry', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ attestation: makeAttestation() }),
    });

    await verifyAttestation('0xenclave1');

    expect(mockWithRetry).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isAttestationFresh
// ---------------------------------------------------------------------------

describe('isAttestationFresh', () => {
  it('returns true for fresh Intel SGX attestation (within 24h)', () => {
    const attestation = makeAttestation({
      platform: 1, // IntelSGX
      attestedAt: NOW_SECONDS - 3600, // 1 hour ago
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(true);
  });

  it('returns false for stale Intel SGX attestation (older than 24h)', () => {
    const attestation = makeAttestation({
      platform: 1,
      attestedAt: NOW_SECONDS - 90000, // 25 hours ago
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(false);
  });

  it('returns true for fresh AMD SEV attestation (within 24h)', () => {
    const attestation = makeAttestation({
      platform: 2,
      attestedAt: NOW_SECONDS - 3600,
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(true);
  });

  it('returns false for stale AMD SEV attestation (older than 24h)', () => {
    const attestation = makeAttestation({
      platform: 2,
      attestedAt: NOW_SECONDS - 90000,
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(false);
  });

  it('returns true for fresh ARM TrustZone attestation (within 12h)', () => {
    const attestation = makeAttestation({
      platform: 3,
      attestedAt: NOW_SECONDS - 36000, // 10 hours ago
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(true);
  });

  it('returns false for stale ARM TrustZone attestation (older than 12h)', () => {
    const attestation = makeAttestation({
      platform: 3,
      attestedAt: NOW_SECONDS - 50000, // ~14 hours ago
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(false);
  });

  it('returns false when attestation has expired', () => {
    const attestation = makeAttestation({
      platform: 1,
      attestedAt: NOW_SECONDS - 3600,
      expiresAt: NOW_SECONDS - 1, // already expired
    });

    expect(isAttestationFresh(attestation as any)).toBe(false);
  });

  it('returns false for unknown platform (no freshness requirement)', () => {
    const attestation = makeAttestation({
      platform: 0, // Unknown
      attestedAt: NOW_SECONDS - 100,
      expiresAt: NOW_SECONDS + 86400,
    });

    expect(isAttestationFresh(attestation as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPlatformLabel
// ---------------------------------------------------------------------------

describe('getPlatformLabel', () => {
  it('returns "Unknown" for platform 0', () => {
    expect(getPlatformLabel(0)).toBe('Unknown');
  });

  it('returns "Intel SGX" for platform 1', () => {
    expect(getPlatformLabel(1)).toBe('Intel SGX');
  });

  it('returns "AMD SEV" for platform 2', () => {
    expect(getPlatformLabel(2)).toBe('AMD SEV');
  });

  it('returns "ARM TrustZone" for platform 3', () => {
    expect(getPlatformLabel(3)).toBe('ARM TrustZone');
  });

  it('returns "Unknown" for unrecognized platform', () => {
    expect(getPlatformLabel(99)).toBe('Unknown');
  });

  it('returns "Unknown" for negative platform value', () => {
    expect(getPlatformLabel(-1)).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// getAttestationTypeLabel
// ---------------------------------------------------------------------------

describe('getAttestationTypeLabel', () => {
  it('returns "Remote Attestation" for "remote"', () => {
    expect(getAttestationTypeLabel('remote')).toBe('Remote Attestation');
  });

  it('returns "Local Attestation" for "local"', () => {
    expect(getAttestationTypeLabel('local')).toBe('Local Attestation');
  });

  it('returns "Self Attestation (Dev)" for "self"', () => {
    expect(getAttestationTypeLabel('self')).toBe('Self Attestation (Dev)');
  });

  it('returns "Unknown" for unrecognized type', () => {
    expect(getAttestationTypeLabel('hardware')).toBe('Unknown');
  });

  it('returns "Unknown" for empty string', () => {
    expect(getAttestationTypeLabel('')).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// requestBiometricVerification
// ---------------------------------------------------------------------------

describe('requestBiometricVerification', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWithTimeout.mockClear();
    mockWithTimeout.mockImplementation(async <T>(p: Promise<T>) => p);
  });

  it('returns success result on HTTP 200', async () => {
    const payload = makeBiometricPayload();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        verificationId: 'ver-123',
        biometricHash: '0xbiohash',
      }),
    });

    const result = await requestBiometricVerification(payload, 'jwt-token');

    expect(result.success).toBe(true);
    expect(result.verificationId).toBe('ver-123');
    expect(result.biometricHash).toBe('0xbiohash');
    expect(result.enclaveHash).toBe('0xenclave1');
  });

  it('sends correct headers including auth token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verificationId: 'ver-1' }),
    });

    await requestBiometricVerification(makeBiometricPayload(), 'my-token');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tee.test.local/api/v1/tee/biometric/verify',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer my-token',
        },
      }),
    );
  });

  it('returns failure result on non-OK response with error body', async () => {
    const payload = makeBiometricPayload();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Invalid biometric data' }),
    });

    const result = await requestBiometricVerification(payload, 'token');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid biometric data');
    expect(result.verificationId).toBe('');
    expect(result.enclaveHash).toBe('0xenclave1');
  });

  it('returns generic error when error body parsing fails', async () => {
    const payload = makeBiometricPayload();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('parse fail'); },
    });

    const result = await requestBiometricVerification(payload, 'token');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Biometric verification failed: HTTP 500');
  });

  it('uses withTimeout for the fetch call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verificationId: 'ver-1' }),
    });

    await requestBiometricVerification(makeBiometricPayload(), 'token');

    expect(mockWithTimeout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requestCredentialIssuance
// ---------------------------------------------------------------------------

describe('requestCredentialIssuance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWithTimeout.mockClear();
    mockWithTimeout.mockImplementation(async <T>(p: Promise<T>) => p);
  });

  it('returns credential and tx hash on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        credentialHash: '0xcred1',
        txHash: '0xtx1',
      }),
    });

    const result = await requestCredentialIssuance(
      'ver-123',
      '0xschema1',
      { name: 'Alice' },
      'jwt-token',
    );

    expect(result.credentialHash).toBe('0xcred1');
    expect(result.txHash).toBe('0xtx1');
  });

  it('sends correct request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ credentialHash: '0x1', txHash: '0x2' }),
    });

    await requestCredentialIssuance('ver-1', '0xschema', { age: '25' }, 'token');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tee.test.local/api/v1/tee/credential/issue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          verificationId: 'ver-1',
          schemaHash: '0xschema',
          attributes: { age: '25' },
        }),
      }),
    );
  });

  it('throws on non-OK response with error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Unauthorized issuer' }),
    });

    await expect(
      requestCredentialIssuance('ver-1', '0xschema', {}, 'token'),
    ).rejects.toThrow('Unauthorized issuer');
  });

  it('throws generic error when error body parsing fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('parse error'); },
    });

    await expect(
      requestCredentialIssuance('ver-1', '0xschema', {}, 'token'),
    ).rejects.toThrow('Credential issuance failed: HTTP 500');
  });

  it('includes Authorization header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ credentialHash: '0x1', txHash: '0x2' }),
    });

    await requestCredentialIssuance('ver-1', '0xschema', {}, 'bearer-test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bearer-test',
        },
      }),
    );
  });

  it('uses withTimeout for the fetch call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ credentialHash: '0x1', txHash: '0x2' }),
    });

    await requestCredentialIssuance('ver-1', '0xschema', {}, 'token');

    expect(mockWithTimeout).toHaveBeenCalled();
  });
});
