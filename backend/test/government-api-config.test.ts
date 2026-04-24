const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockIdentityUpdate = jest.fn();
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
  },
  prisma: {
    identity: {
      update: mockIdentityUpdate,
      findUnique: jest.fn(),
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

import { GovernmentAPIService } from '../src/services/government-api';

const ORIGINAL_ENV = { ...process.env };

describe('GovernmentAPIService production configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
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

  it('builds UAE Pass auth URLs from trusted production configuration', () => {
    process.env.UAE_PASS_CLIENT_ID = 'client-1';
    process.env.UAE_PASS_CLIENT_SECRET = 'secret-1';
    process.env.UAE_PASS_API_URL = 'https://id.uaepass.ae';
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
});
