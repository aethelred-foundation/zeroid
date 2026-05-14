import { EventEmitter } from 'events';
import * as https from 'https';
import { promises as dns } from 'dns';
import {
  assertAllowedEnterpriseKmsEndpoint,
  EnterpriseKeySigner,
} from '../src/services/enterprise/enterprise-key-signer';

jest.mock('https', () => ({
  ...jest.requireActual('https'),
  request: jest.fn(),
}));

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

describe('EnterpriseKeySigner', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
    (https.request as jest.Mock).mockReset();
    jest.restoreAllMocks();
  });

  it('adds bounded timeouts to GCP KMS signing calls', async () => {
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    const signature = Buffer.from('kms-signature');
    const fetchMock = jest.fn().mockResolvedValue(
      kmsResponse({
        signature: signature.toString('base64'),
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).resolves.toEqual(signature);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.signal).toBeDefined();
    expect((requestInit.signal as AbortSignal).aborted).toBe(false);
  });

  it('pins production GCP KMS signing calls to a vetted DNS address', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    global.fetch = jest.fn() as unknown as typeof fetch;
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);

    const signature = Buffer.from('kms-signature');
    const requestSpy = mockHttpsJsonResponse({
      signature: signature.toString('base64'),
    });

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).resolves.toEqual(signature);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(dns.lookup).toHaveBeenCalledWith('cloudkms.googleapis.com', {
      all: true,
      verbatim: true,
    });

    const requestOptions = requestSpy.mock.calls[0][1] as {
      lookup: (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void;
      servername: string;
    };
    const lookupCallback = jest.fn();
    requestOptions.lookup('cloudkms.googleapis.com', {}, lookupCallback);
    expect(lookupCallback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(requestOptions.servername).toBe('cloudkms.googleapis.com');
  });

  it('uses ZeroID production runtime for KMS DNS pinning', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ZEROID_ENV = 'production';
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    global.fetch = jest.fn() as unknown as typeof fetch;
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.4.4', family: 4 }] as any);

    const signature = Buffer.from('kms-signature');
    mockHttpsJsonResponse({
      signature: signature.toString('base64'),
    });

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).resolves.toEqual(signature);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(dns.lookup).toHaveBeenCalledWith('cloudkms.googleapis.com', {
      all: true,
      verbatim: true,
    });
  });

  it('blocks local signing under ZeroID production runtime', () => {
    process.env.NODE_ENV = 'test';
    process.env.ZEROID_ENV = 'production';

    expect(() =>
      new EnterpriseKeySigner({
        provider: 'local',
        keyId: 'local-key',
        defaultVerificationMethod: 'did:aethelred:test#key-1',
      }),
    ).toThrow(expect.objectContaining({ code: 'SIGNING_LOCAL_BLOCKED' }));
  });

  it('rejects production KMS endpoints that resolve to private addresses', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    const requestMock = https.request as jest.Mock;
    requestMock.mockImplementation(() => {
      throw new Error('https.request should not be called for unsafe KMS resolution');
    });

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).rejects.toMatchObject({
      code: 'SIGNING_KMS_CONFIG_MISSING',
      statusCode: 500,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects oversized GCP KMS signing responses before parsing', async () => {
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    const fetchMock = jest.fn().mockResolvedValue(
      kmsResponse({}, {
        'content-length': String(2 * 1024 * 1024),
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).rejects.toMatchObject({
      code: 'SIGNING_KMS_SIGN_FAILED',
      statusCode: 502,
    });
  });

  it('rejects malformed GCP KMS signing responses before using them', async () => {
    process.env.GCP_ACCESS_TOKEN = 'gcp-access-token';
    global.fetch = jest.fn().mockResolvedValue(
      kmsResponse({ signature: '' }),
    ) as unknown as typeof fetch;

    const signer = new EnterpriseKeySigner({
      provider: 'gcp-kms',
      keyId: 'projects/p/locations/global/keyRings/r/cryptoKeys/k',
      keyVersion: '1',
      defaultVerificationMethod: 'did:aethelred:test#key-1',
    });

    await expect(signer.sign(Buffer.from('message'))).rejects.toMatchObject({
      code: 'SIGNING_KMS_SIGN_FAILED',
      statusCode: 502,
    });
  });

  it('allowlists only official KMS and metadata endpoints', () => {
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'https://cloudkms.googleapis.com/v1/projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1:asymmetricSign',
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'https://tenant-vault.vault.azure.net/keys/key-1/1/sign?api-version=7.4',
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2019-08-01&resource=https://vault.azure.net',
      ),
    ).not.toThrow();

    expect(() =>
      assertAllowedEnterpriseKmsEndpoint('https://kms.internal.local/sign'),
    ).toThrow(expect.objectContaining({ code: 'SIGNING_KMS_CONFIG_MISSING' }));
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'http://metadata.google.internal.evil.example/computeMetadata/v1/instance/service-accounts/default/token',
      ),
    ).toThrow(expect.objectContaining({ code: 'SIGNING_KMS_CONFIG_MISSING' }));
    expect(() =>
      assertAllowedEnterpriseKmsEndpoint(
        'https://user:pass@cloudkms.googleapis.com/v1/projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1:asymmetricSign',
      ),
    ).toThrow(expect.objectContaining({ code: 'SIGNING_KMS_CONFIG_MISSING' }));
  });
});

function kmsResponse(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  });
}

function mockHttpsJsonResponse(
  body: Record<string, unknown>,
  status = 200,
): jest.Mock {
  const requestMock = https.request as jest.Mock;
  requestMock.mockImplementation(
    (_url: any, _options: any, callback?: (response: any) => void) => {
      const request = new EventEmitter() as EventEmitter & {
        write: jest.Mock;
        end: jest.Mock;
        destroy: jest.Mock;
      };
      request.write = jest.fn();
      request.destroy = jest.fn((error?: Error) => {
        if (error) request.emit('error', error);
      });
      request.end = jest.fn(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = status;
        response.headers = { 'content-type': 'application/json' };
        callback?.(response);
        response.emit('data', Buffer.from(JSON.stringify(body)));
        response.emit('end');
      });
      return request as unknown as ReturnType<typeof https.request>;
    },
  );
  return requestMock;
}
