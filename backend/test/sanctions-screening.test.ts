import {
  buildSanctionsListSignaturePayload,
  SanctionsScreeningService,
  SanctionsListEntry,
  ScreeningRequest,
} from '../src/services/compliance/sanctions-screening';
import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ORIGINAL_ENV = { ...process.env };
const tempDirs: string[] = [];

function createTempStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroid-sanctions-screening-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

function enableProductionWithStore(): void {
  process.env.NODE_ENV = 'production';
  process.env.SANCTIONS_SCREENING_STORE_FILE = createTempStoreFile();
}

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

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
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
    enableProductionWithStore();
    const service = new SanctionsScreeningService();

    await expect(service.screenEntity(request)).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_NOT_READY',
    });
  });

  it('fails closed in production when durable screening storage is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SANCTIONS_SCREENING_STORE_FILE;
    const service = new SanctionsScreeningService();

    await expect(service.screenEntity(request)).rejects.toMatchObject({
      code: 'SANCTIONS_SCREENING_STORE_REQUIRED',
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
    enableProductionWithStore();
    const service = new SanctionsScreeningService();

    await expect(service.onListUpdate('ofac_sdn', [listEntry])).rejects.toMatchObject({
      code: 'SANCTIONS_LIST_METADATA_REQUIRED',
    });
  });

  it('screens in production after a fresh list update with source metadata', async () => {
    enableProductionWithStore();
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

  it('keeps screening results and match resolution scoped by organization', async () => {
    const service = new SanctionsScreeningService();
    service.updateSanctionsList('ofac_sdn', [listEntry]);

    const orgAResult = await service.screenEntity(request, 'org-a');
    const orgBResult = await service.screenEntity(request, 'org-b');
    const orgAMatch = orgAResult.matches[0];

    expect(orgAResult.organizationId).toBe('org-a');
    expect(orgBResult.organizationId).toBe('org-b');
    expect(service.getScreeningResult(orgAResult.screeningId, 'org-b')).toBeNull();
    expect(service.getEntityScreenings('entity-1', 'org-a')).toHaveLength(1);
    expect(service.getEntityScreenings('entity-1', 'org-b')).toHaveLength(1);

    await expect(
      service.resolveMatch({
        matchId: orgAMatch.matchId,
        decision: 'false_positive',
        reason: 'Attempt to resolve a match from a different organization',
        decidedBy: 'reviewer-b',
      }, 'org-b'),
    ).rejects.toMatchObject({
      code: 'SANCTIONS_MATCH_NOT_FOUND',
      statusCode: 404,
    });

    await service.resolveMatch({
      matchId: orgAMatch.matchId,
      decision: 'false_positive',
      reason: 'Reviewed against source documents and cleared',
      decidedBy: 'reviewer-a',
    }, 'org-a');

    expect(orgAResult.matches[0].status).toBe('false_positive');
    expect(orgAResult.overallRisk).toBe('clear');
    expect(orgBResult.matches[0].status).toBe('pending_review');
    expect(orgBResult.overallRisk).toBe('potential_match');
    expect(service.getAuditTrail(orgAResult.screeningId, 'org-a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'match_false_positive',
          organizationId: 'org-a',
        }),
      ]),
    );
    expect(service.getAuditTrail(orgAResult.screeningId, 'org-b')).toEqual([]);
  });

  it('recovers screening evidence and monitoring state from durable storage', async () => {
    const storeFile = createTempStoreFile();
    const writer = new SanctionsScreeningService({ storeFile });
    writer.updateSanctionsList('ofac_sdn', [listEntry]);

    const result = await writer.screenEntity(request, 'org-a');
    await writer.resolveMatch({
      matchId: result.matches[0].matchId,
      decision: 'false_positive',
      reason: 'Reviewed against source documents and cleared',
      decidedBy: 'reviewer-a',
    }, 'org-a');
    writer.enableContinuousMonitoring('entity-1', 'org-a');

    const reader = new SanctionsScreeningService({ storeFile });

    expect(reader.getListReadiness(['ofac_sdn'])).toEqual([
      expect.objectContaining({ listName: 'ofac_sdn', ready: true, issues: [] }),
    ]);
    expect(reader.getScreeningResult(result.screeningId, 'org-a')).toMatchObject({
      screeningId: result.screeningId,
      overallRisk: 'clear',
    });
    expect(reader.getAuditTrail(result.screeningId, 'org-a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'screening_completed' }),
        expect.objectContaining({ action: 'match_false_positive' }),
      ]),
    );

    const refreshed = await reader.onListUpdate('ofac_sdn', [listEntry]);
    expect(refreshed).toHaveLength(1);
    expect(reader.getEntityScreenings('entity-1', 'org-a')).toHaveLength(2);
  });

  it('re-screens continuously monitored entities after list updates', async () => {
    const service = new SanctionsScreeningService();
    service.updateSanctionsList('ofac_sdn', []);

    const initial = await service.screenEntity(request, 'org-a');
    expect(initial.overallRisk).toBe('clear');

    service.enableContinuousMonitoring('entity-1', 'org-a');

    const refreshed = await service.onListUpdate('ofac_sdn', [listEntry]);

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      organizationId: 'org-a',
      entityId: 'entity-1',
      overallRisk: 'potential_match',
    });
    expect(refreshed[0].screeningId).not.toBe(initial.screeningId);
    expect(service.getEntityScreenings('entity-1', 'org-a')).toHaveLength(2);
  });

  it('blocks production screening when list metadata is stale', async () => {
    enableProductionWithStore();
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

  it('rejects unsafe production sanctions list freshness windows', () => {
    process.env.NODE_ENV = 'production';
    process.env.SANCTIONS_LIST_MAX_AGE_HOURS = '168';

    expect(() => new SanctionsScreeningService()).toThrow(
      expect.objectContaining({ code: 'SANCTIONS_LIST_MAX_AGE_INVALID' }),
    );
  });

  it('rejects tampered production list manifests', async () => {
    enableProductionWithStore();
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
