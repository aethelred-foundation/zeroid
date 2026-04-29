const mockEval = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock('../src/index', () => ({
  redis: {
    eval: mockEval,
  },
  logger: {
    warn: mockWarn,
    error: mockError,
  },
}));

import { createRateLimiter } from '../src/middleware/rateLimit';

const ORIGINAL_ENV = { ...process.env };

function createMockHttp() {
  const req: any = {
    ip: '127.0.0.1',
    socket: {},
    headers: {},
    path: '/api/test',
  };
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    body: undefined,
    set: jest.fn((name: string, value: string) => {
      res.headers[name] = value;
      return res;
    }),
    status: jest.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows requests within the configured limit', async () => {
    mockEval.mockResolvedValue(1);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, res, next } = createMockHttp();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.headers['X-RateLimit-Limit']).toBe('2');
    expect(res.headers['X-RateLimit-Remaining']).toBe('1');
  });

  it('rejects requests over the configured limit', async () => {
    mockEval.mockResolvedValue(3);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, res, next } = createMockHttp();

    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('trusts forwarded client IP only from configured proxy peers', async () => {
    process.env.TRUSTED_PROXY = '10.0.0.5';
    mockEval.mockResolvedValue(1);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, next } = createMockHttp();
    req.ip = '10.0.0.5';
    req.socket.remoteAddress = '10.0.0.5';
    req.headers['x-forwarded-for'] = '203.0.113.44, 10.0.0.5';

    await limiter(req, createMockHttp().res, next);

    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      'rl:test:203.0.113.44',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('ignores spoofed forwarded client IP from untrusted peers', async () => {
    process.env.TRUSTED_PROXY = '10.0.0.5';
    mockEval.mockResolvedValue(1);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, next } = createMockHttp();
    req.ip = '198.51.100.9';
    req.socket.remoteAddress = '198.51.100.9';
    req.headers['x-forwarded-for'] = '203.0.113.44';

    await limiter(req, createMockHttp().res, next);

    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      'rl:test:198.51.100.9',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('fails open outside production when Redis returns an invalid count', async () => {
    mockEval.mockResolvedValue(null);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, res, next } = createMockHttp();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails closed in production when Redis returns an invalid count', async () => {
    process.env.NODE_ENV = 'production';
    mockEval.mockResolvedValue(null);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, res, next } = createMockHttp();

    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toMatchObject({ code: 'RATE_LIMIT_STORE_UNAVAILABLE' });
    expect(res.headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('fails closed in production when Redis throws', async () => {
    process.env.NODE_ENV = 'production';
    mockEval.mockImplementation(() => {
      throw new Error('redis unavailable');
    });
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, keyPrefix: 'rl:test' });
    const { req, res, next } = createMockHttp();

    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith('rate_limit_error', expect.objectContaining({
      error: 'redis unavailable',
    }));
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
