/**
 * useProof — Unit Tests
 *
 * Tests for the convenience proof hook that re-exports from useZKProof.
 */

import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: mockAddress, isConnected: true })),
  useWriteContract: jest.fn(() => ({ writeContractAsync: jest.fn() })),
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
  ZK_VERIFIER_ADDRESS: '0xZKVerifier',
  ZK_VERIFIER_ABI: [],
  ZK_CIRCUIT_BASE_URL: 'https://circuits.example.com',
}));

import { useProof } from '@/hooks/useProof';

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
  mockApiClient.get.mockResolvedValue([]);
});

// ===========================================================================
// useProof
// ===========================================================================

describe('useProof', () => {
  it('exposes generateProof function', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(typeof result.current.generateProof).toBe('function');
  });

  it('exposes verifyProof function', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(typeof result.current.verifyProof).toBe('function');
  });

  it('exposes isVerifying boolean', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(result.current.isVerifying).toBe(false);
  });

  it('exposes cancelGeneration function', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(typeof result.current.cancelGeneration).toBe('function');
  });

  it('exposes proofStatus from progress.stage', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(result.current.proofStatus).toBe('idle');
  });

  it('exposes progress object', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(result.current.progress).toEqual({ stage: 'idle', percent: 0 });
  });

  it('exposes proofHistory as empty array initially', () => {
    const { result } = renderHook(() => useProof(), { wrapper: createWrapper() });
    expect(result.current.proofHistory).toEqual([]);
  });
});
