/**
 * ZeroID API Client — Unit Tests
 *
 * Comprehensive tests for the API client module covering:
 * - ZeroIDApiError class construction and properties
 * - All apiClient endpoint methods (GET, POST)
 * - Auth token header inclusion
 * - Query parameter building
 * - JSON parse error handling
 * - Non-OK / non-success response error mapping
 * - Retry behaviour on GET requests
 * - Timeout behaviour
 */

import { ZeroIDApiError, apiClient, buildApiUrl } from "@/lib/api/client";
import {
  clearIdentityAuthToken,
  getIdentityAuthToken,
  storeIdentityAuthToken,
} from "@/lib/identity/registration";
import { IDENTITY_SESSION_EXPIRED_EVENT } from "@/lib/identity/session";
import { CredentialResponseContractError } from "@/lib/credentials/summary";
import { SchemaRegistryResponseContractError } from "@/lib/schemas/registry";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock withRetry so tests are fast (no real exponential backoff)
const mockWithRetry = jest.fn(async (fn: () => Promise<unknown>) => fn());
const mockWithTimeout = jest.fn(
  async <T>(promise: Promise<T>, _ms: number, _msg?: string): Promise<T> =>
    promise,
);

jest.mock("@/lib/utils", () => ({
  withRetry: (...args: unknown[]) =>
    mockWithRetry(...(args as [() => Promise<unknown>, number])),
  withTimeout: (...args: unknown[]) =>
    mockWithTimeout(...(args as [Promise<unknown>, number, string?])),
  generateUUID: () => "12345678-1234-4234-8234-123456789abc",
}));

jest.mock("@/config/constants", () => ({
  API_BASE_URL: "https://api.zeroid.aethelred.network",
  TEE_SERVICE_URL: "https://tee.zeroid.aethelred.network",
  TEE_ENDPOINTS: {
    NODE_STATUS: "/api/v1/tee/nodes/status",
    ATTESTATION_VERIFY: "/api/v1/tee/attestation/verify",
    BIOMETRIC_ENROLL: "/api/v1/tee/biometric/enroll",
    BIOMETRIC_VERIFY: "/api/v1/tee/biometric/verify",
  },
  TEE_FRESHNESS_REQUIREMENTS: {
    IntelSGX: 86_400,
    AMDSEV: 86_400,
    ArmTrustZone: 43_200,
  },
}));

// Global fetch mock
const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

const REQUEST_ID_PATTERN =
  /^zid-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const backendCredential = {
  id: "12345678-1234-4234-8234-123456789abc",
  credentialType: "KYC_LEVEL_2",
  issuerId: "issuer-identity-id",
  subjectId: "subject-identity-id",
  claimsHash: "a".repeat(64),
  proof: { type: "issuer-signature" },
  status: "ACTIVE",
  issuedAt: "2026-06-25T10:00:00.000Z",
  expiresAt: "2027-06-25T10:00:00.000Z",
};
const backendSchemaRecord = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.2.0",
  description: "An approved organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: { legalName: { type: "string" } },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "APPROVED",
  approvalVotes: 4,
  rejectionVotes: 1,
  voters: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse<T>(data: T, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: jest.fn().mockResolvedValue({
      success: ok,
      data,
      requestId: "zid-server-abc",
    }),
  };
}

function schemaListResponse(
  data = [backendSchemaRecord],
  pagination = { page: 1, limit: 20, total: data.length, totalPages: 1 },
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: jest.fn().mockResolvedValue({
      success: true,
      data,
      pagination,
      requestId: "zid-server-abc",
    }),
  };
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  statusText = "Error",
  details?: Record<string, unknown>,
) {
  return {
    ok: false,
    status,
    statusText,
    json: jest.fn().mockResolvedValue({
      success: false,
      error: { code, message, details },
      requestId: "zid-server-err",
    }),
  };
}

function parseFailResponse(status = 200) {
  return {
    ok: true,
    status,
    statusText: "OK",
    json: jest.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
  };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  clearIdentityAuthToken();
  window.sessionStorage.clear();
  // Default: withRetry just calls fn once
  mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  // Default: withTimeout just awaits the promise
  mockWithTimeout.mockImplementation(async <T>(promise: Promise<T>) => promise);
});

// ===========================================================================
// ZeroIDApiError
// ===========================================================================

describe("ZeroIDApiError", () => {
  it("sets name to ZeroIDApiError", () => {
    const err = new ZeroIDApiError("msg", "CODE", 500);
    expect(err.name).toBe("ZeroIDApiError");
  });

  it("extends Error and is an instance of Error", () => {
    const err = new ZeroIDApiError("msg", "CODE", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ZeroIDApiError);
  });

  it("stores all constructor properties", () => {
    const details = { field: "email" };
    const err = new ZeroIDApiError(
      "bad request",
      "VALIDATION",
      422,
      details,
      "zid-abc-def",
    );
    expect(err.message).toBe("bad request");
    expect(err.code).toBe("VALIDATION");
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual({ field: "email" });
    expect(err.requestId).toBe("zid-abc-def");
  });

  it("has optional details and requestId that default to undefined", () => {
    const err = new ZeroIDApiError("msg", "ERR", 500);
    expect(err.details).toBeUndefined();
    expect(err.requestId).toBeUndefined();
  });
});

// ===========================================================================
// Common request behaviour
// ===========================================================================

describe("request internals (tested via apiClient methods)", () => {
  it("sends Content-Type, Accept, and X-Request-ID headers", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Accept"]).toBe("application/json");
    expect(init.headers["X-Request-ID"]).toMatch(REQUEST_ID_PATTERN);
  });

  it("includes Authorization header when authToken is provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ didHash: "0xabc" }));
    await apiClient.getIdentity("0x1234" as `0x${string}`, "tok_secret");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer tok_secret");
  });

  it("omits Authorization header when authToken is not provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBeUndefined();
  });

  it("uses the stored session token for protected routes by default", async () => {
    storeIdentityAuthToken("stored-token");
    mockFetch.mockResolvedValue(jsonResponse(backendCredential));

    await apiClient.getCredential(backendCredential.id);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer stored-token");
  });

  it("does not send the stored session token to public health checks", async () => {
    storeIdentityAuthToken("stored-token");
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));

    await apiClient.health();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBeUndefined();
  });

  it("clears and broadcasts a rejected protected session on 401", async () => {
    const expired = jest.fn();
    window.addEventListener(IDENTITY_SESSION_EXPIRED_EVENT, expired);
    storeIdentityAuthToken("expired-token");
    mockFetch.mockResolvedValue(
      errorResponse("AUTH_TOKEN_INVALID", "Session expired", 401),
    );

    try {
      await expect(
        apiClient.getCredential(backendCredential.id),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(getIdentityAuthToken()).toBeUndefined();
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(IDENTITY_SESSION_EXPIRED_EVENT, expired);
    }
  });

  it("does not let a stale request clear a newer wallet session", async () => {
    const expired = jest.fn();
    window.addEventListener(IDENTITY_SESSION_EXPIRED_EVENT, expired);
    storeIdentityAuthToken("new-wallet-token");
    mockFetch.mockResolvedValue(
      errorResponse("AUTH_TOKEN_INVALID", "Old session expired", 401),
    );

    try {
      await expect(
        apiClient.getCredential(backendCredential.id, "old-wallet-token"),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(getIdentityAuthToken()).toBe("new-wallet-token");
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(IDENTITY_SESSION_EXPIRED_EVENT, expired);
    }
  });

  it("throws ZeroIDApiError with PARSE_ERROR when response JSON is invalid", async () => {
    mockFetch.mockResolvedValue(parseFailResponse(200));
    await expect(apiClient.health()).rejects.toThrow(ZeroIDApiError);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      expect(e.code).toBe("PARSE_ERROR");
      expect(e.statusCode).toBe(200);
      expect(e.requestId).toMatch(/^zid-/);
    }
  });

  it("throws ZeroIDApiError on non-ok response with error body", async () => {
    mockFetch.mockResolvedValue(
      errorResponse("NOT_FOUND", "Identity not found", 404, "Not Found", {
        didHash: "0x00",
      }),
    );
    await expect(apiClient.health()).rejects.toThrow(ZeroIDApiError);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toBe("Identity not found");
      expect(e.statusCode).toBe(404);
      expect(e.details).toEqual({ didHash: "0x00" });
      expect(e.requestId).toBe("zid-server-err");
    }
  });

  it("uses UNKNOWN code and statusText when error body has no error field", async () => {
    const resp = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: jest.fn().mockResolvedValue({ success: false }),
    };
    mockFetch.mockResolvedValue(resp);
    await expect(apiClient.health()).rejects.toThrow(ZeroIDApiError);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      expect(e.code).toBe("UNKNOWN");
      expect(e.message).toBe("Bad Gateway");
      expect(e.statusCode).toBe(502);
    }
  });

  it("throws ZeroIDApiError when response.ok is true but success is false", async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        success: false,
        error: { code: "LOGIC_ERR", message: "some logic error" },
      }),
    };
    mockFetch.mockResolvedValue(resp);
    await expect(apiClient.health()).rejects.toThrow(ZeroIDApiError);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      expect(e.code).toBe("LOGIC_ERR");
      expect(e.statusCode).toBe(200);
    }
  });

  it("accepts backend data envelopes without a success flag", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        data: { status: "healthy", version: "1.0" },
        requestId: "zid-backend",
      }),
    });

    const result = await apiClient.health();

    expect(result).toEqual({ status: "healthy", version: "1.0" });
  });

  it("does not set body on GET requests", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("serialises body as JSON on POST requests", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ didHash: "0xabc", txHash: "0xdef" }),
    );
    const payload = {
      did: "did:aethelred:mainnet:0x1",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      recoveryHash:
        "1111111111111111111111111111111111111111111111111111111111111111",
    };
    await apiClient.registerIdentity(payload as any, "tok");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(payload);
  });
});

// ===========================================================================
// URL building and query parameters
// ===========================================================================

describe("URL building", () => {
  it("rejects absolute URLs before a request is sent", () => {
    expect(() => buildApiUrl("https://evil.example/api")).toThrow(
      ZeroIDApiError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative and backslash paths", () => {
    expect(() => buildApiUrl("//evil.example/api")).toThrow(ZeroIDApiError);
    expect(() => buildApiUrl("/api\\evil")).toThrow(ZeroIDApiError);
  });

  it("constructs full URL from API_BASE_URL and path", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.zeroid.aethelred.network/api/v1/health");
  });

  it("appends query parameters", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await apiClient.listCredentials(2, 20);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("subject")).toBeNull();
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(parsed.searchParams.get("role")).toBe("subject");
  });

  it("omits empty/null/undefined query parameter values", async () => {
    mockFetch.mockResolvedValue(
      schemaListResponse([backendSchemaRecord], {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      }),
    );
    await apiClient.listSchemas(1, 10);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("10");
    // Only two params should exist
    const keys = Array.from(parsed.searchParams.keys());
    expect(keys).toEqual(["page", "limit"]);
  });

  it("includes path parameters inline", async () => {
    mockFetch.mockResolvedValue(jsonResponse(backendSchemaRecord));
    await apiClient.getSchema(backendSchemaRecord.id);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(
      `/api/v1/governance/schemas/${backendSchemaRecord.id}`,
    );
  });
});

// ===========================================================================
// Retry behaviour
// ===========================================================================

describe("retry behaviour", () => {
  it("calls withRetry with 2 retries for GET-based methods", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    expect(mockWithRetry).toHaveBeenCalledWith(expect.any(Function), 2);
  });

  it("does not retry authenticated reads with the same rejected bearer token", async () => {
    storeIdentityAuthToken("session-token");
    mockFetch.mockResolvedValue(jsonResponse(backendCredential));

    await apiClient.getCredential(backendCredential.id);

    expect(mockWithRetry).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("retries GET requests on failure", async () => {
    let attempt = 0;
    mockWithRetry.mockImplementation(
      async (fn: () => Promise<unknown>, retries: number) => {
        let lastErr: unknown;
        for (let i = 0; i <= retries; i++) {
          try {
            return await fn();
          } catch (err) {
            lastErr = err;
          }
        }
        throw lastErr;
      },
    );

    mockFetch
      .mockResolvedValueOnce(errorResponse("SERVER_ERROR", "fail", 500))
      .mockResolvedValueOnce(errorResponse("SERVER_ERROR", "fail again", 500))
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }));

    const result = await apiClient.health();
    expect(result).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT use withRetry for POST methods (no retry)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ didHash: "0xabc", txHash: "0xdef" }),
    );
    await apiClient.registerIdentity(
      {
        did: "did:aethelred:mainnet:0x1",
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        recoveryHash:
          "1111111111111111111111111111111111111111111111111111111111111111",
      } as any,
      "tok",
    );
    expect(mockWithRetry).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Timeout behaviour
// ===========================================================================

describe("timeout behaviour", () => {
  it("passes the fetch promise through withTimeout with 30s default", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      30_000,
      expect.stringContaining("timed out"),
    );
  });

  it("rejects with timeout error when withTimeout rejects", async () => {
    mockWithTimeout.mockRejectedValueOnce(
      new Error(
        "ZeroID API request timed out after 30000ms (GET /api/v1/health)",
      ),
    );
    await expect(apiClient.health()).rejects.toThrow("timed out");
  });
});

// ===========================================================================
// Individual endpoint methods
// ===========================================================================

describe("apiClient.health()", () => {
  it("calls GET /api/v1/health and returns data", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: "healthy", version: "1.0" }),
    );
    const result = await apiClient.health();
    expect(result).toEqual({ status: "healthy", version: "1.0" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/health");
    expect(init.method).toBe("GET");
  });
});

describe("apiClient.getIdentity()", () => {
  it("calls GET /api/v1/identity/resolve/{did}", async () => {
    const profile = { did: "did:aethelred:testnet:0xabc", status: "active" };
    mockFetch.mockResolvedValue(jsonResponse(profile));
    const result = await apiClient.getIdentity("did:aethelred:testnet:0xabc");
    expect(result).toEqual(profile);
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/identity/resolve/did%3Aaethelred%3Atestnet%3A0xabc",
    );
  });

  it("passes authToken when provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await apiClient.getIdentity("did:aethelred:testnet:0xabc", "my-token");
    expect(mockFetch.mock.calls[0][1].headers["Authorization"]).toBe(
      "Bearer my-token",
    );
  });
});

describe("apiClient.getIdentityByAddress()", () => {
  it("calls GET /api/v1/identity/address/{address}", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null));
    const result = await apiClient.getIdentityByAddress(
      "0xAddr" as `0x${string}`,
    );
    expect(result).toBeNull();
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/identity/address/0xAddr",
    );
  });
});

describe("apiClient.registerIdentity()", () => {
  it("calls POST /api/v1/identity/register with payload", async () => {
    const responseData = { didHash: "0xnew", txHash: "0xtx" };
    mockFetch.mockResolvedValue(jsonResponse(responseData));
    const payload = {
      did: "did:aethelred:mainnet:0x1",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      recoveryHash:
        "1111111111111111111111111111111111111111111111111111111111111111",
    };
    const result = await apiClient.registerIdentity(payload as any, "auth-tok");
    expect(result).toEqual(responseData);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/register");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer auth-tok");
  });
});

describe("apiClient wallet authentication", () => {
  it("creates a wallet challenge without attaching an existing bearer token", async () => {
    storeIdentityAuthToken("old-token");
    mockFetch.mockResolvedValue(
      jsonResponse({
        challengeId: "a".repeat(64),
        message: "server sign-in message",
        expiresAt: "2026-07-18T10:05:00.000Z",
      }),
    );

    const result = await apiClient.createIdentityAuthChallenge(
      "0x1234567890abcdef1234567890abcdef12345678",
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/auth/challenge");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      address: "0x1234567890abcdef1234567890abcdef12345678",
    });
    expect(result.message).toBe("server sign-in message");
  });

  it("exchanges the signed challenge without sending a stale bearer token", async () => {
    storeIdentityAuthToken("old-token");
    mockFetch.mockResolvedValue(
      jsonResponse({
        identity: {
          id: "identity-1",
          did: "did:aethelred:testnet:0x1234",
          status: "ACTIVE",
        },
        token: "new-token",
        sessionId: "session-1",
      }),
    );

    const result = await apiClient.loginWithWallet({
      challengeId: "b".repeat(64),
      signature: `0x${"c".repeat(130)}`,
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/auth/login");
    expect(init.headers["Authorization"]).toBeUndefined();
    expect(result.token).toBe("new-token");
  });

  it("validates the current bearer principal through identity/me", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        id: "identity-1",
        did: "did:aethelred:testnet:0x1234",
        status: "ACTIVE",
      }),
    );

    const result = await apiClient.getCurrentIdentity("session-token");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/me");
    expect(init.headers["Authorization"]).toBe("Bearer session-token");
    expect(result.id).toBe("identity-1");
  });
});

describe("apiClient UAE Pass government verification", () => {
  it("starts UAE Pass verification with the stored identity token by default", async () => {
    storeIdentityAuthToken("stored-token");
    mockFetch.mockResolvedValue(
      jsonResponse({
        authUrl: "https://uaepass.example/authorize",
        state: "state-1",
        expiresInSeconds: 600,
      }),
    );

    const result = await apiClient.startUAEPassVerification(
      "https://app.zeroid.test/identity/uae-pass/callback",
    );

    expect(result.state).toBe("state-1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/government/uae-pass/start");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer stored-token");
    expect(JSON.parse(init.body)).toEqual({
      redirectUri: "https://app.zeroid.test/identity/uae-pass/callback",
    });
  });

  it("completes UAE Pass verification with code and state", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        verified: true,
        provider: "UAE_PASS",
        referenceId: "uaepass-ref-1",
        verifiedFields: ["fullName"],
        verifiedAt: "2026-06-25T10:00:00.000Z",
        expiresAt: "2027-06-25T10:00:00.000Z",
      }),
    );

    const result = await apiClient.completeUAEPassVerification(
      { code: "oauth-code-123", state: "state-1" },
      "explicit-token",
    );

    expect(result.verified).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/government/uae-pass/callback");
    expect(init.headers["Authorization"]).toBe("Bearer explicit-token");
    expect(JSON.parse(init.body)).toEqual({
      code: "oauth-code-123",
      state: "state-1",
    });
  });

  it("fetches authenticated government verification status", async () => {
    storeIdentityAuthToken("stored-token");
    mockFetch.mockResolvedValue(
      jsonResponse({
        verified: true,
        provider: "UAE_PASS",
        referenceId: "uaepass-ref-2",
        verifiedFields: ["fullName"],
        verifiedAt: "2026-06-25T10:00:00.000Z",
        expiresAt: "2027-06-25T10:00:00.000Z",
      }),
    );

    const result = await apiClient.getGovernmentVerificationStatus();

    expect(result?.referenceId).toBe("uaepass-ref-2");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/government/status");
    expect(init.method).toBe("GET");
    expect(init.headers["Authorization"]).toBe("Bearer stored-token");
  });
});

describe("apiClient.listCredentials()", () => {
  it("normalizes backend records and preserves backend pagination", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        data: [backendCredential],
        pagination: { page: 3, limit: 5, total: 11, totalPages: 3 },
      }),
    });

    const result = await apiClient.listCredentials(3, 5);

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("role")).toBe("subject");
    expect(parsed.searchParams.get("subject")).toBeNull();
    expect(result).toEqual({
      items: [
        {
          id: backendCredential.id,
          credentialType: "KYC_LEVEL_2",
          typeLabel: "KYC Level 2",
          category: "kyc",
          issuerId: "issuer-identity-id",
          subjectId: "subject-identity-id",
          claimsHash: "a".repeat(64),
          proofAvailable: true,
          status: "active",
          issuedAt: "2026-06-25T10:00:00.000Z",
          expiresAt: "2027-06-25T10:00:00.000Z",
        },
      ],
      total: 11,
      page: 3,
      pageSize: 5,
      hasMore: false,
    });
  });

  it("uses default page=1, pageSize=12 when not specified", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await apiClient.listCredentials();
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("12");
  });

  it("rejects records that do not satisfy the credential summary contract", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([{ ...backendCredential, claimsHash: "0xnot-a-digest" }]),
    );

    await expect(apiClient.listCredentials()).rejects.toBeInstanceOf(
      CredentialResponseContractError,
    );
  });
});

describe("apiClient.getCredential()", () => {
  it("fetches a backend UUID and normalizes the response", async () => {
    mockFetch.mockResolvedValue(jsonResponse(backendCredential));

    const result = await apiClient.getCredential(backendCredential.id);

    expect(result).toMatchObject({
      id: backendCredential.id,
      typeLabel: "KYC Level 2",
      category: "kyc",
      claimsHash: backendCredential.claimsHash,
      proofAvailable: true,
      status: "active",
    });
    expect(mockFetch.mock.calls[0][0]).toContain(
      `/api/v1/credentials/${backendCredential.id}`,
    );
  });

  it("rejects a non-UUID credential id before sending a request", async () => {
    await expect(
      apiClient.getCredential("0xlegacy-hash"),
    ).rejects.toMatchObject({
      code: "CREDENTIAL_ID_INVALID",
      statusCode: 400,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed credential response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ...backendCredential, claimsHash: undefined }),
    );

    await expect(
      apiClient.getCredential(backendCredential.id),
    ).rejects.toBeInstanceOf(CredentialResponseContractError);
  });
});

describe("apiClient.listSchemas()", () => {
  it("calls the approved registry with backend pagination and name filtering", async () => {
    mockFetch.mockResolvedValue(
      schemaListResponse([backendSchemaRecord], {
        page: 2,
        limit: 15,
        total: 16,
        totalPages: 2,
      }),
    );

    const result = await apiClient.listSchemas(2, 15, {
      status: "APPROVED",
      name: "  Organization  ",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/governance/schemas");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("15");
    expect(parsed.searchParams.get("status")).toBe("APPROVED");
    expect(parsed.searchParams.get("name")).toBe("Organization");
    expect(result).toEqual({
      items: [backendSchemaRecord],
      total: 16,
      page: 2,
      pageSize: 15,
      hasMore: false,
    });
  });

  it("uses default page=1, pageSize=20", async () => {
    mockFetch.mockResolvedValue(
      schemaListResponse([], {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      }),
    );
    await apiClient.listSchemas();
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("20");
  });

  it("attaches the wallet session once without retrying an authenticated read", async () => {
    storeIdentityAuthToken("registry-session");
    mockFetch.mockResolvedValue(schemaListResponse());

    await apiClient.listSchemas(1, 20, { status: "APPROVED" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer registry-session");
    expect(mockWithRetry).not.toHaveBeenCalled();
  });

  it("rejects an oversized name filter before sending a request", async () => {
    await expect(
      apiClient.listSchemas(1, 20, { name: "a".repeat(101) }),
    ).rejects.toMatchObject({
      code: "SCHEMA_NAME_FILTER_INVALID",
      statusCode: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed schema registry response", async () => {
    mockFetch.mockResolvedValue(
      schemaListResponse(
        [{ ...backendSchemaRecord, proposedBy: "not-a-uuid" }],
        { page: 1, limit: 20, total: 1, totalPages: 1 },
      ),
    );

    await expect(
      apiClient.listSchemas(1, 20, { status: "APPROVED" }),
    ).rejects.toBeInstanceOf(SchemaRegistryResponseContractError);
  });

  it("fails closed when a requested approval filter is not honored", async () => {
    mockFetch.mockResolvedValue(
      schemaListResponse([{ ...backendSchemaRecord, status: "PROPOSED" }], {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      }),
    );

    await expect(
      apiClient.listSchemas(1, 20, { status: "APPROVED" }),
    ).rejects.toThrow(/while "APPROVED" was requested/);
  });
});

describe("apiClient.getSchema()", () => {
  it("calls GET /api/v1/governance/schemas/{id}", async () => {
    mockFetch.mockResolvedValue(jsonResponse(backendSchemaRecord));
    await expect(apiClient.getSchema(backendSchemaRecord.id)).resolves.toEqual(
      backendSchemaRecord,
    );
    expect(mockFetch.mock.calls[0][0]).toContain(
      `/api/v1/governance/schemas/${backendSchemaRecord.id}`,
    );
  });
});

describe("apiClient.submitProof()", () => {
  it("calls POST /api/v1/verification/zk-verify with context-bound proof data", async () => {
    const proof = {
      id: "proof-1",
      circuitId: "0xage",
      circuitName: "age_verification",
      proofSystem: "groth16",
      proof: {
        a: ["1", "2"],
        b: [
          ["3", "4"],
          ["5", "6"],
        ],
        c: ["7", "8"],
      },
      publicInputs: ["11", "22"],
      publicOutputs: [],
      generatedAt: 1,
      validityDuration: 300,
      proofHash: "0xproof",
      nonce: "nonce-value-with-min-length",
      audience: "identity-verifier-1",
      contextCommitment: "12345",
      issuedAt: 1760000000000,
    };
    mockFetch.mockResolvedValue(
      jsonResponse({
        valid: true,
        proofId: "proof-1",
        circuitName: "age_verification",
        verifiedAt: 1760000000000,
      }),
    );
    const result = await apiClient.submitProof(proof as any, "auth");
    expect(result).toMatchObject({
      valid: true,
      proofHash: "0xproof",
      circuitId: "0xage",
      verifiedAt: 1760000000,
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/verification/zk-verify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      circuitName: "age_verification",
      nonce: "nonce-value-with-min-length",
      audience: "identity-verifier-1",
      proof: {
        pi_a: ["1", "2"],
        pi_c: ["7", "8"],
      },
    });
  });

  it("rejects proof submissions without context binding metadata before network I/O", async () => {
    const proof = {
      id: "proof-1",
      circuitId: "0xage",
      circuitName: "age_verification",
      proofSystem: "groth16",
      proof: {
        a: ["1", "2"],
        b: [
          ["3", "4"],
          ["5", "6"],
        ],
        c: ["7", "8"],
      },
      publicInputs: ["11", "22"],
      publicOutputs: [],
      generatedAt: 1,
      validityDuration: 300,
      proofHash: "0xproof",
    };

    await expect(
      apiClient.submitProof(proof as any, "auth"),
    ).rejects.toMatchObject({
      code: "PROOF_CONTEXT_REQUIRED",
      statusCode: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.listProofRequests()", () => {
  it("loads pending durable proof requests from the backend inbox", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        {
          id: "req-1",
          verifierDid: "did:aethelred:verifier",
          subjectDid: "did:aethelred:subject",
          credentialHash: "0xcred",
          requestedAttributes: ["age", "residency"],
          circuitId: "0xcircuit",
          status: "pending",
          createdAt: 1760000000,
          expiresAt: 1760086400,
          purpose: "Regulated service onboarding",
          userConsent: false,
        },
      ]),
    );

    const requests = await apiClient.listProofRequests(
      "0xdid" as `0x${string}`,
      "auth",
    );

    expect(requests[0]).toMatchObject({
      id: "req-1",
      circuitId: "0xcircuit",
      purpose: "Regulated service onboarding",
      fulfilled: false,
    });
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/verification/requests",
    );
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer auth",
    );
  });
});

describe("apiClient.getVerificationResult()", () => {
  it("loads recent verification history and maps the requested result", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        {
          id: "req-123",
          result: "VERIFIED",
          completedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    const result = await apiClient.getVerificationResult("req-123");
    expect(result).toMatchObject({
      requestId: "req-123",
      verified: true,
    });
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/verification/history",
    );
  });

  it("returns a typed not-found error when history does not contain the result", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await expect(
      apiClient.getVerificationResult("missing"),
    ).rejects.toMatchObject({
      code: "VERIFICATION_RESULT_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("apiClient.generateEligibilityProof()", () => {
  it("posts the v1 eligibility proof request to the backend contract endpoint", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        status: "ALLOWED",
        decisionId: "dec_123",
        policyId:
          "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
        policyVersion: "2026.06.1",
        subjectDid: "did:aethelred:mainnet:0xholder",
        credentialId: "cred_1",
        relyingAppId: "edge-secure-data-room",
        proof: {
          proofId: "zkp_123",
          circuitId: "zkc_eligibility_policy_context_v1",
          circuitName: "eligibility_policy_context_v1",
          verificationKeyId: "vk_eligibility_policy_context_v1_2026_06_27",
          manifestDigest:
            "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
          policyBindingDigest:
            "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
          contextHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          verifiedAt: "2026-06-23T10:00:00.000Z",
          publicSignals: {},
          privateInputsRedacted: [],
        },
        evaluation: {
          ageOverThreshold: true,
          residencyAllowed: true,
          nationalityAllowed: true,
          sanctionsClear: true,
          riskAccepted: true,
          credentialActive: true,
          credentialNotExpired: true,
          nonRevocationChecked: true,
          onchainAttested: true,
          teeAttested: true,
          minimumAge: 21,
          computedAge: 33,
          allowedResidencies: ["AE"],
          deniedReasons: [],
        },
        evidence: {
          auditLogId: "aud_123",
          auditHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          regulatoryReportId: "reg_123",
          receiptHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          receiptHashAlgorithm: "sha256-canonical-json-v1",
          policyRegistry: "zeroid://policy-registry/core",
          artifactDigest:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          manifestPath: "circuits/manifest/eligibility_v1.json",
          manifestDigest:
            "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
          sourceDigest:
            "0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3",
          policyBindingDigest:
            "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
          artifactStatus: "SOURCE_VALIDATED_ARTIFACTS_PENDING",
          evidenceChain: [],
        },
        issuedAt: "2026-06-23T10:00:00.000Z",
      }),
    );

    const request = {
      subjectDid: "did:aethelred:mainnet:0xholder",
      credentialId: "cred_1",
      policyId:
        "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
      relyingAppId: "edge-secure-data-room",
      contextNonce: "nonce-1234567890",
      options: { requireNonRevocationProof: true },
    };

    const result = await apiClient.generateEligibilityProof(request, "auth");

    expect(result.status).toBe("ALLOWED");
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/verification/eligibility-proof",
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(request);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer auth",
    );
  });
});

describe("apiClient.getEligibilityProofReceipt()", () => {
  it("retrieves a durable eligibility proof receipt by decision id", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        verificationId: "verification-1",
        status: "ALLOWED",
        decisionId: "dec_123",
        policyId:
          "zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1",
        policyVersion: "2026.06.1",
        credentialId: "cred_1",
        verifierId: "subject-1",
        subjectId: "subject-1",
        relyingAppId: "edge-secure-data-room",
        proof: {
          proofId: "zkp_123",
          circuitId: "zkc_eligibility_policy_context_v1",
          circuitName: "eligibility_policy_context_v1",
          verificationKeyId: "vk_eligibility_policy_context_v1_2026_06_27",
          manifestDigest:
            "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
          sourceDigest:
            "0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3",
          policyBindingDigest:
            "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
          contextHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          publicSignals: {
            claimsHash:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          privateInputsRedacted: ["dobYear"],
          disclosurePolicy: {
            rawFieldsDisclosed: [],
            disclosureBudget: { rawFieldCount: 0 },
          },
        },
        evidence: {
          auditLogId: "aud_123",
          auditHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          receiptHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          receiptHashAlgorithm: "sha256-canonical-json-v1",
          manifestPath: "circuits/manifest/eligibility_v1.json",
          manifestDigest:
            "0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5",
          sourceDigest:
            "0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3",
          policyBindingDigest:
            "0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c",
          artifactStatus: "SOURCE_VALIDATED_ARTIFACTS_PENDING",
          auditDetails: { proofId: "zkp_123" },
        },
        evaluation: {
          ageOverThreshold: true,
          teeAttested: true,
        },
        deniedReasons: [],
        requestedAt: "2026-06-23T10:00:00.000Z",
        completedAt: "2026-06-23T10:00:01.000Z",
      }),
    );

    const result = await apiClient.getEligibilityProofReceipt(
      "dec_123",
      "auth",
    );

    expect(result.verificationId).toBe("verification-1");
    expect(result.evidence.auditDetails).toMatchObject({ proofId: "zkp_123" });
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/verification/eligibility-proof/dec_123",
    );
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer auth",
    );
  });

  it("rejects malformed receipt ids before fetch", async () => {
    await expect(
      apiClient.getEligibilityProofReceipt("../bad", "auth"),
    ).rejects.toMatchObject({
      code: "ELIGIBILITY_RECEIPT_ID_INVALID",
      statusCode: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.listTEENodes()", () => {
  it("loads TEE nodes from the TEE service", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        nodes: [
          {
            id: "tee-1",
            operator: "0x0000000000000000000000000000000000000001",
            attestation: { isValid: true, expiresAt: 9999999999 },
            platform: 1,
            name: "SGX UAE Node",
            region: "AE",
            isOnline: true,
            uptimePercent: 99.9,
            verificationsProcessed: 12_000,
            avgLatencyMs: 42,
          },
        ],
      }),
    });

    const nodes = await apiClient.listTEENodes();

    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("SGX UAE Node");
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://tee.zeroid.aethelred.network/api/v1/tee/nodes/status",
    );
  });
});

describe("apiClient.getAttestation()", () => {
  it("verifies and returns an attestation from the TEE service", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        attestation: {
          enclaveHash: "0xenc",
          platform: 1,
          attestedAt: 1760000000,
          expiresAt: 1760086400,
          reportDataHash: "0xreport",
          nodeOperator: "0x0000000000000000000000000000000000000001",
          isValid: true,
          attestationType: "remote",
        },
      }),
    });

    const attestation = await apiClient.getAttestation(
      "0xenc" as `0x${string}`,
    );

    expect(attestation.isValid).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://tee.zeroid.aethelred.network/api/v1/tee/attestation/verify",
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      enclaveHash: "0xenc",
    });
  });
});

describe("apiClient.requestBiometricVerification()", () => {
  it("submits biometric verification to the TEE service", async () => {
    const payload = {
      subjectDidHash: "0xsub" as `0x${string}`,
      enclaveHash: "0xenc" as `0x${string}`,
      biometricData: "base64data",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        verificationId: "bio-1",
        biometricHash: "0xbio",
      }),
    });

    const result = await apiClient.requestBiometricVerification(
      payload,
      "auth",
    );

    expect(result).toEqual({
      success: true,
      verificationId: "bio-1",
      status: "verified",
      biometricHash: "0xbio",
      enclaveHash: "0xenc",
      error: undefined,
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://tee.zeroid.aethelred.network/api/v1/tee/biometric/verify",
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      subjectDidHash: "0xsub",
      enclaveHash: "0xenc",
      encryptedBiometricData: "base64data",
      biometricType: "face",
    });
  });

  it("submits biometric enrollment to the TEE service", async () => {
    const payload = {
      subjectDidHash: "0xsub" as `0x${string}`,
      enclaveHash: "0xenc" as `0x${string}`,
      biometricData: "base64data",
      biometricType: "fingerprint",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        enrollmentId: "enroll-1",
        templateHash: "0xtemplate",
      }),
    });

    const result = await apiClient.enrollBiometric(payload, "auth");

    expect(result).toEqual({
      success: true,
      verificationId: "enroll-1",
      status: "verified",
      biometricHash: "0xtemplate",
      enclaveHash: "0xenc",
      error: undefined,
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://tee.zeroid.aethelred.network/api/v1/tee/biometric/enroll",
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      subjectDidHash: "0xsub",
      enclaveHash: "0xenc",
      encryptedBiometricData: "base64data",
      biometricType: "fingerprint",
    });
  });
});

describe("apiClient.createVerificationRequest()", () => {
  it("creates a durable verifier proof request through the backend", async () => {
    const payload = {
      verifierDid: { uri: "did:aethelred:verifier" },
      subjectDid: { uri: "did:aethelred:subject" },
      credentialHash: "0xcred",
      requestedAttributes: ["age"],
      circuitId: "0xcircuit",
      expiresAt: 1760086400,
      purpose: "Regulated onboarding",
    };
    mockFetch.mockResolvedValue(
      jsonResponse({
        id: "req-1",
        ...payload,
        verifierDid: "did:aethelred:verifier",
        subjectDid: "did:aethelred:subject",
        status: "pending",
        createdAt: 1760000000,
        userConsent: false,
      }),
    );

    const result = await apiClient.createVerificationRequest(
      payload as any,
      "auth",
    );

    expect(result.id).toBe("req-1");
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/verification/requests",
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      verifierDid: "did:aethelred:verifier",
      subjectDid: "did:aethelred:subject",
      credentialHash: "0xcred",
    });
  });
});

describe("apiClient.respondToVerification()", () => {
  it("verifies the supplied proof through /api/v1/verification/zk-verify", async () => {
    const proof = {
      id: "proof-1",
      circuitId: "0xage",
      circuitName: "age_verification",
      proofSystem: "groth16",
      proof: {
        a: ["1", "2"],
        b: [
          ["3", "4"],
          ["5", "6"],
        ],
        c: ["7", "8"],
      },
      publicInputs: ["11", "22"],
      publicOutputs: [],
      generatedAt: 1,
      validityDuration: 300,
      proofHash: "0xproof",
      nonce: "nonce-value-with-min-length",
      audience: "identity-verifier-1",
      contextCommitment: "12345",
      issuedAt: 1760000000000,
    };
    const payload = { consent: true, proof };
    mockFetch.mockResolvedValue(
      jsonResponse({
        valid: true,
        proofId: "proof-1",
        circuitName: "age_verification",
        verifiedAt: 1760000000000,
      }),
    );
    const result = await apiClient.respondToVerification(
      "req-1",
      payload as any,
      "auth",
    );
    expect(result).toMatchObject({
      requestId: "req-1",
      verified: true,
      verifiedAt: 1760000000,
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/verification/zk-verify");
    expect(init.method).toBe("POST");
  });

  it("returns a local rejection result when consent is denied", async () => {
    const result = await apiClient.respondToVerification(
      "req-1",
      { consent: false },
      "auth",
    );
    expect(result).toMatchObject({
      requestId: "req-1",
      verified: false,
      reason: "User declined verification",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.listProposals()", () => {
  it("maps schema-governance records into proposal metadata", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "schema-1",
            name: "KYC",
            version: "1.0.0",
            description: "KYC credential schema",
            proposedBy: "identity-1",
            status: "PROPOSED",
            approvalVotes: 2,
            rejectionVotes: 1,
            createdAt: "2026-06-23T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        requestId: "zid-server-abc",
      }),
    });

    const result = await apiClient.listProposals(1, 10);

    expect(result.items[0]).toMatchObject({
      id: "schema-1",
      title: "KYC 1.0.0",
      votesFor: 2,
      votesAgainst: 1,
      status: "active",
    });
    expect(result.total).toBe(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/governance/schemas");
  });
});

describe("apiClient.getProposal()", () => {
  it("maps a schema-governance detail record into a proposal", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        id: "42",
        name: "KYC",
        version: "1.0.0",
        description: "KYC credential schema",
        status: "APPROVED",
        approvalVotes: 3,
        rejectionVotes: 0,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      }),
    );

    const proposal = await apiClient.getProposal(42);

    expect(proposal).toMatchObject({
      id: "42",
      title: "KYC 1.0.0",
      status: "passed",
      votesFor: 3,
    });
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/governance/schemas/42",
    );
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("edge cases", () => {
  it("uses server requestId from response when available in error", async () => {
    const resp = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: jest.fn().mockResolvedValue({
        success: false,
        error: { code: "FORBIDDEN", message: "Access denied" },
        requestId: "zid-from-server",
      }),
    };
    mockFetch.mockResolvedValue(resp);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      expect(e.requestId).toBe("zid-from-server");
    }
  });

  it("falls back to local requestId when server does not return one", async () => {
    const resp = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: jest.fn().mockResolvedValue({
        success: false,
        error: { code: "INTERNAL", message: "boom" },
        // no requestId in response
      }),
    };
    mockFetch.mockResolvedValue(resp);
    try {
      await apiClient.health();
    } catch (err) {
      const e = err as ZeroIDApiError;
      // Falls back to local generated ID
      expect(e.requestId).toMatch(REQUEST_ID_PATTERN);
    }
  });

  it("generates unique request IDs per call", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    await apiClient.health();
    const id1 = mockFetch.mock.calls[0][1].headers["X-Request-ID"];
    const id2 = mockFetch.mock.calls[1][1].headers["X-Request-ID"];
    // While not guaranteed to differ (random), the probability is astronomically high
    expect(id1).toMatch(/^zid-/);
    expect(id2).toMatch(/^zid-/);
  });

  it("timeout message includes method and path", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [, timeoutMs, msg] = mockWithTimeout.mock.calls[0];
    expect(timeoutMs).toBe(30_000);
    expect(msg).toContain("GET");
    expect(msg).toContain("/api/v1/health");
  });
});
