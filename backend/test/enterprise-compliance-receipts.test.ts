import { z } from 'zod';

const routeRegistry: Record<string, Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>> = {};

const mockScreenEntity = jest.fn();
const mockEvaluateCompliance = jest.fn();
const mockListReceipts = jest.fn();
const mockGetReceipt = jest.fn();
const mockVerifyReceipt = jest.fn();
const mockExportReceipt = jest.fn();
const mockCreateReceipt = jest.fn();
const mockResolvePolicyContext = jest.fn();

jest.mock('express', () => {
  const router = {
    get: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
      routeRegistry[`GET ${path}`] = handlers;
      return router;
    }),
    post: jest.fn((path: string, ...handlers: Array<(req: any, res: any, next: (err?: unknown) => void) => unknown>) => {
      routeRegistry[`POST ${path}`] = handlers;
      return router;
    }),
  };

  return {
    Router: jest.fn(() => router),
  };
}, { virtual: true });

jest.mock('winston', () => {
  const noop = jest.fn();
  return {
    createLogger: jest.fn(() => ({ info: noop, warn: noop, error: noop, debug: noop })),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      json: jest.fn(),
    },
    transports: { Console: jest.fn() },
  };
}, { virtual: true });

jest.mock('../src/middleware/enterprise', () => ({
  requireEnterpriseContext: () => (req: Record<string, any>, _res: unknown, next: () => void) => {
    req.identity = { id: 'actor-1' };
    req.enterpriseContext = {
      organizationId: 'org-1',
      membershipId: 'membership-1',
      role: 'compliance_officer',
    };
    next();
  },
}));

jest.mock('../src/services/compliance/sanctions-screening', () => ({
  ScreeningRequestSchema: z.any(),
  BatchScreeningRequestSchema: z.any(),
  FalsePositiveDecisionSchema: z.any(),
  sanctionsScreeningService: {
    screenEntity: mockScreenEntity,
    screenBatch: jest.fn(),
    resolveMatch: jest.fn(),
    getEntityScreenings: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/jurisdiction-engine', () => ({
  ComplianceEvaluationRequestSchema: z.any(),
  CrossBorderAssessmentSchema: z.any(),
  JurisdictionCodeSchema: z.string(),
  jurisdictionEngine: {
    evaluateCompliance: mockEvaluateCompliance,
    getComplianceStatus: jest.fn(),
    listJurisdictions: jest.fn(() => []),
    assessCrossBorder: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/regulatory-reporting', () => ({
  ReportTypeSchema: z.enum(['SAR', 'CTR', 'STR', 'DSAR', 'ERASURE', 'AUDIT', 'DASHBOARD']),
  ExportFormatSchema: z.enum(['json', 'xml', 'csv', 'pdf']),
  regulatoryReportingService: {
    generateSAR: jest.fn(),
    generateCTR: jest.fn(),
    generateSTR: jest.fn(),
    fulfillDSAR: jest.fn(),
    processErasure: jest.fn(),
    generateAuditPackage: jest.fn(),
    getDashboardData: jest.fn(),
    submitReport: jest.fn(),
    exportReport: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/data-sovereignty', () => ({
  CrossBorderTransferSchema: z.any(),
  PIASchema: z.any(),
  BreachNotificationSchema: z.any(),
  ConsentRecordSchema: z.any(),
  dataSovereigntyService: {
    assessCrossBorderTransfer: jest.fn(),
    conductPIA: jest.fn(),
    initiateBreachNotification: jest.fn(),
    recordConsent: jest.fn(),
  },
}));

jest.mock('../src/services/enterprise/policy-receipt-service', () => ({
  policyDecisionReceiptService: {
    createReceipt: mockCreateReceipt,
    listReceipts: mockListReceipts,
    getReceipt: mockGetReceipt,
    verifyReceipt: mockVerifyReceipt,
    exportReceipt: mockExportReceipt,
  },
}));

jest.mock('../src/services/enterprise/policy-context-service', () => ({
  policyContextService: {
    resolvePolicyContext: mockResolvePolicyContext,
  },
}));

import '../src/routes/enterprise/compliance';

async function invokeRoute(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: Record<string, unknown>; params?: Record<string, string>; query?: Record<string, unknown> } = {},
): Promise<{ statusCode: number; body: any }> {
  const handlers = routeRegistry[`${method} ${path}`];
  if (!handlers) {
    throw new Error(`Route not registered: ${method} ${path}`);
  }

  const req: Record<string, any> = {
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
    headers: {},
  };

  let statusCode = 200;
  let responseBody: any;
  let ended = false;

  const res: Record<string, any> = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      responseBody = payload;
      ended = true;
      return res;
    },
    send(payload: any) {
      responseBody = payload;
      ended = true;
      return res;
    },
    end(payload: any) {
      responseBody = payload;
      ended = true;
      return res;
    },
    setHeader: jest.fn(),
    set: jest.fn(),
  };

  for (const handler of handlers) {
    if (ended) break;
    await new Promise<void>((resolve, reject) => {
      let nextCalled = false;
      const next = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      try {
        const result = handler(req, res, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(() => {
            if (!nextCalled) {
              resolve();
            }
          }).catch(reject);
          return;
        }

        if (!nextCalled) {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  return { statusCode, body: responseBody };
}

describe('enterprise compliance receipt routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockResolvePolicyContext.mockImplementation(async (policyName: string) => ({
      policyName,
      policyVersion: '2026.04.1',
      policyReference: `zeroid://policy/mock/${policyName}@2026.04.1`,
      policyFamily: 'compliance',
      trustContext: {
        organizationId: 'org-1',
        evaluatedIssuerCount: 1,
        accreditedIssuerCount: 1,
        enforced: true,
        anchors: [
          {
            issuerIdentityId: 'issuer-1',
            issuerDid: 'did:aethelred:issuer:1',
            issuerDisplayName: 'Issuer One',
            trustRecordId: 'trust-1',
            status: 'accredited',
            accreditationScope: 'sovereign',
            assuranceLevel: 'qualified',
            accepted: true,
            evaluatedCredentialTypes: ['kyc_enhanced'],
            matchedJurisdictions: ['AE-ADGM'],
          },
        ],
      },
    }));

    mockCreateReceipt.mockImplementation(async (input: Record<string, unknown>) => ({
      receiptId: 'pdr_1',
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: input.receiptType ?? 'compliance_evaluation',
      policyName: input.policyName ?? 'jurisdiction_compliance',
      policyVersion: input.policyVersion ?? '2026.04.1',
      policyReference: input.policyReference ?? 'zeroid://policy/mock/default@2026.04.1',
      jurisdictionCodes: (input.jurisdictionCodes as string[] | undefined) ?? ['AE-ADGM'],
      decisionSummary: input.decisionSummary ?? 'AE-ADGM:compliant',
      inputDigest: 'input',
      outputDigest: 'output',
      evidenceDigest: 'evidence',
      integrityHash: 'hash',
      integrityToken: 'token',
      createdAt: '2026-04-21T00:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00.000Z',
    }));
    mockListReceipts.mockResolvedValue([
      {
        receiptId: 'pdr_1',
        receiptType: 'compliance_evaluation',
        decisionSummary: 'AE-ADGM:compliant',
        createdAt: '2026-04-21T00:00:00.000Z',
      },
    ]);
    mockGetReceipt.mockResolvedValue({
      receiptId: 'pdr_1',
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'compliance_evaluation',
      policyName: 'jurisdiction_compliance',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/mock/jurisdiction_compliance@2026.04.1',
      jurisdictionCodes: ['AE-ADGM'],
      decisionSummary: 'AE-ADGM:compliant',
      inputDigest: 'input',
      outputDigest: 'output',
      evidenceDigest: 'evidence',
      integrityHash: 'hash',
      integrityToken: 'token',
      createdAt: '2026-04-21T00:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00.000Z',
    });
    mockVerifyReceipt.mockResolvedValue({
      valid: true,
      receipt: {
        receiptId: 'pdr_1',
        organizationId: 'org-1',
      },
    });
    mockExportReceipt.mockResolvedValue({
      formatVersion: 'zeroid.policy_receipt_export.v1',
      exportedAt: '2026-04-21T01:00:00.000Z',
      verified: true,
      receipt: {
        receiptId: 'pdr_1',
        organizationId: 'org-1',
      },
    });
  });

  it('emits a receipt for compliance evaluation decisions', async () => {
    mockEvaluateCompliance.mockResolvedValue([
      {
        jurisdiction: 'AE-ADGM',
        overallStatus: 'compliant',
        missingCredentials: [],
        rules: [{ name: 'KYC complete', status: 'pass' }],
      },
    ]);

    const response = await invokeRoute('POST', '/evaluate', {
      body: {
        entityId: 'entity-1',
        entityType: 'individual',
        jurisdictions: ['AE-ADGM'],
        credentials: [],
        operationType: 'onboarding',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.receipt).toMatchObject({
      id: 'pdr_1',
      receiptType: 'compliance_evaluation',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/mock/jurisdiction_compliance@2026.04.1',
      integrityHash: 'hash',
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'compliance_evaluation',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/mock/jurisdiction_compliance@2026.04.1',
      subjectEntityId: 'entity-1',
      jurisdictionCodes: ['AE-ADGM'],
      metadata: expect.objectContaining({
        policyFamily: 'compliance',
        trustContext: expect.objectContaining({
          enforced: true,
          accreditedIssuerCount: 1,
        }),
      }),
    }));
  });

  it('emits sanctions screening receipts using the actual screening outcome fields', async () => {
    mockScreenEntity.mockResolvedValue({
      screeningId: 'screen-1',
      entityId: 'entity-9',
      timestamp: '2026-04-21T00:00:00.000Z',
      overallRisk: 'potential_match',
      matches: [
        { status: 'pending_review' },
        { status: 'confirmed_match' },
      ],
      listsScreened: ['ofac_sdn', 'un_sanctions'],
      processingTimeMs: 12,
      nextScreeningDate: '2026-04-22T00:00:00.000Z',
    });

    const response = await invokeRoute('POST', '/screen', {
      body: {
        entityId: 'entity-9',
        entityType: 'individual',
        names: [{ fullName: 'Jane Doe', nameType: 'primary' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.receipt).toMatchObject({
      id: 'pdr_1',
      receiptType: 'sanctions_screening',
      policyVersion: '2026.04.1',
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'sanctions_screening',
      decisionSummary: 'screening_result:potential_match',
      evidence: expect.objectContaining({
        listsScreened: ['ofac_sdn', 'un_sanctions'],
        matchCount: 2,
        confirmedMatches: 1,
        potentialMatches: 1,
      }),
    }));
  });

  it('lists and verifies organization-scoped receipts', async () => {
    const listResponse = await invokeRoute('GET', '/receipts', {
      query: { limit: 10 },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(mockListReceipts).toHaveBeenCalledWith('org-1', 10);

    const verifyResponse = await invokeRoute('GET', '/receipts/:receiptId/verify', {
      params: { receiptId: 'pdr_1' },
    });
    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.body.data).toMatchObject({ valid: true });
    expect(mockVerifyReceipt).toHaveBeenCalledWith('pdr_1');
  });

  it('exports an organization-scoped receipt evidence bundle', async () => {
    const exportResponse = await invokeRoute('GET', '/receipts/:receiptId/export', {
      params: { receiptId: 'pdr_1' },
    });

    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body.data).toMatchObject({
      formatVersion: 'zeroid.policy_receipt_export.v1',
      verified: true,
      receipt: {
        receiptId: 'pdr_1',
      },
    });
    expect(mockExportReceipt).toHaveBeenCalledWith('pdr_1');
  });
});
