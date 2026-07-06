import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';
import * as https from 'https';
import * as net from 'net';
import { promises as dns } from 'dns';
import { prisma, redis } from '../../index';
import { isProductionRuntime as isSharedProductionRuntime } from '../production-safety';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'webhook-system' },
  transports: [new transports.Console()],
});

const WEBHOOK_SECRET_ENCRYPTION_KEY_ENV = 'WEBHOOK_SECRET_ENCRYPTION_KEY';
const WEBHOOK_SECRET_AAD = 'zeroid:webhook-secret:v1';
const ENCRYPTED_WEBHOOK_SECRET_PREFIX = 'enc:v1:';
const LOCAL_WEBHOOK_SECRET_PREFIX = 'local:v1:';
const WEBHOOK_REPLAY_EVENT_LOG_KEY_PREFIX = 'enterprise:webhook-events';
const MAX_WEBHOOK_REPLAY_EVENTS = 10_000;
const WEBHOOK_RESPONSE_PREVIEW_BYTES = 1024;
const SAFE_WEBHOOK_ENDPOINT_MESSAGE =
  'Webhook URL must use HTTPS and must not target localhost or private network addresses in production.';
const UNSAFE_WEBHOOK_RESOLUTION_MESSAGE =
  'Webhook hostname resolved to a localhost or private network address.';
const RESERVED_WEBHOOK_HEADER_MESSAGE =
  'Webhook headers must not override platform delivery headers.';
const WEBHOOK_SECRET_STRENGTH_MESSAGE =
  'Webhook secret must be at least 32 characters with sufficient character diversity.';
const RESERVED_WEBHOOK_HEADER_NAMES = new Set([
  'content-type',
  'user-agent',
  'x-zeroid-delivery',
  'x-zeroid-event',
  'x-zeroid-signature',
  'x-zeroid-timestamp',
]);
const PRIVATE_WEBHOOK_HOSTNAME_SUFFIXES = [
  '.corp',
  '.home',
  '.internal',
  '.lan',
  '.local',
  '.localhost',
];

const isProductionRuntime = (): boolean => isSharedProductionRuntime();

function isSafeWebhookEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (isProductionRuntime()) {
      return (
        endpoint.protocol === 'https:' &&
        endpoint.username === '' &&
        endpoint.password === '' &&
        !isLocalOrPrivateHostname(endpoint.hostname)
      );
    }
    return endpoint.protocol === 'http:' || endpoint.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '127.0.0.1' ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalized);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = extractIpv4MappedAddress(normalized);
    if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4);

    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return (
    !normalized.includes('.') ||
    PRIVATE_WEBHOOK_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isPrivateIpv4Address(value: string): boolean {
  const octets = value.split('.').map(Number);
  const first = octets[0];
  const second = octets[1];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function extractIpv4MappedAddress(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;

  const high = parseInt(hexadecimal[1], 16);
  const low = parseInt(hexadecimal[2], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}

interface ResolvedWebhookAddress {
  address: string;
  family: number;
}

interface ResolvedWebhookEndpoint {
  endpoint: URL;
  pinnedAddress?: ResolvedWebhookAddress;
}

interface WebhookDeliveryHttpResponse {
  ok: boolean;
  status: number;
  body: string;
}

function hasOnlySafeCustomWebhookHeaders(headers: Record<string, string>): boolean {
  return Object.keys(headers).every((header) => !RESERVED_WEBHOOK_HEADER_NAMES.has(header.toLowerCase()));
}

function safeCustomWebhookHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([header]) => !RESERVED_WEBHOOK_HEADER_NAMES.has(header.toLowerCase())),
  );
}

function hasWebhookSecretStrength(secret: string): boolean {
  const trimmed = secret.trim();
  const uniqueCharacters = new Set(trimmed).size;
  return uniqueCharacters >= 8 && !/(.)\1{15,}/.test(trimmed);
}

async function readWebhookResponsePreview(response: Response): Promise<string> {
  if (!response.body) {
    const body = await response.text();
    return body.substring(0, WEBHOOK_RESPONSE_PREVIEW_BYTES);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < WEBHOOK_RESPONSE_PREVIEW_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = WEBHOOK_RESPONSE_PREVIEW_BYTES - totalBytes;
      const chunk = Buffer.from(value).subarray(0, remaining);
      chunks.push(chunk);
      totalBytes += chunk.byteLength;

      if (totalBytes >= WEBHOOK_RESPONSE_PREVIEW_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
export const WebhookEventTypeSchema = z.enum([
  'credential.issued',
  'credential.revoked',
  'credential.expired',
  'credential.updated',
  'verification.completed',
  'verification.failed',
  'identity.registered',
  'identity.updated',
  'identity.deactivated',
  'compliance.status_changed',
  'compliance.screening_complete',
  'compliance.report_generated',
  'enterprise.api_key_created',
  'enterprise.api_key_revoked',
  'enterprise.sla_violation',
]);

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookRegistrationSchema = z.object({
  url: z.string().url().refine(isSafeWebhookEndpoint, SAFE_WEBHOOK_ENDPOINT_MESSAGE),
  events: z.array(WebhookEventTypeSchema).min(1),
  secret: z.string().min(32).refine(hasWebhookSecretStrength, WEBHOOK_SECRET_STRENGTH_MESSAGE).optional(),
  description: z.string().optional(),
  active: z.boolean().default(true),
  metadata: z.record(z.string()).default({}),
  batchDelivery: z.boolean().default(false),
  batchIntervalMs: z.number().int().min(1000).max(60000).default(5000),
  headers: z.record(z.string()).refine(
    hasOnlySafeCustomWebhookHeaders,
    RESERVED_WEBHOOK_HEADER_MESSAGE,
  ).default({}),
});

export type WebhookRegistration = z.infer<typeof WebhookRegistrationSchema>;

export const WebhookUpdateSchema = z.object({
  url: z.string().url().refine(isSafeWebhookEndpoint, SAFE_WEBHOOK_ENDPOINT_MESSAGE).optional(),
  events: z.array(WebhookEventTypeSchema).min(1).optional(),
  active: z.boolean().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  headers: z.record(z.string()).refine(
    hasOnlySafeCustomWebhookHeaders,
    RESERVED_WEBHOOK_HEADER_MESSAGE,
  ).optional(),
});

export type WebhookUpdate = z.infer<typeof WebhookUpdateSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RegisteredWebhook {
  id: string;
  clientId: string;
  url: string;
  events: WebhookEventType[];
  secret: string;
  description: string;
  active: boolean;
  metadata: Record<string, string>;
  batchDelivery: boolean;
  batchIntervalMs: number;
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  health: WebhookHealth;
}

interface WebhookHealth {
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastStatusCode: number | null;
  totalDelivered: number;
  totalFailed: number;
  averageLatencyMs: number;
  disabled: boolean;
  disabledReason: string | null;
}

interface WebhookDelivery {
  deliveryId: string;
  webhookId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  request: { url: string; headers: Record<string, string>; body: string };
  response: { statusCode: number; body: string; latencyMs: number } | null;
  createdAt: string;
  completedAt: string | null;
}

interface WebhookEvent {
  eventId: string;
  clientId: string;
  eventType: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  source: string;
}

interface DeadLetterEntry {
  deliveryId: string;
  webhookId: string;
  eventId: string;
  failedAt: string;
  lastError: string;
  attempts: number;
}

// ---------------------------------------------------------------------------
// Rate limiter per subscriber
// ---------------------------------------------------------------------------
class SubscriberRateLimiter {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(maxPerWindow = 100, windowMs = 60000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  async allow(webhookId: string): Promise<boolean> {
    const now = Date.now();
    const key = `enterprise:webhook-rate:${webhookId}`;
    const result = await redis.eval(
      `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
      local count = redis.call('ZCARD', KEYS[1])
      if count >= tonumber(ARGV[4]) then
        redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
        return 0
      end

      redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
      return 1
      `,
      1,
      key,
      now - this.windowMs,
      now,
      `${now}:${crypto.randomUUID()}`,
      this.maxPerWindow,
      Math.ceil(this.windowMs / 1000) + 1,
    );

    return this.redisInteger(result) === 1;
  }

  private redisInteger(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

// ---------------------------------------------------------------------------
// WebhookSystem
// ---------------------------------------------------------------------------
export class WebhookSystem {
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private eventLog: WebhookEvent[] = [];
  private batchBuffers: Map<string, WebhookEvent[]> = new Map();
  private rateLimiter: SubscriberRateLimiter;
  private readonly maxRetries = 5;

  constructor() {
    this.rateLimiter = new SubscriberRateLimiter(100, 60000);
    logger.info('WebhookSystem initialized');
  }

  private webhookConfigKey(webhookId: string): string {
    return `enterprise:webhook-config:${webhookId}`;
  }

  private replayEventLogKey(clientId: string): string {
    return `${WEBHOOK_REPLAY_EVENT_LOG_KEY_PREFIX}:${clientId}`;
  }

  private normalizeClientId(clientId: string): string {
    const normalized = clientId.trim();
    if (!normalized) {
      throw new WebhookError('Webhook organization scope is required', 'WEBHOOK_SCOPE_REQUIRED', 400);
    }
    return normalized;
  }

  private async persistWebhookConfig(webhookId: string, config: {
    description: string;
    metadata: Record<string, string>;
    batchDelivery: boolean;
    batchIntervalMs: number;
    headers: Record<string, string>;
    health: WebhookHealth;
  }): Promise<void> {
    await redis.set(this.webhookConfigKey(webhookId), JSON.stringify(config));
  }

  private async getWebhookConfig(webhookId: string): Promise<{
    description: string;
    metadata: Record<string, string>;
    batchDelivery: boolean;
    batchIntervalMs: number;
    headers: Record<string, string>;
    health: WebhookHealth;
  } | null> {
    const raw = await redis.get(this.webhookConfigKey(webhookId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as {
        description: string;
        metadata: Record<string, string>;
        batchDelivery: boolean;
        batchIntervalMs: number;
        headers: Record<string, string>;
        health: WebhookHealth;
      };
    } catch {
      return null;
    }
  }

  private async hydrateWebhook(record: any): Promise<RegisteredWebhook> {
    const config = await this.getWebhookConfig(record.id);
    const health = config?.health ?? {
      consecutiveFailures: record.failureCount ?? 0,
      lastSuccessAt: record.lastDeliveredAt?.toISOString() ?? null,
      lastFailureAt: null,
      lastStatusCode: record.lastStatusCode ?? null,
      totalDelivered: 0,
      totalFailed: 0,
      averageLatencyMs: 0,
      disabled: record.status === 'DISABLED',
      disabledReason: record.status === 'DISABLED' ? 'Persisted disabled webhook' : null,
    };

    return {
      id: record.id,
      clientId: record.organizationId,
      url: record.url,
      events: record.events,
      secret: this.revealWebhookSecret(record.secret),
      description: config?.description ?? '',
      active: record.status === 'ACTIVE',
      metadata: config?.metadata ?? {},
      batchDelivery: config?.batchDelivery ?? false,
      batchIntervalMs: config?.batchIntervalMs ?? 5000,
      headers: config?.headers ?? {},
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      health,
    };
  }

  // -------------------------------------------------------------------------
  // Webhook registration
  // -------------------------------------------------------------------------
  async register(clientId: string, registration: WebhookRegistration): Promise<RegisteredWebhook> {
    const parsed = WebhookRegistrationSchema.parse(registration);
    const id = crypto.randomUUID();
    const secret = parsed.secret ?? crypto.randomBytes(32).toString('hex');
    const protectedSecret = this.protectWebhookSecret(secret);

    const record = await prisma.webhook.create({
      data: {
        id,
        organizationId: clientId,
        url: parsed.url,
        secret: protectedSecret,
        events: parsed.events,
        status: parsed.active ? 'ACTIVE' : 'PAUSED',
        failureCount: 0,
      },
    });

    await this.persistWebhookConfig(id, {
      description: parsed.description ?? '',
      metadata: parsed.metadata,
      batchDelivery: parsed.batchDelivery,
      batchIntervalMs: parsed.batchIntervalMs,
      headers: parsed.headers,
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

    logger.info('webhook_registered', { webhookId: id, clientId, url: parsed.url, events: parsed.events });
    return this.hydrateWebhook(record);
  }

  // -------------------------------------------------------------------------
  // Webhook update
  // -------------------------------------------------------------------------
  async update(webhookId: string, clientId: string, updates: WebhookUpdate): Promise<RegisteredWebhook> {
    const webhookRecord = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: clientId,
      },
    });
    if (!webhookRecord) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    const parsed = WebhookUpdateSchema.parse(updates);
    const existingConfig = await this.getWebhookConfig(webhookId);
    const nextHealth = existingConfig?.health ?? {
      consecutiveFailures: webhookRecord.failureCount ?? 0,
      lastSuccessAt: webhookRecord.lastDeliveredAt?.toISOString() ?? null,
      lastFailureAt: null,
      lastStatusCode: webhookRecord.lastStatusCode ?? null,
      totalDelivered: 0,
      totalFailed: 0,
      averageLatencyMs: 0,
      disabled: webhookRecord.status === 'DISABLED',
      disabledReason: webhookRecord.status === 'DISABLED' ? 'Persisted disabled webhook' : null,
    };

    if (parsed.active === true && nextHealth.disabled) {
      nextHealth.disabled = false;
      nextHealth.disabledReason = null;
      nextHealth.consecutiveFailures = 0;
    }

    const updated = await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        url: parsed.url ?? webhookRecord.url,
        events: parsed.events ?? webhookRecord.events,
        status: parsed.active === undefined
          ? webhookRecord.status
          : (parsed.active ? 'ACTIVE' : 'PAUSED'),
      },
    });

    await this.persistWebhookConfig(webhookId, {
      description: parsed.description ?? existingConfig?.description ?? '',
      metadata: parsed.metadata ?? existingConfig?.metadata ?? {},
      batchDelivery: existingConfig?.batchDelivery ?? false,
      batchIntervalMs: existingConfig?.batchIntervalMs ?? 5000,
      headers: parsed.headers ?? existingConfig?.headers ?? {},
      health: nextHealth,
    });

    logger.info('webhook_updated', { webhookId, updates: Object.keys(parsed) });
    return this.hydrateWebhook(updated);
  }

  // -------------------------------------------------------------------------
  // Remove webhook
  // -------------------------------------------------------------------------
  async remove(webhookId: string, clientId: string): Promise<void> {
    const webhookRecord = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: clientId,
      },
    });
    if (!webhookRecord) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        status: 'DISABLED',
      },
    });

    const existingConfig = await this.getWebhookConfig(webhookId);
    await this.persistWebhookConfig(webhookId, {
      description: existingConfig?.description ?? '',
      metadata: existingConfig?.metadata ?? {},
      batchDelivery: existingConfig?.batchDelivery ?? false,
      batchIntervalMs: existingConfig?.batchIntervalMs ?? 5000,
      headers: existingConfig?.headers ?? {},
      health: {
        ...(existingConfig?.health ?? {
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastStatusCode: webhookRecord.lastStatusCode ?? null,
          totalDelivered: 0,
          totalFailed: 0,
          averageLatencyMs: 0,
        }),
        disabled: true,
        disabledReason: 'Webhook removed by organization',
      },
    });

    this.batchBuffers.delete(webhookId);
    logger.info('webhook_removed', { webhookId, clientId });
  }

  // -------------------------------------------------------------------------
  // List webhooks for a client
  // -------------------------------------------------------------------------
  async list(clientId: string): Promise<RegisteredWebhook[]> {
    const webhookRecords = await prisma.webhook.findMany({
      where: { organizationId: clientId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(webhookRecords.map((record) => this.hydrateWebhook(record)));
  }

  async getWebhook(webhookId: string): Promise<RegisteredWebhook | null> {
    const webhookRecord = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhookRecord) return null;
    return this.hydrateWebhook(webhookRecord);
  }

  // -------------------------------------------------------------------------
  // Emit event — dispatches to all matching webhooks
  // -------------------------------------------------------------------------
  async emit(
    eventType: WebhookEventType,
    data: Record<string, unknown>,
    clientId: string,
    source = 'zeroid',
  ): Promise<string[]> {
    const scopedClientId = this.normalizeClientId(clientId);
    const event: WebhookEvent = {
      eventId: crypto.randomUUID(),
      clientId: scopedClientId,
      eventType,
      timestamp: new Date().toISOString(),
      data,
      source,
    };

    await this.storeReplayEvent(event);

    const webhookRecords = await prisma.webhook.findMany({
      where: {
        organizationId: scopedClientId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });
    const hydratedWebhooks = await Promise.all(webhookRecords.map((record) => this.hydrateWebhook(record)));
    const matchingWebhooks = hydratedWebhooks.filter(
      (w) => w.clientId === scopedClientId && w.active && !w.health.disabled && w.events.includes(eventType),
    );

    const deliveryIds: string[] = [];

    for (const webhook of matchingWebhooks) {
      if (webhook.batchDelivery) {
        const buffer = this.batchBuffers.get(webhook.id) ?? [];
        buffer.push(event);
        this.batchBuffers.set(webhook.id, buffer);
        continue;
      }

      if (!(await this.rateLimiter.allow(webhook.id))) {
        logger.warn('webhook_rate_limited', { webhookId: webhook.id });
        continue;
      }

      const deliveryId = await this.deliver(webhook, event);
      deliveryIds.push(deliveryId);
    }

    logger.info('event_emitted', {
      eventId: event.eventId,
      eventType,
      clientId: scopedClientId,
      matchedWebhooks: matchingWebhooks.length,
    });
    return deliveryIds;
  }

  async testDelivery(
    webhookId: string,
    clientId: string,
  ): Promise<{
    deliveryId: string;
    delivered: boolean;
    statusCode: number;
    responseTimeMs: number;
    error?: string;
  }> {
    const scopedClientId = this.normalizeClientId(clientId);
    const webhook = await this.getWebhookForClient(webhookId, scopedClientId);
    if (!webhook) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }
    if (!webhook.active || webhook.health.disabled) {
      throw new WebhookError(
        webhook.health.disabledReason ?? 'Webhook is not active',
        'WEBHOOK_DISABLED',
        409,
      );
    }

    const event: WebhookEvent = {
      eventId: crypto.randomUUID(),
      clientId: scopedClientId,
      eventType: webhook.events[0],
      timestamp: new Date().toISOString(),
      source: 'zeroid:test',
      data: {
        test: true,
        webhookId,
        generatedAt: new Date().toISOString(),
      },
    };
    const deliveryId = await this.deliver(webhook, event);
    const delivery = this.deliveries.get(deliveryId);
    const statusCode = delivery?.response?.statusCode ?? 0;

    return {
      deliveryId,
      delivered: delivery?.status === 'delivered',
      statusCode,
      responseTimeMs: delivery?.response?.latencyMs ?? 0,
      ...(delivery?.status !== 'delivered'
        ? {
            error:
              delivery?.response?.body ??
              delivery?.status ??
              'Webhook delivery did not complete',
          }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Deliver payload
  // -------------------------------------------------------------------------
  private async deliver(webhook: RegisteredWebhook, event: WebhookEvent): Promise<string> {
    const deliveryId = crypto.randomUUID();
    const payload = {
      id: event.eventId,
      type: event.eventType,
      timestamp: event.timestamp,
      data: event.data,
      source: event.source,
    };

    const body = JSON.stringify(payload);
    const signature = this.signPayload(body, webhook.secret);

    const headers: Record<string, string> = {
      ...safeCustomWebhookHeaders(webhook.headers),
      'Content-Type': 'application/json',
      'X-ZeroID-Signature': signature,
      'X-ZeroID-Event': event.eventType,
      'X-ZeroID-Delivery': deliveryId,
      'X-ZeroID-Timestamp': event.timestamp,
      'User-Agent': 'ZeroID-Webhook/1.0',
    };

    const delivery: WebhookDelivery = {
      deliveryId,
      webhookId: webhook.id,
      eventType: event.eventType,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.maxRetries,
      nextRetryAt: null,
      request: { url: webhook.url, headers, body },
      response: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.deliveries.set(deliveryId, delivery);
    await this.attemptDelivery(delivery, webhook);
    return deliveryId;
  }

  private async attemptDelivery(delivery: WebhookDelivery, webhook: RegisteredWebhook): Promise<void> {
    delivery.attempts++;
    const startTime = Date.now();

    try {
      const resolvedEndpoint = await this.resolveSafeEndpoint(
        delivery.request.url,
      );
      const response = resolvedEndpoint.pinnedAddress
        ? await this.postWebhookWithPinnedAddress(
            resolvedEndpoint.endpoint,
            resolvedEndpoint.pinnedAddress,
            delivery.request.headers,
            delivery.request.body,
          )
        : await this.postWebhookWithFetch(delivery);

      const latencyMs = Date.now() - startTime;

      delivery.response = {
        statusCode: response.status,
        body: response.body,
        latencyMs,
      };

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.completedAt = new Date().toISOString();
        this.updateHealth(webhook, true, response.status, latencyMs);
        logger.info('webhook_delivered', { deliveryId: delivery.deliveryId, webhookId: webhook.id, latencyMs });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.body.substring(0, 200)}`);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      delivery.response = delivery.response ?? {
        statusCode: 0,
        body: errorMessage,
        latencyMs,
      };

      this.updateHealth(webhook, false, delivery.response.statusCode, latencyMs);

      if (this.isNonRetryableDeliveryError(error)) {
        delivery.status = 'dead_letter';
        delivery.completedAt = new Date().toISOString();
        this.deadLetterQueue.push({
          deliveryId: delivery.deliveryId,
          webhookId: webhook.id,
          eventId: delivery.payload.id as string,
          failedAt: new Date().toISOString(),
          lastError: errorMessage,
          attempts: delivery.attempts,
        });

        logger.error('webhook_delivery_blocked', {
          deliveryId: delivery.deliveryId,
          webhookId: webhook.id,
          error: errorMessage,
        });
      } else if (delivery.attempts < delivery.maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delayMs = Math.pow(2, delivery.attempts - 1) * 1000;
        delivery.status = 'pending';
        delivery.nextRetryAt = new Date(Date.now() + delayMs).toISOString();

        logger.warn('webhook_delivery_failed_retrying', {
          deliveryId: delivery.deliveryId,
          webhookId: webhook.id,
          attempt: delivery.attempts,
          nextRetryMs: delayMs,
          error: errorMessage,
        });

        // Schedule retry
        setTimeout(() => this.attemptDelivery(delivery, webhook), delayMs);
      } else {
        delivery.status = 'dead_letter';
        delivery.completedAt = new Date().toISOString();
        this.deadLetterQueue.push({
          deliveryId: delivery.deliveryId,
          webhookId: webhook.id,
          eventId: delivery.payload.id as string,
          failedAt: new Date().toISOString(),
          lastError: errorMessage,
          attempts: delivery.attempts,
        });

        logger.error('webhook_delivery_exhausted', {
          deliveryId: delivery.deliveryId,
          webhookId: webhook.id,
          attempts: delivery.attempts,
        });
      }
    }

    this.deliveries.set(delivery.deliveryId, delivery);
    await this.persistWebhookHealth(webhook);
    await this.persistDelivery(delivery);
  }

  // -------------------------------------------------------------------------
  // Flush batch buffer
  // -------------------------------------------------------------------------
  async flushBatch(webhookId: string): Promise<string | null> {
    const buffer = this.batchBuffers.get(webhookId);
    if (!buffer || buffer.length === 0) return null;

    const webhook = await this.getWebhook(webhookId);
    if (!webhook) return null;

    const batchEvent: WebhookEvent = {
      eventId: crypto.randomUUID(),
      clientId: webhook.clientId,
      eventType: 'credential.issued', // batch type
      timestamp: new Date().toISOString(),
      data: { batch: true, events: buffer, count: buffer.length },
      source: 'zeroid-batch',
    };

    this.batchBuffers.set(webhookId, []);
    return this.deliver(webhook, batchEvent);
  }

  // -------------------------------------------------------------------------
  // Event replay for recovery
  // -------------------------------------------------------------------------
  async replayEvents(
    webhookId: string,
    since: string,
    until?: string,
    clientId?: string,
  ): Promise<{ replayed: number; deliveryIds: string[] }> {
    const scopedClientId = this.normalizeClientId(clientId ?? '');
    const webhook = await this.getWebhookForClient(webhookId, scopedClientId);
    if (!webhook) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    const sinceTime = new Date(since).getTime();
    const untilTime = until ? new Date(until).getTime() : Date.now();

    const eventsToReplay = await this.loadReplayEvents(
      sinceTime,
      untilTime,
      webhook.events,
      webhook.clientId,
    );

    const deliveryIds: string[] = [];
    for (const event of eventsToReplay) {
      const deliveryId = await this.deliver(webhook, event);
      deliveryIds.push(deliveryId);
    }

    logger.info('events_replayed', {
      webhookId,
      clientId: scopedClientId,
      replayed: eventsToReplay.length,
      since,
      until,
    });
    return { replayed: eventsToReplay.length, deliveryIds };
  }

  // -------------------------------------------------------------------------
  // Dead letter queue management
  // -------------------------------------------------------------------------
  getDeadLetterQueue(webhookId?: string): DeadLetterEntry[] {
    if (webhookId) {
      return this.deadLetterQueue.filter((e) => e.webhookId === webhookId);
    }
    return [...this.deadLetterQueue];
  }

  async retryDeadLetter(deliveryId: string): Promise<boolean> {
    const dlEntry = this.deadLetterQueue.find((e) => e.deliveryId === deliveryId);
    let delivery = this.deliveries.get(deliveryId) ?? null;
    let webhook = dlEntry ? await this.getWebhook(dlEntry.webhookId) : null;

    if (!delivery || !webhook) {
      const persisted = await this.loadPersistedDeadLetterDelivery(deliveryId);
      if (!persisted) return false;
      delivery = persisted.delivery;
      webhook = persisted.webhook;
    }

    delivery.attempts = 0;
    delivery.status = 'pending';
    delivery.maxAttempts = this.maxRetries;
    this.deadLetterQueue = this.deadLetterQueue.filter((e) => e.deliveryId !== deliveryId);

    await this.attemptDelivery(delivery, webhook);
    return true;
  }

  // -------------------------------------------------------------------------
  // Delivery logs
  // -------------------------------------------------------------------------
  async getDeliveries(
    webhookId: string,
    clientId: string,
    limit = 50,
  ): Promise<WebhookDelivery[]> {
    const webhook = await this.getWebhookForClient(webhookId, clientId);
    if (!webhook) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    const records = await prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    });

    return records.map((record: any) => this.hydrateDeliveryLog(record));
  }

  getDelivery(deliveryId: string): WebhookDelivery | null {
    return this.deliveries.get(deliveryId) ?? null;
  }

  private async resolveSafeEndpoint(
    endpointUrl: string,
  ): Promise<ResolvedWebhookEndpoint> {
    const endpoint = new URL(endpointUrl);
    if (!isProductionRuntime()) return { endpoint };

    if (isLocalOrPrivateHostname(endpoint.hostname)) {
      throw new WebhookError(
        UNSAFE_WEBHOOK_RESOLUTION_MESSAGE,
        'WEBHOOK_ENDPOINT_UNSAFE_RESOLUTION',
        400,
      );
    }

    const resolvedAddresses = await dns.lookup(endpoint.hostname, {
      all: true,
      verbatim: true,
    });
    if (
      resolvedAddresses.length === 0 ||
      resolvedAddresses.some((entry) => isLocalOrPrivateHostname(entry.address))
    ) {
      throw new WebhookError(
        UNSAFE_WEBHOOK_RESOLUTION_MESSAGE,
        'WEBHOOK_ENDPOINT_UNSAFE_RESOLUTION',
        400,
      );
    }

    return { endpoint, pinnedAddress: resolvedAddresses[0] };
  }

  private async postWebhookWithFetch(
    delivery: WebhookDelivery,
  ): Promise<WebhookDeliveryHttpResponse> {
    const response = await fetch(delivery.request.url, {
      method: 'POST',
      headers: delivery.request.headers,
      body: delivery.request.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readWebhookResponsePreview(response).catch(() => ''),
    };
  }

  private async postWebhookWithPinnedAddress(
    endpoint: URL,
    pinnedAddress: ResolvedWebhookAddress,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookDeliveryHttpResponse> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        endpoint,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body),
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, pinnedAddress.address, pinnedAddress.family);
          },
          servername: endpoint.hostname,
          timeout: 30000,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const chunks: Buffer[] = [];
          let totalBytes = 0;

          response.on('data', (chunk: Buffer | string) => {
            if (totalBytes >= WEBHOOK_RESPONSE_PREVIEW_BYTES) return;
            const chunkBuffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);
            const remaining = WEBHOOK_RESPONSE_PREVIEW_BYTES - totalBytes;
            const previewChunk = chunkBuffer.subarray(0, remaining);
            chunks.push(previewChunk);
            totalBytes += previewChunk.byteLength;
          });
          response.on('end', () => {
            resolve({
              ok: status >= 200 && status < 300,
              status,
              body: Buffer.concat(chunks, totalBytes).toString('utf8'),
            });
          });
          response.on('error', reject);
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Webhook delivery timed out.'));
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  private isNonRetryableDeliveryError(error: unknown): boolean {
    return (
      error instanceof WebhookError &&
      error.code === 'WEBHOOK_ENDPOINT_UNSAFE_RESOLUTION'
    );
  }

  // -------------------------------------------------------------------------
  // Health monitoring
  // -------------------------------------------------------------------------
  private updateHealth(webhook: RegisteredWebhook, success: boolean, statusCode: number, latencyMs: number): void {
    const health = webhook.health;
    health.lastStatusCode = statusCode;

    if (success) {
      health.consecutiveFailures = 0;
      health.lastSuccessAt = new Date().toISOString();
      health.totalDelivered++;
      health.averageLatencyMs = Math.round(
        (health.averageLatencyMs * (health.totalDelivered - 1) + latencyMs) / health.totalDelivered,
      );
    } else {
      health.consecutiveFailures++;
      health.lastFailureAt = new Date().toISOString();
      health.totalFailed++;

      // Auto-disable after 10 consecutive failures
      if (health.consecutiveFailures >= 10 && !health.disabled) {
        health.disabled = true;
        health.disabledReason = `Auto-disabled after ${health.consecutiveFailures} consecutive failures`;
        webhook.active = false;
        logger.warn('webhook_auto_disabled', { webhookId: webhook.id, consecutiveFailures: health.consecutiveFailures });
      }
    }
  }

  private async persistWebhookHealth(webhook: RegisteredWebhook): Promise<void> {
    try {
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: {
          failureCount: webhook.health.consecutiveFailures,
          lastStatusCode: webhook.health.lastStatusCode,
          ...(webhook.health.lastSuccessAt
            ? { lastDeliveredAt: new Date(webhook.health.lastSuccessAt) }
            : {}),
          ...(webhook.health.disabled ? { status: 'DISABLED' as const } : {}),
        },
      });

      await this.persistWebhookConfig(webhook.id, {
        description: webhook.description,
        metadata: webhook.metadata,
        batchDelivery: webhook.batchDelivery,
        batchIntervalMs: webhook.batchIntervalMs,
        headers: webhook.headers,
        health: webhook.health,
      });
    } catch (error) {
      logger.error('webhook_health_persist_failed', {
        webhookId: webhook.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getWebhookForClient(
    webhookId: string,
    clientId: string,
  ): Promise<RegisteredWebhook | null> {
    const webhookRecord = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        organizationId: clientId,
      },
    });
    if (!webhookRecord) return null;
    return this.hydrateWebhook(webhookRecord);
  }

  private async storeReplayEvent(event: WebhookEvent): Promise<void> {
    this.eventLog.push(event);
    if (this.eventLog.length > MAX_WEBHOOK_REPLAY_EVENTS) {
      this.eventLog = this.eventLog.slice(-Math.floor(MAX_WEBHOOK_REPLAY_EVENTS / 2));
    }

    const replayKey = this.replayEventLogKey(event.clientId);
    await redis.lpush(replayKey, JSON.stringify(event));
    await redis.ltrim(replayKey, 0, MAX_WEBHOOK_REPLAY_EVENTS - 1);
  }

  private async loadReplayEvents(
    sinceTime: number,
    untilTime: number,
    eventTypes: WebhookEventType[],
    clientId: string,
  ): Promise<WebhookEvent[]> {
    const replayKey = this.replayEventLogKey(clientId);
    const rawEvents = await redis.lrange(replayKey, 0, MAX_WEBHOOK_REPLAY_EVENTS - 1);
    const allowedTypes = new Set(eventTypes);
    const events: WebhookEvent[] = [];

    for (const raw of rawEvents) {
      try {
        const event = JSON.parse(raw) as WebhookEvent;
        const eventTime = new Date(event.timestamp).getTime();
        if (
          Number.isFinite(eventTime) &&
          eventTime >= sinceTime &&
          eventTime <= untilTime &&
          event.clientId === clientId &&
          allowedTypes.has(event.eventType)
        ) {
          events.push(event);
        }
      } catch {
        logger.warn('webhook_replay_event_parse_failed');
      }
    }

    return events.sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
  }

  private async persistDelivery(delivery: WebhookDelivery): Promise<void> {
    try {
      const completedAt = delivery.completedAt
        ? new Date(delivery.completedAt)
        : new Date();
      const nextRetryAt = delivery.nextRetryAt
        ? new Date(delivery.nextRetryAt)
        : null;

      const data = {
        webhookId: delivery.webhookId,
        eventType: delivery.eventType,
        payload: delivery.payload as any,
        statusCode: delivery.response?.statusCode ?? null,
        responseBody: delivery.response?.body ?? null,
        responseTimeMs: delivery.response?.latencyMs ?? null,
        attempt: delivery.attempts,
        success: delivery.status === 'delivered',
        deliveredAt: completedAt,
        nextRetryAt,
      };

      await prisma.webhookDelivery.upsert({
        where: { id: delivery.deliveryId },
        create: {
          id: delivery.deliveryId,
          ...data,
        },
        update: data,
      });
    } catch (error) {
      logger.error('webhook_delivery_log_persist_failed', {
        deliveryId: delivery.deliveryId,
        webhookId: delivery.webhookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async loadPersistedDeadLetterDelivery(
    deliveryId: string,
  ): Promise<{ delivery: WebhookDelivery; webhook: RegisteredWebhook } | null> {
    const record = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!record || record.success || record.nextRetryAt) return null;

    const webhook = await this.getWebhook(record.webhookId);
    if (!webhook || !webhook.active || webhook.health.disabled) return null;

    const delivery = this.hydrateDeliveryLog(record);
    const payload = delivery.payload ?? {};
    const body = JSON.stringify(payload);
    const signature = this.signPayload(body, webhook.secret);
    const eventTimestamp = typeof payload.timestamp === 'string'
      ? payload.timestamp
      : new Date().toISOString();

    delivery.status = 'dead_letter';
    delivery.request = {
      url: webhook.url,
      headers: {
        ...safeCustomWebhookHeaders(webhook.headers),
        'Content-Type': 'application/json',
        'X-ZeroID-Signature': signature,
        'X-ZeroID-Event': delivery.eventType,
        'X-ZeroID-Delivery': delivery.deliveryId,
        'X-ZeroID-Timestamp': eventTimestamp,
        'User-Agent': 'ZeroID-Webhook/1.0',
      },
      body,
    };
    delivery.response = {
      statusCode: record.statusCode ?? 0,
      body: record.responseBody ?? '',
      latencyMs: record.responseTimeMs ?? 0,
    };
    delivery.maxAttempts = this.maxRetries;
    this.deliveries.set(delivery.deliveryId, delivery);

    return { delivery, webhook };
  }

  private hydrateDeliveryLog(record: any): WebhookDelivery {
    const deliveredAt = this.dateToIso(record.deliveredAt);
    const nextRetryAt = record.nextRetryAt
      ? this.dateToIso(record.nextRetryAt)
      : null;
    const response = record.statusCode === null && record.responseBody === null
      ? null
      : {
          statusCode: record.statusCode ?? 0,
          body: record.responseBody ?? '',
          latencyMs: record.responseTimeMs ?? 0,
        };
    const status: WebhookDelivery['status'] = record.success
      ? 'delivered'
      : nextRetryAt
        ? 'pending'
        : 'dead_letter';

    return {
      deliveryId: record.id,
      webhookId: record.webhookId,
      eventType: record.eventType as WebhookEventType,
      payload: record.payload as Record<string, unknown>,
      status,
      attempts: record.attempt,
      maxAttempts: this.maxRetries,
      nextRetryAt,
      request: {
        url: '',
        headers: {},
        body: JSON.stringify(record.payload ?? {}),
      },
      response,
      createdAt: deliveredAt,
      completedAt: status === 'pending' ? null : deliveredAt,
    };
  }

  private dateToIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  // -------------------------------------------------------------------------
  // Payload signing
  // -------------------------------------------------------------------------
  private signPayload(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signaturePayload = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');
    return `t=${timestamp},v1=${hmac}`;
  }

  // -------------------------------------------------------------------------
  // Verify signature (for clients)
  // -------------------------------------------------------------------------
  static verifySignature(payload: string, signature: string, secret: string, toleranceSeconds = 300): boolean {
    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const sigPart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !sigPart) return false;

    const timestamp = timestampPart.slice(2);
    const sig = sigPart.slice(3);
    if (!/^\d+$/.test(timestamp) || !/^[0-9a-f]+$/i.test(sig)) return false;

    // Check tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > toleranceSeconds) return false;

    const expectedSig = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const actual = Buffer.from(sig, 'hex');
    const expected = Buffer.from(expectedSig, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }

  private protectWebhookSecret(secret: string): string {
    const key = this.getWebhookSecretEncryptionKey();
    if (!key) {
      return `${LOCAL_WEBHOOK_SECRET_PREFIX}${Buffer.from(secret, 'utf8').toString('base64url')}`;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(WEBHOOK_SECRET_AAD));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${ENCRYPTED_WEBHOOK_SECRET_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  private revealWebhookSecret(storedSecret: string): string {
    if (storedSecret.startsWith(ENCRYPTED_WEBHOOK_SECRET_PREFIX)) {
      const key = this.getWebhookSecretEncryptionKey();
      if (!key) {
        throw new WebhookError(
          `${WEBHOOK_SECRET_ENCRYPTION_KEY_ENV} is required to decrypt webhook secrets`,
          'WEBHOOK_SECRET_KEY_REQUIRED',
          500,
        );
      }

      const parts = storedSecret
        .slice(ENCRYPTED_WEBHOOK_SECRET_PREFIX.length)
        .split(':');
      if (parts.length !== 3) {
        throw new WebhookError(
          'Encrypted webhook secret payload is malformed',
          'WEBHOOK_SECRET_PAYLOAD_INVALID',
          500,
        );
      }

      try {
        const iv = Buffer.from(parts[0], 'base64url');
        const tag = Buffer.from(parts[1], 'base64url');
        const ciphertext = Buffer.from(parts[2], 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(WEBHOOK_SECRET_AAD));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new WebhookError(
          'Webhook secret decryption failed',
          'WEBHOOK_SECRET_DECRYPT_FAILED',
          500,
        );
      }
    }

    if (storedSecret.startsWith(LOCAL_WEBHOOK_SECRET_PREFIX)) {
      if (this.isProductionRuntime()) {
        throw new WebhookError(
          'Local webhook secret storage is blocked in production',
          'WEBHOOK_SECRET_LOCAL_STORAGE_BLOCKED',
          500,
        );
      }
      return Buffer.from(
        storedSecret.slice(LOCAL_WEBHOOK_SECRET_PREFIX.length),
        'base64url',
      ).toString('utf8');
    }

    if (this.isProductionRuntime()) {
      throw new WebhookError(
        'Legacy plaintext webhook secrets are blocked in production',
        'WEBHOOK_SECRET_PLAINTEXT_BLOCKED',
        500,
      );
    }

    return storedSecret;
  }

  private getWebhookSecretEncryptionKey(): Buffer | null {
    const rawKey = process.env[WEBHOOK_SECRET_ENCRYPTION_KEY_ENV]?.trim();
    if (!rawKey) {
      if (this.isProductionRuntime()) {
        throw new WebhookError(
          `${WEBHOOK_SECRET_ENCRYPTION_KEY_ENV} is required in production`,
          'WEBHOOK_SECRET_KEY_REQUIRED',
          500,
        );
      }
      return null;
    }

    const key = this.decodeWebhookSecretEncryptionKey(rawKey);
    if (!key || key.length !== 32) {
      throw new WebhookError(
        `${WEBHOOK_SECRET_ENCRYPTION_KEY_ENV} must decode to 32 bytes`,
        'WEBHOOK_SECRET_KEY_INVALID',
        500,
      );
    }

    return key;
  }

  private decodeWebhookSecretEncryptionKey(rawKey: string): Buffer | null {
    if (/^[0-9a-f]{64}$/i.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    try {
      const normalized = rawKey.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      return Buffer.from(padded, 'base64');
    } catch {
      return null;
    }
  }

  private isProductionRuntime(): boolean {
    return isSharedProductionRuntime();
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
export const webhookSystem = new WebhookSystem();
