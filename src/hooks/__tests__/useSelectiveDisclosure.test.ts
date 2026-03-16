/**
 * useSelectiveDisclosure — Unit Tests
 *
 * Tests for selective disclosure hooks: create request, build response,
 * pending disclosures, request detail, and history.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
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

import { useAccount } from 'wagmi';
import {
  useCreateDisclosureRequest,
  useBuildDisclosureResponse,
  usePendingDisclosures,
  useDisclosureRequest,
  useDisclosureHistory,
} from '@/hooks/useSelectiveDisclosure';

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
// useCreateDisclosureRequest
// ===========================================================================

describe('useCreateDisclosureRequest', () => {
  const mockResponse = {
    requestId: 'req-1',
    challenge: 'challenge-string-1234567890abcdef1234',
  };

  it('creates disclosure request and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useCreateDisclosureRequest(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        subjectDid: 'did:aethelred:mainnet:0x1',
        requestedAttributes: [{ key: 'name', required: true }] as any,
        policy: { minTrustLevel: 3 } as any,
        purpose: 'KYC verification',
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/v1/disclosure/request', expect.objectContaining({
      verifierAddress: mockAddress,
      subjectDid: 'did:aethelred:mainnet:0x1',
      purpose: 'KYC verification',
      expiresIn: 3600,
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Disclosure request created', {
      description: expect.stringContaining('Challenge issued'),
    });
  });

  it('uses custom expiresIn when provided', async () => {
    mockApiClient.post.mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useCreateDisclosureRequest(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        subjectDid: 'did:x',
        requestedAttributes: [],
        policy: {} as any,
        purpose: 'test',
        expiresIn: 7200,
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/v1/disclosure/request', expect.objectContaining({
      expiresIn: 7200,
    }));
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Subject not found'));
    const { result } = renderHook(() => useCreateDisclosureRequest(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          subjectDid: 'did:x',
          requestedAttributes: [],
          policy: {} as any,
          purpose: 'test',
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to create disclosure request', {
      description: 'Subject not found',
    });
  });
});

// ===========================================================================
// useBuildDisclosureResponse
// ===========================================================================

describe('useBuildDisclosureResponse', () => {
  it('builds response and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue({ status: 'submitted' });
    const { result } = renderHook(() => useBuildDisclosureResponse(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        requestId: 'req-1',
        selectedAttributes: [{ key: 'name' }] as any,
        credentialIds: ['cred-1'],
        zkProof: '0xproof',
      });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/v1/disclosure/req-1/respond', expect.objectContaining({
      holderAddress: mockAddress,
      credentialIds: ['cred-1'],
      zkProof: '0xproof',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Disclosure response submitted', {
      description: 'Selected attributes shared with verifier',
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Expired'));
    const { result } = renderHook(() => useBuildDisclosureResponse(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          requestId: 'req-1',
          selectedAttributes: [],
          credentialIds: [],
          zkProof: '',
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Disclosure response failed', { description: 'Expired' });
  });
});

// ===========================================================================
// usePendingDisclosures
// ===========================================================================

describe('usePendingDisclosures', () => {
  it('fetches pending disclosures for connected address', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'req-1', status: 'pending' }]);
    const { result } = renderHook(() => usePendingDisclosures(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(`/v1/disclosure/pending/${mockAddress}`);
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => usePendingDisclosures(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useDisclosureRequest
// ===========================================================================

describe('useDisclosureRequest', () => {
  it('fetches disclosure request by id', async () => {
    mockApiClient.get.mockResolvedValue({ id: 'req-1', status: 'pending' });
    const { result } = renderHook(() => useDisclosureRequest('req-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/disclosure/req-1');
  });

  it('is disabled when requestId is undefined', () => {
    const { result } = renderHook(() => useDisclosureRequest(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useDisclosureHistory
// ===========================================================================

describe('useDisclosureHistory', () => {
  it('fetches disclosure history for connected address', async () => {
    mockApiClient.get.mockResolvedValue({ items: [{ id: 'h-1' }], total: 1 });
    const { result } = renderHook(() => useDisclosureHistory(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain(`/v1/disclosure/history/${mockAddress}`);
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=20');
  });

  it('accepts custom page and pageSize', async () => {
    mockApiClient.get.mockResolvedValue({ items: [], total: 0 });
    const { result } = renderHook(() => useDisclosureHistory(3, 50), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('page=3');
    expect(url).toContain('pageSize=50');
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useDisclosureHistory(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
