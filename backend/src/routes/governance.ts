import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import {
  validate,
  createSchemaSchema,
  uuidSchema,
  paginationSchema,
} from "../middleware/validation";
import { governanceLimiter } from "../middleware/rateLimit";
import { prisma, logger } from "../index";
import { z } from "zod";

const router = Router();

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
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("schema_propose_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
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

      // Only TEE-attested or government-verified identities can vote
      const voter = await prisma.identity.findUnique({
        where: { id: identity.id },
      });
      if (!voter?.teeAttested && !voter?.governmentVerified) {
        res.status(403).json({
          error: "Must be TEE-attested or government-verified to vote",
          code: "SCHEMA_VOTER_UNVERIFIED",
        });
        return;
      }

      const updateData: Record<string, unknown> = {
        voters: [...schema.voters, identity.id],
      };

      if (approve) {
        updateData.approvalVotes = schema.approvalVotes + 1;
      } else {
        updateData.rejectionVotes = schema.rejectionVotes + 1;
      }

      // Auto-approve at threshold (e.g., 3 approvals)
      const APPROVAL_THRESHOLD = parseInt(
        process.env.SCHEMA_APPROVAL_THRESHOLD ?? "3",
        10,
      );
      const REJECTION_THRESHOLD = parseInt(
        process.env.SCHEMA_REJECTION_THRESHOLD ?? "3",
        10,
      );

      const newApprovalCount = approve
        ? schema.approvalVotes + 1
        : schema.approvalVotes;
      const newRejectionCount = approve
        ? schema.rejectionVotes
        : schema.rejectionVotes + 1;

      if (newApprovalCount >= APPROVAL_THRESHOLD) {
        updateData.status = "APPROVED";
      } else if (newRejectionCount >= REJECTION_THRESHOLD) {
        updateData.status = "DEPRECATED";
      }

      const updated = await prisma.schemaGovernance.update({
        where: { id: schemaId as string },
        data: updateData,
      });

      const auditAction =
        updated.status === "APPROVED"
          ? "SCHEMA_APPROVED"
          : updated.status === "DEPRECATED"
            ? "SCHEMA_REJECTED"
            : approve
              ? "SCHEMA_APPROVED"
              : "SCHEMA_REJECTED";

      await prisma.auditLog.create({
        data: {
          identityId: identity.id,
          action: auditAction,
          resourceType: "schema",
          resourceId: schemaId as string,
          details: {
            approve,
            approvalVotes: updated.approvalVotes,
            rejectionVotes: updated.rejectionVotes,
            finalStatus: updated.status,
          },
        },
      });

      res.json({
        data: updated,
        message: `Vote recorded. Schema status: ${updated.status}`,
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error("schema_vote_error", { error: error.message });
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
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
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
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
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
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
          action: "SCHEMA_REJECTED",
          resourceType: "schema",
          resourceId: req.params.id as string,
          details: { action: "deprecate", previousStatus: schema.status },
        },
      });

      res.json({ data: updated, message: "Schema deprecated successfully" });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res
        .status(error.statusCode ?? 500)
        .json({ error: error.message, code: error.code });
    }
  },
);

export { router as governanceRoutes };
