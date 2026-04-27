import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validate, uuidSchema } from '../middleware/validation';
import { verificationLimiter } from '../middleware/rateLimit';
import { zkProofService } from '../services/zkproof';
import { teeService } from '../services/tee';
import { credentialService } from '../services/credential';
import { prisma, logger, redis, verificationCounter } from '../index';
import { createHash, randomUUID } from 'crypto';
import { asRouteError, sendRouteError } from '../utils/route-error';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants for proof binding
// ---------------------------------------------------------------------------
const PROOF_NONCE_TTL_SECONDS = 300; // Nonces are valid for 5 minutes
const PROOF_REPLAY_WINDOW_SECONDS = 86400; // Track used proofs for 24 hours
const MAX_PROOF_AGE_MS = 5 * 60 * 1000; // Proofs expire after 5 minutes

function canonicalizeClaims(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeClaims(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (key) => JSON.stringify(key) + ':' + canonicalizeClaims(obj[key]),
  );
  return '{' + entries.join(',') + '}';
}

function computeClaimsHash(claims: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeClaims(claims)).digest('hex');
}

function digestToFieldElement(hexDigest: string): string {
  const normalized = hexDigest.replace(/^0x/i, '');
  const digest = /^[0-9a-fA-F]+$/.test(normalized)
    ? normalized
    : createHash('sha256').update(hexDigest).digest('hex');
  return BigInt('0x' + digest.substring(0, 62)).toString();
}

const router = Router();
router.use(verificationLimiter);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/zk-proof — Generate a ZK proof for a credential
// ---------------------------------------------------------------------------
const generateZKProofSchema = z.object({
  credentialId: uuidSchema,
  circuitName: z.string().min(1).max(100),
  inputs: z.record(z.union([z.string(), z.number()])),
  selectiveDisclosure: z.array(z.string()).optional(),
  // Context binding fields — required for production proofs
  audience: z
    .string()
    .min(1)
    .max(256)
    .describe('Intended verifier DID or identifier'),
  nonce: z
    .string()
    .min(16)
    .max(128)
    .optional()
    .describe('Verifier-supplied nonce; auto-generated if omitted'),
});

router.post(
  '/zk-proof',
  verificationLimiter,
  validate({ body: generateZKProofSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const {
        credentialId,
        circuitName,
        inputs,
        selectiveDisclosure,
        audience,
      } = req.body;
      const nonce: string = req.body.nonce ?? randomUUID();

      // Verify the credential belongs to the requester
      const credential = await credentialService.getCredential(credentialId);
      if (!credential) {
        res
          .status(404)
          .json({ error: 'Credential not found', code: 'CRED_NOT_FOUND' });
        return;
      }
      if (credential.subjectId !== identity.id) {
        res.status(403).json({
          error: 'Can only generate proofs for own credentials',
          code: 'PROOF_ACCESS_DENIED',
        });
        return;
      }

      // Derive witness from credential claims — never trust caller-supplied witness data
      const claimsHash = computeClaimsHash(credential.claims);
      if (claimsHash !== credential.claimsHash) {
        res.status(409).json({
          error: 'Credential claims integrity mismatch',
          code: 'CRED_CLAIMS_HASH_MISMATCH',
        });
        return;
      }

      // Compute a single context commitment that binds the proof to this
      // specific presentation context. By hashing all context fields into one
      // field element, we consume only 2 circuit inputs (claimsHash +
      // contextCommitment) instead of 7 separate fields, staying within the
      // input budgets of small circuits like age_verification (5 max).
      const issuedAt = Date.now();
      const contextCommitment = createHash('sha256')
        .update(
          `${nonce}:${audience}:${identity.id}:${credentialId}:${issuedAt}`,
        )
        .digest('hex');

      // Convert to a field element (truncate to 253 bits for BN254 scalar field)
      const contextCommitmentField = BigInt(
        '0x' + contextCommitment.substring(0, 62),
      ).toString();
      const claimsHashField = digestToFieldElement(credential.claimsHash);

      const witnessInputs: Record<string, string | number> = {
        // Claims hash as a public commitment for integrity binding
        claimsHash: claimsHashField,
        // Single context commitment — encodes nonce, audience, subject,
        // credential, and issuedAt. Verified against public signals on
        // the verifier side to ensure proof is bound to this context.
        contextCommitment: contextCommitmentField,
      };

      // For selective disclosure, include only the selected claim values
      if (selectiveDisclosure && selectiveDisclosure.length > 0) {
        const sdInputs = zkProofService.buildSelectiveDisclosureInputs(
          credential.claims,
          selectiveDisclosure,
        );
        Object.assign(witnessInputs, sdInputs);
      } else {
        // Include all claims as private witness inputs
        for (const [key, value] of Object.entries(credential.claims)) {
          if (typeof value === 'string' || typeof value === 'number') {
            witnessInputs[`claim_${key}`] = value;
          }
        }
      }

      // Merge proof parameters from caller (e.g., ageThreshold, incomeMin)
      // Only allow known parameter keys, not raw witness data
      const allowedParams = [
        'threshold',
        'ageThreshold',
        'incomeMin',
        'incomeMax',
        'nationalitySet',
      ];
      for (const [key, value] of Object.entries(inputs)) {
        if (allowedParams.includes(key)) {
          witnessInputs[key] = value as string | number;
        }
      }

      const result = await zkProofService.generateProof({
        circuitName,
        inputs: witnessInputs,
        credentialId,
        selectiveDisclosure,
      });

      // Store nonce in Redis with the context commitment field value so the
      // verifier can compare it against the proof's public signals.
      await redis.set(
        `proof:nonce:${nonce}`,
        JSON.stringify({
          audience,
          subjectId: identity.id,
          credentialId,
          issuedAt,
          claimsHashField,
          contextCommitmentField,
        }),
        'EX',
        PROOF_NONCE_TTL_SECONDS,
      );

      // Create verification record
      await prisma.verification.create({
        data: {
          credentialId,
          verifierId: identity.id,
          subjectId: identity.id,
          verificationType: 'ZK_PROOF',
          zkProofData: {
            proofId: result.proofId,
            circuitName: result.circuitName,
            publicSignals: result.publicSignals,
            nonce,
            audience,
            claimsHash: claimsHashField,
            contextCommitment: contextCommitmentField,
            issuedAt,
          },
          result: 'VERIFIED',
          completedAt: new Date(),
        },
      });

      verificationCounter.inc({ result: 'success' });

      res.status(201).json({
        data: {
          proofId: result.proofId,
          proof: result.proof,
          publicSignals: result.publicSignals,
          circuitName: result.circuitName,
          generatedAt: result.generatedAt,
          generationTimeMs: result.generationTimeMs,
          // Context binding metadata for the verifier
          nonce,
          audience,
          issuedAt,
          expiresAt: issuedAt + MAX_PROOF_AGE_MS,
          claimsHash: claimsHashField,
          contextCommitment: contextCommitmentField,
        },
        message: 'ZK proof generated successfully',
      });
    } catch (err) {
      verificationCounter.inc({ result: 'failed' });
      const error = asRouteError(err);
      logger.error('zk_proof_generation_error', { error: error.message });
      sendRouteError(res, error, 'ZK_PROOF_GENERATION_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/zk-verify — Verify a ZK proof
// ---------------------------------------------------------------------------
const verifyZKProofSchema = z.object({
  proof: z.object({
    pi_a: z.array(z.string()),
    pi_b: z.array(z.array(z.string())),
    pi_c: z.array(z.string()),
    protocol: z.string(),
    curve: z.string(),
  }),
  publicSignals: z.array(z.string()),
  circuitName: z.string().min(1).max(100),
  // Context binding — verifier must supply matching values
  nonce: z.string().min(16).max(128).describe('Nonce from proof generation'),
  audience: z
    .string()
    .min(1)
    .max(256)
    .describe('Expected audience (must match proof)'),
  contextCommitment: z
    .string()
    .min(1)
    .describe('Context commitment field element from proof generation'),
  issuedAt: z.number().int().positive().describe('Proof issuance timestamp'),
});

router.post(
  '/zk-verify',
  verificationLimiter,
  validate({ body: verifyZKProofSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        proof,
        publicSignals,
        circuitName,
        nonce,
        audience,
        contextCommitment,
        issuedAt,
      } = req.body;
      const verifier = req.identity!;

      // 1. Check proof age — reject expired proofs
      const proofAge = Date.now() - issuedAt;
      if (proofAge > MAX_PROOF_AGE_MS) {
        res.status(400).json({
          error: `Proof expired (age: ${Math.round(proofAge / 1000)}s, max: ${MAX_PROOF_AGE_MS / 1000}s)`,
          code: 'PROOF_EXPIRED',
        });
        return;
      }
      if (proofAge < 0) {
        res.status(400).json({
          error: 'Proof issuedAt is in the future',
          code: 'PROOF_FUTURE_TIMESTAMP',
        });
        return;
      }

      // 2. Audience check — verifier must be the intended audience
      if (audience !== verifier.id && audience !== verifier.did) {
        logger.warn('proof_audience_mismatch', {
          expected: audience,
          actual: verifier.id,
          nonce,
        });
        res.status(403).json({
          error: 'Proof was not issued for this verifier',
          code: 'PROOF_AUDIENCE_MISMATCH',
        });
        return;
      }

      // 3. Replay protection — check if this nonce has already been consumed
      const replayKey = `proof:used:${nonce}`;
      const alreadyUsed = await redis.get(replayKey);
      if (alreadyUsed) {
        logger.warn('proof_replay_detected', { nonce, verifier: verifier.id });
        res.status(409).json({
          error: 'Proof has already been verified (replay)',
          code: 'PROOF_REPLAY',
        });
        return;
      }

      // 4. Validate nonce was actually issued by our system
      const nonceData = await redis.get(`proof:nonce:${nonce}`);
      if (!nonceData) {
        logger.warn('proof_nonce_unknown', { nonce, verifier: verifier.id });
        res.status(400).json({
          error: 'Nonce not recognized or expired',
          code: 'PROOF_NONCE_INVALID',
        });
        return;
      }

      // 5. Verify context metadata and commitment integrity against the
      //    server-side nonce record. The HTTP metadata must match the nonce
      //    record that created the public context commitment; otherwise a
      //    valid proof for one audience/timestamp could be rebound to another
      //    verifier request while still passing the public-signal check.
      const nonceRecord = JSON.parse(nonceData) as {
        audience?: unknown;
        subjectId?: unknown;
        credentialId?: unknown;
        issuedAt?: unknown;
        claimsHashField?: unknown;
        contextCommitmentField?: unknown;
      };

      if (
        typeof nonceRecord.audience !== 'string' ||
        typeof nonceRecord.subjectId !== 'string' ||
        typeof nonceRecord.credentialId !== 'string' ||
        typeof nonceRecord.issuedAt !== 'number' ||
        typeof nonceRecord.claimsHashField !== 'string' ||
        typeof nonceRecord.contextCommitmentField !== 'string'
      ) {
        res.status(400).json({
          error: 'Nonce record is malformed',
          code: 'PROOF_NONCE_RECORD_INVALID',
        });
        return;
      }

      if (
        nonceRecord.audience !== audience ||
        nonceRecord.issuedAt !== issuedAt
      ) {
        logger.warn('proof_context_metadata_mismatch', {
          nonce,
          requestAudience: audience,
          nonceAudience: nonceRecord.audience,
          requestIssuedAt: issuedAt,
          nonceIssuedAt: nonceRecord.issuedAt,
        });
        res.status(400).json({
          error:
            'Proof context metadata does not match the issued nonce record',
          code: 'PROOF_CONTEXT_METADATA_MISMATCH',
        });
        return;
      }

      const credential = await credentialService.getCredential(
        nonceRecord.credentialId,
      );
      if (!credential) {
        res.status(400).json({
          error: 'Credential referenced by nonce was not found',
          code: 'PROOF_CREDENTIAL_NOT_FOUND',
        });
        return;
      }

      if (
        credential.status !== 'ACTIVE' ||
        credential.subjectId !== nonceRecord.subjectId
      ) {
        logger.warn('proof_credential_context_mismatch', {
          nonce,
          credentialId: nonceRecord.credentialId,
          credentialStatus: credential.status,
          credentialSubjectId: credential.subjectId,
          nonceSubjectId: nonceRecord.subjectId,
        });
        res.status(400).json({
          error: 'Credential no longer matches the proof issuance context',
          code: 'PROOF_CREDENTIAL_CONTEXT_INVALID',
        });
        return;
      }

      const currentClaimsHash = computeClaimsHash(credential.claims);
      if (currentClaimsHash !== credential.claimsHash) {
        res.status(409).json({
          error: 'Credential claims integrity mismatch',
          code: 'PROOF_CREDENTIAL_CLAIMS_HASH_INVALID',
        });
        return;
      }

      const expectedClaimsHashField = digestToFieldElement(
        credential.claimsHash,
      );
      if (nonceRecord.claimsHashField !== expectedClaimsHashField) {
        res.status(400).json({
          error: 'Nonce claims commitment does not match the credential',
          code: 'PROOF_CLAIMS_CONTEXT_INVALID',
        });
        return;
      }

      const expectedCommitmentHash = createHash('sha256')
        .update(
          `${nonce}:${nonceRecord.audience}:${nonceRecord.subjectId}:${nonceRecord.credentialId}:${nonceRecord.issuedAt}`,
        )
        .digest('hex');
      const expectedCommitmentField = BigInt(
        '0x' + expectedCommitmentHash.substring(0, 62),
      ).toString();

      if (
        contextCommitment !== expectedCommitmentField ||
        nonceRecord.contextCommitmentField !== expectedCommitmentField
      ) {
        res.status(400).json({
          error:
            'Context commitment mismatch — proof may have been tampered with',
          code: 'PROOF_CONTEXT_INVALID',
        });
        return;
      }

      // 6. Verify the ZK proof cryptographically
      const result = await zkProofService.verifyProof(
        proof,
        publicSignals,
        circuitName,
      );

      if (!result.valid) {
        verificationCounter.inc({ result: 'failed' });
        res.json({
          data: { valid: false, proofId: result.proofId, circuitName },
        });
        return;
      }

      // 7. CRITICAL: Enforce context commitment against the proof's actual
      //    public signals. This closes the replay/rebinding gap — the proof
      //    is only accepted if the contextCommitment was committed as a
      //    public input during proof generation and is verified by the
      //    circuit's verification key. Without this check, a valid proof
      //    could be replayed with forged metadata.
      //
      //    ZK-02: We enforce both presence AND position — all ZeroID circuits
      //    emit contextCommitment as the last public signal. Checking position
      //    prevents a malicious circuit from smuggling the commitment into an
      //    unrelated signal slot.
      if (!Array.isArray(publicSignals) || publicSignals.length < 2) {
        res.status(400).json({
          error:
            'Public signals array is missing or too short — expected at least claimsHash and contextCommitment',
          code: 'PROOF_SIGNALS_SCHEMA_INVALID',
        });
        return;
      }

      const firstSignal = publicSignals[0];
      if (firstSignal !== expectedClaimsHashField) {
        logger.warn('proof_claims_hash_not_in_public_signals', {
          nonce,
          expectedClaimsHash: expectedClaimsHashField,
          actualFirstSignal: firstSignal,
          publicSignalsLength: publicSignals.length,
        });
        res.status(400).json({
          error:
            'Claims commitment is not the first public signal — proof is not bound to the credential',
          code: 'PROOF_CLAIMS_HASH_NOT_COMMITTED',
        });
        return;
      }

      const lastSignal = publicSignals[publicSignals.length - 1];
      if (lastSignal !== expectedCommitmentField) {
        logger.warn('proof_context_not_in_public_signals', {
          nonce,
          expectedCommitment: expectedCommitmentField,
          actualLastSignal: lastSignal,
          publicSignalsLength: publicSignals.length,
        });
        res.status(400).json({
          error:
            'Context commitment is not the last public signal — proof is not bound to this context',
          code: 'PROOF_CONTEXT_NOT_COMMITTED',
        });
        return;
      }

      // 8. Mark nonce as consumed — prevents replay
      await redis.set(
        replayKey,
        JSON.stringify({
          verifier: verifier.id,
          verifiedAt: Date.now(),
        }),
        'EX',
        PROOF_REPLAY_WINDOW_SECONDS,
      );

      // Clean up the issuance nonce
      await redis.del(`proof:nonce:${nonce}`);

      verificationCounter.inc({ result: 'success' });

      res.json({
        data: {
          valid: true,
          proofId: result.proofId,
          circuitName: result.circuitName,
          publicSignals: result.publicSignals,
          verifiedAt: result.verifiedAt,
          contextBinding: {
            nonce,
            audience,
            issuedAt,
            replayProtected: true,
            contextCommittedInProof: true,
          },
        },
      });
    } catch (err) {
      verificationCounter.inc({ result: 'error' });
      const error = asRouteError(err);
      logger.error('zk_verify_error', { error: error.message });
      sendRouteError(res, error, 'ZK_VERIFY_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/tee-attest — Submit TEE attestation
// ---------------------------------------------------------------------------
const teeAttestSchema = z.object({
  enclaveType: z.enum(['SGX']),
  quote: z.string().min(100).max(10000),
  userData: z.string().optional(),
});

router.post(
  '/tee-attest',
  verificationLimiter,
  validate({ body: teeAttestSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { enclaveType, quote, userData } = req.body;

      const result = await teeService.verifyAttestation({
        identityId: identity.id,
        did: identity.did,
        publicKey: identity.publicKey,
        enclaveType,
        quote,
        userData,
      });

      res.json({
        data: {
          attestationId: result.attestationId,
          verified: result.verified,
          enclaveType: result.enclaveType,
          tcbStatus: result.tcbStatus,
          advisoryIds: result.advisoryIds,
          timestamp: result.timestamp,
          expiresAt: result.expiresAt,
        },
        message: 'TEE attestation verified successfully',
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error('tee_attestation_error', { error: error.message });
      sendRouteError(res, error, 'TEE_ATTESTATION_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/verification/circuits — List available ZK circuits
// ---------------------------------------------------------------------------
router.get('/circuits', (_req: AuthenticatedRequest, res: Response): void => {
  const circuits = zkProofService.listCircuits();
  res.json({ data: circuits });
});

// ---------------------------------------------------------------------------
// GET /api/v1/verification/history — Get verification history
// ---------------------------------------------------------------------------
const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['ZK_PROOF', 'TEE_ATTESTATION', 'CREDENTIAL_CHECK']).optional(),
  result: z.enum(['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED']).optional(),
});

router.get(
  '/history',
  validate({ query: historyQuerySchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { page, limit, type, result } = req.query as unknown as z.infer<
        typeof historyQuerySchema
      >;

      const where: Record<string, unknown> = {
        OR: [{ verifierId: identity.id }, { subjectId: identity.id }],
      };
      if (type) where.verificationType = type;
      if (result) where.result = result;

      const [verifications, total] = await Promise.all([
        prisma.verification.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            verificationType: true,
            result: true,
            requestedAt: true,
            completedAt: true,
            credentialId: true,
            verifierId: true,
            subjectId: true,
          },
        }),
        prisma.verification.count({ where }),
      ]);

      res.json({
        data: verifications,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      sendRouteError(res, asRouteError(err), 'VERIFICATION_HISTORY_FAILED');
    }
  },
);

export { router as verificationRoutes };
