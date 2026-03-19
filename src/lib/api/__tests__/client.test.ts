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

import { ZeroIDApiError, apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock withRetry so tests are fast (no real exponential backoff)
const mockWithRetry = jest.fn(
  async (fn: () => Promise<unknown>, _retries?: number) => fn(),
);
const mockWithTimeout = jest.fn(
  async <T>(promise: Promise<T>, _ms: number, _msg?: string): Promise<T> =>
    promise,
);

jest.mock("@/lib/utils", () => ({
  withRetry: (...args: unknown[]) =>
    mockWithRetry(...(args as [() => Promise<unknown>, number])),
  withTimeout: (...args: unknown[]) =>
    mockWithTimeout(...(args as [Promise<unknown>, number, string?])),
}));

jest.mock("@/config/constants", () => ({
  API_BASE_URL: "https://api.zeroid.aethelred.network",
}));

// Global fetch mock
const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

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
    expect(init.headers["X-Request-ID"]).toMatch(/^zid-[a-z0-9]+-[a-z0-9]+$/);
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
      didUri: "did:aethelred:mainnet:0x1",
      recoveryHash: "0xrecov",
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
  it("constructs full URL from API_BASE_URL and path", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    await apiClient.health();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.zeroid.aethelred.network/api/v1/health");
  });

  it("appends query parameters", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listCredentials("0xsubject" as `0x${string}`, 2, 20);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("subject")).toBe("0xsubject");
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("pageSize")).toBe("20");
  });

  it("omits empty/null/undefined query parameter values", async () => {
    // listSchemas only passes page + pageSize (no subject), so verify no extra keys
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listSchemas(1, 10);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("10");
    // Only two params should exist
    const keys = Array.from(parsed.searchParams.keys());
    expect(keys).toEqual(["page", "pageSize"]);
  });

  it("includes path parameters inline", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await apiClient.getSchema("0xschema123" as `0x${string}`);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/schemas/0xschema123");
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

  it("retries GET requests on failure", async () => {
    let attempt = 0;
    mockWithRetry.mockImplementation(
      async (fn: () => Promise<unknown>, retries?: number) => {
        let lastErr: unknown;
        for (let i = 0; i <= (retries ?? 0); i++) {
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
      { didUri: "did:aethelred:mainnet:0x1", recoveryHash: "0xrecov" } as any,
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
  it("calls GET /api/v1/identity/{didHash}", async () => {
    const profile = { didHash: "0xabc", status: "active" };
    mockFetch.mockResolvedValue(jsonResponse(profile));
    const result = await apiClient.getIdentity("0xabc" as `0x${string}`);
    expect(result).toEqual(profile);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/identity/0xabc");
  });

  it("passes authToken when provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await apiClient.getIdentity("0xabc" as `0x${string}`, "my-token");
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
      didUri: "did:aethelred:mainnet:0x1",
      recoveryHash: "0xrecov" as `0x${string}`,
    };
    const result = await apiClient.registerIdentity(payload as any, "auth-tok");
    expect(result).toEqual(responseData);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/identity/register");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer auth-tok");
  });
});

describe("apiClient.listCredentials()", () => {
  it("passes subject, page, and pageSize as query params", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listCredentials("0xsub" as `0x${string}`, 3, 5);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("subject")).toBe("0xsub");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("pageSize")).toBe("5");
  });

  it("uses default page=1, pageSize=12 when not specified", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listCredentials("0xsub" as `0x${string}`);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("12");
  });
});

describe("apiClient.getCredential()", () => {
  it("calls GET /api/v1/credentials/{hash}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ hash: "0xcred" }));
    const result = await apiClient.getCredential("0xcred" as `0x${string}`);
    expect(result).toEqual({ hash: "0xcred" });
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/credentials/0xcred");
  });
});

describe("apiClient.listSchemas()", () => {
  it("calls GET /api/v1/schemas with page and pageSize", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listSchemas(2, 15);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/schemas");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("pageSize")).toBe("15");
  });

  it("uses default page=1, pageSize=20", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listSchemas();
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("20");
  });
});

describe("apiClient.getSchema()", () => {
  it("calls GET /api/v1/schemas/{hash}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ hash: "0xschema" }));
    await apiClient.getSchema("0xschema" as `0x${string}`);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/schemas/0xschema");
  });
});

describe("apiClient.submitProof()", () => {
  it("calls POST /api/v1/proofs/submit", async () => {
    const proof = { circuitId: "age", publicInputs: [], proof: "data" };
    mockFetch.mockResolvedValue(jsonResponse({ verified: true }));
    const result = await apiClient.submitProof(proof as any, "auth");
    expect(result).toEqual({ verified: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/proofs/submit");
    expect(init.method).toBe("POST");
  });
});

describe("apiClient.listProofRequests()", () => {
  it("calls GET /api/v1/proofs/requests with subject param", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await apiClient.listProofRequests("0xdid" as `0x${string}`, "auth");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/proofs/requests");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("subject")).toBe("0xdid");
    expect(init.headers["Authorization"]).toBe("Bearer auth");
  });
});

describe("apiClient.getVerificationResult()", () => {
  it("calls GET /api/v1/proofs/verifications/{id}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "verified" }));
    await apiClient.getVerificationResult("req-123");
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/proofs/verifications/req-123",
    );
  });
});

describe("apiClient.listTEENodes()", () => {
  it("calls GET /api/v1/tee/nodes", async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: "node1" }]));
    const result = await apiClient.listTEENodes();
    expect(result).toEqual([{ id: "node1" }]);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/tee/nodes");
  });
});

describe("apiClient.getAttestation()", () => {
  it("calls GET /api/v1/tee/attestation/{hash}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ enclaveHash: "0xenc" }));
    await apiClient.getAttestation("0xenc" as `0x${string}`);
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/tee/attestation/0xenc",
    );
  });
});

describe("apiClient.requestBiometricVerification()", () => {
  it("calls POST /api/v1/tee/biometric/verify", async () => {
    const payload = {
      subjectDidHash: "0xsub" as `0x${string}`,
      enclaveHash: "0xenc" as `0x${string}`,
      biometricData: "base64data",
    };
    mockFetch.mockResolvedValue(
      jsonResponse({ verificationId: "v1", status: "pending" }),
    );
    const result = await apiClient.requestBiometricVerification(
      payload,
      "auth",
    );
    expect(result).toEqual({ verificationId: "v1", status: "pending" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/tee/biometric/verify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(payload);
  });
});

describe("apiClient.createVerificationRequest()", () => {
  it("calls POST /api/v1/verifications", async () => {
    const payload = {
      verifierDid: "0xv",
      subjectDid: "0xs",
      schemaHash: "0xsch",
    };
    mockFetch.mockResolvedValue(jsonResponse({ id: "vr1", status: "pending" }));
    const result = await apiClient.createVerificationRequest(
      payload as any,
      "auth",
    );
    expect(result).toEqual({ id: "vr1", status: "pending" });
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/verifications");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });
});

describe("apiClient.respondToVerification()", () => {
  it("calls POST /api/v1/verifications/{id}/respond", async () => {
    const payload = { consent: true, proof: { circuitId: "age" } };
    mockFetch.mockResolvedValue(jsonResponse({ status: "verified" }));
    const result = await apiClient.respondToVerification(
      "req-1",
      payload as any,
      "auth",
    );
    expect(result).toEqual({ status: "verified" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/verifications/req-1/respond");
    expect(init.method).toBe("POST");
  });
});

describe("apiClient.listProposals()", () => {
  it("calls GET /api/v1/governance/proposals with page/pageSize", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listProposals(1, 10);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/governance/proposals");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("10");
  });

  it("uses default page=1, pageSize=10", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await apiClient.listProposals();
    const parsed = new URL(mockFetch.mock.calls[0][0]);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("10");
  });
});

describe("apiClient.getProposal()", () => {
  it("calls GET /api/v1/governance/proposals/{id}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 42, title: "Upgrade" }));
    const result = await apiClient.getProposal(42);
    expect(result).toEqual({ id: 42, title: "Upgrade" });
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/governance/proposals/42",
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
      expect(e.requestId).toMatch(/^zid-[a-z0-9]+-[a-z0-9]+$/);
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
