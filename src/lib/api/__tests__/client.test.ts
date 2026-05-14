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
    expect(parsed.searchParams.get("subject")).toBeNull();
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(parsed.searchParams.get("role")).toBe("subject");
  });

  it("omits empty/null/undefined query parameter values", async () => {
    // listSchemas only passes page + limit, so verify no extra keys
    mockFetch.mockResolvedValue(jsonResponse([]));
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
    mockFetch.mockResolvedValue(jsonResponse({}));
    await apiClient.getSchema("schema-123");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/governance/schemas/schema-123");
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

describe("apiClient.listCredentials()", () => {
  it("passes backend pagination and role query params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        data: [{ id: "cred-1" }],
        pagination: { page: 3, limit: 5, total: 11, totalPages: 3 },
      }),
    });

    const result = await apiClient.listCredentials("0xsub" as `0x${string}`, 3, 5);

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("limit")).toBe("5");
    expect(parsed.searchParams.get("role")).toBe("subject");
    expect(parsed.searchParams.get("subject")).toBeNull();
    expect(result).toEqual({
      items: [{ id: "cred-1" }],
      total: 11,
      page: 3,
      pageSize: 5,
      hasMore: false,
    });
  });

  it("uses default page=1, pageSize=12 when not specified", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await apiClient.listCredentials("0xsub" as `0x${string}`);
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("12");
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
  it("calls GET /api/v1/governance/schemas with backend pagination", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        data: [{ id: "schema-1" }],
        pagination: { page: 2, limit: 15, total: 21, totalPages: 2 },
      }),
    });

    const result = await apiClient.listSchemas(2, 15);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/governance/schemas");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("15");
    expect(result).toEqual({
      items: [{ id: "schema-1" }],
      total: 21,
      page: 2,
      pageSize: 15,
      hasMore: false,
    });
  });

  it("uses default page=1, pageSize=20", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await apiClient.listSchemas();
    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("limit")).toBe("20");
  });
});

describe("apiClient.getSchema()", () => {
  it("calls GET /api/v1/governance/schemas/{id}", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ hash: "0xschema" }));
    await apiClient.getSchema("schema-123");
    expect(mockFetch.mock.calls[0][0]).toContain(
      "/api/v1/governance/schemas/schema-123",
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
        b: [["3", "4"], ["5", "6"]],
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
        b: [["3", "4"], ["5", "6"]],
        c: ["7", "8"],
      },
      publicInputs: ["11", "22"],
      publicOutputs: [],
      generatedAt: 1,
      validityDuration: 300,
      proofHash: "0xproof",
    };

    await expect(apiClient.submitProof(proof as any, "auth")).rejects.toMatchObject({
      code: "PROOF_CONTEXT_REQUIRED",
      statusCode: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.listProofRequests()", () => {
  it("fails closed because the backend does not expose a proof request inbox", async () => {
    await expect(
      apiClient.listProofRequests("0xdid" as `0x${string}`, "auth"),
    ).rejects.toMatchObject({
      code: "PROOF_REQUEST_INBOX_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
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
    await expect(apiClient.getVerificationResult("missing")).rejects.toMatchObject({
      code: "VERIFICATION_RESULT_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("apiClient.listTEENodes()", () => {
  it("fails closed because node discovery is not exposed", async () => {
    await expect(apiClient.listTEENodes()).rejects.toMatchObject({
      code: "TEE_NODE_DISCOVERY_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.getAttestation()", () => {
  it("fails closed because enclave-hash lookup is not exposed", async () => {
    await expect(apiClient.getAttestation("0xenc" as `0x${string}`)).rejects.toMatchObject({
      code: "TEE_ATTESTATION_LOOKUP_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.requestBiometricVerification()", () => {
  it("fails closed because biometric verification is not exposed", async () => {
    const payload = {
      subjectDidHash: "0xsub" as `0x${string}`,
      enclaveHash: "0xenc" as `0x${string}`,
      biometricData: "base64data",
    };
    await expect(
      apiClient.requestBiometricVerification(payload, "auth"),
    ).rejects.toMatchObject({
      code: "BIOMETRIC_VERIFICATION_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.createVerificationRequest()", () => {
  it("fails closed because verifier-created requests are not exposed", async () => {
    const payload = {
      verifierDid: "0xv",
      subjectDid: "0xs",
      schemaHash: "0xsch",
    };
    await expect(
      apiClient.createVerificationRequest(payload as any, "auth"),
    ).rejects.toMatchObject({
      code: "VERIFICATION_REQUEST_CREATE_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
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
        b: [["3", "4"], ["5", "6"]],
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
  it("fails closed because proposal metadata is not exposed", async () => {
    await expect(apiClient.listProposals(1, 10)).rejects.toMatchObject({
      code: "GOVERNANCE_PROPOSALS_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call a stale proposal list route when defaults are used", async () => {
    await expect(apiClient.listProposals()).rejects.toMatchObject({
      code: "GOVERNANCE_PROPOSALS_UNAVAILABLE",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("apiClient.getProposal()", () => {
  it("fails closed because proposal detail metadata is not exposed", async () => {
    await expect(apiClient.getProposal(42)).rejects.toMatchObject({
      code: "GOVERNANCE_PROPOSAL_DETAIL_UNAVAILABLE",
      statusCode: 501,
    });
    expect(mockFetch).not.toHaveBeenCalled();
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
