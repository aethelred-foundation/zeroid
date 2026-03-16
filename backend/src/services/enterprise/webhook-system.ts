import { z } from 'zod';
import { createLogger, format, transports } from 'winston';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: 'webhook-system' },
  transports: [new transports.Console()],
});

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
  url: z.string().url(),
  events: z.array(WebhookEventTypeSchema).min(1),
  secret: z.string().min(32).optional(),
  description: z.string().optional(),
  active: z.boolean().default(true),
  metadata: z.record(z.string()).default({}),
  batchDelivery: z.boolean().default(false),
  batchIntervalMs: z.number().int().min(1000).max(60000).default(5000),
  headers: z.record(z.string()).default({}),
});

export type WebhookRegistration = z.infer<typeof WebhookRegistrationSchema>;

export const WebhookUpdateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(WebhookEventTypeSchema).min(1).optional(),
  active: z.boolean().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
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
  private windows: Map<string, { count: number; windowStart: number }> = new Map();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(maxPerWindow = 100, windowMs = 60000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  allow(webhookId: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(webhookId);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.windows.set(webhookId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.maxPerWindow) {
      return false;
    }

    entry.count++;
    return true;
  }
}

// ---------------------------------------------------------------------------
// WebhookSystem
// ---------------------------------------------------------------------------
export class WebhookSystem {
  private webhooks: Map<string, RegisteredWebhook> = new Map();
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

  // -------------------------------------------------------------------------
  // Webhook registration
  // -------------------------------------------------------------------------
  register(clientId: string, registration: WebhookRegistration): RegisteredWebhook {
    const parsed = WebhookRegistrationSchema.parse(registration);
    const id = crypto.randomUUID();
    const secret = parsed.secret ?? crypto.randomBytes(32).toString('hex');

    const webhook: RegisteredWebhook = {
      id,
      clientId,
      url: parsed.url,
      events: parsed.events,
      secret,
      description: parsed.description ?? '',
      active: parsed.active,
      metadata: parsed.metadata,
      batchDelivery: parsed.batchDelivery,
      batchIntervalMs: parsed.batchIntervalMs,
      headers: parsed.headers,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    };

    this.webhooks.set(id, webhook);
    logger.info('webhook_registered', { webhookId: id, clientId, url: parsed.url, events: parsed.events });
    return webhook;
  }

  // -------------------------------------------------------------------------
  // Webhook update
  // -------------------------------------------------------------------------
  update(webhookId: string, clientId: string, updates: WebhookUpdate): RegisteredWebhook {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook || webhook.clientId !== clientId) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    const parsed = WebhookUpdateSchema.parse(updates);
    if (parsed.url !== undefined) webhook.url = parsed.url;
    if (parsed.events !== undefined) webhook.events = parsed.events;
    if (parsed.active !== undefined) webhook.active = parsed.active;
    if (parsed.description !== undefined) webhook.description = parsed.description;
    if (parsed.metadata !== undefined) webhook.metadata = parsed.metadata;
    if (parsed.headers !== undefined) webhook.headers = parsed.headers;
    webhook.updatedAt = new Date().toISOString();

    // Re-enable if was auto-disabled
    if (parsed.active === true && webhook.health.disabled) {
      webhook.health.disabled = false;
      webhook.health.disabledReason = null;
      webhook.health.consecutiveFailures = 0;
    }

    this.webhooks.set(webhookId, webhook);
    logger.info('webhook_updated', { webhookId, updates: Object.keys(parsed) });
    return webhook;
  }

  // -------------------------------------------------------------------------
  // Remove webhook
  // -------------------------------------------------------------------------
  remove(webhookId: string, clientId: string): void {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook || webhook.clientId !== clientId) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }
    this.webhooks.delete(webhookId);
    this.batchBuffers.delete(webhookId);
    logger.info('webhook_removed', { webhookId, clientId });
  }

  // -------------------------------------------------------------------------
  // List webhooks for a client
  // -------------------------------------------------------------------------
  list(clientId: string): RegisteredWebhook[] {
    return [...this.webhooks.values()].filter((w) => w.clientId === clientId);
  }

  getWebhook(webhookId: string): RegisteredWebhook | null {
    return this.webhooks.get(webhookId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Emit event — dispatches to all matching webhooks
  // -------------------------------------------------------------------------
  async emit(eventType: WebhookEventType, data: Record<string, unknown>, source = 'zeroid'): Promise<string[]> {
    const event: WebhookEvent = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      data,
      source,
    };

    this.eventLog.push(event);
    if (this.eventLog.length > 10000) {
      this.eventLog = this.eventLog.slice(-5000);
    }

    const matchingWebhooks = [...this.webhooks.values()].filter(
      (w) => w.active && !w.health.disabled && w.events.includes(eventType),
    );

    const deliveryIds: string[] = [];

    for (const webhook of matchingWebhooks) {
      if (webhook.batchDelivery) {
        const buffer = this.batchBuffers.get(webhook.id) ?? [];
        buffer.push(event);
        this.batchBuffers.set(webhook.id, buffer);
        continue;
      }

      if (!this.rateLimiter.allow(webhook.id)) {
        logger.warn('webhook_rate_limited', { webhookId: webhook.id });
        continue;
      }

      const deliveryId = await this.deliver(webhook, event);
      deliveryIds.push(deliveryId);
    }

    logger.info('event_emitted', { eventId: event.eventId, eventType, matchedWebhooks: matchingWebhooks.length });
    return deliveryIds;
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
      'Content-Type': 'application/json',
      'X-ZeroID-Signature': signature,
      'X-ZeroID-Event': event.eventType,
      'X-ZeroID-Delivery': deliveryId,
      'X-ZeroID-Timestamp': event.timestamp,
      'User-Agent': 'ZeroID-Webhook/1.0',
      ...webhook.headers,
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
      const response = await fetch(delivery.request.url, {
        method: 'POST',
        headers: delivery.request.headers,
        body: delivery.request.body,
        signal: AbortSignal.timeout(30000),
      });

      const latencyMs = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      delivery.response = {
        statusCode: response.status,
        body: responseBody.substring(0, 1024),
        latencyMs,
      };

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.completedAt = new Date().toISOString();
        this.updateHealth(webhook, true, response.status, latencyMs);
        logger.info('webhook_delivered', { deliveryId: delivery.deliveryId, webhookId: webhook.id, latencyMs });
      } else {
        throw new Error(`HTTP ${response.status}: ${responseBody.substring(0, 200)}`);
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

      if (delivery.attempts < delivery.maxAttempts) {
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
  }

  // -------------------------------------------------------------------------
  // Flush batch buffer
  // -------------------------------------------------------------------------
  async flushBatch(webhookId: string): Promise<string | null> {
    const buffer = this.batchBuffers.get(webhookId);
    if (!buffer || buffer.length === 0) return null;

    const webhook = this.webhooks.get(webhookId);
    if (!webhook) return null;

    const batchEvent: WebhookEvent = {
      eventId: crypto.randomUUID(),
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
  async replayEvents(webhookId: string, since: string, until?: string): Promise<{ replayed: number; deliveryIds: string[] }> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new WebhookError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }

    const sinceTime = new Date(since).getTime();
    const untilTime = until ? new Date(until).getTime() : Date.now();

    const eventsToReplay = this.eventLog.filter((e) => {
      const eventTime = new Date(e.timestamp).getTime();
      return eventTime >= sinceTime && eventTime <= untilTime && webhook.events.includes(e.eventType);
    });

    const deliveryIds: string[] = [];
    for (const event of eventsToReplay) {
      const deliveryId = await this.deliver(webhook, event);
      deliveryIds.push(deliveryId);
    }

    logger.info('events_replayed', { webhookId, replayed: eventsToReplay.length, since, until });
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
    if (!dlEntry) return false;

    const delivery = this.deliveries.get(deliveryId);
    const webhook = this.webhooks.get(dlEntry.webhookId);
    if (!delivery || !webhook) return false;

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
  getDeliveries(webhookId: string, limit = 50): WebhookDelivery[] {
    return [...this.deliveries.values()]
      .filter((d) => d.webhookId === webhookId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  getDelivery(deliveryId: string): WebhookDelivery | null {
    return this.deliveries.get(deliveryId) ?? null;
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

    // Check tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > toleranceSeconds) return false;

    const expectedSig = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
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
