const ORIGINAL_ENV = { ...process.env };

describe('TEE production configuration', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      INTEL_PCS_API_KEY: 'pcs-key-1',
      TEE_DCAP_API_URL: 'https://10.0.0.5',
    };

    jest.doMock('prom-client', () => {
      const Metric = jest.fn().mockImplementation(() => ({
        inc: jest.fn(),
        observe: jest.fn(),
      }));
      return {
        Counter: Metric,
        Histogram: Metric,
        Registry: jest.fn().mockImplementation(() => ({
          registerMetric: jest.fn(),
        })),
      };
    });

    jest.doMock('../src/index', () => {
      const { Registry } = require('prom-client');
      return {
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        },
        redis: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1),
        },
        prisma: {
          identity: {
            update: jest.fn().mockResolvedValue({}),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        },
        metricsRegistry: new Registry(),
      };
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  afterEach(() => {
    jest.dontMock('prom-client');
    jest.dontMock('../src/index');
    jest.resetModules();
    process.env = ORIGINAL_ENV;
  });

  it('blocks private collateral provider URLs at runtime in production', async () => {
    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService();

    await expect(service.verifyAttestation({
      identityId: 'identity-1',
      did: 'did:aethelred:test:identity-1',
      publicKey: 'public-key',
      enclaveType: 'SGX',
      quote: Buffer.from([0]).toString('base64'),
    })).rejects.toMatchObject({
      code: 'TEE_COLLATERAL_PROVIDER_UNSAFE',
      statusCode: 503,
    });
  });

  it('blocks IPv4-mapped private collateral provider URLs at runtime in production', async () => {
    process.env.TEE_DCAP_API_URL = 'https://[::ffff:0a00:0005]';

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService();

    await expect(service.verifyAttestation({
      identityId: 'identity-1',
      did: 'did:aethelred:test:identity-1',
      publicKey: 'public-key',
      enclaveType: 'SGX',
      quote: Buffer.from([0]).toString('base64'),
    })).rejects.toMatchObject({
      code: 'TEE_COLLATERAL_PROVIDER_UNSAFE',
      statusCode: 503,
    });
  });
});
