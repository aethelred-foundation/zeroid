import express from 'express';
import request from 'supertest';

const mockIdem = {
  findUnique: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  upsert: jest.fn(),
};

jest.mock('../../src/runtime', () => ({
  prisma: {
    idempotencyRecord: {
      findUnique: (...args: unknown[]) => mockIdem.findUnique(...args),
      create: (...args: unknown[]) => mockIdem.create(...args),
      updateMany: (...args: unknown[]) => mockIdem.updateMany(...args),
      deleteMany: (...args: unknown[]) => mockIdem.deleteMany(...args),
      upsert: (...args: unknown[]) => mockIdem.upsert(...args),
    },
  },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: 'p1', did: 'did:partner', status: 'ACTIVE' };
    next();
  },
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../src/services/eligibility-invoker', () => ({
  invokeEligibility: jest.fn(),
}));

jest.mock('../../src/services/ai/agent-eligibility', () => ({
  agentEligibilityUnavailableError: () =>
    Object.assign(
      new Error('Agent eligibility proof issuance is unavailable'),
      {
        code: 'AGENT_ELIGIBILITY_PROOF_UNAVAILABLE',
        statusCode: 503,
      },
    ),
}));

const mockService = {
  walletEligibility: jest.fn(),
  poolEligibility: jest.fn(),
  initiateWalletDisclosure: jest.fn(),
};

jest.mock('../../src/services/partners/partner-service', () => ({
  walletEligibility: (...args: unknown[]) =>
    mockService.walletEligibility(...args),
  poolEligibility: (...args: unknown[]) => mockService.poolEligibility(...args),
  initiateWalletDisclosure: (...args: unknown[]) =>
    mockService.initiateWalletDisclosure(...args),
  partnerEligibilityChallengeUnavailableError: () =>
    Object.assign(new Error('Partner eligibility challenge is unavailable'), {
      code: 'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE',
      statusCode: 503,
    }),
  partnerEligibilityEvidenceUnavailableError: () =>
    Object.assign(new Error('Partner eligibility evidence is unavailable'), {
      code: 'PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE',
      statusCode: 503,
    }),
}));

import partnersRouter from '../../src/routes/partners';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/partners', partnersRouter);
  return app;
}

beforeEach(() => {
  Object.values(mockService).forEach((mock) => mock.mockReset());
  Object.values(mockIdem).forEach((mock) => mock.mockReset());
  mockIdem.create.mockResolvedValue(undefined);
  mockIdem.updateMany.mockResolvedValue({ count: 1 });
  mockIdem.deleteMany.mockResolvedValue({ count: 1 });
  mockIdem.upsert.mockResolvedValue(undefined);
});

describe('partner eligibility routes', () => {
  it('propagates the backend wallet eligibility 503', async () => {
    mockService.walletEligibility.mockRejectedValue(
      Object.assign(new Error('Signed witness prover is not integrated'), {
        code: 'ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED',
        statusCode: 503,
      }),
    );

    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({
        ownerDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
        relyingAppId: 'wallet',
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('ZK_ELIGIBILITY_PROVER_NOT_INTEGRATED');
  });

  it('fails closed if the wallet service accidentally returns a decision', async () => {
    mockService.walletEligibility.mockResolvedValue({
      eligible: true,
      decision: { status: 'ALLOWED' },
    });

    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({
        ownerDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
        relyingAppId: 'wallet',
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(
      'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE',
    );
  });

  it('fails closed if the pool service accidentally returns a decision', async () => {
    mockService.poolEligibility.mockResolvedValue({
      poolId: 'pool-7',
      eligible: true,
      decision: { status: 'ALLOWED' },
    });

    const response = await request(makeApp())
      .post('/api/v1/partners/cruzible/pools/pool-7/eligibility')
      .send({
        stakerDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'POOL_POLICY_V1',
        relyingAppId: 'cruzible',
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(
      'PARTNER_ELIGIBILITY_CHALLENGE_UNAVAILABLE',
    );
  });

  it('does not run idempotency persistence for an unavailable eligibility operation', async () => {
    mockService.walletEligibility.mockResolvedValue({ status: 'ALLOWED' });

    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .set('Idempotency-Key', 'attempt-1')
      .send({
        ownerDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
        relyingAppId: 'wallet',
      });

    expect(response.status).toBe(503);
    expect(mockIdem.findUnique).not.toHaveBeenCalled();
    expect(mockIdem.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid wallet request before invoking the service', async () => {
    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({ ownerDid: 'did:partner' });

    expect(response.status).toBe(400);
    expect(mockService.walletEligibility).not.toHaveBeenCalled();
  });

  it('returns 503 for the retired agent scan without invoking orchestration', async () => {
    const response = await request(makeApp())
      .post('/api/v1/partners/cruzible/pools/pool-7/agent-scan')
      .send({
        agentDid: 'did:agent',
        controllerDid: 'did:partner',
        subjectDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'POOL_POLICY_V1',
        relyingAppId: 'cruzible',
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('AGENT_ELIGIBILITY_PROOF_UNAVAILABLE');
  });

  it('returns 503 instead of exposing raw audit details as proof evidence', async () => {
    const response = await request(makeApp()).get(
      '/api/v1/partners/wallet/evidence/decision-1',
    );

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(
      'PARTNER_ELIGIBILITY_EVIDENCE_UNAVAILABLE',
    );
  });
});

describe('other partner routes', () => {
  it('maps a typed service error', async () => {
    mockService.walletEligibility.mockRejectedValue(
      Object.assign(new Error('no owner'), {
        code: 'OWNER_NOT_FOUND',
        statusCode: 404,
      }),
    );

    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/eligibility')
      .send({
        ownerDid: 'did:partner',
        credentialId: 'credential-1',
        policyId: 'policy-1',
        relyingAppId: 'wallet',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('OWNER_NOT_FOUND');
  });

  it('keeps conditional disclosure unavailable unless its service completes', async () => {
    mockService.initiateWalletDisclosure.mockResolvedValue({
      escrowId: 'escrow-1',
      warrantHash: '0xwarrant',
      status: 'REQUESTED',
    });

    const response = await request(makeApp())
      .post('/api/v1/partners/wallet/disclosure')
      .send({ decisionId: 'decision-1', warrantHash: '0xwarrant' });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('REQUESTED');
  });
});
