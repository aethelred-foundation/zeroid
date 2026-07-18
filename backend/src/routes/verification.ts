import { Router, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { validate, uuidSchema } from '../middleware/validation';
import { verificationLimiter } from '../middleware/rateLimit';
import {
  zkProofService,
  type PublicSignalSchemaValidation,
} from '../services/zkproof';
import { teeService } from '../services/tee';
import { credentialService } from '../services/credential';
import { prisma, logger, redis, verificationCounter } from '../runtime';
import { createHash, randomUUID } from 'crypto';
import { asRouteError, sendRouteError } from '../utils/route-error';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants for proof binding
// ---------------------------------------------------------------------------
const PROOF_NONCE_TTL_SECONDS = 300; // Nonces are valid for 5 minutes
const PROOF_REPLAY_WINDOW_SECONDS = 86400; // Track used proofs for 24 hours
const MAX_PROOF_AGE_MS = 5 * 60 * 1000; // Proofs expire after 5 minutes
const PROOF_VERIFICATION_LOCK_TTL_SECONDS = 30;
const MAX_PUBLIC_SIGNALS = 128;
const MAX_PUBLIC_SIGNAL_LENGTH = 512;
const MAX_CONTEXT_COMMITMENT_LENGTH = 128;
const ZEROID_ELIGIBILITY_POLICY_V1 = {
  policyId:
    'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1',
  version: '2026.06.1',
  requireNonRevocationProof: true,
  circuitManifest: {
    circuitId: 'zkc_eligibility_policy_context_v1',
    circuitName: 'eligibility_policy_context_v1',
    verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
    manifestPath: 'circuits/manifest/eligibility_v1.json',
    manifestDigest:
      '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5',
    sourceDigest:
      '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3',
    policyBindingDigest:
      '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c',
    artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
    publicSignals: [
      'claimsHash',
      'ageThresholdYears',
      'residencyCountryCode',
      'currentTimestamp',
      'policyVersionHash',
      'contextCommitment',
    ],
  },
} as const;

type ProofNonceRecord = {
  audience?: unknown;
  nonce?: unknown;
  subjectId?: unknown;
  credentialId?: unknown;
  requestId?: unknown;
  issuedAt?: unknown;
  claimsHashField?: unknown;
  contextCommitmentField?: unknown;
  publicSignalValues?: unknown;
};

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

function proofNonceScopedKey(prefix: string, nonce: string): string {
  const nonceDigest = createHash('sha256').update(nonce).digest('hex');
  return `${prefix}:${nonceDigest}`;
}

function isContextBoundCircuit(circuitName: string): boolean {
  return zkProofService.isCircuitContextBound(circuitName);
}

function rejectUnboundCircuitIfNeeded(
  circuitName: string,
  res: Response,
): boolean {
  if (isContextBoundCircuit(circuitName)) {
    return false;
  }

  res.status(503).json({
    error:
      'ZK circuit is not approved for context-bound production verification',
    code: 'ZK_CIRCUIT_CONTEXT_BINDING_UNSUPPORTED',
  });
  return true;
}

function proofSignalValidationError(
  validation: PublicSignalSchemaValidation,
  statusCode = validation.statusCode ?? 400,
): Error & { code?: string; statusCode?: number } {
  const error = new Error(
    validation.error ?? 'Proof public signals failed schema validation',
  ) as Error & { code?: string; statusCode?: number };
  error.code = validation.code ?? 'PROOF_SIGNALS_SCHEMA_INVALID';
  error.statusCode = statusCode;
  return error;
}

function sendProofSignalValidationFailure(
  res: Response,
  validation: PublicSignalSchemaValidation,
): void {
  const error = proofSignalValidationError(validation);
  res.status(error.statusCode ?? 400).json({
    error: error.message,
    code: error.code,
  });
}

function buildRouteError(
  message: string,
  code: string,
  statusCode = 400,
): Error & { code?: string; statusCode?: number } {
  const error = new Error(message) as Error & {
    code?: string;
    statusCode?: number;
  };
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizePublicSignalValue(
  value: string | number,
  signalName: string,
): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw buildRouteError(
        `Public signal ${signalName} must be a non-negative safe integer`,
        'PROOF_PUBLIC_SIGNAL_PARAMETER_INVALID',
      );
    }
    return value.toString();
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed) || /^0x[0-9a-f]+$/i.test(trimmed)) {
    return BigInt(trimmed).toString();
  }

  throw buildRouteError(
    `Public signal ${signalName} must be a decimal or hexadecimal field value`,
    'PROOF_PUBLIC_SIGNAL_PARAMETER_INVALID',
  );
}

function resolvePublicSignalInputValue(
  signalName: string,
  inputs: Record<string, string | number>,
): string {
  const aliases =
    signalName === 'ageThresholdYears'
      ? ['ageThresholdYears', 'ageThreshold', 'threshold']
      : [signalName];
  const values = aliases
    .filter((alias) => Object.prototype.hasOwnProperty.call(inputs, alias))
    .map((alias) => normalizePublicSignalValue(inputs[alias], signalName));
  const uniqueValues = [...new Set(values)];

  if (uniqueValues.length === 0) {
    throw buildRouteError(
      `Missing proof parameter for public signal: ${signalName}`,
      'PROOF_PUBLIC_SIGNAL_PARAMETER_MISSING',
    );
  }

  if (uniqueValues.length > 1) {
    throw buildRouteError(
      `Conflicting proof parameters for public signal: ${signalName}`,
      'PROOF_PUBLIC_SIGNAL_PARAMETER_CONFLICT',
    );
  }

  return uniqueValues[0];
}

function buildExpectedPublicSignalValues(
  circuitName: string,
  inputs: Record<string, string | number>,
  commitments: { claimsHash: string; contextCommitment: string },
): Record<string, string> {
  const schema = zkProofService.getCircuitPublicSignalSchema(circuitName);
  if (!schema) {
    throw buildRouteError(
      `Unknown circuit: ${circuitName}`,
      'ZK_UNKNOWN_CIRCUIT',
    );
  }

  const values: Record<string, string> = {};
  for (const signalName of schema) {
    if (signalName === 'claimsHash') {
      values[signalName] = commitments.claimsHash;
    } else if (signalName === 'contextCommitment') {
      values[signalName] = commitments.contextCommitment;
    } else {
      values[signalName] = resolvePublicSignalInputValue(signalName, inputs);
    }
  }

  return values;
}

function parseNoncePublicSignalValues(
  value: unknown,
): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (entries.some(([, entryValue]) => typeof entryValue !== 'string')) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function isCredentialExpired(
  expiresAt: Date | string | null | undefined,
): boolean {
  if (!expiresAt) return false;
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Number.isNaN(date.getTime()) || date <= new Date();
}

function eligibilityReceiptLookupWhere(
  identityId: string,
  receiptId: string,
): Prisma.VerificationWhereInput {
  return {
    verificationType: 'ELIGIBILITY_PROOF',
    AND: [
      {
        OR: [{ verifierId: identityId }, { subjectId: identityId }],
      },
      {
        OR: [
          { id: receiptId },
          { resultDetails: { path: ['decisionId'], equals: receiptId } },
          { zkProofData: { path: ['proofId'], equals: receiptId } },
        ],
      },
    ],
  };
}

const storedGroth16ProofSchema = z
  .object({
    pi_a: z
      .array(z.string().min(1).max(MAX_PUBLIC_SIGNAL_LENGTH))
      .min(2)
      .max(8),
    pi_b: z
      .array(
        z.array(z.string().min(1).max(MAX_PUBLIC_SIGNAL_LENGTH)).min(2).max(8),
      )
      .min(2)
      .max(8),
    pi_c: z
      .array(z.string().min(1).max(MAX_PUBLIC_SIGNAL_LENGTH))
      .min(2)
      .max(8),
    protocol: z.literal('groth16'),
    curve: z.enum(['bn128', 'bn254']),
  })
  .passthrough();

const storedEligibilityProofSchema = z
  .object({
    proofId: z.string().uuid(),
    circuitId: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitId,
    ),
    circuitName: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.circuitName,
    ),
    verificationKeyId: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.verificationKeyId,
    ),
    manifestDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestDigest,
    ),
    sourceDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.sourceDigest,
    ),
    policyBindingDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.policyBindingDigest,
    ),
    artifactStatus: z.literal('PINNED_PRODUCTION_ARTIFACTS'),
    contextHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
    receiptHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
    receiptHashAlgorithm: z.literal('sha256-canonical-json-v1'),
    publicSignals: z
      .array(z.string().min(1).max(MAX_PUBLIC_SIGNAL_LENGTH))
      .length(
        ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.publicSignals.length,
      ),
    proof: storedGroth16ProofSchema,
    proofVerification: z.object({
      valid: z.literal(true),
      proofSystem: z.literal('groth16'),
      verifiedAt: z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value))),
    }),
  })
  .passthrough();

const storedEligibilityDetailsSchema = z
  .object({
    status: z.enum(['ALLOWED', 'DENIED']),
    decisionId: z.string().min(1).max(128),
    policyId: z.literal(ZEROID_ELIGIBILITY_POLICY_V1.policyId),
    policyVersion: z.literal(ZEROID_ELIGIBILITY_POLICY_V1.version),
    relyingAppId: z.string().min(1).max(128),
    receiptHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
    receiptHashAlgorithm: z.literal('sha256-canonical-json-v1'),
    manifestPath: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestPath,
    ),
    manifestDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.manifestDigest,
    ),
    sourceDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.sourceDigest,
    ),
    policyBindingDigest: z.literal(
      ZEROID_ELIGIBILITY_POLICY_V1.circuitManifest.policyBindingDigest,
    ),
    artifactStatus: z.literal('PINNED_PRODUCTION_ARTIFACTS'),
  })
  .passthrough();

type StoredEligibilityReceipt = {
  id: string;
  credentialId?: string | null;
  verifierId: string;
  subjectId: string;
  result: unknown;
  requestedAt: Date;
  completedAt?: Date | null;
  zkProofData?: unknown;
  teeAttestation?: unknown;
  resultDetails?: unknown;
};

type ValidStoredEligibilityReceipt = {
  proof: z.infer<typeof storedEligibilityProofSchema>;
  details: z.infer<typeof storedEligibilityDetailsSchema>;
};

function validateStoredEligibilityReceipt(
  record: StoredEligibilityReceipt,
):
  | { valid: true; data: ValidStoredEligibilityReceipt }
  | { valid: false; code: string; error: string } {
  const proof = asRecord(record.zkProofData);
  const details = asRecord(record.resultDetails);
  const evaluation = asRecord(details.evaluation);

  if (
    evaluation.onchainAttested === true ||
    typeof proof.onchainTxHash === 'string'
  ) {
    return {
      valid: false,
      code: 'ELIGIBILITY_RECEIPT_EVIDENCE_INVALID',
      error: 'Eligibility receipt contains unsupported legacy evidence',
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(details, 'evaluation') ||
    Object.prototype.hasOwnProperty.call(proof, 'disclosurePolicy')
  ) {
    return {
      valid: false,
      code: 'ELIGIBILITY_RECEIPT_LEGACY_UNSUPPORTED',
      error:
        'Eligibility receipt predates cryptographically verified predicate evidence',
    };
  }

  if (
    proof.artifactStatus !== 'PINNED_PRODUCTION_ARTIFACTS' ||
    details.artifactStatus !== 'PINNED_PRODUCTION_ARTIFACTS'
  ) {
    return {
      valid: false,
      code: 'ELIGIBILITY_RECEIPT_ARTIFACTS_NOT_READY',
      error:
        'Eligibility receipt does not reference pinned production circuit artifacts',
    };
  }

  const parsedProof = storedEligibilityProofSchema.safeParse(proof);
  const parsedDetails = storedEligibilityDetailsSchema.safeParse(details);
  if (!parsedProof.success || !parsedDetails.success) {
    return {
      valid: false,
      code: 'ELIGIBILITY_RECEIPT_PROOF_INVALID',
      error:
        'Eligibility receipt does not contain verified Groth16 proof evidence',
    };
  }

  if (
    record.result !== 'VERIFIED' ||
    parsedProof.data.receiptHash !== parsedDetails.data.receiptHash
  ) {
    return {
      valid: false,
      code: 'ELIGIBILITY_RECEIPT_PROOF_INVALID',
      error: 'Eligibility receipt proof verification state is inconsistent',
    };
  }

  return {
    valid: true,
    data: {
      proof: parsedProof.data,
      details: parsedDetails.data,
    },
  };
}

function buildEligibilityReceiptEvidenceBundle(
  record: StoredEligibilityReceipt,
  validated: ValidStoredEligibilityReceipt,
) {
  const { proof, details } = validated;

  return {
    verificationId: record.id,
    status: details.status,
    decisionId: details.decisionId,
    policyId: details.policyId,
    policyVersion: details.policyVersion,
    credentialId: record.credentialId ?? undefined,
    verifierId: record.verifierId,
    subjectId: record.subjectId,
    relyingAppId: details.relyingAppId,
    proof: {
      proofId: proof.proofId,
      circuitId: proof.circuitId,
      circuitName: proof.circuitName,
      verificationKeyId: proof.verificationKeyId,
      proofSystem: proof.proofVerification.proofSystem,
      groth16Proof: proof.proof,
      publicSignals: proof.publicSignals,
      contextHash: proof.contextHash,
      cryptographicallyVerified: proof.proofVerification.valid,
      verifiedAt: proof.proofVerification.verifiedAt,
    },
    evidence: {
      receiptHash: proof.receiptHash,
      receiptHashAlgorithm: proof.receiptHashAlgorithm,
      manifestPath: details.manifestPath,
      manifestDigest: proof.manifestDigest,
      sourceDigest: proof.sourceDigest,
      policyBindingDigest: proof.policyBindingDigest,
      artifactStatus: proof.artifactStatus,
      teeAttestation: asRecord(record.teeAttestation),
    },
    requestedAt: record.requestedAt.toISOString(),
    completedAt: record.completedAt?.toISOString(),
  };
}

function validateEligibilityCircuitBinding(
  policy: typeof ZEROID_ELIGIBILITY_POLICY_V1,
): { code: string; error: string } {
  const artifactsPinned =
    String(policy.circuitManifest.artifactStatus) ===
    'PINNED_PRODUCTION_ARTIFACTS';
  if (!artifactsPinned && process.env.NODE_ENV !== 'test') {
    return {
      code: 'ZK_CIRCUIT_ARTIFACTS_NOT_READY',
      error: 'Eligibility proof requires a pinned production artifact manifest',
    };
  }

  const expectedSignals = [...policy.circuitManifest.publicSignals];
  const registrySignals = zkProofService.getCircuitPublicSignalSchema(
    policy.circuitManifest.circuitName,
  );

  if (!registrySignals) {
    return {
      code: 'ZK_CIRCUIT_MANIFEST_UNKNOWN',
      error: 'Eligibility circuit is not registered with the ZK proof service',
    };
  }

  if (registrySignals.join('\u0000') !== expectedSignals.join('\u0000')) {
    return {
      code: 'ZK_CIRCUIT_SCHEMA_MISMATCH',
      error:
        'Eligibility circuit registry schema does not match the pinned policy manifest',
    };
  }

  if (
    !zkProofService.isCircuitContextBound(policy.circuitManifest.circuitName)
  ) {
    return {
      code: 'ZK_CIRCUIT_ARTIFACTS_NOT_READY',
      error: 'Eligibility proof requires pinned context-bound ZK artifacts',
    };
  }

  return {
    code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
    error:
      'Eligibility proof issuance is unavailable until the signed credential witness is connected to Groth16 generation and verification',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function didValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  const record = asRecord(value);
  return typeof record.uri === 'string' && record.uri.trim().length > 0
    ? record.uri.trim()
    : undefined;
}

const storedVerificationRequestDetailsSchema = z
  .object({
    verifierDid: z.string().min(1),
    subjectDid: z.string().min(1),
    credentialHash: z.string().min(1).max(256),
    requestedAttributes: z.array(z.string().min(1).max(128)),
    circuitId: z.string().min(1).max(128),
    expiresAt: z.number().int().positive().safe(),
    purpose: z.string().min(1).max(1000),
    userConsent: z.boolean(),
    verifierName: z.string().min(1).max(160).optional(),
    requiredCredentials: z.array(z.string().min(1).max(160)).optional(),
    requiredAttributes: z.array(z.unknown()).optional(),
  })
  .passthrough();

type StoredVerificationRequestDetails = z.infer<
  typeof storedVerificationRequestDetailsSchema
>;

type OwnedVerificationRequest = {
  id: string;
  verifierId: string;
  subjectId: string;
  verificationType: string;
  result: unknown;
  requestedAt: Date;
  completedAt: Date | null;
  resultDetails: unknown;
  verifier: { id: string; did: string };
  subject: { id: string; did: string };
  details: StoredVerificationRequestDetails;
};

function parseStoredVerificationRequestDetails(
  value: unknown,
): StoredVerificationRequestDetails {
  const parsed = storedVerificationRequestDetailsSchema.safeParse(value);
  if (!parsed.success) {
    throw buildRouteError(
      'Stored verification request metadata is malformed',
      'VERIFICATION_REQUEST_RECORD_INVALID',
      500,
    );
  }
  return parsed.data;
}

function unixSeconds(value: Date | string | number): number {
  if (typeof value === 'number') {
    const seconds =
      value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
    if (Number.isSafeInteger(seconds) && seconds > 0) return seconds;
    throw buildRouteError(
      'Stored verification request timestamp is invalid',
      'VERIFICATION_REQUEST_RECORD_INVALID',
      500,
    );
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw buildRouteError(
      'Stored verification request timestamp is invalid',
      'VERIFICATION_REQUEST_RECORD_INVALID',
      500,
    );
  }
  return Math.floor(date.getTime() / 1000);
}

function verificationStatusToClientStatus(result: unknown): string {
  if (result === 'PENDING') return 'pending';
  if (result === 'VERIFIED') return 'completed';
  if (result === 'FAILED') return 'failed';
  if (result === 'EXPIRED') return 'expired';
  throw buildRouteError(
    'Stored verification request status is invalid',
    'VERIFICATION_REQUEST_RECORD_INVALID',
    500,
  );
}

function buildVerificationRequestResponse(record: {
  id: string;
  result: unknown;
  requestedAt: Date;
  completedAt?: Date | null;
  resultDetails?: unknown;
  verifier?: { did: string } | null;
  subject?: { did: string } | null;
}) {
  const details = parseStoredVerificationRequestDetails(record.resultDetails);
  const createdAt = unixSeconds(record.requestedAt);
  const status =
    record.result === 'PENDING' &&
    details.expiresAt <= Math.floor(Date.now() / 1000)
      ? 'expired'
      : verificationStatusToClientStatus(record.result);
  return {
    id: record.id,
    verifierDid: record.verifier?.did ?? details.verifierDid,
    subjectDid: record.subject?.did ?? details.subjectDid,
    credentialHash: details.credentialHash,
    requestedAttributes: details.requestedAttributes,
    circuitId: details.circuitId,
    status,
    createdAt,
    expiresAt: details.expiresAt,
    purpose: details.purpose,
    userConsent: details.userConsent,
    verifierName: details.verifierName,
    requiredCredentials: details.requiredCredentials,
    requiredAttributes: details.requiredAttributes,
  };
}

async function expirePendingVerificationRequest(
  request: Omit<OwnedVerificationRequest, 'details'>,
  details: StoredVerificationRequestDetails,
): Promise<boolean> {
  const completedAt = new Date();
  const resultDetails = {
    ...details,
    userConsent: false,
    response: {
      outcome: 'expired',
      respondedAt: completedAt.toISOString(),
    },
  } as unknown as Prisma.InputJsonObject;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.verification.updateMany({
      where: {
        id: request.id,
        subjectId: request.subjectId,
        verificationType: 'PROOF_REQUEST',
        result: 'PENDING',
      },
      data: {
        result: 'EXPIRED',
        resultDetails,
        completedAt,
      },
    });
    if (updated.count !== 1) return false;

    await tx.auditLog.create({
      data: {
        identityId: request.subjectId,
        action: 'VERIFICATION_FAILED',
        resourceType: 'verification_request',
        resourceId: request.id,
        details: {
          outcome: 'expired',
          verifierId: request.verifierId,
          expiresAt: details.expiresAt,
        },
      },
    });
    return true;
  });
}

async function getOwnedPendingVerificationRequest(
  requestId: string,
  subjectId: string,
): Promise<OwnedVerificationRequest> {
  const request = await prisma.verification.findUnique({
    where: { id: requestId },
    include: {
      verifier: { select: { id: true, did: true } },
      subject: { select: { id: true, did: true } },
    },
  });

  if (
    !request ||
    request.verificationType !== 'PROOF_REQUEST' ||
    request.subjectId !== subjectId
  ) {
    throw buildRouteError(
      'Verification request was not found',
      'VERIFICATION_REQUEST_NOT_FOUND',
      404,
    );
  }

  const details = parseStoredVerificationRequestDetails(request.resultDetails);
  if (request.result === 'EXPIRED') {
    throw buildRouteError(
      'Verification request has expired',
      'VERIFICATION_REQUEST_EXPIRED',
      410,
    );
  }
  if (request.result !== 'PENDING') {
    throw buildRouteError(
      'Verification request has already been resolved',
      'VERIFICATION_REQUEST_ALREADY_RESOLVED',
      409,
    );
  }

  if (details.expiresAt <= Math.floor(Date.now() / 1000)) {
    const expired = await expirePendingVerificationRequest(request, details);
    throw buildRouteError(
      expired
        ? 'Verification request has expired'
        : 'Verification request was resolved by another operation',
      expired
        ? 'VERIFICATION_REQUEST_EXPIRED'
        : 'VERIFICATION_REQUEST_ALREADY_RESOLVED',
      expired ? 410 : 409,
    );
  }

  return { ...request, details };
}

async function finalizeBoundVerificationRequest(
  request: OwnedVerificationRequest,
  evidence: {
    result: 'VERIFIED' | 'FAILED';
    proofId: string;
    credentialId: string;
    circuitName: string;
    nonce: string;
    audience: string;
    issuedAt: number;
    contextCommitment: string;
    publicSignals: string[];
  },
): Promise<Date> {
  const completedAt = new Date();
  const outcome = evidence.result === 'VERIFIED' ? 'verified' : 'proof_invalid';
  const resultDetails = {
    ...request.details,
    userConsent: true,
    response: {
      outcome,
      proofId: evidence.proofId,
      respondedAt: completedAt.toISOString(),
    },
  } as unknown as Prisma.InputJsonObject;
  const zkProofData = {
    proofId: evidence.proofId,
    requestId: request.id,
    credentialId: evidence.credentialId,
    circuitName: evidence.circuitName,
    nonce: evidence.nonce,
    audience: evidence.audience,
    issuedAt: evidence.issuedAt,
    contextCommitment: evidence.contextCommitment,
    publicSignals: evidence.publicSignals,
  } as Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.verification.updateMany({
      where: {
        id: request.id,
        subjectId: request.subjectId,
        verifierId: request.verifierId,
        verificationType: 'PROOF_REQUEST',
        result: 'PENDING',
      },
      data: {
        credentialId: evidence.credentialId,
        result: evidence.result,
        resultDetails,
        zkProofData,
        completedAt,
      },
    });
    if (updated.count !== 1) {
      throw buildRouteError(
        'Verification request was resolved by another operation',
        'VERIFICATION_REQUEST_ALREADY_RESOLVED',
        409,
      );
    }

    await tx.auditLog.create({
      data: {
        identityId: request.subjectId,
        action:
          evidence.result === 'VERIFIED'
            ? 'VERIFICATION_COMPLETED'
            : 'VERIFICATION_FAILED',
        resourceType: 'verification_request',
        resourceId: request.id,
        details: {
          outcome,
          verifierId: request.verifierId,
          credentialId: evidence.credentialId,
          proofId: evidence.proofId,
          circuitName: evidence.circuitName,
          nonce: evidence.nonce,
        },
      },
    });
  });

  return completedAt;
}

const router = Router();
router.use(verificationLimiter);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/zk-proof — Generate a ZK proof for a credential
// ---------------------------------------------------------------------------
const generateZKProofSchema = z.object({
  credentialId: uuidSchema,
  requestId: uuidSchema.optional(),
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
    let reservedNonceKey: string | undefined;

    try {
      const identity = req.identity!;
      const {
        credentialId,
        requestId,
        circuitName,
        inputs,
        selectiveDisclosure,
        audience,
      } = req.body;
      const nonce: string = req.body.nonce ?? randomUUID();

      if (rejectUnboundCircuitIfNeeded(circuitName, res)) {
        return;
      }

      const boundRequest = requestId
        ? await getOwnedPendingVerificationRequest(requestId, identity.id)
        : undefined;
      if (boundRequest) {
        if (boundRequest.details.circuitId !== circuitName) {
          res.status(400).json({
            error:
              'Proof circuit does not match the verification request circuit',
            code: 'VERIFICATION_REQUEST_CIRCUIT_MISMATCH',
          });
          return;
        }
        if (
          audience !== boundRequest.verifier.id &&
          audience !== boundRequest.verifier.did
        ) {
          res.status(403).json({
            error:
              'Proof audience does not match the verification request verifier',
            code: 'VERIFICATION_REQUEST_AUDIENCE_MISMATCH',
          });
          return;
        }

        const expectedAttributes = [
          ...boundRequest.details.requestedAttributes,
        ].sort();
        const selectedAttributes = [...(selectiveDisclosure ?? [])].sort();
        if (
          expectedAttributes.length !== selectedAttributes.length ||
          expectedAttributes.some(
            (attribute, index) => attribute !== selectedAttributes[index],
          )
        ) {
          res.status(400).json({
            error:
              'Selective disclosure fields do not match the verification request',
            code: 'VERIFICATION_REQUEST_ATTRIBUTES_MISMATCH',
          });
          return;
        }
      }

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
      if (
        credential.status !== 'ACTIVE' ||
        isCredentialExpired(credential.expiresAt)
      ) {
        res.status(400).json({
          error: 'Credential is not active or has expired',
          code: 'CRED_NOT_ACTIVE',
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
      if (
        boundRequest &&
        boundRequest.details.credentialHash
          .replace(/^0x/i, '')
          .toLowerCase() !==
          credential.claimsHash.replace(/^0x/i, '').toLowerCase()
      ) {
        res.status(400).json({
          error:
            'Credential commitment does not match the verification request',
          code: 'VERIFICATION_REQUEST_CREDENTIAL_MISMATCH',
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
      const proofCurrentTimestamp = Math.floor(issuedAt / 1000);
      const publicSignalValues = buildExpectedPublicSignalValues(
        circuitName,
        {
          ...inputs,
          currentTimestamp: proofCurrentTimestamp,
        },
        {
          claimsHash: claimsHashField,
          contextCommitment: contextCommitmentField,
        },
      );

      // Reserve the nonce before expensive proof generation. SET NX prevents
      // callers from overwriting another in-flight proof context with the same
      // user-supplied nonce.
      reservedNonceKey = proofNonceScopedKey('proof:nonce', nonce);
      const nonceReserved = await redis.set(
        reservedNonceKey,
        JSON.stringify({
          nonce,
          audience,
          subjectId: identity.id,
          credentialId,
          ...(boundRequest ? { requestId: boundRequest.id } : {}),
          issuedAt,
          claimsHashField,
          contextCommitmentField,
          publicSignalValues,
        }),
        'EX',
        PROOF_NONCE_TTL_SECONDS,
        'NX',
      );
      if (nonceReserved !== 'OK') {
        res.status(409).json({
          error: 'Nonce is already bound to an active proof context',
          code: 'PROOF_NONCE_COLLISION',
        });
        return;
      }

      const witnessInputs: Record<string, string | number> = {
        ...publicSignalValues,
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
        'ageThresholdYears',
        'incomeMin',
        'incomeMax',
        'nationalitySet',
      ];
      for (const [key, value] of Object.entries(inputs)) {
        if (allowedParams.includes(key)) {
          const witnessKey =
            key === 'threshold' || key === 'ageThreshold'
              ? 'ageThresholdYears'
              : key;
          if (
            !Object.prototype.hasOwnProperty.call(witnessInputs, witnessKey)
          ) {
            witnessInputs[witnessKey] = value as string | number;
          }
        }
      }

      const result = await zkProofService.generateProof({
        circuitName,
        inputs: witnessInputs,
        credentialId,
        selectiveDisclosure,
      });

      const generatedSignalValidation =
        zkProofService.validateContextBoundPublicSignals(
          circuitName,
          result.publicSignals,
          {
            claimsHash: claimsHashField,
            contextCommitment: contextCommitmentField,
            publicSignals: publicSignalValues,
          },
        );
      if (!generatedSignalValidation.valid) {
        throw proofSignalValidationError(generatedSignalValidation, 500);
      }

      // Create verification record
      await prisma.verification.create({
        data: {
          credentialId,
          verifierId: identity.id,
          subjectId: identity.id,
          verificationType: 'ZK_PROOF',
          zkProofData: {
            proofId: result.proofId,
            ...(boundRequest ? { requestId: boundRequest.id } : {}),
            circuitName: result.circuitName,
            publicSignals: result.publicSignals,
            nonce,
            audience,
            claimsHash: claimsHashField,
            contextCommitment: contextCommitmentField,
            publicSignalValues,
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
          ...(boundRequest ? { requestId: boundRequest.id } : {}),
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
          publicSignalValues,
        },
        message: 'ZK proof generated successfully',
      });
    } catch (err) {
      verificationCounter.inc({ result: 'failed' });
      const error = asRouteError(err);
      logger.error('zk_proof_generation_error', { error: error.message });
      if (reservedNonceKey) {
        await redis.del(reservedNonceKey).catch((releaseError: Error) => {
          logger.warn('proof_nonce_reservation_release_failed', {
            nonceKey: reservedNonceKey,
            error: releaseError.message,
          });
        });
      }
      sendRouteError(res, error, 'ZK_PROOF_GENERATION_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/zk-verify — Verify a ZK proof
// ---------------------------------------------------------------------------
const verifyZKProofSchema = z.object({
  requestId: uuidSchema.optional(),
  proof: z.object({
    pi_a: z.array(z.string().max(MAX_PUBLIC_SIGNAL_LENGTH)).max(8),
    pi_b: z
      .array(z.array(z.string().max(MAX_PUBLIC_SIGNAL_LENGTH)).max(8))
      .max(8),
    pi_c: z.array(z.string().max(MAX_PUBLIC_SIGNAL_LENGTH)).max(8),
    protocol: z.string().min(1).max(32),
    curve: z.string().min(1).max(32),
  }),
  publicSignals: z
    .array(z.string().min(1).max(MAX_PUBLIC_SIGNAL_LENGTH))
    .min(1)
    .max(MAX_PUBLIC_SIGNALS),
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
    .max(MAX_CONTEXT_COMMITMENT_LENGTH)
    .describe('Context commitment field element from proof generation'),
  issuedAt: z.number().int().positive().describe('Proof issuance timestamp'),
});

router.post(
  '/zk-verify',
  verificationLimiter,
  validate({ body: verifyZKProofSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    let verificationLockKey: string | undefined;
    let verificationLockAcquired = false;

    try {
      const {
        proof,
        publicSignals,
        circuitName,
        nonce,
        audience,
        contextCommitment,
        issuedAt,
        requestId,
      } = req.body;
      const actor = req.identity!;

      if (rejectUnboundCircuitIfNeeded(circuitName, res)) {
        return;
      }

      const boundRequest = requestId
        ? await getOwnedPendingVerificationRequest(requestId, actor.id)
        : undefined;
      if (boundRequest && boundRequest.details.circuitId !== circuitName) {
        res.status(400).json({
          error:
            'Proof circuit does not match the verification request circuit',
          code: 'VERIFICATION_REQUEST_CIRCUIT_MISMATCH',
        });
        return;
      }
      const intendedVerifier = boundRequest?.verifier ?? actor;

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
      if (
        audience !== intendedVerifier.id &&
        audience !== intendedVerifier.did
      ) {
        logger.warn('proof_audience_mismatch', {
          expected: audience,
          actual: intendedVerifier.id,
          actor: actor.id,
          requestId,
          nonce,
        });
        res.status(403).json({
          error: 'Proof was not issued for this verifier',
          code: 'PROOF_AUDIENCE_MISMATCH',
        });
        return;
      }

      // 3. Fast replay check — confirmed again after acquiring the nonce lock.
      const replayKey = proofNonceScopedKey('proof:used', nonce);
      const alreadyUsed = await redis.get(replayKey);
      if (alreadyUsed) {
        logger.warn('proof_replay_detected', { nonce, actor: actor.id });
        res.status(409).json({
          error: 'Proof has already been verified (replay)',
          code: 'PROOF_REPLAY',
        });
        return;
      }

      // 4. Serialize verification per nonce. Without this lock, two
      // concurrent requests can both observe an unused nonce and both pass
      // before either one writes proof:used:<nonce>.
      verificationLockKey = proofNonceScopedKey('proof:verify-lock', nonce);
      const lockResult = await redis.set(
        verificationLockKey,
        JSON.stringify({
          actor: actor.id,
          verifier: intendedVerifier.id,
          requestId,
          lockedAt: Date.now(),
        }),
        'EX',
        PROOF_VERIFICATION_LOCK_TTL_SECONDS,
        'NX',
      );
      if (lockResult !== 'OK') {
        res.status(409).json({
          error: 'Proof verification is already in progress for this nonce',
          code: 'PROOF_VERIFICATION_IN_PROGRESS',
        });
        return;
      }
      verificationLockAcquired = true;

      const replayAfterLock = await redis.get(replayKey);
      if (replayAfterLock) {
        logger.warn('proof_replay_detected_after_lock', {
          nonce,
          actor: actor.id,
          requestId,
        });
        res.status(409).json({
          error: 'Proof has already been verified (replay)',
          code: 'PROOF_REPLAY',
        });
        return;
      }

      // 5. Validate nonce was actually issued by our system. This lookup is
      // intentionally inside the lock so a stale local nonce record cannot be
      // reused after another verifier has consumed and deleted it.
      const nonceKey = proofNonceScopedKey('proof:nonce', nonce);
      const nonceData = await redis.get(nonceKey);
      if (!nonceData) {
        logger.warn('proof_nonce_unknown', { nonce, actor: actor.id });
        res.status(400).json({
          error: 'Nonce not recognized or expired',
          code: 'PROOF_NONCE_INVALID',
        });
        return;
      }

      // 6. Verify context metadata and commitment integrity against the
      //    server-side nonce record. The HTTP metadata must match the nonce
      //    record that created the public context commitment; otherwise a
      //    valid proof for one audience/timestamp could be rebound to another
      //    verifier request while still passing the public-signal check.
      let nonceRecord: ProofNonceRecord;
      try {
        nonceRecord = JSON.parse(nonceData) as ProofNonceRecord;
      } catch {
        logger.warn('proof_nonce_record_parse_failed', {
          nonce,
          actor: actor.id,
        });
        res.status(400).json({
          error: 'Nonce record is malformed',
          code: 'PROOF_NONCE_RECORD_INVALID',
        });
        return;
      }

      if (
        typeof nonceRecord.audience !== 'string' ||
        typeof nonceRecord.nonce !== 'string' ||
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
        boundRequest &&
        (nonceRecord.requestId !== boundRequest.id ||
          nonceRecord.subjectId !== boundRequest.subjectId)
      ) {
        res.status(400).json({
          error:
            'Proof nonce is not bound to this verification request and subject',
          code: 'VERIFICATION_REQUEST_NONCE_BINDING_INVALID',
        });
        return;
      }
      const noncePublicSignalValues = parseNoncePublicSignalValues(
        nonceRecord.publicSignalValues,
      );
      if (!noncePublicSignalValues) {
        res.status(400).json({
          error: 'Nonce record is missing public signal expectations',
          code: 'PROOF_NONCE_RECORD_INVALID',
        });
        return;
      }

      if (
        nonceRecord.nonce !== nonce ||
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
        credential.subjectId !== nonceRecord.subjectId ||
        isCredentialExpired(credential.expiresAt)
      ) {
        logger.warn('proof_credential_context_mismatch', {
          nonce,
          credentialId: nonceRecord.credentialId,
          credentialStatus: credential.status,
          credentialSubjectId: credential.subjectId,
          nonceSubjectId: nonceRecord.subjectId,
          credentialExpiresAt: credential.expiresAt,
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
      if (
        boundRequest &&
        boundRequest.details.credentialHash
          .replace(/^0x/i, '')
          .toLowerCase() !==
          credential.claimsHash.replace(/^0x/i, '').toLowerCase()
      ) {
        res.status(400).json({
          error:
            'Credential commitment does not match the verification request',
          code: 'VERIFICATION_REQUEST_CREDENTIAL_MISMATCH',
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

      if (
        noncePublicSignalValues.claimsHash !== expectedClaimsHashField ||
        noncePublicSignalValues.contextCommitment !== expectedCommitmentField
      ) {
        res.status(400).json({
          error:
            'Nonce public-signal expectations do not match the proof context',
          code: 'PROOF_PUBLIC_SIGNAL_CONTEXT_INVALID',
        });
        return;
      }

      // 7. Verify the ZK proof cryptographically
      const result = await zkProofService.verifyProof(
        proof,
        publicSignals,
        circuitName,
      );

      if (!result.valid) {
        verificationCounter.inc({ result: 'failed' });
        const completedAt = boundRequest
          ? await finalizeBoundVerificationRequest(boundRequest, {
              result: 'FAILED',
              proofId: result.proofId,
              credentialId: nonceRecord.credentialId,
              circuitName,
              nonce,
              audience,
              issuedAt,
              contextCommitment,
              publicSignals,
            })
          : new Date();
        res.json({
          data: {
            valid: false,
            proofId: result.proofId,
            circuitName,
            verifiedAt: completedAt.toISOString(),
            ...(boundRequest
              ? { requestId: boundRequest.id, status: 'failed' }
              : {}),
          },
        });
        return;
      }

      // 8. Enforce exact public-signal schema and context commitments. This
      // keeps the route aligned with the compiled circuit manifest before a
      // context-bound circuit is allowed into production.
      const signalValidation = zkProofService.validateContextBoundPublicSignals(
        circuitName,
        publicSignals,
        {
          claimsHash: expectedClaimsHashField,
          contextCommitment: expectedCommitmentField,
          publicSignals: noncePublicSignalValues,
        },
      );
      if (!signalValidation.valid) {
        logger.warn('proof_public_signal_schema_invalid', {
          nonce,
          circuitName,
          code: signalValidation.code,
          publicSignalsLength: publicSignals.length,
        });
        sendProofSignalValidationFailure(res, signalValidation);
        return;
      }

      const completedAt = boundRequest
        ? await finalizeBoundVerificationRequest(boundRequest, {
            result: 'VERIFIED',
            proofId: result.proofId,
            credentialId: nonceRecord.credentialId,
            circuitName,
            nonce,
            audience,
            issuedAt,
            contextCommitment,
            publicSignals,
          })
        : undefined;

      // 9. Mark nonce as consumed — prevents replay
      await redis.set(
        replayKey,
        JSON.stringify({
          actor: actor.id,
          verifier: intendedVerifier.id,
          requestId,
          verifiedAt: Date.now(),
        }),
        'EX',
        PROOF_REPLAY_WINDOW_SECONDS,
      );

      // Clean up the issuance nonce
      await redis.del(nonceKey);

      verificationCounter.inc({ result: 'success' });

      res.json({
        data: {
          valid: true,
          proofId: result.proofId,
          circuitName: result.circuitName,
          publicSignals: result.publicSignals,
          verifiedAt: completedAt ?? result.verifiedAt,
          ...(boundRequest
            ? { requestId: boundRequest.id, status: 'completed' }
            : {}),
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
    } finally {
      if (verificationLockAcquired && verificationLockKey) {
        await redis.del(verificationLockKey).catch((error: Error) => {
          logger.warn('proof_verification_lock_release_failed', {
            lockKey: verificationLockKey,
            error: error.message,
          });
        });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/tee-challenge — Issue one-time TEE challenge
// ---------------------------------------------------------------------------
router.post(
  '/tee-challenge',
  verificationLimiter,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const challenge = await teeService.issueAttestationChallenge({
        identityId: identity.id,
        did: identity.did,
        publicKey: identity.publicKey,
      });

      res.status(201).json({
        data: challenge,
        message: 'TEE attestation challenge issued successfully',
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error('tee_challenge_error', { error: error.message });
      sendRouteError(res, error, 'TEE_CHALLENGE_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/tee-attest — Submit TEE attestation
// ---------------------------------------------------------------------------
const teeAttestSchema = z.object({
  enclaveType: z.enum(['SGX']),
  quote: z.string().min(100).max(10000),
  challenge: z.string().min(32).max(128),
  userData: z.string().optional(),
});

router.post(
  '/tee-attest',
  verificationLimiter,
  validate({ body: teeAttestSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { enclaveType, quote, challenge, userData } = req.body;

      const result = await teeService.verifyAttestation({
        identityId: identity.id,
        did: identity.did,
        publicKey: identity.publicKey,
        enclaveType,
        quote,
        challenge,
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
// POST /api/v1/verification/eligibility-proof — Policy-bound KYC eligibility
// ---------------------------------------------------------------------------
const eligibilityProofSchema = z
  .object({
    subjectDid: z.string().min(1).max(256),
    credentialId: z.string().min(1).max(128),
    policyId: z.string().min(1).max(256),
    relyingAppId: z.string().min(1).max(128),
    contextNonce: z.string().min(8).max(128),
    options: z
      .object({
        requireOnchainAttestation: z.boolean().optional(),
        requireNonRevocationProof: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Exported for internal callers so every eligibility entry point fails closed
// behind the same artifact and prover-integration gate.
export async function eligibilityProofHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const identity = req.identity!;
  const parsedRequest = eligibilityProofSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    res.status(400).json({
      error: 'Eligibility proof request is invalid',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { subjectDid, policyId, options } = parsedRequest.data;
  const policy = ZEROID_ELIGIBILITY_POLICY_V1;

  if (policyId !== policy.policyId) {
    res.status(404).json({
      error: 'Requested eligibility policy is not available',
      code: 'POLICY_NOT_FOUND',
      details: { policyId },
    });
    return;
  }

  if (subjectDid !== identity.did) {
    res.status(403).json({
      error: 'Proof request subject does not match authenticated identity',
      code: 'CREDENTIAL_SUBJECT_MISMATCH',
    });
    return;
  }

  if (options?.dryRun === true) {
    res.status(400).json({
      error:
        'Eligibility dry-run evaluation is unavailable; use authenticated backend evidence',
      code: 'ELIGIBILITY_DRY_RUN_UNSUPPORTED',
    });
    return;
  }

  if (
    policy.requireNonRevocationProof &&
    options?.requireNonRevocationProof === false
  ) {
    res.status(400).json({
      error: 'The selected eligibility policy requires non-revocation evidence',
      code: 'ELIGIBILITY_POLICY_OPTION_CONFLICT',
    });
    return;
  }

  if (options?.requireOnchainAttestation === true) {
    res.status(501).json({
      error:
        'Eligibility on-chain attestation is unavailable until a transaction-backed verifier integration is configured',
      code: 'ELIGIBILITY_ONCHAIN_ATTESTATION_UNAVAILABLE',
    });
    return;
  }

  const circuitBinding = validateEligibilityCircuitBinding(policy);
  res.status(503).json({
    error: circuitBinding.error,
    code: circuitBinding.code,
    details: {
      policyId: policy.policyId,
      policyVersion: policy.version,
      circuitId: policy.circuitManifest.circuitId,
      circuitName: policy.circuitManifest.circuitName,
      verificationKeyId: policy.circuitManifest.verificationKeyId,
      manifestPath: policy.circuitManifest.manifestPath,
      manifestDigest: policy.circuitManifest.manifestDigest,
      artifactStatus: policy.circuitManifest.artifactStatus,
    },
  });
}

router.post(
  '/eligibility-proof',
  verificationLimiter,
  validate({ body: eligibilityProofSchema }),
  eligibilityProofHandler,
);

// ---------------------------------------------------------------------------
// GET /api/v1/verification/eligibility-proof/:receiptId — Retrieve receipt
// ---------------------------------------------------------------------------
const eligibilityReceiptParamsSchema = z.object({
  receiptId: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/, 'Invalid eligibility receipt id'),
});

router.get(
  '/eligibility-proof/:receiptId',
  validate({ params: eligibilityReceiptParamsSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { receiptId } = req.params as z.infer<
        typeof eligibilityReceiptParamsSchema
      >;

      const verification = await prisma.verification.findFirst({
        where: eligibilityReceiptLookupWhere(identity.id, receiptId),
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          credentialId: true,
          verifierId: true,
          subjectId: true,
          result: true,
          requestedAt: true,
          completedAt: true,
          zkProofData: true,
          teeAttestation: true,
          resultDetails: true,
        },
      });

      if (!verification) {
        res.status(404).json({
          error: 'Eligibility proof receipt was not found',
          code: 'ELIGIBILITY_RECEIPT_NOT_FOUND',
          details: { receiptId },
        });
        return;
      }

      const receiptValidation = validateStoredEligibilityReceipt(verification);
      if (!receiptValidation.valid) {
        res.status(503).json({
          error: receiptValidation.error,
          code: receiptValidation.code,
          details: { receiptId },
        });
        return;
      }

      if (process.env.NODE_ENV !== 'test') {
        const circuitBinding = validateEligibilityCircuitBinding(
          ZEROID_ELIGIBILITY_POLICY_V1,
        );
        res.status(503).json({
          error: circuitBinding.error,
          code: circuitBinding.code,
          details: { receiptId },
        });
        return;
      }

      const { proof: storedProof } = receiptValidation.data;
      const runtimeProofVerification = await zkProofService
        .verifyProof(
          storedProof.proof,
          storedProof.publicSignals,
          storedProof.circuitName,
        )
        .catch((error: Error) => {
          logger.warn('eligibility_receipt_reverification_failed', {
            receiptId,
            error: error.message,
          });
          return undefined;
        });
      if (!runtimeProofVerification?.valid) {
        res.status(503).json({
          error:
            'Eligibility receipt could not be cryptographically re-verified',
          code: 'ELIGIBILITY_RECEIPT_PROOF_INVALID',
          details: { receiptId },
        });
        return;
      }

      const auditLog = await prisma.auditLog.findFirst({
        where: {
          resourceType: 'eligibility_proof',
          resourceId: verification.id,
        },
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          timestamp: true,
          entryHash: true,
        },
      });
      if (
        !auditLog ||
        typeof auditLog.entryHash !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(auditLog.entryHash)
      ) {
        res.status(503).json({
          error: 'Eligibility receipt audit entry is missing or unsealed',
          code: 'ELIGIBILITY_AUDIT_SEAL_REQUIRED',
          details: { receiptId },
        });
        return;
      }
      const bundle = buildEligibilityReceiptEvidenceBundle(
        verification,
        receiptValidation.data,
      );

      res.json({
        data: {
          ...bundle,
          evidence: {
            ...bundle.evidence,
            auditLogId: auditLog.id,
            auditHash: `0x${auditLog.entryHash}`,
            auditTimestamp: auditLog.timestamp.toISOString(),
          },
        },
        message: 'Eligibility proof receipt loaded successfully',
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error('eligibility_receipt_get_error', { error: error.message });
      sendRouteError(res, error, 'ELIGIBILITY_RECEIPT_GET_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/requests — Create a verifier proof request
// ---------------------------------------------------------------------------
const createVerificationRequestSchema = z.object({
  subjectDid: z.union([z.string(), z.object({ uri: z.string() })]),
  credentialHash: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      'credentialHash must be a 32-byte 0x-prefixed commitment',
    ),
  requestedAttributes: z.array(z.string().min(1).max(128)).default([]),
  circuitId: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
  purpose: z.string().min(1).max(1000),
  verifierName: z.string().min(1).max(160).optional(),
  requiredCredentials: z.array(z.string().min(1).max(160)).optional(),
  requiredAttributes: z.array(z.unknown()).optional(),
});

router.post(
  '/requests',
  verificationLimiter,
  validate({ body: createVerificationRequestSchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const verifier = req.identity!;
      const subjectDid = didValue(req.body.subjectDid);
      if (!subjectDid) {
        res.status(400).json({
          error: 'subjectDid must be a DID string or { uri } object',
          code: 'VERIFICATION_REQUEST_SUBJECT_INVALID',
        });
        return;
      }

      const subject = await prisma.identity.findUnique({
        where: { did: subjectDid },
        select: { id: true, did: true, status: true },
      });
      if (!subject || subject.status !== 'ACTIVE') {
        res.status(404).json({
          error: 'Verification subject was not found or is not active',
          code: 'VERIFICATION_SUBJECT_NOT_FOUND',
          details: { subjectDid },
        });
        return;
      }

      const {
        credentialHash,
        requestedAttributes,
        circuitId,
        expiresAt,
        purpose,
        verifierName,
        requiredCredentials,
        requiredAttributes,
      } = req.body as z.infer<typeof createVerificationRequestSchema>;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (expiresAt <= nowSeconds) {
        res.status(400).json({
          error: 'Verification request expiry must be in the future',
          code: 'VERIFICATION_REQUEST_EXPIRY_INVALID',
        });
        return;
      }
      if (!zkProofService.getCircuitPublicSignalSchema(circuitId)) {
        res.status(400).json({
          error: 'Verification request circuit is not registered',
          code: 'VERIFICATION_REQUEST_CIRCUIT_UNKNOWN',
        });
        return;
      }
      if (!zkProofService.isCircuitContextBound(circuitId)) {
        res.status(503).json({
          error:
            'Verification requests require a context-bound production circuit',
          code: 'VERIFICATION_REQUEST_CIRCUIT_UNSUPPORTED',
        });
        return;
      }
      const requestDetails: Prisma.InputJsonObject = {
        verifierDid: verifier.did,
        subjectDid,
        credentialHash,
        requestedAttributes,
        circuitId,
        expiresAt,
        purpose,
        userConsent: false,
        ...(verifierName ? { verifierName } : {}),
        ...(requiredCredentials ? { requiredCredentials } : {}),
        ...(requiredAttributes
          ? {
              requiredAttributes: requiredAttributes as Prisma.InputJsonArray,
            }
          : {}),
      };

      const verification = await prisma.verification.create({
        data: {
          verifierId: verifier.id,
          subjectId: subject.id,
          verificationType: 'PROOF_REQUEST',
          result: 'PENDING',
          resultDetails: requestDetails,
        },
        include: {
          verifier: { select: { did: true } },
          subject: { select: { did: true } },
        },
      });

      await prisma.auditLog.create({
        data: {
          identityId: verifier.id,
          action: 'VERIFICATION_REQUESTED',
          resourceType: 'verification_request',
          resourceId: verification.id,
          details: {
            subjectDid,
            credentialHash,
            requestedAttributes,
            circuitId,
            expiresAt,
            purpose,
          },
        },
      });

      res.status(201).json({
        data: buildVerificationRequestResponse(verification),
        message: 'Verification request created successfully',
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error('verification_request_create_error', {
        error: error.message,
      });
      sendRouteError(res, error, 'VERIFICATION_REQUEST_CREATE_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/verification/requests/:requestId/respond — Decline a request
// ---------------------------------------------------------------------------
const respondVerificationRequestParamsSchema = z.object({
  requestId: uuidSchema,
});
const declineVerificationRequestSchema = z.object({
  consent: z.literal(false),
  reason: z.string().trim().min(1).max(500).optional(),
});

router.post(
  '/requests/:requestId/respond',
  verificationLimiter,
  validate({
    params: respondVerificationRequestParamsSchema,
    body: declineVerificationRequestSchema,
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const subject = req.identity!;
      const { requestId } = req.params as z.infer<
        typeof respondVerificationRequestParamsSchema
      >;
      const { reason = 'User declined verification' } = req.body as z.infer<
        typeof declineVerificationRequestSchema
      >;
      const verificationRequest = await getOwnedPendingVerificationRequest(
        requestId,
        subject.id,
      );
      const completedAt = new Date();
      const resultDetails = {
        ...verificationRequest.details,
        userConsent: false,
        response: {
          outcome: 'declined',
          reason,
          respondedAt: completedAt.toISOString(),
        },
      } as unknown as Prisma.InputJsonObject;

      await prisma.$transaction(async (tx) => {
        const updated = await tx.verification.updateMany({
          where: {
            id: verificationRequest.id,
            subjectId: subject.id,
            verifierId: verificationRequest.verifierId,
            verificationType: 'PROOF_REQUEST',
            result: 'PENDING',
          },
          data: {
            result: 'FAILED',
            resultDetails,
            completedAt,
          },
        });
        if (updated.count !== 1) {
          throw buildRouteError(
            'Verification request was resolved by another operation',
            'VERIFICATION_REQUEST_ALREADY_RESOLVED',
            409,
          );
        }

        await tx.auditLog.create({
          data: {
            identityId: subject.id,
            action: 'VERIFICATION_FAILED',
            resourceType: 'verification_request',
            resourceId: verificationRequest.id,
            details: {
              outcome: 'declined',
              verifierId: verificationRequest.verifierId,
              reason,
            },
          },
        });
      });

      res.json({
        data: {
          requestId: verificationRequest.id,
          verified: false,
          attributeResults: [],
          verifiedAt: unixSeconds(completedAt),
          reason,
        },
        message: 'Verification request declined',
      });
    } catch (err) {
      const error = asRouteError(err);
      logger.error('verification_request_decline_error', {
        error: error.message,
      });
      sendRouteError(res, error, 'VERIFICATION_REQUEST_DECLINE_FAILED');
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/verification/requests — List durable proof requests
// ---------------------------------------------------------------------------
const listVerificationRequestsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['subject', 'verifier', 'all']).default('subject'),
  result: z.enum(['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED']).optional(),
});

router.get(
  '/requests',
  validate({ query: listVerificationRequestsQuery }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { page, limit, role, result } = req.query as unknown as z.infer<
        typeof listVerificationRequestsQuery
      >;

      const where: Record<string, unknown> = {
        verificationType: 'PROOF_REQUEST',
        result: result ?? 'PENDING',
      };
      if (role === 'subject') {
        where.subjectId = identity.id;
      } else if (role === 'verifier') {
        where.verifierId = identity.id;
      } else {
        where.OR = [{ subjectId: identity.id }, { verifierId: identity.id }];
      }

      const [requests, total] = await Promise.all([
        prisma.verification.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            verifier: { select: { did: true } },
            subject: { select: { did: true } },
          },
        }),
        prisma.verification.count({ where }),
      ]);

      res.json({
        data: requests.map(buildVerificationRequestResponse),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      sendRouteError(
        res,
        asRouteError(err),
        'VERIFICATION_REQUEST_LIST_FAILED',
      );
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
  type: z
    .enum([
      'ZK_PROOF',
      'TEE_ATTESTATION',
      'CREDENTIAL_CHECK',
      'ELIGIBILITY_PROOF',
      'PROOF_REQUEST',
    ])
    .optional(),
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
