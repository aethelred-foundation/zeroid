/**
 * /ready must report the identity registry verifier so an operator can tell
 * "registration answers 503 because the verifier is unconfigured" apart from
 * "the RPC is unreachable right now" without submitting a registration.
 */
import request from 'supertest';

const mockProbe = jest.fn();
const mockQueryRaw = jest.fn(async () => [{ '?column?': 1 }]);
const mockPing = jest.fn(async () => 'PONG');

jest.mock('ioredis', () =>
  jest.fn(() => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    ping: mockPing,
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(),
    on: jest.fn(),
    eval: jest.fn(async () => 1),
  })),
);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    $connect: jest.fn(async () => {}),
    $disconnect: jest.fn(async () => {}),
    $queryRaw: mockQueryRaw,
  })),
  IdentityStatus: { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', REVOKED: 'REVOKED' },
}));

jest.mock('prom-client', () => ({
  Registry: jest.fn(() => ({
    contentType: 'text/plain',
    metrics: jest.fn(async () => ''),
    registerMetric: jest.fn(),
  })),
  collectDefaultMetrics: jest.fn(),
  Counter: jest.fn(() => ({ inc: jest.fn() })),
  Histogram: jest.fn(() => ({ observe: jest.fn() })),
}));

jest.mock('../src/services/circuit-artifacts', () => ({
  ...jest.requireActual('../src/services/circuit-artifacts'),
  validateCircuitArtifacts: jest.fn(() => [{ artifactsReady: true }]),
}));

jest.mock('../src/lib/identity-registry-config', () => ({
  ...jest.requireActual('../src/lib/identity-registry-config'),
  probeIdentityRegistryReadiness: (...args: unknown[]) => mockProbe(...args),
}));

import app from '../src/index';

describe('GET /ready identity registry check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue('PONG');
  });

  it('reports ready when the verifier probe is ok', async () => {
    mockProbe.mockResolvedValue('ok');

    const response = await request(app).get('/ready').expect(200);

    expect(response.body.status).toBe('ready');
    expect(response.body.checks).toMatchObject({
      database: 'ok',
      redis: 'ok',
      identityRegistry: 'ok',
    });
    expect(mockProbe).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'degraded'])(
    'reports degraded (503) when the verifier probe answers %s',
    async (readiness) => {
      mockProbe.mockResolvedValue(readiness);

      const response = await request(app).get('/ready').expect(503);

      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.identityRegistry).toBe(readiness);
      expect(response.body.checks.database).toBe('ok');
    },
  );
});
