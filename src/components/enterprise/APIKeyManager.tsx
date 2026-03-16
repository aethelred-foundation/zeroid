'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  Clock,
  AlertTriangle,
  X,
  Loader2,
  Activity,
  ChevronDown,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type KeyScope = 'read' | 'write' | 'admin' | 'verify' | 'issue';

interface APIKey {
  id: string;
  name: string;
  keyPrefix: string;
  fullKey?: string;
  scopes: KeyScope[];
  createdAt: string;
  lastUsed?: string;
  requestCount: number;
  rateLimit: number;
  rateLimitUsed: number;
  active: boolean;
}

interface APIKeyManagerProps {
  keys?: APIKey[];
  loading?: boolean;
  error?: string | null;
  onCreateKey?: (name: string, scopes: KeyScope[]) => Promise<string>;
  onRotateKey?: (keyId: string) => Promise<string>;
  onDeleteKey?: (keyId: string) => Promise<void>;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SCOPE_CONFIG: Record<KeyScope, { label: string; color: string; description: string }> = {
  read: { label: 'Read', color: 'text-blue-400 bg-blue-500/10', description: 'Read identity and credential data' },
  write: { label: 'Write', color: 'text-emerald-400 bg-emerald-500/10', description: 'Create and update credentials' },
  admin: { label: 'Admin', color: 'text-red-400 bg-red-500/10', description: 'Full administrative access' },
  verify: { label: 'Verify', color: 'text-violet-400 bg-violet-500/10', description: 'Verify proofs and credentials' },
  issue: { label: 'Issue', color: 'text-amber-400 bg-amber-500/10', description: 'Issue new credentials' },
};

const DEFAULT_KEYS: APIKey[] = [
  { id: 'k1', name: 'Production API', keyPrefix: 'zid_live_a8f3...', scopes: ['read', 'write', 'verify'], createdAt: '2026-01-15', lastUsed: '2026-03-15', requestCount: 142850, rateLimit: 10000, rateLimitUsed: 3420, active: true },
  { id: 'k2', name: 'Staging Environment', keyPrefix: 'zid_test_b2c1...', scopes: ['read', 'write', 'verify', 'issue'], createdAt: '2026-02-01', lastUsed: '2026-03-14', requestCount: 28340, rateLimit: 5000, rateLimitUsed: 890, active: true },
  { id: 'k3', name: 'Analytics Dashboard', keyPrefix: 'zid_live_c9d2...', scopes: ['read'], createdAt: '2026-02-20', lastUsed: '2026-03-13', requestCount: 56210, rateLimit: 20000, rateLimitUsed: 12500, active: true },
  { id: 'k4', name: 'Legacy Integration', keyPrefix: 'zid_live_d4e5...', scopes: ['read', 'verify'], createdAt: '2025-11-05', lastUsed: '2026-01-20', requestCount: 8920, rateLimit: 1000, rateLimitUsed: 0, active: false },
];

// ============================================================================
// Sub-components
// ============================================================================

function CreateKeyModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string, scopes: KeyScope[]) => void;
}) {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<KeyScope>>(new Set(['read']));

  const toggleScope = (scope: KeyScope) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        if (next.size > 1) next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-md rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-2xl"
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Create API Key</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
            <X className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">Key Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Production API"
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-2">Scopes</label>
            <div className="space-y-2">
              {(Object.entries(SCOPE_CONFIG) as [KeyScope, typeof SCOPE_CONFIG[KeyScope]][]).map(
                ([scope, config]) => (
                  <button
                    key={scope}
                    onClick={() => toggleScope(scope)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                      selectedScopes.has(scope)
                        ? 'border-brand-500/30 bg-brand-500/5'
                        : 'border-[var(--border-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)]'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        selectedScopes.has(scope)
                          ? 'border-brand-500 bg-brand-500'
                          : 'border-[var(--border-primary)]'
                      }`}
                    >
                      {selectedScopes.has(scope) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${config.color}`}>
                        {config.label}
                      </span>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{config.description}</p>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-[var(--border-primary)]">
          <button onClick={onClose} className="flex-1 btn-ghost btn-sm">
            Cancel
          </button>
          <button
            onClick={() => {
              if (name.trim()) onSubmit(name.trim(), Array.from(selectedScopes));
            }}
            disabled={!name.trim()}
            className="flex-1 btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Key className="w-3.5 h-3.5" />
            Create Key
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-sm rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-elevated)] shadow-2xl p-5"
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">{message}</p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="flex-1 btn-ghost btn-sm">Cancel</button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              danger
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : 'bg-brand-500 text-white hover:bg-brand-600'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function APIKeyManager({
  keys = DEFAULT_KEYS,
  loading = false,
  error = null,
  onCreateKey,
  onRotateKey,
  onDeleteKey,
  className = '',
}: APIKeyManagerProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'rotate' | 'delete'; keyId: string } | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleVisibility = (keyId: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const handleCopy = async (text: string, keyId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(keyId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleCreate = useCallback(
    async (name: string, scopes: KeyScope[]) => {
      if (onCreateKey) {
        await onCreateKey(name, scopes);
      }
      setShowCreateModal(false);
    },
    [onCreateKey]
  );

  const handleConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'rotate' && onRotateKey) {
      await onRotateKey(confirmAction.keyId);
    }
    if (confirmAction.type === 'delete' && onDeleteKey) {
      await onDeleteKey(confirmAction.keyId);
    }
    setConfirmAction(null);
  }, [confirmAction, onRotateKey, onDeleteKey]);

  if (loading) {
    return (
      <div className={`card p-8 flex items-center justify-center gap-2 ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-sm text-[var(--text-secondary)]">Loading API keys...</span>
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
          <Key className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">API Keys</h3>
          <span className="text-[10px] text-[var(--text-tertiary)]">{keys.length} keys</span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Create Key
        </button>
      </div>

      {/* Key list */}
      <div className="divide-y divide-[var(--border-primary)]">
        {keys.map((key, idx) => (
          <motion.div
            key={key.id}
            className={`px-5 py-4 ${!key.active ? 'opacity-50' : ''}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: key.active ? 1 : 0.5, y: 0 }}
            transition={{ duration: 0.2, delay: idx * 0.05 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-medium text-[var(--text-primary)]">{key.name}</h4>
                  {!key.active && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400">
                      Inactive
                    </span>
                  )}
                </div>

                {/* Key display */}
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--surface-secondary)] px-2.5 py-1 rounded-lg">
                    {visibleKeys.has(key.id) && key.fullKey ? key.fullKey : key.keyPrefix}
                  </code>
                  <button
                    onClick={() => toggleVisibility(key.id)}
                    className="p-1 rounded hover:bg-[var(--surface-secondary)] transition-colors"
                    aria-label="Toggle key visibility"
                  >
                    {visibleKeys.has(key.id) ? (
                      <EyeOff className="w-3 h-3 text-[var(--text-tertiary)]" />
                    ) : (
                      <Eye className="w-3 h-3 text-[var(--text-tertiary)]" />
                    )}
                  </button>
                  <button
                    onClick={() => handleCopy(key.fullKey ?? key.keyPrefix, key.id)}
                    className="p-1 rounded hover:bg-[var(--surface-secondary)] transition-colors"
                    aria-label="Copy key"
                  >
                    {copiedId === key.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
                    )}
                  </button>
                </div>

                {/* Scopes */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${SCOPE_CONFIG[scope].color}`}
                    >
                      {SCOPE_CONFIG[scope].label}
                    </span>
                  ))}
                </div>

                {/* Meta */}
                <div className="flex items-center gap-4 text-[10px] text-[var(--text-tertiary)]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Created {key.createdAt}
                  </span>
                  {key.lastUsed && (
                    <span>Last used {key.lastUsed}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    {key.requestCount.toLocaleString()} requests
                  </span>
                </div>

                {/* Rate limit */}
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--text-tertiary)]">Rate Limit</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {key.rateLimitUsed.toLocaleString()} / {key.rateLimit.toLocaleString()} req/hr
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--surface-tertiary)]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        key.rateLimitUsed / key.rateLimit > 0.8 ? 'bg-red-500' : key.rateLimitUsed / key.rateLimit > 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min((key.rateLimitUsed / key.rateLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setConfirmAction({ type: 'rotate', keyId: key.id })}
                  className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
                  aria-label="Rotate key"
                  title="Rotate key"
                >
                  <RefreshCw className="w-4 h-4 text-[var(--text-tertiary)]" />
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'delete', keyId: key.id })}
                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                  aria-label="Delete key"
                  title="Delete key"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateKeyModal
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreate}
          />
        )}
        {confirmAction?.type === 'rotate' && (
          <ConfirmModal
            title="Rotate API Key"
            message="Rotating this key will invalidate the current key immediately. Any systems using this key will need to be updated. This action cannot be undone."
            confirmLabel="Rotate Key"
            onClose={() => setConfirmAction(null)}
            onConfirm={handleConfirmAction}
          />
        )}
        {confirmAction?.type === 'delete' && (
          <ConfirmModal
            title="Delete API Key"
            message="This will permanently delete the API key. Any systems using this key will immediately lose access. This action cannot be undone."
            confirmLabel="Delete Key"
            danger
            onClose={() => setConfirmAction(null)}
            onConfirm={handleConfirmAction}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
