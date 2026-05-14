import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SLAMonitor, SLADefinition } from '../src/services/enterprise/sla-monitor';

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

  it('recovers SLA definitions, metrics, violations, acknowledgements, and alerts', () => {
    const storeFile = createTempStoreFile();
    const writer = new SLAMonitor({ storeFile });

    writer.registerSLA(definition);
    writer.recordLatency('api_gateway', 500, false);
    writer.recordUptime('api_gateway', false, 1000);
    const violations = writer.evaluateSLA('org-1', 60 * 60 * 1000);

    expect(violations.length).toBeGreaterThan(0);
    expect(writer.acknowledgeViolation(violations[0].id)).toBe(true);

    const reader = new SLAMonitor({ storeFile });
    const recoveredViolations = reader.getViolations('org-1');
    const report = reader.generateReport('org-1', 1);

    expect(reader.getSLA('org-1')).toMatchObject({ tier: 'enterprise' });
    expect(recoveredViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: violations[0].id, acknowledged: true }),
      ]),
    );
    expect(reader.getAlerts('org-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'critical' }),
        expect.objectContaining({ severity: 'high' }),
      ]),
    );
    expect(report).toMatchObject({
      clientId: 'org-1',
      overallCompliance: false,
      components: [
        expect.objectContaining({
          component: 'api_gateway',
          totalRequests: 1,
          totalErrors: 1,
        }),
      ],
    });
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
