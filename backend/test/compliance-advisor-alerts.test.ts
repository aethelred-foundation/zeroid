interface StoredAlert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  entityId: string | null;
  entityType: string | null;
  actionRequired: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const database = new Map<string, StoredAlert>();
const cache = new Map<string, string>();
const mockComplianceAlertCreate = jest.fn(async ({ data }: { data: Partial<StoredAlert> }) => {
  const stored: StoredAlert = {
    id: data.id!,
    alertType: data.alertType!,
    severity: data.severity!,
    title: data.title!,
    description: data.description!,
    entityId: data.entityId ?? null,
    entityType: data.entityType ?? null,
    actionRequired: data.actionRequired ?? true,
    acknowledged: false,
    acknowledgedBy: null,
    resolvedAt: null,
    metadata: data.metadata ?? {},
    createdAt: new Date(),
  };
  database.set(stored.id, stored);
  return stored;
});
const mockComplianceAlertFindUnique = jest.fn(async ({ where }: { where: { id: string } }) =>
  database.get(where.id) ?? null,
);
const mockComplianceAlertFindMany = jest.fn(async ({ where }: {
  where: { resolvedAt: null; entityId: string | { not: null } };
}) => Array.from(database.values())
  .filter((alert) => alert.resolvedAt === null)
  .filter((alert) => typeof where.entityId === 'string'
    ? alert.entityId === where.entityId
    : alert.entityId !== null)
  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
const mockComplianceAlertUpdate = jest.fn(async ({ where, data }: {
  where: { id: string };
  data: Partial<StoredAlert>;
}) => {
  const current = database.get(where.id);
  if (!current) throw new Error('not found');
  const updated = { ...current, ...data } as StoredAlert;
  database.set(updated.id, updated);
  return updated;
});
const mockRedisSet = jest.fn(async (key: string, value: string) => {
  cache.set(key, value);
  return 'OK';
});

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    complianceAlert: {
      create: mockComplianceAlertCreate,
      findUnique: mockComplianceAlertFindUnique,
      findMany: mockComplianceAlertFindMany,
      update: mockComplianceAlertUpdate,
    },
  },
  redis: {
    set: mockRedisSet,
  },
}));

jest.mock('../src/services/compliance/sanctions-screening', () => ({
  SANCTIONS_LIST_NAMES: ['ofac_sdn'],
  sanctionsScreeningService: {
    screenEntity: jest.fn(),
  },
}));

import {
  ComplianceAdvisorError,
  ComplianceAdvisorService,
} from '../src/services/ai/compliance-advisor';

const entityId = '550e8400-e29b-41d4-a716-446655440000';

async function createAlert(
  service: ComplianceAdvisorService,
  level: 'info' | 'warning' | 'violation' | 'critical' = 'warning',
) {
  return service.createComplianceAlert(
    entityId,
    level,
    'sanctions',
    'Manual review required',
    'Potential sanctions match needs review',
    'FATF',
    'Escalate to compliance leadership',
  );
}

describe('Compliance advisor alert persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    database.clear();
    cache.clear();
  });

  it('shares active compliance alerts through Prisma across service instances', async () => {
    const writer = new ComplianceAdvisorService();
    const reader = new ComplianceAdvisorService();

    const alert = await createAlert(writer, 'critical');
    const activeAlerts = await reader.getActiveAlerts();

    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]).toMatchObject({
      alertId: alert.alertId,
      entityId,
      level: 'critical',
      category: 'sanctions',
    });
    expect(mockComplianceAlertCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'CRITICAL' }),
    });
    expect(mockComplianceAlertFindMany).toHaveBeenCalled();
  });

  it('persists alert acknowledgement for other nodes to observe', async () => {
    const alert = await createAlert(new ComplianceAdvisorService());

    const acknowledged = await new ComplianceAdvisorService().acknowledgeAlert(
      alert.alertId,
      '550e8400-e29b-41d4-a716-446655440001',
    );
    const visibleAlert = await new ComplianceAdvisorService().getAlert(alert.alertId);

    expect(acknowledged.acknowledgedAt).toBeInstanceOf(Date);
    expect(visibleAlert?.acknowledgedAt).toBeInstanceOf(Date);
    expect(mockComplianceAlertUpdate).toHaveBeenCalledWith({
      where: { id: alert.alertId },
      data: expect.objectContaining({
        acknowledged: true,
        acknowledgedBy: '550e8400-e29b-41d4-a716-446655440001',
      }),
    });
  });

  it('reads durable alerts after cache loss and service restart', async () => {
    const alert = await createAlert(new ComplianceAdvisorService());
    cache.clear();

    await expect(new ComplianceAdvisorService().getAlert(alert.alertId))
      .resolves
      .toMatchObject({ alertId: alert.alertId, entityId });
  });

  it('does not depend on Redis cache availability for durable alert creation', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('redis unavailable'));

    const alert = await createAlert(new ComplianceAdvisorService());

    await expect(new ComplianceAdvisorService().getAlert(alert.alertId))
      .resolves
      .toMatchObject({ alertId: alert.alertId });
  });

  it.each([
    ['info', 'LOW'],
    ['warning', 'MEDIUM'],
    ['violation', 'HIGH'],
    ['critical', 'CRITICAL'],
  ] as const)('maps %s alerts to the %s stored risk level', async (level, severity) => {
    await createAlert(new ComplianceAdvisorService(), level);

    expect(mockComplianceAlertCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ severity }),
    });
  });

  it('fails closed when an alert cannot be created in Prisma', async () => {
    mockComplianceAlertCreate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(createAlert(new ComplianceAdvisorService()))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'COMPLIANCE_ALERT_STORE_UNAVAILABLE',
        statusCode: 503,
      });
  });

  it('fails closed when active alerts cannot be listed from Prisma', async () => {
    mockComplianceAlertFindMany.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(new ComplianceAdvisorService().getActiveAlerts())
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'COMPLIANCE_ALERT_STORE_UNAVAILABLE',
        statusCode: 503,
      });
  });

  it('fails closed when an alert cannot be loaded from Prisma', async () => {
    mockComplianceAlertFindUnique.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(new ComplianceAdvisorService().getAlert('alert-1'))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'COMPLIANCE_ALERT_STORE_UNAVAILABLE',
        statusCode: 503,
      });
  });

  it('fails closed when durable alert metadata is malformed', async () => {
    const alert = await createAlert(new ComplianceAdvisorService());
    database.get(alert.alertId)!.metadata = {};

    await expect(new ComplianceAdvisorService().getAlert(alert.alertId))
      .rejects
      .toMatchObject<Partial<ComplianceAdvisorError>>({
        code: 'COMPLIANCE_ALERT_DATA_INVALID',
        statusCode: 503,
      });
  });

  it('does not acknowledge an alert when the Prisma update fails', async () => {
    const alert = await createAlert(new ComplianceAdvisorService());
    mockComplianceAlertUpdate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(new ComplianceAdvisorService().acknowledgeAlert(
      alert.alertId,
      '550e8400-e29b-41d4-a716-446655440001',
    )).rejects.toMatchObject<Partial<ComplianceAdvisorError>>({
      code: 'COMPLIANCE_ALERT_STORE_UNAVAILABLE',
      statusCode: 503,
    });

    await expect(new ComplianceAdvisorService().getAlert(alert.alertId))
      .resolves
      .toMatchObject({ acknowledgedAt: undefined });
  });
});
