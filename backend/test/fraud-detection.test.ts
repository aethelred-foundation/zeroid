const mockAuditLogCreate = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisSadd = jest.fn();
const mockRedisScard = jest.fn();
const mockRedisLpush = jest.fn();
const mockRedisLtrim = jest.fn();
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
    lpush: mockRedisLpush,
    ltrim: mockRedisLtrim,
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
    mockRedisLpush.mockResolvedValue(1);
    mockRedisLtrim.mockResolvedValue('OK');
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
});
