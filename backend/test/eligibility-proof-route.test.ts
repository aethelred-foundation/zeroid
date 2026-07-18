import express from 'express';
import request from 'supertest';
import type { Express, NextFunction, Response } from 'express';
import { createHash } from 'crypto';
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
  verifyProof: jest.fn(),
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
const TEST_CLAIMS = {
  attributes: {
    dobYear: 1990,
    dobMonth: 6,
    dobDay: 1,
    countryOfResidence: 'AE',
    nationality: 'AE',
    sanctionsScreeningResult: 'CLEAR',
    riskTier: 'LOW',
    status: 'ACTIVE',
    revocationNonce: 'rev-nonce-1',
  },
  riskProfile: {
    assessmentId: 'risk-1',
    riskTier: 'LOW',
    factors: {
      sanctions: 'pass',
      revocation: 'not_revoked',
    },
  },
  evidence: {
    issuerProofId: 'issuer-proof-1',
    teeAttestationId: 'tee-1',
  },
};

const TEST_MANIFEST_DIGEST =
  '0x1f48ddf10a370c1ab6af80f17e359f0c00700b5151a7ee1db835dfdb3cde25e5';
const TEST_SOURCE_DIGEST =
  '0xac4d4468fd32692373b5a5942a94588120bfbbda82b151da8aa92a12fd6393e3';
const TEST_POLICY_BINDING_DIGEST =
  '0xc339f81323c5288c23a30a0fcbc3140bdb60f79193101cbc8ee0fc42eda45e0c';
const TEST_RECEIPT_HASH =
  '0x575d6472ac31125157a91ba8cb9374a3e79483294163e5fb57f9b2e95575e3d9';

function canonicalizeClaims(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeClaims(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalizeClaims(obj[key]))
      .join(',') +
    '}'
  );
}

function computeClaimsHash(claims: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeClaims(claims)).digest('hex');
}

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
      dryRun: true,
    },
  };
}

function buildReceiptRecord() {
  return {
    id: 'verification-1',
    credentialId: CREDENTIAL_ID,
    verifierId: SUBJECT_ID,
    subjectId: SUBJECT_ID,
    result: 'VERIFIED',
    requestedAt: new Date('2026-06-23T10:00:00.000Z'),
    completedAt: new Date('2026-06-23T10:00:01.000Z'),
    zkProofData: {
      proofId: 'zkp_testproof',
      circuitId: 'zkc_eligibility_policy_context_v1',
      circuitName: 'eligibility_policy_context_v1',
      verificationKeyId: 'vk_eligibility_policy_context_v1_2026_06_27',
      manifestDigest: TEST_MANIFEST_DIGEST,
      sourceDigest: TEST_SOURCE_DIGEST,
      policyBindingDigest: TEST_POLICY_BINDING_DIGEST,
      artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
      contextHash:
        '0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a',
      receiptHash: TEST_RECEIPT_HASH,
      receiptHashAlgorithm: 'sha256-canonical-json-v1',
      publicSignals: {
        claimsHash:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ageThresholdYears: '21',
        residencyCountryCode: 'AE',
        currentTimestamp: '1782208801',
        policyVersionHash:
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        contextCommitment:
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      privateInputsRedacted: ['dateOfBirth', 'nationality', 'issuerSignature'],
      disclosurePolicy: {
        rawFieldsDisclosed: [],
        publicSignals: [
          'claimsHash',
          'ageThresholdYears',
          'residencyCountryCode',
          'currentTimestamp',
          'policyVersionHash',
          'contextCommitment',
        ],
        provedPredicates: ['AGE_OVER_THRESHOLD', 'TEE_ATTESTED'],
        disclosureBudget: {
          rawFieldCount: 0,
          publicSignalCount: 6,
          provedPredicateCount: 2,
          redactedPrivateInputCount: 3,
        },
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
      deniedReasons: [],
      evaluation: {
        ageOverThreshold: true,
        residencyAllowed: true,
        nationalityAllowed: true,
        sanctionsClear: true,
        riskAccepted: true,
        credentialActive: true,
        credentialNotExpired: true,
        nonRevocationChecked: true,
        onchainAttested: true,
        teeAttested: true,
      },
      receiptHash: TEST_RECEIPT_HASH,
      receiptHashAlgorithm: 'sha256-canonical-json-v1',
      manifestPath: 'circuits/manifest/eligibility_v1.json',
      manifestDigest: TEST_MANIFEST_DIGEST,
      sourceDigest: TEST_SOURCE_DIGEST,
      policyBindingDigest: TEST_POLICY_BINDING_DIGEST,
      artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
      disclosureBudget: {
        rawFieldCount: 0,
        publicSignalCount: 6,
        provedPredicateCount: 10,
        redactedPrivateInputCount: 11,
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  const credential = {
    id: CREDENTIAL_ID,
    credentialType: 'KYC_LEVEL_2',
    issuerId: 'issuer-1',
    subjectId: SUBJECT_ID,
    claims: TEST_CLAIMS,
    claimsHash: computeClaimsHash(TEST_CLAIMS),
    proof: {},
    status: 'ACTIVE',
    issuedAt: new Date('2026-06-01T00:00:00.000Z'),
    expiresAt: new Date('2027-06-01T00:00:00.000Z'),
  };

  mockCredentialService.getCredential.mockResolvedValue(credential);
  mockCredentialService.verifyCredential.mockResolvedValue({
    valid: true,
    credential,
    checks: {
      statusActive: true,
      notExpired: true,
      integrityValid: true,
      issuerActive: true,
      subjectActive: true,
      signatureValid: true,
      issuerTrustValid: true,
      notRevoked: true,
    },
  });
  mockPrisma.identity.findUnique.mockResolvedValue({
    id: SUBJECT_ID,
    status: 'ACTIVE',
    teeAttested: true,
    teeAttestationId: 'tee-1',
  });
  mockTeeService.isAttestationValid.mockResolvedValue(true);
  mockPrisma.verification.create.mockResolvedValue({ id: 'verification-1' });
  mockPrisma.verification.findFirst.mockResolvedValue(buildReceiptRecord());
  mockPrisma.auditLog.create.mockResolvedValue({
    id: 'audit-1',
    entryHash:
      '9f2f6c5804f31959e424bd0a624987887fe0c2ba5f5e77c49020a66a9f2dd904',
  });
  mockPrisma.auditLog.findFirst.mockResolvedValue({
    id: 'audit-1',
    timestamp: new Date('2026-06-23T10:00:02.000Z'),
    details: {
      auditHash:
        '0x9f2f6c5804f31959e424bd0a624987887fe0c2ba5f5e77c49020a66a9f2dd904',
      receiptHash: TEST_RECEIPT_HASH,
      decisionId: 'dec_testdecision',
      proofId: 'zkp_testproof',
    },
  });
});

describe('POST /api/v1/verification/eligibility-proof', () => {
  it('creates a policy-bound eligibility proof receipt from a verified KYC credential', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send(buildRequest());

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ALLOWED');
    expect(res.body.data.policyId).toBe(POLICY_ID);
    expect(res.body.data.proof.circuitName).toBe(
      'eligibility_policy_context_v1',
    );
    expect(res.body.data.proof.manifestDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.data.evidence.manifestDigest).toBe(
      res.body.data.proof.manifestDigest,
    );
    expect(res.body.data.evidence.artifactStatus).toBe(
      'SOURCE_VALIDATED_ARTIFACTS_PENDING',
    );
    expect(res.body.data.proof.disclosurePolicy.rawFieldsDisclosed).toEqual([]);
    expect(res.body.data.proof.disclosurePolicy.disclosureBudget).toMatchObject(
      {
        rawFieldCount: 0,
        publicSignalCount: 6,
      },
    );
    expect(res.body.data.proof.disclosurePolicy.provedPredicates).toEqual(
      expect.arrayContaining(['AGE_OVER_THRESHOLD', 'TEE_ATTESTED']),
    );
    expect(res.body.data.evidence.auditLogId).toBe('audit-1');
    expect(res.body.data.evidence.receiptHashAlgorithm).toBe(
      'sha256-canonical-json-v1',
    );
    expect(res.body.data.evaluation.deniedReasons).toEqual([]);
    expect(mockCredentialService.verifyCredential).toHaveBeenCalledWith(
      CREDENTIAL_ID,
    );
    expect(mockPrisma.verification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationType: 'ELIGIBILITY_PROOF',
          result: 'VERIFIED',
          zkProofData: expect.objectContaining({
            disclosurePolicy: expect.objectContaining({
              rawFieldsDisclosed: [],
              disclosureBudget: expect.objectContaining({
                rawFieldCount: 0,
              }),
            }),
            receiptHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            receiptHashAlgorithm: 'sha256-canonical-json-v1',
            manifestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            sourceDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            policyBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
          }),
          resultDetails: expect.objectContaining({
            receiptHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            receiptHashAlgorithm: 'sha256-canonical-json-v1',
            manifestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            sourceDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            policyBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
            disclosureBudget: expect.objectContaining({
              rawFieldCount: 0,
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VERIFICATION_COMPLETED',
          resourceType: 'eligibility_proof',
          details: expect.objectContaining({
            receiptHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            receiptHashAlgorithm: 'sha256-canonical-json-v1',
            manifestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            sourceDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            policyBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
            disclosureBudget: expect.objectContaining({
              rawFieldCount: 0,
            }),
          }),
        }),
      }),
    );
  });

  it('rejects a proof request for a DID different from the authenticated identity', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send({
        ...buildRequest(),
        subjectDid: 'did:aethelred:attacker',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CREDENTIAL_SUBJECT_MISMATCH');
    expect(mockCredentialService.getCredential).not.toHaveBeenCalled();
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });

  it('fails closed when the registered ZK circuit schema drifts from the pinned manifest', async () => {
    mockZkProofService.getCircuitPublicSignalSchema.mockReturnValueOnce([
      'claimsHash',
      'ageThresholdYears',
      'currentTimestamp',
      'contextCommitment',
    ]);

    const res = await request(buildApp())
      .post('/api/v1/verification/eligibility-proof')
      .send(buildRequest());

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ZK_CIRCUIT_SCHEMA_MISMATCH');
    expect(mockCredentialService.getCredential).not.toHaveBeenCalled();
    expect(mockPrisma.verification.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/verification/eligibility-proof/:receiptId', () => {
  it('rejects malformed eligibility receipt ids before lookup', async () => {
    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec%20bad',
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
  });

  it('loads an authenticated eligibility proof receipt by decision id', async () => {
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
        proofId: 'zkp_testproof',
        circuitName: 'eligibility_policy_context_v1',
        manifestDigest: TEST_MANIFEST_DIGEST,
      },
      evidence: {
        auditLogId: 'audit-1',
        auditHash:
          '0x9f2f6c5804f31959e424bd0a624987887fe0c2ba5f5e77c49020a66a9f2dd904',
        receiptHash: TEST_RECEIPT_HASH,
        artifactStatus: 'SOURCE_VALIDATED_ARTIFACTS_PENDING',
      },
    });
    expect(res.body.data.evidence.auditDetails).toMatchObject({
      receiptHash: TEST_RECEIPT_HASH,
      decisionId: 'dec_testdecision',
      proofId: 'zkp_testproof',
    });
    expect(mockPrisma.verification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationType: 'ELIGIBILITY_PROOF',
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { verifierId: SUBJECT_ID },
                { subjectId: SUBJECT_ID },
              ]),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                { id: 'dec_testdecision' },
                {
                  resultDetails: {
                    path: ['decisionId'],
                    equals: 'dec_testdecision',
                  },
                },
                {
                  zkProofData: {
                    path: ['proofId'],
                    equals: 'dec_testdecision',
                  },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(mockPrisma.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          resourceType: 'eligibility_proof',
          resourceId: 'verification-1',
        },
      }),
    );
  });

  it('returns a controlled 404 when an eligibility proof receipt is missing', async () => {
    mockPrisma.verification.findFirst.mockResolvedValueOnce(null);

    const res = await request(buildApp()).get(
      '/api/v1/verification/eligibility-proof/dec_missing',
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ELIGIBILITY_RECEIPT_NOT_FOUND');
    expect(mockPrisma.auditLog.findFirst).not.toHaveBeenCalled();
  });
});
