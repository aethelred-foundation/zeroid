/**
 * useTEEAttestation — Unit Tests
 *
 * Tests for TEE attestation hooks: attestation status, verify attestation,
 * TEE nodes, node health, and network status.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('wagmi', () => ({
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));
const mockToast = jest.requireMock('sonner').toast;

jest.mock('@/lib/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));
const mockApiClient = jest.requireMock('@/lib/api/client').apiClient;

jest.mock('@/config/constants', () => ({
  TEE_REGISTRY_ADDRESS: '0xTEERegistry',
  TEE_REGISTRY_ABI: [],
}));

import { useReadContract } from 'wagmi';
import {
  useAttestationStatus,
  useVerifyAttestation,
  useTEENodes,
  useNodeHealth,
  useTEENetworkStatus,
} from '@/hooks/useTEEAttestation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
});

// ===========================================================================
// useAttestationStatus
// ===========================================================================

describe('useAttestationStatus', () => {
  it('fetches attestation data from API when enclaveId is provided', async () => {
    mockApiClient.get.mockResolvedValue({ enclaveId: 'enc-1', valid: true });
    const { result } = renderHook(() => useAttestationStatus('enc-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/tee/attestation/enc-1');
  });

  it('returns isAttested=true when on-chain status is verified', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 'verified', isLoading: false });
    const { result } = renderHook(() => useAttestationStatus('enc-1'), { wrapper: createWrapper() });

    expect(result.current.isAttested).toBe(true);
    expect(result.current.isExpired).toBe(false);
  });

  it('returns isExpired=true when on-chain status is expired', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 'expired', isLoading: false });
    const { result } = renderHook(() => useAttestationStatus('enc-1'), { wrapper: createWrapper() });

    expect(result.current.isAttested).toBe(false);
    expect(result.current.isExpired).toBe(true);
  });

  it('returns isAttested=false when no on-chain data', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useAttestationStatus('enc-1'), { wrapper: createWrapper() });

    expect(result.current.isAttested).toBe(false);
  });

  it('does not fetch when enclaveId is undefined', () => {
    const { result } = renderHook(() => useAttestationStatus(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useVerifyAttestation
// ===========================================================================

describe('useVerifyAttestation', () => {
  it('shows success toast when attestation is valid', async () => {
    mockApiClient.post.mockResolvedValue({
      valid: true,
      enclaveId: 'enc-001-abcdefgh12345678',
      mrEnclave: '0xmrenc',
      mrSigner: '0xmrsig',
      reportData: '0xdata',
    });
    const { result } = renderHook(() => useVerifyAttestation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        quote: '0xquote',
        expectedMrEnclave: '0xmrenc',
        expectedMrSigner: '0xmrsig',
        nonce: '0xnonce',
      } as any);
    });

    expect(mockToast.success).toHaveBeenCalledWith('Attestation verified', {
      description: expect.stringContaining('enc-001-abcdefgh'),
    });
  });

  it('shows error toast when attestation is invalid', async () => {
    mockApiClient.post.mockResolvedValue({
      valid: false,
      enclaveId: 'enc-1',
      mrEnclave: '0x',
      mrSigner: '0x',
      reportData: '0x',
    });
    const { result } = renderHook(() => useVerifyAttestation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        quote: '0x',
        expectedMrEnclave: '0x',
        expectedMrSigner: '0x',
        nonce: '0x',
      } as any);
    });

    expect(mockToast.error).toHaveBeenCalledWith('Attestation verification failed', {
      description: 'The enclave could not be verified against root of trust',
    });
  });

  it('shows error toast on network failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Connection refused'));
    const { result } = renderHook(() => useVerifyAttestation(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          quote: '0x',
          expectedMrEnclave: '0x',
          expectedMrSigner: '0x',
          nonce: '0x',
        } as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Attestation verification error', { description: 'Connection refused' });
  });
});

// ===========================================================================
// useTEENodes
// ===========================================================================

describe('useTEENodes', () => {
  it('fetches active TEE nodes by default', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'node-1', status: 'active' }]);
    const { result } = renderHook(() => useTEENodes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('active=true');
  });

  it('fetches all nodes when activeOnly=false', async () => {
    mockApiClient.get.mockResolvedValue([]);
    const { result } = renderHook(() => useTEENodes(false), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).not.toContain('active=true');
  });
});

// ===========================================================================
// useNodeHealth
// ===========================================================================

describe('useNodeHealth', () => {
  it('fetches node health by nodeId', async () => {
    mockApiClient.get.mockResolvedValue({ nodeId: 'n-1', status: 'healthy', uptime: 99.99 });
    const { result } = renderHook(() => useNodeHealth('n-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/tee/nodes/n-1/health');
  });

  it('is disabled when nodeId is undefined', () => {
    const { result } = renderHook(() => useNodeHealth(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useTEENetworkStatus
// ===========================================================================

describe('useTEENetworkStatus', () => {
  it('fetches TEE network status', async () => {
    mockApiClient.get.mockResolvedValue({
      totalNodes: 10,
      activeNodes: 9,
      attestedNodes: 9,
      avgUptime: 99.95,
      lastRefresh: Date.now(),
    });
    const { result } = renderHook(() => useTEENetworkStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/tee/network/status');
  });
});
