const routeRegistry: Record<string, Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>> = {};

const mockExportCredentialEvidence = jest.fn();

jest.mock('express', () => {
  const createRouter = () => {
    const router: any = {
      use: jest.fn(() => router),
      get: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`GET ${path}`] = handlers;
        return router;
      }),
      post: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
        routeRegistry[`POST ${path}`] = handlers;
        return router;
      }),
    };
    return router;
  };

  return {
    Router: jest.fn(() => createRouter()),
  };
}, { virtual: true });

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  credentialIssuanceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    exportCredentialEvidence: mockExportCredentialEvidence,
  },
}));

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: jest.fn(),
    },
  },
}));

import '../src/routes/credentials';

async function invokeRoute(
  method: 'GET',
  path: string,
  options: { params?: Record<string, string>; identityId?: string } = {},
): Promise<{ statusCode: number; body: any }> {
  const handlers = routeRegistry[`${method} ${path}`];
  if (!handlers) {
    throw new Error(`Route not registered: ${method} ${path}`);
  }

  const req: Record<string, any> = {
    params: options.params ?? {},
    query: {},
    body: {},
    path,
    method,
    headers: {},
    identity: {
      id: options.identityId ?? 'issuer-1',
      did: 'did:aethelred:test:actor',
      publicKey: 'pub',
      status: 'ACTIVE',
    },
  };

  let statusCode = 200;
  let responseBody: any;
  let ended = false;

  const res: Record<string, any> = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      responseBody = payload;
      ended = true;
      return res;
    },
  };

  for (const handler of handlers) {
    if (ended) break;
    await new Promise<void>((resolve, reject) => {
      let nextCalled = false;
      const next = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      try {
        const result = handler(req, res, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(() => {
            if (!nextCalled) resolve();
          }).catch(reject);
          return;
        }
        if (!nextCalled) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  return { statusCode, body: responseBody };
}

describe('credential evidence routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExportCredentialEvidence.mockResolvedValue({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      exportedAt: '2026-04-21T00:00:00.000Z',
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        credentialType: 'KYC_LEVEL_2',
        issuerId: 'issuer-1',
        subjectId: 'subject-1',
        claims: { level: 'enhanced' },
        claimsHash: 'hash',
        proof: { signatureValue: 'sig' },
        status: 'ACTIVE',
        issuedAt: '2026-04-21T00:00:00.000Z',
        expiresAt: '2027-04-21T00:00:00.000Z',
      },
      verification: {
        valid: true,
        checks: {
          statusActive: true,
          signatureValid: true,
        },
      },
      issuer: {
        identityId: 'issuer-1',
        did: 'did:aethelred:issuer:alpha',
      },
      subject: {
        identityId: 'subject-1',
        did: 'did:aethelred:user:alice',
      },
      trustLineage: {
        enforced: true,
        selectedTrustRecordId: 'trust-1',
        evaluatedJurisdictions: ['UAE'],
        matchedJurisdictions: ['UAE'],
      },
    });
  });

  it('returns the full evidence bundle to the issuer', async () => {
    const response = await invokeRoute('GET', '/:id/evidence', {
      params: { id: '11111111-1111-1111-1111-111111111111' },
      identityId: 'issuer-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      credential: expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        claims: { level: 'enhanced' },
        proof: { signatureValue: 'sig' },
      }),
      trustLineage: expect.objectContaining({
        selectedTrustRecordId: 'trust-1',
      }),
    });
  });

  it('sanitizes credential claims and proof for non-owner verifiers', async () => {
    const response = await invokeRoute('GET', '/:id/evidence', {
      params: { id: '11111111-1111-1111-1111-111111111111' },
      identityId: 'verifier-9',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      credential: {
        id: '11111111-1111-1111-1111-111111111111',
        credentialType: 'KYC_LEVEL_2',
        status: 'ACTIVE',
      },
      trustLineage: expect.objectContaining({
        enforced: true,
      }),
    });
    expect(response.body.data.credential.claims).toBeUndefined();
    expect(response.body.data.credential.proof).toBeUndefined();
  });
});
