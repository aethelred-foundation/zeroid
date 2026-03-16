/**
 * useEnterprise — Hook for enterprise integration management.
 *
 * Provides API key lifecycle, webhook configuration, SLA reporting,
 * and usage metrics. Designed for enterprise customers integrating
 * ZeroID into their existing identity infrastructure.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { ISODateString } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface APIKeyConfig {
  name: string;
  scopes: APIScope[];
  rateLimit: number;
  rateLimitWindow: number;
  allowedOrigins: string[];
  allowedIPs: string[];
  expiresAt?: ISODateString;
  metadata?: Record<string, string>;
}

export interface APIKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: APIScope[];
  rateLimit: number;
  rateLimitWindow: number;
  allowedOrigins: string[];
  allowedIPs: string[];
  createdAt: ISODateString;
  expiresAt?: ISODateString;
  lastUsedAt?: ISODateString;
  isActive: boolean;
  usageCount: number;
  metadata?: Record<string, string>;
}

export interface APIKeyWithSecret extends APIKey {
  /** Full API key — only returned once at creation time */
  secret: string;
}

export type APIScope =
  | 'identity:read'
  | 'identity:write'
  | 'credential:read'
  | 'credential:write'
  | 'credential:verify'
  | 'proof:generate'
  | 'proof:verify'
  | 'compliance:read'
  | 'compliance:write'
  | 'agent:manage'
  | 'webhook:manage'
  | 'analytics:read';

export interface WebhookConfig {
  url: string;
  events: WebhookEvent[];
  secret?: string;
  headers?: Record<string, string>;
  retryPolicy: RetryPolicy;
  enabled: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  enabled: boolean;
  retryPolicy: RetryPolicy;
  lastTriggeredAt?: ISODateString;
  successRate: number;
  totalDeliveries: number;
  failedDeliveries: number;
  signingKeyId: string;
}

export type WebhookEvent =
  | 'identity.created'
  | 'identity.updated'
  | 'identity.suspended'
  | 'credential.issued'
  | 'credential.revoked'
  | 'credential.expired'
  | 'verification.completed'
  | 'verification.failed'
  | 'compliance.alert'
  | 'agent.action'
  | 'bridge.completed';

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface WebhookTestResult {
  webhookId: string;
  delivered: boolean;
  statusCode: number;
  responseTimeMs: number;
  error?: string;
  testedAt: ISODateString;
}

export interface SLAReport {
  period: ReportPeriod;
  startDate: ISODateString;
  endDate: ISODateString;
  uptimePercent: number;
  uptimeTarget: number;
  avgResponseTimeMs: number;
  p99ResponseTimeMs: number;
  totalRequests: number;
  failedRequests: number;
  errorRate: number;
  incidentCount: number;
  incidents: SLAIncident[];
  complianceMet: boolean;
}

export interface SLAIncident {
  id: string;
  title: string;
  severity: 'minor' | 'major' | 'critical';
  startedAt: ISODateString;
  resolvedAt?: ISODateString;
  durationMinutes: number;
  affectedServices: string[];
  rootCause?: string;
}

export type ReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface UsageMetrics {
  period: ReportPeriod;
  startDate: ISODateString;
  endDate: ISODateString;
  totalAPIRequests: number;
  uniqueIdentities: number;
  credentialsIssued: number;
  credentialsVerified: number;
  proofsGenerated: number;
  agentActions: number;
  bandwidthMB: number;
  costEstimateUSD: number;
  breakdownByEndpoint: EndpointUsage[];
  breakdownByDay: DailyUsage[];
}

export interface EndpointUsage {
  endpoint: string;
  method: string;
  requestCount: number;
  avgResponseTimeMs: number;
  errorCount: number;
}

export interface DailyUsage {
  date: ISODateString;
  requests: number;
  uniqueUsers: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

const enterpriseKeys = {
  all: ['enterprise'] as const,
  apiKeys: () => [...enterpriseKeys.all, 'api-keys'] as const,
  webhooks: () => [...enterpriseKeys.all, 'webhooks'] as const,
  sla: (period: ReportPeriod) => [...enterpriseKeys.all, 'sla', period] as const,
  usage: (period: ReportPeriod) => [...enterpriseKeys.all, 'usage', period] as const,
};

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export function useAPIKeys() {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.apiKeys(),
    queryFn: () =>
      apiClient.get<APIKey[]>('/api/v1/enterprise/api-keys', {
        owner: address as string,
      }) as unknown as APIKey[],
    enabled: !!address,
    staleTime: 30_000,
  });
}

export function useCreateAPIKey() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (config: APIKeyConfig): Promise<APIKeyWithSecret> => {
      return apiClient.post<APIKeyWithSecret>('/api/v1/enterprise/api-keys', {
        ...config,
        ownerAddress: address,
      }) as unknown as APIKeyWithSecret;
    },
    onSuccess: (data) => {
      toast.success('API key created', {
        description: `"${data.name}" — copy the secret now, it will not be shown again`,
        duration: 10_000,
      });
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.apiKeys() });
    },
    onError: (err: Error) => {
      toast.error('API key creation failed', { description: err.message });
    },
  });
}

export function useRevokeAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keyId: string): Promise<void> => {
      await apiClient.del(`/api/v1/enterprise/api-keys/${keyId}`);
    },
    onSuccess: () => {
      toast.success('API key revoked');
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.apiKeys() });
    },
    onError: (err: Error) => {
      toast.error('Key revocation failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export function useWebhooks() {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.webhooks(),
    queryFn: () =>
      apiClient.get<Webhook[]>('/api/v1/enterprise/webhooks', {
        owner: address as string,
      }) as unknown as Webhook[],
    enabled: !!address,
    staleTime: 30_000,
  });
}

export function useRegisterWebhook() {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  return useMutation({
    mutationFn: async (config: WebhookConfig): Promise<Webhook> => {
      return apiClient.post<Webhook>('/api/v1/enterprise/webhooks', {
        ...config,
        ownerAddress: address,
      }) as unknown as Webhook;
    },
    onSuccess: (data) => {
      toast.success('Webhook registered', {
        description: `Listening for ${data.events.length} event type(s) at ${data.url}`,
      });
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.webhooks() });
    },
    onError: (err: Error) => {
      toast.error('Webhook registration failed', { description: err.message });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (webhookId: string): Promise<WebhookTestResult> => {
      return apiClient.post<WebhookTestResult>(
        `/api/v1/enterprise/webhooks/${webhookId}/test`,
        {},
      ) as unknown as WebhookTestResult;
    },
    onSuccess: (data) => {
      if (data.delivered) {
        toast.success('Webhook test delivered', {
          description: `Status ${data.statusCode}, ${data.responseTimeMs}ms`,
        });
      } else {
        toast.error('Webhook test failed', {
          description: data.error ?? `Status ${data.statusCode}`,
        });
      }
    },
    onError: (err: Error) => {
      toast.error('Webhook test request failed', { description: err.message });
    },
  });
}

// ---------------------------------------------------------------------------
// SLA Report
// ---------------------------------------------------------------------------

export function useSLAReport(period: ReportPeriod = 'month') {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.sla(period),
    queryFn: () =>
      apiClient.get<SLAReport>('/api/v1/enterprise/sla', {
        period,
        owner: address as string,
      }) as unknown as SLAReport,
    enabled: !!address,
    staleTime: 300_000,
  });
}

// ---------------------------------------------------------------------------
// Usage Metrics
// ---------------------------------------------------------------------------

export function useUsageMetrics(period: ReportPeriod = 'month') {
  const { address } = useAccount();

  return useQuery({
    queryKey: enterpriseKeys.usage(period),
    queryFn: () =>
      apiClient.get<UsageMetrics>('/api/v1/enterprise/usage', {
        period,
        owner: address as string,
      }) as unknown as UsageMetrics,
    enabled: !!address,
    staleTime: 120_000,
  });
}
