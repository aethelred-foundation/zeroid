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
    expect(data.error).toBe("Missing credentialHash or proof");
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
    expect(data.error).toBe("Missing credentialHash or proof");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialHash: "0x123",
        proof: "0xabc",
        attributeName: "age",
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockResult);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/credentials/verify"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialHash: "0x123",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialHash: "0x123",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialHash: "0x123",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialHash: "0x123",
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

  beforeAll(async () => {
    const mod = await import("@/app/api/proof/generate/route");
    POST = mod.POST as unknown as (request: Request) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns 400 when circuitType is missing", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicInputs: ["1", "2"] }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing circuitType or publicInputs");
  });

  it("returns 400 when publicInputs is missing", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ circuitType: "age_proof" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing circuitType or publicInputs");
  });

  it("returns 400 for invalid circuit type", async () => {
    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "invalid_circuit",
        publicInputs: ["1"],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid circuit type");
    expect(data.error).toContain("age_proof");
  });

  it.each([
    "age_proof",
    "residency_proof",
    "credit_tier_proof",
    "nationality_proof",
    "composite_proof",
  ])("accepts valid circuit type: %s", async (circuitType) => {
    const mockProof = { proof: "0xproof", publicSignals: ["1"] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ circuitType, publicInputs: ["1", "2"] }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockProof);
  });

  it("forwards request to backend TEE service", async () => {
    const mockProof = { proof: "0xgenerated" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "age_proof",
        publicInputs: ["18", "1700000000", "0xhash"],
      }),
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/verification/generate-proof"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("returns backend error status when backend fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ message: "TEE unavailable" }),
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "age_proof",
        publicInputs: ["18"],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("TEE unavailable");
  });

  it("returns fallback error message when backend error has no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "age_proof",
        publicInputs: ["18"],
      }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "age_proof",
        publicInputs: ["18"],
      }),
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

  it("uses default API URL when env var is not set", async () => {
    const originalEnv = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const mockProof = { proof: "0x" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request("http://localhost/api/proof/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuitType: "age_proof",
        publicInputs: ["18"],
      }),
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("localhost:4003"),
      expect.anything(),
    );

    if (originalEnv) process.env.NEXT_PUBLIC_API_URL = originalEnv;
  });
});
