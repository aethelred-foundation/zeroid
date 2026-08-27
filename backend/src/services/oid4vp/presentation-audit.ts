/**
 * ZeroID — tamper-evident audit recorder for OpenID4VP presentation decisions.
 *
 * Appends a hash-chained AuditLog entry for every verified presentation.
 * Privacy-safe: records the claim NAMES that were disclosed, never their values
 * — and a ZK predicate records none at all.
 */
import { AuditAction, type PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit-append';
import type { PresentationDecision } from './verifier';

export function createPrismaPresentationAuditRecorder(
  prisma: Pick<PrismaClient, 'auditLog'>,
): (decision: PresentationDecision) => Promise<void> {
  return async (decision) => {
    await appendAuditLog(prisma, {
      action:
        decision.status === 'ALLOWED'
          ? AuditAction.VERIFICATION_COMPLETED
          : AuditAction.VERIFICATION_FAILED,
      resourceType: 'oid4vp_presentation',
      details: {
        policyId: decision.policyId,
        status: decision.status,
        format: decision.vct,
        disclosedClaims: decision.disclosedClaims, // names only, never values
        relyingAppId: decision.relyingAppId ?? null,
        reasons: decision.reasons,
        verifiedAt: decision.verifiedAt,
      },
    });
  };
}
