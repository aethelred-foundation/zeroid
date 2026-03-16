'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Webhook,
  Plus,
  Trash2,
  Play,
  RefreshCw,
  Check,
  X,
  Copy,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Shield,
  Activity,
  Eye,
  Globe,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type WebhookStatus = 'healthy' | 'degraded' | 'failing';
type DeliveryStatus = 'success' | 'failed' | 'pending';

type WebhookEventType =
  | 'credential.issued'
  | 'credential.revoked'
  | 'credential.expired'
  | 'identity.created'
  | 'identity.updated'
  | 'verification.completed'
  | 'proof.generated'
  | 'threat.detected';

interface DeliveryLog {
  id: string;
  status: DeliveryStatus;
  statusCode?: number;
  responseTime?: number;
  timestamp: string;
  eventType: WebhookEventType;
  error?: string;
}

interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEventType[];
  status: WebhookStatus;
  secret: string;
  active: boolean;
  createdAt: string;
  successRate: number;
  deliveryLogs: DeliveryLog[];
}

interface WebhookManagerProps {
  webhooks?: WebhookConfig[];
  loading?: boolean;
  error?: string | null;
  onAdd?: (url: string, events: WebhookEventType[], secret: string) => Promise<void>;
  onDelete?: (webhookId: string) => Promise<void>;
  onTest?: (webhookId: string) => Promise<void>;
  onRetry?: (webhookId: string, deliveryId: string) => Promise<void>;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const EVENT_TYPES: { value: WebhookEventType; label: string }[] = [
  { value: 'credential.issued', label: 'Credential Issued' },
  { value: 'credential.revoked', label: 'Credential Revoked' },
  { value: 'credential.expired', label: 'Credential Expired' },
  { value: 'identity.created', label: 'Identity Created' },
  { value: 'identity.updated', label: 'Identity Updated' },
  { value: 'verification.completed', label: 'Verification Completed' },
  { value: 'proof.generated', label: 'Proof Generated' },
  { value: 'threat.detected', label: 'Threat Detected' },
];

const STATUS_CONFIG: Record<WebhookStatus, { label: string; color: string; dot: string }> = {
  healthy: { label: 'Healthy', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  degraded: { label: 'Degraded', color: 'text-amber-400', dot: 'bg-amber-400' },
  failing: { label: 'Failing', color: 'text-red-400', dot: 'bg-red-400' },
};

const DELIVERY_STATUS_CONFIG: Record<DeliveryStatus, { icon: typeof Check; color: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-400' },
  failed: { icon: XCircle, color: 'text-red-400' },
  pending: { icon: Clock, color: 'text-amber-400' },
};

function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return `whsec_${Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
}

const DEFAULT_WEBHOOKS: WebhookConfig[] = [
  {
    id: 'wh1',
    url: 'https://api.example.com/webhooks/zeroid',
    events: ['credential.issued', 'credential.revoked', 'verification.completed'],
    status: 'healthy',
    secret: 'whsec_a1b2c3d4e5f6...',
    active: true,
    createdAt: '2026-01-20',
    successRate: 99.2,
    deliveryLogs: [
      { id: 'd1', status: 'success', statusCode: 200, responseTime: 142, timestamp: '2026-03-15T10:30:00Z', eventType: 'credential.issued' },
      { id: 'd2', status: 'success', statusCode: 200, responseTime: 98, timestamp: '2026-03-15T09:15:00Z', eventType: 'verification.completed' },
      { id: 'd3', status: 'failed', statusCode: 500, responseTime: 3010, timestamp: '2026-03-14T22:45:00Z', eventType: 'credential.revoked', error: 'Internal Server Error' },
    ],
  },
  {
    id: 'wh2',
    url: 'https://compliance.internal/hooks/identity',
    events: ['identity.created', 'identity.updated', 'threat.detected'],
    status: 'degraded',
    secret: 'whsec_g7h8i9j0k1l2...',
    active: true,
    createdAt: '2026-02-10',
    successRate: 87.5,
    deliveryLogs: [
      { id: 'd4', status: 'success', statusCode: 200, responseTime: 450, timestamp: '2026-03-15T11:00:00Z', eventType: 'identity.created' },
      { id: 'd5', status: 'failed', statusCode: 503, responseTime: 5000, timestamp: '2026-03-15T08:30:00Z', eventType: 'threat.detected', error: 'Service Unavailable' },
    ],
  },
];

// ============================================================================
// Sub-components
// ============================================================================

function AddWebhookForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (url: string, events: WebhookEventType[], secret: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<WebhookEventType>>(new Set());
  const [secret] = useState(generateSecret);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const toggleEvent = (event: WebhookEventType) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {}
  };

  const isValid = url.trim().startsWith('https://') && selectedEvents.size > 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-lg rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-2xl max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add Webhook</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <X className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* URL */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Endpoint URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/zeroid"
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-brand-500"
            />
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Must use HTTPS</p>
          </div>

          {/* Events */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-2">Event Types</label>
            <div className="grid grid-cols-2 gap-1.5">
              {EVENT_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleEvent(value)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    selectedEvents.has(value)
                      ? 'border-brand-500/30 bg-brand-500/5 text-[var(--text-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    selectedEvents.has(value) ? 'border-brand-500 bg-brand-500' : 'border-[var(--border-primary)]'
                  }`}>
                    {selectedEvents.has(value) && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Secret */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Signing Secret</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-[var(--text-secondary)] bg-[var(--surface-secondary)] px-3 py-2 rounded-lg truncate">
                {secret}
              </code>
              <button
                onClick={handleCopySecret}
                className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
              >
                {copiedSecret ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />}
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
              Use this secret to verify webhook signatures
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-[var(--border-primary)]">
          <button onClick={onClose} className="flex-1 btn-ghost btn-sm">Cancel</button>
          <button
            onClick={() => { if (isValid) onSubmit(url.trim(), Array.from(selectedEvents), secret); }}
            disabled={!isValid}
            className="flex-1 btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Webhook className="w-3.5 h-3.5" />
            Add Webhook
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function WebhookCard({
  webhook,
  onTest,
  onDelete,
  onRetry,
}: {
  webhook: WebhookConfig;
  onTest?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRetry?: (webhookId: string, deliveryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = STATUS_CONFIG[webhook.status];

  return (
    <motion.div
      className="border-b border-[var(--border-primary)] last:border-b-0"
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        className="w-full text-left px-5 py-4 hover:bg-[var(--surface-secondary)] transition-colors focus:outline-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg ${webhook.active ? 'bg-brand-500/10' : 'bg-[var(--surface-tertiary)]'} flex items-center justify-center flex-shrink-0`}>
            <Globe className={`w-4 h-4 ${webhook.active ? 'text-brand-500' : 'text-[var(--text-tertiary)]'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-mono text-[var(--text-primary)] truncate">{webhook.url}</p>
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusConfig.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                {statusConfig.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
              <span>{webhook.events.length} events</span>
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {webhook.successRate}% success
              </span>
              <span>Created {webhook.createdAt}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {webhook.events.map((event) => (
                <span key={event} className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface-tertiary)] text-[var(--text-secondary)]">
                  {event}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onTest?.(webhook.id); }}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] transition-colors"
              title="Send test event"
            >
              <Play className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(webhook.id); }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
              title="Delete webhook"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
            {expanded ? <ChevronUp className="w-4 h-4 text-[var(--text-tertiary)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pt-2">
              <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                Recent Deliveries
              </p>
              <div className="space-y-1.5">
                {webhook.deliveryLogs.map((log) => {
                  const statusCfg = DELIVERY_STATUS_CONFIG[log.status];
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div
                      key={log.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--surface-secondary)]"
                    >
                      <StatusIcon className={`w-4 h-4 ${statusCfg.color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-primary)]">{log.eventType}</span>
                          {log.statusCode && (
                            <span className={`text-[10px] font-mono ${log.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {log.statusCode}
                            </span>
                          )}
                          {log.responseTime && (
                            <span className="text-[10px] text-[var(--text-tertiary)]">{log.responseTime}ms</span>
                          )}
                        </div>
                        {log.error && <p className="text-[10px] text-red-400 mt-0.5">{log.error}</p>}
                      </div>
                      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      {log.status === 'failed' && onRetry && (
                        <button
                          onClick={() => onRetry(webhook.id, log.id)}
                          className="p-1 rounded hover:bg-[var(--surface-tertiary)] transition-colors"
                          title="Retry delivery"
                        >
                          <RefreshCw className="w-3 h-3 text-[var(--text-tertiary)]" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {webhook.deliveryLogs.length === 0 && (
                  <p className="text-xs text-[var(--text-tertiary)] text-center py-4">No delivery logs yet</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function WebhookManager({
  webhooks = DEFAULT_WEBHOOKS,
  loading = false,
  error = null,
  onAdd,
  onDelete,
  onTest,
  onRetry,
  className = '',
}: WebhookManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = useCallback(
    async (url: string, events: WebhookEventType[], secret: string) => {
      if (onAdd) await onAdd(url, events, secret);
      setShowAddForm(false);
    },
    [onAdd]
  );

  if (loading) {
    return (
      <div className={`card p-8 flex items-center justify-center gap-2 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">Loading webhooks...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`card p-6 border-red-500/30 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Webhook className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Webhooks</h3>
          <span className="text-[10px] text-[var(--text-tertiary)]">{webhooks.length} endpoints</span>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Webhook
        </button>
      </div>

      {/* Webhook list */}
      {webhooks.length === 0 ? (
        <div className="p-8 text-center">
          <Webhook className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
          <p className="text-sm text-[var(--text-secondary)]">No webhooks configured</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Add a webhook to receive real-time event notifications
          </p>
        </div>
      ) : (
        webhooks.map((webhook) => (
          <WebhookCard
            key={webhook.id}
            webhook={webhook}
            onTest={onTest}
            onDelete={onDelete}
            onRetry={onRetry}
          />
        ))
      )}

      {/* Add form modal */}
      <AnimatePresence>
        {showAddForm && (
          <AddWebhookForm
            onClose={() => setShowAddForm(false)}
            onSubmit={handleAdd}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
