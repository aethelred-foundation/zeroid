/**
 * Tests for API route handlers:
 * - GET /api/health
 * - POST /api/credential/verify
 * - POST /api/proof/generate
 */

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GET /api/health', () => {
  let GET: () => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/health/route');
    GET = mod.GET;
  });

  it('returns healthy status', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('zeroid-frontend');
    expect(data.version).toBe('1.0.0');
    expect(data.timestamp).toBeDefined();
    expect(data.checks.api).toBe('ok');
    expect(data.checks.circuits).toBe('loaded');
  });

  it('returns valid ISO timestamp', async () => {
    const response = await GET();
    const data = await response.json();
    const date = new Date(data.timestamp);
    expect(date.toISOString()).toBe(data.timestamp);
  });

  it('sets no-store JSON security headers', async () => {
    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Vary')).toContain('Authorization');
  });
});

describe('POST /api/credential/verify', () => {
  let POST: (request: Request) => Promise<Response>;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
  };

  beforeAll(async () => {
    const mod = await import('@/app/api/credential/verify/route');
    POST = mod.POST as unknown as (request: Request) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns 400 when credentialHash is missing', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof: '0xabc' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing credentialId or proof');
  });

  it('returns 400 when proof is missing', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialHash: '0x123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing credentialId or proof');
  });

  it('returns 401 when authorization is missing', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Authorization bearer token required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 and does not proxy malformed bearer tokens', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token with spaces',
      },
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Authorization bearer token required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when both are missing', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 when credentialId exceeds the proxy field limit', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: 'c'.repeat(129),
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing credentialId or proof');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when attributeName is not a bounded string', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
        attributeName: 'a'.repeat(129),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('attributeName must be a bounded string');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards request to backend and returns success response', async () => {
    const mockResult = { verified: true, credentialId: '0x123' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResult,
    });

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
        attributeName: 'age',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockResult);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/credentials/550e8400-e29b-41d4-a716-446655440000/verify',
      ),
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({
          proof: '0xabc',
          attributeName: 'age',
        }),
      }),
    );
  });

  it('does not forward malformed request ids to backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true }),
    });

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'X-Request-Id': '../bad id',
      },
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    await POST(request);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty('X-Request-ID');
  });

  it('returns backend error status when backend fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Invalid proof format' }),
    });

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xbad',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe('Invalid proof format');
  });

  it('bounds and normalizes backend error messages before returning them', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ message: `bad\x00\n${'x'.repeat(900)}` }),
    });

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xbad',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.length).toBeLessThanOrEqual(512);
    expect(data.error).toContain('bad');
    expect(data.error).not.toContain('\x00');
    expect(data.error).not.toContain('\n');
  });

  it('returns fallback error message when backend error has no message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xbad',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Verification failed');
  });

  it('returns 500 on unexpected error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
  });

  it('returns 504 when backend verification request times out', async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
    );

    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.error).toBe('Backend request timed out');
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Request body must be a JSON object');
  });

  it('returns 413 when request body exceeds the proxy limit', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1048577',
      },
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: '0xabc',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(413);
    expect(data.error).toBe('Request body too large');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 413 when streamed request body exceeds the proxy limit', async () => {
    const request = new Request('http://localhost/api/credential/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credentialId: '550e8400-e29b-41d4-a716-446655440000',
        proof: 'x'.repeat(1_048_576),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(413);
    expect(data.error).toBe('Request body too large');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/proof/generate', () => {
  let POST: (request: Request) => Promise<Response>;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
  };
  const validProofBody = {
    credentialId: '550e8400-e29b-41d4-a716-446655440000',
    circuitName: 'age_verification_context_v2',
    inputs: { ageThresholdYears: '18' },
    audience: 'did:aethelred:verifier:enterprise',
  };

  beforeAll(async () => {
    const mod = await import('@/app/api/proof/generate/route');
    POST = mod.POST as unknown as (request: Request) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns 400 when circuitName is missing', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      'Missing credentialId, circuitName, inputs, or audience',
    );
  });

  it('returns 400 when inputs are missing', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      'Missing credentialId, circuitName, inputs, or audience',
    );
  });

  it('returns 400 when inputs are not keyed by circuit signal name', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validProofBody,
        inputs: ['1'],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      'Proof inputs must be an object keyed by circuit signal name',
    );
  });

  it('returns 400 when nonce is too short for context binding', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ...validProofBody,
        nonce: 'short',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('nonce must be a bounded string');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when selectiveDisclosure is malformed', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ...validProofBody,
        selectiveDisclosure: ['age', ''],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      'selectiveDisclosure must be an array of bounded strings',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization is missing', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Authorization bearer token required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts legacy circuitType naming while forwarding backend schema', async () => {
    const mockProof = { proof: '0xproof', publicSignals: ['1'] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        credentialId: validProofBody.credentialId,
        circuitType: 'age_verification_context_v2',
        inputs: validProofBody.inputs,
        audience: validProofBody.audience,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockProof);
  });

  it('forwards request to backend ZK proof endpoint', async () => {
    const mockProof = { proof: '0xgenerated' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        ...validProofBody,
        requestId: '11111111-1111-4111-8111-111111111111',
        nonce: 'nonce-1234567890123456',
        selectiveDisclosure: ['age'],
      }),
    });

    await POST(request);

    const [, init] = mockFetch.mock.calls[0];
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/verification/zk-proof'),
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ...validProofBody,
      requestId: '11111111-1111-4111-8111-111111111111',
      nonce: 'nonce-1234567890123456',
      selectiveDisclosure: ['age'],
    });
  });

  it('returns backend error status when backend fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Proof service unavailable' }),
    });

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Proof service unavailable');
  });

  it('returns fallback error message when backend error has no message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Proof generation failed');
  });

  it('returns 500 on unexpected error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
  });

  it('returns 504 when backend proof request times out', async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error('Timeout'), { name: 'AbortError' }),
    );

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.error).toBe('Backend request timed out');
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Request body must be a JSON object');
  });

  it('uses default development backend URL when env var is not set', async () => {
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    const originalPublicEnv = process.env.NEXT_PUBLIC_API_URL;
    const originalZeroIdPublicEnv = process.env.NEXT_PUBLIC_ZEROID_API_URL;
    delete process.env.ZEROID_BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_ZEROID_API_URL;

    const mockProof = { proof: '0x' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    await POST(request);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('localhost:4000'),
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

  it('fails closed when production backend URL is not configured', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalZeroidEnv = process.env.ZEROID_ENV;
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.ZEROID_ENV;
    delete process.env.ZEROID_BACKEND_API_URL;

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Backend API URL is not configured for production');
    expect(mockFetch).not.toHaveBeenCalled();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalZeroidEnv === undefined) {
      delete process.env.ZEROID_ENV;
    } else {
      process.env.ZEROID_ENV = originalZeroidEnv;
    }
    if (originalServerEnv) {
      process.env.ZEROID_BACKEND_API_URL = originalServerEnv;
    }
  });

  it('fails closed when zeroid production mode lacks backend URL', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalZeroidEnv = process.env.ZEROID_ENV;
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    process.env.NODE_ENV = 'test';
    process.env.ZEROID_ENV = 'production';
    delete process.env.ZEROID_BACKEND_API_URL;

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Backend API URL is not configured for production');
    expect(mockFetch).not.toHaveBeenCalled();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalZeroidEnv === undefined) {
      delete process.env.ZEROID_ENV;
    } else {
      process.env.ZEROID_ENV = originalZeroidEnv;
    }
    if (originalServerEnv === undefined) {
      delete process.env.ZEROID_BACKEND_API_URL;
    } else {
      process.env.ZEROID_BACKEND_API_URL = originalServerEnv;
    }
  });

  it('fails closed when production backend URL targets a local address', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalZeroidEnv = process.env.ZEROID_ENV;
    const originalServerEnv = process.env.ZEROID_BACKEND_API_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.ZEROID_ENV;
    process.env.ZEROID_BACKEND_API_URL = 'https://127.0.0.1:4000';

    const request = new Request('http://localhost/api/proof/generate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validProofBody),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe(
      'Backend API URL must not target local or private hosts in production',
    );
    expect(mockFetch).not.toHaveBeenCalled();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalZeroidEnv === undefined) {
      delete process.env.ZEROID_ENV;
    } else {
      process.env.ZEROID_ENV = originalZeroidEnv;
    }
    if (originalServerEnv === undefined) {
      delete process.env.ZEROID_BACKEND_API_URL;
    } else {
      process.env.ZEROID_BACKEND_API_URL = originalServerEnv;
    }
  });
});

describe('POST /api/eligibility/proof', () => {
  let POST: (request: Request) => Promise<Response>;
  let validBody: Record<string, unknown>;
  const originalBackendEnv = process.env.ZEROID_BACKEND_API_URL;

  beforeAll(async () => {
    const route = await import('@/app/api/eligibility/proof/route');
    const model = await import('@/lib/eligibility/kycCredential');
    POST = route.POST as unknown as (request: Request) => Promise<Response>;
    validBody = model.createEligibilityProofRequest({
      subjectDid: 'did:aethelred:testnet:holder-1',
      credentialId: 'credential-test-1',
      relyingAppId: 'relying-app-test-1',
      contextNonce: 'context-nonce-test-001',
    });
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    if (originalBackendEnv === undefined) {
      delete process.env.ZEROID_BACKEND_API_URL;
    } else {
      process.env.ZEROID_BACKEND_API_URL = originalBackendEnv;
    }
  });

  it('requires authenticated backend evaluation in every runtime', async () => {
    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('ELIGIBILITY_BACKEND_AUTH_REQUIRED');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(response.headers.get('Vary')).toContain('Authorization');
  });

  it('returns 400 when required proof context is missing', async () => {
    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: validBody.credentialId,
        policyId: validBody.policyId,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('ELIGIBILITY_REQUEST_INVALID');
    expect(payload.details.missing).toEqual(
      expect.arrayContaining(['subjectDid', 'relyingAppId', 'contextNonce']),
    );
  });

  it('rejects weak eligibility nonces', async () => {
    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        contextNonce: 'short',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('ELIGIBILITY_REQUEST_INVALID');
    expect(payload.details.missing).toEqual(
      expect.arrayContaining(['contextNonce:minLength']),
    );
  });

  it('rejects non-boolean eligibility options after field validation passes', async () => {
    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validBody,
        options: {
          requireOnchainAttestation: 'false',
          dryRun: 'true',
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('ELIGIBILITY_REQUEST_INVALID');
    expect(payload.details.missing).toEqual(
      expect.arrayContaining([
        'options.requireOnchainAttestation:boolean',
        'options.dryRun:boolean',
      ]),
    );
  });

  it('returns an unavailable policy only when the backend reports it', async () => {
    process.env.ZEROID_BACKEND_API_URL = 'http://backend.zeroid.test';
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Requested policy is unavailable' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer prod-token',
      },
      body: JSON.stringify({
        ...validBody,
        policyId: 'zeroid://policy/unknown',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.code).toBe('ELIGIBILITY_BACKEND_ERROR');
    expect(payload.error).toBe('Requested policy is unavailable');
  });

  it('proxies every authenticated request to the backend endpoint', async () => {
    process.env.ZEROID_BACKEND_API_URL = 'http://backend.zeroid.test';
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            status: 'ALLOWED',
            policyId: validBody.policyId,
            policyVersion: '2026.06.1',
            subjectDid: validBody.subjectDid,
            credentialId: validBody.credentialId,
            relyingAppId: validBody.relyingAppId,
            proof: {
              proofId: 'zkp_backend',
              verified: true,
              groth16Proof: {
                pi_a: ['1', '2', '1'],
                pi_b: [
                  ['3', '4'],
                  ['5', '6'],
                  ['1', '0'],
                ],
                pi_c: ['7', '8', '1'],
                protocol: 'groth16',
                curve: 'bn128',
              },
              contextHash:
                '0x5bdba5e484eebe81a1c96024e2bddaf3ed174f120da6141ac40ee7db67162e49',
              manifestDigest:
                '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
              policyBindingDigest:
                '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
              publicSignals: {
                claimsHash:
                  '0x1111111111111111111111111111111111111111111111111111111111111111',
                ageThresholdYears: '18',
                residencyCountryCode: 'AE',
                currentTimestamp: '1782662400',
                policyVersionHash:
                  '0x3333333333333333333333333333333333333333333333333333333333333333',
                contextCommitment:
                  '0x5bdba5e484eebe81a1c96024e2bddaf3ed174f120da6141ac40ee7db67162e49',
              },
              disclosurePolicy: {
                rawFieldsDisclosed: [],
                publicSignals: [
                  'claimsHash',
                  'ageThresholdYears',
                  'residencyCountryCode',
                  'currentTimestamp',
                  'policyVersionHash',
                  'contextCommitment',
                ],
                provedPredicates: ['AGE_OVER_THRESHOLD', 'TEE_ATTESTED'],
                privateInputsRedacted: ['dobYear', 'dobMonth', 'dobDay'],
                disclosureBudget: {
                  rawFieldCount: 0,
                  publicSignalCount: 6,
                  provedPredicateCount: 2,
                  redactedPrivateInputCount: 3,
                },
              },
            },
            evidence: {
              auditLogId: 'audit-backend',
              receiptHash:
                '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              receiptHashAlgorithm: 'sha256-canonical-json-v1',
              manifestPath: 'circuits/manifest/eligibility_v1.json',
              manifestDigest:
                '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
              sourceDigest:
                '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3',
              policyBindingDigest:
                '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
              artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
            },
          },
          message: 'Eligibility proof evaluated successfully',
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer prod-token',
        'x-request-id': 'req-eligibility-1',
      },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.source).toBe('backend');
    expect(payload.data.evidence.auditLogId).toBe('audit-backend');
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(response.headers.get('Vary')).toContain('Authorization');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://backend.zeroid.test/api/v1/verification/eligibility-proof',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer prod-token',
          'X-Request-ID': 'req-eligibility-1',
        }),
        body: JSON.stringify(validBody),
      }),
    );
  });

  it('rejects a structurally valid proof that is bound to another request', async () => {
    process.env.ZEROID_BACKEND_API_URL = 'http://backend.zeroid.test';
    const backend = backendEligibilityReceiptResponse();
    Object.assign(backend.data, {
      subjectDid: 'did:aethelred:testnet:another-holder',
      credentialId: validBody.credentialId,
      policyId: validBody.policyId,
      policyVersion: '2026.06.1',
      relyingAppId: validBody.relyingAppId,
    });
    Object.assign(backend.data.proof, {
      verified: true,
      groth16Proof: {
        pi_a: ['1', '2', '1'],
        pi_b: [
          ['3', '4'],
          ['5', '6'],
          ['1', '0'],
        ],
        pi_c: ['7', '8', '1'],
        protocol: 'groth16',
        curve: 'bn128',
      },
      contextHash:
        '0x5bdba5e484eebe81a1c96024e2bddaf3ed174f120da6141ac40ee7db67162e49',
    });
    backend.data.proof.publicSignals.contextCommitment =
      '0x5bdba5e484eebe81a1c96024e2bddaf3ed174f120da6141ac40ee7db67162e49';
    Object.assign(backend.data.evidence, {
      artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(backend), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await POST(
      new Request('http://localhost/api/eligibility/proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer prod-token',
        },
        body: JSON.stringify(validBody),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe('ELIGIBILITY_BACKEND_CONTRACT_INVALID');
    expect(payload.details.violations).toContain('subjectDid:request_mismatch');
  });

  it('rejects backend eligibility responses that omit the disclosure contract', async () => {
    process.env.ZEROID_BACKEND_API_URL = 'http://backend.zeroid.test';
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            status: 'ALLOWED',
            proof: {
              proofId: 'zkp_backend',
              publicSignals: { policyVersion: '2026.06.1' },
            },
            evidence: {
              receiptHash:
                '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              receiptHashAlgorithm: 'sha256-canonical-json-v1',
            },
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const request = new Request('http://localhost/api/eligibility/proof', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer prod-token',
      },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe('ELIGIBILITY_BACKEND_CONTRACT_INVALID');
    expect(payload.details.violations).toEqual(
      expect.arrayContaining(['proof.disclosurePolicy:required']),
    );
  });
});

describe('GET /api/eligibility/proof/:receiptId', () => {
  let GET: (
    request: Request,
    context: { params: Promise<{ receiptId: string }> },
  ) => Promise<Response>;
  const originalBackendEnv = process.env.ZEROID_BACKEND_API_URL;

  beforeAll(async () => {
    const route = await import('@/app/api/eligibility/proof/[receiptId]/route');
    GET = route.GET as unknown as (
      request: Request,
      context: { params: Promise<{ receiptId: string }> },
    ) => Promise<Response>;
  });

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.ZEROID_BACKEND_API_URL = 'http://backend.zeroid.test';
  });

  afterAll(() => {
    if (originalBackendEnv === undefined) {
      delete process.env.ZEROID_BACKEND_API_URL;
    } else {
      process.env.ZEROID_BACKEND_API_URL = originalBackendEnv;
    }
  });

  it('requires bearer auth for durable eligibility receipt lookup', async () => {
    const request = new Request(
      'http://localhost/api/eligibility/proof/dec_testdecision',
      { method: 'GET' },
    );

    const response = await GET(request, {
      params: Promise.resolve({ receiptId: 'dec_testdecision' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('ELIGIBILITY_RECEIPT_AUTH_REQUIRED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed receipt ids before backend proxying', async () => {
    const request = new Request('http://localhost/api/eligibility/proof/..', {
      method: 'GET',
      headers: { Authorization: 'Bearer prod-token' },
    });

    const response = await GET(request, {
      params: Promise.resolve({ receiptId: '../bad' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('ELIGIBILITY_RECEIPT_ID_INVALID');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('proxies durable eligibility receipt lookup to the backend', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(backendEligibilityReceiptResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const request = new Request(
      'http://localhost/api/eligibility/proof/dec_testdecision',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer prod-token',
          'x-request-id': 'req-receipt-1',
        },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ receiptId: 'dec_testdecision' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.source).toBe('backend');
    expect(payload.data.decisionId).toBe('dec_testdecision');
    expect(payload.data.evidence.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(response.headers.get('Vary')).toContain('Authorization');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://backend.zeroid.test/api/v1/verification/eligibility-proof/dec_testdecision',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer prod-token',
          'X-Request-ID': 'req-receipt-1',
        }),
      }),
    );
  });

  it('rejects backend receipt responses that fail the evidence contract', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            status: 'ALLOWED',
            proof: { proofId: 'zkp_backend', publicSignals: {} },
            evidence: {
              receiptHash:
                '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              receiptHashAlgorithm: 'sha256-canonical-json-v1',
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const request = new Request(
      'http://localhost/api/eligibility/proof/dec_testdecision',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer prod-token' },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ receiptId: 'dec_testdecision' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe('ELIGIBILITY_RECEIPT_CONTRACT_INVALID');
    expect(payload.details.violations).toEqual(
      expect.arrayContaining(['proof.disclosurePolicy:required']),
    );
  });
});

function backendEligibilityReceiptResponse() {
  return {
    data: {
      verificationId: 'verification-1',
      status: 'ALLOWED',
      decisionId: 'dec_testdecision',
      policyId:
        'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1',
      policyVersion: '2026.06.1',
      credentialId: 'cred_kyc_v1_ae_000184',
      verifierId: 'subject-1',
      subjectId: 'subject-1',
      relyingAppId: 'edge-secure-data-room',
      proof: {
        proofId: 'zkp_backend',
        verified: true,
        groth16Proof: {
          pi_a: ['1', '2', '1'],
          pi_b: [
            ['3', '4'],
            ['5', '6'],
            ['1', '0'],
          ],
          pi_c: ['7', '8', '1'],
          protocol: 'groth16',
          curve: 'bn128',
        },
        circuitId: 'zkc_eligibility_policy_context_v1',
        circuitName: 'eligibility_policy_context_v1',
        verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
        manifestDigest:
          '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
        sourceDigest:
          '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3',
        policyBindingDigest:
          '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
        contextHash:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        publicSignals: {
          claimsHash:
            '0x1111111111111111111111111111111111111111111111111111111111111111',
          ageThresholdYears: '21',
          residencyCountryCode: 'AE',
          currentTimestamp: '1782662400',
          policyVersionHash:
            '0x3333333333333333333333333333333333333333333333333333333333333333',
          contextCommitment:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
        },
        privateInputsRedacted: ['dobYear', 'dobMonth', 'dobDay'],
        disclosurePolicy: {
          rawFieldsDisclosed: [],
          publicSignals: [
            'claimsHash',
            'ageThresholdYears',
            'residencyCountryCode',
            'currentTimestamp',
            'policyVersionHash',
            'contextCommitment',
          ],
          provedPredicates: ['AGE_OVER_THRESHOLD', 'TEE_ATTESTED'],
          privateInputsRedacted: ['dobYear', 'dobMonth', 'dobDay'],
          disclosureBudget: {
            rawFieldCount: 0,
            publicSignalCount: 6,
            provedPredicateCount: 2,
            redactedPrivateInputCount: 3,
          },
        },
      },
      evidence: {
        auditLogId: 'audit-backend',
        auditHash:
          '0x9999999999999999999999999999999999999999999999999999999999999999',
        receiptHash:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        receiptHashAlgorithm: 'sha256-canonical-json-v1',
        manifestPath: 'circuits/manifest/eligibility_v1.json',
        manifestDigest:
          '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
        sourceDigest:
          '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3',
        policyBindingDigest:
          '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
        artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
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
        onchainAttested: false,
        teeAttested: true,
      },
      deniedReasons: [],
      requestedAt: '2026-06-23T10:00:00.000Z',
      completedAt: '2026-06-23T10:00:01.000Z',
    },
    message: 'Eligibility proof receipt loaded successfully',
  };
}
