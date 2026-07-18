/**
 * Authenticated ZeroID schema governance.
 *
 * Governance in the current backend is a database-backed schema approval
 * workflow. It is intentionally not combined with the separate Aethelred
 * token-governor contracts: backend schema UUIDs are not on-chain proposal IDs.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import type {
  CreateSchemaProposalInput,
  SchemaGovernanceStatus,
} from "@/lib/schemas/registry";

export type GovernanceAccessState =
  | "wallet-required"
  | "sign-in-required"
  | "ready";

export interface UseGovernanceOptions {
  page?: number;
  pageSize?: number;
  status?: SchemaGovernanceStatus;
  name?: string;
  selectedSchemaId?: string | null;
  enabled?: boolean;
}

const schemaListQueryKey = ["governance", "schemas"] as const;
const schemaDetailQueryKey = (address: string, schemaId: string) =>
  ["governance", "schema", address, schemaId] as const;

function accessError(accessState: GovernanceAccessState): Error {
  return new Error(
    accessState === "wallet-required"
      ? "Connect a wallet before using schema governance."
      : "Sign in with the registered ZeroID wallet before using schema governance.",
  );
}

export function useGovernance(options: UseGovernanceOptions = {}) {
  const {
    page = 1,
    pageSize = 10,
    status,
    name,
    selectedSchemaId = null,
    enabled = true,
  } = options;
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const identityToken = getIdentityAuthToken();
  const addressKey = address?.toLowerCase() ?? "no-wallet";
  const accessState: GovernanceAccessState = !address
    ? "wallet-required"
    : !identityToken
      ? "sign-in-required"
      : "ready";
  const workflowReady = accessState === "ready" && enabled;

  const schemasQuery = useQuery({
    queryKey: [
      ...schemaListQueryKey,
      addressKey,
      page,
      pageSize,
      status ?? "ALL",
      name?.trim() ?? "",
    ],
    queryFn: () =>
      apiClient.listSchemas(page, pageSize, {
        status,
        name: name?.trim() || undefined,
      }),
    enabled: workflowReady,
    staleTime: 15_000,
    retry: false,
  });

  const detailQuery = useQuery({
    queryKey: schemaDetailQueryKey(addressKey, selectedSchemaId ?? "none"),
    queryFn: () => apiClient.getSchema(selectedSchemaId!),
    enabled: workflowReady && Boolean(selectedSchemaId),
    staleTime: 10_000,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CreateSchemaProposalInput) => {
      if (!workflowReady) throw accessError(accessState);
      return apiClient.createSchemaProposal(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: schemaListQueryKey });
    },
  });

  const voteMutation = useMutation({
    mutationFn: async (input: { schemaId: string; approve: boolean }) => {
      if (!workflowReady) throw accessError(accessState);
      return apiClient.voteOnSchema(input.schemaId, input.approve);
    },
    onSuccess: async (schema) => {
      queryClient.setQueryData(
        schemaDetailQueryKey(addressKey, schema.id),
        schema,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: schemaListQueryKey }),
        queryClient.invalidateQueries({
          queryKey: schemaDetailQueryKey(addressKey, schema.id),
        }),
      ]);
    },
  });

  const canExposeProtectedData = workflowReady;

  return {
    schemas: canExposeProtectedData ? (schemasQuery.data?.items ?? []) : [],
    total: canExposeProtectedData ? (schemasQuery.data?.total ?? 0) : 0,
    page: schemasQuery.data?.page ?? page,
    pageSize: schemasQuery.data?.pageSize ?? pageSize,
    hasMore: canExposeProtectedData
      ? (schemasQuery.data?.hasMore ?? false)
      : false,
    selectedSchema: canExposeProtectedData ? detailQuery.data : undefined,
    accessState,
    isLoading: workflowReady && schemasQuery.isPending,
    isFetching: schemasQuery.isFetching,
    error: schemasQuery.error,
    refetch: schemasQuery.refetch,
    isDetailLoading:
      workflowReady && Boolean(selectedSchemaId) && detailQuery.isPending,
    detailError: detailQuery.error,
    refetchDetail: detailQuery.refetch,
    createSchema: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
    resetCreate: createMutation.reset,
    voteOnSchema: (schemaId: string, approve: boolean) =>
      voteMutation.mutateAsync({ schemaId, approve }),
    isVoting: voteMutation.isPending,
    voteError: voteMutation.error,
    resetVote: voteMutation.reset,
  };
}
