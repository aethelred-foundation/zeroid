import {
  buildSanctionsListSignaturePayload,
  SanctionsScreeningService,
  SanctionsListEntry,
  ScreeningRequest,
} from '../src/services/compliance/sanctions-screening';
import crypto from 'crypto';

const ORIGINAL_ENV = { ...process.env };

const listEntry: SanctionsListEntry = {
  id: 'ofac-1',
  names: ['Restricted Person'],
  programs: ['TEST'],
  listedDate: '2025-01-01',
  remarks: 'Fixture entry',
};

const request: ScreeningRequest = {
  entityId: 'entity-1',
  entityType: 'individual',
  names: [{ fullName: 'Restricted Person', nameType: 'primary', script: 'latin' }],
  identifiers: [],
  addresses: [],
  screenAgainst: ['ofac_sdn'],
};

function configureTrustedListKey(): crypto.KeyObject {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.SANCTIONS_LIST_SIGNATURE_PUBLIC_KEYS_JSON = JSON.stringify({
    'feed-key-1': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  return privateKey;
}

function signMetadata(
  privateKey: crypto.KeyObject,
  updatedAt = new Date().toISOString(),
  sourceDigest = 'a'.repeat(64),
) {
  const metadata = {
    updatedAt,
    sourceDigest,
    sourceName: 'test-feed',
    signingKeyId: 'feed-key-1',
  };
  return {
    ...metadata,
    signature: crypto
      .sign(null, Buffer.from(buildSanctionsListSignaturePayload('ofac_sdn', [listEntry], metadata)), privateKey)
      .toString('base64url'),
  };
}

describe('SanctionsScreeningService readiness', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows local screening against empty lists but marks them not ready', async () => {
    const service = new SanctionsScreeningService();

    const result = await service.screenEntity(request);

    expect(result.overallRisk).toBe('clear');
    expect(service.getListReadiness(['ofac_sdn'])).toEqual([
      expect.objectContaining({
        listName: 'ofac_sdn',
        ready: false,
        issues: ['empty', 'missing_metadata'],
      }),
    ]);
  });

  it('blocks production screening when requested lists are empty', async () => {
    process.env.NODE_ENV = 'production';
    const service = new SanctionsScreeningService();

    await expect(service.screenEntity(request)).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_NOT_READY',
    });
  });

  it('fails closed when sanctions screening is disabled', async () => {
    process.env.SANCTIONS_SCREENING_DISABLED = 'true';
    const service = new SanctionsScreeningService();

    await expect(service.screenEntity(request)).rejects.toMatchObject({
      code: 'SANCTIONS_SCREENING_DISABLED',
    });
  });

  it('requires source metadata for production updates', async () => {
    process.env.NODE_ENV = 'production';
    const service = new SanctionsScreeningService();

    await expect(service.onListUpdate('ofac_sdn', [listEntry])).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_METADATA_REQUIRED',
    });
  });

  it('screens in production after a fresh list update with source metadata', async () => {
    process.env.NODE_ENV = 'production';
    const privateKey = configureTrustedListKey();
    const service = new SanctionsScreeningService();

    await service.onListUpdate('ofac_sdn', [listEntry], signMetadata(privateKey));

    const result = await service.screenEntity(request);

    expect(result.overallRisk).toBe('potential_match');
    expect(result.matches).toEqual([
      expect.objectContaining({
        listSource: 'ofac_sdn',
        listEntryId: 'ofac-1',
        matchedName: 'Restricted Person',
      }),
    ]);
    expect(service.getListReadiness(['ofac_sdn'])).toEqual([
      expect.objectContaining({ ready: true, issues: [] }),
    ]);
  });

  it('blocks production screening when list metadata is stale', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SANCTIONS_LIST_MAX_AGE_HOURS = '1';
    const privateKey = configureTrustedListKey();
    const service = new SanctionsScreeningService();

    await service.onListUpdate(
      'ofac_sdn',
      [listEntry],
      signMetadata(privateKey, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), 'b'.repeat(64)),
    );

    await expect(service.screenEntity(request)).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_NOT_READY',
    });
    expect(service.getListReadiness(['ofac_sdn'])[0].issues).toContain('stale');
  });

  it('rejects tampered production list manifests', async () => {
    process.env.NODE_ENV = 'production';
    const privateKey = configureTrustedListKey();
    const service = new SanctionsScreeningService();
    const metadata = signMetadata(privateKey);

    await expect(
      service.onListUpdate('ofac_sdn', [{ ...listEntry, names: ['Tampered Person'] }], metadata),
    ).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_SIGNATURE_INVALID',
    });
  });
});
