import crypto from 'crypto';

const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();

const mockRedis = {
  set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && redisStore.has(key)) {
      return null;
    }
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

jest.mock('../src/runtime', () => ({
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

import {
  AgentCapability,
  AgentIdentityService,
  AgentProtocol,
  buildAgentVerificationSigningPayload,
} from '../src/services/ai/agent-identity';

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

function signVerificationRequest(
  signing: ReturnType<typeof createSigningMaterial>,
  request: {
    agentId: string;
    challenge: string;
    requestedCapabilities: string[];
    context: {
      callerAgentId?: string;
      callerProtocol?: AgentProtocol;
      purpose: string;
      resourceId?: string;
    };
  },
): string {
  return signing.sign(buildAgentVerificationSigningPayload(request));
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

    const request = {
      agentId: agent.agentId,
      challenge,
      requestedCapabilities: ['payment.release'],
      context: {
        purpose: 'settlement release',
        resourceId: 'payment-1',
      },
    };
    const verification = await writer.verifyAgent({
      ...request,
      signature: signVerificationRequest(signing, request),
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

    const request = {
      agentId: delegate.agentId,
      challenge,
      requestedCapabilities: ['credential.verify'],
      context: {
        callerAgentId: delegator.agentId,
        purpose: 'delegated credential verification',
        resourceId: 'credential-1',
      },
    };
    const verification = await reader.verifyAgent({
      ...request,
      signature: signVerificationRequest(delegateSigning, request),
    });

    expect(verification.verified).toBe(true);
    expect(verification.authorizedCapabilities).toEqual(['credential.verify']);
  });

  it('rejects signatures rebound to different capabilities', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Bound Verifier',
      [delegatedCapability, approvalCapability],
      signing.publicKey,
    );
    const signedRequest = {
      agentId: agent.agentId,
      challenge: 'capability-binding-challenge',
      requestedCapabilities: ['credential.verify'],
      context: {
        purpose: 'credential verification',
        resourceId: 'credential-1',
      },
    };

    const verification = await service.verifyAgent({
      ...signedRequest,
      requestedCapabilities: ['payment.release'],
      signature: signVerificationRequest(signing, signedRequest),
    });

    expect(verification.verified).toBe(false);
    expect(verification.deniedCapabilities).toEqual([
      { name: 'payment.release', reason: 'Signature verification failed' },
    ]);
  });

  it('rejects replayed verification challenges', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Replay Guard',
      [delegatedCapability],
      signing.publicKey,
    );
    const request = {
      agentId: agent.agentId,
      challenge: 'single-use-verification-challenge',
      requestedCapabilities: ['credential.verify'],
      context: {
        purpose: 'credential verification',
        resourceId: 'credential-1',
      },
    };
    const signature = signVerificationRequest(signing, request);

    const first = await service.verifyAgent({ ...request, signature });
    const second = await service.verifyAgent({ ...request, signature });

    expect(first.verified).toBe(true);
    expect(second.verified).toBe(false);
    expect(second.deniedCapabilities).toEqual([
      { name: 'credential.verify', reason: 'Challenge has already been used' },
    ]);
  });
});
