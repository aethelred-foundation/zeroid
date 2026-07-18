import express from 'express';
import request from 'supertest';

const mockResolveContext = jest.fn();
const mockScreenIdentity = jest.fn();
const mockAcknowledgeAlert = jest.fn();
const mockGenerateReport = jest.fn();
const mockComputeComplianceScore = jest.fn();
const mockGetActiveAlerts = jest.fn();
const mockGetAlert = jest.fn();
const mockAssessRisk = jest.fn();
const mockAssessRegulatoryChangeImpact = jest.fn();
const mockOrganizationMemberFindUnique = jest.fn();
const mockOrganizationMemberFindFirst = jest.fn();
const mockCredentialFindUnique = jest.fn();

class MockEnterpriseOrganizationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'EnterpriseOrganizationError';
  }
}

class MockRiskScoringError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'RiskScoringError';
  }
}

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    organizationMember: {
      findUnique: mockOrganizationMemberFindUnique,
      findFirst: mockOrganizationMemberFindFirst,
    },
    credential: {
      findUnique: mockCredentialFindUnique,
    },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      did: 'did:aethelred:test:compliance-user',
      publicKey: 'pub',
      status: 'ACTIVE',
    };
    next();
  },
}));

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/enterprise/organization-service', () => ({
  EnterpriseOrganizationError: MockEnterpriseOrganizationError,
  enterpriseOrganizationService: {
    resolveContext: mockResolveContext,
  },
}));

jest.mock('../src/services/ai/compliance-advisor', () => ({
  ComplianceAdvisorError: class ComplianceAdvisorError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  complianceAdvisorService: {
    screenIdentity: mockScreenIdentity,
    generateReport: mockGenerateReport,
    computeComplianceScore: mockComputeComplianceScore,
    queryComplianceAdvisor: jest.fn(),
    getActiveAlerts: mockGetActiveAlerts,
    getAlert: mockGetAlert,
    acknowledgeAlert: mockAcknowledgeAlert,
    assessRegulatoryChangeImpact: mockAssessRegulatoryChangeImpact,
    simulateRegulatoryChange: jest.fn(),
  },
}));

jest.mock('../src/services/ai/risk-scoring', () => ({
  RiskScoringError: MockRiskScoringError,
  riskAssessmentUnavailableError: () =>
    new MockRiskScoringError(
      'Risk assessment is unavailable until tenant-scoped durable credential verification and audit evidence is implemented',
      'RISK_ASSESSMENT_EVIDENCE_UNAVAILABLE',
      503,
    ),
  riskScoringService: {
    assessRisk: mockAssessRisk,
    getAvailableJurisdictions: jest.fn(() => []),
  },
}));

import { aiComplianceRoutes } from '../src/routes/ai/compliance';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai/compliance', aiComplianceRoutes);
  return app;
}

const screenBody = {
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  fullName: 'Example Person',
  jurisdiction: 'US',
};
const outsideIdentityId = '550e8400-e29b-41d4-a716-446655440002';
const credentialId = '550e8400-e29b-41d4-a716-446655440003';

describe('AI compliance route enterprise access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveContext.mockResolvedValue({
      organizationId: 'org-1',
      identityId: '550e8400-e29b-41d4-a716-446655440001',
      role: 'compliance_officer',
    });
    mockOrganizationMemberFindUnique.mockResolvedValue({
      identityId: screenBody.identityId,
    });
    mockOrganizationMemberFindFirst.mockResolvedValue({
      identityId: screenBody.identityId,
    });
    mockCredentialFindUnique.mockResolvedValue({
      issuerId: '550e8400-e29b-41d4-a716-446655440010',
      subjectId: screenBody.identityId,
    });
    mockGenerateReport.mockResolvedValue({ reportId: 'report-1' });
    mockAssessRisk.mockResolvedValue({ assessmentId: 'risk-1' });
    mockComputeComplianceScore.mockResolvedValue({
      score: 95,
      breakdown: {},
      status: 'compliant',
    });
    mockGetActiveAlerts.mockResolvedValue([]);
    mockGetAlert.mockResolvedValue({
      alertId: 'alert-123',
      entityId: screenBody.identityId,
      level: 'warning',
      category: 'sanctions',
      title: 'Review required',
      description: 'Potential match',
      regulation: 'FATF',
      actionRequired: 'Review',
      createdAt: new Date('2026-05-03T00:00:00.000Z'),
    });
    mockAssessRegulatoryChangeImpact.mockResolvedValue({
      changeId: 'rci-1',
      regulation: 'VARA Rulebook',
      jurisdiction: 'AE',
      impactedEntities: 3,
      impactedCredentialTypes: ['KYC_LEVEL_2'],
      requiredActions: ['Review policy thresholds'],
      estimatedEffort: 'medium',
      deadline: new Date('2026-07-01T00:00:00.000Z'),
      recommendations: ['Schedule compliance review'],
    });
  });

  it('blocks screening before handler execution when enterprise role resolution rejects', async () => {
    mockResolveContext.mockRejectedValue(
      new MockEnterpriseOrganizationError(
        'Insufficient enterprise role',
        'ENTERPRISE_ROLE_FORBIDDEN',
        403,
      ),
    );

    const response = await request(createApp())
      .post('/ai/compliance/screen')
      .send(screenBody)
      .expect(403);

    expect(response.body).toEqual({
      error: 'Insufficient enterprise role',
      code: 'ENTERPRISE_ROLE_FORBIDDEN',
    });
    expect(mockScreenIdentity).not.toHaveBeenCalled();
  });

  it('allows screening for a resolved enterprise compliance role', async () => {
    mockScreenIdentity.mockResolvedValue({
      screeningId: 'screening-1',
      identityId: screenBody.identityId,
      result: 'clear',
      matchScore: 0,
      matchedLists: [],
      pepMatches: [],
      adverseMedia: [],
      riskIndicators: [],
      screenedAt: new Date('2026-05-03T00:00:00.000Z'),
      expiresAt: new Date('2026-05-04T00:00:00.000Z'),
      listsChecked: ['ofac_sdn'],
    });

    await request(createApp())
      .post('/ai/compliance/screen')
      .send(screenBody)
      .expect(200);

    expect(mockResolveContext).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440001',
      undefined,
      ['operator', 'admin', 'compliance_officer'],
    );
    expect(mockScreenIdentity).toHaveBeenCalledWith(screenBody);
  });

  it('hides screening targets outside the resolved organization', async () => {
    mockOrganizationMemberFindUnique.mockResolvedValueOnce(null);

    const response = await request(createApp())
      .post('/ai/compliance/screen')
      .send(screenBody)
      .expect(404);

    expect(response.body).toEqual({
      error: 'COMPLIANCE_TARGET_NOT_FOUND',
      message: 'Compliance target not found',
    });
    expect(mockScreenIdentity).not.toHaveBeenCalled();
  });

  it('blocks reports for identities outside the resolved organization', async () => {
    mockOrganizationMemberFindUnique.mockResolvedValueOnce(null);

    await request(createApp())
      .post('/ai/compliance/report')
      .send({
        entityId: outsideIdentityId,
        reportType: 'kyc',
        jurisdiction: 'US',
      })
      .expect(404);

    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('checks credential tenancy before failing closed on unavailable evidence', async () => {
    const response = await request(createApp())
      .get(`/ai/compliance/risk/${credentialId}`)
      .query({ entityType: 'credential', jurisdiction: 'US' })
      .expect(503);

    expect(mockCredentialFindUnique).toHaveBeenCalledWith({
      where: { id: credentialId },
      select: { issuerId: true, subjectId: true },
    });
    expect(mockOrganizationMemberFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        identityId: {
          in: ['550e8400-e29b-41d4-a716-446655440010', screenBody.identityId],
        },
      },
      select: { identityId: true },
    });
    expect(mockAssessRisk).not.toHaveBeenCalled();
    expect(mockComputeComplianceScore).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: 'RISK_ASSESSMENT_EVIDENCE_UNAVAILABLE',
      message:
        'Risk assessment is unavailable until tenant-scoped durable credential verification and audit evidence is implemented',
    });
  });

  it('does not reveal the disabled risk service for a foreign credential', async () => {
    mockOrganizationMemberFindFirst.mockResolvedValueOnce(null);

    const response = await request(createApp())
      .get(`/ai/compliance/risk/${credentialId}`)
      .query({ entityType: 'credential', jurisdiction: 'US' })
      .expect(404);

    expect(response.body).toEqual({
      error: 'COMPLIANCE_TARGET_NOT_FOUND',
      message: 'Compliance target not found',
    });
    expect(mockAssessRisk).not.toHaveBeenCalled();
  });

  it('fails closed before reading alerts without tenant provenance', async () => {
    const response = await request(createApp())
      .get('/ai/compliance/alerts')
      .query({ severity: 'high' })
      .expect(503);

    expect(response.body).toEqual({
      error: 'COMPLIANCE_ALERT_TENANT_PROVENANCE_UNAVAILABLE',
      message:
        'Compliance alerts are unavailable until durable records include immutable organization ownership.',
    });
    expect(mockGetActiveAlerts).not.toHaveBeenCalled();
    expect(mockGetAlert).not.toHaveBeenCalled();
  });

  it('fails closed before acknowledging alerts without tenant provenance', async () => {
    const response = await request(createApp())
      .post('/ai/compliance/alerts/alert-123/acknowledge')
      .send({})
      .expect(503);

    expect(response.body).toEqual({
      error: 'COMPLIANCE_ALERT_TENANT_PROVENANCE_UNAVAILABLE',
      message:
        'Compliance alerts are unavailable until durable records include immutable organization ownership.',
    });
    expect(mockGetAlert).not.toHaveBeenCalled();
    expect(mockAcknowledgeAlert).not.toHaveBeenCalled();
  });

  it('still enforces alert write roles before reporting feature availability', async () => {
    mockResolveContext.mockRejectedValueOnce(
      new MockEnterpriseOrganizationError(
        'Insufficient enterprise role',
        'ENTERPRISE_ROLE_FORBIDDEN',
        403,
      ),
    );

    await request(createApp())
      .post('/ai/compliance/alerts/alert-123/acknowledge')
      .send({})
      .expect(403);

    expect(mockGetAlert).not.toHaveBeenCalled();
    expect(mockAcknowledgeAlert).not.toHaveBeenCalled();
  });

  it('runs regulatory impact assessment through the production-facing route', async () => {
    const response = await request(createApp())
      .post('/ai/compliance/impact-assessment')
      .send({
        regulation: 'VARA Rulebook',
        changes: 'Raise KYC evidence retention expectations for regulated entities.',
        jurisdiction: 'AE',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.changeId).toBe('rci-1');
    expect(response.headers.deprecation).toBeUndefined();
    expect(mockResolveContext).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440001',
      undefined,
      ['operator', 'admin', 'compliance_officer'],
    );
    expect(mockAssessRegulatoryChangeImpact).toHaveBeenCalledWith(
      'VARA Rulebook',
      'Raise KYC evidence retention expectations for regulated entities.',
      'AE',
    );
  });

  it('keeps simulate as a deprecated compatibility alias', async () => {
    const response = await request(createApp())
      .post('/ai/compliance/simulate')
      .send({
        regulation: 'VARA Rulebook',
        changes: 'Raise KYC evidence retention expectations for regulated entities.',
        jurisdiction: 'AE',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.headers.deprecation).toBe('true');
    expect(response.headers.link).toContain('/api/v1/ai/compliance/impact-assessment');
    expect(mockAssessRegulatoryChangeImpact).toHaveBeenCalledWith(
      'VARA Rulebook',
      'Raise KYC evidence retention expectations for regulated entities.',
      'AE',
    );
  });
});
