/**
 * ZeroID — append a hash-chained AuditLog entry.
 *
 * One path for writing tamper-evident audit records: look up the latest
 * `entryHash`, build the integrity fields (`buildAuditIntegrityFields`), and
 * insert. Shared by every recorder (OpenID4VP presentations, OpenID4VCI
 * issuance, …) so the chain is produced identically everywhere.
 */
import { randomUUID } from 'node:crypto';
import { type AuditAction, type Prisma, type PrismaClient } from '@prisma/client';
import { buildAuditIntegrityFields, AUDIT_CHAIN_GENESIS } from './audit-integrity';

export interface AuditAppendEntry {
  action: AuditAction;
  resourceType: string;
  /** Defaults to a generated UUID. */
  resourceId?: string;
  identityId?: string | null;
  /** Privacy-safe payload — never raw PII / credential material. */
  details: unknown;
}

export async function appendAuditLog(
  prisma: Pick<PrismaClient, 'auditLog'>,
  entry: AuditAppendEntry,
): Promise<void> {
  const latest = await prisma.auditLog.findFirst({
    orderBy: { timestamp: 'desc' },
    select: { entryHash: true },
  });

  const resourceId = entry.resourceId ?? randomUUID();
  const fields = buildAuditIntegrityFields(
    {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId,
      identityId: entry.identityId ?? null,
      details: entry.details,
    },
    latest?.entryHash ?? AUDIT_CHAIN_GENESIS,
  );

  await prisma.auditLog.create({
    data: {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId,
      identityId: entry.identityId ?? null,
      details: entry.details as Prisma.InputJsonValue,
      previousHash: fields.previousHash,
      entryHash: fields.entryHash,
      integrityVersion: fields.integrityVersion,
      timestamp: fields.timestamp,
    },
  });
}
