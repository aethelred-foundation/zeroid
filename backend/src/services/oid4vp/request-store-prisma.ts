/**
 * ZeroID — Prisma-backed OpenID4VP presentation-request store.
 * Replay protection is enforced by an atomic conditional update (PENDING ->
 * CONSUMED), so a nonce can be consumed by exactly one concurrent callback.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Oid4vpRequestStore, PresentationRequestRecord } from './cross-device';
import type { PresentationDecision } from './verifier';

export function createPrismaOid4vpRequestStore(
  prisma: Pick<PrismaClient, 'oid4vpPresentationRequest'>,
): Oid4vpRequestStore {
  return {
    async save(rec) {
      await prisma.oid4vpPresentationRequest.create({
        data: {
          state: rec.state,
          nonce: rec.nonce,
          policyId: rec.policyId,
          audience: rec.audience,
          expiresAt: new Date(rec.expiresAt * 1000),
        },
      });
    },

    async getByState(state) {
      const r = await prisma.oid4vpPresentationRequest.findUnique({ where: { state } });
      if (!r) return null;
      return {
        state: r.state,
        nonce: r.nonce,
        policyId: r.policyId,
        audience: r.audience,
        status: r.status as PresentationRequestRecord['status'],
        decision: (r.decision as unknown as PresentationDecision | null) ?? null,
        expiresAt: Math.floor(r.expiresAt.getTime() / 1000),
      };
    },

    async consumeNonce(nonce) {
      const res = await prisma.oid4vpPresentationRequest.updateMany({
        where: { nonce, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'CONSUMED' },
      });
      return res.count === 1;
    },

    async saveDecision(state, decision) {
      await prisma.oid4vpPresentationRequest.update({
        where: { state },
        data: { status: 'COMPLETED', decision: decision as unknown as Prisma.InputJsonValue },
      });
    },
  };
}
