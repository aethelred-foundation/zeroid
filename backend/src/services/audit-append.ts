/**
 * ZeroID — append a hash-chained AuditLog entry.
 *
 * One path for writing tamper-evident audit records: look up the latest
 * `entryHash`, build the integrity fields (`buildAuditIntegrityFields`), and
 * insert. Shared by every recorder (OpenID4VP presentations, OpenID4VCI
 * issuance, …) so the chain is produced identically everywhere.
 */
import { randomUUID } from "node:crypto";
import {
  type AuditAction,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  buildAuditIntegrityFields,
  AUDIT_CHAIN_GENESIS,
} from "./audit-integrity";

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
  prisma: Pick<PrismaClient, "auditLog">,
  entry: AuditAppendEntry,
): Promise<void> {
  const resourceId = entry.resourceId ?? randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await prisma.auditLog.findFirst({
      where: { entryHash: { not: null } },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      select: { entryHash: true },
    });
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

    try {
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
      return;
    } catch (error) {
      if (!isAuditTailConflict(error) || attempt === 2) throw error;
    }
  }
}

function isAuditTailConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: string;
    meta?: { target?: unknown };
  };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes("previousHash")
    : typeof target === "string" && target.includes("previousHash");
}
