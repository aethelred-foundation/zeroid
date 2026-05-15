import express from 'express';
import request from 'supertest';

const mockGetAgent = jest.fn();
const mockGetAgentAudit = jest.fn();

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
    listPendingApprovals: jest.fn(async () => []),
    getAgent: mockGetAgent,
    getAgentAudit: mockGetAgentAudit,
    registerAgent: jest.fn(),
    updateCapabilities: jest.fn(),
    createDelegation: jest.fn(),
    verifyAgent: jest.fn(),
    suspendAgent: jest.fn(),
    respondToApproval: jest.fn(),
  },
}));

jest.mock('../src/index', () => ({
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
});
