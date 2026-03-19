import { Request, Response, NextFunction } from "express";
import { z, ZodSchema, ZodError } from "zod";
import { logger } from "../index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------
export function validate(schemas: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ target: string; issues: z.ZodIssue[] }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push({ target: "body", issues: result.error.issues });
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push({ target: "query", issues: result.error.issues });
      } else {
        (req as Request).query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push({ target: "params", issues: result.error.issues });
      } else {
        req.params = result.data;
      }
    }

    if (errors.length > 0) {
      const formattedErrors = errors.flatMap(({ target, issues }) =>
        issues.map((issue) => ({
          target,
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      );

      logger.warn("validation_failed", {
        path: req.path,
        method: req.method,
        errors: formattedErrors,
      });

      res.status(400).json({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: formattedErrors,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

export const didSchema = z
  .string()
  .regex(
    /^did:aethelred:[a-zA-Z0-9._-]+$/,
    "Invalid DID format. Expected: did:aethelred:<identifier>",
  );

export const uuidSchema = z.string().uuid("Invalid UUID format");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const publicKeySchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9+/=]+$/, "Public key must be base64-encoded");

export const credentialTypeSchema = z.enum([
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVERS_LICENSE",
  "PROOF_OF_ADDRESS",
  "KYC_LEVEL_1",
  "KYC_LEVEL_2",
  "KYC_LEVEL_3",
  "ACCREDITED_INVESTOR",
  "PROFESSIONAL_LICENSE",
  "EDUCATION",
  "EMPLOYMENT",
  "CUSTOM",
]);

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) return data.from <= data.to;
      return true;
    },
    { message: "from must be before to" },
  );

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
export function parseOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  context: string,
): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw Object.assign(
        new Error(`Validation failed in ${context}: ${details}`),
        {
          statusCode: 400,
          code: "VALIDATION_ERROR",
        },
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Schema for common request patterns
// ---------------------------------------------------------------------------
export const registerIdentitySchema = z.object({
  did: didSchema,
  publicKey: publicKeySchema,
  recoveryHash: z.string().min(64).max(128),
  displayName: z.string().min(1).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const issueCredentialSchema = z.object({
  credentialType: credentialTypeSchema,
  subjectDid: didSchema,
  claims: z.record(z.unknown()),
  expiresAt: z.coerce.date().optional(),
  schemaId: uuidSchema.optional(),
});

export const verifyCredentialSchema = z.object({
  credentialId: uuidSchema,
  zkProofRequired: z.boolean().default(false),
  selectiveDisclosure: z.array(z.string()).optional(),
});

export const createSchemaSchema = z.object({
  name: z.string().min(3).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver format"),
  description: z.string().min(10).max(1000),
  schemaDefinition: z.record(z.unknown()),
});

export const auditQuerySchema = z.object({
  identityId: uuidSchema.optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
