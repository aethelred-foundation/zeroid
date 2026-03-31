import { Router, Request, Response } from 'express';
import { identityService } from '../services/identity';
import { governmentAPIService } from '../services/government-api';
import { authMiddleware, AuthenticatedRequest, optionalAuthMiddleware } from '../middleware/auth';
import { validate, registerIdentitySchema, didSchema } from '../middleware/validation';
import { authRateLimiter } from '../middleware/rateLimit';
import { logger } from '../index';
import { z } from 'zod';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/identity/register — Register a new identity
// ---------------------------------------------------------------------------
router.post(
  '/register',
  authRateLimiter,
  validate({ body: registerIdentitySchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { did, publicKey, recoveryHash, displayName, metadata } = req.body;

      const result = await identityService.register({
        did,
        publicKey,
        recoveryHash,
        displayName,
        metadata,
      });

      res.status(201).json({
        data: {
          identity: result.identity,
          token: result.token,
          sessionId: result.sessionId,
        },
        message: 'Identity registered successfully',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('identity_register_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/me — Get current identity profile
// ---------------------------------------------------------------------------
router.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = await identityService.getIdentity(req.identity!.id);
      if (!identity) {
        res.status(404).json({ error: 'Identity not found', code: 'IDENTITY_NOT_FOUND' });
        return;
      }

      // Fetch government verification status
      const govStatus = await governmentAPIService.getVerificationStatus(req.identity!.id);

      res.json({
        data: {
          ...identity,
          governmentVerification: govStatus
            ? { verified: govStatus.verified, provider: govStatus.provider, expiresAt: govStatus.expiresAt }
            : null,
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/identity/resolve/:did — Resolve a DID to public info
// ---------------------------------------------------------------------------
router.get(
  '/resolve/:did',
  optionalAuthMiddleware,
  validate({ params: z.object({ did: z.string().min(1) }) }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const did = decodeURIComponent(req.params.did as string);
      const identity = await identityService.getIdentity(did);

      if (!identity) {
        res.status(404).json({ error: 'DID not found', code: 'DID_NOT_FOUND' });
        return;
      }

      // Public resolution: return limited fields
      res.json({
        data: {
          did: identity.did,
          publicKey: identity.publicKey,
          status: identity.status,
          teeAttested: identity.teeAttested,
          governmentVerified: identity.governmentVerified,
          createdAt: identity.createdAt,
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/identity/recover — Recover identity with recovery proof
// ---------------------------------------------------------------------------
const recoverSchema = z.object({
  did: didSchema,
  recoveryProof: z.string().min(32).max(1024),
  newPublicKey: z.string().min(32).max(512),
  newRecoveryHash: z.string().min(64).max(128),
});

router.post(
  '/recover',
  authRateLimiter,
  validate({ body: recoverSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await identityService.recoverIdentity({
        did: req.body.did,
        recoveryProof: req.body.recoveryProof,
        newPublicKey: req.body.newPublicKey,
        newRecoveryHash: req.body.newRecoveryHash,
      });

      res.json({
        data: {
          identity: result.identity,
          token: result.token,
          sessionId: result.sessionId,
        },
        message: 'Identity recovered successfully',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('identity_recover_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/identity/delegate — Add a delegation
// ---------------------------------------------------------------------------
const delegateSchema = z.object({
  delegateDid: didSchema,
});

router.post(
  '/delegate',
  authMiddleware,
  validate({ body: delegateSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = await identityService.addDelegation({
        delegatorId: req.identity!.id,
        delegateDid: req.body.delegateDid,
      });

      res.json({
        data: identity,
        message: 'Delegation granted successfully',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('delegation_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/v1/identity/delegate/:did — Revoke a delegation
// ---------------------------------------------------------------------------
router.delete(
  '/delegate/:did',
  authMiddleware,
  validate({ params: z.object({ did: z.string().min(1) }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const delegateDid = decodeURIComponent(req.params.did as string);
      const identity = await identityService.revokeDelegation(req.identity!.id, delegateDid);

      res.json({
        data: identity,
        message: 'Delegation revoked successfully',
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/identity/logout — Revoke current session
// ---------------------------------------------------------------------------
router.post(
  '/logout',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (req.sessionId) {
        await identityService.logout(req.identity!.id, req.sessionId);
      }
      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/v1/identity/me — Update own identity
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine((data) => data.displayName !== undefined || data.metadata !== undefined, {
  message: 'At least one field must be provided',
});

router.patch(
  '/me',
  authMiddleware,
  validate({ body: updateSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = await identityService.updateIdentity(req.identity!.id, {
        displayName: req.body.displayName,
        metadata: req.body.metadata,
      });

      res.json({ data: identity, message: 'Identity updated successfully' });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

export { router as identityRoutes };
