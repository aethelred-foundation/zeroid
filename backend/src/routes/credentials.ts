import { Router, Response } from "express";
import { credentialService } from "../services/credential";
import { AuthenticatedRequest } from "../middleware/auth";
import {
  validate,
  issueCredentialSchema,
  uuidSchema,
  paginationSchema,
  credentialTypeSchema,
} from "../middleware/validation";
import { credentialIssuanceLimiter } from "../middleware/rateLimit";
import { logger } from "../index";
import { z } from "zod";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/credentials — Issue a new credential
// ---------------------------------------------------------------------------
router.post(
  "/",
  credentialIssuanceLimiter,
  validate({ body: issueCredentialSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { credentialType, subjectDid, claims, expiresAt, schemaId } =
        req.body;
      const issuer = req.identity!;

      // Resolve subject DID to identity
      const { prisma } = await import("../index");
      const subject = await prisma.identity.findUnique({
        where: { did: subjectDid },
      });
      if (!subject) {
        res
          .status(404)
          .json({ error: "Subject DID not found", code: "SUBJECT_NOT_FOUND" });
        return;
      }

      const credential = await credentialService.issueCredential({
        credentialType,
        issuerId: issuer.id,
        issuerDid: issuer.did,
        subjectId: subject.id,
        subjectDid,
        claims,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        schemaId,
      });

      res.status(201).json({
        data: credential,
        message: "Credential issued successfully",
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("credential_issue_error", { error: error.message });
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.code ?? "CREDENTIAL_ISSUE_FAILED",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/credentials/:id — Get credential by ID
// ---------------------------------------------------------------------------
router.get(
  "/:id",
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const credential = await credentialService.getCredential(
        req.params.id as string,
      );
      if (!credential) {
        res.status(404).json({
          error: "Credential not found",
          code: "CREDENTIAL_NOT_FOUND",
        });
        return;
      }

      // Only the issuer or subject can view the credential
      const identity = req.identity!;
      if (
        credential.issuerId !== identity.id &&
        credential.subjectId !== identity.id
      ) {
        res
          .status(403)
          .json({ error: "Access denied", code: "CREDENTIAL_ACCESS_DENIED" });
        return;
      }

      res.json({ data: credential });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/credentials — Query credentials
// ---------------------------------------------------------------------------
const querySchema = paginationSchema.extend({
  credentialType: credentialTypeSchema.optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED"]).optional(),
  role: z.enum(["issuer", "subject"]).default("subject"),
});

router.get(
  "/",
  validate({ query: querySchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { page, limit, credentialType, status, role } =
        req.query as unknown as z.infer<typeof querySchema>;
      const identity = req.identity!;

      const query = {
        ...(role === "subject"
          ? { subjectId: identity.id }
          : { issuerId: identity.id }),
        credentialType,
        status: status as import("@prisma/client").CredentialStatus | undefined,
        page,
        limit,
      };

      const result = await credentialService.queryCredentials(query);

      res.json({
        data: result.credentials,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/credentials/:id/revoke — Revoke a credential
// ---------------------------------------------------------------------------
const revokeSchema = z.object({
  reason: z.string().min(5).max(500),
});

router.post(
  "/:id/revoke",
  validate({
    params: z.object({ id: uuidSchema }),
    body: revokeSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;

      const credential = await credentialService.revokeCredential({
        credentialId: req.params.id as string,
        revokedBy: identity.id,
        reason: req.body.reason,
      });

      res.json({
        data: credential,
        message: "Credential revoked successfully",
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("credential_revoke_error", {
        error: error.message,
        credentialId: req.params.id,
      });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/credentials/:id/verify — Verify a credential
// ---------------------------------------------------------------------------
router.post(
  "/:id/verify",
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const result = await credentialService.verifyCredential(
        req.params.id as string,
      );

      // Only return full credential data to issuer or subject
      const isAuthorized =
        result.credential.issuerId === identity.id ||
        result.credential.subjectId === identity.id;

      res.json({
        data: {
          valid: result.valid,
          checks: result.checks,
          verifiedAt: new Date().toISOString(),
          // Only include credential details for authorized parties
          ...(isAuthorized
            ? { credential: result.credential }
            : {
                credential: {
                  id: result.credential.id,
                  credentialType: result.credential.credentialType,
                  status: result.credential.status,
                  issuedAt: result.credential.issuedAt,
                  expiresAt: result.credential.expiresAt,
                  // Claims and proof are omitted for unauthorized verifiers
                },
              }),
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
    }
  },
);

export { router as credentialRoutes };
