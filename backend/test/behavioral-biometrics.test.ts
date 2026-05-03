const mockRedisSet = jest.fn();
const mockAuditLogCreate = jest.fn();

jest.mock('../src/index', () => ({
  prisma: {
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
  redis: {
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
  BehavioralBiometricsService,
  BiometricSession,
  KeystrokeEvent,
} from '../src/services/ai/behavioral-biometrics';

function sessionFixture(
  overrides: Partial<BiometricSession> = {},
): BiometricSession {
  return {
    sessionId: 'session-1',
    identityId: 'identity-1',
    keystrokes: [],
    mouseEvents: [],
    touchEvents: [],
    startedAt: new Date('2026-05-03T00:00:00.000Z'),
    userAgent: 'Mozilla/5.0',
    screenSize: { width: 1440, height: 900 },
    ...overrides,
  };
}

function keystrokesWithHumanVariation(): KeystrokeEvent[] {
  const base = Date.parse('2026-05-03T00:00:00.000Z');
  return [
    { key: 'z', downTimestamp: base, upTimestamp: base + 100 },
    { key: 'e', downTimestamp: base + 180, upTimestamp: base + 300 },
    { key: 'r', downTimestamp: base + 430, upTimestamp: base + 520 },
    { key: 'o', downTimestamp: base + 700, upTimestamp: base + 850 },
    { key: 'i', downTimestamp: base + 1000, upTimestamp: base + 1090 },
    { key: 'd', downTimestamp: base + 1300, upTimestamp: base + 1430 },
  ];
}

describe('BehavioralBiometricsService liveness guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails liveness and does not learn a template when no behavioral signal is present', async () => {
    const service = new BehavioralBiometricsService();

    const result = await service.processSession(sessionFixture());

    expect(result).toMatchObject({
      isLive: false,
      isBotLikely: false,
      confidence: 0,
      verdict: 'insufficient_data',
    });
    expect(result.details).toEqual(
      expect.arrayContaining([
        'Insufficient behavioral signal for liveness or template update',
        'Liveness check failed — possible replay or emulation attack',
      ]),
    );
    expect(
      (service as unknown as { templates: Map<string, unknown> }).templates.size,
    ).toBe(0);
    expect(service.getContinuousAuthScore('identity-1', 'session-1')).toMatchObject({
      score: 0,
      alerts: ['Insufficient behavioral signal on initial assessment'],
    });
  });

  it('learns a template when a session contains usable liveness signal', async () => {
    const service = new BehavioralBiometricsService();

    const result = await service.processSession(
      sessionFixture({ keystrokes: keystrokesWithHumanVariation() }),
    );

    expect(result.isLive).toBe(true);
    expect(result.isBotLikely).toBe(false);
    expect(result.details).not.toContain(
      'Insufficient behavioral signal for liveness or template update',
    );
    expect(
      (service as unknown as { templates: Map<string, unknown> }).templates.size,
    ).toBe(1);
  });
});
