/**
 * Tests for useIdentity hooks — on-chain reads, API-backed profile,
 * identity creation/update mutations, delegate control, and the
 * convenience useIdentity wrapper.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import {
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
} from '@/config/constants';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
const mockTxHash = '0xtxhash000000000000000000000000000000000000000000000000000000001';

const mockUseAccount = jest.fn();
const mockUseReadContract = jest.fn();
const mockWriteContractAsync = jest.fn();
const mockUseWriteContract = jest.fn();

jest.mock('wagmi', () => ({
  useAccount: () => mockUseAccount(),
  useReadContract: (args: unknown) => mockUseReadContract(args),
  useWriteContract: () => mockUseWriteContract(),
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock('@/config/constants', () => ({
  IDENTITY_REGISTRY_ADDRESS: '0xRegistryAddress',
  IDENTITY_REGISTRY_ABI: [{ type: 'function', name: 'identityOf' }],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockUseAccount.mockReturnValue({ address: mockAddress });
  mockUseWriteContract.mockReturnValue({
    writeContractAsync: mockWriteContractAsync,
  });
  mockUseReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockWriteContractAsync.mockResolvedValue(mockTxHash);
});

// ---------------------------------------------------------------------------
// Tests — must import after mocks are set up
// ---------------------------------------------------------------------------

describe('useIdentity hooks', () => {
  // =========================================================================
  // useOnChainIdentity
  // =========================================================================

  describe('useOnChainIdentity', () => {
    it('reads identityOf and getDelegates from the registry', async () => {
      const didHashValue = '0xdid_hash_001';
      const delegatesList = [
        { delegate: '0xdelegate1', expiry: BigInt(1800000000) },
      ];

      // First call is for identityOf, second for getDelegates
      mockUseReadContract
        .mockReturnValueOnce({
          data: didHashValue,
          isLoading: false,
        })
        .mockReturnValueOnce({
          data: delegatesList,
          isLoading: false,
        });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.didHash).toBe(didHashValue);
      expect(result.current.delegates).toEqual(delegatesList);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasIdentity).toBe(true);
    });

    it('returns hasIdentity false when didHash is empty', async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it('returns hasIdentity false when didHash is 0x', async () => {
      mockUseReadContract
        .mockReturnValueOnce({ data: '0x', isLoading: false })
        .mockReturnValueOnce({ data: [], isLoading: false });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.hasIdentity).toBe(false);
    });

    it('reflects loading state', async () => {
      mockUseReadContract.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('disables contract reads when address is undefined', async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      // useReadContract should have been called with enabled: false via args being undefined
      const calls = mockUseReadContract.mock.calls;
      for (const call of calls) {
        expect(call[0].args).toBeUndefined();
      }
    });

    it('returns empty delegates array when data is null', async () => {
      mockUseReadContract
        .mockReturnValueOnce({ data: '0xdid', isLoading: false })
        .mockReturnValueOnce({ data: null, isLoading: false });

      const { useOnChainIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useOnChainIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.delegates).toEqual([]);
    });
  });

  // =========================================================================
  // useIdentityProfile
  // =========================================================================

  describe('useIdentityProfile', () => {
    it('fetches profile from API when address is available', async () => {
      const profile = { did: 'did:aethelred:testnet:0xabc', displayName: 'Alice' };
      (apiClient.get as jest.Mock).mockResolvedValue(profile);

      const { useIdentityProfile } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(profile);
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        `/v1/identity/${mockAddress}/profile`,
      );
    });

    it('does not fetch when address is undefined', async () => {
      mockUseAccount.mockReturnValue({ address: undefined });

      const { useIdentityProfile } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useIdentityProfile(), {
        wrapper: createQueryWrapper(),
      });

      // Query should not fire
      expect(result.current.isFetching).toBe(false);
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // useCreateIdentity
  // =========================================================================

  describe('useCreateIdentity', () => {
    it('registers identity on-chain and via API, then shows toast', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

      const { useCreateIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          didDocumentHash: '0xdochash',
          recoveryAddress: '0xrecovery',
          didDocument: { id: 'did:aethelred:testnet:0xabc' },
          publicKeys: ['0xpub1'],
        } as any);
      });

      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'registerIdentity',
          args: ['0xdochash', '0xrecovery'],
        }),
      );

      expect(apiClient.post).toHaveBeenCalledWith(
        '/v1/identity/register',
        expect.objectContaining({
          ownerAddress: mockAddress,
          txHash: mockTxHash,
        }),
      );

      expect(toast.success).toHaveBeenCalledWith(
        'Identity created successfully',
      );
    });

    it('shows error toast on failure', async () => {
      mockWriteContractAsync.mockRejectedValue(
        new Error('User rejected transaction'),
      );

      const { useCreateIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useCreateIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            didDocumentHash: '0xdochash',
            recoveryAddress: '0xrecovery',
            didDocument: {},
            publicKeys: [],
          } as any);
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to create identity', {
        description: 'User rejected transaction',
      });
    });
  });

  // =========================================================================
  // useUpdateProfile
  // =========================================================================

  describe('useUpdateProfile', () => {
    it('updates profile via API PUT and shows success toast', async () => {
      (apiClient.put as jest.Mock).mockResolvedValue({ success: true });

      const { useUpdateProfile } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          displayName: 'Bob',
          avatarUri: 'https://example.com/avatar.png',
        } as any);
      });

      expect(apiClient.put).toHaveBeenCalledWith(
        `/v1/identity/${mockAddress}/profile`,
        expect.objectContaining({ displayName: 'Bob' }),
      );

      expect(toast.success).toHaveBeenCalledWith('Profile updated');
    });

    it('shows error toast on update failure', async () => {
      (apiClient.put as jest.Mock).mockRejectedValue(
        new Error('Unauthorized'),
      );

      const { useUpdateProfile } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useUpdateProfile(), {
        wrapper: createQueryWrapper(),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({ displayName: 'Bob' } as any);
        } catch {
          // Expected
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Profile update failed', {
        description: 'Unauthorized',
      });
    });
  });

  // =========================================================================
  // useDelegateControl
  // =========================================================================

  describe('useDelegateControl', () => {
    it('adds a delegate on-chain', async () => {
      const { useDelegateControl } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });

      let hash: string | undefined;
      await act(async () => {
        hash = await result.current.delegateControl(
          '0xdelegate1' as `0x${string}`,
          BigInt(86400),
        );
      });

      expect(hash).toBe(mockTxHash);
      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'addDelegate',
          args: ['0xdelegate1', BigInt(86400)],
        }),
      );
      expect(toast.success).toHaveBeenCalledWith('Delegate added');
    });

    it('revokes a delegate on-chain', async () => {
      const { useDelegateControl } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useDelegateControl(), {
        wrapper: createQueryWrapper(),
      });

      let hash: string | undefined;
      await act(async () => {
        hash = await result.current.revokeDelegate(
          '0xdelegate1' as `0x${string}`,
        );
      });

      expect(hash).toBe(mockTxHash);
      expect(mockWriteContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'revokeDelegate',
          args: ['0xdelegate1'],
        }),
      );
      expect(toast.success).toHaveBeenCalledWith('Delegate revoked');
    });
  });

  // =========================================================================
  // useIdentity (convenience wrapper)
  // =========================================================================

  describe('useIdentity (wrapper)', () => {
    it('combines on-chain and profile data', async () => {
      const didHashValue = '0xdid_hash_combined';
      const delegates = [
        { delegate: '0xd1', expiry: BigInt(1800000000) },
      ];
      const profile = { did: 'did:aethelred:testnet:0xabc', displayName: 'Combined' };

      mockUseReadContract
        .mockReturnValueOnce({ data: didHashValue, isLoading: false }) // identityOf
        .mockReturnValueOnce({ data: delegates, isLoading: false }) // getDelegates
        .mockReturnValueOnce({ data: didHashValue, isLoading: false }) // identityOf (useCreateIdentity)
        .mockReturnValueOnce({ data: delegates, isLoading: false }); // getDelegates (useCreateIdentity)

      (apiClient.get as jest.Mock).mockResolvedValue(profile);

      const { useIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      await waitFor(() => {
        expect(result.current.identity.profile).toEqual(profile);
      });

      expect(result.current.identity.didHash).toBe(didHashValue);
      expect(result.current.identity.hasIdentity).toBe(true);
      expect(result.current.identity.isRegistered).toBe(true);
      expect(result.current.delegates).toEqual(delegates);
      expect(typeof result.current.createIdentity).toBe('function');
      expect(typeof result.current.revokeDelegate).toBe('function');
    });

    it('returns isLoading true when either on-chain or profile is loading', async () => {
      mockUseReadContract.mockReturnValue({ data: undefined, isLoading: true });
      (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves

      const { useIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('returns profile as null when not loaded', async () => {
      mockUseReadContract.mockReturnValue({ data: undefined, isLoading: false });

      const { useIdentity } = await import('@/hooks/useIdentity');
      const { result } = renderHook(() => useIdentity(), {
        wrapper: createQueryWrapper(),
      });

      expect(result.current.identity.profile).toBeNull();
    });
  });
});
