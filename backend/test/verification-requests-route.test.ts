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

const mockPrisma = {
  identity: {
    findUnique: jest.fn(),
  },
  verification: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

jest.mock('../src/index', () => ({
  prisma: mockPrisma,
  redis: mockRedis,
  logger: mockLogger,
  verificationCounter: { inc: jest.fn() },
}));

jest.mock('../src/services/credential', () => ({
  credentialService: {
    getCredential: jest.fn(),
    verifyCredential: jest.fn(),
  },
}));

jest.mock('../src/services/tee', () => ({
  teeService: {
    isAttestationValid: jest.fn(async () => true),
    issueAttestationChallenge: jest.fn(),
    verifyAttestation: jest.fn(),
  },
}));

jest.mock('../src/services/zkproof', () => ({
  zkProofService: {
    isCircuitContextBound: jest.fn(() => true),
    getCircuitPublicSignalSchema: jest.fn(() => []),
    validateContextBoundPublicSignals: jest.fn(() => ({ valid: true })),
    buildSelectiveDisclosureInputs: jest.fn(() => ({})),
    generateProof: jest.fn(),
    verifyProof: jest.fn(),
    listCircuits: jest.fn(() => []),
  },
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

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
      req.identity = VERIFIER;
      next();
    },
  );
  app.use('/api/v1/verification', verificationRoutes);
  return app;
}

function requestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr-1',
    result: 'PENDING',
    requestedAt: new Date('2026-06-24T10:00:00.000Z'),
    resultDetails: {
      verifierDid: VERIFIER.did,
      subjectDid: SUBJECT.did,
      credentialHash: '0xcred',
      requestedAttributes: ['age', 'residency'],
      circuitId: '0xcircuit',
      expiresAt: 1890000000,
      purpose: 'Regulated onboarding',
      userConsent: false,
    },
    verifier: { did: VERIFIER.did },
    subject: { did: SUBJECT.did },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.identity.findUnique.mockResolvedValue(SUBJECT);
  mockPrisma.verification.create.mockResolvedValue(requestRecord());
  mockPrisma.verification.findMany.mockResolvedValue([requestRecord()]);
  mockPrisma.verification.count.mockResolvedValue(1);
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
});

describe('verification request routes', () => {
  it('creates a durable verifier proof request', async () => {
    const res = await request(buildApp())
      .post('/api/v1/verification/requests')
      .send({
        subjectDid: SUBJECT.did,
        credentialHash: '0xcred',
        requestedAttributes: ['age', 'residency'],
        circuitId: '0xcircuit',
        expiresAt: 1890000000,
        purpose: 'Regulated onboarding',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: 'vr-1',
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
      id: 'vr-1',
      status: 'pending',
      credentialHash: '0xcred',
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
});
