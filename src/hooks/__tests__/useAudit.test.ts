/**
 * useAudit — Unit Tests
 *
 * Tests for audit trail hooks: general audit log, credential audit,
 * verification audit, activity summary, and audit export.
 */

import { renderHook, waitFor } from '@testing-library/react';
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
  useAudit,
  useAuditLog,
  useCredentialAudit,
  useVerificationAudit,
  useIdentityActivitySummary,
  exportAuditLog,
} from '@/hooks/useAudit';

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
// useAudit (convenience wrapper)
// ===========================================================================

describe('useAudit', () => {
  it('returns auditLog array and total from useAuditLog data', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [{ id: '1', action: 'create' }], total: 1 });
    const { result } = renderHook(() => useAudit(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.auditLog).toEqual([{ id: '1', action: 'create' }]);
    expect(result.current.total).toBe(1);
  });

  it('returns empty array when data is undefined', () => {
    mockApiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useAudit(), { wrapper: createWrapper() });
    expect(result.current.auditLog).toEqual([]);
    expect(result.current.total).toBe(0);
  });
});

// ===========================================================================
// useAuditLog
// ===========================================================================

describe('useAuditLog', () => {
  it('fetches audit log for connected address', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [], total: 0 });
    const { result } = renderHook(() => useAuditLog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/audit/${mockAddress}/log`),
    );
  });

  it('applies filter parameters to URL', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [], total: 0 });
    const filters = { action: 'create', entityType: 'credential', page: 2, pageSize: 25 };
    const { result } = renderHook(() => useAuditLog(filters), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('action=create');
    expect(url).toContain('entityType=credential');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=25');
  });

  it('uses default page=1 and pageSize=50', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [], total: 0 });
    const { result } = renderHook(() => useAuditLog(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=50');
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useAuditLog(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('applies entityId and date filters to URL', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [], total: 0 });
    const filters = { entityId: 'ent-1', startDate: '2026-01-01', endDate: '2026-03-01' };
    const { result } = renderHook(() => useAuditLog(filters), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('entityId=ent-1');
    expect(url).toContain('startDate=2026-01-01');
    expect(url).toContain('endDate=2026-03-01');
  });
});

// ===========================================================================
// useCredentialAudit
// ===========================================================================

describe('useCredentialAudit', () => {
  it('fetches credential audit trail', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'ca-1', action: 'issued' }]);
    const { result } = renderHook(() => useCredentialAudit('cred-123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/audit/credential/cred-123');
  });

  it('is disabled when credentialId is undefined', () => {
    const { result } = renderHook(() => useCredentialAudit(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useVerificationAudit
// ===========================================================================

describe('useVerificationAudit', () => {
  it('fetches verification audit trail', async () => {
    mockApiClient.get.mockResolvedValue([{ id: 'va-1', action: 'completed' }]);
    const { result } = renderHook(() => useVerificationAudit('ver-456'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/audit/verification/ver-456');
  });

  it('is disabled when verificationId is undefined', () => {
    const { result } = renderHook(() => useVerificationAudit(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// useIdentityActivitySummary
// ===========================================================================

describe('useIdentityActivitySummary', () => {
  const mockSummary = {
    totalActions: 100,
    credentialsIssued: 10,
    credentialsRevoked: 1,
    verificationsCompleted: 50,
    verificationsReceived: 30,
    disclosuresMade: 9,
    lastActivity: '2026-01-01T00:00:00Z',
  };

  it('fetches activity summary for connected address', async () => {
    mockApiClient.get.mockResolvedValue(mockSummary);
    const { result } = renderHook(() => useIdentityActivitySummary(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(`/v1/audit/${mockAddress}/summary`);
    expect(result.current.data).toEqual(mockSummary);
  });

  it('is disabled when no address', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { result } = renderHook(() => useIdentityActivitySummary(), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ===========================================================================
// exportAuditLog (standalone async function)
// ===========================================================================

describe('exportAuditLog', () => {
  let mockCreateObjectURL: jest.Mock;
  let mockRevokeObjectURL: jest.Mock;
  let mockClick: jest.Mock;

  beforeEach(() => {
    mockCreateObjectURL = jest.fn(() => 'blob:url');
    mockRevokeObjectURL = jest.fn();
    mockClick = jest.fn();

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
    jest.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: mockClick,
    } as unknown as HTMLElement);
  });

  it('exports JSON audit log and triggers download', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [{ id: '1' }] });
    await exportAuditLog(mockAddress, {}, 'json');

    expect(mockApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/audit/${mockAddress}/export`),
    );
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:url');
    expect(mockToast.success).toHaveBeenCalledWith('Audit log exported');
  });

  it('exports CSV audit log', async () => {
    mockApiClient.get.mockResolvedValue('col1,col2\nval1,val2');
    await exportAuditLog(mockAddress, { action: 'create' }, 'csv');

    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('format=csv');
    expect(url).toContain('action=create');
  });

  it('shows error toast on failure', async () => {
    mockApiClient.get.mockRejectedValue(new Error('Export failed'));
    await exportAuditLog(mockAddress);

    expect(mockToast.error).toHaveBeenCalledWith('Export failed', { description: 'Export failed' });
  });

  it('applies entityType and date range filters to URL', async () => {
    mockApiClient.get.mockResolvedValue({ entries: [] });
    await exportAuditLog(mockAddress, {
      entityType: 'identity',
      startDate: '2026-01-01',
      endDate: '2026-03-01',
    }, 'json');

    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('entityType=identity');
    expect(url).toContain('startDate=2026-01-01');
    expect(url).toContain('endDate=2026-03-01');
  });
});

