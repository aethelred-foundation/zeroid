import express from 'express';
import request from 'supertest';
import type { Express, NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../src/middleware/auth';

const mockRedis = {
  eval: jest.fn(async () => 1),
  get: jest.fn(async () => null),
  set: jest.fn(async () => 'OK'),
  del: jest.fn(async () => 1),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockVerificationCounter = {
  inc: jest.fn(),
};

const mockPrisma = {
  identity: {
    findUnique: jest.fn(),
  },
  verification: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockCredentialService = {
  getCredential: jest.fn(),
  verifyCredential: jest.fn(),
};

const mockTeeService = {
  isAttestationValid: jest.fn(),
  issueAttestationChallenge: jest.fn(),
  verifyAttestation: jest.fn(),
};

const mockZkProofService = {
  isCircuitContextBound: jest.fn(() => true),
  getCircuitPublicSignalSchema: jest.fn(() => [
    'claimsHash',
    'ageThresholdYears',
    'residencyCountryCode',
    'currentTimestamp',
    'policyVersionHash',
    'contextCommitment',
  ]),
  validateContextBoundPublicSignals: jest.fn(() => ({ valid: true })),
  buildSelectiveDisclosureInputs: jest.fn(() => ({})),
  generateProof: jest.fn(),
  verifyProof: jest.fn(async () => ({ valid: true })),
  listCircuits: jest.fn(() => []),
};

jest.mock('../src/runtime', () => ({
  prisma: mockPrisma,
  redis: mockRedis,
  logger: mockLogger,
  verificationCounter: mockVerificationCounter,
}));

jest.mock('../src/services/credential', () => ({
  credentialService: mockCredentialService,
}));

jest.mock('../src/services/tee', () => ({
  teeService: mockTeeService,
}));

jest.mock('../src/services/zkproof', () => ({
  zkProofService: mockZkProofService,
}));

import { verificationRoutes } from '../src/routes/verification';

const SUBJECT_ID = 'subject-1';
const SUBJECT_DID = 'did:aethelred:subject';
const CREDENTIAL_ID = 'cred-kyc-prod-1';
const POLICY_ID =
  'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1';
const TEST_MANIFEST_DIGEST =
  '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5';
const TEST_SOURCE_DIGEST =
  '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3';
const TEST_POLICY_BINDING_DIGEST =
  '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c';
const TEST_RECEIPT_HASH =
  '0x575d6472ac31125157a91ba8cb9374a3e79483294163e5fb57f9b2e95575e3d9';
const TEST_CONTEXT_HASH =
  '0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a';

function buildApp(
  identity = {
    id: SUBJECT_ID,
    did: SUBJECT_DID,
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    status: 'ACTIVE',
  },
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
      req.identity = identity;
      next();
    },
  );
  app.use('/api/v1/verification', verificationRoutes);
  return app;
}

function buildRequest() {
  return {
    subjectDid: SUBJECT_DID,
    credentialId: CREDENTIAL_ID,
    policyId: POLICY_ID,
    relyingAppId: 'edge-secure-data-room',
    contextNonce: 'nonce-edge-secure-data-room-001',
    options: {
      requireOnchainAttestation: false,
      requireNonRevocationProof: true,
      dryRun: false,
    },
  };
}

function buildVerifiedGroth16Receipt() {
  return {
    id: 'verification-1',
    credentialId: CREDENTIAL_ID,
    verifierId: SUBJECT_ID,
    subjectId: SUBJECT_ID,
    result: 'VERIFIED',
    requestedAt: new Date('2026-06-23T10:00:00.000Z'),
    completedAt: new Date('2026-06-23T10:00:01.000Z'),
    zkProofData: {
      proofId: '123e4567-e89b-42d3-a456-426614174000',
      circuitId: 'zkc_eligibility_policy_context_v1',
      circuitName: 'eligibility_policy_context_v1',
      verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
      manifestDigest: TEST_MANIFEST_DIGEST,
      sourceDigest: TEST_SOURCE_DIGEST,
      policyBindingDigest: TEST_POLICY_BINDING_DIGEST,
      artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
      contextHash: TEST_CONTEXT_HASH,
      receiptHash: TEST_RECEIPT_HASH,
      receiptHashAlgorithm: 'sha256-canonical-json-v1',
      publicSignals: ['1', '21', '78473', '1782208801', '5', '6'],
      proof: {
        pi_a: ['1', '2', '1'],
        pi_b: [
          ['3', '4'],
          ['5', '6'],
          ['1', '0'],
        ],
        pi_c: ['7', '8', '1'],
        protocol: 'groth16',
        curve: 'bn128',
      },
      proofVerification: {
        valid: true,
        proofSystem: 'groth16',
        verifiedAt: '2026-06-23T10:00:01.000Z',
      },
    },
    teeAttestation: {
      attestationId: 'tee-1',
      verified: true,
    },
    resultDetails: {
      status: 'ALLOWED',
      decisionId: 'dec_testdecision',
      policyId: POLICY_ID,
      policyVersion: '2026.06.1',
      relyingAppId: 'edge-secure-data-room',
      receiptHash: TEST_RECEIPT_HASH,
      receiptHashAlgorithm: 'sha256-canonical-json-v1',
      manifestPath: 'circuits/manifest/eligibility_v1.json',
      manifestDigest: TEST_MANIFEST_DIGEST,
      sourceDigest: TEST_SOURCE_DIGEST,
      policyBindingDigest: TEST_POLICY_BINDING_DIGEST,
      artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.verification.findFirst.mockResolvedValue(
    buildVerifiedGroth16Receipt(),
  );
  mockPrisma.auditLog.findFirst.mockResolvedValue({
    id: 'audit-1',
    timestamp: new Date('2026-06-23T10:00:02.000Z'),
    entryHash:
      '9f2f6c5804f31959e424bd0a624987887fe0c2ba5f5e77c49020a66a9f2dd904',
  });
});

describe('POST /api/v1/verification/eligibility-proof', () => {
  it('fails closed until signed-credential Groth16 proving is integrated', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send(buildRequest());

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
      details: {
        policyId: POLICY_ID,
        policyVersion: '2026.06.1',
        circuitId: 'zkc_eligibility_policy_context_v1',
        circuitName: 'eligibility_policy_context_v1',
        verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
        artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
      },
    });
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('zkp_');
    expect(JSON.stringify(res.body)).not.toContain('computedAge');
    expect(JSON.stringify(res.body)).not.toContain('provedPredicates');
    expect(mockCredentialService.getCredential).not.toHaveBeenCalled();
    expect(mockCredentialService.verifyCredential).not.toHaveBeenCalled();
    expect(mockTeeService.isAttestationValid).not.toHaveBeenCalled();
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a different subject before reporting prover availability', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        subjectDid: 'did:aethelred:attacker',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CREDENTIAL_SUBJECT_MISMATCH');
    expect(
      mockZkProofService.getCircuitPublicSignalSchema,
    ).not.toHaveBeenCalled();
  });

  it('rejects browser-style dry-run evaluation', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        options: {
          requireOnchainAttestation: false,
          requireNonRevocationProof: true,
          dryRun: true,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ELIGIBILITY_DRY_RUN_UNSUPPORTED');
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });

  it('rejects attempts to disable mandatory non-revocation evidence', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        options: {
          requireOnchainAttestation: false,
          requireNonRevocationProof: false,
          dryRun: false,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ELIGIBILITY_POLICY_OPTION_CONFLICT');
  });

  it('rejects on-chain claims while no transaction-backed verifier exists', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        options: {
          requireOnchainAttestation: true,
          requireNonRevocationProof: true,
          dryRun: false,
        },
      });

    expect(res.status).toBe(501);
    expect(res.body.code).toBe('ELIGIBILITY_ONCHAIN_ATTESTATION_UNAVAILABLE');
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported option fields at the HTTP boundary', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        options: {
          ...buildRequest().options,
          trustCallerClaims: true,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(
      mockZkProofService.getCircuitPublicSignalSchema,
    ).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown policy without touching proof services', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        policyId: 'zeroid://policy/unknown',
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('POLICY_NOT_FOUND');
    expect(
      mockZkProofService.getCircuitPublicSignalSchema,
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the registered circuit schema drifts', async () => {
    mockZkProofService.getCircuitPublicSignalSchema.mockReturnValueOnce([
      'claimsHash',
      'ageThresholdYears',
      'contextCommitment',
    ]);

    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send(buildRequest());

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ZK_CIRCUIT_SCHEMA_MISMATCH');
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });

  it('fails closed when context-bound circuit artifacts are unavailable', async () => {
    mockZkProofService.isCircuitContextBound.mockReturnValueOnce(false);

    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send(buildRequest());

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ZK_CIRCUIT_ARTIFACTS_NOT_READY');
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });

  it('rejects the unpinned manifest outside the unit-test runtime', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const res = await request(buildApp())
        .post('/api/v1/verification/eligibility-proof')
        .send(buildRequest());

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('ZK_CIRCUIT_ARTIFACTS_NOT_READY');
      expect(
        mockZkProofService.getCircuitPublicSignalSchema,
      ).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe('GET /api/v1/verification/eligibility-proof/:receiptId', () => {
  it('rejects malformed receipt ids before lookup', async () => {
    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec%20bad',
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the receipt is missing', async () => {
    mockPrisma.verification.findFirst.mockResolvedValueOnce(null);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_missing',
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_NOT_FOUND');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed for legacy pseudo-proof predicate evaluations', async () => {
    const legacyReceipt = buildVerifiedGroth16Receipt();
    legacyReceipt.resultDetails = {
      ...legacyReceipt.resultDetails,
      evaluation: {
        ageOverThreshold: true,
        computedAge: 36,
        onchainAttested: false,
      },
    };
    mockPrisma.verification.findFirst.mockResolvedValueOnce(legacyReceipt);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_LEGACY_UNSUPPORTED');
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('computedAge');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed for receipts backed by pending artifacts', async () => {
    const pendingReceipt = buildVerifiedGroth16Receipt();
    pendingReceipt.zkProofData.artifactStatus =
      'SOURCE_VALIDATED_ARTIFACTS_PENDING';
    pendingReceipt.resultDetails.artifactStatus =
      'SOURCE_VALIDATED_ARTIFACTS_PENDING';
    mockPrisma.verification.findFirst.mockResolvedValueOnce(pendingReceipt);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_ARTIFACTS_NOT_READY');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed for non-Groth16 proof evidence', async () => {
    const nonGroth16Receipt = buildVerifiedGroth16Receipt();
    nonGroth16Receipt.zkProofData.proof.protocol = 'plonk';
    mockPrisma.verification.findFirst.mockResolvedValueOnce(nonGroth16Receipt);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_PROOF_INVALID');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed for an unverified Groth16 proof marker', async () => {
    const unverifiedReceipt = buildVerifiedGroth16Receipt();
    unverifiedReceipt.zkProofData.proofVerification.valid = false;
    mockPrisma.verification.findFirst.mockResolvedValueOnce(unverifiedReceipt);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_PROOF_INVALID');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('does not expose stored receipts while the production prover gate is closed', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const res = await request(buildApp()).get(
        '/api/v1/verification/eligibility-proof/dec_testdecision',
      );

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('ZK_CIRCUIT_ARTIFACTS_NOT_READY');
      expect(res.body.data).toBeUndefined();
      expect(mockZkProofService.verifyProof).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('fails closed for legacy unverified on-chain assertions', async () => {
    const legacyReceipt = buildVerifiedGroth16Receipt();
    legacyReceipt.zkProofData.onchainTxHash = '0xdeadbeef';
    mockPrisma.verification.findFirst.mockResolvedValueOnce(legacyReceipt);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_EVIDENCE_INVALID');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when the audit entry is missing or unsealed', async () => {
    mockPrisma.auditLog.findFirst.mockResolvedValueOnce({
      id: 'audit-unsealed',
      timestamp: new Date('2026-06-23T10:00:02.000Z'),
      entryHash: null,
    });

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_AUDIT_SEAL_REQUIRED');
    expect(res.body.data).toBeUndefined();
  });

  it('fails closed when stored proof bytes do not re-verify', async () => {
    mockZkProofService.verifyProof.mockResolvedValueOnce({ valid: false });

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_PROOF_INVALID');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('returns only sealed, verified production Groth16 evidence', async () => {
    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_testdecision',
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      verificationId: 'verification-1',
      decisionId: 'dec_testdecision',
      status: 'ALLOWED',
      policyId: POLICY_ID,
      proof: {
        proofId: '123e4567-e89b-42d3-a456-426614174000',
        circuitName: 'eligibility_policy_context_v1',
        proofSystem: 'groth16',
        cryptographicallyVerified: true,
        groth16Proof: {
          protocol: 'groth16',
          curve: 'bn128',
        },
      },
      evidence: {
        auditLogId: 'audit-1',
        auditHash:
          '0x9f2f6c5804f31959e424bd0a624987887fe0c2ba5f5e77c49020a66a9f2dd904',
        artifactStatus: 'PINNED_PRODUCTION_ARTIFACTS',
        receiptHash: TEST_RECEIPT_HASH,
      },
    });
    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toContain('computedAge');
    expect(serialized).not.toContain('provedPredicates');
    expect(serialized).not.toContain('auditDetails');
    expect(mockZkProofService.verifyProof).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'groth16', curve: 'bn128' }),
      ['1', '21', '78473', '1782208801', '5', '6'],
      'eligibility_policy_context_v1',
    );
    expect(mockPrisma.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          resourceType: 'eligibility_proof',
          resourceId: 'verification-1',
        },
        select: {
          id: true,
          timestamp: true,
          entryHash: true,
        },
      }),
    );
  });
});
