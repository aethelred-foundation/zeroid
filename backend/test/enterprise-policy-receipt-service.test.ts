const mockAuditLogCreate = jest.fn();
const mockPolicyDecisionLedgerCreate = jest.fn();
const mockPolicyDecisionLedgerFindUnique = jest.fn();
const mockPolicyDecisionLedgerFindMany = jest.fn();

const redisStore: Record<string, string> = {};

jest.mock('../src/index', () => ({
  prisma: {
    policyDecisionLedger: {
      create: mockPolicyDecisionLedgerCreate,
      findUnique: mockPolicyDecisionLedgerFindUnique,
      findMany: mockPolicyDecisionLedgerFindMany,
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
      subjectEntityId: 'entity-1',
      jurisdictionCodes: ['AE-ADGM', 'EU-GDPR'],
      decisionSummary: 'AE-ADGM:compliant,EU-GDPR:partial',
      input: { entityId: 'entity-1', operationType: 'onboarding' },
      output: [{ jurisdiction: 'AE-ADGM', overallStatus: 'compliant' }],
      evidence: [{ jurisdiction: 'AE-ADGM', missingCredentials: [] }],
      metadata: { route: '/enterprise/compliance/evaluate' },
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
        policyReference: undefined,
      }),
    }));

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
      policyReference: 'zeroid://policy/reporting/regulatory_reporting@2026.04.1',
      subjectEntityId: 'entity-2',
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
      policyReference: 'zeroid://policy/reporting/regulatory_reporting@2026.04.1',
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
    const receipt = await service.createReceipt({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'privacy_impact_assessment',
      policyName: 'privacy_impact_assessment',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
      subjectEntityId: 'entity-7',
      jurisdictionCodes: ['EU-GDPR'],
      decisionSummary: 'pia_risk:medium',
      input: { entityId: 'entity-7' },
      output: { riskLevel: 'medium' },
      evidence: { riskScore: 58 },
    });

    const exported = await service.exportReceipt(receipt.receiptId);
    expect(exported).toMatchObject({
      formatVersion: 'zeroid.policy_receipt_export.v1',
      verified: true,
      receipt: expect.objectContaining({
        receiptId: receipt.receiptId,
        policyReference: 'zeroid://policy/privacy/privacy_impact_assessment@2026.04.1',
      }),
    });
  });
});
