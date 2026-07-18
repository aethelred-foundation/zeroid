const mockIdentityFindUnique = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/runtime', () => ({
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  ComplianceAdvisorError,
  ComplianceAdvisorService,
} from '../src/services/ai/compliance-advisor';

const identityId = '550e8400-e29b-41d4-a716-446655440000';
const previousNodeEnv = process.env.NODE_ENV;

describe('Compliance content source guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('does not generate synthetic compliance reports outside production', async () => {
    await expect(new ComplianceAdvisorService().generateReport(
      identityId,
      'comprehensive',
      'AE',
    )).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code: 'COMPLIANCE_REPORT_POLICY_UNCONFIGURED',
      statusCode: 503,
    });

    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('does not answer from an embedded regulatory knowledge base', async () => {
    await expect(new ComplianceAdvisorService().queryComplianceAdvisor({
      question: 'Which regulatory requirements apply?',
      context: { identityId, jurisdiction: 'AE' },
    })).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code: 'COMPLIANCE_ADVISOR_KB_UNCONFIGURED',
      statusCode: 503,
    });

    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it('does not fabricate effective dates, impact, or remediation actions', async () => {
    await expect(new ComplianceAdvisorService().assessRegulatoryChangeImpact(
      'Authority notice',
      'A material policy change requiring an approved scope mapping.',
      'AE',
    )).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code: 'REGULATORY_IMPACT_POLICY_UNCONFIGURED',
      statusCode: 503,
    });

    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
  });

  it('does not infer a legal compliance status from heuristic weights', async () => {
    await expect(new ComplianceAdvisorService().computeComplianceScore(
      identityId,
      'AE',
    )).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code: 'COMPLIANCE_SCORING_POLICY_UNCONFIGURED',
      statusCode: 503,
    });

    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });
});
