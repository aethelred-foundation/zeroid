import express from 'express';
import request from 'supertest';
import type { Express, NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../src/middleware/auth';
import { createHash } from 'crypto';

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

const mockPrisma = {
  $transaction: jest.fn(),
  identity: {
    findUnique: jest.fn(),
  },
  verification: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock('../src/runtime', () => ({
  prisma: mockPrisma,
  redis: mockRedis,
  logger: mockLogger,
  verificationCounter: { inc: jest.fn() },
}));

const mockCredentialService = {
  getCredential: jest.fn(),
  verifyCredential: jest.fn(),
};

jest.mock('../src/services/credential', () => ({
  credentialService: mockCredentialService,
}));

jest.mock('../src/services/tee', () => ({
  teeService: {
    isAttestationValid: jest.fn(async () => true),
    issueAttestationChallenge: jest.fn(),
    verifyAttestation: jest.fn(),
  },
}));

const mockZkProofService = {
  isCircuitContextBound: jest.fn(() => true),
  getCircuitPublicSignalSchema: jest.fn(() => []),
  validateContextBoundPublicSignals: jest.fn(() => ({ valid: true })),
  buildSelectiveDisclosureInputs: jest.fn(() => ({})),
  generateProof: jest.fn(),
  verifyProof: jest.fn(),
  listCircuits: jest.fn(() => []),
};

jest.mock('../src/services/zkproof', () => ({
  zkProofService: mockZkProofService,
}));

import { verificationRoutes } from '../src/routes/verification';

const VERIFIER = {
  id: 'verifier-1',
  did: 'did:aethelred:verifier',
  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  status: 'ACTIVE',
};
const SUBJECT = {
  id: 'subject-1',
  did: 'did:aethelred:subject',
  status: 'ACTIVE',
};
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_CLAIMS = { age: 30 };
const CREDENTIAL_CLAIMS_HASH = createHash('sha256')
  .update(JSON.stringify(CREDENTIAL_CLAIMS))
  .digest('hex');
const CREDENTIAL_HASH = `0x${CREDENTIAL_CLAIMS_HASH}`;

function buildApp(identity: Record<string, unknown> = VERIFIER): Express {
  const app = express();
  app.use(express.json());
  app.use(
    (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
      req.identity = identity as NonNullable<AuthenticatedRequest['identity']>;
      next();
    },
  );
  app.use('/api/v1/verification', verificationRoutes);
  return app;
}

function requestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    verifierId: VERIFIER.id,
    subjectId: SUBJECT.id,
    verificationType: 'PROOF_REQUEST',
    result: 'PENDING',
    requestedAt: new Date('2026-06-24T10:00:00.000Z'),
    resultDetails: {
      verifierDid: VERIFIER.did,
      subjectDid: SUBJECT.did,
      credentialHash: CREDENTIAL_HASH,
      requestedAttributes: ['age', 'residency'],
      circuitId: '0xcircuit',
      expiresAt: 1890000000,
      purpose: 'Regulated onboarding',
      userConsent: false,
    },
    verifier: { id: VERIFIER.id, did: VERIFIER.did },
    subject: { id: SUBJECT.id, did: SUBJECT.did },
    ...overrides,
  };
}

function boundProofFixture(includeRequestId = true) {
  const nonce = 'request-bound-nonce-0001';
  const issuedAt = Date.now() - 1_000;
  const claimsHashField = BigInt(
    `0x${CREDENTIAL_CLAIMS_HASH.substring(0, 62)}`,
  ).toString();
  const contextCommitment = BigInt(
    `0x${createHash('sha256')
      .update(
        `${nonce}:${VERIFIER.id}:${SUBJECT.id}:${CREDENTIAL_ID}:${issuedAt}`,
      )
      .digest('hex')
      .substring(0, 62)}`,
  ).toString();
  const publicSignals = [claimsHashField, contextCommitment];
  const nonceRecord = {
    nonce,
    audience: VERIFIER.id,
    subjectId: SUBJECT.id,
    credentialId: CREDENTIAL_ID,
    ...(includeRequestId ? { requestId: REQUEST_ID } : {}),
    issuedAt,
    claimsHashField,
    contextCommitmentField: contextCommitment,
    publicSignalValues: {
      claimsHash: claimsHashField,
      contextCommitment,
    },
  };
  return {
    nonceRecord,
    payload: {
      requestId: REQUEST_ID,
      proof: {
        pi_a: ['1', '2'],
        pi_b: [
          ['3', '4'],
          ['5', '6'],
        ],
        pi_c: ['7', '8'],
        protocol: 'groth16',
        curve: 'bn128',
      },
      publicSignals,
      circuitName: '0xcircuit',
      nonce,
      audience: VERIFIER.id,
      contextCommitment,
      issuedAt,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.identity.findUnique.mockResolvedValue(SUBJECT);
  mockPrisma.verification.create.mockResolvedValue(requestRecord());
  mockPrisma.verification.findUnique.mockResolvedValue(requestRecord());
  mockPrisma.verification.findMany.mockResolvedValue([requestRecord()]);
  mockPrisma.verification.count.mockResolvedValue(1);
  mockPrisma.verification.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
  );
  mockCredentialService.getCredential.mockResolvedValue({
    id: CREDENTIAL_ID,
    subjectId: SUBJECT.id,
    status: 'ACTIVE',
    claims: CREDENTIAL_CLAIMS,
    claimsHash: CREDENTIAL_CLAIMS_HASH,
    expiresAt: null,
  });
  mockZkProofService.verifyProof.mockResolvedValue({
    valid: true,
    proofId: 'proof-1',
    circuitName: '0xcircuit',
    publicSignals: ['1', '2'],
    verifiedAt: new Date('2026-07-18T00:00:00.000Z'),
  });
  mockZkProofService.generateProof.mockResolvedValue({
    proofId: 'generated-proof-1',
    proof: {
      pi_a: ['1', '2'],
      pi_b: [
        ['3', '4'],
        ['5', '6'],
      ],
      pi_c: ['7', '8'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals: ['1', '2'],
    circuitName: '0xcircuit',
    generatedAt: new Date('2026-07-18T00:00:00.000Z'),
    generationTimeMs: 25,
  });
});

describe('verification request routes', () => {
  it('creates a durable verifier proof request', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/requests')
      .send({
        subjectDid: SUBJECT.did,
        credentialHash: CREDENTIAL_HASH,
        requestedAttributes: ['age', 'residency'],
        circuitId: '0xcircuit',
        expiresAt: 1890000000,
        purpose: 'Regulated onboarding',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: REQUEST_ID,
      status: 'pending',
      verifierDid: VERIFIER.did,
      subjectDid: SUBJECT.did,
      purpose: 'Regulated onboarding',
    });
    expect(mockPrisma.verification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationType: 'PROOF_REQUEST',
          result: 'PENDING',
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VERIFICATION_REQUESTED',
          resourceType: 'verification_request',
        }),
      }),
    );
  });

  it('lists pending durable proof requests for the authenticated identity', async () => {
    const res = await request(buildApp()).get(
      '/api/v1/verification/requests?role=subject&result=PENDING',
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: REQUEST_ID,
      status: 'pending',
      credentialHash: CREDENTIAL_HASH,
    });
    expect(mockPrisma.verification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationType: 'PROOF_REQUEST',
          result: 'PENDING',
          subjectId: VERIFIER.id,
        }),
      }),
    );
  });

  it('durably records a holder decline and its audit event', async () => {
    const res = await request(buildApp(SUBJECT))
      .post(`/api/v1/verification/requests/${REQUEST_ID}/respond`)
      .send({ consent: false });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      requestId: REQUEST_ID,
      verified: false,
      reason: 'User declined verification',
    });
    expect(mockPrisma.verification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: REQUEST_ID,
          subjectId: SUBJECT.id,
          result: 'PENDING',
        }),
        data: expect.objectContaining({
          result: 'FAILED',
          completedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityId: SUBJECT.id,
          action: 'VERIFICATION_FAILED',
          resourceId: REQUEST_ID,
          details: expect.objectContaining({ outcome: 'declined' }),
        }),
      }),
    );
  });

  it('does not disclose or mutate a request owned by another holder', async () => {
    const res = await request(buildApp(VERIFIER))
      .post(`/api/v1/verification/requests/${REQUEST_ID}/respond`)
      .send({ consent: false });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('VERIFICATION_REQUEST_NOT_FOUND');
    expect(mockPrisma.verification.updateMany).not.toHaveBeenCalled();
  });

  it('serializes competing request responses', async () => {
    mockPrisma.verification.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await request(buildApp(SUBJECT))
      .post(`/api/v1/verification/requests/${REQUEST_ID}/respond`)
      .send({ consent: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERIFICATION_REQUEST_ALREADY_RESOLVED');
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('durably completes only a proof bound to the holder request', async () => {
    const fixture = boundProofFixture();
    mockRedis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(fixture.nonceRecord));

    const res = await request(buildApp(SUBJECT))
      .post('/api/v1/verification/zk-verify')
      .send(fixture.payload);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      valid: true,
      requestId: REQUEST_ID,
      status: 'completed',
    });
    expect(mockPrisma.verification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: REQUEST_ID,
          subjectId: SUBJECT.id,
          verifierId: VERIFIER.id,
          result: 'PENDING',
        }),
        data: expect.objectContaining({
          credentialId: CREDENTIAL_ID,
          result: 'VERIFIED',
          zkProofData: expect.objectContaining({ requestId: REQUEST_ID }),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VERIFICATION_COMPLETED',
          resourceId: REQUEST_ID,
        }),
      }),
    );
  });

  it('issues a proof nonce explicitly bound to the holder request', async () => {
    const res = await request(buildApp(SUBJECT))
      .post('/api/v1/verification/zk-proof')
      .send({
        credentialId: CREDENTIAL_ID,
        requestId: REQUEST_ID,
        circuitName: '0xcircuit',
        inputs: {},
        selectiveDisclosure: ['age', 'residency'],
        audience: VERIFIER.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      proofId: 'generated-proof-1',
      requestId: REQUEST_ID,
      audience: VERIFIER.id,
    });
    const nonceReservation = mockRedis.set.mock.calls.find((call) =>
      String(call[0]).startsWith('proof:nonce:'),
    );
    expect(nonceReservation).toBeDefined();
    expect(JSON.parse(String(nonceReservation?.[1]))).toMatchObject({
      requestId: REQUEST_ID,
      audience: VERIFIER.id,
      subjectId: SUBJECT.id,
      credentialId: CREDENTIAL_ID,
    });
  });

  it('rejects a valid-context nonce that was not issued for the request', async () => {
    const fixture = boundProofFixture(false);
    mockRedis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify(fixture.nonceRecord));

    const res = await request(buildApp(SUBJECT))
      .post('/api/v1/verification/zk-verify')
      .send(fixture.payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VERIFICATION_REQUEST_NONCE_BINDING_INVALID');
    expect(mockPrisma.verification.updateMany).not.toHaveBeenCalled();
    expect(mockZkProofService.verifyProof).not.toHaveBeenCalled();
  });
});
