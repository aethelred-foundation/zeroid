/**
 * useAnalytics — Unit Tests
 *
 * Tests for privacy-preserving analytics hooks: privacy score,
 * credential usage, verifier analytics, exposure timeline,
 * benchmarks, recommendations, and export.
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
  usePrivacyScore,
  useCredentialUsageAnalytics,
  useVerifierAnalytics,
  useDataExposureTimeline,
  useNetworkBenchmarks,
  usePrivacyRecommendations,
  useExportAnalyticsReport,
} from '@/hooks/useAnalytics';

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
// usePrivacyScore
// ===========================================================================

describe('usePrivacyScore', () => {
  const mockScore = {
    overallScore: 85,
    grade: 'A',
    breakdown: {
      selectiveDisclosureUsage: 90,
      zkProofAdoption: 80,
      credentialMinimisation: 85,
      dataExposureControl: 88,
      verifierDiversity: 75,
      consentManagement: 92,
    },
    trend: { direction: 'improving', changePercent: 5, period: '30d', history: [] },
    lastCalculatedAt: '2026-01-01T00:00:00Z',
    percentileRank: 92,
  };

  it('fetches privacy score for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockScore);
    const { result } = renderHook(() => usePrivacyScore(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/privacy-score', { owner: mockAddress });
    expect(result.current.data).toEqual(mockScore);
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => usePrivacyScore(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useCredentialUsageAnalytics
// ===========================================================================

describe('useCredentialUsageAnalytics', () => {
  const mockUsage = {
    period: '30d',
    totalPresentations: 42,
    uniqueVerifiers: 8,
    zkProofPresentations: 20,
    selectiveDisclosurePresentations: 15,
    fullDisclosurePresentations: 7,
    privacyPreservingRatio: 0.83,
    byCredentialType: [],
    byDay: [],
    topAttributes: [],
  };

  it('fetches usage analytics with default period', async () => {
    mockApiClient.get.mockResolvedValue(mockUsage);
    const { result } = renderHook(() => useCredentialUsageAnalytics(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/credential-usage', {
      owner: mockAddress,
      period: '30d',
    });
  });

  it('accepts custom period parameter', async () => {
    mockApiClient.get.mockResolvedValue({ ...mockUsage, period: '90d' });
    const { result } = renderHook(() => useCredentialUsageAnalytics('90d'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/credential-usage', {
      owner: mockAddress,
      period: '90d',
    });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useCredentialUsageAnalytics(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useVerifierAnalytics
// ===========================================================================

describe('useVerifierAnalytics', () => {
  const mockVerifiers = {
    totalVerifiers: 5,
    verifiers: [],
    requestsByPurpose: [],
    trustDistribution: [],
  };

  it('fetches verifier analytics for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockVerifiers);
    const { result } = renderHook(() => useVerifierAnalytics(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/verifiers', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useVerifierAnalytics(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useDataExposureTimeline
// ===========================================================================

describe('useDataExposureTimeline', () => {
  const mockExposure = {
    entries: [],
    totalDisclosures: 12,
    uniqueAttributesExposed: 4,
    uniqueVerifiers: 3,
    riskLevel: 'low',
    highRiskExposures: 0,
  };

  it('fetches exposure timeline for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockExposure);
    const { result } = renderHook(() => useDataExposureTimeline(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/exposure', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useDataExposureTimeline(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useNetworkBenchmarks
// ===========================================================================

describe('useNetworkBenchmarks', () => {
  const mockBenchmarks = {
    calculatedAt: '2026-01-01T00:00:00Z',
    sampleSize: 10000,
    benchmarks: [],
    userPercentiles: {},
  };

  it('fetches benchmarks for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockBenchmarks);
    const { result } = renderHook(() => useNetworkBenchmarks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/benchmarks', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useNetworkBenchmarks(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// usePrivacyRecommendations
// ===========================================================================

describe('usePrivacyRecommendations', () => {
  const mockRecs = [
    {
      id: 'rec-1',
      priority: 'high',
      category: 'zkProof',
      title: 'Use ZK proofs more',
      description: 'Increase ZK proof usage',
      currentBehavior: 'Low ZK usage',
      suggestedAction: 'Enable ZK',
      estimatedImpact: 15,
      implementationSteps: ['Step 1'],
    },
  ];

  it('fetches recommendations for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockRecs);
    const { result } = renderHook(() => usePrivacyRecommendations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/analytics/recommendations', { owner: mockAddress });
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => usePrivacyRecommendations(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useExportAnalyticsReport
// ===========================================================================

describe('useExportAnalyticsReport', () => {
  const mockExport = {
    id: 'exp-1',
    format: 'pdf',
    encryptionMethod: 'aes-256-gcm',
    downloadUrl: 'https://example.com/report.pdf',
    generatedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-08T00:00:00Z',
    sizeBytes: 10240,
    checksum: 'abc123',
  };

  it('exports report and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockExport);
    const { result } = renderHook(() => useExportAnalyticsReport(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ format: 'pdf', period: '30d' });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/analytics/export', { format: 'pdf', period: '30d' });
    expect(mockToast.success).toHaveBeenCalledWith('Analytics report exported', {
      description: expect.stringContaining('PDF'),
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Export limit'));
    const { result } = renderHook(() => useExportAnalyticsReport(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ format: 'json' });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Export failed', { description: 'Export limit' });
  });
});
