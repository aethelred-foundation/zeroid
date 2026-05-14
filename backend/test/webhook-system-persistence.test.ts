import { promises as dns } from 'dns';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import * as https from 'https';

const mockWebhookCreate = jest.fn();
const mockWebhookFindMany = jest.fn();
const mockWebhookFindFirst = jest.fn();
const mockWebhookFindUnique = jest.fn();
const mockWebhookUpdate = jest.fn();
const mockWebhookDeliveryFindMany = jest.fn();
const mockWebhookDeliveryFindUnique = jest.fn();
const mockWebhookDeliveryUpsert = jest.fn();

const redisStore: Record<string, string> = {};
const redisSortedSets: Record<
  string,
  Array<{ score: number; member: string }>
> = {};
const redisLists: Record<string, string[]> = {};
const originalWebhookSecretEncryptionKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const originalZeroidEnv = process.env.ZEROID_ENV;

function encryptWebhookSecretForTest(secret: string, key = Buffer.alloc(32, 9)): string {
  const iv = Buffer.alloc(12, 1);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('zeroid:webhook-secret:v1'));
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

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
    webhookDelivery: {
      findMany: mockWebhookDeliveryFindMany,
      findUnique: mockWebhookDeliveryFindUnique,
      upsert: mockWebhookDeliveryUpsert,
    },
  },
  redis: {
    get: jest.fn(async (key: string) => redisStore[key] ?? null),
    set: jest.fn(async (key: string, value: string) => {
      redisStore[key] = value;
      return 'OK';
    }),
    lpush: jest.fn(async (key: string, value: string) => {
      redisLists[key] = [value, ...(redisLists[key] ?? [])];
      return redisLists[key].length;
    }),
    ltrim: jest.fn(async (key: string, start: number, stop: number) => {
      redisLists[key] = (redisLists[key] ?? []).slice(start, stop + 1);
      return 'OK';
    }),
    lrange: jest.fn(async (key: string, start: number, stop: number) =>
      (redisLists[key] ?? []).slice(start, stop + 1),
    ),
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

jest.mock('https', () => ({
  request: jest.fn(),
}));

import { WebhookSystem, webhookSystem } from '../src/services/enterprise/webhook-system';

describe('WebhookSystem persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(redisStore)) delete redisStore[key];
    for (const key of Object.keys(redisSortedSets)) delete redisSortedSets[key];
    for (const key of Object.keys(redisLists)) delete redisLists[key];
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
    delete process.env.ZEROID_ENV;
  });

  afterAll(() => {
    if (originalWebhookSecretEncryptionKey === undefined) {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalWebhookSecretEncryptionKey;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalZeroidEnv === undefined) {
      delete process.env.ZEROID_ENV;
    } else {
      process.env.ZEROID_ENV = originalZeroidEnv;
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

  it('rejects low-diversity caller-supplied webhook secrets', async () => {
    await expect(webhookSystem.register('org-1', {
      url: 'https://hooks.zeroid.example/weak-secret',
      events: ['credential.issued'],
      secret: 'a'.repeat(64),
    })).rejects.toThrow();

    expect(mockWebhookCreate).not.toHaveBeenCalled();
  });

  it('rejects unsafe production webhook endpoints before persistence', async () => {
    process.env.NODE_ENV = 'production';

    await expect(webhookSystem.register('org-1', {
      url: 'http://hooks.zeroid.example/ingest',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://127.0.0.1/internal',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://100.64.0.5/internal',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://[::1]/internal',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://[::ffff:0a00:0005]/internal',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://metadata.google.internal/compute',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://webhook/ingest',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    await expect(webhookSystem.register('org-1', {
      url: 'https://user:pass@hooks.zeroid.com/ingest',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    expect(mockWebhookCreate).not.toHaveBeenCalled();
  });

  it('uses ZeroID production runtime for webhook endpoint validation', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ZEROID_ENV = 'production';

    await expect(webhookSystem.register('org-1', {
      url: 'http://hooks.zeroid.example/ingest',
      events: ['verification.completed'],
    })).rejects.toThrow(/Webhook URL/);

    expect(mockWebhookCreate).not.toHaveBeenCalled();
  });

  it('rejects custom headers that would override delivery authenticity metadata', async () => {
    await expect(webhookSystem.register('org-1', {
      url: 'https://hooks.zeroid.example/ingest',
      events: ['credential.issued'],
      headers: {
        'X-ZeroID-Signature': 'override',
      },
    })).rejects.toThrow(/platform delivery headers/);

    expect(mockWebhookCreate).not.toHaveBeenCalled();
  });

  it('encrypts new webhook secrets when an envelope key is configured', async () => {
    const previousKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

    try {
      const createdAt = new Date('2026-04-21T00:00:00.000Z');
      const updatedAt = new Date('2026-04-21T00:00:00.000Z');
      const rawSecret = 'whsec_A1b2C3d4E5f6G7h8I9j0K1l2M3n4P5q6';

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
    }, 'org-1');

    expect(deliveryIds).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('delivers emitted events only to webhooks owned by the event organization', async () => {
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-org-1',
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/org-1',
        secret: 's'.repeat(64),
        events: ['credential.issued'],
        status: 'ACTIVE',
        failureCount: 0,
        lastDeliveredAt: null,
        lastStatusCode: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
      {
        id: 'wh-org-2',
        organizationId: 'org-2',
        url: 'https://hooks.zeroid.example/org-2',
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
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const deliveryIds = await webhookSystem.emit('credential.issued', {
      credentialId: 'cred-1',
    }, 'org-1');

    expect(mockWebhookFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(deliveryIds).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hooks.zeroid.example/org-1');
    expect(redisLists['enterprise:webhook-events:org-1']).toHaveLength(1);
    expect(JSON.parse(redisLists['enterprise:webhook-events:org-1'][0])).toMatchObject({
      clientId: 'org-1',
      eventType: 'credential.issued',
    });
    expect(redisLists['enterprise:webhook-events:org-2']).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('blocks production delivery when webhook DNS resolves to private infrastructure', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-private-resolution',
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/private',
        secret: encryptWebhookSecretForTest('s'.repeat(64)),
        events: ['credential.issued'],
        status: 'ACTIVE',
        failureCount: 0,
        lastDeliveredAt: null,
        lastStatusCode: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const dnsSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    try {
      const deliveryIds = await webhookSystem.emit('credential.issued', {
        credentialId: 'cred-1',
      }, 'org-1');

      expect(deliveryIds).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(webhookSystem.getDelivery(deliveryIds[0])).toMatchObject({
        status: 'dead_letter',
        attempts: 1,
        response: expect.objectContaining({
          statusCode: 0,
          body: 'Webhook hostname resolved to a localhost or private network address.',
        }),
      });
      expect(mockWebhookDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          webhookId: 'wh-private-resolution',
          success: false,
          responseBody: 'Webhook hostname resolved to a localhost or private network address.',
        }),
      }));
    } finally {
      dnsSpy.mockRestore();
      fetchSpy.mockRestore();
      process.env.NODE_ENV = 'test';
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    }
  });

  it('pins vetted DNS address during production webhook delivery', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-pinned-resolution',
        organizationId: 'org-1',
        url: 'https://hooks.zeroid.example/pinned',
        secret: encryptWebhookSecretForTest('s'.repeat(64)),
        events: ['credential.issued'],
        status: 'ACTIVE',
        failureCount: 0,
        lastDeliveredAt: null,
        lastStatusCode: null,
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        updatedAt: new Date('2026-04-21T00:00:00.000Z'),
      },
    ]);
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const dnsSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const httpsRequestMock = https.request as jest.Mock;
    let capturedOptions: https.RequestOptions | undefined;
    let capturedBody = '';
    httpsRequestMock.mockImplementation(
      (url: URL, options: https.RequestOptions, callback: (response: any) => void) => {
        expect(url.href).toBe('https://hooks.zeroid.example/pinned');
        capturedOptions = options;

        const request = new EventEmitter() as any;
        request.write = jest.fn((chunk: string | Buffer) => {
          capturedBody += chunk.toString();
          return true;
        });
        request.end = jest.fn(() => {
          const response = new EventEmitter() as any;
          response.statusCode = 200;
          process.nextTick(() => {
            callback(response);
            response.emit('data', 'ok');
            response.emit('end');
          });
        });
        request.destroy = jest.fn((err?: Error) => {
          if (err) request.emit('error', err);
        });
        return request;
      },
    );

    try {
      const deliveryIds = await webhookSystem.emit('credential.issued', {
        credentialId: 'cred-1',
      }, 'org-1');

      expect(deliveryIds).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsRequestMock).toHaveBeenCalledTimes(1);
      expect(capturedBody).toContain('"credentialId":"cred-1"');
      expect(capturedOptions?.servername).toBe('hooks.zeroid.example');
      expect(capturedOptions?.lookup).toEqual(expect.any(Function));

      const lookup = capturedOptions!.lookup as any;
      await new Promise<void>((resolve, reject) => {
        lookup('hooks.zeroid.example', {}, (err: Error | null, address: string, family: number) => {
          try {
            expect(err).toBeNull();
            expect(address).toBe('93.184.216.34');
            expect(family).toBe(4);
            resolve();
          } catch (lookupErr) {
            reject(lookupErr);
          }
        });
      });
      expect(webhookSystem.getDelivery(deliveryIds[0])).toMatchObject({
        status: 'delivered',
        response: expect.objectContaining({
          statusCode: 200,
          body: 'ok',
        }),
      });
    } finally {
      httpsRequestMock.mockReset();
      dnsSpy.mockRestore();
      fetchSpy.mockRestore();
      process.env.NODE_ENV = 'test';
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    }
  });

  it('persists successful delivery attempts to the durable delivery log', async () => {
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-deliver',
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
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const deliveryIds = await webhookSystem.emit('credential.issued', {
      credentialId: 'cred-1',
    }, 'org-1');

    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(deliveryIds).toHaveLength(1);
    expect(request.redirect).toBe('manual');
    expect(mockWebhookDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: deliveryIds[0] },
      create: expect.objectContaining({
        id: deliveryIds[0],
        webhookId: 'wh-deliver',
        eventType: 'credential.issued',
        statusCode: 200,
        responseBody: 'ok',
        success: true,
      }),
      update: expect.objectContaining({
        statusCode: 200,
        responseBody: 'ok',
        success: true,
      }),
    }));
    fetchSpy.mockRestore();
  });

  it('captures only a bounded webhook response preview', async () => {
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-large-response',
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
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    let streamCanceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(2048)));
      },
      cancel() {
        streamCanceled = true;
      },
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(stream, { status: 200 }));

    const deliveryIds = await webhookSystem.emit('credential.issued', {
      credentialId: 'cred-1',
    }, 'org-1');

    expect(deliveryIds).toHaveLength(1);
    expect(mockWebhookDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        responseBody: 'x'.repeat(1024),
        success: true,
      }),
    }));
    expect(streamCanceled).toBe(true);
    fetchSpy.mockRestore();
  });

  it('keeps platform delivery headers authoritative over persisted custom headers', async () => {
    mockWebhookFindMany.mockResolvedValue([
      {
        id: 'wh-headers',
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
    redisStore['enterprise:webhook-config:wh-headers'] = JSON.stringify({
      description: 'primary sink',
      metadata: {},
      batchDelivery: false,
      batchIntervalMs: 5000,
      headers: {
        'content-type': 'text/plain',
        'x-tenant': 'org-1',
        'x-zeroid-signature': 'override',
      },
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
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const deliveryIds = await webhookSystem.emit('credential.issued', {
      credentialId: 'cred-1',
    }, 'org-1');

    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(deliveryIds).toHaveLength(1);
    expect(headers['x-tenant']).toBe('org-1');
    expect(headers['content-type']).toBeUndefined();
    expect(headers['x-zeroid-signature']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-ZeroID-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    expect(headers['X-ZeroID-Delivery']).toBe(deliveryIds[0]);
    fetchSpy.mockRestore();
  });

  it('stores replay events in redis and replays matching events after ownership check', async () => {
    const createdAt = new Date('2026-04-21T00:00:00.000Z');
    const updatedAt = new Date('2026-04-21T00:00:00.000Z');
    mockWebhookFindFirst.mockResolvedValue({
      id: 'wh-replay',
      organizationId: 'org-1',
      url: 'https://hooks.zeroid.example/replay',
      secret: 's'.repeat(64),
      events: ['credential.issued'],
      status: 'ACTIVE',
      failureCount: 0,
      lastDeliveredAt: null,
      lastStatusCode: null,
      createdAt,
      updatedAt,
    });
    redisLists['enterprise:webhook-events:org-1'] = [
      JSON.stringify({
        eventId: 'event-ignore',
        clientId: 'org-1',
        eventType: 'verification.failed',
        timestamp: '2026-04-21T10:00:00.000Z',
        data: { verificationId: 'ver-1' },
        source: 'zeroid',
      }),
      JSON.stringify({
        eventId: 'event-replay',
        clientId: 'org-1',
        eventType: 'credential.issued',
        timestamp: '2026-04-21T10:00:00.000Z',
        data: { credentialId: 'cred-1' },
        source: 'zeroid',
      }),
      JSON.stringify({
        eventId: 'event-wrong-org-in-same-list',
        clientId: 'org-2',
        eventType: 'credential.issued',
        timestamp: '2026-04-21T10:00:00.000Z',
        data: { credentialId: 'cred-2' },
        source: 'zeroid',
      }),
    ];
    redisLists['enterprise:webhook-events:org-2'] = [
      JSON.stringify({
        eventId: 'event-wrong-org-list',
        clientId: 'org-2',
        eventType: 'credential.issued',
        timestamp: '2026-04-21T10:00:00.000Z',
        data: { credentialId: 'cred-3' },
        source: 'zeroid',
      }),
    ];
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await webhookSystem.replayEvents(
      'wh-replay',
      '2026-04-21T00:00:00.000Z',
      '2026-04-22T00:00:00.000Z',
      'org-1',
    );

    expect(result.replayed).toBe(1);
    expect(result.deliveryIds).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockWebhookDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        webhookId: 'wh-replay',
        eventType: 'credential.issued',
      }),
    }));
    fetchSpy.mockRestore();
  });

  it('requires organization ownership before returning delivery logs', async () => {
    mockWebhookFindFirst.mockResolvedValue(null);

    await expect(
      webhookSystem.getDeliveries('wh-other-org', 'org-1'),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_NOT_FOUND',
      statusCode: 404,
    });
    expect(mockWebhookFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'wh-other-org',
        organizationId: 'org-1',
      },
    });
  });

  it('loads delivery logs from the durable store after ownership is confirmed', async () => {
    mockWebhookFindFirst.mockResolvedValue({
      id: 'wh-1',
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
    });
    mockWebhookDeliveryFindMany.mockResolvedValue([
      {
        id: 'del-1',
        webhookId: 'wh-1',
        eventType: 'credential.issued',
        payload: { credentialId: 'cred-1' },
        statusCode: 200,
        responseBody: 'ok',
        responseTimeMs: 12,
        attempt: 1,
        success: true,
        deliveredAt: new Date('2026-04-21T00:00:01.000Z'),
        nextRetryAt: null,
      },
    ]);

    const deliveries = await webhookSystem.getDeliveries('wh-1', 'org-1', 10);

    expect(mockWebhookDeliveryFindMany).toHaveBeenCalledWith({
      where: { webhookId: 'wh-1' },
      orderBy: { deliveredAt: 'desc' },
      take: 10,
    });
    expect(deliveries[0]).toMatchObject({
      deliveryId: 'del-1',
      webhookId: 'wh-1',
      eventType: 'credential.issued',
      status: 'delivered',
      response: { statusCode: 200, body: 'ok', latencyMs: 12 },
    });
    expect(deliveries[0].request.headers).toEqual({});
  });

  it('retries persisted dead-letter deliveries after process restart', async () => {
    const restartedSystem = new WebhookSystem();
    const persistedPayload = {
      id: 'evt-1',
      type: 'credential.issued',
      timestamp: '2026-04-21T00:00:01.000Z',
      data: { credentialId: 'cred-1' },
      source: 'zeroid',
    };

    mockWebhookDeliveryFindUnique.mockResolvedValue({
      id: 'del-dead',
      webhookId: 'wh-1',
      eventType: 'credential.issued',
      payload: persistedPayload,
      statusCode: 500,
      responseBody: 'temporary failure',
      responseTimeMs: 25,
      attempt: 5,
      success: false,
      deliveredAt: new Date('2026-04-21T00:00:05.000Z'),
      nextRetryAt: null,
    });
    mockWebhookFindUnique.mockResolvedValue({
      id: 'wh-1',
      organizationId: 'org-1',
      url: 'https://hooks.zeroid.example/ingest',
      secret: 's'.repeat(64),
      events: ['credential.issued'],
      status: 'ACTIVE',
      failureCount: 0,
      lastDeliveredAt: null,
      lastStatusCode: 500,
      createdAt: new Date('2026-04-21T00:00:00.000Z'),
      updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    });
    mockWebhookDeliveryUpsert.mockResolvedValue({});
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(restartedSystem.retryDeadLetter('del-dead')).resolves.toBe(true);

    expect(mockWebhookDeliveryFindUnique).toHaveBeenCalledWith({
      where: { id: 'del-dead' },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.zeroid.example/ingest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(persistedPayload),
        headers: expect.objectContaining({
          'X-ZeroID-Delivery': 'del-dead',
          'X-ZeroID-Event': 'credential.issued',
        }),
      }),
    );
    expect(mockWebhookDeliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'del-dead' },
      update: expect.objectContaining({
        attempt: 1,
        success: true,
        responseBody: 'ok',
      }),
    }));
    fetchSpy.mockRestore();
  });

  it('requires organization ownership before replaying webhook events', async () => {
    mockWebhookFindFirst.mockResolvedValue(null);

    await expect(
      webhookSystem.replayEvents(
        'wh-other-org',
        '2026-04-21T00:00:00.000Z',
        undefined,
        'org-1',
      ),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_NOT_FOUND',
      statusCode: 404,
    });
    expect(mockWebhookFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'wh-other-org',
        organizationId: 'org-1',
      },
    });
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
