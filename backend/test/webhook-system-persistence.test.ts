const mockWebhookCreate = jest.fn();
const mockWebhookFindMany = jest.fn();
const mockWebhookFindFirst = jest.fn();
const mockWebhookFindUnique = jest.fn();
const mockWebhookUpdate = jest.fn();

const redisStore: Record<string, string> = {};

jest.mock('../src/index', () => ({
  prisma: {
    webhook: {
      create: mockWebhookCreate,
      findMany: mockWebhookFindMany,
      findFirst: mockWebhookFindFirst,
      findUnique: mockWebhookFindUnique,
      update: mockWebhookUpdate,
    },
  },
  redis: {
    get: jest.fn(async (key: string) => redisStore[key] ?? null),
    set: jest.fn(async (key: string, value: string) => {
      redisStore[key] = value;
      return 'OK';
    }),
  },
}));

jest.mock('winston', () => {
  const noop = jest.fn();
  return {
    createLogger: jest.fn(() => ({ info: noop, warn: noop, error: noop, debug: noop })),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      json: jest.fn(),
    },
    transports: { Console: jest.fn() },
  };
}, { virtual: true });

import { webhookSystem } from '../src/services/enterprise/webhook-system';

describe('WebhookSystem persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(redisStore)) delete redisStore[key];
  });

  it('registers an organization-owned webhook and persists extended config in redis', async () => {
    const createdAt = new Date('2026-04-21T00:00:00.000Z');
    const updatedAt = new Date('2026-04-21T00:00:00.000Z');

    mockWebhookCreate.mockImplementation(async ({ data }: any) => ({
      ...data,
      createdAt,
      updatedAt,
      lastDeliveredAt: null,
      lastStatusCode: null,
    }));

    const webhook = await webhookSystem.register('org-1', {
      url: 'https://hooks.zeroid.example/ingest',
      events: ['credential.issued'],
      description: 'primary sink',
      headers: { 'x-tenant': 'org-1' },
      metadata: { owner: 'platform' },
    });

    expect(mockWebhookCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/ingest',
        status: 'ACTIVE',
      }),
    }));
    expect(webhook.clientId).toBe('org-1');
    expect(webhook.description).toBe('primary sink');
    expect(JSON.parse(redisStore[`enterprise:webhook-config:${webhook.id}`] as string)).toMatchObject({
      description: 'primary sink',
      metadata: { owner: 'platform' },
      headers: { 'x-tenant': 'org-1' },
    });
  });

  it('lists persisted webhooks for one organization only', async () => {
    const createdAt = new Date('2026-04-21T00:00:00.000Z');
    const updatedAt = new Date('2026-04-22T00:00:00.000Z');

    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-1',
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/ingest',
        secret: 's'.repeat(64),
        events: ['credential.issued'],
        status: 'ACTIVE',
        failureCount: 0,
        lastDeliveredAt: null,
        lastStatusCode: null,
        createdAt,
        updatedAt,
      },
    ]);

    redisStore['enterprise:webhook-config:wh-1'] = JSON.stringify({
      description: 'primary sink',
      metadata: { owner: 'platform' },
      batchDelivery: false,
      batchIntervalMs: 5000,
      headers: { 'x-tenant': 'org-1' },
      health: {
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastStatusCode: null,
        totalDelivered: 0,
        totalFailed: 0,
        averageLatencyMs: 0,
        disabled: false,
        disabledReason: null,
      },
    });

    const webhooks = await webhookSystem.list('org-1');

    expect(mockWebhookFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
    }));
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]).toMatchObject({
      id: 'wh-1',
      clientId: 'org-1',
      description: 'primary sink',
      active: true,
    });
  });

  it('disables a webhook within the owning organization instead of trusting in-memory ownership', async () => {
    mockWebhookFindFirst.mockResolvedValue({
      id: 'wh-1',
      organizationId: 'org-1',
      status: 'ACTIVE',
      lastStatusCode: null,
    });

    redisStore['enterprise:webhook-config:wh-1'] = JSON.stringify({
      description: 'primary sink',
      metadata: {},
      batchDelivery: false,
      batchIntervalMs: 5000,
      headers: {},
      health: {
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastStatusCode: null,
        totalDelivered: 0,
        totalFailed: 0,
        averageLatencyMs: 0,
        disabled: false,
        disabledReason: null,
      },
    });

    await webhookSystem.remove('wh-1', 'org-1');

    expect(mockWebhookUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'wh-1' },
      data: { status: 'DISABLED' },
    }));
    expect(JSON.parse(redisStore['enterprise:webhook-config:wh-1'] as string)).toMatchObject({
      health: expect.objectContaining({
        disabled: true,
        disabledReason: 'Webhook removed by organization',
      }),
    });
  });
});
