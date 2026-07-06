/**
 * useUAEPass — Unit Tests
 */

import { act, renderHook } from "@testing-library/react";

import { apiClient } from "@/lib/api/client";
import { getIdentityAuthToken } from "@/lib/identity/registration";
import { useUAEPass } from "@/hooks/useUAEPass";

jest.mock("@/lib/api/client", () => ({
  apiClient: {
    startUAEPassVerification: jest.fn(),
    completeUAEPassVerification: jest.fn(),
  },
}));

jest.mock("@/lib/identity/registration", () => ({
  getIdentityAuthToken: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedGetIdentityAuthToken = getIdentityAuthToken as jest.Mock;

describe("useUAEPass", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetIdentityAuthToken.mockReturnValue("identity-token");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "https://app.zeroid.test",
        assign: jest.fn(),
      },
    });
  });

  it("starts with idle status and no verification", () => {
    const { result } = renderHook(() => useUAEPass());

    expect(result.current.verificationStatus).toBe("idle");
    expect(result.current.isVerified).toBe(false);
    expect(result.current.authorization).toBeNull();
    expect(result.current.verification).toBeNull();
  });

  it("fails closed when no authenticated identity token is available", async () => {
    mockedGetIdentityAuthToken.mockReturnValue(undefined);
    const { result } = renderHook(() => useUAEPass());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.initiateVerification({ openRedirect: false });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      "authenticated ZeroID identity session",
    );
    expect(result.current.verificationStatus).toBe("failed");
    expect(result.current.isVerified).toBe(false);
    expect(mockedApiClient.startUAEPassVerification).not.toHaveBeenCalled();
  });

  it("starts backend UAE Pass OAuth without marking verification complete", async () => {
    mockedApiClient.startUAEPassVerification.mockResolvedValue({
      authUrl: "https://uaepass.example/authorize?state=state-1",
      state: "state-1",
      expiresInSeconds: 600,
    });
    const { result } = renderHook(() => useUAEPass());

    await act(async () => {
      await result.current.initiateVerification({ openRedirect: false });
    });

    expect(mockedApiClient.startUAEPassVerification).toHaveBeenCalledWith(
      "https://app.zeroid.test/identity/uae-pass/callback",
      "identity-token",
    );
    expect(result.current.authorization).toMatchObject({ state: "state-1" });
    expect(result.current.verificationStatus).toBe("pending");
    expect(result.current.isVerified).toBe(false);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("redirects to UAE Pass by default after backend start", async () => {
    mockedApiClient.startUAEPassVerification.mockResolvedValue({
      authUrl: "https://uaepass.example/authorize?state=state-2",
      state: "state-2",
      expiresInSeconds: 600,
    });
    const { result } = renderHook(() => useUAEPass());

    await act(async () => {
      await result.current.initiateVerification();
    });

    expect(window.location.assign).toHaveBeenCalledWith(
      "https://uaepass.example/authorize?state=state-2",
    );
    expect(result.current.verificationStatus).toBe("pending");
  });

  it("rejects unsafe backend authorization URLs before browser navigation", async () => {
    mockedApiClient.startUAEPassVerification.mockResolvedValue({
      authUrl: "javascript:alert(1)",
      state: "state-unsafe",
      expiresInSeconds: 600,
    });
    const { result } = renderHook(() => useUAEPass());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.initiateVerification();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "UAE Pass authorization URL was rejected.",
    );
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(result.current.authorization).toBeNull();
    expect(result.current.verificationStatus).toBe("failed");
  });

  it("marks verified only after backend callback completion succeeds", async () => {
    mockedApiClient.completeUAEPassVerification.mockResolvedValue({
      verified: true,
      provider: "UAE_PASS",
      referenceId: "uaepass-ref-1",
      verifiedFields: ["fullName", "nationality"],
      verifiedAt: "2026-06-25T10:00:00.000Z",
      expiresAt: "2027-06-25T10:00:00.000Z",
    });
    const { result } = renderHook(() => useUAEPass());

    await act(async () => {
      await result.current.completeVerification({
        code: "oauth-code-123",
        state: "state-3",
      });
    });

    expect(mockedApiClient.completeUAEPassVerification).toHaveBeenCalledWith(
      { authorizationCode: undefined, code: "oauth-code-123", state: "state-3" },
      "identity-token",
    );
    expect(result.current.verificationStatus).toBe("verified");
    expect(result.current.isVerified).toBe(true);
    expect(result.current.verification).toMatchObject({
      provider: "UAE_PASS",
      referenceId: "uaepass-ref-1",
    });
  });

  it("keeps initiateVerification stable across renders", () => {
    const { result, rerender } = renderHook(() => useUAEPass());
    const firstRef = result.current.initiateVerification;
    rerender();
    expect(result.current.initiateVerification).toBe(firstRef);
  });
});
