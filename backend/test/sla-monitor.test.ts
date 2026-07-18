import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SLADefinitionSchema,
  SLAMonitor,
  SLADefinition,
} from '../src/services/enterprise/sla-monitor';

describe('SLAMonitor durability', () => {
  const tempDirs: string[] = [];

  const createTempStoreFile = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroid-sla-monitor-'));
    tempDirs.push(dir);
    return path.join(dir, 'state.json');
  };

  const definition: SLADefinition = {
    clientId: 'org-1',
    tier: 'enterprise',
    components: [{
      component: 'api_gateway',
      uptimeTarget: 99.9,
      latencyP50Ms: 100,
      latencyP95Ms: 200,
      latencyP99Ms: 300,
      errorRateTarget: 1,
    }],
    creditPercentages: {
      tier1: 10,
      tier2: 25,
      tier3: 50,
    },
    reportingIntervalDays: 30,
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('recovers configuration and samples without promoting them to SLA evidence', () => {
    const storeFile = createTempStoreFile();
    const writer = new SLAMonitor({ storeFile });

    writer.registerSLA(definition);
    writer.recordLatency('api_gateway', 500, false);
    writer.recordUptime('api_gateway', false, 1000);

    const reader = new SLAMonitor({ storeFile });

    expect(reader.getSLA('org-1')).toMatchObject({ tier: 'enterprise' });
    expect(reader.getUptime('api_gateway', 60_000)).toEqual({
      uptimePercentage: 0,
      totalChecks: 1,
      downChecks: 1,
    });
    expect(reader.getLatencyPercentiles('api_gateway', 60_000)).toEqual({
      p50: 500,
      p95: 500,
      p99: 500,
      count: 1,
      errorRate: 100,
    });

    for (const operation of [
      () => reader.generateReport('org-1'),
      () => reader.evaluateSLA('org-1'),
      () => reader.getViolations('org-1'),
      () => reader.getAlerts('org-1'),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({
          code: 'SLA_AUTHORITATIVE_TELEMETRY_UNAVAILABLE',
          statusCode: 503,
        }),
      );
    }
  });

  it('represents missing samples as unknown instead of perfect service', () => {
    const monitor = new SLAMonitor();

    expect(monitor.getUptime('api_gateway', 60_000)).toEqual({
      uptimePercentage: null,
      totalChecks: 0,
      downChecks: 0,
    });
    expect(monitor.getLatencyPercentiles('api_gateway', 60_000)).toEqual({
      p50: null,
      p95: null,
      p99: null,
      count: 0,
      errorRate: null,
    });
  });

  it('rejects report and evaluation claims backed only by process-local state', () => {
    const monitor = new SLAMonitor();
    monitor.registerSLA(definition);
    monitor.recordLatency('api_gateway', 25, true);
    monitor.recordUptime('api_gateway', true, 20);

    for (const operation of [
      () => monitor.generateReport('org-1'),
      () => monitor.evaluateSLA('org-1'),
      () => monitor.getViolations('org-1'),
      () => monitor.getAlerts('org-1'),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({
          code: 'SLA_AUTHORITATIVE_TELEMETRY_UNAVAILABLE',
          statusCode: 503,
        }),
      );
    }
  });

  it('does not treat a configured JSON store and injected samples as authoritative telemetry', () => {
    const storeFile = createTempStoreFile();
    const monitor = new SLAMonitor({ storeFile });
    monitor.registerSLA(definition);
    monitor.recordLatency('api_gateway', 25, true);
    monitor.recordUptime('api_gateway', true, 20);

    for (const operation of [
      () => monitor.generateReport('org-1'),
      () => monitor.evaluateSLA('org-1'),
      () => monitor.getViolations('org-1'),
      () => monitor.getAlerts('org-1'),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({
          code: 'SLA_AUTHORITATIVE_TELEMETRY_UNAVAILABLE',
          statusCode: 503,
        }),
      );
    }
  });

  it('rejects malformed samples before they can affect stored observations', () => {
    const storeFile = createTempStoreFile();
    const monitor = new SLAMonitor({ storeFile });
    monitor.registerSLA(definition);

    expect(() => monitor.recordLatency('api_gateway', -1, true)).toThrow(
      expect.objectContaining({ code: 'SLA_METRIC_SAMPLE_INVALID' }),
    );
    expect(() => monitor.recordUptime('api_gateway', true, Number.NaN)).toThrow(
      expect.objectContaining({ code: 'SLA_METRIC_SAMPLE_INVALID' }),
    );
  });

  it('requires explicit, internally consistent SLA contract terms', () => {
    expect(SLADefinitionSchema.safeParse({
      clientId: 'org-1',
      tier: 'enterprise',
      components: [],
      creditPercentages: { tier1: 10, tier2: 25, tier3: 50 },
      reportingIntervalDays: 30,
    }).success).toBe(false);

    expect(SLADefinitionSchema.safeParse({
      ...definition,
      components: [
        definition.components[0],
        definition.components[0],
      ],
    }).success).toBe(false);

    expect(SLADefinitionSchema.safeParse({
      ...definition,
      creditPercentages: { tier1: 50, tier2: 25, tier3: 10 },
    }).success).toBe(false);

    expect(SLADefinitionSchema.safeParse({
      ...definition,
      components: [{
        ...definition.components[0],
        proofGenerationTimeMs: 1000,
      }],
    }).success).toBe(false);
  });

  it('fails closed for production mutations without durable storage', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalZeroIdEnv = process.env.ZEROID_ENV;
    const originalStoreFile = process.env.SLA_MONITOR_STORE_FILE;

    process.env.NODE_ENV = 'production';
    delete process.env.ZEROID_ENV;
    delete process.env.SLA_MONITOR_STORE_FILE;

    try {
      const monitor = new SLAMonitor();
      expect(() => monitor.recordLatency('api_gateway', 25, true)).toThrow(
        'Durable SLA monitor store is required in production',
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalZeroIdEnv === undefined) delete process.env.ZEROID_ENV;
      else process.env.ZEROID_ENV = originalZeroIdEnv;
      if (originalStoreFile === undefined) delete process.env.SLA_MONITOR_STORE_FILE;
      else process.env.SLA_MONITOR_STORE_FILE = originalStoreFile;
    }
  });
});
