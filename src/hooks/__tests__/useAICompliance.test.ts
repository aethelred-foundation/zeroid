/**
 * useAICompliance — Unit Tests
 *
 * Tests for all AI compliance hooks: screening, risk assessment, copilot,
 * alerts, report generation, and regulatory change simulation.
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
  useScreenIdentity,
  useRiskAssessment,
  useRefreshRiskAssessment,
  useComplianceCopilot,
  useComplianceAlerts,
  useAcknowledgeAlert,
  useGenerateReport,
  useSimulateRegChange,
} from '@/hooks/useAICompliance';

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
// useScreenIdentity
// ===========================================================================

describe('useScreenIdentity', () => {
  const cleanResult = {
    identityId: 'id-1',
    sanctionsHit: false,
    pepHit: false,
    adverseMediaHits: 0,
    matchedEntities: [],
    screenedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-02-01T00:00:00Z',
    confidence: 0.99,
  };

  const flaggedResult = {
    ...cleanResult,
    sanctionsHit: true,
    matchedEntities: [{ name: 'Entity A', listSource: 'OFAC', matchScore: 0.95, category: 'sanctions', jurisdiction: 'US' }],
  };

  it('calls API with identityId and screeningTypes', async () => {
    mockApiClient.post.mockResolvedValue(cleanResult);
    const { result } = renderHook(() => useScreenIdentity(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('id-1');
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/compliance/screen', {
      identityId: 'id-1',
      screeningTypes: ['sanctions', 'pep', 'adverse_media'],
    });
  });

  it('shows success toast when no matches found', async () => {
    mockApiClient.post.mockResolvedValue(cleanResult);
    const { result } = renderHook(() => useScreenIdentity(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('id-1');
    });

    expect(mockToast.success).toHaveBeenCalledWith('Screening complete — no matches found');
  });

  it('shows warning toast when matches found', async () => {
    mockApiClient.post.mockResolvedValue(flaggedResult);
    const { result } = renderHook(() => useScreenIdentity(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('id-1');
    });

    expect(mockToast.warning).toHaveBeenCalledWith('Screening flagged potential matches', {
      description: '1 match(es) found — review required',
    });
  });

  it('shows warning toast when pepHit is true and sanctionsHit is false', async () => {
    const pepResult = {
      ...cleanResult,
      pepHit: true,
      matchedEntities: [{ name: 'PEP Entity', listSource: 'PEP_DB', matchScore: 0.9, category: 'pep', jurisdiction: 'UK' }],
    };
    mockApiClient.post.mockResolvedValue(pepResult);
    const { result } = renderHook(() => useScreenIdentity(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('id-1');
    });

    expect(mockToast.warning).toHaveBeenCalledWith('Screening flagged potential matches', {
      description: '1 match(es) found — review required',
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => useScreenIdentity(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync('id-1');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Screening failed', { description: 'Server error' });
  });
});

// ===========================================================================
// useRiskAssessment
// ===========================================================================

describe('useRiskAssessment', () => {
  const mockRisk = {
    identityId: 'id-1',
    compositeScore: 25,
    riskLevel: 'low',
    factors: [],
    assessedAt: '2026-01-01T00:00:00Z',
    nextReviewAt: '2026-04-01T00:00:00Z',
    modelVersion: '2.1',
  };

  it('fetches risk assessment for given identityId', async () => {
    mockApiClient.get.mockResolvedValue(mockRisk);
    const { result } = renderHook(() => useRiskAssessment('id-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/compliance/risk/id-1');
    expect(result.current.data).toEqual(mockRisk);
  });

  it('is disabled when identityId is undefined', () => {
    const { result } = renderHook(() => useRiskAssessment(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useRefreshRiskAssessment
// ===========================================================================

describe('useRefreshRiskAssessment', () => {
  const mockRisk = {
    identityId: 'id-1',
    compositeScore: 42,
    riskLevel: 'medium',
    factors: [],
    assessedAt: '2026-01-01T00:00:00Z',
    nextReviewAt: '2026-04-01T00:00:00Z',
    modelVersion: '2.2',
  };

  it('posts refresh and shows success toast with score', async () => {
    mockApiClient.post.mockResolvedValue(mockRisk);
    const { result } = renderHook(() => useRefreshRiskAssessment(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('id-1');
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/compliance/risk/refresh', { identityId: 'id-1' });
    expect(mockToast.success).toHaveBeenCalledWith('Risk assessment updated', {
      description: 'Score: 42 (medium)',
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Timeout'));
    const { result } = renderHook(() => useRefreshRiskAssessment(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync('id-1');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Risk refresh failed', { description: 'Timeout' });
  });
});

// ===========================================================================
// useComplianceCopilot
// ===========================================================================

describe('useComplianceCopilot', () => {
  const mockResponse = {
    role: 'assistant',
    content: 'According to UAE VASP regulations...',
    timestamp: '2026-01-01T00:00:00Z',
    citations: [{ regulation: 'UAE VASP', section: '3.1' }],
  };

  it('sends message and returns response', async () => {
    mockApiClient.post.mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useComplianceCopilot(), { wrapper: createWrapper() });

    let response: unknown;
    await act(async () => {
      response = await result.current.sendMessage('What are UAE KYC rules?');
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/compliance/copilot', {
      message: 'What are UAE KYC rules?',
      context: 'zeroid_compliance',
    });
    expect(response).toEqual(mockResponse);
  });

  it('exposes isLoading and error state', () => {
    const { result } = renderHook(() => useComplianceCopilot(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('AI unavailable'));
    const { result } = renderHook(() => useComplianceCopilot(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.sendMessage('test');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Copilot request failed', { description: 'AI unavailable' });
  });
});

// ===========================================================================
// useComplianceAlerts
// ===========================================================================

describe('useComplianceAlerts', () => {
  const mockAlerts = [
    { id: 'a-1', severity: 'warning', type: 'sanctions', title: 'Alert 1', description: 'desc', createdAt: '2026-01-01T00:00:00Z' },
  ];

  it('fetches alerts for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockAlerts);
    const { result } = renderHook(() => useComplianceAlerts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/compliance/alerts', { owner: mockAddress });
    expect(result.current.data).toEqual(mockAlerts);
  });

  it('is disabled when address is not connected', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useComplianceAlerts(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useAcknowledgeAlert
// ===========================================================================

describe('useAcknowledgeAlert', () => {
  it('posts acknowledge and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('alert-123');
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/compliance/alerts/alert-123/acknowledge', {});
    expect(mockToast.success).toHaveBeenCalledWith('Alert acknowledged');
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Not found'));
    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync('alert-123');
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to acknowledge alert', { description: 'Not found' });
  });
});

// ===========================================================================
// useGenerateReport
// ===========================================================================

describe('useGenerateReport', () => {
  const mockReport = {
    id: 'rpt-1',
    type: 'sar',
    generatedAt: '2026-01-01T00:00:00Z',
    format: 'pdf',
    downloadUrl: 'https://example.com/report.pdf',
    expiresAt: '2026-01-08T00:00:00Z',
  };

  it('generates report and shows success toast', async () => {
    mockApiClient.post.mockResolvedValue(mockReport);
    const { result } = renderHook(() => useGenerateReport(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ type: 'sar', format: 'pdf' });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/compliance/reports/generate', { type: 'sar', format: 'pdf' });
    expect(mockToast.success).toHaveBeenCalledWith('Report generated', {
      description: 'sar report ready for download',
    });
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Generation error'));
    const { result } = renderHook(() => useGenerateReport(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ type: 'ctr' });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Report generation failed', { description: 'Generation error' });
  });
});

// ===========================================================================
// useSimulateRegChange
// ===========================================================================

describe('useSimulateRegChange', () => {
  const simWithGaps = {
    regulation: 'MiCA',
    changes: {},
    impactedIdentities: 100,
    complianceGapsBefore: 2,
    complianceGapsAfter: 5,
    estimatedRemediationCost: 50000,
    affectedJurisdictions: ['EU', 'UK'],
    recommendations: ['Update KYC'],
  };

  const simNoGaps = {
    ...simWithGaps,
    complianceGapsAfter: 1,
  };

  it('shows warning toast when new gaps detected', async () => {
    mockApiClient.post.mockResolvedValue(simWithGaps);
    const { result } = renderHook(() => useSimulateRegChange(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ regulation: 'MiCA', changes: {} });
    });

    expect(mockToast.warning).toHaveBeenCalledWith('Simulation complete', {
      description: '3 new compliance gap(s) detected across 2 jurisdiction(s)',
    });
  });

  it('shows success toast when no new gaps', async () => {
    mockApiClient.post.mockResolvedValue(simNoGaps);
    const { result } = renderHook(() => useSimulateRegChange(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ regulation: 'MiCA', changes: {} });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Simulation complete — no new gaps detected');
  });

  it('shows error toast on failure', async () => {
    mockApiClient.post.mockRejectedValue(new Error('Sim failed'));
    const { result } = renderHook(() => useSimulateRegChange(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ regulation: 'X', changes: {} });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Simulation failed', { description: 'Sim failed' });
  });
});
