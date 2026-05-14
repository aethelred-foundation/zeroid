/**
 * Tests for API route handlers:
 * - GET /api/health
 * - POST /api/credential/verify
 * - POST /api/proof/generate
 */

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GET /api/health", () => {
  let GET: () => Promise<Response>;

  beforeAll(async () => {
    const mod = await import("@/app/api/health/route");
    GET = mod.GET;
  });

  it("returns healthy status", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.service).toBe("zeroid-frontend");
    expect(data.version).toBe("1.0.0");
    expect(data.timestamp).toBeDefined();
    expect(data.checks.api).toBe("ok");
    expect(data.checks.circuits).toBe("loaded");
  });

  it("returns valid ISO timestamp", async () => {
    const response = await GET();
    const data = await response.json();
    const date = new Date(data.timestamp);
    expect(date.toISOString()).toBe(data.timestamp);
  });
});

describe("POST /api/credential/verify", () => {
  let POST: (request: Request) => Promise<Response>;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  };

  beforeAll(async () => {
    const mod = await import("@/app/api/credential/verify/route");
    POST = mod.POST as unknown as (request: Request) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns 400 when credentialHash is missing", async () => {
    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: "0xabc" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing credentialId or proof");
  });

  it("returns 400 when proof is missing", async () => {
    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialHash: "0x123" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing credentialId or proof");
  });

  it("returns 401 when authorization is missing", async () => {
    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialId: "550e8400-e29b-41d4-a716-446655440000",
        proof: "0xabc",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authorization bearer token required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when both are missing", async () => {
    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("forwards request to backend and returns success response", async () => {
    const mockResult = { verified: true, credentialId: "0x123" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResult,
    });

    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: "550e8400-e29b-41d4-a716-446655440000",
        proof: "0xabc",
        attributeName: "age",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockResult);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/credentials/550e8400-e29b-41d4-a716-446655440000/verify",
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({
          proof: "0xabc",
          attributeName: "age",
        }),
      }),
    );
  });

  it("returns backend error status when backend fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid proof format" }),
    });

    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: "550e8400-e29b-41d4-a716-446655440000",
        proof: "0xbad",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("Invalid proof format");
  });

  it("returns fallback error message when backend error has no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: "550e8400-e29b-41d4-a716-446655440000",
        proof: "0xbad",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Verification failed");
  });

  it("returns 500 on unexpected error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: "550e8400-e29b-41d4-a716-446655440000",
        proof: "0xabc",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Internal server error");
  });

  it("returns 500 when request body is invalid JSON", async () => {
    const request = new Request("http://localhost/api/credential/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });
});

describe("POST /api/proof/generate", () => {
  let POST: (request: Request) => Promise<Response>;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  };
  const validProofBody = {
    credentialId: "550e8400-e29b-41d4-a716-446655440000",
    circuitName: "age_verification_context_v2",
    inputs: { ageThresholdYears: "18" },
    audience: "did:aethelred:verifier:enterprise",
  };

  beforeAll(async () => {
    const mod = await import("@/app/api/proof/generate/route");
    POST = mod.POST as unknown as (request: Request) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns 400 when circuitName is missing", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialId: validProofBody.credentialId,
        inputs: validProofBody.inputs,
        audience: validProofBody.audience,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      "Missing credentialId, circuitName, inputs, or audience",
    );
  });

  it("returns 400 when inputs are missing", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialId: validProofBody.credentialId,
        circuitName: validProofBody.circuitName,
        audience: validProofBody.audience,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      "Missing credentialId, circuitName, inputs, or audience",
    );
  });

  it("returns 400 when inputs are not keyed by circuit signal name", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validProofBody,
        inputs: ["1"],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      "Proof inputs must be an object keyed by circuit signal name",
    );
  });

  it("returns 401 when authorization is missing", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authorization bearer token required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts legacy circuitType naming while forwarding backend schema", async () => {
    const mockProof = { proof: "0xproof", publicSignals: ["1"] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: validProofBody.credentialId,
        circuitType: "age_verification_context_v2",
        inputs: validProofBody.inputs,
        audience: validProofBody.audience,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockProof);
  });

  it("forwards request to backend ZK proof endpoint", async () => {
    const mockProof = { proof: "0xgenerated" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        ...validProofBody,
        nonce: "nonce-1234567890123456",
        selectiveDisclosure: ["age"],
      }),
    });

    await POST(request);

    const [, init] = mockFetch.mock.calls[0];
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/verification/zk-proof"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ...validProofBody,
      nonce: "nonce-1234567890123456",
      selectiveDisclosure: ["age"],
    });
  });

  it("returns backend error status when backend fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ message: "Proof service unavailable" }),
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("Proof service unavailable");
  });

  it("returns fallback error message when backend error has no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Proof generation failed");
  });

  it("returns 500 on unexpected error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Internal server error");
  });

  it("returns 500 when request body is invalid JSON", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  it("uses default development backend URL when env var is not set", async () => {
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    const originalPublicEnv = process.env.NEXT_PUBLIC_API_URL;
    const originalZeroIdPublicEnv = process.env.NEXT_PUBLIC_ZEROID_API_URL;
    delete process.env.ZEROID_BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_ZEROID_API_URL;

    const mockProof = { proof: "0x" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("localhost:4000"),
      expect.anything(),
    );

    if (originalServerEnv) {
      process.env.ZEROID_BACKEND_API_URL = originalServerEnv;
    }
    if (originalPublicEnv) {
      process.env.NEXT_PUBLIC_API_URL = originalPublicEnv;
    }
    if (originalZeroIdPublicEnv) {
      process.env.NEXT_PUBLIC_ZEROID_API_URL = originalZeroIdPublicEnv;
    }
  });

  it("fails closed when production backend URL is not configured", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    process.env.NODE_ENV = "production";
    delete process.env.ZEROID_BACKEND_API_URL;

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("Backend API URL is not configured for production");
    expect(mockFetch).not.toHaveBeenCalled();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalServerEnv) {
      process.env.ZEROID_BACKEND_API_URL = originalServerEnv;
    }
  });
});
