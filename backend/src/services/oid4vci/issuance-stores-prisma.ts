/**
 * ZeroID — durable OpenID4VCI offer/token storage.
 *
 * Security properties:
 *   - bearer values and low-entropy tx_codes are HMACed before persistence;
 *   - c_nonce values are encrypted with AES-256-GCM at rest;
 *   - offer redemption deletes the offer and creates the token in one DB tx;
 *   - credential issuance uses an owner-matched, bounded lease and CAS delete.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ServiceError } from '../errors';
import type { IssuanceStores } from './issuance';

export const OID4VCI_STORAGE_HASH_PEPPER_ENV = 'OID4VCI_STORAGE_HASH_PEPPER';
export const MIN_OID4VCI_STORAGE_HASH_PEPPER_LENGTH = 48;

const DEVELOPMENT_ONLY_PEPPER =
  'zeroid-oid4vci-development-only-storage-pepper-do-not-use-in-production';
const HASH_CONTEXT = 'zeroid:oid4vci:storage:v1';
const NONCE_ENVELOPE_VERSION = 'v1';

type PrismaIssuanceClient = Pick<
  PrismaClient,
  'oid4vciOffer' | 'oid4vciTokenSession' | '$transaction'
>;

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || env.ZEROID_ENV === 'production';
}

function resolvePepper(env: NodeJS.ProcessEnv): string {
  const configured = env[OID4VCI_STORAGE_HASH_PEPPER_ENV]?.trim();
  if (configured && configured.length >= MIN_OID4VCI_STORAGE_HASH_PEPPER_LENGTH) {
    return configured;
  }
  if (configured) {
    throw new ServiceError(
      `${OID4VCI_STORAGE_HASH_PEPPER_ENV} must contain at least ${MIN_OID4VCI_STORAGE_HASH_PEPPER_LENGTH} characters`,
      'OID4VCI_STORAGE_HASH_PEPPER_REQUIRED',
      503,
    );
  }
  if (isProduction(env)) {
    throw new ServiceError(
      `${OID4VCI_STORAGE_HASH_PEPPER_ENV} must contain at least ${MIN_OID4VCI_STORAGE_HASH_PEPPER_LENGTH} characters in production`,
      'OID4VCI_STORAGE_HASH_PEPPER_REQUIRED',
      503,
    );
  }
  return configured || DEVELOPMENT_ONLY_PEPPER;
}

function digest(pepper: string, purpose: 'offer' | 'tx-code' | 'access-token', value: string): string {
  return createHmac('sha256', pepper)
    .update(HASH_CONTEXT)
    .update('\0')
    .update(purpose)
    .update('\0')
    .update(value)
    .digest('hex');
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function nonceEncryptionKey(pepper: string): Buffer {
  return createHmac('sha256', pepper)
    .update(HASH_CONTEXT)
    .update('\0c-nonce-encryption-key')
    .digest();
}

function nonceAad(accessTokenDigest: string): Buffer {
  return Buffer.from(`${HASH_CONTEXT}\0c-nonce\0${accessTokenDigest}`, 'utf8');
}

function encryptNonce(pepper: string, accessTokenDigest: string, nonce: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', nonceEncryptionKey(pepper), iv);
  cipher.setAAD(nonceAad(accessTokenDigest));
  const ciphertext = Buffer.concat([cipher.update(nonce, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    NONCE_ENVELOPE_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptNonce(pepper: string, accessTokenDigest: string, envelope: string): string {
  try {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = envelope.split('.');
    if (
      version !== NONCE_ENVELOPE_VERSION ||
      !ivEncoded ||
      !tagEncoded ||
      !ciphertextEncoded ||
      extra !== undefined
    ) {
      throw new Error('unsupported nonce envelope');
    }
    const iv = Buffer.from(ivEncoded, 'base64url');
    const tag = Buffer.from(tagEncoded, 'base64url');
    const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('invalid nonce envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', nonceEncryptionKey(pepper), iv);
    decipher.setAAD(nonceAad(accessTokenDigest));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new ServiceError(
      'OpenID4VCI token session could not be decrypted',
      'OID4VCI_STORAGE_CORRUPT',
      503,
    );
  }
}

export function createPrismaIssuanceStores(
  prisma: PrismaIssuanceClient,
  env: NodeJS.ProcessEnv = process.env,
): IssuanceStores {
  const pepper = resolvePepper(env);

  return {
    async saveOffer(code, grant) {
      await prisma.oid4vciOffer.create({
        data: {
          preAuthCode: digest(pepper, 'offer', code),
          configId: grant.configId,
          subjectDid: grant.subjectDid,
          txCode: grant.txCode ? digest(pepper, 'tx-code', grant.txCode) : null,
          expiresAt: new Date(grant.expiresAt * 1000),
        },
      });
    },

    async redeemOffer(redemption) {
      const preAuthCode = digest(pepper, 'offer', redemption.code);
      const presentedTxCode = redemption.txCode
        ? digest(pepper, 'tx-code', redemption.txCode)
        : null;
      const accessToken = digest(pepper, 'access-token', redemption.accessToken);
      const encryptedNonce = encryptNonce(pepper, accessToken, redemption.cNonce);

      return prisma.$transaction(async (tx) => {
        const offer = await tx.oid4vciOffer.findUnique({ where: { preAuthCode } });
        if (!offer) return null;

        if (offer.expiresAt.getTime() < redemption.now * 1000) {
          await tx.oid4vciOffer.deleteMany({
            where: { preAuthCode, expiresAt: offer.expiresAt },
          });
          return null;
        }

        // A wrong or omitted tx_code never reaches the delete. Extra tx_code
        // input is ignored when the offer did not require one.
        if (
          offer.txCode !== null &&
          (presentedTxCode === null || !sameDigest(offer.txCode, presentedTxCode))
        ) {
          return null;
        }

        const consumed = await tx.oid4vciOffer.deleteMany({
          where: {
            preAuthCode,
            expiresAt: offer.expiresAt,
            txCode: offer.txCode,
          },
        });
        if (consumed.count !== 1) return null;

        // This create shares the transaction with the delete. A DB failure or
        // impossible token-hash collision rolls the offer consumption back.
        await tx.oid4vciTokenSession.create({
          data: {
            accessToken,
            configId: offer.configId,
            subjectDid: offer.subjectDid,
            cNonce: encryptedNonce,
            expiresAt: new Date(redemption.tokenExpiresAt * 1000),
            claimId: null,
            claimExpiresAt: null,
          },
        });

        return {
          configId: offer.configId,
          subjectDid: offer.subjectDid,
          expiresAt: Math.floor(offer.expiresAt.getTime() / 1000),
        };
      });
    },

    async claimToken(token, claim) {
      const accessToken = digest(pepper, 'access-token', token);
      const session = await prisma.oid4vciTokenSession.findUnique({ where: { accessToken } });
      if (!session || session.expiresAt.getTime() < claim.now * 1000) return null;

      const cNonce = decryptNonce(pepper, accessToken, session.cNonce);
      const claimExpiresAt = new Date(
        Math.min(claim.claimExpiresAt * 1000, session.expiresAt.getTime()),
      );
      if (claimExpiresAt.getTime() <= claim.now * 1000) return null;

      const claimed = await prisma.oid4vciTokenSession.updateMany({
        where: {
          accessToken,
          expiresAt: session.expiresAt,
          OR: [
            { claimId: null },
            { claimExpiresAt: { lte: new Date(claim.now * 1000) } },
          ],
        },
        data: {
          claimId: claim.claimId,
          claimExpiresAt,
        },
      });
      if (claimed.count !== 1) return null;

      return {
        configId: session.configId,
        subjectDid: session.subjectDid,
        cNonce,
        expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
        claimId: claim.claimId,
      };
    },

    async completeToken(token, claimId, now) {
      const consumed = await prisma.oid4vciTokenSession.deleteMany({
        where: {
          accessToken: digest(pepper, 'access-token', token),
          claimId,
          claimExpiresAt: { gt: new Date(now * 1000) },
        },
      });
      return consumed.count === 1;
    },

    async releaseToken(token, claimId) {
      const released = await prisma.oid4vciTokenSession.updateMany({
        where: {
          accessToken: digest(pepper, 'access-token', token),
          claimId,
        },
        data: {
          claimId: null,
          claimExpiresAt: null,
        },
      });
      return released.count === 1;
    },
  };
}
