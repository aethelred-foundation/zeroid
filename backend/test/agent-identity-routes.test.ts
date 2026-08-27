import express from 'express';
import request from 'supertest';

const mockGetAgent = jest.fn();
const mockGetAgentAudit = jest.fn();
const mockListPendingApprovals = jest.fn();
const mockCreateDelegation = jest.fn();
const mockIssueVerificationChallenge = jest.fn();
const mockVerifyAgent = jest.fn();
const mockRespondToApproval = jest.fn();
const mockRevokeDelegation = jest.fn();

jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.identity = {
      id: req.get('x-test-identity-id') ?? 'operator-1',
      did: 'did:aethelred:test:operator',
      publicKey: 'pub',
      status: 'ACTIVE',
    };
    next();
  },
}));

jest.mock('../src/middleware/rateLimit', () => ({
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/ai/agent-identity', () => ({
  AgentIdentityError: class AgentIdentityError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
  agentIdentityService: {
    listAgentsForOperator: jest.fn(async () => []),
    listPendingApprovals: mockListPendingApprovals,
    getAgent: mockGetAgent,
    getAgentAudit: mockGetAgentAudit,
    registerAgent: jest.fn(),
    updateCapabilities: jest.fn(),
    createDelegation: mockCreateDelegation,
    revokeDelegation: mockRevokeDelegation,
    issueVerificationChallenge: mockIssueVerificationChallenge,
    verifyAgent: mockVerifyAgent,
    suspendAgent: jest.fn(),
    respondToApproval: mockRespondToApproval,
  },
}));

jest.mock('../src/runtime', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { aiAgentIdentityRoutes } from '../src/routes/ai/agent-identity';

const ownedAgent = {
  agentId: 'agent-1',
  did: 'did:aethelred:agent:one',
  operatorId: 'operator-1',
  agentName: 'Verifier',
  agentDescription: 'Verifier control plane',
  agentProtocol: 'aethelred_native',
  status: 'active',
  capabilities: [],
  publicKeyHash: 'hash',
  maxDelegationDepth: 2,
  teeAttested: false,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  lastActiveAt: undefined,
  stats: {
    totalActions: 0,
    actionsToday: 0,
    successRate: 1,
    averageLatencyMs: 0,
    anomalyCount: 0,
  },
  metadata: {},
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/agents', aiAgentIdentityRoutes);
  return app;
}

describe('agent identity route ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgent.mockResolvedValue({ ...ownedAgent });
    mockGetAgentAudit.mockResolvedValue([]);
    mockListPendingApprovals.mockResolvedValue([]);
    mockIssueVerificationChallenge.mockResolvedValue({
      challengeId: 'ach-11111111-1111-4111-8111-111111111111',
      agentId: 'agent-1',
      nonce: 'n'.repeat(43),
      issuedAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-05-01T00:05:00.000Z',
      audience: 'operator-1',
      requestedCapabilities: ['credential.verify'],
      context: {
        operationId: 'operation-1',
        purpose: 'verify an explicitly scoped credential',
        resourceId: 'credential-1',
        resourceType: 'credential',
        action: 'verify',
      },
    });
    mockVerifyAgent.mockResolvedValue({ verified: false });
    mockRespondToApproval.mockResolvedValue({
      requestId: 'approval-1',
      agentId: 'agent-1',
      action: 'verify',
      status: 'approved',
      respondedAt: new Date(),
      respondedBy: 'operator-1',
    });
    mockRevokeDelegation.mockResolvedValue({
      delegation: {
        delegationId: 'del-11111111-1111-4111-8111-111111111111',
        status: 'revoked',
        revokedAt: new Date('2026-05-01T00:00:00.000Z'),
        revokedBy: 'operator-1',
      },
      revokedDelegationIds: [
        'del-11111111-1111-4111-8111-111111111111',
        'del-22222222-2222-4222-8222-222222222222',
      ],
    });
  });

  it('returns an owned agent profile', async () => {
    const response = await request(createApp())
      .get('/agents/agent-1')
      .set('x-test-identity-id', 'operator-1')
      .expect(200);

    expect(response.body.data).toMatchObject({
      agentId: 'agent-1',
      operatorId: 'operator-1',
      agentName: 'Verifier',
    });
  });

  it('hides another operator profile as not found', async () => {
    await request(createApp())
      .get('/agents/agent-1')
      .set('x-test-identity-id', 'operator-2')
      .expect(404);
  });

  it('does not read audit entries for another operator profile', async () => {
    await request(createApp())
      .get('/agents/agent-1/audit')
      .set('x-test-identity-id', 'operator-2')
      .expect(404);

    expect(mockGetAgentAudit).not.toHaveBeenCalled();
  });

  it('returns the server-backed audit evidence for an owned agent', async () => {
    mockGetAgentAudit.mockResolvedValue([
      {
        entryId: 'audit-1',
        agentId: 'agent-1',
        action: 'VERIFICATION_COMPLETED',
        resourceType: 'agent_authorization',
        resourceId: 'av-1',
        success: true,
        anomalyDetected: false,
        timestamp: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);

    const response = await request(createApp())
      .get('/agents/agent-1/audit?limit=10')
      .set('x-test-identity-id', 'operator-1')
      .expect(200);

    expect(mockGetAgentAudit).toHaveBeenCalledWith('agent-1', 10);
    expect(response.body.data).toMatchObject({
      agentId: 'agent-1',
      total: 1,
      entries: [{ entryId: 'audit-1', success: true }],
    });
  });

  it('rejects malformed or unknown delegation constraint parameters', async () => {
    const response = await request(createApp())
      .post('/agents/agent-1/delegate')
      .send({
        toAgentId: 'agent-2',
        capabilities: ['credential.verify'],
        durationHours: 1,
        constraints: [
          {
            type: 'action_scoped',
            parameters: {
              actions: ['verify'],
              bypassPolicy: true,
            },
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(mockCreateDelegation).not.toHaveBeenCalled();
  });

  it('revokes one owner-scoped delegation tree through the canonical path', async () => {
    const response = await request(createApp())
      .delete(
        '/agents/agent-1/delegations/del-11111111-1111-4111-8111-111111111111',
      )
      .set('x-test-identity-id', 'operator-1')
      .expect(200);

    expect(mockRevokeDelegation).toHaveBeenCalledWith(
      'del-11111111-1111-4111-8111-111111111111',
      'operator-1',
      'agent-1',
    );
    expect(response.body.data).toMatchObject({
      status: 'revoked',
      revokedDelegationIds: [
        'del-11111111-1111-4111-8111-111111111111',
        'del-22222222-2222-4222-8222-222222222222',
      ],
    });
  });

  it('issues an authenticated audience-bound operation challenge', async () => {
    const body = {
      requestedCapabilities: ['credential.verify'],
      context: {
        operationId: 'operation-1',
        purpose: 'verify an explicitly scoped credential',
        resourceId: 'credential-1',
        resourceType: 'credential',
        action: 'verify',
      },
    };
    const response = await request(createApp())
      .post('/agents/agent-1/challenges')
      .set('x-test-identity-id', 'operator-1')
      .send(body)
      .expect(201);

    expect(response.body.data.audience).toBe('operator-1');
    expect(mockIssueVerificationChallenge).toHaveBeenCalledWith(
      'agent-1',
      'operator-1',
      body,
    );
  });

  it('passes the durable signed operation and authenticated audience to verification', async () => {
    const body = {
      challengeId: 'ach-11111111-1111-4111-8111-111111111111',
      nonce: 'n'.repeat(43),
      issuedAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-05-01T00:05:00.000Z',
      audience: 'operator-1',
      signature: 's'.repeat(64),
      requestedCapabilities: ['credential.verify'],
      context: {
        operationId: 'operation-1',
        callerAgentId: 'agent-root',
        purpose: 'verify an explicitly scoped credential',
        resourceId: 'credential-1',
        resourceType: 'credential',
        action: 'verify',
      },
    };
    await request(createApp())
      .post('/agents/agent-1/verify')
      .set('x-test-identity-id', 'operator-1')
      .send(body)
      .expect(200);

    expect(mockVerifyAgent).toHaveBeenCalledWith(
      { agentId: 'agent-1', ...body },
      'operator-1',
    );
  });

  it('rejects missing action/resource context and client-declared risk', async () => {
    await request(createApp())
      .post('/agents/agent-1/challenges')
      .send({
        requestedCapabilities: ['credential.verify'],
        context: {
          operationId: 'operation-invalid',
          purpose: 'attempt incomplete scope',
          riskLevel: 'low',
        },
      })
      .expect(400);

    expect(mockIssueVerificationChallenge).not.toHaveBeenCalled();
  });

  it('returns the durable approval expiry instead of fabricating one', async () => {
    const durableExpiry = new Date('2026-05-03T10:30:00.000Z');
    mockListPendingApprovals.mockResolvedValue([
      {
        requestId: 'approval-1',
        approvalGroupId: 'apg-1',
        operationId: 'operation-1',
        operationDigest: 'a'.repeat(64),
        authorizationSnapshotDigest: 'b'.repeat(64),
        requestedCapabilities: ['credential.verify'],
        requiredApproverIds: ['operator-1'],
        agentId: 'agent-1',
        audienceId: 'operator-1',
        operatorId: 'operator-1',
        action: 'credential.verify',
        resourceType: 'credential',
        resourceId: 'credential-1',
        riskLevel: 'high',
        context: { purpose: 'manual review' },
        status: 'pending',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: durableExpiry,
      },
    ]);

    const response = await request(createApp())
      .get('/agents/approvals')
      .expect(200);

    expect(response.body.data[0].expiresAt).toBe(durableExpiry.toISOString());
    expect(response.body.data[0].riskScore).toBeUndefined();
  });

  it('uses only the canonical approval path and requires an explicit note', async () => {
    await request(createApp())
      .post('/agents/approvals/approval-1')
      .send({ approved: true })
      .expect(400);
    expect(mockRespondToApproval).not.toHaveBeenCalled();

    await request(createApp())
      .post('/agents/approvals/approval-1')
      .send({ approved: true, note: 'Reviewed exact operation evidence' })
      .expect(200);
    expect(mockRespondToApproval).toHaveBeenCalledWith(
      'approval-1',
      'operator-1',
      true,
      'Reviewed exact operation evidence',
    );

    mockRespondToApproval.mockClear();
    await request(createApp())
      .post('/agents/approvals/respond')
      .send({
        requestId: 'approval-1',
        approved: true,
        note: 'Legacy duplicate route payload',
      })
      .expect(400);
    expect(mockRespondToApproval).not.toHaveBeenCalled();
  });
});
