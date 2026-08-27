import { promises as dns } from 'dns';
import { EventEmitter } from 'events';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const httpsRequestMock = jest.fn();
let dnsLookupSpy: jest.SpyInstance;

describe('TEE production configuration', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      INTEL_PCS_API_KEY: 'pcs-key-1',
      TEE_DCAP_API_URL: 'https://10.0.0.5',
    };
    dnsLookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
    ] as never);
    httpsRequestMock.mockReset();

    jest.doMock('https', () => ({
      request: httpsRequestMock,
    }));

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

    jest.doMock('../src/runtime', () => {
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
          $transaction: jest.fn((operations) => Promise.all(operations)),
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
    dnsLookupSpy.mockRestore();
    jest.dontMock('https');
    jest.dontMock('prom-client');
    jest.dontMock('../src/runtime');
    jest.resetModules();
    global.fetch = ORIGINAL_FETCH;
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

  it('requires exact enclave allowlist policy in production', () => {
    process.env.TEE_DCAP_API_URL = 'https://collateral.example.com';
    process.env.TRUSTED_MRSIGNERS = 'a'.repeat(64);
    process.env.TEE_ALLOWED_ENCLAVES_JSON = '';

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService() as any;

    expect(() => service.verifyEnclavePolicy({
      mrenclave: 'b'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 1,
      isvSvn: 1,
    })).toThrow(expect.objectContaining({
      code: 'TEE_NO_TRUSTED_ENCLAVES',
    }));
  });

  it('enforces mrenclave, product id, signer, and per-enclave SVN policy', () => {
    process.env.TEE_DCAP_API_URL = 'https://collateral.example.com';
    process.env.TRUSTED_MRSIGNERS = 'a'.repeat(64);
    process.env.TEE_ALLOWED_ENCLAVES_JSON = JSON.stringify([
      {
        mrenclave: 'b'.repeat(64),
        mrsigner: 'a'.repeat(64),
        isvProdId: 7,
        minIsvSvn: 3,
      },
    ]);

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService() as any;

    expect(() => service.verifyEnclavePolicy({
      mrenclave: 'c'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 7,
      isvSvn: 3,
    })).toThrow(expect.objectContaining({
      code: 'TEE_UNTRUSTED_ENCLAVE',
    }));

    expect(() => service.verifyEnclavePolicy({
      mrenclave: 'b'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 8,
      isvSvn: 3,
    })).toThrow(expect.objectContaining({
      code: 'TEE_ENCLAVE_POLICY_MISMATCH',
    }));

    expect(() => service.verifyEnclavePolicy({
      mrenclave: 'b'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 7,
      isvSvn: 2,
    })).toThrow(expect.objectContaining({
      code: 'TEE_ENCLAVE_SVN_TOO_LOW',
    }));

    expect(() => service.verifyEnclavePolicy({
      mrenclave: 'b'.repeat(64),
      mrsigner: 'a'.repeat(64),
      isvProdId: 7,
      isvSvn: 3,
    })).not.toThrow();
  });

  it('rejects oversized collateral responses before parsing them', async () => {
    process.env.TEE_DCAP_API_URL = 'https://collateral.example.com';

    mockCollateralHttpsResponses([
      {
        body: 'unused',
        headers: { 'content-length': String(9 * 1024 * 1024) },
      },
      { body: 'root-crl' },
      {
        body: '{}',
        headers: {
          'sgx-tcb-info-issuer-chain': 'chain',
          'sgx-tcb-info-signature': 'signature',
        },
      },
      {
        body: '{}',
        headers: {
          'sgx-enclave-identity-issuer-chain': 'chain',
          'sgx-enclave-identity-signature': 'signature',
        },
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService();

    await expect(
      (service as any).fetchCollateralFromPCS('00906ea10000'),
    ).rejects.toMatchObject({
      code: 'TEE_COLLATERAL_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).toHaveBeenCalledTimes(4);
  });

  it('blocks collateral fetches when the provider resolves privately in production', async () => {
    process.env.TEE_DCAP_API_URL = 'https://collateral.example.com';
    dnsLookupSpy.mockResolvedValueOnce([
      { address: '10.0.0.9', family: 4 },
    ] as never);
    const fetchMock = jest.fn().mockResolvedValue(collateralResponse('unused'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService();

    await expect(
      (service as any).fetchCollateralFromPCS('00906ea10000'),
    ).rejects.toMatchObject({
      code: 'TEE_COLLATERAL_PROVIDER_UNSAFE_RESOLUTION',
      statusCode: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('pins vetted DNS address during production collateral fetches', async () => {
    process.env.TEE_DCAP_API_URL = 'https://collateral.example.com';
    const capturedOptions: Array<{
      url: URL;
      options: { servername?: string; lookup?: unknown };
    }> = [];
    mockCollateralHttpsResponses(
      [
        { body: 'pck-crl', headers: { 'sgx-pck-crl-issuer-chain': 'pck-chain' } },
        { body: 'root-crl' },
        {
          body: '{}',
          headers: {
            'sgx-tcb-info-issuer-chain': 'tcb-chain',
            'sgx-tcb-info-signature': 'tcb-signature',
          },
        },
        {
          body: '{}',
          headers: {
            'sgx-enclave-identity-issuer-chain': 'qe-chain',
            'sgx-enclave-identity-signature': 'qe-signature',
          },
        },
      ],
      (url, options) => capturedOptions.push({ url, options }),
    );
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { TEEAttestationService } = require('../src/services/tee');
    const service = new TEEAttestationService();

    const collateral = await (service as any).fetchCollateralFromPCS('00906ea10000');

    expect(collateral).toMatchObject({
      pckCrl: 'pck-crl',
      pckCrlIssuerChain: 'pck-chain',
      rootCaCrl: 'root-crl',
      tcbInfo: '{}',
      tcbInfoSignature: 'tcb-signature',
      tcbSigningCertChain: 'tcb-chain',
      qeIdentity: '{}',
      qeIdentitySignature: 'qe-signature',
      qeIdentitySigningCertChain: 'qe-chain',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).toHaveBeenCalledTimes(4);
    expect(capturedOptions.map(({ url }) => url.pathname + url.search)).toEqual([
      '/pckcrl?ca=processor',
      '/rootcacrl',
      '/tcb?fmspc=00906ea10000',
      '/qe/identity',
    ]);
    expect(capturedOptions.every(({ options }) => options.servername === 'collateral.example.com')).toBe(true);

    const lookup = capturedOptions[0].options.lookup as any;
    await new Promise<void>((resolve, reject) => {
      lookup('collateral.example.com', {}, (err: Error | null, address: string, family: number) => {
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
});

function collateralResponse(
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

function mockCollateralHttpsResponses(
  responses: Array<{
    body: string;
    statusCode?: number;
    headers?: Record<string, string>;
  }>,
  onRequest?: (
    url: URL,
    options: { servername?: string; lookup?: unknown },
  ) => void,
): void {
  httpsRequestMock.mockImplementation(
    (url: URL, options: { servername?: string; lookup?: unknown }, callback: (response: any) => void) => {
      const responseSpec = responses.shift();
      if (!responseSpec) {
        throw new Error(`Unexpected TEE collateral request to ${url.href}`);
      }

      const request = new EventEmitter() as any;
      request.end = jest.fn(() => {
        onRequest?.(url, options);
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
}
