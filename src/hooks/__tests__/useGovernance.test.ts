/**
 * useGovernance — Unit Tests
 *
 * Tests for governance hooks: proposals, voting power, proposal detail,
 * create proposal, vote, execute, and the convenience wrapper.
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
  GOVERNANCE_ADDRESS: '0xGovAddress',
  GOVERNANCE_ABI: [],
  GOVERNANCE_TOKEN_ADDRESS: '0xGovTokenAddress',
  GOVERNANCE_TOKEN_ABI: [],
}));

import { useAccount, useReadContract } from 'wagmi';
import {
  useGovernance,
  useVotingPower,
  useProposals,
  useProposalDetail,
  useCreateProposal,
  useVote,
  useExecuteProposal,
} from '@/hooks/useGovernance';

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
  (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
});

// ===========================================================================
// useVotingPower
// ===========================================================================

describe('useVotingPower', () => {
  it('returns votingPower from on-chain balance', () => {
    (useReadContract as jest.Mock)
      .mockReturnValueOnce({ data: 1000n, isLoading: false })
      .mockReturnValueOnce({ data: '0xdelegatee' });

    const { result } = renderHook(() => useVotingPower(), { wrapper: createWrapper() });

    expect(result.current.votingPower).toBe(1000n);
    expect(result.current.delegatee).toBe('0xdelegatee');
    expect(result.current.hasPower).toBe(true);
  });

  it('returns 0n when no balance', () => {
    (useReadContract as jest.Mock)
      .mockReturnValueOnce({ data: undefined, isLoading: false })
      .mockReturnValueOnce({ data: undefined });

    const { result } = renderHook(() => useVotingPower(), { wrapper: createWrapper() });

    expect(result.current.votingPower).toBe(0n);
    expect(result.current.hasPower).toBe(false);
  });

  it('passes undefined args when address is not connected', () => {
    (useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    (useReadContract as jest.Mock)
      .mockReturnValueOnce({ data: undefined, isLoading: false })
      .mockReturnValueOnce({ data: undefined });

    const { result } = renderHook(() => useVotingPower(), { wrapper: createWrapper() });

    expect(result.current.votingPower).toBe(0n);
    expect(result.current.hasPower).toBe(false);
    // Verify useReadContract was called with undefined args
    expect(useReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: undefined }),
    );
  });

  it('returns false for hasPower when balance is 0n', () => {
    (useReadContract as jest.Mock)
      .mockReturnValueOnce({ data: 0n, isLoading: false })
      .mockReturnValueOnce({ data: undefined });

    const { result } = renderHook(() => useVotingPower(), { wrapper: createWrapper() });

    expect(result.current.hasPower).toBe(false);
  });
});

// ===========================================================================
// useProposals
// ===========================================================================

describe('useProposals', () => {
  it('fetches proposals from API', async () => {
    mockApiClient.get.mockResolvedValue({ proposals: [{ id: '1', title: 'Test' }], total: 1 });
    const { result } = renderHook(() => useProposals(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('/v1/governance/proposals'));
  });

  it('applies status and page filters', async () => {
    mockApiClient.get.mockResolvedValue({ proposals: [], total: 0 });
    const { result } = renderHook(() => useProposals('active' as any, 2), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockApiClient.get.mock.calls[0][0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('page=2');
  });
});

// ===========================================================================
// useProposalDetail
// ===========================================================================

describe('useProposalDetail', () => {
  it('returns on-chain votes and API data', async () => {
    (useReadContract as jest.Mock).mockReturnValue({
      data: [100n, 200n, 50n],
      isLoading: false,
    });
    mockApiClient.get.mockResolvedValue({ id: '1', title: 'Test Proposal' });

    const { result } = renderHook(() => useProposalDetail(1n), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.onChainVotes).toEqual({
      againstVotes: 100n,
      forVotes: 200n,
      abstainVotes: 50n,
    });
  });

  it('returns default votes when no on-chain data', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });

    const { result } = renderHook(() => useProposalDetail(undefined), { wrapper: createWrapper() });

    expect(result.current.onChainVotes).toEqual({
      againstVotes: 0n,
      forVotes: 0n,
      abstainVotes: 0n,
    });
  });
});

// ===========================================================================
// useCreateProposal
// ===========================================================================

describe('useCreateProposal', () => {
  it('submits proposal on-chain and stores metadata', async () => {
    mockWriteContractAsync.mockResolvedValue('0xproposaltx');
    mockApiClient.post.mockResolvedValue({});
    const { result } = renderHook(() => useCreateProposal(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        targets: ['0x1'] as any,
        values: [0n],
        calldatas: ['0x00'] as any,
        description: 'Upgrade contract',
        title: 'Upgrade',
        summary: 'Upgrading the contract',
        discussionUrl: 'https://forum.example.com',
      } as any);
    });

    expect(mockWriteContractAsync).toHaveBeenCalled();
    expect(mockApiClient.post).toHaveBeenCalledWith('/v1/governance/proposals/metadata', expect.objectContaining({
      txHash: '0xproposaltx',
      title: 'Upgrade',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Proposal created');
  });

  it('shows error toast on failure', async () => {
    mockWriteContractAsync.mockRejectedValue(new Error('Rejected'));
    const { result } = renderHook(() => useCreateProposal(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          targets: [],
          values: [],
          calldatas: [],
          description: 'x',
        } as any);
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Proposal creation failed', { description: 'Rejected' });
  });
});

// ===========================================================================
// useVote
// ===========================================================================

describe('useVote', () => {
  it('casts vote on-chain and shows success toast', async () => {
    mockWriteContractAsync.mockResolvedValue('0xvotetx');
    const { result } = renderHook(() => useVote(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ proposalId: 1n, support: 1 as any });
    });

    expect(mockWriteContractAsync).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('Vote cast successfully');
  });

  it('casts vote with reason when provided', async () => {
    mockWriteContractAsync.mockResolvedValue('0xvotetx');
    const { result } = renderHook(() => useVote(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ proposalId: 1n, support: 1 as any, reason: 'Good proposal' });
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'castVoteWithReason' }),
    );
  });

  it('shows error toast on failure', async () => {
    mockWriteContractAsync.mockRejectedValue(new Error('Already voted'));
    const { result } = renderHook(() => useVote(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({ proposalId: 1n, support: 0 as any });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Vote failed', { description: 'Already voted' });
  });
});

// ===========================================================================
// useExecuteProposal
// ===========================================================================

describe('useExecuteProposal', () => {
  it('executes proposal on-chain and shows success toast', async () => {
    mockWriteContractAsync.mockResolvedValue('0xexectx');
    const { result } = renderHook(() => useExecuteProposal(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        targets: ['0x1'] as any,
        values: [0n],
        calldatas: ['0x00'] as any,
        descriptionHash: '0xdesc' as any,
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith('Proposal executed');
  });

  it('shows error toast on failure', async () => {
    mockWriteContractAsync.mockRejectedValue(new Error('Not passed'));
    const { result } = renderHook(() => useExecuteProposal(), { wrapper: createWrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          targets: [],
          values: [],
          calldatas: [],
          descriptionHash: '0x' as any,
        });
      } catch {}
    });

    expect(mockToast.error).toHaveBeenCalledWith('Execution failed', { description: 'Not passed' });
  });
});

// ===========================================================================
// useGovernance (convenience wrapper)
// ===========================================================================

describe('useGovernance', () => {
  it('returns proposals and votingPower', async () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 500n, isLoading: false });
    mockApiClient.get.mockResolvedValue({ proposals: [{ id: '1' }], total: 1 });

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.votingPower).toBe(500);
  });

  it('returns empty proposals when data is undefined', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    expect(result.current.proposals).toEqual([]);
  });

  it('vote() calls mutateAsync with correct support mapping for "for"', async () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 500n, isLoading: false });
    mockApiClient.get.mockResolvedValue({ proposals: [], total: 0 });
    mockWriteContractAsync.mockResolvedValue('0xvotetx');

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.vote('1', 'for');
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [1n, 1],
      }),
    );
  });

  it('vote() uses abstain (2) for unknown support values', async () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 500n, isLoading: false });
    mockApiClient.get.mockResolvedValue({ proposals: [], total: 0 });
    mockWriteContractAsync.mockResolvedValue('0xvotetx');

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.vote('2', 'unknown');
    });

    expect(mockWriteContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [2n, 2],
      }),
    );
  });

  it('delegate() is a no-op function', async () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 0n, isLoading: false });
    mockApiClient.get.mockResolvedValue({ proposals: [], total: 0 });

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should not throw
    await act(async () => {
      await result.current.delegate('0xdelegatee');
    });
  });

  it('returns 0 votingPower when balance is undefined', () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
    mockApiClient.get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    expect(result.current.votingPower).toBe(0);
  });

  it('returns empty proposals when data has no proposals property', async () => {
    (useReadContract as jest.Mock).mockReturnValue({ data: 500n, isLoading: false });
    mockApiClient.get.mockResolvedValue({});

    const { result } = renderHook(() => useGovernance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.proposals).toEqual([]);
  });
});
