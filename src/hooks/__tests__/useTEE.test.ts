/**
 * useTEE — Unit Tests
 *
 * Tests for the TEE node status and enclave verification hook.
 */

import { renderHook, act } from "@testing-library/react";
import { useTEE } from "@/hooks/useTEE";

jest.mock("@/types", () => ({}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ===========================================================================
// useTEE
// ===========================================================================

describe("useTEE", () => {
  it("returns initial nodes list with 5 nodes", () => {
    const { result } = renderHook(() => useTEE());

    expect(result.current.nodes).toHaveLength(5);
    expect(result.current.nodes[0]).toEqual(
      expect.objectContaining({ id: "sgx-1", type: "SGX", status: "active" }),
    );
  });

  it("returns initial attestation info", () => {
    const { result } = renderHook(() => useTEE());

    expect(result.current.attestation).not.toBeNull();
    expect(result.current.attestation?.valid).toBe(true);
  });

  it("reports healthy enclave status when all nodes are active", () => {
    const { result } = renderHook(() => useTEE());

    expect(result.current.enclaveStatus).toBe("healthy");
  });

  it("starts with isLoading=false and error=null", () => {
    const { result } = renderHook(() => useTEE());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refreshStatus sets isLoading then resets it", async () => {
    const { result } = renderHook(() => useTEE());

    act(() => {
      result.current.refreshStatus();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("verifyInEnclave returns verified=true after delay", async () => {
    const { result } = renderHook(() => useTEE());

    let verifyResult: { verified: boolean; attestation: string } | undefined;

    const promise = act(async () => {
      const p = result.current.verifyInEnclave({ data: "test" });
      jest.advanceTimersByTime(2000);
      verifyResult = await p;
    });

    await promise;

    expect(verifyResult?.verified).toBe(true);
    expect(verifyResult?.attestation).toMatch(/^0x/);
  });

  it("refreshStatus is stable across renders (useCallback)", () => {
    const { result, rerender } = renderHook(() => useTEE());
    const first = result.current.refreshStatus;
    rerender();
    expect(result.current.refreshStatus).toBe(first);
  });

  it("verifyInEnclave is stable across renders (useCallback)", () => {
    const { result, rerender } = renderHook(() => useTEE());
    const first = result.current.verifyInEnclave;
    rerender();
    expect(result.current.verifyInEnclave).toBe(first);
  });

  it("reports degraded enclave status when a node is not active", () => {
    const React = require("react");
    const originalUseState = React.useState;

    // Override useState to inject a degraded node for the first call (the TEEState)
    let callCount = 0;
    jest.spyOn(React, "useState").mockImplementation((init: any) => {
      callCount++;
      if (callCount === 1 && init && init.nodes) {
        // Modify one node to have 'degraded' status
        const modifiedInit = {
          ...init,
          nodes: init.nodes.map((n: any, i: number) =>
            i === 0 ? { ...n, status: "degraded" } : n,
          ),
        };
        return originalUseState(modifiedInit);
      }
      return originalUseState(init);
    });

    const { result } = renderHook(() => useTEE());

    expect(result.current.enclaveStatus).toBe("degraded");
    expect(result.current.nodes[0].status).toBe("degraded");

    jest.restoreAllMocks();
  });
});
