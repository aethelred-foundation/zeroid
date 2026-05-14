const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();

const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  sadd: jest.fn(async (key: string, value: string) => {
    const set = redisSets.get(key) ?? new Set<string>();
    set.add(value);
    redisSets.set(key, set);
    return 1;
  }),
  srem: jest.fn(async (key: string, value: string) => {
    const set = redisSets.get(key);
    if (!set) return 0;
    const deleted = set.delete(value);
    return deleted ? 1 : 0;
  }),
  smembers: jest.fn(async (key: string) => Array.from(redisSets.get(key) ?? [])),
  expire: jest.fn(async () => 1),
};

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    credential: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
  redis: mockRedis,
}));

jest.mock('../src/services/compliance/sanctions-screening', () => ({
  SANCTIONS_LIST_NAMES: ['ofac_sdn'],
  sanctionsScreeningService: {
    screenEntity: jest.fn(),
  },
}));

import { ComplianceAdvisorService } from '../src/services/ai/compliance-advisor';

describe('Compliance advisor alert persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    redisSets.clear();
  });

  it('shares active compliance alerts through Redis across service instances', async () => {
    const writer = new ComplianceAdvisorService();
    const reader = new ComplianceAdvisorService();

    const alert = await writer.createComplianceAlert(
      '550e8400-e29b-41d4-a716-446655440000',
      'critical',
      'sanctions',
      'Manual review required',
      'Potential sanctions match needs review',
      'FATF',
      'Escalate to compliance leadership',
    );

    const activeAlerts = await reader.getActiveAlerts();

    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]).toMatchObject({
      alertId: alert.alertId,
      entityId: '550e8400-e29b-41d4-a716-446655440000',
      level: 'critical',
      category: 'sanctions',
    });
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'compliance:alerts:active',
      alert.alertId,
    );
  });

  it('persists alert acknowledgement for other nodes to observe', async () => {
    const writer = new ComplianceAdvisorService();
    const acknowledger = new ComplianceAdvisorService();
    const reader = new ComplianceAdvisorService();

    const alert = await writer.createComplianceAlert(
      '550e8400-e29b-41d4-a716-446655440000',
      'warning',
      'kyc',
      'Evidence gap',
      'Identity needs additional evidence',
      'BSA',
      'Collect proof of address',
    );

    const acknowledged = await acknowledger.acknowledgeAlert(
      alert.alertId,
      '550e8400-e29b-41d4-a716-446655440001',
    );
    const [visibleAlert] = await reader.getActiveAlerts();

    expect(acknowledged.acknowledgedAt).toBeInstanceOf(Date);
    expect(visibleAlert.alertId).toBe(alert.alertId);
    expect(visibleAlert.acknowledgedAt).toBeInstanceOf(Date);
  });

  it('removes stale active-set entries when the alert payload is missing', async () => {
    redisSets.set('compliance:alerts:active', new Set(['missing-alert']));

    const service = new ComplianceAdvisorService();
    const activeAlerts = await service.getActiveAlerts();

    expect(activeAlerts).toEqual([]);
    expect(mockRedis.srem).toHaveBeenCalledWith(
      'compliance:alerts:active',
      'missing-alert',
    );
  });
});
