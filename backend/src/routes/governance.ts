import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import {
  validate,
  createSchemaSchema,
  uuidSchema,
  paginationSchema,
} from "../middleware/validation";
import { governanceLimiter } from "../middleware/rateLimit";
import { prisma, logger } from "../runtime";
import { governmentAPIService } from "../services/government-api";
import { teeService } from "../services/tee";
import { asRouteError, sendRouteError } from "../utils/route-error";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const router = Router();
router.use(governanceLimiter);

function governanceRouteError(
  statusCode: number,
  code: string,
  message: string,
): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

function isTransactionWriteConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

async function runSerializableGovernanceTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (!isTransactionWriteConflict(error)) throw error;
      if (attempt === 3) {
        throw governanceRouteError(
          409,
          "SCHEMA_VOTE_CONFLICT",
          "Schema vote conflicted with another update; retry the current record",
        );
      }
    }
  }

  throw governanceRouteError(
    409,
    "SCHEMA_VOTE_CONFLICT",
    "Schema vote could not be recorded",
  );
}

function configuredVoteThreshold(name: string): number {
  const configured = Number.parseInt(process.env[name] ?? "3", 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
}

// ---------------------------------------------------------------------------
// POST /api/v1/governance/schemas — Propose a new credential schema
// ---------------------------------------------------------------------------
router.post(
  "/schemas",
  governanceLimiter,
  validate({ body: createSchemaSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { name, version, description, schemaDefinition } = req.body;

      // Check for existing schema with same name+version
      const existing = await prisma.schemaGovernance.findUnique({
        where: { name_version: { name, version } },
      });
      if (existing) {
        res.status(409).json({
          error: "Schema with this name and version already exists",
          code: "SCHEMA_DUPLICATE",
        });
        return;
      }

      // Validate schema definition structure
      if (
        !schemaDefinition.properties ||
        typeof schemaDefinition.properties !== "object"
      ) {
        res.status(400).json({
          error: "Schema definition must include a properties object",
          code: "SCHEMA_INVALID_DEFINITION",
        });
        return;
      }

      const schema = await prisma.schemaGovernance.create({
        data: {
          name,
          version,
          description,
          schemaDefinition,
          proposedBy: identity.id,
          status: "PROPOSED",
          voters: [],
        },
      });

      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: "SCHEMA_PROPOSED",
          resourceType: "schema",
          resourceId: schema.id,
          details: { name, version, description },
        },
      });

      logger.info("schema_proposed", {
        schemaId: schema.id,
        name,
        version,
        proposedBy: identity.id,
      });

      res.status(201).json({
        data: schema,
        message: "Schema proposed successfully",
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error("schema_propose_error", { error: error.message });
      sendRouteError(res, error, "SCHEMA_PROPOSE_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/governance/schemas/:id/vote — Vote on a schema
// ---------------------------------------------------------------------------
const voteSchema = z.object({
  approve: z.boolean(),
});

router.post(
  "/schemas/:id/vote",
  governanceLimiter,
  validate({
    params: z.object({ id: uuidSchema }),
    body: voteSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const schemaId = req.params.id;
      const { approve } = req.body;

      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: schemaId as string },
      });
      if (!schema) {
        res
          .status(404)
          .json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        return;
      }

      if (schema.status !== "PROPOSED") {
        res.status(400).json({
          error: "Can only vote on proposed schemas",
          code: "SCHEMA_NOT_VOTABLE",
        });
        return;
      }

      // Prevent duplicate votes
      if (schema.voters.includes(identity.id)) {
        res.status(409).json({
          error: "Already voted on this schema",
          code: "SCHEMA_ALREADY_VOTED",
        });
        return;
      }

      // Proposer cannot vote on own schema
      if (schema.proposedBy === identity.id) {
        res.status(403).json({
          error: "Cannot vote on own schema",
          code: "SCHEMA_SELF_VOTE",
        });
        return;
      }

      // Only identities with current verification evidence can vote.
      const voter = await prisma.identity.findUnique({
        where: { id: identity.id },
        select: { teeAttestationId: true },
      });
      const [teeValid, governmentStatus] = await Promise.all([
        voter?.teeAttestationId
          ? teeService.isAttestationValid(voter.teeAttestationId)
          : Promise.resolve(false),
        governmentAPIService.getVerificationStatus(identity.id),
      ]);
      if (!teeValid && !governmentStatus) {
        res.status(403).json({
          error: "Must be TEE-attested or government-verified to vote",
          code: "SCHEMA_VOTER_UNVERIFIED",
        });
        return;
      }

      const approvalThreshold = configuredVoteThreshold(
        "SCHEMA_APPROVAL_THRESHOLD",
      );
      const rejectionThreshold = configuredVoteThreshold(
        "SCHEMA_REJECTION_THRESHOLD",
      );

      const updated = await runSerializableGovernanceTransaction(
        async (transaction) => {
          // Re-read every vote precondition inside the serializable transaction.
          // The earlier read avoids unnecessary evidence calls for obvious
          // failures; this read is the authority for the write.
          const current = await transaction.schemaGovernance.findUnique({
            where: { id: schemaId as string },
          });
          if (!current) {
            throw governanceRouteError(
              404,
              "SCHEMA_NOT_FOUND",
              "Schema not found",
            );
          }
          if (current.status !== "PROPOSED") {
            throw governanceRouteError(
              400,
              "SCHEMA_NOT_VOTABLE",
              "Can only vote on proposed schemas",
            );
          }
          if (current.voters.includes(identity.id)) {
            throw governanceRouteError(
              409,
              "SCHEMA_ALREADY_VOTED",
              "Already voted on this schema",
            );
          }
          if (current.proposedBy === identity.id) {
            throw governanceRouteError(
              403,
              "SCHEMA_SELF_VOTE",
              "Cannot vote on own schema",
            );
          }

          const newApprovalCount = current.approvalVotes + (approve ? 1 : 0);
          const newRejectionCount = current.rejectionVotes + (approve ? 0 : 1);
          const updateData: Prisma.SchemaGovernanceUpdateInput = {
            voters: { push: identity.id },
            ...(approve
              ? { approvalVotes: { increment: 1 } }
              : { rejectionVotes: { increment: 1 } }),
            ...(newApprovalCount >= approvalThreshold
              ? { status: "APPROVED" }
              : newRejectionCount >= rejectionThreshold
                ? { status: "DEPRECATED" }
                : {}),
          };

          const recorded = await transaction.schemaGovernance.update({
            where: { id: schemaId as string },
            data: updateData,
          });
          const auditAction =
            recorded.status === "APPROVED"
              ? "SCHEMA_APPROVED"
              : recorded.status === "DEPRECATED"
                ? "SCHEMA_REJECTED"
                : "SCHEMA_VOTE_CAST";

          await transaction.auditLog.create({
            data: {
              identityId: identity.id,
              action: auditAction,
              resourceType: "schema",
              resourceId: schemaId as string,
              details: {
                approve,
                approvalVotes: recorded.approvalVotes,
                rejectionVotes: recorded.rejectionVotes,
                finalStatus: recorded.status,
              },
            },
          });

          return recorded;
        },
      );

      res.json({
        data: updated,
        message: `Vote recorded. Schema status: ${updated.status}`,
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error("schema_vote_error", { error: error.message });
      sendRouteError(res, error, "SCHEMA_VOTE_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/governance/schemas — List schemas
// ---------------------------------------------------------------------------
const listSchemasQuery = paginationSchema.extend({
  status: z.enum(["DRAFT", "PROPOSED", "APPROVED", "DEPRECATED"]).optional(),
  name: z.string().optional(),
});

router.get(
  "/schemas",
  validate({ query: listSchemasQuery }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { page, limit, status, name } = req.query as unknown as z.infer<
        typeof listSchemasQuery
      >;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (name) where.name = { contains: name, mode: "insensitive" };

      const [schemas, total] = await Promise.all([
        prisma.schemaGovernance.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.schemaGovernance.count({ where }),
      ]);

      res.json({
        data: schemas,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "SCHEMA_LIST_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/governance/schemas/:id — Get schema details
// ---------------------------------------------------------------------------
router.get(
  "/schemas/:id",
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: req.params.id as string },
      });

      if (!schema) {
        res
          .status(404)
          .json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        return;
      }

      res.json({ data: schema });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "SCHEMA_GET_FAILED");
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/v1/governance/schemas/:id/deprecate — Deprecate an approved schema
// ---------------------------------------------------------------------------
router.patch(
  "/schemas/:id/deprecate",
  governanceLimiter,
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: req.params.id as string },
      });

      if (!schema) {
        res
          .status(404)
          .json({ error: "Schema not found", code: "SCHEMA_NOT_FOUND" });
        return;
      }

      // Only the proposer can deprecate
      if (schema.proposedBy !== identity.id) {
        res.status(403).json({
          error: "Only the proposer can deprecate a schema",
          code: "SCHEMA_NOT_OWNER",
        });
        return;
      }

      if (schema.status === "DEPRECATED") {
        res.status(400).json({
          error: "Schema is already deprecated",
          code: "SCHEMA_ALREADY_DEPRECATED",
        });
        return;
      }

      const updated = await prisma.schemaGovernance.update({
        where: { id: req.params.id as string },
        data: { status: "DEPRECATED" },
      });

      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: "SCHEMA_REVOKED",
          resourceType: "schema",
          resourceId: req.params.id as string,
          details: { action: "deprecate", previousStatus: schema.status },
        },
      });

      res.json({ data: updated, message: "Schema deprecated successfully" });
    } catch (err) {
      sendRouteError(res, asRouteError(err), "SCHEMA_DEPRECATE_FAILED");
    }
  },
);

export { router as governanceRoutes };
