/**
 * Cross-chain capability tests.
 *
 * The feature is intentionally read-only until every required service is
 * configured. These tests guard against reintroducing local fee calculations,
 * simulated verification, or mutation hooks that only throw at runtime.
 */

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/config/constants", () => ({
  CONTRACT_ADDRESSES: {
    crossChainBridge: "0x1111111111111111111111111111111111111111",
  },
}));

import * as crossChainHooks from "@/hooks/useCrossChain";

const originalRelayerUrl = process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL;
const originalVerificationUrl =
  process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function restoreEnvironment() {
  if (originalRelayerUrl === undefined) {
    delete process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL;
  } else {
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL = originalRelayerUrl;
  }

  if (originalVerificationUrl === undefined) {
    delete process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL;
  } else {
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL =
      originalVerificationUrl;
  }
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL;
  delete process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL;
});

afterEach(restoreEnvironment);

describe("useCrossChainCapabilities", () => {
  it("fails closed when relayer and destination verification are absent", () => {
    const { result } = renderHook(() =>
      crossChainHooks.useCrossChainCapabilities(),
    );

    expect(result.current).toEqual({
      bridgeContractConfigured: true,
      relayerConfigured: false,
      destinationVerificationConfigured: false,
      infrastructureReady: false,
      missingCapabilities: [
        "Relayer service",
        "Destination-chain verification",
      ],
    });
  });

  it("rejects unsafe or malformed public service URLs", () => {
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL = "http://relayer.example.com";
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL = "not-a-url";

    const { result } = renderHook(() =>
      crossChainHooks.useCrossChainCapabilities(),
    );

    expect(result.current.relayerConfigured).toBe(false);
    expect(result.current.destinationVerificationConfigured).toBe(false);
    expect(result.current.infrastructureReady).toBe(false);
  });

  it("reports infrastructure readiness only when both services are configured", () => {
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL =
      "https://relayer.zeroid.example/api";
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL =
      "https://verifier.zeroid.example/api";

    const { result } = renderHook(() =>
      crossChainHooks.useCrossChainCapabilities(),
    );

    expect(result.current).toMatchObject({
      bridgeContractConfigured: true,
      relayerConfigured: true,
      destinationVerificationConfigured: true,
      infrastructureReady: true,
      missingCapabilities: [],
    });
  });
});

describe("useSupportedChains", () => {
  it("lists destination metadata as unavailable when capability checks fail", async () => {
    const { result } = renderHook(() => crossChainHooks.useSupportedChains(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((chain) => chain.chainId)).toEqual([
      1, 137, 42161, 11155111,
    ]);
    expect(result.current.data?.every((chain) => !chain.isActive)).toBe(true);
    expect(result.current.data?.[0]).not.toHaveProperty("fee");
    expect(result.current.data?.[0]).not.toHaveProperty("bridgeFeeBaseBps");
  });

  it("marks destinations configured only after the complete capability gate", async () => {
    process.env.NEXT_PUBLIC_BRIDGE_RELAYER_URL =
      "https://relayer.zeroid.example/api";
    process.env.NEXT_PUBLIC_BRIDGE_DESTINATION_VERIFICATION_URL =
      "https://verifier.zeroid.example/api";

    const { result } = renderHook(() => crossChainHooks.useSupportedChains(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.every((chain) => chain.isActive)).toBe(true);
  });
});

it("does not export simulated bridge, fee, status, or verification hooks", () => {
  expect(crossChainHooks).not.toHaveProperty("useBridgeCredential");
  expect(crossChainHooks).not.toHaveProperty("useBridgeFeeEstimate");
  expect(crossChainHooks).not.toHaveProperty("useBridgeStatus");
  expect(crossChainHooks).not.toHaveProperty("useVerifyBridgedCredential");
  expect(crossChainHooks).not.toHaveProperty("useBridgedCredentials");
});
