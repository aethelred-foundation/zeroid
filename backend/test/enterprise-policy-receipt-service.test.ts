const mockAuditLogCreate = jest.fn();
const mockPolicyDecisionLedgerCreate = jest.fn();
const mockPolicyDecisionLedgerFindUnique = jest.fn();
const mockPolicyDecisionLedgerFindMany = jest.fn();
const mockPolicyDefinitionFindFirst = jest.fn();
const mockPolicyExceptionFindMany = jest.fn();
const mockIssuerTrustFindMany = jest.fn();
const mockIssuerKeyHistoryFindMany = jest.fn();
const mockExportCredentialEvidence = jest.fn();

const redisStore: Record<string, string> = {};

jest.mock('../src/index', () => ({
  prisma: {
    policyDecisionLedger: {
      create: mockPolicyDecisionLedgerCreate,
      findUnique: mockPolicyDecisionLedgerFindUnique,
      findMany: mockPolicyDecisionLedgerFindMany,
    },
    policyDefinition: {
      findFirst: mockPolicyDefinitionFindFirst,
    },
    policyException: {
      findMany: mockPolicyExceptionFindMany,
    },
    issuerTrustRecord: {
      findMany: mockIssuerTrustFindMany,
    },
    issuerKeyHistory: {
      findMany: mockIssuerKeyHistoryFindMany,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
  redis: {
    get: jest.fn(async (key: string) => redisStore[key] ?? null),
    set: jest.fn(async (key: string, value: string) => {
      redisStore[key] = value;
      return 'OK';
    }),
  },
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    exportCredentialEvidence: mockExportCredentialEvidence,
  },
}));

import { PolicyDecisionReceiptService } from '../src/services/enterprise/policy-receipt-service';

describe('PolicyDecisionReceiptService', () => {
  const service = new PolicyDecisionReceiptService();

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(redisStore)) {
      delete redisStore[key];
    }
    process.env.POLICY_RECEIPT_SIGNING_SECRET = 'policy-receipt-signing-secret-123';
    mockPolicyDecisionLedgerCreate.mockResolvedValue(undefined);
    mockPolicyDecisionLedgerFindUnique.mockResolvedValue(null);
    mockPolicyDecisionLedgerFindMany.mockResolvedValue([]);
    mockPolicyDefinitionFindFirst.mockResolvedValue(null);
    mockPolicyExceptionFindMany.mockResolvedValue([]);
    mockIssuerTrustFindMany.mockResolvedValue([]);
    mockIssuerKeyHistoryFindMany.mockResolvedValue([]);
    mockExportCredentialEvidence.mockResolvedValue({
      formatVersion: 'zeroid.credential_evidence_export.v1',
      exportedAt: '2026-04-21T00:00:00.000Z',
      credential: {
        id: 'cred-9',
        credentialType: 'privacy_assessment',
        issuerId: 'issuer-privacy-1',
        subjectId: 'entity-7',
        claims: { redacted: true },
        claimsHash: 'claims-hash',
        proof: { signatureValue: 'sig' },
        status: 'ACTIVE',
        issuedAt: new Date('2026-04-15T00:00:00.000Z'),
        expiresAt: new Date('2027-04-15T00:00:00.000Z'),
      },
      verification: {
        valid: true,
        checks: {
          statusActive: true,
          signatureValid: true,
        },
      },
      issuer: {
        identityId: 'issuer-privacy-1',
        did: 'did:aethelred:issuer:privacy-registry',
        status: 'ACTIVE',
        keyVersion: '2',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:privacy-registry#assertion-key-2',
      },
      subject: {
        identityId: 'entity-7',
        did: 'did:aethelred:entity:7',
        status: 'ACTIVE',
      },
      trustLineage: {
        enforced: true,
        selectedTrustRecordId: 'trust-privacy-1',
        accreditationScope: 'sovereign',
        assuranceLevel: 'qualified',
        evaluatedJurisdictions: ['EU-GDPR'],
        matchedJurisdictions: ['EU-GDPR'],
      },
    });
  });

  afterAll(() => {
    delete process.env.POLICY_RECEIPT_SIGNING_SECRET;
  });

  it('creates, retrieves, and indexes policy decision receipts', async () => {
    const receipt = await service.createReceipt({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'compliance_evaluation',
      policyName: 'jurisdiction_compliance',
      policyDefinitionId: 'policy-7',
      policyReference: 'zeroid://policy/compliance/jurisdiction_compliance@2026.04.1',
      policyApprovedByIdentityId: 'admin-approver',
      policyEffectiveFrom: '2026-04-01T00:00:00.000Z',
      policyGovernancePackId: 'baseline-core',
      policyGovernancePackVersion: '2026.04',
      policyGovernancePackLabel: 'Baseline Core Governance Pack',
      policyGovernanceProfileId: 'enterprise.compliance',
      policyGovernanceProfileLabel: 'Enterprise / Compliance',
      policyGovernanceRationale: ['Enterprise high-risk policies require dual-control approval.'],
      subjectEntityId: 'entity-1',
      policyExceptionIds: ['exception-2', 'exception-1', 'exception-2'],
      jurisdictionCodes: ['AE-ADGM', 'EU-GDPR'],
      decisionSummary: 'AE-ADGM:compliant,EU-GDPR:partial',
      input: { entityId: 'entity-1', operationType: 'onboarding' },
      output: [{ jurisdiction: 'AE-ADGM', overallStatus: 'compliant' }],
      evidence: [{ jurisdiction: 'AE-ADGM', missingCredentials: [] }],
      metadata: {
        route: '/enterprise/compliance/evaluate',
        organizationGovernanceContext: {
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            compliance: { packId: 'cross-border-regulated', version: '2026.04' },
          },
          lastUpdatedAt: '2026-04-20T00:00:00.000Z',
          lastUpdatedByIdentityId: 'admin-1',
          activePack: {
            id: 'baseline-core',
            version: '2026.04',
            label: 'Baseline Core Governance Pack',
            policyFamily: 'compliance',
          },
          changeHistory: [
            {
              changedAt: '2026-04-19T00:00:00.000Z',
              changedByIdentityId: 'admin-1',
              changeReason: 'Adopt sovereign baseline for enterprise rollout',
              defaultPack: { packId: 'sovereign-core', version: '2026.04' },
            },
          ],
        },
      },
    });

    expect(receipt.receiptId).toMatch(/^pdr_/);
    expect(receipt.integrityHash).toHaveLength(64);
    expect(receipt.integrityToken.length).toBeGreaterThan(20);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        identityId: 'actor-1',
        resourceType: 'policy_decision_receipt',
      }),
    }));
    expect(mockPolicyDecisionLedgerCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptId: receipt.receiptId,
        organizationId: 'org-1',
        actorIdentityId: 'actor-1',
        receiptType: 'COMPLIANCE_EVALUATION',
        policyDefinitionId: 'policy-7',
        policyReference: 'zeroid://policy/compliance/jurisdiction_compliance@2026.04.1',
        policyApprovedByIdentityId: 'admin-approver',
        policyEffectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        policyGovernancePackId: 'baseline-core',
        policyGovernancePackVersion: '2026.04',
        policyGovernancePackLabel: 'Baseline Core Governance Pack',
        policyGovernanceProfileId: 'enterprise.compliance',
        policyGovernanceProfileLabel: 'Enterprise / Compliance',
        policyGovernanceRationale: ['Enterprise high-risk policies require dual-control approval.'],
        policyExceptionIds: ['exception-1', 'exception-2'],
        policyExceptionCount: 2,
      }),
    }));
    expect(receipt.policyDefinitionId).toBe('policy-7');
    expect(receipt.policyApprovedByIdentityId).toBe('admin-approver');
    expect(receipt.policyEffectiveFrom).toBe('2026-04-01T00:00:00.000Z');
    expect(receipt.policyGovernancePackId).toBe('baseline-core');
    expect(receipt.policyGovernancePackVersion).toBe('2026.04');
    expect(receipt.policyGovernancePackLabel).toBe('Baseline Core Governance Pack');
    expect(receipt.policyGovernanceProfileId).toBe('enterprise.compliance');
    expect(receipt.policyGovernanceProfileLabel).toBe('Enterprise / Compliance');
    expect(receipt.policyGovernanceRationale).toEqual([
      'Enterprise high-risk policies require dual-control approval.',
    ]);
    expect(receipt.policyExceptionIds).toEqual(['exception-1', 'exception-2']);
    expect(receipt.policyExceptionCount).toBe(2);

    mockPolicyDecisionLedgerFindMany.mockResolvedValue([
      {
        receiptId: receipt.receiptId,
        receiptType: 'COMPLIANCE_EVALUATION',
        policyName: 'jurisdiction_compliance',
        policyVersion: 'v1',
        subjectEntityId: 'entity-1',
        decisionSummary: receipt.decisionSummary,
        createdAt: new Date(receipt.createdAt),
      },
    ]);

    const loaded = await service.getReceipt(receipt.receiptId);
    expect(loaded).toEqual(receipt);

    const list = await service.listReceipts('org-1');
    expect(list).toEqual([
      expect.objectContaining({
        receiptId: receipt.receiptId,
        receiptType: 'compliance_evaluation',
        policyName: 'jurisdiction_compliance',
        policyVersion: 'v1',
        subjectEntityId: 'entity-1',
      }),
    ]);

    const verified = await service.verifyReceipt(receipt.receiptId);
    expect(verified.valid).toBe(true);
  });

  it('rejects tampered receipt payloads even when the stored token is unchanged', async () => {
    const receipt = await service.createReceipt({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'sanctions_screening',
      policyName: 'sanctions_screening',
      subjectEntityId: 'entity-9',
      decisionSummary: 'screening_result:clear',
      input: { entityId: 'entity-9' },
      output: { overallRisk: 'clear' },
      evidence: { matchCount: 0 },
    });

    const receiptKey = `policy:receipt:${receipt.receiptId}`;
    const tampered = {
      ...receipt,
      decisionSummary: 'screening_result:confirmed_match',
    };
    redisStore[receiptKey] = JSON.stringify(tampered);

    const verification = await service.verifyReceipt(receipt.receiptId);
    expect(verification.receipt?.decisionSummary).toBe('screening_result:confirmed_match');
    expect(verification.valid).toBe(false);
  });

  it('requires a dedicated strong signing secret for production receipts', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousZeroidEnv = process.env.ZEROID_ENV;
    const previousReceiptSecret = process.env.POLICY_RECEIPT_SIGNING_SECRET;
    const previousJwtSecret = process.env.JWT_SECRET;

    const createMinimalReceipt = () =>
      service.createReceipt({
        organizationId: 'org-1',
        actorIdentityId: 'actor-1',
        receiptType: 'sanctions_screening',
        policyName: 'sanctions_screening',
        decisionSummary: 'screening_result:clear',
        input: { entityId: 'entity-9' },
        output: { overallRisk: 'clear' },
      });

    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'j'.repeat(64);
      delete process.env.POLICY_RECEIPT_SIGNING_SECRET;

      await expect(createMinimalReceipt()).rejects.toMatchObject({
        code: 'POLICY_RECEIPT_SECRET_MISSING',
      });

      process.env.POLICY_RECEIPT_SIGNING_SECRET = 'short-receipt-secret';
      await expect(createMinimalReceipt()).rejects.toMatchObject({
        code: 'POLICY_RECEIPT_SECRET_MISSING',
      });

      process.env.POLICY_RECEIPT_SIGNING_SECRET = 'r'.repeat(64);
      await expect(createMinimalReceipt()).resolves.toMatchObject({
        receiptType: 'sanctions_screening',
      });

      process.env.NODE_ENV = 'test';
      process.env.ZEROID_ENV = 'production';
      delete process.env.POLICY_RECEIPT_SIGNING_SECRET;

      await expect(createMinimalReceipt()).rejects.toMatchObject({
        code: 'POLICY_RECEIPT_SECRET_MISSING',
      });
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousZeroidEnv === undefined) {
        delete process.env.ZEROID_ENV;
      } else {
        process.env.ZEROID_ENV = previousZeroidEnv;
      }
      if (previousReceiptSecret === undefined) {
        delete process.env.POLICY_RECEIPT_SIGNING_SECRET;
      } else {
        process.env.POLICY_RECEIPT_SIGNING_SECRET = previousReceiptSecret;
      }
      if (previousJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = previousJwtSecret;
      }
    }
  });

  it('falls back to the durable ledger when the redis cache is cold', async () => {
    const createdAt = new Date('2026-04-21T00:00:00.000Z');
    const expiresAt = new Date('2026-07-20T00:00:00.000Z');
    mockPolicyDecisionLedgerFindUnique.mockResolvedValue({
      receiptId: 'pdr_ledger_1',
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'REGULATORY_REPORT',
      policyName: 'regulatory_reporting',
      policyVersion: 'v1',
      policyDefinitionId: 'policy-11',
      policyReference: 'zeroid://policy/reporting/regulatory_reporting@2026.04.1',
      policyApprovedByIdentityId: 'auditor-2',
      policyEffectiveFrom: new Date('2026-04-10T00:00:00.000Z'),
      policyGovernancePackId: 'enterprise-reporting',
      policyGovernancePackVersion: '2026.04',
      policyGovernancePackLabel: 'Enterprise Reporting Governance Pack',
      policyGovernanceProfileId: 'enterprise.reporting',
      policyGovernanceProfileLabel: 'Enterprise / Reporting',
      policyGovernanceRationale: ['Enterprise reporting policies require dual-control approval.'],
      subjectEntityId: 'entity-2',
      policyExceptionIds: ['exception-7'],
      policyExceptionCount: 1,
      jurisdictionCodes: ['AE-ADGM'],
      decisionSummary: 'report_generated:SAR',
      inputDigest: 'input-hash',
      outputDigest: 'output-hash',
      evidenceDigest: 'evidence-hash',
      integrityHash: 'hash',
      integrityToken: 'token',
      metadata: { route: '/enterprise/compliance/report' },
      createdAt,
      expiresAt,
    });
    mockPolicyDecisionLedgerFindMany.mockResolvedValue([
      {
        receiptId: 'pdr_ledger_1',
        receiptType: 'REGULATORY_REPORT',
        policyName: 'regulatory_reporting',
        policyVersion: 'v1',
        subjectEntityId: 'entity-2',
        decisionSummary: 'report_generated:SAR',
        createdAt,
      },
    ]);

    const loaded = await service.getReceipt('pdr_ledger_1');
    expect(loaded).toMatchObject({
      receiptId: 'pdr_ledger_1',
      receiptType: 'regulatory_report',
      policyDefinitionId: 'policy-11',
      policyReference: 'zeroid://policy/reporting/regulatory_reporting@2026.04.1',
      policyApprovedByIdentityId: 'auditor-2',
      policyEffectiveFrom: '2026-04-10T00:00:00.000Z',
      policyGovernancePackId: 'enterprise-reporting',
      policyGovernancePackVersion: '2026.04',
      policyGovernancePackLabel: 'Enterprise Reporting Governance Pack',
      policyGovernanceProfileId: 'enterprise.reporting',
      policyGovernanceProfileLabel: 'Enterprise / Reporting',
      policyGovernanceRationale: ['Enterprise reporting policies require dual-control approval.'],
      policyExceptionIds: ['exception-7'],
      policyExceptionCount: 1,
      decisionSummary: 'report_generated:SAR',
    });
    expect(redisStore['policy:receipt:pdr_ledger_1']).toBeDefined();

    const list = await service.listReceipts('org-1', 10);
    expect(list).toEqual([
      {
        receiptId: 'pdr_ledger_1',
        receiptType: 'regulatory_report',
        policyName: 'regulatory_reporting',
        policyVersion: 'v1',
        subjectEntityId: 'entity-2',
        decisionSummary: 'report_generated:SAR',
        createdAt: '2026-04-21T00:00:00.000Z',
      },
    ]);
    expect(mockPolicyDecisionLedgerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
      take: 10,
    }));
  });

  it('exports a verified receipt bundle', async () => {
    mockPolicyDefinitionFindFirst.mockResolvedValue({
      id: 'policy-9',
      status: 'DEPRECATED',
      name: 'privacy_impact_assessment',
      version: '2026.04.1',
      reference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
      approvedByIdentityId: 'privacy-admin',
      effectiveFrom: new Date('2026-04-15T00:00:00.000Z'),
      governancePackId: 'enterprise-privacy',
      governancePackVersion: '2026.04',
      governancePackLabel: 'Enterprise Privacy Governance Pack',
      governanceProfileId: 'enterprise.privacy',
      governanceProfileLabel: 'Enterprise / Privacy',
      governanceProfileRationale: ['Enterprise privacy policies require dual-control approval.'],
      expiresAt: null,
      deprecatedAt: new Date('2026-06-01T00:00:00.000Z'),
      deprecatedByIdentityId: 'privacy-auditor',
      deprecationReason: 'Superseded by 2026.05.0',
      supersededByPolicyDefinitionId: 'policy-10',
      revokedAt: null,
      revokedByIdentityId: null,
      revocationReason: null,
    });
    mockPolicyExceptionFindMany.mockResolvedValue([
      {
        id: 'exception-9',
        status: 'REVOKED',
        policyName: 'privacy_impact_assessment',
        policyVersion: '2026.04.1',
        policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
        governancePackId: 'enterprise-privacy',
        governancePackVersion: '2026.04',
        governancePackLabel: 'Enterprise Privacy Governance Pack',
        governanceProfileId: 'enterprise.privacy',
        governanceProfileLabel: 'Enterprise / Privacy',
        governanceProfileRationale: ['Enterprise privacy policies require dual-control approval.'],
        subjectEntityId: 'entity-7',
        scope: 'SUBJECT',
        approvedByIdentityId: 'privacy-admin',
        effectiveFrom: new Date('2026-04-15T00:00:00.000Z'),
        expiresAt: null,
        revokedAt: new Date('2026-06-02T00:00:00.000Z'),
        revokedByIdentityId: 'privacy-auditor',
        revocationReason: 'Exception withdrawn after remediation',
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ]);
    mockIssuerTrustFindMany.mockResolvedValue([
      {
        id: 'trust-privacy-1',
        organizationId: 'org-1',
        issuerIdentityId: 'issuer-privacy-1',
        issuerDid: 'did:aethelred:issuer:privacy-registry',
        status: 'ACCREDITED',
        accreditationScope: 'SOVEREIGN',
        assuranceLevel: 'QUALIFIED',
        allowedCredentialTypes: ['privacy_assessment', 'data_processing'],
        allowedJurisdictions: ['EU-GDPR'],
        proposedByIdentityId: 'privacy-admin',
        accreditedByIdentityId: 'privacy-auditor',
        suspensionReason: null,
        metadata: { trustFramework: 'GDPR' },
        accreditedAt: new Date('2026-04-16T00:00:00.000Z'),
        expiresAt: new Date('2027-04-16T00:00:00.000Z'),
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
        issuer: {
          displayName: 'EU Privacy Registry',
        },
      },
    ]);
    mockIssuerKeyHistoryFindMany.mockResolvedValue([
      {
        id: 'keyhist-2',
        issuerIdentityId: 'issuer-privacy-1',
        issuerDid: 'did:aethelred:issuer:privacy-registry',
        keyVersion: '2',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:privacy-registry#assertion-key-2',
        status: 'ACTIVE',
        validFrom: new Date('2026-04-18T00:00:00.000Z'),
        validUntil: null,
        rotatedByIdentityId: 'privacy-admin',
        metadata: { provider: 'aws-kms' },
        createdAt: new Date('2026-04-18T00:00:00.000Z'),
      },
      {
        id: 'keyhist-1',
        issuerIdentityId: 'issuer-privacy-1',
        issuerDid: 'did:aethelred:issuer:privacy-registry',
        keyVersion: '1',
        keyAlgorithm: 'ES256',
        verificationMethod: 'did:aethelred:issuer:privacy-registry#assertion-key-1',
        status: 'RETIRED',
        validFrom: new Date('2026-03-01T00:00:00.000Z'),
        validUntil: new Date('2026-04-18T00:00:00.000Z'),
        rotatedByIdentityId: 'privacy-admin',
        metadata: { provider: 'aws-kms' },
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);

    const receipt = await service.createReceipt({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'privacy_impact_assessment',
      policyName: 'privacy_impact_assessment',
      policyVersion: '2026.04.1',
      policyDefinitionId: 'policy-9',
      policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
      policyApprovedByIdentityId: 'privacy-admin',
      policyEffectiveFrom: '2026-04-15T00:00:00.000Z',
      policyGovernancePackId: 'enterprise-privacy',
      policyGovernancePackVersion: '2026.04',
      policyGovernancePackLabel: 'Enterprise Privacy Governance Pack',
      policyGovernanceProfileId: 'enterprise.privacy',
      policyGovernanceProfileLabel: 'Enterprise / Privacy',
      policyGovernanceRationale: ['Enterprise privacy policies require dual-control approval.'],
      subjectEntityId: 'entity-7',
      policyExceptionIds: ['exception-9'],
      jurisdictionCodes: ['EU-GDPR'],
      decisionSummary: 'pia_risk:medium',
      input: { entityId: 'entity-7' },
      output: { riskLevel: 'medium' },
      evidence: { riskScore: 58 },
      metadata: {
        organizationGovernanceContext: {
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy', version: '2026.04' },
          },
          lastUpdatedAt: '2026-04-18T00:00:00.000Z',
          lastUpdatedByIdentityId: 'privacy-admin',
          activePack: {
            id: 'enterprise-privacy',
            version: '2026.04',
            label: 'Enterprise Privacy Governance Pack',
            policyFamily: 'privacy',
          },
          changeHistory: [
            {
              changedAt: '2026-04-18T00:00:00.000Z',
              changedByIdentityId: 'privacy-admin',
              changeReason: 'Enable privacy governance pack',
              familyPacks: {
                privacy: { packId: 'enterprise-privacy', version: '2026.04' },
              },
            },
          ],
        },
        policyExecutionTrace: {
          policyDefinitionId: 'policy-9',
          policyName: 'privacy_impact_assessment',
          policyVersion: '2026.04.1',
          directives: [
            'supervisory_consultation_risk_levels',
            'processor_dpa_requirement',
            'cross_border_pia_review_gate',
          ],
          governanceOverlay: {
            packId: 'enterprise-privacy',
            packVersion: '2026.04',
            packLabel: 'Enterprise Privacy Governance Pack',
            directives: [
              'privacy_request_review_gate',
              'supervisory_consultation_risk_levels',
              'breach_subject_notification_gate',
            ],
            appliedDirectives: ['supervisory_consultation_risk_levels'],
          },
        },
        trustContext: {
          organizationId: 'org-1',
          evaluatedIssuerCount: 1,
          accreditedIssuerCount: 1,
          enforced: true,
          anchors: [
            {
              issuerIdentityId: 'issuer-privacy-1',
              issuerDid: 'did:aethelred:issuer:privacy-registry',
              issuerDisplayName: 'EU Privacy Registry',
              trustRecordId: 'trust-privacy-1',
              status: 'accredited',
              accreditationScope: 'sovereign',
              assuranceLevel: 'qualified',
              accepted: true,
              evaluatedCredentialTypes: ['privacy_assessment'],
              matchedJurisdictions: ['EU-GDPR'],
              expiresAt: '2027-04-16T00:00:00.000Z',
            },
          ],
        },
        credentialEvidenceRefs: [
          {
            credentialId: 'cred-9',
            issuerId: 'issuer-privacy-1',
            credentialType: 'privacy_assessment',
          },
        ],
        credentialEvidenceUsage: [
          {
            credentialId: 'cred-9',
            issuerId: 'issuer-privacy-1',
            credentialType: 'privacy_assessment',
            operationType: 'onboarding',
            rulePaths: [
              {
                jurisdiction: 'EU-GDPR',
                rulePath: 'required_credential:privacy_assessment',
                status: 'satisfied',
              },
            ],
          },
        ],
        obligationEvidenceUsage: [
          {
            domain: 'cross_border',
            obligationType: 'required_safeguard',
            rulePath: 'required_safeguard:customer_managed_keys',
            status: 'escalated',
            detail: 'customer_managed_keys',
            sourceJurisdiction: 'AE-ADGM',
            targetJurisdiction: 'EU-GDPR',
          },
          {
            domain: 'reporting',
            obligationType: 'deadline',
            rulePath: 'deadline:filingDeadline',
            status: 'satisfied',
            detail: '2026-04-30T00:00:00.000Z',
            jurisdiction: 'EU-GDPR',
            reportType: 'DSAR',
          },
          {
            domain: 'privacy',
            obligationType: 'subject_notification',
            rulePath: 'subject_notification:high',
            status: 'escalated',
            detail: 'high',
            jurisdiction: 'EU-GDPR',
          },
        ],
        reportLifecycle: {
          action: 'exported',
          reportId: 'report-privacy-1',
          reportType: 'DSAR',
          version: 2,
          status: 'submitted',
          filingJurisdiction: 'EU-GDPR',
          authority: 'Data Protection Authority',
          filingReference: 'DSAR-20260421-xyz987',
          deadlineField: 'responseDeadline',
          deadline: '2026-04-30T00:00:00.000Z',
          submittedAt: '2026-04-21T10:00:00.000Z',
          amendmentCount: 1,
          amendmentHistory: [
            {
              version: 2,
              amendedAt: '2026-04-21T10:30:00.000Z',
              reason: 'Corrected subject disclosure scope',
            },
          ],
          exportFormat: 'pdf',
          exportFilename: 'DSAR_report-privacy-1_v2.pdf',
          exportRequestedAt: '2026-04-21T11:00:00.000Z',
          deliveryChannel: 'portal_upload',
          deliveryDestination: 'eu-dpa-portal',
          deliveryAcknowledgementId: 'ack-privacy-1',
          deliveryAcknowledgedAt: '2026-04-21T11:01:00.000Z',
        },
        reportFilingPackage: {
          packageVersion: 'zeroid.regulatory_filing_package.v1',
          reportId: 'report-privacy-1',
          reportType: 'DSAR',
          version: 2,
          status: 'submitted',
          filingJurisdiction: 'EU-GDPR',
          authorityProfile: {
            authority: 'Data Protection Authority',
            authorityClass: 'data_protection_authority',
            packageProfile: 'privacy_rights',
            jurisdiction: 'EU-GDPR',
            reportType: 'DSAR',
            preferredDeliveryChannels: ['portal_upload', 'email', 'api'],
            acknowledgementExpected: true,
            supportsAmendments: true,
            supportsExports: true,
          },
          authorityManifest: {
            manifestVersion: 'zeroid.report_authority_manifest.v1',
            reportId: 'report-privacy-1',
            reportType: 'DSAR',
            filingJurisdiction: 'EU-GDPR',
            authority: 'Data Protection Authority',
            filingReference: 'DSAR-20260421-xyz987',
            currentVersion: 2,
            submittedAt: '2026-04-21T10:00:00.000Z',
            supportedExportFormats: ['json', 'csv', 'pdf'],
            preferredDeliveryChannels: ['portal_upload', 'email', 'api'],
            acknowledgementExpected: true,
            latestAmendment: {
              version: 2,
              amendedAt: '2026-04-21T10:30:00.000Z',
              reason: 'Corrected subject disclosure scope',
            },
            latestExport: {
              format: 'pdf',
              filename: 'DSAR_report-privacy-1_v2.pdf',
              exportedAt: '2026-04-21T11:00:00.000Z',
              deliveryChannel: 'portal_upload',
              deliveryDestination: 'eu-dpa-portal',
              deliveryAcknowledgementId: 'ack-privacy-1',
              deliveryAcknowledgedAt: '2026-04-21T11:01:00.000Z',
            },
            acknowledgements: [
              {
                acknowledgementId: 'ack-privacy-1',
                stage: 'exported',
                acknowledgedAt: '2026-04-21T11:01:00.000Z',
                channel: 'portal_upload',
                destination: 'eu-dpa-portal',
                authority: 'Data Protection Authority',
              },
            ],
            handoffTrail: [
              {
                eventId: 'manifest-evt-privacy-export-1',
                stage: 'exported',
                recordedAt: '2026-04-21T11:00:00.000Z',
                authority: 'Data Protection Authority',
                filingReference: 'DSAR-20260421-xyz987',
                version: 2,
                exportFormat: 'pdf',
                exportFilename: 'DSAR_report-privacy-1_v2.pdf',
                deliveryChannel: 'portal_upload',
                deliveryDestination: 'eu-dpa-portal',
                acknowledgementId: 'ack-privacy-1',
                acknowledgedAt: '2026-04-21T11:01:00.000Z',
              },
            ],
            lastUpdatedAt: '2026-04-21T11:01:00.000Z',
          },
          deadline: {
            field: 'responseDeadline',
            value: '2026-04-30T00:00:00.000Z',
            status: 'met',
            evaluatedAt: '2026-04-21T11:00:00.000Z',
            submittedOnTime: true,
          },
          lifecycle: {
            generatedAt: '2026-04-21T00:00:00.000Z',
            submittedAt: '2026-04-21T10:00:00.000Z',
            filingReference: 'DSAR-20260421-xyz987',
            amendmentCount: 1,
            latestAmendment: {
              version: 2,
              amendedAt: '2026-04-21T10:30:00.000Z',
              reason: 'Corrected subject disclosure scope',
            },
            lastExportedAt: '2026-04-21T11:00:00.000Z',
            lastExportFormat: 'pdf',
            lastExportFilename: 'DSAR_report-privacy-1_v2.pdf',
            lastDeliveryChannel: 'portal_upload',
            lastDeliveryDestination: 'eu-dpa-portal',
            lastDeliveryAcknowledgementId: 'ack-privacy-1',
            lastDeliveryAcknowledgedAt: '2026-04-21T11:01:00.000Z',
          },
          evidenceTrail: [
            {
              eventId: 'evt-privacy-gen-1',
              action: 'generated',
              recordedAt: '2026-04-21T00:00:00.000Z',
              receiptId: 'pdr-gen-1',
              policyName: 'regulatory_reporting',
              policyVersion: '2026.04.1',
              decisionSummary: 'report_generated:DSAR',
              authority: 'Data Protection Authority',
              filingReference: null,
              version: 1,
            },
            {
              eventId: 'evt-privacy-exp-1',
              action: 'exported',
              recordedAt: '2026-04-21T11:00:00.000Z',
              receiptId: 'pdr-exp-1',
              policyName: 'regulatory_export',
              policyVersion: '2026.04.1',
              decisionSummary: 'report_exported:report-privacy-1:pdf',
              authority: 'Data Protection Authority',
              filingReference: 'DSAR-20260421-xyz987',
              version: 2,
              exportFormat: 'pdf',
              exportFilename: 'DSAR_report-privacy-1_v2.pdf',
              deliveryChannel: 'portal_upload',
              deliveryDestination: 'eu-dpa-portal',
              deliveryAcknowledgementId: 'ack-privacy-1',
              deliveryAcknowledgedAt: '2026-04-21T11:01:00.000Z',
            },
            {
              eventId: 'evt-privacy-ack-1',
              action: 'acknowledged',
              recordedAt: '2026-04-21T11:01:00.000Z',
              receiptId: 'pdr-privacy-ack-1',
              policyName: 'regulatory_acknowledgement',
              policyVersion: '2026.04.1',
              decisionSummary: 'report_acknowledged:report-privacy-1:exported',
              authority: 'Data Protection Authority',
              filingReference: 'DSAR-20260421-xyz987',
              version: 2,
              deliveryAcknowledgementId: 'ack-privacy-1',
              deliveryAcknowledgedAt: '2026-04-21T11:01:00.000Z',
              deliveryChannel: 'portal_upload',
              deliveryDestination: 'eu-dpa-portal',
            },
          ],
        },
      },
    });

    const exported = await service.exportReceipt(receipt.receiptId);
    expect(exported).toMatchObject({
      formatVersion: 'zeroid.policy_receipt_export.v1',
      verified: true,
      receipt: expect.objectContaining({
        receiptId: receipt.receiptId,
        policyDefinitionId: 'policy-9',
        policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
        policyApprovedByIdentityId: 'privacy-admin',
        policyEffectiveFrom: '2026-04-15T00:00:00.000Z',
        policyExceptionIds: ['exception-9'],
        policyExceptionCount: 1,
      }),
      lineage: {
        policy: expect.objectContaining({
          policyDefinitionId: 'policy-9',
          status: 'deprecated',
          supersededByPolicyDefinitionId: 'policy-10',
          governancePackId: 'enterprise-privacy',
          governancePackVersion: '2026.04',
          governancePackLabel: 'Enterprise Privacy Governance Pack',
          governanceProfileId: 'enterprise.privacy',
          governanceProfileLabel: 'Enterprise / Privacy',
        }),
        exceptions: [
          expect.objectContaining({
            exceptionId: 'exception-9',
            status: 'revoked',
            revokedByIdentityId: 'privacy-auditor',
          }),
        ],
        credentials: [
          expect.objectContaining({
            credentialId: 'cred-9',
            credentialType: 'privacy_assessment',
            issuerId: 'issuer-privacy-1',
            subjectId: 'entity-7',
            verification: expect.objectContaining({
              valid: true,
            }),
            trustLineage: expect.objectContaining({
              selectedTrustRecordId: 'trust-privacy-1',
            }),
            usage: expect.objectContaining({
              operationType: 'onboarding',
              rulePaths: [
                expect.objectContaining({
                  jurisdiction: 'EU-GDPR',
                  rulePath: 'required_credential:privacy_assessment',
                  status: 'satisfied',
                }),
              ],
            }),
          }),
        ],
        obligations: [
          expect.objectContaining({
            domain: 'cross_border',
            obligationType: 'required_safeguard',
            rulePath: 'required_safeguard:customer_managed_keys',
            status: 'escalated',
            sourceJurisdiction: 'AE-ADGM',
            targetJurisdiction: 'EU-GDPR',
          }),
          expect.objectContaining({
            domain: 'reporting',
            obligationType: 'deadline',
            rulePath: 'deadline:filingDeadline',
            status: 'satisfied',
            jurisdiction: 'EU-GDPR',
            reportType: 'DSAR',
          }),
          expect.objectContaining({
            domain: 'privacy',
            obligationType: 'subject_notification',
            rulePath: 'subject_notification:high',
            status: 'escalated',
            jurisdiction: 'EU-GDPR',
          }),
        ],
        reportLifecycle: expect.objectContaining({
          action: 'exported',
          reportId: 'report-privacy-1',
          reportType: 'DSAR',
          version: 2,
          status: 'submitted',
          filingJurisdiction: 'EU-GDPR',
          authority: 'Data Protection Authority',
          exportFormat: 'pdf',
          exportFilename: 'DSAR_report-privacy-1_v2.pdf',
          deliveryChannel: 'portal_upload',
          deliveryDestination: 'eu-dpa-portal',
          deliveryAcknowledgementId: 'ack-privacy-1',
        }),
        reportFilingPackage: expect.objectContaining({
          packageVersion: 'zeroid.regulatory_filing_package.v1',
          reportId: 'report-privacy-1',
          reportType: 'DSAR',
          authorityProfile: expect.objectContaining({
            authority: 'Data Protection Authority',
            authorityClass: 'data_protection_authority',
          }),
          authorityManifest: expect.objectContaining({
            manifestVersion: 'zeroid.report_authority_manifest.v1',
            authority: 'Data Protection Authority',
            latestExport: expect.objectContaining({
              format: 'pdf',
              deliveryAcknowledgementId: 'ack-privacy-1',
            }),
            acknowledgements: expect.arrayContaining([
              expect.objectContaining({
                acknowledgementId: 'ack-privacy-1',
                stage: 'exported',
              }),
            ]),
          }),
          deadline: expect.objectContaining({
            field: 'responseDeadline',
            status: 'met',
            submittedOnTime: true,
          }),
          lifecycle: expect.objectContaining({
            filingReference: 'DSAR-20260421-xyz987',
            lastExportFormat: 'pdf',
            lastDeliveryAcknowledgementId: 'ack-privacy-1',
          }),
          evidenceTrail: expect.arrayContaining([
            expect.objectContaining({
              action: 'generated',
              policyName: 'regulatory_reporting',
            }),
            expect.objectContaining({
              action: 'exported',
              exportFormat: 'pdf',
              deliveryDestination: 'eu-dpa-portal',
            }),
            expect.objectContaining({
              action: 'acknowledged',
              policyName: 'regulatory_acknowledgement',
              deliveryAcknowledgementId: 'ack-privacy-1',
            }),
          ]),
        }),
        trustAnchors: [
          expect.objectContaining({
            issuerIdentityId: 'issuer-privacy-1',
            issuerDid: 'did:aethelred:issuer:privacy-registry',
            accepted: true,
            evaluatedCredentialTypes: ['privacy_assessment'],
            matchedJurisdictions: ['EU-GDPR'],
            trustRegime: expect.objectContaining({
              status: 'accredited',
              accreditationScope: 'sovereign',
              assuranceLevel: 'qualified',
            }),
            trustRecord: expect.objectContaining({
              trustRecordId: 'trust-privacy-1',
              allowedCredentialTypes: ['privacy_assessment', 'data_processing'],
              allowedJurisdictions: ['EU-GDPR'],
            }),
            keyLineage: expect.objectContaining({
              current: expect.objectContaining({
                keyHistoryId: 'keyhist-2',
                keyVersion: '2',
                status: 'active',
              }),
              history: [
                expect.objectContaining({
                  keyHistoryId: 'keyhist-2',
                }),
                expect.objectContaining({
                  keyHistoryId: 'keyhist-1',
                }),
              ],
            }),
          }),
        ],
      },
      operatingRegime: {
        organizationGovernance: {
          defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          familyPacks: {
            privacy: { packId: 'enterprise-privacy', version: '2026.04' },
          },
          lastUpdatedAt: '2026-04-18T00:00:00.000Z',
          lastUpdatedByIdentityId: 'privacy-admin',
          activePack: {
            id: 'enterprise-privacy',
            version: '2026.04',
            label: 'Enterprise Privacy Governance Pack',
            policyFamily: 'privacy',
          },
          changeHistory: [
            expect.objectContaining({
              changedByIdentityId: 'privacy-admin',
              changeReason: 'Enable privacy governance pack',
            }),
          ],
        },
        runtimeOverlay: {
          packId: 'enterprise-privacy',
          packVersion: '2026.04',
          packLabel: 'Enterprise Privacy Governance Pack',
          directives: [
            'privacy_request_review_gate',
            'supervisory_consultation_risk_levels',
            'breach_subject_notification_gate',
          ],
          appliedDirectives: ['supervisory_consultation_risk_levels'],
        },
      },
    });
  });
});
