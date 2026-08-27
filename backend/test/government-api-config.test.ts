import { promises as dns } from 'dns';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import * as https from 'https';

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockIdentityUpdate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
  prisma: {
    identity: {
      update: mockIdentityUpdate,
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

jest.mock('https', () => ({
  request: jest.fn(),
}));

import { GovernmentAPIService } from '../src/services/government-api';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
let dnsLookupSpy: jest.SpyInstance;

describe('GovernmentAPIService production configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue(null);
    mockIdentityFindUnique.mockResolvedValue(null);
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
    process.env.GOVERNMENT_CACHE_HASH_PEPPER = 'g'.repeat(64);
    delete process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST;
    delete process.env.GOVERNMENT_REDIRECT_URI_ALLOWLIST;
    dnsLookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
    ] as never);
  });

  afterEach(() => {
    dnsLookupSpy.mockRestore();
    (https.request as jest.Mock).mockReset();
    global.fetch = ORIGINAL_FETCH;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('blocks UAE Pass auth URL generation when production credentials are missing', () => {
    const service = new GovernmentAPIService();

    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_CONFIG_MISSING' }),
    );
  });

  it('blocks UAE Pass staging endpoints in production', () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    const service = new GovernmentAPIService();

    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );
  });

  it('blocks UAE Pass private and credentialed endpoints in production', () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    const service = new GovernmentAPIService();

    process.env.UAE_PASS_API_URL = 'https://10.0.0.5';
    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );

    process.env.UAE_PASS_API_URL = 'https://100.64.0.5';
    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );

    process.env.UAE_PASS_API_URL = 'https://metadata.google.internal';
    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );

    process.env.UAE_PASS_API_URL = 'https://[::ffff:0a00:0005]';
    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );

    process.env.UAE_PASS_API_URL = 'https://user:pass@id.uaepass.ae';
    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_ENDPOINT_UNSAFE' }),
    );
  });

  it('requires UAE Pass redirect URIs to be production allowlisted', () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    process.env.UAE_PASS_API_URL = 'https://id.uaepass.ae';
    const service = new GovernmentAPIService();

    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_REDIRECT_URI_ALLOWLIST_MISSING' }),
    );

    process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST = 'https://zeroid.example/callback';
    expect(() => service.getUAEPassAuthUrl('https://evil.example/callback', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_REDIRECT_URI_UNTRUSTED' }),
    );

    expect(() => service.getUAEPassAuthUrl('https://zeroid.example/callback#token', 'state-1')).toThrow(
      expect.objectContaining({ code: 'GOV_UAEPASS_REDIRECT_URI_UNSAFE' }),
    );
  });

  it('builds UAE Pass auth URLs from trusted production configuration', () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    process.env.UAE_PASS_API_URL = 'https://id.uaepass.ae';
    process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST = 'https://zeroid.example/callback';
    const service = new GovernmentAPIService();

    const authUrl = new URL(service.getUAEPassAuthUrl('https://zeroid.example/callback', 'state-1'));

    expect(authUrl.origin).toBe('https://id.uaepass.ae');
    expect(authUrl.searchParams.get('client_id')).toBe('client-1');
    expect(authUrl.searchParams.get('state')).toBe('state-1');
  });

  it('blocks Emirates ID verification when production API credentials are missing', async () => {
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_EID_CONFIG_MISSING',
      statusCode: 503,
    });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('blocks Emirates ID non-HTTPS endpoints in production', async () => {
    process.env.EMIRATES_ID_API_URL = 'http://localhost:9000';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_EID_ENDPOINT_UNSAFE',
      statusCode: 503,
    });
  });

  it('blocks Emirates ID private endpoints in production', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://192.168.1.10';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_EID_ENDPOINT_UNSAFE',
      statusCode: 503,
    });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('blocks Emirates ID IPv4-mapped private endpoints in production', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://[::ffff:0a00:0005]';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_EID_ENDPOINT_UNSAFE',
      statusCode: 503,
    });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('blocks Emirates ID verification when a trusted endpoint resolves privately', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    dnsLookupSpy.mockResolvedValueOnce([
      { address: '10.0.0.9', family: 4 },
    ] as never);
    global.fetch = jest.fn().mockResolvedValueOnce(governmentResponse(JSON.stringify({
      verified: true,
    }))) as unknown as typeof fetch;
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_EID_ENDPOINT_UNSAFE_RESOLUTION',
      statusCode: 503,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('requires a government cache hash pepper in production', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    delete process.env.GOVERNMENT_CACHE_HASH_PEPPER;
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new GovernmentAPIService();

    await expect(service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_CACHE_HASH_PEPPER_MISSING',
      statusCode: 500,
    });
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('pins vetted DNS address during Emirates ID verification', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    global.fetch = jest.fn() as unknown as typeof fetch;
    let capturedOptions: https.RequestOptions | undefined;
    let capturedBody = '';
    mockGovernmentHttpsResponses(
      [
        {
          body: JSON.stringify({
            verified: true,
            idNumber: '784-1990-1234567-1',
            fullName: 'Example Person',
            nationality: 'AE',
            expiryDate: '2030-01-01T00:00:00.000Z',
            status: 'VALID',
          }),
        },
      ],
      (url, options, body) => {
        expect(url.href).toBe('https://eid.gov.example/identity/verify');
        capturedOptions = options;
        capturedBody = body;
      },
    );
    const service = new GovernmentAPIService();

    const result = await service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    });

    expect(result.provider).toBe('EMIRATES_ID');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(capturedBody).toContain('"idNumber":"784-1990-1234567-1"');
    expect(capturedOptions?.servername).toBe('eid.gov.example');
    expect(capturedOptions?.lookup).toEqual(expect.any(Function));

    const lookup = capturedOptions!.lookup as any;
    await new Promise<void>((resolve, reject) => {
      lookup('eid.gov.example', {}, (err: Error | null, address: string, family: number) => {
        try {
          expect(err).toBeNull();
          expect(address).toBe('8.8.8.8');
          expect(family).toBe(4);
          resolve();
        } catch (lookupErr) {
          reject(lookupErr);
        }
      });
    });
  });

  it('rejects oversized UAE Pass token responses before parsing', async () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    process.env.UAE_PASS_API_URL = 'https://id.uaepass.ae';
    process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST = 'https://zeroid.example/callback';
    global.fetch = jest.fn() as unknown as typeof fetch;
    mockGovernmentHttpsResponses([
      {
        body: '{}',
        headers: { 'content-length': String(3 * 1024 * 1024) },
      },
    ]);
    const service = new GovernmentAPIService();

    await expect(service.authenticateWithUAEPass({
      authorizationCode: 'auth-code-1',
      redirectUri: 'https://zeroid.example/callback',
      identityId: 'identity-1',
    })).rejects.toMatchObject({
      code: 'GOV_RESPONSE_TOO_LARGE',
      statusCode: 502,
    });
    expect(mockIdentityUpdate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('evicts malformed Emirates ID cache entries before using them', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    mockRedisGet.mockResolvedValueOnce('{bad-json');
    global.fetch = jest.fn() as unknown as typeof fetch;
    mockGovernmentHttpsResponses([
      {
        body: JSON.stringify({
          verified: true,
          idNumber: '784-1990-1234567-1',
          fullName: 'Example Person',
          nationality: 'AE',
          expiryDate: '2030-01-01T00:00:00.000Z',
          status: 'VALID',
        }),
      },
    ]);
    const service = new GovernmentAPIService();

    const result = await service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    });

    expect(result.provider).toBe('EMIRATES_ID');
    expect(mockRedisDel).toHaveBeenCalledWith(expect.stringMatching(/^gov:eid:/));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it('fails closed on malformed identity-scoped government verification status cache entries', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-1',
      verifiedFields: ['idNumber'],
      verifiedAt: 'not-a-date',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }));
    mockIdentityFindUnique.mockResolvedValueOnce({
      governmentVerified: true,
      governmentRefId: 'uaepass-ref-1',
    });
    const service = new GovernmentAPIService();

    const result = await service.getVerificationStatus('identity-1');

    expect(result).toBeNull();
    expect(mockRedisDel).toHaveBeenCalledWith('gov:verification:identity-1');
    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
  });

  it('binds Emirates ID cache hits to date of birth and identity-scoped status', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({
      verified: true,
      provider: 'EMIRATES_ID',
      referenceId: 'eid-cached-status',
      verifiedFields: ['idNumber', 'expiryDate'],
      verifiedAt: '2026-04-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }));
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new GovernmentAPIService();

    const result = await service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    });

    const fullInputHash = crypto
      .createHmac('sha256', process.env.GOVERNMENT_CACHE_HASH_PEPPER!)
      .update('zeroid:government-verification-cache:v2:')
      .update('784-1990-1234567-1:1990-01-01')
      .digest('hex');
    const idOnlyHash = crypto
      .createHmac('sha256', process.env.GOVERNMENT_CACHE_HASH_PEPPER!)
      .update('zeroid:government-verification-cache:v2:')
      .update('784-1990-1234567-1')
      .digest('hex');

    expect(mockRedisGet).toHaveBeenCalledWith(`gov:eid:${fullInputHash}`);
    expect(mockRedisGet).not.toHaveBeenCalledWith(`gov:eid:${idOnlyHash}`);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.referenceId).toMatch(/^eid-/);
    expect(result.referenceId).not.toBe('eid-cached-status');
    expect(mockIdentityUpdate).toHaveBeenCalledWith({
      where: { id: 'identity-1' },
      data: {
        governmentVerified: true,
        governmentRefId: result.referenceId,
      },
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'gov:verification:identity-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });
});

function governmentResponse(
  body: string,
  headers: Record<string, string> = {},
): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    ok: true,
    status: 200,
    headers: {
      get: jest.fn(
        (name: string) => normalizedHeaders[name.toLowerCase()] ?? null,
      ),
    },
    body: null,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function mockGovernmentHttpsResponses(
  responses: Array<{
    body: string;
    statusCode?: number;
    headers?: Record<string, string>;
  }>,
  onRequest?: (url: URL, options: https.RequestOptions, body: string) => void,
): jest.Mock {
  const httpsRequestMock = https.request as jest.Mock;
  httpsRequestMock.mockImplementation(
    (url: URL, options: https.RequestOptions, callback: (response: any) => void) => {
      const responseSpec = responses.shift();
      if (!responseSpec) {
        throw new Error(`Unexpected government HTTPS request to ${url.href}`);
      }

      let requestBody = '';
      const request = new EventEmitter() as any;
      request.write = jest.fn((chunk: string | Buffer) => {
        requestBody += chunk.toString();
        return true;
      });
      request.end = jest.fn(() => {
        onRequest?.(url, options, requestBody);
        const response = new EventEmitter() as any;
        response.statusCode = responseSpec.statusCode ?? 200;
        response.headers = responseSpec.headers ?? {};
        process.nextTick(() => {
          callback(response);
          response.emit('data', responseSpec.body);
          response.emit('end');
        });
      });
      request.destroy = jest.fn((err?: Error) => {
        if (err) request.emit('error', err);
      });
      return request;
    },
  );
  return httpsRequestMock;
}
