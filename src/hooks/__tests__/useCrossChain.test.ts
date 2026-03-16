/**
 * useCrossChain — Unit Tests
 *
 * Tests for cross-chain hooks: supported chains, bridge credential,
 * bridge status, bridged credentials, fee estimation, and cross-chain verification.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
const mockWriteContractAsync = jest.fn();

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
  useWriteContract: jest.fn(() => ({ writeContractAsync: mockWriteContractAsync })),
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
  CONTRACT_ADDRESSES: {
    credentialRegistry: '0xContractAddress',
  },
}));

import { useAccount } from 'wagmi';
import {
  useSupportedChains,
  useBridgeCredential,
  useBridgeStatus,
  useBridgedCredentials,
  useBridgeFeeEstimate,
  useVerifyBridgedCredential,
} from '@/hooks/useCrossChain';

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
  (useAccount as jest.Mock).mockReturnValue({ address: mockAddress, isConnected: true });
});

// ===========================================================================
// useSupportedChains
// ===========================================================================

describe('useSupportedChains', () => {
  const mockChains = [
    { chainId: 1, name: 'Ethereum', shortName: 'ETH', network: 'mainnet', isActive: true },
  ];

  it('fetches supported chains', async () => {
    mockApiClient.get.mockResolvedValue(mockChains);
    const { result } = renderHook(() => useSupportedChains(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/bridge/chains');
    expect(result.current.data).toEqual(mockChains);
  });
});

// ===========================================================================
// useBridgeCredential
// ===========================================================================

describe('useBridgeCredential', () => {
  const mockBridgeTx = {
    id: 'bridge-1',
    credentialId: 'cred-1',
    credentialSchemaName: 'KYC',
    sourceChainId: 1,
    destinationChainId: 137,
    sourceChainName: 'Ethereum',
    destinationChainName: 'Polygon',
    status: 'pending',
    priority: 'standard',
    sourceTxHash: '0xtx',
    initiatedAt: '2026-01-01T00:00:00Z',
    estimatedCompletionAt: '2026-01-01T01:00:00Z',
    fee: { baseFee: '0.01', priorityFee: '0', totalFee: '0.01', feeCurrency: 'ETH', feeUSD: 30 },
    sourceConfirmations: 0,
    requiredConfirmations: 12,
  };

  it('initiates bridge on-chain and via API', async () => {
    mockWriteContractAsync.mockResolvedValue('0xtxhash');
    mockApiClient.post.mockResolvedValue(mockBridgeTx);
    const { result } = renderHook(() => useBridgeCredential(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        credentialId: 'cred-1',
        destinationChainId: 137,
        priority: 'standard' as const,
        preservePrivacy: true,
      });
    });

    expect(mockWriteContractAsync).toHaveBeenCalled();
    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/bridge/initiate', expect.objectContaining({
      credentialId: 'cred-1',
      destinationChainId: 137,
      sourceTxHash: '0xtxhash',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Bridge initiated', {
      description: expect.stringContaining('Polygon'),
    });
  });

  it('uses recipientAddress when provided', async () => {
    const customRecipient = '0xCustomRecipient' as any;
    mockWriteContractAsync.mockResolvedValue('0xtxhash2');
    mockApiClient.post.mockResolvedValue({
      ...mockBridgeTx,
      id: 'bridge-2',
    });
    const { result } = renderHook(() => useBridgeCredential(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        credentialId: 'cred-1',
        destinationChainId: 137,
        recipientAddress: customRecipient,
        priority: 'standard' as const,
        preservePrivacy: true,
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/bridge/initiate', expect.objectContaining({
      recipientAddress: customRecipient,
    }));
  });

  it('shows error toast on failure', async () => {
    mockWriteContractAsync.mockRejectedValue(new Error('User rejected'));
    const { result } = renderHook(() => useBridgeCredential(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          credentialId: 'c',
          destinationChainId: 1,
          priority: 'standard' as const,
          preservePrivacy: false,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Bridge initiation failed', { description: 'User rejected' });
  });
});

// ===========================================================================
// useBridgeStatus
// ===========================================================================

describe('useBridgeStatus', () => {
  it('fetches bridge status by id', async () => {
    mockApiClient.get.mockResolvedValue({ id: 'bridge-1', status: 'completed' });
    const { result } = renderHook(() => useBridgeStatus('bridge-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/bridge/status/bridge-1');
  });

  it('is disabled when bridgeId is undefined', () => {
    const { result } = renderHook(() => useBridgeStatus(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('continues polling for in-progress bridge status', async () => {
    mockApiClient.get.mockResolvedValue({ id: 'bridge-1', status: 'relaying' });
    const { result } = renderHook(() => useBridgeStatus('bridge-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(expect.objectContaining({ status: 'relaying' }));
  });
});

// ===========================================================================
// useBridgedCredentials
// ===========================================================================

describe('useBridgedCredentials', () => {
  it('fetches bridged credentials for connected address', async () => {
    mockApiClient.get.mockResolvedValue([]);
    const { result } = renderHook(() => useBridgedCredentials(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/bridge/credentials', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useBridgedCredentials(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useBridgeFeeEstimate
// ===========================================================================

describe('useBridgeFeeEstimate', () => {
  it('fetches fee estimate for credential and chain', async () => {
    const mockEstimate = { credentialId: 'c-1', destinationChainId: 137, estimates: {}, estimatedTimes: {}, validUntil: '2026-01-01T00:00:00Z' };
    mockApiClient.get.mockResolvedValue(mockEstimate);
    const { result } = renderHook(() => useBridgeFeeEstimate('c-1', 137), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/bridge/estimate', {
      credentialId: 'c-1',
      destinationChainId: 137,
    });
  });

  it('is disabled when credentialId is undefined', () => {
    const { result } = renderHook(() => useBridgeFeeEstimate(undefined, 137), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when destinationChainId is undefined', () => {
    const { result } = renderHook(() => useBridgeFeeEstimate('c-1', undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useVerifyBridgedCredential
// ===========================================================================

describe('useVerifyBridgedCredential', () => {
  it('shows success toast when credential verified', async () => {
    mockApiClient.post.mockResolvedValue({
      credentialId: 'c-1',
      chainId: 137,
      chainName: 'Polygon',
      verified: true,
      verifiedAt: '2026-01-01T00:00:00Z',
      integrityValid: true,
      expiryValid: true,
      issuerValid: true,
      revocationChecked: true,
      isRevoked: false,
    });
    const { result } = renderHook(() => useVerifyBridgedCredential(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ credentialId: 'c-1', chainId: 137 });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Credential verified on destination chain', {
      description: expect.stringContaining('Polygon'),
    });
  });

  it('shows error toast when verification fails', async () => {
    mockApiClient.post.mockResolvedValue({
      credentialId: 'c-1',
      chainId: 137,
      chainName: 'Polygon',
      verified: false,
    });
    const { result } = renderHook(() => useVerifyBridgedCredential(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ credentialId: 'c-1', chainId: 137 });
    });

    expect(mockToast.error).toHaveBeenCalledWith('Credential verification failed', {
      description: expect.stringContaining('Polygon'),
    });
  });

  it('shows error toast on network error', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useVerifyBridgedCredential(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ credentialId: 'c', chainId: 1 });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Cross-chain verification failed', { description: 'Network error' });
  });
});
