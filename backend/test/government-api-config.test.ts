const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockIdentityUpdate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
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

import { GovernmentAPIService } from '../src/services/government-api';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

describe('GovernmentAPIService production configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockRedisGet.mockResolvedValue(null);
    mockIdentityFindUnique.mockResolvedValue(null);
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
    delete process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST;
    delete process.env.GOVERNMENT_REDIRECT_URI_ALLOWLIST;
  });

  afterEach(() => {
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

  it('rejects oversized UAE Pass token responses before parsing', async () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    process.env.UAE_PASS_API_URL = 'https://id.uaepass.ae';
    process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST = 'https://zeroid.example/callback';
    global.fetch = jest.fn().mockResolvedValueOnce(governmentResponse('{}', {
      'content-length': String(3 * 1024 * 1024),
    })) as unknown as typeof fetch;
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
  });

  it('evicts malformed Emirates ID cache entries before using them', async () => {
    process.env.EMIRATES_ID_API_URL = 'https://eid.gov.example';
    process.env.EMIRATES_ID_API_KEY = 'key-1';
    process.env.EMIRATES_ID_API_SECRET = 'secret-1';
    mockRedisGet.mockResolvedValueOnce('{bad-json');
    global.fetch = jest.fn().mockResolvedValueOnce(governmentResponse(JSON.stringify({
      verified: true,
      idNumber: '784-1990-1234567-1',
      fullName: 'Example Person',
      nationality: 'AE',
      expiryDate: '2030-01-01T00:00:00.000Z',
      status: 'VALID',
    }))) as unknown as typeof fetch;
    const service = new GovernmentAPIService();

    const result = await service.verifyEmiratesID({
      idNumber: '784-1990-1234567-1',
      dateOfBirth: '1990-01-01',
      identityId: 'identity-1',
    });

    expect(result.provider).toBe('EMIRATES_ID');
    expect(mockRedisDel).toHaveBeenCalledWith(expect.stringMatching(/^gov:eid:/));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed government verification status cache entries', async () => {
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

    expect(result?.provider).toBe('UAE_PASS');
    expect(mockRedisDel).toHaveBeenCalledWith('gov:verification:identity-1');
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
