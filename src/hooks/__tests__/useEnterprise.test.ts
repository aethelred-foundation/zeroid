/**
 * useEnterprise — Unit Tests
 *
 * Tests for enterprise hooks: API keys, webhooks, SLA reports, usage metrics.
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
  useAPIKeys,
  useCreateAPIKey,
  useRevokeAPIKey,
  useWebhooks,
  useRegisterWebhook,
  useTestWebhook,
  useSLAReport,
  useUsageMetrics,
} from '@/hooks/useEnterprise';

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
// useAPIKeys
// ===========================================================================

describe('useAPIKeys', () => {
  it('fetches API keys for connected address', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'key-1', name: 'Production' }]);
    const { result } = renderHook(() => useAPIKeys(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/api-keys', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useAPIKeys(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useCreateAPIKey
// ===========================================================================

describe('useCreateAPIKey', () => {
  const mockKeyWithSecret = {
    id: 'key-1',
    name: 'Production',
    keyPrefix: 'zid_live_',
    scopes: ['identity:read'],
    secret: 'zid_live_abc123',
    isActive: true,
    usageCount: 0,
    rateLimit: 1000,
    rateLimitWindow: 60,
    allowedOrigins: [],
    allowedIPs: [],
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('creates API key and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockKeyWithSecret);
    const { result } = renderHook(() => useCreateAPIKey(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Production',
        scopes: ['identity:read'] as any,
        rateLimit: 1000,
        rateLimitWindow: 60,
        allowedOrigins: [],
        allowedIPs: [],
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('API key created', {
      description: expect.stringContaining('Production'),
      duration: 10_000,
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Limit reached'));
    const { result } = renderHook(() => useCreateAPIKey(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: 'X',
          scopes: [],
          rateLimit: 100,
          rateLimitWindow: 60,
          allowedOrigins: [],
          allowedIPs: [],
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('API key creation failed', { description: 'Limit reached' });
  });
});

// ===========================================================================
// useRevokeAPIKey
// ===========================================================================

describe('useRevokeAPIKey', () => {
  it('revokes API key and shows success toast', async () => {
    mockApiClient.del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRevokeAPIKey(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('key-1');
    });

    expect(mockApiClient.del).toHaveBeenCalledWith('/api/v1/enterprise/api-keys/key-1');
    expect(mockToast.success).toHaveBeenCalledWith('API key revoked');
  });

  it('shows error toast on failure', async () => {
    mockApiClient.del.mockRejectedValue(new Error('Not found'));
    const { result } = renderHook(() => useRevokeAPIKey(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync('key-x');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Key revocation failed', { description: 'Not found' });
  });
});

// ===========================================================================
// useWebhooks
// ===========================================================================

describe('useWebhooks', () => {
  it('fetches webhooks for connected address', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'wh-1', url: 'https://example.com/hook' }]);
    const { result } = renderHook(() => useWebhooks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/webhooks', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useWebhooks(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useRegisterWebhook
// ===========================================================================

describe('useRegisterWebhook', () => {
  const mockWebhook = {
    id: 'wh-1',
    url: 'https://example.com/hook',
    events: ['identity.created', 'credential.issued'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    enabled: true,
    retryPolicy: { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 },
    successRate: 100,
    totalDeliveries: 0,
    failedDeliveries: 0,
    signingKeyId: 'sk-1',
  };

  it('registers webhook and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockWebhook);
    const { result } = renderHook(() => useRegisterWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        url: 'https://example.com/hook',
        events: ['identity.created', 'credential.issued'] as any,
        retryPolicy: { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 },
        enabled: true,
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Webhook registered', {
      description: expect.stringContaining('2 event type(s)'),
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Invalid URL'));
    const { result } = renderHook(() => useRegisterWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          url: 'bad',
          events: [],
          retryPolicy: { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 },
          enabled: true,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Webhook registration failed', { description: 'Invalid URL' });
  });
});

// ===========================================================================
// useTestWebhook
// ===========================================================================

describe('useTestWebhook', () => {
  it('shows success toast when webhook test delivered', async () => {
    mockApiClient.post.mockResolvedValue({
      webhookId: 'wh-1',
      delivered: true,
      statusCode: 200,
      responseTimeMs: 150,
      testedAt: '2026-01-01T00:00:00Z',
    });
    const { result } = renderHook(() => useTestWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('wh-1');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Webhook test delivered', {
      description: 'Status 200, 150ms',
    });
  });

  it('shows error toast when webhook test fails', async () => {
    mockApiClient.post.mockResolvedValue({
      webhookId: 'wh-1',
      delivered: false,
      statusCode: 500,
      responseTimeMs: 5000,
      error: 'Server error',
      testedAt: '2026-01-01T00:00:00Z',
    });
    const { result } = renderHook(() => useTestWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('wh-1');
    });

    expect(mockToast.error).toHaveBeenCalledWith('Webhook test failed', {
      description: 'Server error',
    });
  });

  it('shows status code in description when error is undefined', async () => {
    mockApiClient.post.mockResolvedValue({
      webhookId: 'wh-1',
      delivered: false,
      statusCode: 503,
      responseTimeMs: 5000,
      testedAt: '2026-01-01T00:00:00Z',
    });
    const { result } = renderHook(() => useTestWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('wh-1');
    });

    expect(mockToast.error).toHaveBeenCalledWith('Webhook test failed', {
      description: 'Status 503',
    });
  });

  it('shows error toast on request failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Network'));
    const { result } = renderHook(() => useTestWebhook(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync('wh-1');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Webhook test request failed', { description: 'Network' });
  });
});

// ===========================================================================
// useSLAReport
// ===========================================================================

describe('useSLAReport', () => {
  it('fetches SLA report with default period', async () => {
    mockApiClient.get.mockResolvedValue({ period: 'month', uptimePercent: 99.99 });
    const { result } = renderHook(() => useSLAReport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/sla', { period: 'month', owner: mockAddress });
  });

  it('accepts custom period', async () => {
    mockApiClient.get.mockResolvedValue({ period: 'quarter', uptimePercent: 99.95 });
    const { result } = renderHook(() => useSLAReport('quarter'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/sla', { period: 'quarter', owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useSLAReport(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useUsageMetrics
// ===========================================================================

describe('useUsageMetrics', () => {
  it('fetches usage metrics with default period', async () => {
    mockApiClient.get.mockResolvedValue({ period: 'month', totalAPIRequests: 50000 });
    const { result } = renderHook(() => useUsageMetrics(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/usage', { period: 'month', owner: mockAddress });
  });

  it('accepts custom period', async () => {
    mockApiClient.get.mockResolvedValue({ period: 'week', totalAPIRequests: 10000 });
    const { result } = renderHook(() => useUsageMetrics('week'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/enterprise/usage', { period: 'week', owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useUsageMetrics(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
