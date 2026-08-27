const mockAuditLogCreate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockScreenEntity = jest.fn();
const mockComplianceScreeningCreate = jest.fn();
const mockTransaction = jest.fn(async (operation: (tx: unknown) => unknown) => operation({
  complianceScreening: { create: mockComplianceScreeningCreate },
  auditLog: { create: mockAuditLogCreate },
}));

jest.mock('../src/runtime', () => ({
  prisma: {
    $transaction: mockTransaction,
    complianceScreening: {
      create: mockComplianceScreeningCreate,
    },
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

function clearScreeningResult() {
  return {
    screeningId: 'screening-clear',
    entityId: request.identityId,
    timestamp: '2026-05-03T00:00:00.000Z',
    overallRisk: 'clear',
    matches: [],
    listsScreened: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
    processingTimeMs: 5,
    nextScreeningDate: '2026-05-04T00:00:00.000Z',
  };
}

describe('ComplianceAdvisorService production screening guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    mockRedisSet.mockResolvedValue('OK');
    mockRedisGet.mockResolvedValue(null);
    mockAuditLogCreate.mockResolvedValue({ id: 'audit-1' });
    mockComplianceScreeningCreate.mockResolvedValue({ id: 'screening-1' });
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
      unavailableChecks: ['adverse_media', 'pep_profile_enrichment'],
    });
    expect(result.matchedLists).toEqual([
      expect.objectContaining({
        listSource: 'ofac_sdn',
        matchedName: 'Example Person',
        matchConfidence: 0.91,
      }),
    ]);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: request.identityId,
        action: 'SANCTIONS_SCREENING',
        resourceId: 'screening-1',
      }),
    });
    expect(mockComplianceScreeningCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'screening-1',
        entityId: request.identityId,
        result: 'POTENTIAL_MATCH',
        listsChecked: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
      }),
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to demo records outside production', async () => {
    process.env.NODE_ENV = 'development';
    const notReady = new Error('list data is not ready') as Error & { code: string };
    notReady.code = 'SANCTIONS_LIST_NOT_READY';
    mockScreenEntity.mockRejectedValue(notReady);

    await expect(new ComplianceAdvisorService().screenIdentity(request))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'PRODUCTION_SCREENING_UNAVAILABLE',
        statusCode: 503,
      });
    expect(mockScreenEntity).toHaveBeenCalledTimes(1);
  });

  it('does not invent structured PEP attributes from a signed-list hit', async () => {
    mockScreenEntity.mockResolvedValue({
      screeningId: 'screening-pep',
      entityId: request.identityId,
      timestamp: '2026-05-03T00:00:00.000Z',
      overallRisk: 'potential_match',
      matches: [{
        matchId: 'match-pep',
        listSource: 'pep_database',
        listEntryId: 'pep-entry-1',
        matchedName: 'Example Person',
        matchScore: 0.91,
        matchType: 'fuzzy',
        matchedFields: ['name'],
        listingDetails: {
          programs: [],
          listedDate: '2024-01-01',
          remarks: '',
        },
        status: 'pending_review',
      }],
      listsScreened: ['pep_database'],
      processingTimeMs: 8,
      nextScreeningDate: '2026-05-04T00:00:00.000Z',
    });

    const result = await new ComplianceAdvisorService().screenIdentity(request);

    expect(result.pepMatches).toEqual([]);
    expect(result.matchedLists).toEqual([
      expect.objectContaining({
        listSource: 'pep_database',
        sdnId: 'pep-entry-1',
      }),
    ]);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({
          sanctionsMatches: 0,
          pepMatches: 1,
        }),
      }),
    });
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

  it('returns durable screening evidence when the Redis cache is unavailable', async () => {
    mockScreenEntity.mockResolvedValue(clearScreeningResult());
    mockRedisSet.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(new ComplianceAdvisorService().screenIdentity(request))
      .resolves
      .toMatchObject({ screeningId: 'screening-clear', result: 'clear' });
    expect(mockComplianceScreeningCreate).toHaveBeenCalled();
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });

  it('fails closed when the screening audit record cannot be written', async () => {
    mockScreenEntity.mockResolvedValue(clearScreeningResult());
    mockAuditLogCreate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(new ComplianceAdvisorService().screenIdentity(request))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'SCREENING_EVIDENCE_PERSISTENCE_UNAVAILABLE',
        statusCode: 503,
      });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('fails closed when the durable screening record cannot be written', async () => {
    mockScreenEntity.mockResolvedValue(clearScreeningResult());
    mockComplianceScreeningCreate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(new ComplianceAdvisorService().screenIdentity(request))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'SCREENING_EVIDENCE_PERSISTENCE_UNAVAILABLE',
        statusCode: 503,
      });
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
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
    {
      operation: () => new ComplianceAdvisorService().computeComplianceScore(
        request.identityId,
        'AE',
      ),
      code: 'COMPLIANCE_SCORING_POLICY_UNCONFIGURED',
    },
  ])('fails closed for ungoverned production compliance content: $code', async ({ operation, code }) => {
    await expect(operation()).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code,
      statusCode: 503,
    });
  });
});
