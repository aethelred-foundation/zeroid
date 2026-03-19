import { prisma, logger, redis } from "../index";
import { generateToken, revokeToken } from "../middleware/auth";
// tee import removed — not used in this module
import { IdentityStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RegisterIdentityRequest {
  did: string;
  publicKey: string;
  recoveryHash: string;
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
  // -------------------------------------------------------------------------
  // Register a new identity
  // -------------------------------------------------------------------------
  async register(request: RegisterIdentityRequest): Promise<{
    identity: IdentityResponse;
    token: string;
    sessionId: string;
  }> {
    logger.info("identity_registration_start", { did: request.did });

    // Check for existing DID
    const existing = await prisma.identity.findUnique({
      where: { did: request.did },
    });
    if (existing) {
      throw new IdentityError(
        "DID already registered",
        "IDENTITY_DID_EXISTS",
        409,
      );
    }

    // Validate DID format
    if (!this.isValidDID(request.did)) {
      throw new IdentityError("Invalid DID format", "IDENTITY_INVALID_DID");
    }

    // Validate public key format
    if (!this.isValidPublicKey(request.publicKey)) {
      throw new IdentityError(
        "Invalid public key format",
        "IDENTITY_INVALID_KEY",
      );
    }

    // Create identity
    const identity = await prisma.identity.create({
      data: {
        did: request.did,
        publicKey: request.publicKey,
        recoveryHash: request.recoveryHash,
        displayName: request.displayName,
        metadata: (request.metadata ?? {}) as any,
        status: "ACTIVE",
        delegatedTo: [],
      },
    });

    // Generate authentication token
    const { token, sessionId } = await generateToken(identity.id, identity.did);

    // Audit log
    await prisma.auditLog.create({
      data: {
        identityId: identity.id,
        action: "IDENTITY_CREATED",
        resourceType: "identity",
        resourceId: identity.id,
        details: {
          did: request.did,
          displayName: request.displayName,
        },
      },
    });

    // Cache identity lookup
    await redis.set(
      `identity:did:${request.did}`,
      JSON.stringify({
        id: identity.id,
        did: identity.did,
        status: identity.status,
      }),
      "EX",
      3600,
    );

    logger.info("identity_registered", {
      identityId: identity.id,
      did: request.did,
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
    const cacheKey = identifier.startsWith("did:")
      ? `identity:did:${identifier}`
      : `identity:id:${identifier}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.id && parsed.did && parsed.publicKey) {
        return parsed as IdentityResponse;
      }
    }

    const identity = identifier.startsWith("did:")
      ? await prisma.identity.findUnique({ where: { did: identifier } })
      : await prisma.identity.findUnique({ where: { id: identifier } });

    if (!identity) return null;

    const formatted = this.formatIdentity(identity);

    // Cache for 1 hour
    await redis.set(
      `identity:id:${identity.id}`,
      JSON.stringify(formatted),
      "EX",
      3600,
    );
    await redis.set(
      `identity:did:${identity.did}`,
      JSON.stringify(formatted),
      "EX",
      3600,
    );

    return formatted;
  }

  // -------------------------------------------------------------------------
  // Update identity
  // -------------------------------------------------------------------------
  async updateIdentity(
    identityId: string,
    updates: { displayName?: string; metadata?: Record<string, unknown> },
  ): Promise<IdentityResponse> {
    const identity = await prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) {
      throw new IdentityError("Identity not found", "IDENTITY_NOT_FOUND", 404);
    }

    if (identity.status !== "ACTIVE") {
      throw new IdentityError(
        "Cannot update inactive identity",
        "IDENTITY_NOT_ACTIVE",
      );
    }

    const previousState = {
      displayName: identity.displayName,
      metadata: identity.metadata,
    };

    const updated = await prisma.identity.update({
      where: { id: identityId },
      data: {
        displayName: updates.displayName ?? identity.displayName,
        metadata: (updates.metadata ?? identity.metadata ?? undefined) as any,
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId,
        action: "IDENTITY_UPDATED",
        resourceType: "identity",
        resourceId: identityId,
        previousState,
        newState: {
          displayName: updated.displayName,
          metadata: updated.metadata,
        },
      },
    });

    // Invalidate caches
    await redis.del(`identity:id:${identityId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info("identity_updated", { identityId });
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
    logger.info("identity_recovery_start", { did: request.did });

    const identity = await prisma.identity.findUnique({
      where: { did: request.did },
    });
    if (!identity) {
      throw new IdentityError("Identity not found", "IDENTITY_NOT_FOUND", 404);
    }

    // Verify recovery proof against stored hash
    const proofHash = await this.hashRecoveryProof(request.recoveryProof);
    if (proofHash !== identity.recoveryHash) {
      logger.warn("identity_recovery_failed", {
        did: request.did,
        reason: "invalid_proof",
      });

      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: "IDENTITY_RECOVERED",
          resourceType: "identity",
          resourceId: identity.id,
          details: { success: false, reason: "invalid_recovery_proof" },
        },
      });

      throw new IdentityError(
        "Invalid recovery proof",
        "IDENTITY_RECOVERY_INVALID",
        403,
      );
    }

    // Revoke all existing sessions
    const sessions = await prisma.session.findMany({
      where: { identityId: identity.id },
    });
    for (const session of sessions) {
      await revokeToken(session.id);
    }

    // Update identity with new key material
    await prisma.identity.update({
      where: { id: identity.id },
      data: {
        publicKey: request.newPublicKey,
        recoveryHash: request.newRecoveryHash,
        status: "RECOVERED",
        teeAttested: false, // Require re-attestation
        teeAttestationId: null,
      },
    });

    // Re-activate after recovery
    const activated = await prisma.identity.update({
      where: { id: identity.id },
      data: { status: "ACTIVE" },
    });

    // Generate new token
    const { token, sessionId } = await generateToken(identity.id, identity.did);

    await prisma.auditLog.create({
      data: {
        identityId: identity.id,
        action: "IDENTITY_RECOVERED",
        resourceType: "identity",
        resourceId: identity.id,
        details: { success: true },
        previousState: { publicKey: identity.publicKey },
        newState: { publicKey: request.newPublicKey },
      },
    });

    // Invalidate caches
    await redis.del(`identity:id:${identity.id}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info("identity_recovered", {
      identityId: identity.id,
      did: request.did,
    });

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
    const identity = await prisma.identity.findUnique({
      where: { id: request.delegatorId },
    });
    if (!identity) {
      throw new IdentityError(
        "Delegator identity not found",
        "IDENTITY_NOT_FOUND",
        404,
      );
    }

    if (identity.status !== "ACTIVE") {
      throw new IdentityError(
        "Cannot delegate from inactive identity",
        "IDENTITY_NOT_ACTIVE",
      );
    }

    // Verify delegate DID exists
    const delegate = await prisma.identity.findUnique({
      where: { did: request.delegateDid },
    });
    if (!delegate) {
      throw new IdentityError(
        "Delegate DID not found",
        "IDENTITY_DELEGATE_NOT_FOUND",
        404,
      );
    }

    if (identity.delegatedTo.includes(request.delegateDid)) {
      throw new IdentityError(
        "Delegation already exists",
        "IDENTITY_DELEGATION_EXISTS",
      );
    }

    // Max 5 delegations
    if (identity.delegatedTo.length >= 5) {
      throw new IdentityError(
        "Maximum delegations reached (5)",
        "IDENTITY_MAX_DELEGATIONS",
      );
    }

    const updated = await prisma.identity.update({
      where: { id: request.delegatorId },
      data: {
        delegatedTo: [...identity.delegatedTo, request.delegateDid],
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: request.delegatorId,
        action: "DELEGATION_GRANTED",
        resourceType: "identity",
        resourceId: request.delegatorId,
        details: { delegateDid: request.delegateDid },
      },
    });

    await redis.del(`identity:id:${request.delegatorId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info("delegation_granted", {
      delegatorId: request.delegatorId,
      delegateDid: request.delegateDid,
    });

    return this.formatIdentity(updated);
  }

  // -------------------------------------------------------------------------
  // Revoke delegation
  // -------------------------------------------------------------------------
  async revokeDelegation(
    delegatorId: string,
    delegateDid: string,
  ): Promise<IdentityResponse> {
    const identity = await prisma.identity.findUnique({
      where: { id: delegatorId },
    });
    if (!identity) {
      throw new IdentityError("Identity not found", "IDENTITY_NOT_FOUND", 404);
    }

    if (!identity.delegatedTo.includes(delegateDid)) {
      throw new IdentityError(
        "Delegation not found",
        "IDENTITY_DELEGATION_NOT_FOUND",
        404,
      );
    }

    const updated = await prisma.identity.update({
      where: { id: delegatorId },
      data: {
        delegatedTo: identity.delegatedTo.filter((d) => d !== delegateDid),
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: delegatorId,
        action: "DELEGATION_REVOKED",
        resourceType: "identity",
        resourceId: delegatorId,
        details: { delegateDid },
      },
    });

    await redis.del(`identity:id:${delegatorId}`);
    await redis.del(`identity:did:${identity.did}`);

    logger.info("delegation_revoked", { delegatorId, delegateDid });

    return this.formatIdentity(updated);
  }

  // -------------------------------------------------------------------------
  // Logout (revoke session)
  // -------------------------------------------------------------------------
  async logout(identityId: string, sessionId: string): Promise<void> {
    await revokeToken(sessionId);

    await prisma.auditLog.create({
      data: {
        identityId,
        action: "AUTH_LOGOUT",
        resourceType: "session",
        resourceId: sessionId,
      },
    });

    logger.info("identity_logout", { identityId, sessionId });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private isValidDID(did: string): boolean {
    return /^did:aethelred:[a-zA-Z0-9._-]+$/.test(did);
  }

  private isValidPublicKey(key: string): boolean {
    try {
      const decoded = Buffer.from(key, "base64");
      return decoded.length >= 32 && decoded.length <= 512;
    } catch {
      return false;
    }
  }

  private async hashRecoveryProof(proof: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(proof),
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
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
    this.name = "IdentityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const identityService = new IdentityService();
