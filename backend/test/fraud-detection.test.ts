const mockAuditLogCreate = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisSadd = jest.fn();
const mockRedisScard = jest.fn();
const mockRedisSismember = jest.fn();
const mockRedisLpush = jest.fn();
const mockRedisLtrim = jest.fn();
const mockRedisZadd = jest.fn();
const mockRedisZremrangebyscore = jest.fn();
const mockRedisZcard = jest.fn();
const mockRedisZrangebyscore = jest.fn();
const mockRedisSmembers = jest.fn();
const mockRedisSrem = jest.fn();
const mockCredentialFindMany = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    auditLog: {
      create: mockAuditLogCreate,
    },
    credential: {
      findMany: mockCredentialFindMany,
    },
  },
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    sadd: mockRedisSadd,
    scard: mockRedisScard,
    sismember: mockRedisSismember,
    lpush: mockRedisLpush,
    ltrim: mockRedisLtrim,
    zadd: mockRedisZadd,
    zremrangebyscore: mockRedisZremrangebyscore,
    zcard: mockRedisZcard,
    zrangebyscore: mockRedisZrangebyscore,
    smembers: mockRedisSmembers,
    srem: mockRedisSrem,
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  CredentialUsageContext,
  DeviceFingerprint,
  FraudDetectionService,
} from '../src/services/ai/fraud-detection';

const deviceFingerprint: DeviceFingerprint = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  screenResolution: '1440x900',
  timezone: 'Asia/Dubai',
  language: 'en-US',
  platform: 'MacIntel',
  canvasHash: 'canvas-1',
  webglHash: 'webgl-1',
  audioContextHash: 'audio-1',
  fontList: ['Arial', 'Helvetica'],
  cpuCores: 8,
  deviceMemory: 8,
  hardwareConcurrency: 8,
  touchSupport: false,
  installedPlugins: [],
};

function usageContext(
  overrides: Partial<CredentialUsageContext> = {},
): CredentialUsageContext {
  return {
    identityId: 'identity-1',
    credentialId: 'credential-1',
    timestamp: new Date('2026-05-03T12:00:00.000Z'),
    ipAddress: '203.0.113.10',
    deviceFingerprint,
    actionType: 'verify',
    ...overrides,
  };
}

describe('FraudDetectionService explicit risk guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisSadd.mockResolvedValue(1);
    mockRedisScard.mockResolvedValue(1);
    mockRedisSismember.mockResolvedValue(0);
    mockRedisLpush.mockResolvedValue(1);
    mockRedisLtrim.mockResolvedValue('OK');
    mockRedisZadd.mockResolvedValue(1);
    mockRedisZremrangebyscore.mockResolvedValue(0);
    mockRedisZcard.mockResolvedValue(1);
    mockRedisZrangebyscore.mockResolvedValue([]);
    mockRedisSmembers.mockResolvedValue([]);
    mockRedisSrem.mockResolvedValue(1);
    mockCredentialFindMany.mockResolvedValue([]);
  });

  it('blocks critical explicit factors even when composite blending would dilute them', async () => {
    const service = new FraudDetectionService();

    const assessment = await service.assessFraudRisk(usageContext({
      biometricSignals: {
        touchPressures: [0, 0, 0, 0],
      },
    }));

    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'touch_pressure_analysis',
        score: 90,
      }),
    ]));
    expect(assessment.overallScore).toBeGreaterThanOrEqual(85);
    expect(assessment.severity).toBe('critical');
    expect(assessment.decision).toBe('block');
  });

  it('queues high explicit factors for review instead of allowing model downgrade', async () => {
    const service = new FraudDetectionService();

    const assessment = await service.assessFraudRisk(usageContext({
      biometricSignals: {
        keystrokeDwellTimes: [100, 100, 100, 100, 100, 100],
      },
    }));

    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'keystroke_uniformity',
        score: 85,
      }),
    ]));
    expect(assessment.overallScore).toBeGreaterThanOrEqual(70);
    expect(assessment.severity).toBe('high');
    expect(assessment.decision).toBe('review');
  });

  it('uses Redis-backed velocity windows for abuse detection', async () => {
    mockRedisZcard
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const service = new FraudDetectionService();

    const assessment = await service.assessFraudRisk(usageContext());

    expect(mockRedisZadd).toHaveBeenCalledWith(
      'velocity:identity-1:1min',
      expect.any(Number),
      expect.any(String),
    );
    expect(assessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'velocity_1min',
      }),
    ]));
  });

  it('loads active alerts from Redis for multi-node readers', async () => {
    const alert = {
      alertId: 'alert-1',
      assessmentId: 'assessment-1',
      identityId: 'identity-1',
      severity: 'high',
      title: 'High fraud risk',
      description: 'Review required',
      status: 'active',
      riskScore: 75,
      factors: [],
      createdAt: '2026-05-03T12:00:00.000Z',
      updatedAt: '2026-05-03T12:00:00.000Z',
    };
    mockRedisSmembers.mockResolvedValue(['alert-1']);
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(alert));
    const service = new FraudDetectionService();

    const alerts = await service.getActiveAlerts('high');

    expect(mockRedisSmembers).toHaveBeenCalledWith('fraud:alerts:active:set');
    expect(mockRedisGet).toHaveBeenCalledWith('fraud:alert:alert-1');
    expect(alerts).toEqual([
      expect.objectContaining({
        alertId: 'alert-1',
        severity: 'high',
        createdAt: new Date('2026-05-03T12:00:00.000Z'),
      }),
    ]);
  });
});
