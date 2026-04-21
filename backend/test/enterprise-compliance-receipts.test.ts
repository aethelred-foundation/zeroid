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
const mockApplyCompliancePolicy = jest.fn();
const mockApplyScreeningPolicy = jest.fn();
const mockApplyBatchScreeningPolicy = jest.fn();
const mockApplyCrossBorderPolicy = jest.fn();
const mockApplyReportingPolicy = jest.fn();
const mockApplyPrivacyWorkflowPolicy = jest.fn();
const mockScreenBatch = jest.fn();
const mockAssessCrossBorder = jest.fn();
const mockAssessCrossBorderTransfer = jest.fn();
const mockGenerateSAR = jest.fn();
const mockGenerateCTR = jest.fn();
const mockGenerateSTR = jest.fn();
const mockFulfillDSAR = jest.fn();
const mockProcessErasure = jest.fn();
const mockGenerateAuditPackage = jest.fn();
const mockGetDashboardData = jest.fn();
const mockConductPIA = jest.fn();
const mockInitiateBreachNotification = jest.fn();

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
      governanceSettings: {
        defaultPack: { packId: 'sovereign-core', version: '2026.04' },
        familyPacks: {
          compliance: { packId: 'cross-border-regulated', version: '2026.04' },
        },
        lastUpdatedAt: '2026-04-20T00:00:00.000Z',
        lastUpdatedByIdentityId: 'admin-1',
        changeHistory: [
          {
            changedAt: '2026-04-19T00:00:00.000Z',
            changedByIdentityId: 'admin-1',
            changeReason: 'Adopt sovereign baseline for enterprise rollout',
            defaultPack: { packId: 'sovereign-core', version: '2026.04' },
          },
          {
            changedAt: '2026-04-20T00:00:00.000Z',
            changedByIdentityId: 'privacy-officer-1',
            changeReason: 'Elevate compliance family to cross-border regulated pack',
            familyPacks: {
              compliance: { packId: 'cross-border-regulated', version: '2026.04' },
            },
          },
        ],
      },
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
    screenBatch: mockScreenBatch,
    resolveMatch: jest.fn(),
    getEntityScreenings: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/jurisdiction-engine', () => ({
  ComplianceEvaluationRequestSchema: z.any(),
  CrossBorderAssessmentSchema: z.object({
    entityId: z.string(),
    sourceJurisdiction: z.string(),
    targetJurisdiction: z.string(),
    dataCategories: z.array(z.string()),
  }),
  JurisdictionCodeSchema: z.string(),
  jurisdictionEngine: {
    evaluateCompliance: mockEvaluateCompliance,
    getComplianceStatus: jest.fn(),
    listJurisdictions: jest.fn(() => []),
    assessCrossBorder: mockAssessCrossBorder,
  },
}));

jest.mock('../src/services/compliance/regulatory-reporting', () => ({
  ReportTypeSchema: z.enum(['SAR', 'CTR', 'STR', 'DSAR', 'ERASURE', 'AUDIT', 'DASHBOARD']),
  ExportFormatSchema: z.enum(['json', 'xml', 'csv', 'pdf']),
  regulatoryReportingService: {
    generateSAR: mockGenerateSAR,
    generateCTR: mockGenerateCTR,
    generateSTR: mockGenerateSTR,
    fulfillDSAR: mockFulfillDSAR,
    processErasure: mockProcessErasure,
    generateAuditPackage: mockGenerateAuditPackage,
    getDashboardData: mockGetDashboardData,
    submitReport: jest.fn(),
    exportReport: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/data-sovereignty', () => ({
  CrossBorderTransferSchema: z.object({
    sourceJurisdiction: z.string(),
    targetJurisdiction: z.string(),
    dataCategories: z.array(z.string()),
    dataSubjectId: z.string(),
    purpose: z.string(),
    recipientInfo: z.object({
      organizationName: z.string(),
    }),
    legalBasis: z.string().optional(),
  }),
  PIASchema: z.any(),
  BreachNotificationSchema: z.any(),
  ConsentRecordSchema: z.any(),
  dataSovereigntyService: {
    assessCrossBorderTransfer: mockAssessCrossBorderTransfer,
    conductPIA: mockConductPIA,
    initiateBreachNotification: mockInitiateBreachNotification,
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

jest.mock('../src/services/enterprise/policy-execution-service', () => ({
  policyExecutionService: {
    applyCompliancePolicy: mockApplyCompliancePolicy,
    applyScreeningPolicy: mockApplyScreeningPolicy,
    applyBatchScreeningPolicy: mockApplyBatchScreeningPolicy,
    applyCrossBorderPolicy: mockApplyCrossBorderPolicy,
    applyReportingPolicy: mockApplyReportingPolicy,
    applyPrivacyWorkflowPolicy: mockApplyPrivacyWorkflowPolicy,
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
      policyDefinitionId: 'policy-7',
      policyReference: `zeroid://policy/mock/${policyName}@2026.04.1`,
      policyFamily: 'compliance',
      policyApprovalContext: {
        approvedByIdentityId: 'admin-approver',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        governancePackId: 'baseline-core',
        governancePackVersion: '2026.04',
        governancePackLabel: 'Baseline Core Governance Pack',
        governanceProfileId: 'enterprise.compliance',
        governanceProfileLabel: 'Enterprise / Compliance',
        governanceProfileRationale: ['Enterprise high-risk policies require dual-control approval.'],
      },
      policyLifecycleContext: {
        status: 'approved',
      },
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
      exceptionContext: {
        active: true,
        count: 1,
        exceptions: [
          {
            exceptionId: 'exception-1',
            scope: 'subject',
            subjectEntityId: 'entity-1',
            policyVersion: '2026.04.1',
            justification: 'Temporary sovereign override for cross-border onboarding',
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
      policyDefinitionId: input.policyDefinitionId,
      policyReference: input.policyReference ?? 'zeroid://policy/mock/default@2026.04.1',
      policyApprovedByIdentityId: input.policyApprovedByIdentityId,
      policyEffectiveFrom: input.policyEffectiveFrom,
      policyExpiresAt: input.policyExpiresAt,
      policyGovernancePackId: input.policyGovernancePackId,
      policyGovernancePackVersion: input.policyGovernancePackVersion,
      policyGovernancePackLabel: input.policyGovernancePackLabel,
      policyGovernanceProfileId: input.policyGovernanceProfileId,
      policyGovernanceProfileLabel: input.policyGovernanceProfileLabel,
      policyGovernanceRationale: input.policyGovernanceRationale,
      jurisdictionCodes: (input.jurisdictionCodes as string[] | undefined) ?? ['AE-ADGM'],
      policyExceptionIds: (input.policyExceptionIds as string[] | undefined) ?? [],
      policyExceptionCount: ((input.policyExceptionIds as string[] | undefined) ?? []).length,
      decisionSummary: input.decisionSummary ?? 'AE-ADGM:compliant',
      inputDigest: 'input',
      outputDigest: 'output',
      evidenceDigest: 'evidence',
      integrityHash: 'hash',
      integrityToken: 'token',
      createdAt: '2026-04-21T00:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00.000Z',
    }));
    mockApplyCompliancePolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _request: unknown,
      results: Array<Record<string, unknown>>,
    ) => ({
      results,
    }));
    mockApplyScreeningPolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _request: unknown,
      result: Record<string, unknown>,
    ) => ({
      result,
    }));
    mockApplyBatchScreeningPolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _request: unknown,
      result: Record<string, unknown>,
    ) => ({
      result,
    }));
    mockApplyCrossBorderPolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _request: unknown,
      result: Record<string, unknown>,
    ) => ({
      result,
    }));
    mockApplyReportingPolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _request: unknown,
      result: Record<string, unknown>,
    ) => ({
      result,
    }));
    mockApplyPrivacyWorkflowPolicy.mockImplementation(async (
      _organizationId: string,
      _policyContext: unknown,
      _operation: string,
      _request: unknown,
      result: Record<string, unknown>,
    ) => ({
      result,
    }));
    mockScreenBatch.mockResolvedValue({
      batchId: 'batch-1',
      totalEntities: 2,
      results: [],
      summary: { clear: 2, potentialMatch: 0, confirmedMatch: 0 },
      processingTimeMs: 20,
    });
    mockAssessCrossBorder.mockReturnValue({
      allowed: true,
      sourceJurisdiction: 'AE-ADGM',
      targetJurisdiction: 'EU-GDPR',
      mutualRecognition: true,
      acceptedCredentials: ['kyc_enhanced'],
      additionalRequired: [],
      dataTransferMechanism: 'adequacy_decision',
      restrictions: [],
    });
    mockAssessCrossBorderTransfer.mockReturnValue({
      transferId: 'transfer-1',
      allowed: true,
      legalBasis: 'standard_contractual_clauses',
      requiredSafeguards: ['encryption_at_rest'],
      riskLevel: 'medium',
      conditions: [],
      regulatoryNotifications: [],
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
    mockGenerateSAR.mockResolvedValue({
      reportId: 'report-1',
      reportType: 'SAR',
      version: 1,
      status: 'draft',
      filingJurisdiction: 'AE-ADGM',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: null,
      expiresAt: '2026-05-21T00:00:00.000Z',
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json', 'xml', 'pdf'],
    });
    mockGenerateCTR.mockResolvedValue({
      reportId: 'report-ctr-1',
      reportType: 'CTR',
      version: 1,
      status: 'draft',
      filingJurisdiction: 'US-FINCEN',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: null,
      expiresAt: '2026-05-21T00:00:00.000Z',
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json'],
    });
    mockGenerateSTR.mockResolvedValue({
      reportId: 'report-str-1',
      reportType: 'STR',
      version: 1,
      status: 'draft',
      filingJurisdiction: 'AE-CBUAE',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: null,
      expiresAt: '2026-05-21T00:00:00.000Z',
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json'],
    });
    mockFulfillDSAR.mockResolvedValue({
      reportId: 'report-dsar-1',
      reportType: 'DSAR',
      version: 1,
      status: 'pending_review',
      filingJurisdiction: 'EU-GDPR',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: null,
      expiresAt: '2026-05-21T00:00:00.000Z',
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json'],
    });
    mockProcessErasure.mockResolvedValue({
      reportId: 'report-erasure-1',
      reportType: 'ERASURE',
      version: 1,
      status: 'submitted',
      filingJurisdiction: 'EU-GDPR',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: '2026-04-21T00:00:00.000Z',
      expiresAt: null,
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json'],
    });
    mockGenerateAuditPackage.mockResolvedValue({
      reportId: 'report-audit-1',
      reportType: 'AUDIT',
      version: 1,
      status: 'draft',
      filingJurisdiction: 'all',
      generatedAt: '2026-04-21T00:00:00.000Z',
      submittedAt: null,
      expiresAt: null,
      content: {},
      amendments: [],
      filingReference: null,
      exportFormats: ['json'],
    });
    mockGetDashboardData.mockReturnValue({
      totalReports: 0,
      reportsByType: {},
      reportsByStatus: {},
      pendingDeadlines: [],
      complianceScore: 100,
      recentFilings: [],
      jurisdictionCoverage: [],
    });
    mockConductPIA.mockReturnValue({
      assessmentId: 'pia-1',
      riskScore: 60,
      riskLevel: 'high',
      findings: [],
      dpaRequired: true,
      dpiaRequired: true,
      supervisoryConsultationRequired: false,
      recommendations: ['Conduct full DPIA before proceeding with processing'],
      completedAt: '2026-04-21T00:00:00.000Z',
    });
    mockInitiateBreachNotification.mockReturnValue({
      breachId: 'breach-1',
      regulatoryDeadlines: [
        {
          jurisdiction: 'EU-GDPR',
          authority: 'Data Protection Authority',
          deadlineHours: 72,
          deadline: '2026-04-24T00:00:00.000Z',
          notificationSent: false,
          sentAt: null,
        },
      ],
      dataSubjectNotificationRequired: false,
      dataSubjectDeadlineHours: 0,
    });
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
    mockApplyCompliancePolicy.mockResolvedValue({
      results: [
        {
          jurisdiction: 'AE-ADGM',
          overallStatus: 'non_compliant',
          missingCredentials: ['source_of_funds'],
          expiringCredentials: [],
          rules: [
            { name: 'KYC complete', status: 'pass' },
            { name: 'Policy Additional Credentials', status: 'fail' },
          ],
          lastEvaluated: '2026-04-21T00:00:00.000Z',
          nextReviewDate: '2026-10-18T00:00:00.000Z',
        },
      ],
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'jurisdiction_compliance',
        policyVersion: '2026.04.1',
        directives: ['additional_required_credentials'],
        jurisdictionAdjustments: [
          {
            jurisdiction: 'AE-ADGM',
            changes: ['missing_credentials:source_of_funds'],
          },
        ],
      },
    });

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
      policyDefinitionId: 'policy-7',
      policyVersion: '2026.04.1',
      policyReference: 'zeroid://policy/mock/jurisdiction_compliance@2026.04.1',
      policyExceptionCount: 1,
      integrityHash: 'hash',
    });
    expect(response.body.data).toEqual([
      expect.objectContaining({
        jurisdiction: 'AE-ADGM',
        overallStatus: 'non_compliant',
        missingCredentials: ['source_of_funds'],
      }),
    ]);
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['additional_required_credentials'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      actorIdentityId: 'actor-1',
      receiptType: 'compliance_evaluation',
      policyVersion: '2026.04.1',
      policyDefinitionId: 'policy-7',
      policyReference: 'zeroid://policy/mock/jurisdiction_compliance@2026.04.1',
      policyApprovedByIdentityId: 'admin-approver',
      policyEffectiveFrom: '2026-04-01T00:00:00.000Z',
      policyGovernancePackId: 'baseline-core',
      policyGovernancePackVersion: '2026.04',
      policyGovernancePackLabel: 'Baseline Core Governance Pack',
      policyGovernanceProfileId: 'enterprise.compliance',
      policyGovernanceProfileLabel: 'Enterprise / Compliance',
      policyGovernanceRationale: ['Enterprise high-risk policies require dual-control approval.'],
      subjectEntityId: 'entity-1',
      policyExceptionIds: ['exception-1'],
      jurisdictionCodes: ['AE-ADGM'],
      metadata: expect.objectContaining({
        policyFamily: 'compliance',
        organizationGovernanceContext: expect.objectContaining({
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
          changeHistory: expect.arrayContaining([
            expect.objectContaining({
              changedByIdentityId: 'admin-1',
              defaultPack: { packId: 'sovereign-core', version: '2026.04' },
            }),
          ]),
        }),
        policyApprovalContext: expect.objectContaining({
          approvedByIdentityId: 'admin-approver',
          governancePackId: 'baseline-core',
          governancePackVersion: '2026.04',
          governancePackLabel: 'Baseline Core Governance Pack',
          governanceProfileId: 'enterprise.compliance',
          governanceProfileLabel: 'Enterprise / Compliance',
        }),
        policyLifecycleContext: expect.objectContaining({
          status: 'approved',
        }),
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
        trustContext: expect.objectContaining({
          enforced: true,
          accreditedIssuerCount: 1,
        }),
        exceptionContext: expect.objectContaining({
          active: true,
          count: 1,
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
    mockApplyScreeningPolicy.mockResolvedValue({
      result: {
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
        policyAlerts: ['Policy requires manual review for politically exposed person matches'],
        policyDecision: 'review_required',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'sanctions_screening',
        policyVersion: '2026.04.1',
        directives: ['pep_review_requirement'],
        screeningAdjustments: [
          {
            entityId: 'entity-9',
            changes: ['pep_review:1'],
          },
        ],
      },
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
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['pep_review_requirement'],
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
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
      }),
    }));
  });

  it('applies policy execution to cross-border transfer assessments', async () => {
    mockApplyCrossBorderPolicy.mockResolvedValue({
      result: {
        transferId: 'transfer-1',
        allowed: false,
        legalBasis: 'standard_contractual_clauses',
        requiredSafeguards: ['encryption_at_rest', 'customer_managed_keys'],
        riskLevel: 'prohibited',
        conditions: ['Policy disallows transferring categories: biometric'],
        regulatoryNotifications: [],
        expiresAt: '2026-12-31T00:00:00.000Z',
        policyAlerts: ['Policy disallows transferring categories: biometric'],
        policyDecision: 'blocked',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'data_sovereignty_cross_border',
        policyVersion: '2026.04.1',
        directives: ['disallowed_data_categories', 'required_safeguards'],
        crossBorderAdjustments: [
          {
            source: 'AE-ADGM',
            target: 'EU-GDPR',
            changes: ['disallowed_categories:biometric'],
          },
        ],
      },
    });

    const response = await invokeRoute('POST', '/cross-border', {
      body: {
        sourceJurisdiction: 'AE-ADGM',
        targetJurisdiction: 'EU-GDPR',
        dataCategories: ['biometric'],
        dataSubjectId: 'subject-1',
        purpose: 'remote_onboarding',
        legalBasis: 'standard_contractual_clauses',
        recipientInfo: {
          organizationName: 'Verifier GmbH',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      allowed: false,
      policyDecision: 'blocked',
      policyAlerts: ['Policy disallows transferring categories: biometric'],
    });
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['disallowed_data_categories', 'required_safeguards'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'cross_border_assessment',
      policyName: 'data_sovereignty_cross_border',
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
      }),
    }));
  });

  it('applies policy execution to regulatory report generation', async () => {
    mockApplyReportingPolicy.mockResolvedValue({
      result: {
        reportId: 'report-1',
        reportType: 'SAR',
        version: 1,
        status: 'pending_review',
        filingJurisdiction: 'AE-ADGM',
        generatedAt: '2026-04-21T00:00:00.000Z',
        submittedAt: null,
        expiresAt: '2026-05-21T00:00:00.000Z',
        content: {},
        amendments: [],
        filingReference: null,
        exportFormats: ['json', 'xml', 'pdf'],
        policyAlerts: ['Policy requires pending review for SAR reports'],
        policyDecision: 'review_required',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'regulatory_reporting',
        policyVersion: '2026.04.1',
        directives: ['pending_review_report_types', 'required_request_fields'],
        reportingAdjustments: [
          {
            reportType: 'SAR',
            changes: ['pending_review:SAR'],
          },
        ],
      },
    });

    const response = await invokeRoute('POST', '/report', {
      body: {
        reportType: 'SAR',
        filingInstitution: {
          name: 'Aethelred Bank',
          registrationNumber: 'AB-1',
          jurisdiction: 'AE-ADGM',
          contactName: 'Compliance Officer',
          contactEmail: 'compliance@example.com',
          contactPhone: '+971500000000',
        },
        subject: {
          entityId: 'entity-1',
          entityType: 'individual',
          name: 'John Doe',
          identifiers: [{ type: 'passport', value: 'P123' }],
        },
        suspiciousActivity: {
          description: 'Repeated high-value transfers with shell counterparties and inconsistent business profile.',
          activityType: 'money_laundering',
          dateRange: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-04-20T00:00:00.000Z',
          },
          transactionIds: ['txn-1'],
          relatedEntities: ['entity-2'],
        },
        priority: 'high',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      reportType: 'SAR',
      status: 'pending_review',
      policyDecision: 'review_required',
    });
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['pending_review_report_types', 'required_request_fields'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'regulatory_report',
      policyName: 'regulatory_reporting',
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
      }),
    }));
  });

  it('applies privacy policy execution to DSAR workflows', async () => {
    mockApplyPrivacyWorkflowPolicy.mockResolvedValue({
      result: {
        reportId: 'report-dsar-1',
        reportType: 'DSAR',
        version: 1,
        status: 'pending_review',
        filingJurisdiction: 'EU-GDPR',
        generatedAt: '2026-04-21T00:00:00.000Z',
        submittedAt: null,
        expiresAt: '2026-05-21T00:00:00.000Z',
        content: {},
        amendments: [],
        filingReference: null,
        exportFormats: ['json'],
        policyAlerts: ['Policy requires pending review for access privacy requests'],
        policyDecision: 'review_required',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'data_subject_access',
        policyVersion: '2026.04.1',
        directives: ['privacy_request_review_gate', 'required_privacy_data_categories'],
        privacyAdjustments: [
          {
            operation: 'dsar',
            changes: ['request_type_review:access'],
          },
        ],
      },
    });

    const response = await invokeRoute('POST', '/dsar', {
      body: {
        reportType: 'DSAR',
        requestorId: 'subject-1',
        requestorEmail: 'subject@example.com',
        requestType: 'access',
        dataCategories: ['personal_data'],
        jurisdiction: 'EU-GDPR',
        verificationProof: 'proof-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      reportType: 'DSAR',
      status: 'pending_review',
      policyDecision: 'review_required',
    });
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['privacy_request_review_gate', 'required_privacy_data_categories'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'regulatory_report',
      policyName: 'data_subject_access',
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
      }),
    }));
  });

  it('applies privacy policy execution to privacy impact assessments', async () => {
    mockApplyPrivacyWorkflowPolicy.mockResolvedValue({
      result: {
        assessmentId: 'pia-1',
        riskScore: 60,
        riskLevel: 'high',
        findings: [
          {
            area: 'Policy Processor Governance',
            risk: 'One or more processors lack signed data processing agreements',
            severity: 'high',
            mitigation: 'Complete DPA execution before proceeding under sovereign policy controls.',
          },
        ],
        dpaRequired: true,
        dpiaRequired: true,
        supervisoryConsultationRequired: true,
        recommendations: ['Escalate to supervisory authority review under policy control'],
        completedAt: '2026-04-21T00:00:00.000Z',
        policyAlerts: ['Policy requires supervisory consultation for high risk PIAs'],
        policyDecision: 'review_required',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'privacy_impact_assessment',
        policyVersion: '2026.04.1',
        directives: ['supervisory_consultation_risk_levels', 'processor_dpa_requirement'],
        privacyAdjustments: [
          {
            operation: 'pia',
            changes: ['supervisory_consultation:high'],
          },
        ],
      },
    });

    const response = await invokeRoute('POST', '/pia', {
      body: {
        projectName: 'ZeroID Access',
        description: 'Cross-border identity verification workflow',
        dataCategories: ['biometric'],
        processingPurposes: ['identity_verification'],
        dataSubjectCategories: ['general_public'],
        jurisdictions: ['EU-GDPR'],
        thirdPartyProcessors: [
          {
            name: 'Processor One',
            role: 'processor',
            jurisdiction: 'EU-GDPR',
            dpaInPlace: false,
          },
        ],
        automaticDecisionMaking: true,
        crossBorderTransfer: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({
      assessmentId: 'pia-1',
      supervisoryConsultationRequired: true,
      policyDecision: 'review_required',
    });
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['supervisory_consultation_risk_levels', 'processor_dpa_requirement'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'privacy_impact_assessment',
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
      }),
    }));
  });

  it('applies privacy policy execution to breach workflows and emits a receipt', async () => {
    mockApplyPrivacyWorkflowPolicy.mockResolvedValue({
      result: {
        breachId: 'breach-1',
        regulatoryDeadlines: [
          {
            jurisdiction: 'EU-GDPR',
            authority: 'Data Protection Authority',
            deadlineHours: 24,
            deadline: '2026-04-22T00:00:00.000Z',
            notificationSent: false,
            sentAt: null,
          },
        ],
        dataSubjectNotificationRequired: true,
        dataSubjectDeadlineHours: 72,
        policyAlerts: ['Policy requires data subject notification for high severity breaches'],
        policyDecision: 'review_required',
      },
      trace: {
        policyDefinitionId: 'policy-7',
        policyName: 'data_breach_notification',
        policyVersion: '2026.04.1',
        directives: ['breach_subject_notification_gate', 'accelerated_breach_deadlines'],
        privacyAdjustments: [
          {
            operation: 'breach',
            changes: ['subject_notification:high', 'accelerated_deadline:EU-GDPR'],
          },
        ],
      },
    });

    const response = await invokeRoute('POST', '/breach', {
      body: {
        detectedAt: '2026-04-21T00:00:00.000Z',
        description: 'Unauthorized access to identity verification logs',
        severity: 'high',
        dataCategories: ['personal_data'],
        estimatedAffected: 120,
        jurisdictions: ['EU-GDPR'],
        containmentActions: ['Rotated keys', 'Disabled exposed endpoint'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toMatchObject({
      breachId: 'breach-1',
      dataSubjectNotificationRequired: true,
      policyDecision: 'review_required',
    });
    expect(response.body.receipt).toMatchObject({
      receiptType: 'breach_notification',
    });
    expect(response.body.policyTrace).toMatchObject({
      policyDefinitionId: 'policy-7',
      directives: ['breach_subject_notification_gate', 'accelerated_breach_deadlines'],
    });
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptType: 'breach_notification',
      policyName: 'data_breach_notification',
      metadata: expect.objectContaining({
        policyExecutionTrace: expect.objectContaining({
          policyDefinitionId: 'policy-7',
        }),
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
