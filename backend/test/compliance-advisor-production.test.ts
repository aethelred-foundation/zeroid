const mockAuditLogCreate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockScreenEntity = jest.fn();

jest.mock('../src/runtime', () => ({
  prisma: {
    auditLog: {
      create: mockAuditLogCreate,
    },
    identity: {
      findUnique: mockIdentityFindUnique,
    },
  },
  redis: {
    set: mockRedisSet,
    get: mockRedisGet,
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/services/compliance/sanctions-screening', () => ({
  SANCTIONS_LIST_NAMES: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
  sanctionsScreeningService: {
    screenEntity: mockScreenEntity,
  },
}));

import {
  ComplianceAdvisorError,
  ComplianceAdvisorService,
  SanctionsScreeningRequest,
} from '../src/services/ai/compliance-advisor';

const previousNodeEnv = process.env.NODE_ENV;

const request: SanctionsScreeningRequest = {
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  fullName: 'Example Person',
  aliases: ['Example Alias'],
  dateOfBirth: '1980-01-01',
  nationality: 'AE',
  documentNumbers: ['784-1980-1234567-1'],
  jurisdiction: 'AE',
};

describe('ComplianceAdvisorService production screening guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    mockRedisSet.mockResolvedValue('OK');
    mockRedisGet.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('delegates production screening to the signed-list sanctions service', async () => {
    mockScreenEntity.mockResolvedValue({
      screeningId: 'screening-1',
      entityId: request.identityId,
      timestamp: '2026-05-03T00:00:00.000Z',
      overallRisk: 'potential_match',
      matches: [{
        matchId: 'match-1',
        listSource: 'ofac_sdn',
        listEntryId: 'entry-1',
        matchedName: 'Example Person',
        matchScore: 0.91,
        matchType: 'fuzzy',
        matchedFields: ['name'],
        listingDetails: {
          programs: ['asset_freeze'],
          listedDate: '2024-01-01',
          remarks: 'Potential sanctions match',
        },
        status: 'pending_review',
      }],
      listsScreened: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
      processingTimeMs: 12,
      nextScreeningDate: '2026-05-04T00:00:00.000Z',
    });

    const result = await new ComplianceAdvisorService().screenIdentity(request);

    expect(mockScreenEntity).toHaveBeenCalledWith(expect.objectContaining({
      entityId: request.identityId,
      entityType: 'individual',
      dateOfBirth: request.dateOfBirth,
      nationality: request.nationality,
      identifiers: [{
        type: 'national_id',
        value: request.documentNumbers![0],
        country: request.nationality,
      }],
    }));
    expect(mockScreenEntity).toHaveBeenCalledWith(expect.objectContaining({
      names: expect.arrayContaining([
        { fullName: request.fullName, nameType: 'primary', script: 'latin' },
        { fullName: request.aliases![0], nameType: 'alias', script: 'latin' },
      ]),
      screenAgainst: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
    }));
    expect(result).toMatchObject({
      identityId: request.identityId,
      result: 'potential_match',
      matchScore: 91,
      listsChecked: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
      unavailableChecks: ['adverse_media'],
    });
    expect(result.matchedLists).toEqual([
      expect.objectContaining({
        listSource: 'ofac_sdn',
        matchedName: 'Example Person',
        matchConfidence: 0.91,
      }),
    ]);
  });

  it('fails closed when production list data is not ready', async () => {
    const notReady = new Error('list data is not ready') as Error & { code: string };
    notReady.code = 'SANCTIONS_LIST_NOT_READY';
    mockScreenEntity.mockRejectedValue(notReady);

    await expect(new ComplianceAdvisorService().screenIdentity(request))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'PRODUCTION_SCREENING_UNAVAILABLE',
        statusCode: 503,
      });
  });

  it.each([
    {
      operation: () => new ComplianceAdvisorService().generateReport(
        request.identityId,
        'comprehensive',
        'AE',
      ),
      code: 'COMPLIANCE_REPORT_POLICY_UNCONFIGURED',
    },
    {
      operation: () => new ComplianceAdvisorService().queryComplianceAdvisor({
        question: 'What controls apply to this organization?',
        context: { jurisdiction: 'AE' },
      }),
      code: 'COMPLIANCE_ADVISOR_KB_UNCONFIGURED',
    },
    {
      operation: () => new ComplianceAdvisorService().assessRegulatoryChangeImpact(
        'Authority notice',
        'A material policy change requiring an approved scope mapping.',
        'AE',
      ),
      code: 'REGULATORY_IMPACT_POLICY_UNCONFIGURED',
    },
  ])('fails closed for ungoverned production compliance content: $code', async ({ operation, code }) => {
    await expect(operation()).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code,
      statusCode: 503,
    });
  });
});
