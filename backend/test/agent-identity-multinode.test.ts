import crypto from 'crypto';

const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();

const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  sadd: jest.fn(async (key: string, ...values: string[]) => {
    const set = redisSets.get(key) ?? new Set<string>();
    for (const value of values) set.add(value);
    redisSets.set(key, set);
    return values.length;
  }),
  smembers: jest.fn(async (key: string) => Array.from(redisSets.get(key) ?? [])),
  srem: jest.fn(async (key: string, ...values: string[]) => {
    const set = redisSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const value of values) {
      if (set.delete(value)) removed++;
    }
    if (set.size === 0) redisSets.delete(key);
    return removed;
  }),
  expire: jest.fn(async () => 1),
  publish: jest.fn(async () => 1),
  incr: jest.fn(async () => 1),
};

jest.mock('../src/index', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  prisma: {
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
  redis: mockRedis,
}));

import { AgentCapability, AgentIdentityService } from '../src/services/ai/agent-identity';

const operatorId = 'identity-operator-1';
const delegatedCapability: AgentCapability = {
  name: 'credential.verify',
  description: 'Verify credentials for relying parties',
  resourceTypes: ['credential'],
  actions: ['verify'],
  riskLevel: 'medium',
  requiresApproval: false,
};
const approvalCapability: AgentCapability = {
  name: 'payment.release',
  description: 'Release payment after manual approval',
  resourceTypes: ['payment'],
  actions: ['release'],
  riskLevel: 'critical',
  requiresApproval: true,
};

function createSigningMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (message: string) => crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  };
}

async function registerServiceAgent(
  service: AgentIdentityService,
  name: string,
  capabilities: AgentCapability[],
  publicKey: string,
) {
  return service.registerAgent({
    operatorId,
    agentName: name,
    agentDescription: `${name} production control plane test fixture`,
    agentProtocol: 'aethelred_native',
    capabilities,
    publicKey,
    maxDelegationDepth: 3,
    teeRequired: false,
  });
}

describe('Agent identity multi-node persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    redisSets.clear();
    mockIdentityFindUnique.mockResolvedValue({
      id: operatorId,
      did: 'did:aethelred:operator',
      status: 'ACTIVE',
    });
  });

  it('lists registered agents from a separate service instance', async () => {
    const writer = new AgentIdentityService();
    const reader = new AgentIdentityService();
    const signing = createSigningMaterial();

    const registered = await registerServiceAgent(
      writer,
      'Verifier One',
      [delegatedCapability],
      signing.publicKey,
    );

    const agents = await reader.listAgentsForOperator(operatorId);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      agentId: registered.agentId,
      operatorId,
      agentName: 'Verifier One',
    });
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      `agents:operator:${operatorId}`,
      registered.agentId,
    );
  });

  it('shares pending approvals and responses across service instances', async () => {
    const writer = new AgentIdentityService();
    const reviewer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const challenge = 'approve-payment-release-challenge';
    const agent = await registerServiceAgent(
      writer,
      'Payments Controller',
      [approvalCapability],
      signing.publicKey,
    );

    const verification = await writer.verifyAgent({
      agentId: agent.agentId,
      challenge,
      signature: signing.sign(challenge),
      requestedCapabilities: ['payment.release'],
      context: {
        purpose: 'settlement release',
        resourceId: 'payment-1',
      },
    });

    expect(verification.verified).toBe(false);
    const [approval] = await reviewer.listPendingApprovals(operatorId);

    expect(approval).toMatchObject({
      agentId: agent.agentId,
      action: 'payment.release',
      status: 'pending',
    });

    const resolved = await reviewer.respondToApproval(
      approval.requestId,
      operatorId,
      true,
      'Approved by operator',
    );
    const remaining = await writer.listPendingApprovals(operatorId);

    expect(resolved.status).toBe('approved');
    expect(remaining).toEqual([]);
  });

  it('authorizes delegated capabilities after loading the chain from Redis', async () => {
    const writer = new AgentIdentityService();
    const reader = new AgentIdentityService();
    const delegatorSigning = createSigningMaterial();
    const delegateSigning = createSigningMaterial();
    const challenge = 'delegated-verification-challenge';

    const delegator = await registerServiceAgent(
      writer,
      'Delegator',
      [delegatedCapability],
      delegatorSigning.publicKey,
    );
    const delegate = await registerServiceAgent(
      writer,
      'Delegate',
      [],
      delegateSigning.publicKey,
    );

    await writer.createDelegation(
      delegator.agentId,
      delegate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );

    const verification = await reader.verifyAgent({
      agentId: delegate.agentId,
      challenge,
      signature: delegateSigning.sign(challenge),
      requestedCapabilities: ['credential.verify'],
      context: {
        callerAgentId: delegator.agentId,
        purpose: 'delegated credential verification',
        resourceId: 'credential-1',
      },
    });

    expect(verification.verified).toBe(true);
    expect(verification.authorizedCapabilities).toEqual(['credential.verify']);
  });
});
