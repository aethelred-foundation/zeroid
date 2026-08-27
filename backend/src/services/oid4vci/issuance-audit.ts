/**
 * ZeroID — tamper-evident audit recorder for OpenID4VCI credential issuance.
 *
 * Appends a hash-chained CREDENTIAL_ISSUED AuditLog entry per issuance.
 * Privacy-safe: records the configuration, credential type, holder DID, and
 * format — never the issued credential material (which carries the claims).
 */
import { AuditAction, type PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit-append';
import type { IssuanceAuditRecord } from './issuance';

export function createPrismaIssuanceAuditRecorder(
  prisma: Pick<PrismaClient, 'auditLog'>,
): (record: IssuanceAuditRecord) => Promise<void> {
  return async (record) => {
    await appendAuditLog(prisma, {
      action: AuditAction.CREDENTIAL_ISSUED,
      resourceType: 'oid4vci_credential',
      details: {
        configId: record.configId,
        vct: record.vct,
        subjectDid: record.subjectDid,
        format: record.format,
        issuedAt: record.issuedAt,
      },
    });
  };
}
