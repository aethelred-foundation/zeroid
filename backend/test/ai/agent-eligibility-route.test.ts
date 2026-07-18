import express from 'express';
import request from 'supertest';

jest.mock('../../src/runtime', () => ({
  prisma: {},
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = { id: 'op-1', did: 'did:ctrl', status: 'ACTIVE' };
    next();
  },
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../src/routes/verification', () => ({
  eligibilityProofHandler: jest.fn(),
}));

const mockProof = jest.fn();
jest.mock('../../src/services/ai/agent-eligibility', () => ({
  agentEligibilityProof: (...args: unknown[]) => mockProof(...args),
  AgentEligibilityError: class AgentEligibilityError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));

import agentEligibilityRouter from '../../src/routes/ai/agent-eligibility';
import { AgentEligibilityError } from '../../src/services/ai/agent-eligibility';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai/agents', agentEligibilityRouter);
  return app;
}

const body = {
  agentDid: 'did:agent',
  controllerDid: 'did:ctrl',
  subjectDid: 'did:ctrl',
  credentialId: 'c1',
  policyId: 'POLICY_REGULATED_SERVICE_18PLUS_V1',
  relyingAppId: 'app1',
};

describe('POST /api/v1/ai/agents/eligibility/proof', () => {
  beforeEach(() => mockProof.mockReset());

  it('returns 200 with the proof response when allowed', async () => {
    mockProof.mockResolvedValue({ status: 'ALLOWED', decisionId: 'd1' });
    const res = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ALLOWED');
  });

  it('maps an AgentEligibilityError to its HTTP status + code', async () => {
    mockProof.mockRejectedValue(
      new AgentEligibilityError('missing scope', 'AGENT_NOT_AUTHORIZED', 403),
    );
    const res = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('AGENT_NOT_AUTHORIZED');
  });

  it('returns 422 for POLICY_CONDITIONS_NOT_MET', async () => {
    mockProof.mockRejectedValue(
      new AgentEligibilityError('risk', 'POLICY_CONDITIONS_NOT_MET', 422),
    );
    const res = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send(body);
    expect(res.status).toBe(422);
  });

  it('returns 400 for an invalid body', async () => {
    const res = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send({ agentDid: 'x' });
    expect(res.status).toBe(400);
    expect(mockProof).not.toHaveBeenCalled();
  });

  it('forwards the Idempotency-Key header into the service request', async () => {
    mockProof.mockResolvedValue({ status: 'ALLOWED', decisionId: 'd1' });
    await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .set('Idempotency-Key', 'idem-xyz')
      .send(body);
    expect(mockProof).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'idem-xyz' }),
    );
  });

  it('leaves idempotencyKey undefined when the header is absent (opt-in)', async () => {
    mockProof.mockResolvedValue({ status: 'ALLOWED', decisionId: 'd1' });
    await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send(body);
    const [, reqArg] = mockProof.mock.calls[0] as [unknown, { idempotencyKey?: string }];
    expect(reqArg.idempotencyKey).toBeUndefined();
  });

  it('rejects a malformed Idempotency-Key with 400 before calling the service', async () => {
    const res = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .set('Idempotency-Key', 'x'.repeat(300))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mockProof).not.toHaveBeenCalled();
  });
});
