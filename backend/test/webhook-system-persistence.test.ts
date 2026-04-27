const mockWebhookCreate = jest.fn();
const mockWebhookFindMany = jest.fn();
const mockWebhookFindFirst = jest.fn();
const mockWebhookFindUnique = jest.fn();
const mockWebhookUpdate = jest.fn();

const redisStore: Record<string, string> = {};
const redisSortedSets: Record<
  string,
  Array<{ score: number; member: string }>
> = {};
const originalWebhookSecretEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

const mockRedisEval = jest.fn(
  async (_script: string, numKeys: number, ...args: unknown[]) => {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys);

    if (keys[0]?.startsWith('enterprise:webhook-rate:')) {
      const cutoff = Number(argv[0]);
      const score = Number(argv[1]);
      const member = String(argv[2]);
      const limit = Number(argv[3]);
      const current = (redisSortedSets[keys[0]] ?? []).filter(
        (entry) => entry.score > cutoff,
      );

      if (current.length >= limit) {
        redisSortedSets[keys[0]] = current;
        return 0;
      }

      current.push({ score, member });
      redisSortedSets[keys[0]] = current;
      return 1;
    }

    throw new Error(`Unexpected Redis eval key: ${keys[0]}`);
  },
);

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
    eval: mockRedisEval,
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

import { WebhookSystem, webhookSystem } from '../src/services/enterprise/webhook-system';

describe('WebhookSystem persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(redisStore)) delete redisStore[key];
    for (const key of Object.keys(redisSortedSets)) delete redisSortedSets[key];
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  });

  afterAll(() => {
    if (originalWebhookSecretEncryptionKey === undefined) {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookSecretEncryptionKey;
    }
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
    const storedSecret = mockWebhookCreate.mock.calls[0][0].data.secret;
    expect(storedSecret).toMatch(/^local:v1:/);
    expect(storedSecret).not.toBe(webhook.secret);
    expect(webhook.clientId).toBe('org-1');
    expect(webhook.description).toBe('primary sink');
    expect(JSON.parse(redisStore[`enterprise:webhook-config:${webhook.id}`] as string)).toMatchObject({
      description: 'primary sink',
      metadata: { owner: 'platform' },
      headers: { 'x-tenant': 'org-1' },
    });
  });

  it('encrypts new webhook secrets when an envelope key is configured', async () => {
    const previousKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

    try {
      const createdAt = new Date('2026-04-21T00:00:00.000Z');
      const updatedAt = new Date('2026-04-21T00:00:00.000Z');
      const rawSecret = 's'.repeat(64);

      mockWebhookCreate.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt,
        updatedAt,
        lastDeliveredAt: null,
        lastStatusCode: null,
      }));

      const webhook = await webhookSystem.register('org-1', {
        url: 'https://hooks.zeroid.example/encrypted',
        events: ['credential.issued'],
        secret: rawSecret,
      });

      const storedSecret = mockWebhookCreate.mock.calls[0][0].data.secret;
      expect(storedSecret).toMatch(/^enc:v1:/);
      expect(storedSecret).not.toContain(rawSecret);
      expect(webhook.secret).toBe(rawSecret);
    } finally {
      if (previousKey === undefined) {
        delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      } else {
        process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = previousKey;
      }
    }
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

  it('enforces webhook subscriber rate limits in redis before delivery', async () => {
    const now = Date.now();
    redisSortedSets['enterprise:webhook-rate:wh-rate'] = Array.from(
      { length: 100 },
      (_, index) => ({ score: now, member: `existing-${index}` }),
    );

    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-rate',
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/ingest',
        secret: 's'.repeat(64),
        events: ['credential.issued'],
        status: 'ACTIVE',
        failureCount: 0,
        lastDeliveredAt: null,
        lastStatusCode: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);
    redisStore['enterprise:webhook-config:wh-rate'] = JSON.stringify({
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
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));

    const deliveryIds = await webhookSystem.emit('credential.issued', {
      credentialId: 'cred-1',
    });

    expect(deliveryIds).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects malformed webhook signatures without throwing', () => {
    expect(
      WebhookSystem.verifySignature(
        '{"ok":true}',
        't=not-a-number,v1=abc',
        's'.repeat(64),
      ),
    ).toBe(false);
    expect(
      WebhookSystem.verifySignature(
        '{"ok":true}',
        't=1760000000,v1=abc',
        's'.repeat(64),
        Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(false);
  });
});
