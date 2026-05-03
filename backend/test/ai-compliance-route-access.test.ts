import express from 'express';
import request from 'supertest';

const mockResolveContext = jest.fn();
const mockScreenIdentity = jest.fn();

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

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
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

jest.mock('../src/services/ai/compliance-copilot', () => ({
  ComplianceCopilotError: class ComplianceCopilotError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  complianceCopilotService: {
    screenIdentity: mockScreenIdentity,
    generateReport: jest.fn(),
    computeComplianceScore: jest.fn(),
    queryComplianceCopilot: jest.fn(),
    getActiveAlerts: jest.fn(),
    simulateRegulatoryChange: jest.fn(),
  },
}));

jest.mock('../src/services/ai/risk-scoring', () => ({
  RiskScoringError: class RiskScoringError extends Error {},
  riskScoringService: {
    assessRisk: jest.fn(),
    getAvailableJurisdictions: jest.fn(() => []),
  },
}));

jest.mock('../src/services/ai/fraud-detection', () => ({
  FraudDetectionError: class FraudDetectionError extends Error {},
  fraudDetectionService: {
    getActiveAlerts: jest.fn(() => []),
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

describe('AI compliance route enterprise access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockResolveContext.mockResolvedValue({
      organizationId: 'org-1',
      identityId: '550e8400-e29b-41d4-a716-446655440001',
      role: 'compliance_officer',
    });
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
});
