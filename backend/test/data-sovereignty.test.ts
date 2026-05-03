import { DataSovereigntyService } from '../src/services/compliance/data-sovereignty';

describe('DataSovereigntyService sovereign guardrails', () => {
  let service: DataSovereigntyService;

  beforeEach(() => {
    service = new DataSovereigntyService();
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

  it('blocks restricted cross-border transfers until required safeguards are evidenced', () => {
    const result = service.assessCrossBorderTransfer({
      sourceJurisdiction: 'SA-SAMA',
      targetJurisdiction: 'US-FINCEN',
      dataCategories: ['financial'],
      dataSubjectId: 'subject-1',
      purpose: 'regulated cloud processing',
      legalBasis: 'standard_contractual_clauses',
      recipientInfo: {
        organizationName: 'Regulated Processor',
        safeguards: [],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe('prohibited');
    expect(result.requiredSafeguards).toEqual(
      expect.arrayContaining(['SAMA approval for financial data transfers']),
    );
    expect(result.conditions).toEqual(
      expect.arrayContaining([
        'Required safeguards must be evidenced before transfer: SAMA approval for financial data transfers',
      ]),
    );
  });

  it('allows restricted cross-border transfers when legal basis and safeguards are evidenced', () => {
    const result = service.assessCrossBorderTransfer({
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
    });

    expect(result).toMatchObject({
      allowed: true,
      riskLevel: 'medium',
      legalBasis: 'standard_contractual_clauses',
    });
  });

  it('blocks sensitive exports without the required explicit consent legal basis', () => {
    const result = service.assessCrossBorderTransfer({
      sourceJurisdiction: 'AE-CBUAE',
      targetJurisdiction: 'EU-GDPR',
      dataCategories: ['biometric'],
      dataSubjectId: 'subject-2',
      purpose: 'remote identity verification',
      legalBasis: 'standard_contractual_clauses',
      recipientInfo: {
        organizationName: 'Identity Processor',
        safeguards: ['UAE PDPL consent for sensitive data cross-border transfer'],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe('prohibited');
    expect(result.conditions).toEqual(
      expect.arrayContaining([
        'UAE sensitive data transfers require explicit consent before export',
      ]),
    );
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
});
