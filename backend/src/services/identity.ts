import { prisma, logger, redis } from '../runtime';
import { generateToken, revokeToken } from '../middleware/auth';
import { oidcBridge } from './enterprise/oidc-bridge';
import { isAethelredDid } from '../utils/did';
import { isProductionRuntime } from './production-safety';
import {
  normalizeWalletRegistrationDid,
  verifyWalletRegistrationProof,
} from './identity-registration-proof';
// tee import removed — not used in this module
import { IdentityStatus } from '@prisma/client';
import nodeCrypto from 'crypto';

const IDENTITY_RECOVERY_HASH_PEPPER_ENV = 'IDENTITY_RECOVERY_HASH_PEPPER';
const MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH = 48;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RegisterIdentityRequest {
  did: string;
  controller: string;
  publicKey: string;
  recoveryHash: string;
  signature: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentityResponse {
  id: string;
  did: string;
  publicKey: string;
  displayName: string | null;
  status: string;
  teeAttested: boolean;
  governmentVerified: boolean;
  delegatedTo: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RecoverIdentityRequest {
  did: string;
  recoveryProof: string;
  newPublicKey: string;
  newRecoveryHash: string;
}

export interface DelegationRequest {
  delegatorId: string;
  delegateDid: string;
}

// ---------------------------------------------------------------------------
// Identity Service
// ---------------------------------------------------------------------------
export class IdentityService {
  private async runIdentityAuditTransaction<T>(
    operation: (tx: any) => Promise<T>,
  ): Promise<T> {
    const transaction = (prisma as any).$transaction;
    if (typeof transaction !== 'function') {
      if (isProductionRuntime()) {
        throw new IdentityError(
          'Identity state changes require database transaction support for audit atomicity.',
          'IDENTITY_AUDIT_TRANSACTION_UNAVAILABLE',
          500,
        );
      }

      return operation(prisma);
    }

    return transaction.call(prisma, operation);
  }

  // -------------------------------------------------------------------------
  // Register a new identity
  // -------------------------------------------------------------------------
  async register(request: RegisterIdentityRequest): Promise<{
    identity: IdentityResponse;
    token: string;
    sessionId: string;
  }> {
    // Normalize the public identifier before lookup so case variants cannot
    // bypass the idempotent conflict response or create an alias.
    const did = normalizeWalletRegistrationDid(request.did);
    logger.info('identity_registration_start', { did });

    // Check for existing DID
    const existing = await prisma.identity.findUnique({ where: { did } });
    if (existing) {
      throw new IdentityError('DID already registered', 'IDENTITY_DID_EXISTS', 409);
    }

    // The server, not the browser, reconstructs the signed message from the
    // normalized fields and configured origin/chain. The returned values are
    // canonical and are the only values persisted below.
    const verifiedProof = verifyWalletRegistrationProof({
      did,
      controller: request.controller,
      publicKey: request.publicKey,
      recoveryHash: request.recoveryHash,
      signature: request.signature,
    });

    // Validate DID format
    if (!this.isValidDID(verifiedProof.did)) {
      throw new IdentityError('Invalid DID format', 'IDENTITY_INVALID_DID');
    }

    // Validate public key format
    if (!this.isValidPublicKey(verifiedProof.publicKey)) {
      throw new IdentityError('Invalid public key format', 'IDENTITY_INVALID_KEY');
    }
    if (!this.isValidRecoveryHash(verifiedProof.recoveryHash)) {
      throw new IdentityError('Invalid recovery hash format', 'IDENTITY_INVALID_RECOVERY_HASH');
    }

    let identity;
    try {
      identity = await this.runIdentityAuditTransaction(async (tx) => {
        const created = await tx.identity.create({
          data: {
            did: verifiedProof.did,
            publicKey: verifiedProof.publicKey,
            recoveryHash: this.protectRecoveryHash(verifiedProof.recoveryHash),
            displayName: request.displayName,
            metadata: {
              ...(request.metadata ?? {}),
              controller: verifiedProof.controller,
            } as any,
            status: 'ACTIVE',
            delegatedTo: [],
          },
        });

        await tx.auditLog.create({
          data: {
            identityId: created.id,
            action: 'IDENTITY_CREATED',
            resourceType: 'identity',
            resourceId: created.id,
            details: {
              did: verifiedProof.did,
              controller: verifiedProof.controller,
              proofVersion: 'zeroid.identity.registration.v1',
              displayName: request.displayName,
            },
          },
        });

        return created;
      });
    } catch (error) {
      // Two identical signed requests can pass the read check concurrently.
      // The database unique constraint remains authoritative; translate that
      // race into the same stable 409 as an ordinary replay.
      if ((error as { code?: unknown })?.code === 'P2002') {
        throw new IdentityError('DID already registered', 'IDENTITY_DID_EXISTS', 409);
      }
      throw error;
    }

    // Generate authentication token
    const { token, sessionId } = await generateToken(identity.id, identity.did);

    // Cache identity lookup
    await redis.set(
      `identity:did:${verifiedProof.did}`,
      JSON.stringify({ id: identity.id, did: identity.did, status: identity.status }),
      'EX',
      3600,
    );

    logger.info('identity_registered', { identityId: identity.id, did: verifiedProof.did });

    return {
      identity: this.formatIdentity(identity),
      token,
      sessionId,
    };
  }

  // -------------------------------------------------------------------------
  // Get identity by ID or DID
  // -------------------------------------------------------------------------
  async getIdentity(identifier: string): Promise<IdentityResponse | null> {
    // Try cache first
    const cacheKey = identifier.startsWith('did:')
      ? `identity:did:${identifier}`
      : `identity:id:${identifier}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.id && parsed.did && parsed.publicKey) {
        return parsed as IdentityResponse;
      }
    }

    const identity = identifier.startsWith('did:')
      ? await prisma.identity.findUnique({ where: { did: identifier } })
      : await prisma.identity.findUnique({ where: { id: identifier } });

    if (!identity) return null;

    const formatted = this.formatIdentity(identity);

    // Cache for 1 hour
    await redis.set(`identity:id:${identity.id}`, JSON.stringify(formatted), 'EX', 3600);
    await redis.set(`identity:did:${identity.did}`, JSON.stringify(formatted), 'EX', 3600);

    return formatted;
  }

  // -------------------------------------------------------------------------
  // Update identity
  // -------------------------------------------------------------------------
  async updateIdentity(
    identityId: string,
    updates: { displayName?: string; metadata?: Record<string, unknown> },
  ): Promise<IdentityResponse> {
    const identity = await prisma.identity.findUnique({ where: { id: identityId } });
    if (!identity) {
      throw new IdentityError('Identity not found', 'IDENTITY_NOT_FOUND', 404);
    }

    if (identity.status !== 'ACTIVE') {
      throw new IdentityError('Cannot update inactive identity', 'IDENTITY_NOT_ACTIVE');
    }

    const previousState = {
      displayName: identity.displayName,
      metadata: identity.metadata,
    };

    const updated = await this.runIdentityAuditTransaction(async (tx) => {
      const nextIdentity = await tx.identity.update({
        where: { id: identityId },
        data: {
          displayName: updates.displayName ?? identity.displayName,
          metadata: (updates.metadata ?? identity.metadata ?? undefined) as any,
        },
      });

      await tx.auditLog.create({
        data: {
          identityId,
          action: 'IDENTITY_UPDATED',
          resourceType: 'identity',
          resourceId: identityId,
          previousState,
          newState: {
            displayName: nextIdentity.displayName,
            metadata: nextIdentity.metadata,
          },
        },
      });

      return nextIdentity;
    });

    // Invalidate caches
    await redis.del(`identity:id:${identityId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info('identity_updated', { identityId });
    return this.formatIdentity(updated);
  }

  // -------------------------------------------------------------------------
  // Recover identity (social recovery / recovery hash)
  // -------------------------------------------------------------------------
  async recoverIdentity(request: RecoverIdentityRequest): Promise<{
    identity: IdentityResponse;
    token: string;
    sessionId: string;
  }> {
    logger.info('identity_recovery_start', { did: request.did });

    const identity = await prisma.identity.findUnique({ where: { did: request.did } });
    if (!identity) {
      throw new IdentityError('Identity not found', 'IDENTITY_NOT_FOUND', 404);
    }
    if (!this.isRecoverableStatus(identity.status)) {
      logger.warn('identity_recovery_blocked', {
        did: request.did,
        status: identity.status,
      });
      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: 'IDENTITY_RECOVERED',
          resourceType: 'identity',
          resourceId: identity.id,
          details: {
            success: false,
            reason: 'identity_status_not_recoverable',
            status: identity.status,
          },
        },
      });
      throw new IdentityError(
        'Identity status does not allow self-service recovery',
        'IDENTITY_RECOVERY_BLOCKED',
        403,
      );
    }
    if (!this.isValidPublicKey(request.newPublicKey)) {
      throw new IdentityError('Invalid public key format', 'IDENTITY_INVALID_KEY');
    }
    if (!this.isValidRecoveryHash(request.newRecoveryHash)) {
      throw new IdentityError('Invalid recovery hash format', 'IDENTITY_INVALID_RECOVERY_HASH');
    }

    // Verify recovery proof against stored hash
    const proofHash = await this.hashRecoveryProof(request.recoveryProof);
    if (!this.recoveryHashMatches(proofHash, identity.recoveryHash)) {
      logger.warn('identity_recovery_failed', { did: request.did, reason: 'invalid_proof' });

      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: 'IDENTITY_RECOVERED',
          resourceType: 'identity',
          resourceId: identity.id,
          details: { success: false, reason: 'invalid_recovery_proof' },
        },
      });

      throw new IdentityError('Invalid recovery proof', 'IDENTITY_RECOVERY_INVALID', 403);
    }

    // Revoke all existing platform and enterprise federation sessions
    await oidcBridge.revokeSubjectSessions(identity.id);
    const sessions = await prisma.session.findMany({ where: { identityId: identity.id } });
    for (const session of sessions) {
      await revokeToken(session.id);
    }

    const protectedNewRecoveryHash = this.protectRecoveryHash(
      request.newRecoveryHash,
    );
    const activated = await this.runIdentityAuditTransaction(async (tx) => {
      const updated = await tx.identity.update({
        where: { id: identity.id },
        data: {
          publicKey: request.newPublicKey,
          recoveryHash: protectedNewRecoveryHash,
          status: 'ACTIVE',
          teeAttested: false,
          teeAttestationId: null,
        },
      });

      await tx.auditLog.create({
        data: {
          identityId: identity.id,
          action: 'IDENTITY_RECOVERED',
          resourceType: 'identity',
          resourceId: identity.id,
          details: { success: true },
          previousState: { publicKey: identity.publicKey },
          newState: { publicKey: request.newPublicKey },
        },
      });

      return updated;
    });

    // Generate new token
    const { token, sessionId } = await generateToken(identity.id, identity.did);

    // Invalidate caches
    await redis.del(`identity:id:${identity.id}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info('identity_recovered', { identityId: identity.id, did: request.did });

    return {
      identity: this.formatIdentity(activated),
      token,
      sessionId,
    };
  }

  // -------------------------------------------------------------------------
  // Delegate identity access
  // -------------------------------------------------------------------------
  async addDelegation(request: DelegationRequest): Promise<IdentityResponse> {
    const identity = await prisma.identity.findUnique({ where: { id: request.delegatorId } });
    if (!identity) {
      throw new IdentityError('Delegator identity not found', 'IDENTITY_NOT_FOUND', 404);
    }

    if (identity.status !== 'ACTIVE') {
      throw new IdentityError('Cannot delegate from inactive identity', 'IDENTITY_NOT_ACTIVE');
    }

    // Verify delegate DID exists
    const delegate = await prisma.identity.findUnique({ where: { did: request.delegateDid } });
    if (!delegate) {
      throw new IdentityError('Delegate DID not found', 'IDENTITY_DELEGATE_NOT_FOUND', 404);
    }

    if (identity.delegatedTo.includes(request.delegateDid)) {
      throw new IdentityError('Delegation already exists', 'IDENTITY_DELEGATION_EXISTS');
    }

    // Max 5 delegations
    if (identity.delegatedTo.length >= 5) {
      throw new IdentityError('Maximum delegations reached (5)', 'IDENTITY_MAX_DELEGATIONS');
    }

    const updated = await this.runIdentityAuditTransaction(async (tx) => {
      const nextIdentity = await tx.identity.update({
        where: { id: request.delegatorId },
        data: {
          delegatedTo: [...identity.delegatedTo, request.delegateDid],
        },
      });

      await tx.auditLog.create({
        data: {
          identityId: request.delegatorId,
          action: 'DELEGATION_GRANTED',
          resourceType: 'identity',
          resourceId: request.delegatorId,
          details: { delegateDid: request.delegateDid },
        },
      });

      return nextIdentity;
    });

    await redis.del(`identity:id:${request.delegatorId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info('delegation_granted', {
      delegatorId: request.delegatorId,
      delegateDid: request.delegateDid,
    });

    return this.formatIdentity(updated);
  }

  // -------------------------------------------------------------------------
  // Revoke delegation
  // -------------------------------------------------------------------------
  async revokeDelegation(delegatorId: string, delegateDid: string): Promise<IdentityResponse> {
    const identity = await prisma.identity.findUnique({ where: { id: delegatorId } });
    if (!identity) {
      throw new IdentityError('Identity not found', 'IDENTITY_NOT_FOUND', 404);
    }

    if (!identity.delegatedTo.includes(delegateDid)) {
      throw new IdentityError('Delegation not found', 'IDENTITY_DELEGATION_NOT_FOUND', 404);
    }

    const updated = await this.runIdentityAuditTransaction(async (tx) => {
      const nextIdentity = await tx.identity.update({
        where: { id: delegatorId },
        data: {
          delegatedTo: identity.delegatedTo.filter((d) => d !== delegateDid),
        },
      });

      await tx.auditLog.create({
        data: {
          identityId: delegatorId,
          action: 'DELEGATION_REVOKED',
          resourceType: 'identity',
          resourceId: delegatorId,
          details: { delegateDid },
        },
      });

      return nextIdentity;
    });

    await redis.del(`identity:id:${delegatorId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info('delegation_revoked', { delegatorId, delegateDid });

    return this.formatIdentity(updated);
  }

  // -------------------------------------------------------------------------
  // Logout (revoke session)
  // -------------------------------------------------------------------------
  async logout(identityId: string, sessionId: string): Promise<void> {
    await oidcBridge.revokePlatformSession(sessionId);
    await revokeToken(sessionId);

    await prisma.auditLog.create({
      data: {
        identityId,
        action: 'AUTH_LOGOUT',
        resourceType: 'session',
        resourceId: sessionId,
      },
    });

    logger.info('identity_logout', { identityId, sessionId });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private isValidDID(did: string): boolean {
    return isAethelredDid(did);
  }

  private isValidPublicKey(key: string): boolean {
    try {
      const decoded = Buffer.from(key, 'base64');
      return decoded.length >= 32 && decoded.length <= 512;
    } catch {
      return false;
    }
  }

  private isValidRecoveryHash(value: string): boolean {
    return /^[0-9a-f]{64}$/i.test(value);
  }

  private isRecoverableStatus(status: IdentityStatus): boolean {
    return status === 'ACTIVE' || status === 'PENDING' || status === 'RECOVERED';
  }

  private async hashRecoveryProof(proof: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(proof));
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private protectRecoveryHash(recoveryHash: string): string {
    const pepper = this.getRecoveryHashPepper();
    if (!pepper) return recoveryHash;

    return nodeCrypto
      .createHmac('sha256', pepper)
      .update('zeroid:identity-recovery:v2:')
      .update(recoveryHash)
      .digest('hex');
  }

  private recoveryHashMatches(
    presentedRecoveryHash: string,
    storedRecoveryHash: string,
  ): boolean {
    const protectedPresentedHash = this.protectRecoveryHash(
      presentedRecoveryHash,
    );
    if (this.timingSafeHexEqual(protectedPresentedHash, storedRecoveryHash)) {
      return true;
    }

    return (
      this.allowLegacyRecoveryHashFallback() &&
      this.timingSafeHexEqual(presentedRecoveryHash, storedRecoveryHash)
    );
  }

  private getRecoveryHashPepper(): string | null {
    const pepper = process.env[IDENTITY_RECOVERY_HASH_PEPPER_ENV]?.trim();
    if (pepper && pepper.length >= MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH) {
      return pepper;
    }

    if (isProductionRuntime()) {
      throw new IdentityError(
        `${IDENTITY_RECOVERY_HASH_PEPPER_ENV} must be configured in production and contain at least ${MIN_IDENTITY_RECOVERY_HASH_PEPPER_LENGTH} characters`,
        'IDENTITY_RECOVERY_HASH_PEPPER_MISSING',
        500,
      );
    }

    return null;
  }

  private allowLegacyRecoveryHashFallback(): boolean {
    return !isProductionRuntime();
  }

  private timingSafeHexEqual(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
      return false;
    }
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return (
      leftBuffer.length === rightBuffer.length &&
      nodeCrypto.timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private formatIdentity(identity: {
    id: string;
    did: string;
    publicKey: string;
    displayName: string | null;
    status: IdentityStatus;
    teeAttested: boolean;
    governmentVerified: boolean;
    delegatedTo: string[];
    createdAt: Date;
    updatedAt: Date;
  }): IdentityResponse {
    return {
      id: identity.id,
      did: identity.did,
      publicKey: identity.publicKey,
      displayName: identity.displayName,
      status: identity.status,
      teeAttested: identity.teeAttested,
      governmentVerified: identity.governmentVerified,
      delegatedTo: identity.delegatedTo,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class IdentityError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const identityService = new IdentityService();
