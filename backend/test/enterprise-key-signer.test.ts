import {
  assertAllowedEnterpriseKmsEndpoint,
  EnterpriseKeySigner,
} from '../src/services/enterprise/enterprise-key-signer';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

describe('EnterpriseKeySigner', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
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
