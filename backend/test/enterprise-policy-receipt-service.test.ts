const mockAuditLogCreate = jest.fn();

const redisStore: Record<string, string> = {};

jest.mock('../src/index', () => ({
  prisma: {
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

    const loaded = await service.getReceipt(receipt.receiptId);
    expect(loaded).toEqual(receipt);

    const list = await service.listReceipts('org-1');
    expect(list).toEqual([
      expect.objectContaining({
        receiptId: receipt.receiptId,
        receiptType: 'compliance_evaluation',
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
});
