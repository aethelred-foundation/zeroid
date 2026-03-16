/**
 * useSelectiveDisclosure — Hook for privacy-preserving attribute disclosure.
 *
 * Manages creating disclosure requests (verifier side), building disclosure
 * responses with ZK proofs (holder side), and viewing disclosure history.
 */

import { useAccount } from 'wagmi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type {
  DisclosureRequest,
  DisclosureResponse,
  DisclosureHistoryEntry,
  DisclosureAttribute,
  DisclosurePolicy,
} from '@/types';

// ---------------------------------------------------------------------------
// Create a disclosure request (verifier creates this)
// ---------------------------------------------------------------------------

export function useCreateDisclosureRequest() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      subjectDid: string;
      requestedAttributes: DisclosureAttribute[];
      policy: DisclosurePolicy;
      purpose: string;
      expiresIn?: number;
    }) => {
      const response = await apiClient.post<{ requestId: string; challenge: string }>(
        '/v1/disclosure/request',
        {
          verifierAddress: address,
          subjectDid: params.subjectDid,
          requestedAttributes: params.requestedAttributes,
          policy: params.policy,
          purpose: params.purpose,
          expiresIn: params.expiresIn ?? 3600,
        },
      );
      return response;
    },
    onSuccess: (data) => {
      toast.success('Disclosure request created', {
        description: `Challenge issued: ${data.challenge.slice(0, 16)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ['disclosureHistory'] });
    },
    onError: (err: Error) => {
      toast.error('Failed to create disclosure request', {
        description: err.message,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Build a disclosure response (holder selects attributes + generates proof)
// ---------------------------------------------------------------------------

export function useBuildDisclosureResponse() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (params: {
      requestId: string;
      selectedAttributes: DisclosureAttribute[];
      credentialIds: string[];
      zkProof: string;
    }) => {
      const response = await apiClient.post<DisclosureResponse>(
        `/v1/disclosure/${params.requestId}/respond`,
        {
          holderAddress: address,
          selectedAttributes: params.selectedAttributes,
          credentialIds: params.credentialIds,
          zkProof: params.zkProof,
          timestamp: Date.now(),
        },
      );
      return response;
    },
    onSuccess: () => {
      toast.success('Disclosure response submitted', {
        description: 'Selected attributes shared with verifier',
      });
      queryClient.invalidateQueries({ queryKey: ['disclosureHistory'] });
      queryClient.invalidateQueries({ queryKey: ['pendingDisclosures'] });
    },
    onError: (err: Error) => {
      toast.error('Disclosure response failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Pending disclosure requests for the connected user
// ---------------------------------------------------------------------------

export function usePendingDisclosures() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ['pendingDisclosures', address],
    queryFn: () =>
      apiClient.get<DisclosureRequest[]>(`/v1/disclosure/pending/${address}`),
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Disclosure request detail
// ---------------------------------------------------------------------------

export function useDisclosureRequest(requestId: string | undefined) {
  return useQuery({
    queryKey: ['disclosureRequest', requestId],
    queryFn: () =>
      apiClient.get<DisclosureRequest>(`/v1/disclosure/${requestId}`),
    enabled: !!requestId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Disclosure history
// ---------------------------------------------------------------------------

export function useDisclosureHistory(page = 1, pageSize = 20) {
  const { address } = useAccount();
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  return useQuery({
    queryKey: ['disclosureHistory', address, page],
    queryFn: () =>
      apiClient.get<{ items: DisclosureHistoryEntry[]; total: number }>(
        `/v1/disclosure/history/${address}?${params.toString()}`,
      ),
    enabled: !!address,
    staleTime: 30_000,
  });
}
