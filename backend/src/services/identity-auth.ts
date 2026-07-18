import { randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

import { generateToken, revokeToken } from '../middleware/auth';
import { logger, prisma, redis } from '../runtime';

const AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;
const AUTH_CHALLENGE_ID_PATTERN = /^[a-f0-9]{64}$/;
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SIGNATURE_PATTERN = /^0x[a-fA-F0-9]{130}$/;
const CONSUME_CHALLENGE_SCRIPT = `
  local value = redis.call('GET', KEYS[1])
  if value then
    redis.call('DEL', KEYS[1])
  end
  return value
`;

interface StoredIdentityAuthChallenge {
  version: 'zeroid.wallet-auth.v1';
  identityId: string;
  did: string;
  controller: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

export interface IdentityAuthChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface IdentityAuthSession {
  identity: {
    id: string;
    did: string;
    status: string;
  };
  token: string;
  sessionId: string;
}

export class IdentityAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'IdentityAuthError';
  }
}

function challengeKey(challengeId: string): string {
  return `identity:auth:challenge:${challengeId}`;
}

function resolveAuthOrigin(): URL {
  const configured = process.env.ZEROID_AUTH_ORIGIN?.trim();
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new IdentityAuthError(
      'Wallet authentication is not configured',
      'IDENTITY_AUTH_NOT_CONFIGURED',
      503,
    );
  }

  let origin: URL;
  try {
    origin = new URL(configured || 'http://localhost:3003');
  } catch {
    throw new IdentityAuthError(
      'Wallet authentication origin is invalid',
      'IDENTITY_AUTH_NOT_CONFIGURED',
      503,
    );
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== '/' && origin.pathname !== '')
  ) {
    throw new IdentityAuthError(
      'Wallet authentication origin is invalid',
      'IDENTITY_AUTH_NOT_CONFIGURED',
      503,
    );
  }

  return origin;
}

function resolveChainId(): number {
  const raw = process.env.AETHELRED_CHAIN_ID ?? '7332';
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new IdentityAuthError(
      'Wallet authentication chain is invalid',
      'IDENTITY_AUTH_NOT_CONFIGURED',
      503,
    );
  }
  return chainId;
}

function buildSignInMessage(input: {
  origin: URL;
  controller: string;
  did: string;
  nonce: string;
  challengeId: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${input.origin.host} wants you to sign in with your Ethereum account:`,
    input.controller,
    '',
    'Sign in to ZeroID. This request does not initiate a blockchain transaction.',
    '',
    `URI: ${input.origin.origin}`,
    'Version: 1',
    `Chain ID: ${resolveChainId()}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    `Request ID: ${input.challengeId}`,
    'Resources:',
    `- ${input.did}`,
  ].join('\n');
}

function parseStoredChallenge(raw: unknown): StoredIdentityAuthChallenge | null {
  if (typeof raw !== 'string') return null;

  try {
    const value = JSON.parse(raw) as Partial<StoredIdentityAuthChallenge>;
    if (
      value.version !== 'zeroid.wallet-auth.v1' ||
      typeof value.identityId !== 'string' ||
      value.identityId.length < 1 ||
      value.identityId.length > 128 ||
      typeof value.did !== 'string' ||
      value.did.length > 256 ||
      typeof value.controller !== 'string' ||
      !WALLET_ADDRESS_PATTERN.test(value.controller) ||
      typeof value.message !== 'string' ||
      value.message.length < 1 ||
      value.message.length > 4096 ||
      typeof value.issuedAt !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(value.issuedAt)) ||
      Number.isNaN(Date.parse(value.expiresAt))
    ) {
      return null;
    }
    return value as StoredIdentityAuthChallenge;
  } catch {
    return null;
  }
}

export class IdentityAuthService {
  async createChallenge(address: string): Promise<IdentityAuthChallenge> {
    let controller: string;
    try {
      controller = getAddress(address).toLowerCase();
    } catch {
      throw new IdentityAuthError(
        'Wallet address is invalid',
        'IDENTITY_AUTH_ADDRESS_INVALID',
        400,
      );
    }

    const candidateDids = ['mainnet', 'testnet', 'devnet'].map(
      (network) => `did:aethelred:${network}:${controller}`,
    );
    const identity = await prisma.identity.findFirst({
      where: { did: { in: candidateDids } },
      select: { id: true, did: true, status: true },
    });

    if (!identity) {
      throw new IdentityAuthError(
        'No ZeroID identity is registered for this wallet',
        'IDENTITY_AUTH_IDENTITY_NOT_FOUND',
        404,
      );
    }
    if (identity.status !== 'ACTIVE') {
      throw new IdentityAuthError(
        'This ZeroID identity is not active',
        'IDENTITY_AUTH_IDENTITY_INACTIVE',
        403,
      );
    }

    const challengeId = randomBytes(32).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + AUTH_CHALLENGE_TTL_SECONDS * 1000,
    );
    const message = buildSignInMessage({
      origin: resolveAuthOrigin(),
      controller,
      did: identity.did,
      nonce,
      challengeId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const stored: StoredIdentityAuthChallenge = {
      version: 'zeroid.wallet-auth.v1',
      identityId: identity.id,
      did: identity.did,
      controller,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const saved = await redis.set(
      challengeKey(challengeId),
      JSON.stringify(stored),
      'EX',
      AUTH_CHALLENGE_TTL_SECONDS,
      'NX',
    );
    if (saved !== 'OK') {
      throw new IdentityAuthError(
        'Unable to create a wallet authentication challenge',
        'IDENTITY_AUTH_CHALLENGE_UNAVAILABLE',
        503,
      );
    }

    logger.info('identity_auth_challenge_created', {
      identityId: identity.id,
      challengeId,
    });
    return {
      challengeId,
      message,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async authenticate(input: {
    challengeId: string;
    signature: string;
  }): Promise<IdentityAuthSession> {
    if (!AUTH_CHALLENGE_ID_PATTERN.test(input.challengeId)) {
      throw new IdentityAuthError(
        'Wallet authentication challenge is invalid or expired',
        'IDENTITY_AUTH_CHALLENGE_INVALID',
        401,
      );
    }
    if (!SIGNATURE_PATTERN.test(input.signature)) {
      throw new IdentityAuthError(
        'Wallet signature is invalid',
        'IDENTITY_AUTH_SIGNATURE_INVALID',
        401,
      );
    }

    const consumed = await redis.eval(
      CONSUME_CHALLENGE_SCRIPT,
      1,
      challengeKey(input.challengeId),
    );
    const challenge = parseStoredChallenge(consumed);
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      throw new IdentityAuthError(
        'Wallet authentication challenge is invalid or expired',
        'IDENTITY_AUTH_CHALLENGE_INVALID',
        401,
      );
    }

    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(
        challenge.message,
        input.signature,
      ).toLowerCase();
    } catch {
      throw new IdentityAuthError(
        'Wallet signature is invalid',
        'IDENTITY_AUTH_SIGNATURE_INVALID',
        401,
      );
    }

    if (recoveredAddress !== challenge.controller) {
      logger.warn('identity_auth_signature_mismatch', {
        identityId: challenge.identityId,
        challengeId: input.challengeId,
      });
      throw new IdentityAuthError(
        'Wallet signature does not match the identity controller',
        'IDENTITY_AUTH_SIGNATURE_INVALID',
        401,
      );
    }

    const identity = await prisma.identity.findUnique({
      where: { id: challenge.identityId },
      select: { id: true, did: true, status: true },
    });
    if (
      !identity ||
      identity.status !== 'ACTIVE' ||
      identity.did !== challenge.did
    ) {
      throw new IdentityAuthError(
        'This ZeroID identity is not available for authentication',
        'IDENTITY_AUTH_IDENTITY_INACTIVE',
        403,
      );
    }

    const { token, sessionId } = await generateToken(identity.id, identity.did);
    try {
      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: 'AUTH_LOGIN',
          resourceType: 'session',
          resourceId: sessionId,
          details: {
            method: 'wallet-signature',
            challengeId: input.challengeId,
            controller: challenge.controller,
          },
        },
      });
    } catch (error) {
      await revokeToken(sessionId);
      logger.error('identity_auth_audit_failed', {
        identityId: identity.id,
        sessionId,
        error: (error as Error).message,
      });
      throw new IdentityAuthError(
        'Wallet authentication could not be completed',
        'IDENTITY_AUTH_AUDIT_FAILED',
        503,
      );
    }
    logger.info('identity_authenticated', {
      identityId: identity.id,
      sessionId,
    });

    return {
      identity,
      token,
      sessionId,
    };
  }
}

export const identityAuthService = new IdentityAuthService();
