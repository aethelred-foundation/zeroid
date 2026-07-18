import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { logger } from '../runtime';
import { AETHELRED_DID_PATTERN } from '../utils/did';

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
        errors.push({ target: 'body', issues: result.error.issues });
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push({ target: 'query', issues: result.error.issues });
      } else {
        (req as Request).query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push({ target: 'params', issues: result.error.issues });
      } else {
        req.params = result.data;
      }
    }

    if (errors.length > 0) {
      const formattedErrors = errors.flatMap(({ target, issues }) =>
        issues.map((issue) => ({
          target,
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      );

      logger.warn('validation_failed', {
        path: req.path,
        method: req.method,
        errors: formattedErrors,
      });

      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
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
    AETHELRED_DID_PATTERN,
    'Invalid DID format. Expected: did:aethelred:<segment>[:<segment>...]',
  );

/**
 * Wallet-identity DIDs must be address-bound: did:aethelred:<network>:<0x…40>.
 * The looser didSchema once let a frontend placeholder ("did:aethelred:pending")
 * register as a real identity, squatting that DID for every wallet (409 on any
 * retry) while the address lookup 404'd. Normalized to lowercase so the address
 * lookup's lowercase candidate DIDs always match what was stored.
 */
export const walletDidSchema = z
  .string()
  .regex(
    /^did:aethelred:(mainnet|testnet|devnet):0x[0-9a-fA-F]{40}$/,
    'Invalid identity DID. Expected: did:aethelred:<network>:<0x-address>',
  )
  .transform((value) => value.toLowerCase());

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const publicKeySchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9+/=]+$/, 'Public key must be base64-encoded');

export const recoveryHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'Recovery hash must be a SHA-256 hex digest');

export const walletControllerSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Controller must be an EVM wallet address')
  .transform((value) => value.toLowerCase());

// Registration deliberately accepts only the canonical 65-byte Ethereum
// signature form with v=27/28. Compact or recovery-id-0/1 variants would give
// the same proof multiple wire encodings and make request auditing ambiguous.
export const walletRegistrationSignatureSchema = z
  .string()
  .regex(
    /^0x[0-9a-fA-F]{128}(1b|1c)$/i,
    'Signature must be a canonical 65-byte Ethereum wallet signature',
  )
  .transform((value) => value.toLowerCase());

export const credentialTypeSchema = z.enum([
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'PROOF_OF_ADDRESS',
  'KYC_LEVEL_1',
  'KYC_LEVEL_2',
  'KYC_LEVEL_3',
  'ACCREDITED_INVESTOR',
  'PROFESSIONAL_LICENSE',
  'EDUCATION',
  'EMPLOYMENT',
  'CUSTOM',
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
    { message: 'from must be before to' },
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
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw Object.assign(
        new Error(`Validation failed in ${context}: ${details}`),
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        },
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Schema for common request patterns
// ---------------------------------------------------------------------------
export const clientIdentityMetadataSchema = z
  .object({
    avatarUri: z
      .string()
      .url()
      .max(2048)
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
          } catch {
            return false;
          }
        },
        { message: 'Avatar URI must be credential-free HTTPS' },
      )
      .optional(),
    didDocument: z.record(z.unknown()).optional(),
    didHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  })
  .strict();

export const registerIdentitySchema = z
  .object({
    did: walletDidSchema,
    controller: walletControllerSchema,
    publicKey: publicKeySchema,
    recoveryHash: recoveryHashSchema.transform((value) => value.toLowerCase()),
    signature: walletRegistrationSignatureSchema,
    displayName: z.string().min(1).max(100).optional(),
    metadata: clientIdentityMetadataSchema.optional(),
  })
  .strict();

export const issueCredentialSchema = z.object({
  credentialType: credentialTypeSchema,
  organizationId: uuidSchema.optional(),
  subjectDid: didSchema,
  claims: z.record(z.unknown()),
  expiresAt: z.coerce.date().optional(),
  schemaId: uuidSchema.optional(),
  issuerProof: z
    .object({
      type: z.string().min(1).max(120).optional(),
      created: z.string().datetime().optional(),
      verificationMethod: z.string().min(1).max(500).optional(),
      proofPurpose: z.literal('assertionMethod').optional(),
      issuerDid: didSchema.optional(),
      keyVersion: z.string().min(1).max(120).optional(),
      credentialBinding: z
        .object({
          version: z.literal('zeroid.credential.signature.v2'),
          proofPurpose: z.literal('assertionMethod'),
          issuerDid: didSchema,
          issuerId: z.string().min(1).max(120),
          subjectDid: didSchema,
          subjectId: z.string().min(1).max(120),
          credentialType: credentialTypeSchema,
          organizationId: uuidSchema.nullable(),
          schemaId: uuidSchema.nullable(),
          issuedAt: z.string().datetime(),
          expiresAt: z.string().datetime().nullable(),
          claimsHash: z.string().regex(/^[0-9a-f]{64}$/i),
        })
        .optional(),
      signatureValue: z.string().min(16),
    })
    .optional(),
});

export const verifyCredentialSchema = z.object({
  credentialId: uuidSchema,
  zkProofRequired: z.boolean().default(false),
  selectiveDisclosure: z.array(z.string()).optional(),
});

export const createSchemaSchema = z.object({
  name: z.string().min(3).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format'),
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
