import { EnterpriseKeySigner } from '../src/services/enterprise/enterprise-key-signer';

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
