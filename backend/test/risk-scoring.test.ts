const mockLoggerWarn = jest.fn();

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: mockLoggerWarn,
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { RiskScoringService } from '../src/services/ai/risk-scoring';

describe('RiskScoringService fail-closed evidence contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['identity-1', 'identity'],
    ['credential-1', 'credential'],
    ['transaction-1', 'transaction'],
  ] as const)(
    'does not issue a %s assessment without authoritative durable evidence',
    async (entityId, entityType) => {
      await expect(
        new RiskScoringService().assessRisk(entityId, entityType, 'US'),
      ).rejects.toMatchObject({
        code: 'RISK_ASSESSMENT_EVIDENCE_UNAVAILABLE',
        statusCode: 503,
      });
    },
  );

  it('returns jurisdiction metadata without exposing mutable shared policy', () => {
    const service = new RiskScoringService();
    const first = service.getJurisdictionConfig('AE');
    first.thresholds.approve = 100;

    expect(service.getJurisdictionConfig('AE')).toMatchObject({
      code: 'AE',
      regulatoryRegime: 'CBUAE/VARA',
      thresholds: { approve: 18 },
    });
  });

  it('rejects runtime policy mutation while assessment is disabled', () => {
    expect(() =>
      new RiskScoringService().updateJurisdictionThresholds('US', {
        approve: 100,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RISK_POLICY_IMMUTABLE',
        statusCode: 503,
      }),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'risk_threshold_update_rejected',
      {
        reason: 'Risk scoring is disabled and jurisdiction policy is immutable',
      },
    );
  });
});
