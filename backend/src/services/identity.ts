import { prisma, logger, redis } from '../runtime';
import { generateToken, revokeToken } from '../middleware/auth';
import { oidcBridge } from './enterprise/oidc-bridge';
import { isAethelredDid } from '../utils/did';
import { isProductionRuntime } from './production-safety';
import {
  normalizeWalletRegistrationDid,
  verifyWalletRegistrationProof,
} from './identity-registration-proof';
import {
  buildClientIdentityMetadata,
  findNonClientWritableIdentityMetadataKey,
} from '../utils/identity-metadata';
import {
  createIdentityRegistryProvider,
  destroyProvider,
  IdentityRegistryConfigurationError,
  loadIdentityRegistryConfiguration,
  type IdentityRegistryConfiguration,
} from '../lib/identity-registry-config';
import {
  assertCanonicalChainSnapshot,
  CanonicalTransactionError,
} from '../lib/canonical-chain-transaction';
import {
  IdentityRegistryVerificationError,
  mapCanonicalFailure,
  verifyIdentityRegistration,
  type VerifiedIdentityRegistration,
} from './identity-registry-verification';
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
  /** Hash of the registerIdentity transaction the wallet submitted. */
  txHash: string;
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
  /**
   * Registration order is deliberate: everything that can be decided without
   * the chain (metadata allowlist, DID conflicts, verifier configuration, DID
   * network policy, the wallet proof, replay pre-checks) runs first, so a
   * request that will be refused never spends an RPC call. The chain is then
   * read once through the verifier, re-checked at the persistence boundary
   * inside the same transaction as the identity and audit rows, and only a
   * committed identity is issued a session.
   */
  async register(request: RegisterIdentityRequest): Promise<{
    identity: IdentityResponse;
    token: string;
    sessionId: string;
  }> {
    this.assertClientIdentityMetadata(request.metadata);

    // Normalize the public identifier before lookup so case variants cannot
    // bypass the idempotent conflict response or create an alias.
    const did = normalizeWalletRegistrationDid(request.did);
    logger.info('identity_registration_start', { did });

    // Check for existing DID
    const existing = await prisma.identity.findUnique({ where: { did } });
    if (existing) {
      throw new IdentityError('DID already registered', 'IDENTITY_DID_EXISTS', 409);
    }

    const config = this.loadRegistryConfiguration();
    this.assertDidNetworkAllowed(did, config);

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

    const txHash = this.normalizeRegistryTxHash(request.txHash);
    await this.assertRegistryEvidenceUnused(txHash, verifiedProof.controller);

    const provider = createIdentityRegistryProvider(config);
    let identity;
    try {
      let evidence: VerifiedIdentityRegistration;
      try {
        // The recovery hash is compared against the chain in plaintext; the
        // pepper is applied only to the value stored at rest.
        evidence = await verifyIdentityRegistration(
          {
            txHash,
            did: verifiedProof.did,
            controller: verifiedProof.controller,
            recoveryHash: verifiedProof.recoveryHash,
          },
          config,
          provider,
        );
      } catch (error) {
        throw this.mapRegistryVerificationError(error);
      }

      try {
        identity = await this.runIdentityAuditTransaction(async (tx) => {
          // Re-read the chain at the persistence boundary so a receipt that
          // was orphaned or lost depth after verification cannot be persisted.
          try {
            await assertCanonicalChainSnapshot(
              provider,
              config,
              evidence.blockNumber,
              evidence.blockHash,
              txHash,
              config.minimumConfirmations,
            );
          } catch (error) {
            throw this.mapRegistryVerificationError(error, config);
          }

          const registryVerifiedAt = new Date();
          const created = await tx.identity.create({
            data: {
              did: verifiedProof.did,
              publicKey: verifiedProof.publicKey,
              recoveryHash: this.protectRecoveryHash(verifiedProof.recoveryHash),
              displayName: request.displayName,
              metadata: buildClientIdentityMetadata(
                request.metadata,
                verifiedProof.controller,
              ) as any,
              status: 'ACTIVE',
              delegatedTo: [],
              registryChainId: evidence.chainId,
              registryAddress: evidence.registryAddress,
              registryTxHash: evidence.txHash,
              registryBlockNumber: evidence.blockNumber,
              registryBlockHash: evidence.blockHash,
              registryDidHash: evidence.didHash,
              registryController: evidence.controller,
              registryEventTimestamp: evidence.eventTimestamp,
              registryConfirmations: evidence.confirmations,
              registryVerifiedAt,
              registryVerificationVersion: evidence.verificationVersion,
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
                dataSource: evidence.dataSource,
                txHash: evidence.txHash,
                blockNumber: evidence.blockNumber,
                blockHash: evidence.blockHash,
                didHash: evidence.didHash,
                confirmations: evidence.confirmations,
                registryVerificationVersion: evidence.verificationVersion,
              },
            },
          });

          return created;
        });
      } catch (error) {
        // Two identical signed requests can pass the read checks concurrently.
        // The database unique constraints remain authoritative; translate that
        // race into the same stable 409 as an ordinary replay.
        if ((error as { code?: unknown })?.code === 'P2002') {
          throw this.mapUniqueViolation(error);
        }
        throw error;
      }
    } finally {
      destroyProvider(provider);
    }

    // The session is issued only for a committed identity.
    const { token, sessionId } = await generateToken(identity.id, identity.did);

    // Cache identity lookup. The cache is an optimization over the committed
    // row (getIdentity falls back to the database), so a cache outage must not
    // turn a verified, persisted registration into a failure.
    try {
      await redis.set(
        `identity:did:${verifiedProof.did}`,
        JSON.stringify({ id: identity.id, did: identity.did, status: identity.status }),
        'EX',
        3600,
      );
    } catch (error) {
      logger.warn('identity_cache_write_failed', {
        identityId: identity.id,
        error: (error as Error).message,
      });
    }

    logger.info('identity_registered', {
      identityId: identity.id,
      did: verifiedProof.did,
      txHash,
    });

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
    this.assertClientIdentityMetadata(updates.metadata);

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

    const controller = this.getControllerFromWalletDid(identity.did);
    const updated = await this.runIdentityAuditTransaction(async (tx) => {
      const nextIdentity = await tx.identity.update({
        where: { id: identityId },
        data: {
          displayName: updates.displayName ?? identity.displayName,
          metadata: buildClientIdentityMetadata(
            updates.metadata ?? identity.metadata,
            controller,
          ) as any,
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

  private assertClientIdentityMetadata(
    metadata: Record<string, unknown> | undefined,
  ): void {
    if (!metadata) return;

    const unsupportedKey = findNonClientWritableIdentityMetadataKey(metadata);
    if (unsupportedKey) {
      throw new IdentityError(
        `Identity metadata key "${unsupportedKey}" is not client-writable`,
        'IDENTITY_METADATA_RESERVED',
        400,
      );
    }
  }

  private loadRegistryConfiguration(): IdentityRegistryConfiguration {
    try {
      return loadIdentityRegistryConfiguration();
    } catch (error) {
      if (error instanceof IdentityRegistryConfigurationError) {
        throw new IdentityError(error.message, error.code, error.statusCode);
      }
      throw error;
    }
  }

  /**
   * The DID network segment feeds the didHash the verifier expects, so a DID
   * whose segment does not belong to the configured chain is refused before
   * any proof or RPC work.
   */
  private assertDidNetworkAllowed(
    did: string,
    config: IdentityRegistryConfiguration,
  ): void {
    const network = did.split(':')[2];
    if (!network || !config.allowedDidNetworks.includes(network)) {
      throw new IdentityError(
        `DID network "${network ?? ''}" is not served by chain ${config.chainId}; expected one of ${config.allowedDidNetworks.join(', ')}`,
        'IDENTITY_DID_NETWORK_MISMATCH',
        400,
      );
    }
  }

  private normalizeRegistryTxHash(value: string): string {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new IdentityError(
        'Registry transaction hash must be a 32-byte hex hash',
        'VALIDATION_ERROR',
        400,
      );
    }
    return value.toLowerCase();
  }

  /**
   * A transaction hash verifies exactly one identity and a controller owns
   * exactly one verified registry row. Checked before any RPC call; the unique
   * columns remain authoritative for concurrent requests.
   */
  private async assertRegistryEvidenceUnused(
    txHash: string,
    controller: string,
  ): Promise<void> {
    const byTxHash = await prisma.identity.findUnique({
      where: { registryTxHash: txHash },
    });
    if (byTxHash) {
      throw new IdentityError(
        'This registry transaction has already been used to verify an identity',
        'IDENTITY_REGISTRY_TX_ALREADY_USED',
        409,
      );
    }

    const byController = await prisma.identity.findUnique({
      where: { registryController: controller },
    });
    if (byController) {
      throw new IdentityError(
        'This wallet already controls a verified identity',
        'IDENTITY_CONTROLLER_EXISTS',
        409,
      );
    }
  }

  private mapRegistryVerificationError(
    error: unknown,
    config?: IdentityRegistryConfiguration,
  ): Error {
    if (error instanceof IdentityRegistryVerificationError) {
      return new IdentityError(error.message, error.code, error.statusCode);
    }
    if (error instanceof CanonicalTransactionError) {
      if (!config) {
        return new IdentityError(
          'The registry transaction is not canonical on the configured chain',
          'IDENTITY_REGISTRY_CHAIN_MISMATCH',
          422,
        );
      }
      const mapped = mapCanonicalFailure(error, config);
      // At the persistence boundary nothing is retried: the receipt was
      // canonical moments ago, so any divergence is a chain mismatch unless
      // the RPC itself failed.
      if (mapped.code === 'IDENTITY_REGISTRY_RPC_UNAVAILABLE') {
        return new IdentityError(mapped.message, mapped.code, mapped.statusCode);
      }
      return new IdentityError(
        'The registry transaction was no longer canonical when the identity was about to be persisted',
        'IDENTITY_REGISTRY_CHAIN_MISMATCH',
        422,
      );
    }
    if (error instanceof IdentityRegistryConfigurationError) {
      return new IdentityError(error.message, error.code, error.statusCode);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private mapUniqueViolation(error: unknown): IdentityError {
    const rawTarget = (error as { meta?: { target?: unknown } })?.meta?.target;
    const targets = Array.isArray(rawTarget)
      ? rawTarget.map(String)
      : typeof rawTarget === 'string'
        ? [rawTarget]
        : [];
    const hits = (column: string) =>
      targets.some((target) => target.includes(column));

    if (hits('registryTxHash')) {
      return new IdentityError(
        'This registry transaction has already been used to verify an identity',
        'IDENTITY_REGISTRY_TX_ALREADY_USED',
        409,
      );
    }
    if (hits('registryController') || hits('registryDidHash')) {
      return new IdentityError(
        'This wallet already controls a verified identity',
        'IDENTITY_CONTROLLER_EXISTS',
        409,
      );
    }
    return new IdentityError('DID already registered', 'IDENTITY_DID_EXISTS', 409);
  }

  private getControllerFromWalletDid(did: string): string {
    const controller = did.split(':').at(-1)?.toLowerCase();
    if (!controller || !/^0x[a-f0-9]{40}$/.test(controller)) {
      throw new IdentityError(
        'Stored identity is not bound to a canonical wallet controller',
        'IDENTITY_CONTROLLER_INVALID',
        500,
      );
    }

    return controller;
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
