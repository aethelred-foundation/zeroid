const mockIdentityFindUnique = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
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

import { ComplianceCopilotService } from '../src/services/ai/compliance-copilot';

function identityFixture() {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    status: 'ACTIVE',
    teeAttested: true,
    credentials: [
      { id: 'credential-1', status: 'ACTIVE', issuedAt: new Date('2026-04-01T00:00:00.000Z') },
      { id: 'credential-2', status: 'ACTIVE', issuedAt: new Date('2026-04-02T00:00:00.000Z') },
    ],
  };
}

describe('Compliance report screening evidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityFindUnique.mockResolvedValue(identityFixture());
    mockRedisSet.mockResolvedValue('OK');
  });

  it('does not mark sanctions evidence as pass when latest screening is non-clear', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      screenedAt: new Date().toISOString(),
      result: 'potential_match',
      matchScore: 88,
      matchedLists: [{
        listName: 'OFAC SDN',
        listSource: 'ofac_sdn',
        matchedName: 'Example Person',
        matchConfidence: 0.88,
        entityType: 'individual',
        sanctions: ['asset_freeze'],
        listedSince: new Date('2024-01-01T00:00:00.000Z'),
        lastUpdated: new Date('2026-05-03T00:00:00.000Z'),
        sdnId: 'entry-1',
      }],
      pepMatches: [],
      listsChecked: ['ofac_sdn', 'eu_consolidated', 'un_sanctions', 'uae_local', 'pep_database'],
    }));

    const report = await new ComplianceCopilotService().generateReport(
      '550e8400-e29b-41d4-a716-446655440000',
      'comprehensive',
      'US',
    );

    expect(report.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Sanctions & Restrictive Measures',
        status: 'warning',
      }),
      expect.objectContaining({
        title: 'Anti-Money Laundering (AML)',
        status: 'warning',
      }),
    ]));
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'sanctions_screening_result',
        severity: 'violation',
      }),
    ]));
  });

  it('does not mark PEP evidence as pass when screening evidence is missing', async () => {
    mockRedisGet.mockResolvedValue(null);

    const report = await new ComplianceCopilotService().generateReport(
      '550e8400-e29b-41d4-a716-446655440000',
      'pep',
      'US',
    );

    expect(report.sections).toEqual([
      expect.objectContaining({
        title: 'Politically Exposed Persons (PEP)',
        status: 'warning',
      }),
    ]);
  });
});
