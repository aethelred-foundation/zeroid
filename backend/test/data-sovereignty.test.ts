import { DataSovereigntyService } from '../src/services/compliance/data-sovereignty';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DataSovereigntyService sovereign guardrails', () => {
  let service: DataSovereigntyService;
  const tempDirs: string[] = [];

  const createTempStoreFile = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroid-data-sovereignty-'));
    tempDirs.push(dir);
    return path.join(dir, 'state.json');
  };

  beforeEach(() => {
    service = new DataSovereigntyService();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('allows storage only when the exact residency rule is satisfied', () => {
    expect(
      service.enforceResidency('AE-CBUAE', 'personal', 'me-central-1'),
    ).toMatchObject({
      compliant: true,
      requiredRegion: 'me-central-1',
      encryptionRequired: true,
      encryptionStandard: 'AES-256-GCM',
      violations: [],
    });

    expect(
      service.enforceResidency('AE-CBUAE', 'personal', 'us-east-1'),
    ).toMatchObject({
      compliant: false,
      requiredRegion: 'me-central-1',
      violations: ['Data must be stored in me-central-1, not us-east-1'],
    });
  });

  it('fails closed when a known jurisdiction lacks a category-specific residency rule', () => {
    const result = service.enforceResidency(
      'AE-CBUAE',
      'credential',
      'us-east-1',
    );

    expect(result).toMatchObject({
      compliant: false,
      requiredRegion: 'me-central-1',
      encryptionRequired: true,
      encryptionStandard: 'AES-256-GCM',
    });
    expect(result.violations[0]).toContain(
      'No residency rule configured for credential data under AE-CBUAE',
    );
  });

  it('fails closed when a residency jurisdiction is not configured', () => {
    const result = service.enforceResidency(
      'ZZ-UNKNOWN',
      'personal',
      'us-east-1',
    );

    expect(result).toMatchObject({
      compliant: false,
      requiredRegion: null,
      encryptionRequired: true,
      encryptionStandard: 'AES-256-GCM',
    });
    expect(result.violations[0]).toContain(
      'No residency policy configured for ZZ-UNKNOWN',
    );
  });

  it('fails closed for cross-border approvals without tenant-scoped evidence', () => {
    expect(() =>
      service.assessCrossBorderTransfer({
        sourceJurisdiction: 'SA-SAMA',
        targetJurisdiction: 'US-FINCEN',
        dataCategories: ['financial'],
        dataSubjectId: 'subject-1',
        purpose: 'regulated cloud processing',
        legalBasis: 'standard_contractual_clauses',
        recipientInfo: {
          organizationName: 'Regulated Processor',
          safeguards: ['SAMA approval for financial data transfers'],
        },
      }),
    ).toThrow('A durable tenant-scoped data-sovereignty store is required');
  });

  it('fails closed for every globally keyed sovereignty mutation', () => {
    const operations = [
      () => service.withdrawConsent('subject-1', 'purpose-1'),
      () => service.conductPIA({
        projectName: 'Identity verification',
        description: 'Assess regulated identity verification processing',
        dataCategories: ['credential'],
        processingPurposes: ['identity_verification'],
        dataSubjectCategories: ['customers'],
        jurisdictions: ['EU-GDPR'],
        thirdPartyProcessors: [],
        automaticDecisionMaking: false,
        crossBorderTransfer: false,
      }),
      () => service.registerDPA('Processor', 'EU-GDPR', 365),
      () => service.initiateBreachNotification({
        detectedAt: new Date().toISOString(),
        description:
          'Credential export bucket was accessed by an unauthorized principal',
        severity: 'high',
        dataCategories: ['credential'],
        estimatedAffected: 12,
        jurisdictions: ['EU-GDPR'],
        containmentActions: ['Disabled export credentials'],
      }),
      () => service.trackRetention(
        'subject-1',
        'credential',
        'EU-GDPR',
        365,
      ),
    ];

    for (const operation of operations) {
      expect(operation).toThrow(
        'A durable tenant-scoped data-sovereignty store is required',
      );
    }
  });

  it('denies fields for purposes that do not have an approved minimization rule', () => {
    const result = service.enforceMinimization(
      ['full_name', 'document_number'],
      'unreviewed_processing',
      'AE-CBUAE',
    );

    expect(result).toEqual({
      allowedFields: [],
      deniedFields: ['full_name', 'document_number'],
      reason:
        'No data minimization rule configured for purpose "unreviewed_processing" under AE-CBUAE',
    });
  });

  it('does not accept a global file as tenant-scoped sovereignty evidence', () => {
    const storeFile = createTempStoreFile();
    const legacyGlobalStore = new DataSovereigntyService({ storeFile });

    expect(() =>
      legacyGlobalStore.recordConsent({
        dataSubjectId: 'subject-durable',
        purposes: [{
          purposeId: 'identity-verification',
          name: 'Identity verification',
          description: 'Verify regulated account access',
          legalBasis: 'consent',
          dataCategories: ['credential'],
          retentionDays: 365,
        }],
        consentGiven: true,
        collectedAt: new Date().toISOString(),
        collectionMethod: 'explicit_form',
        jurisdiction: 'EU-GDPR',
        withdrawable: true,
      }),
    ).toThrow('A durable tenant-scoped data-sovereignty store is required');

    expect(legacyGlobalStore.getConsents('subject-durable')).toHaveLength(0);
  });

  it('fails closed for production mutations without durable storage', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalZeroIdEnv = process.env.ZEROID_ENV;
    const originalStoreFile = process.env.DATA_SOVEREIGNTY_STORE_FILE;

    process.env.NODE_ENV = 'production';
    delete process.env.ZEROID_ENV;
    delete process.env.DATA_SOVEREIGNTY_STORE_FILE;

    try {
      const productionService = new DataSovereigntyService();
      expect(() => productionService.recordConsent({
        dataSubjectId: 'subject-prod',
        purposes: [{
          purposeId: 'regulated-processing',
          name: 'Regulated processing',
          description: 'Capture production consent evidence',
          legalBasis: 'consent',
          dataCategories: ['credential'],
          retentionDays: 365,
        }],
        consentGiven: true,
        collectedAt: new Date().toISOString(),
        collectionMethod: 'api',
        jurisdiction: 'EU-GDPR',
        withdrawable: true,
      })).toThrow('A durable tenant-scoped data-sovereignty store is required');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalZeroIdEnv === undefined) delete process.env.ZEROID_ENV;
      else process.env.ZEROID_ENV = originalZeroIdEnv;
      if (originalStoreFile === undefined) delete process.env.DATA_SOVEREIGNTY_STORE_FILE;
      else process.env.DATA_SOVEREIGNTY_STORE_FILE = originalStoreFile;
    }
  });
});
