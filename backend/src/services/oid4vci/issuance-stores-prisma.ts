/**
 * ZeroID — Prisma-backed OpenID4VCI stores (offers + token sessions).
 * Pre-authorized codes and access tokens are consumed atomically via `delete`,
 * so a code/token is usable exactly once.
 */
import type { PrismaClient } from '@prisma/client';
import type { IssuanceStores } from './issuance';

export function createPrismaIssuanceStores(
  prisma: Pick<PrismaClient, 'oid4vciOffer' | 'oid4vciTokenSession'>,
): IssuanceStores {
  return {
    async saveOffer(code, grant) {
      await prisma.oid4vciOffer.create({
        data: {
          preAuthCode: code,
          configId: grant.configId,
          subjectDid: grant.subjectDid,
          txCode: grant.txCode ?? null,
          expiresAt: new Date(grant.expiresAt * 1000),
        },
      });
    },

    async takeOffer(code) {
      try {
        const r = await prisma.oid4vciOffer.delete({ where: { preAuthCode: code } }); // atomic one-time
        return {
          configId: r.configId,
          subjectDid: r.subjectDid,
          txCode: r.txCode ?? undefined,
          expiresAt: Math.floor(r.expiresAt.getTime() / 1000),
        };
      } catch {
        return null;
      }
    },

    async saveToken(token, session) {
      await prisma.oid4vciTokenSession.create({
        data: {
          accessToken: token,
          configId: session.configId,
          subjectDid: session.subjectDid,
          cNonce: session.cNonce,
          expiresAt: new Date(session.expiresAt * 1000),
        },
      });
    },

    async getToken(token) {
      const r = await prisma.oid4vciTokenSession.findUnique({ where: { accessToken: token } });
      if (!r) return null;
      return {
        configId: r.configId,
        subjectDid: r.subjectDid,
        cNonce: r.cNonce,
        expiresAt: Math.floor(r.expiresAt.getTime() / 1000),
      };
    },

    async deleteToken(token) {
      await prisma.oid4vciTokenSession.delete({ where: { accessToken: token } }).catch(() => undefined);
    },
  };
}
