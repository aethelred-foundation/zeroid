import { createHash } from 'crypto';

export const AUDIT_INTEGRITY_VERSION = 'zeroid.audit.hash.v1';
export const AUDIT_CHAIN_GENESIS = '0'.repeat(64);

export interface AuditIntegritySource {
  id?: string | null;
  identityId?: string | null;
  action: unknown;
  resourceType: unknown;
  resourceId: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  details?: unknown;
  previousState?: unknown;
  newState?: unknown;
  timestamp?: Date | string | null;
}

export interface AuditIntegrityFields {
  previousHash: string;
  entryHash: string;
  integrityVersion: typeof AUDIT_INTEGRITY_VERSION;
  timestamp: Date;
}

export function buildAuditIntegrityFields(
  entry: AuditIntegritySource,
  previousHash = AUDIT_CHAIN_GENESIS,
  now = new Date(),
): AuditIntegrityFields {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : now;
  const normalizedPreviousHash = normalizePreviousHash(previousHash);
  const payload = {
    action: entry.action,
    details: entry.details ?? null,
    identityId: entry.identityId ?? null,
    integrityVersion: AUDIT_INTEGRITY_VERSION,
    ipAddress: entry.ipAddress ?? null,
    newState: entry.newState ?? null,
    previousHash: normalizedPreviousHash,
    previousState: entry.previousState ?? null,
    resourceId: entry.resourceId,
    resourceType: entry.resourceType,
    timestamp: timestamp.toISOString(),
    userAgent: entry.userAgent ?? null,
  };

  return {
    previousHash: normalizedPreviousHash,
    entryHash: createHash('sha256')
      .update(canonicalizeAuditValue(payload))
      .digest('hex'),
    integrityVersion: AUDIT_INTEGRITY_VERSION,
    timestamp,
  };
}

export function canonicalizeAuditValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeAuditValue(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalizeAuditValue(record[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizePreviousHash(value: string | null | undefined): string {
  if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) {
    return value.toLowerCase();
  }
  return AUDIT_CHAIN_GENESIS;
}
