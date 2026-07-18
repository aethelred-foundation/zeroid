import express from 'express';
import request from 'supertest';

const mockAgentFindUnique = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockRiskAssessmentFindFirst = jest.fn();

jest.mock('../../src/runtime', () => ({
  prisma: {
    aIAgent: {
      findUnique: (...args: unknown[]) => mockAgentFindUnique(...args),
    },
    identity: {
      findUnique: (...args: unknown[]) => mockIdentityFindUnique(...args),
    },
    riskAssessment: {
      findFirst: (...args: unknown[]) => mockRiskAssessmentFindFirst(...args),
    },
  },
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

import agentEligibilityRouter, {
  buildAgentEligibilityDeps,
} from '../../src/routes/ai/agent-eligibility';
import { AGENT_ELIGIBILITY_UNAVAILABLE_CODE } from '../../src/services/ai/agent-eligibility';

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
  contextNonce: 'context-nonce-001',
};

describe('POST /api/v1/ai/agents/eligibility/proof', () => {
  beforeEach(() => {
    mockAgentFindUnique.mockReset();
    mockIdentityFindUnique.mockReset();
    mockRiskAssessmentFindFirst.mockReset();
  });

  it('returns 503 without treating the human bearer session as agent authentication', async () => {
    const response = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send(body);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(AGENT_ELIGIBILITY_UNAVAILABLE_CODE);
    expect(response.body.message).toContain(
      'one-time agent and relying-party challenges',
    );
    expect(mockAgentFindUnique).not.toHaveBeenCalled();
    expect(mockIdentityFindUnique).not.toHaveBeenCalled();
  });

  it('does not expose an authorization oracle for caller-claimed controller data', async () => {
    const response = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send({ ...body, controllerDid: 'did:other', subjectDid: 'did:other' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(AGENT_ELIGIBILITY_UNAVAILABLE_CODE);
    expect(mockAgentFindUnique).not.toHaveBeenCalled();
  });

  it('still rejects a structurally invalid request before the availability gate', async () => {
    const response = await request(makeApp())
      .post('/api/v1/ai/agents/eligibility/proof')
      .send({ agentDid: 'did:agent' });

    expect(response.status).toBe(400);
    expect(mockAgentFindUnique).not.toHaveBeenCalled();
  });
});

describe('buildAgentEligibilityDeps compatibility loaders', () => {
  beforeEach(() => {
    mockAgentFindUnique.mockReset();
    mockIdentityFindUnique.mockReset();
    mockRiskAssessmentFindFirst.mockReset();
  });

  it('only loads a non-expired active credential', async () => {
    mockAgentFindUnique.mockResolvedValue({
      agentDid: 'did:agent',
      controllerDid: 'did:ctrl',
      operator: { did: 'did:ctrl' },
      status: 'ACTIVE',
      riskTier: 'LOW',
      agentCredentials: [],
    });

    const deps = buildAgentEligibilityDeps({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      publicKey: 'test-public-key',
    });
    await deps.loadAgent('did:agent');

    const query = mockAgentFindUnique.mock.calls[0][0];
    expect(query.include.agentCredentials.where).toEqual({
      status: 'ACTIVE',
      expiresAt: { gt: expect.any(Date) },
    });
  });

  it('loads the latest persisted controller risk tier', async () => {
    mockIdentityFindUnique.mockResolvedValue({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      governmentVerified: true,
    });
    mockRiskAssessmentFindFirst.mockResolvedValue({ level: 'HIGH' });

    const deps = buildAgentEligibilityDeps({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      publicKey: 'test-public-key',
    });

    await expect(deps.loadController('did:ctrl')).resolves.toEqual({
      controllerStatus: 'ACTIVE',
      controllerKycValid: true,
      controllerRiskTier: 'HIGH',
    });
    expect(mockRiskAssessmentFindFirst).toHaveBeenCalledWith({
      where: { entityId: 'op-1', entityType: 'identity' },
      orderBy: { assessedAt: 'desc' },
      select: { level: true },
    });
  });

  it('fails closed when the controller has no persisted risk assessment', async () => {
    mockIdentityFindUnique.mockResolvedValue({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      governmentVerified: true,
    });
    mockRiskAssessmentFindFirst.mockResolvedValue(null);

    const deps = buildAgentEligibilityDeps({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      publicKey: 'test-public-key',
    });

    await expect(deps.loadController('did:ctrl')).rejects.toMatchObject({
      code: 'CONTROLLER_RISK_ASSESSMENT_REQUIRED',
      statusCode: 503,
    });
  });

  it('never delegates proof issuance from the compatibility dependency object', async () => {
    const deps = buildAgentEligibilityDeps({
      id: 'op-1',
      did: 'did:ctrl',
      status: 'ACTIVE',
      publicKey: 'test-public-key',
    });

    await expect(
      deps.runEligibility({
        subjectDid: 'did:ctrl',
        credentialId: 'credential-1',
        policyId: 'policy-1',
        relyingAppId: 'app-1',
        contextNonce: 'context-nonce-001',
      }),
    ).rejects.toMatchObject({
      code: AGENT_ELIGIBILITY_UNAVAILABLE_CODE,
      statusCode: 503,
    });
  });
});
