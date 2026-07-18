import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGovernance } from "@/hooks/useGovernance";

const mockUseAccount = jest.fn();
const mockGetIdentityAuthToken = jest.fn();
const mockListSchemas = jest.fn();
const mockGetSchema = jest.fn();
const mockCreateSchemaProposal = jest.fn();
const mockVoteOnSchema = jest.fn();

jest.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: () => mockGetIdentityAuthToken(),
}));

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    listSchemas: (...args: unknown[]) => mockListSchemas(...args),
    getSchema: (...args: unknown[]) => mockGetSchema(...args),
    createSchemaProposal: (...args: unknown[]) =>
      mockCreateSchemaProposal(...args),
    voteOnSchema: (...args: unknown[]) => mockVoteOnSchema(...args),
  },
}));

const schema = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.0.0",
  description: "A proposed organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: { legalName: { type: "string" } },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "PROPOSED" as const,
  approvalVotes: 0,
  rejectionVotes: 0,
  voters: [],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

const schemaPage = {
  items: [schema],
  total: 1,
  page: 1,
  pageSize: 10,
  hasMore: false,
};

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAccount.mockReturnValue({
    address: "0x1234567890abcdef1234567890abcdef12345678",
  });
  mockGetIdentityAuthToken.mockReturnValue("identity-session");
  mockListSchemas.mockResolvedValue(schemaPage);
  mockGetSchema.mockResolvedValue(schema);
  mockCreateSchemaProposal.mockResolvedValue(schema);
  mockVoteOnSchema.mockResolvedValue({
    ...schema,
    approvalVotes: 1,
    voters: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  });
});

describe("useGovernance", () => {
  it("does not query without a connected wallet", () => {
    mockUseAccount.mockReturnValue({ address: undefined });
    const { result } = renderHook(() => useGovernance(), {
      wrapper: createHarness().wrapper,
    });

    expect(result.current.accessState).toBe("wallet-required");
    expect(result.current.schemas).toEqual([]);
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("does not query without an identity session", () => {
    mockGetIdentityAuthToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useGovernance(), {
      wrapper: createHarness().wrapper,
    });

    expect(result.current.accessState).toBe("sign-in-required");
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("waits for the IdentityContext readiness gate", () => {
    const { result } = renderHook(() => useGovernance({ enabled: false }), {
      wrapper: createHarness().wrapper,
    });

    expect(result.current.accessState).toBe("ready");
    expect(result.current.schemas).toEqual([]);
    expect(mockListSchemas).not.toHaveBeenCalled();
  });

  it("loads schema records with the real backend filters", async () => {
    const { result } = renderHook(
      () =>
        useGovernance({
          page: 2,
          pageSize: 25,
          status: "PROPOSED",
          name: "  Organization  ",
        }),
      { wrapper: createHarness().wrapper },
    );

    await waitFor(() => expect(result.current.schemas).toEqual([schema]));
    expect(mockListSchemas).toHaveBeenCalledWith(2, 25, {
      status: "PROPOSED",
      name: "Organization",
    });
    expect(result.current.total).toBe(1);
  });

  it("loads selected schema detail by backend UUID", async () => {
    const { result } = renderHook(
      () => useGovernance({ selectedSchemaId: schema.id }),
      { wrapper: createHarness().wrapper },
    );

    await waitFor(() => expect(result.current.selectedSchema).toEqual(schema));
    expect(mockGetSchema).toHaveBeenCalledWith(schema.id);
  });

  it("creates the exact schema proposal and invalidates the list", async () => {
    const { result } = renderHook(() => useGovernance(), {
      wrapper: createHarness().wrapper,
    });
    await waitFor(() => expect(result.current.schemas).toEqual([schema]));

    const input = {
      name: schema.name,
      version: schema.version,
      description: schema.description,
      schemaDefinition: schema.schemaDefinition,
    };
    await act(async () => {
      await result.current.createSchema(input);
    });

    expect(mockCreateSchemaProposal).toHaveBeenCalledWith(input);
    await waitFor(() => expect(mockListSchemas).toHaveBeenCalledTimes(2));
  });

  it("records an approve/reject vote and refreshes list and detail", async () => {
    const { result } = renderHook(
      () => useGovernance({ selectedSchemaId: schema.id }),
      { wrapper: createHarness().wrapper },
    );
    await waitFor(() => expect(result.current.selectedSchema).toEqual(schema));

    await act(async () => {
      await result.current.voteOnSchema(schema.id, false);
    });

    expect(mockVoteOnSchema).toHaveBeenCalledWith(schema.id, false);
    await waitFor(() => {
      expect(mockListSchemas).toHaveBeenCalledTimes(2);
      expect(mockGetSchema).toHaveBeenCalledTimes(2);
    });
  });

  it("fails mutations closed when the session is unavailable", async () => {
    mockGetIdentityAuthToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useGovernance(), {
      wrapper: createHarness().wrapper,
    });

    await expect(result.current.voteOnSchema(schema.id, true)).rejects.toThrow(
      /Sign in/,
    );
    expect(mockVoteOnSchema).not.toHaveBeenCalled();
  });

  it("exposes list errors for an explicit UI retry", async () => {
    mockListSchemas.mockRejectedValue(new Error("Governance unavailable"));
    const { result } = renderHook(() => useGovernance(), {
      wrapper: createHarness().wrapper,
    });

    await waitFor(() =>
      expect(result.current.error).toEqual(new Error("Governance unavailable")),
    );
  });
});
