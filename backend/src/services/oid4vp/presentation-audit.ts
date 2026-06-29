/**
 * ZeroID — tamper-evident audit recorder for OpenID4VP presentation decisions.
 *
 * Appends a hash-chained AuditLog entry (the platform's existing integrity
 * scheme) for every verified presentation. Privacy-safe: it records the claim
 * NAMES that were disclosed, never their values — and a ZK predicate records
 * none at all.
 */
import { randomUUID } from 'node:crypto';
import { AuditAction, type Prisma, type PrismaClient } from '@prisma/client';
import { buildAuditIntegrityFields, AUDIT_CHAIN_GENESIS } from '../audit-integrity';
import type { PresentationDecision } from './verifier';

export function createPrismaPresentationAuditRecorder(
  prisma: Pick<PrismaClient, 'auditLog'>,
): (decision: PresentationDecision) => Promise<void> {
  return async (decision) => {
    const latest = await prisma.auditLog.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { entryHash: true },
    });

    const action =
      decision.status === 'ALLOWED'
        ? AuditAction.VERIFICATION_COMPLETED
        : AuditAction.VERIFICATION_FAILED;
    const resourceId = randomUUID();

    // Privacy-safe projection — claim names only, no values.
    const details = {
      policyId: decision.policyId,
      status: decision.status,
      format: decision.vct,
      disclosedClaims: decision.disclosedClaims,
      relyingAppId: decision.relyingAppId ?? null,
      reasons: decision.reasons,
      verifiedAt: decision.verifiedAt,
    };

    const fields = buildAuditIntegrityFields(
      { action, resourceType: 'oid4vp_presentation', resourceId, details },
      latest?.entryHash ?? AUDIT_CHAIN_GENESIS,
    );

    await prisma.auditLog.create({
      data: {
        action,
        resourceType: 'oid4vp_presentation',
        resourceId,
        details: details as Prisma.InputJsonValue,
        previousHash: fields.previousHash,
        entryHash: fields.entryHash,
        integrityVersion: fields.integrityVersion,
        timestamp: fields.timestamp,
      },
    });
  };
}
