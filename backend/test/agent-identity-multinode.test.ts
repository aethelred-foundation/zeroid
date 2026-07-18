import crypto from 'crypto';

const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();
const mockAgentRows = new Map<string, Record<string, any>>();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockAgentActionCreate = jest.fn();

function mockCloneAgent(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.map((capability: Record<string, any>) => ({ ...capability }))
      : row.capabilities,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? { ...row.metadata }
        : row.metadata,
  };
}

function mockApplyAgentData(
  row: Record<string, any>,
  data: Record<string, any>,
): Record<string, any> {
  const updated = mockCloneAgent(row);
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.increment === 'number'
    ) {
      updated[key] = (updated[key] ?? 0) + value.increment;
    } else {
      updated[key] = value;
    }
  }
  updated.updatedAt = new Date();
  return updated;
}

function mockAgentMatches(
  row: Record<string, any>,
  where: Record<string, any> = {},
): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const mockAIAgentCreate = jest.fn(async ({ data }: { data: Record<string, any> }) => {
  const now = new Date();
  const row: Record<string, any> = {
    id: data.id,
    agentDid: data.agentDid,
    name: data.name,
    description: data.description ?? null,
    operatorId: data.operatorId,
    controllerDid: data.controllerDid ?? null,
    riskTier: data.riskTier ?? 'LOW',
    agentType: data.agentType,
    agentProtocol: data.agentProtocol ?? null,
    publicKey: data.publicKey ?? null,
    publicKeyHash: data.publicKeyHash ?? null,
    capabilities: data.capabilities,
    delegationChain: data.delegationChain ?? null,
    maxDelegationDepth: data.maxDelegationDepth ?? 3,
    reputationScore: data.reputationScore ?? 50,
    status: data.status ?? 'PENDING_APPROVAL',
    humanApprovalRequired: data.humanApprovalRequired ?? true,
    rateLimitPerMinute: data.rateLimitPerMinute ?? 60,
    teeAttested: data.teeAttested ?? false,
    teeAttestationId: data.teeAttestationId ?? null,
    totalActions: data.totalActions ?? 0,
    actionsToday: data.actionsToday ?? 0,
    successfulActions: data.successfulActions ?? 0,
    totalLatencyMs: data.totalLatencyMs ?? 0,
    anomalyCount: data.anomalyCount ?? 0,
    lastAnomalyAt: data.lastAnomalyAt ?? null,
    suspendedAt: data.suspendedAt ?? null,
    suspendedBy: data.suspendedBy ?? null,
    suspensionReason: data.suspensionReason ?? null,
    version: data.version ?? 0,
    metadata: data.metadata ?? null,
    lastActiveAt: data.lastActiveAt ?? null,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
  mockAgentRows.set(row.id, row);
  return mockCloneAgent(row);
});

const mockAIAgentFindUnique = jest.fn(async ({
  where,
  include,
}: {
  where: { id?: string; agentDid?: string };
  include?: Record<string, unknown>;
}) => {
  const row = where.id
    ? mockAgentRows.get(where.id)
    : Array.from(mockAgentRows.values()).find(
        (candidate) => candidate.agentDid === where.agentDid,
      );
  if (!row) return null;
  const result = mockCloneAgent(row);
  if (include) {
    result.operator = { did: 'did:aethelred:operator' };
    result.agentCredentials = [];
  }
  return result;
});

const mockAIAgentFindMany = jest.fn(async ({
  where,
}: {
  where: Record<string, any>;
}) => Array.from(mockAgentRows.values())
  .filter((row) => mockAgentMatches(row, where))
  .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  .map(mockCloneAgent));

const mockAIAgentUpdate = jest.fn(async ({
  where,
  data,
}: {
  where: { id: string };
  data: Record<string, any>;
}) => {
  const row = mockAgentRows.get(where.id);
  if (!row) throw new Error('AIAgent not found');
  const updated = mockApplyAgentData(row, data);
  mockAgentRows.set(where.id, updated);
  return mockCloneAgent(updated);
});

const mockAIAgentUpdateMany = jest.fn(async ({
  where,
  data,
}: {
  where: Record<string, any>;
  data: Record<string, any>;
}) => {
  let count = 0;
  for (const [id, row] of mockAgentRows.entries()) {
    if (!mockAgentMatches(row, where)) continue;
    mockAgentRows.set(id, mockApplyAgentData(row, data));
    count++;
  }
  return { count };
});

const mockAIAgent = {
  create: mockAIAgentCreate,
  findUnique: mockAIAgentFindUnique,
  findMany: mockAIAgentFindMany,
  update: mockAIAgentUpdate,
  updateMany: mockAIAgentUpdateMany,
};

const mockPrismaTransaction = jest.fn(async (
  callback: (tx: Record<string, any>) => Promise<unknown>,
) => callback({
  aIAgent: mockAIAgent,
  auditLog: { create: mockAuditLogCreate },
}));

const mockPrisma = {
  identity: { findUnique: mockIdentityFindUnique },
  aIAgent: mockAIAgent,
  agentAction: { create: mockAgentActionCreate },
  auditLog: { create: mockAuditLogCreate },
  $transaction: mockPrismaTransaction,
};

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
  prisma: mockPrisma,
  redis: mockRedis,
  verificationCounter: { inc: jest.fn() },
}));

// This suite exercises only the eligibility dependency loader. Avoid loading
// the full proof/TEE route graph, which owns separate integration coverage.
jest.mock('../src/routes/verification', () => ({
  eligibilityProofHandler: jest.fn(),
}));

import {
  AgentCapability,
  AgentIdentityService,
  AgentProtocol,
  buildAgentVerificationSigningPayload,
} from '../src/services/ai/agent-identity';
import { buildAgentEligibilityDeps } from '../src/routes/ai/agent-eligibility';

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
    mockAgentRows.clear();
    mockIdentityFindUnique.mockResolvedValue({
      id: operatorId,
      did: 'did:aethelred:operator',
      status: 'ACTIVE',
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit-entry' });
    mockAgentActionCreate.mockResolvedValue({ id: 'agent-action' });
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

  it('rejects suspension by an unrelated active identity', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Protected Agent',
      [delegatedCapability],
      signing.publicKey,
    );

    mockIdentityFindUnique.mockResolvedValue({
      id: 'identity-unrelated-active',
      did: 'did:aethelred:unrelated',
      status: 'ACTIVE',
    });

    await expect(
      service.suspendAgent(
        agent.agentId,
        'identity-unrelated-active',
        'Cross-tenant suspension attempt',
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED_SUSPENSION',
      statusCode: 403,
    });

    const unchangedAgent = await service.getAgent(agent.agentId);
    expect(unchangedAgent.status).toBe('active');
    expect(unchangedAgent.suspendedBy).toBeUndefined();
    expect(mockAuditLogCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'AGENT_SUSPENDED' }),
      }),
    );
  });

  it('allows the owning operator to suspend an agent', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Operator Controlled Agent',
      [delegatedCapability],
      signing.publicKey,
    );

    const suspended = await service.suspendAgent(
      agent.agentId,
      operatorId,
      'Operator requested suspension',
    );

    expect(suspended).toMatchObject({
      agentId: agent.agentId,
      operatorId,
      status: 'suspended',
      suspendedBy: operatorId,
      suspensionReason: 'Operator requested suspension',
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: operatorId,
        action: 'AGENT_SUSPENDED',
        resourceType: 'agent_identity',
        resourceId: agent.agentId,
      }),
    });
  });

  it('registers agent identity and audit atomically in the eligibility-compatible row', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();

    const registered = await registerServiceAgent(
      service,
      'Eligibility Agent',
      [delegatedCapability],
      signing.publicKey,
    );

    const persisted = mockAgentRows.get(registered.agentId);
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      id: registered.agentId,
      agentDid: registered.did,
      operatorId,
      controllerDid: 'did:aethelred:operator',
      status: 'ACTIVE',
      agentProtocol: 'aethelred_native',
      publicKey: signing.publicKey,
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: operatorId,
        action: 'AGENT_REGISTERED',
        resourceId: registered.agentId,
      }),
    });

    const eligibility = buildAgentEligibilityDeps({
      id: operatorId,
      did: 'did:aethelred:operator',
    } as any);
    await expect(eligibility.loadAgent(registered.did)).resolves.toMatchObject({
      agentDid: registered.did,
      controllerDid: 'did:aethelred:operator',
      agentStatus: 'ACTIVE',
      credentialStatus: 'REVOKED',
    });
  });

  it('recovers get and list operations from Prisma after Redis loss and process restart', async () => {
    const writer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const registered = await registerServiceAgent(
      writer,
      'Restart Durable Agent',
      [delegatedCapability],
      signing.publicKey,
    );

    redisStore.clear();
    redisSets.clear();
    const restarted = new AgentIdentityService();

    const recovered = await restarted.getAgent(registered.agentId);
    const listed = await restarted.listAgentsForOperator(operatorId);

    expect(recovered).toMatchObject({
      agentId: registered.agentId,
      did: registered.did,
      status: 'active',
      publicKey: signing.publicKey,
      agentProtocol: 'aethelred_native',
    });
    expect(listed.map((agent) => agent.agentId)).toEqual([registered.agentId]);
    expect(redisStore.has(`agent:${registered.agentId}`)).toBe(true);
  });

  it('persists capability updates and optimistic versioning across process restart', async () => {
    const writer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const registered = await registerServiceAgent(
      writer,
      'Capability Durable Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const updatedCapability: AgentCapability = {
      ...delegatedCapability,
      description: 'Verify credentials with the durable production policy',
      riskLevel: 'high',
    };

    const updated = await writer.updateCapabilities(
      registered.agentId,
      [updatedCapability],
      operatorId,
    );

    redisStore.clear();
    redisSets.clear();
    const recovered = await new AgentIdentityService().getAgent(registered.agentId);

    expect(updated.recordVersion).toBe(1);
    expect(recovered.recordVersion).toBe(1);
    expect(recovered.capabilities).toEqual([updatedCapability]);
    expect(mockAgentRows.get(registered.agentId)?.capabilities).toEqual([
      updatedCapability,
    ]);
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: operatorId,
        action: 'AGENT_CAPABILITIES_UPDATED',
        resourceId: registered.agentId,
      }),
    });
  });

  it('persists verification statistics atomically across process restart', async () => {
    const writer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const registered = await registerServiceAgent(
      writer,
      'Statistics Durable Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const request = {
      agentId: registered.agentId,
      challenge: 'durable-statistics-challenge',
      requestedCapabilities: ['credential.verify'],
      context: {
        purpose: 'durable credential verification',
        resourceId: 'credential-durable-1',
      },
    };

    const result = await writer.verifyAgent({
      ...request,
      signature: signVerificationRequest(signing, request),
    });
    expect(result.verified).toBe(true);

    redisStore.clear();
    redisSets.clear();
    const recovered = await new AgentIdentityService().getAgent(registered.agentId);

    expect(recovered.stats).toMatchObject({
      totalActions: 1,
      successRate: 1,
      anomalyCount: 0,
    });
    expect(recovered.stats.averageLatencyMs).toBeGreaterThan(0);
    expect(mockAgentRows.get(registered.agentId)).toMatchObject({
      totalActions: 1,
      successfulActions: 1,
    });
  });

  it('fails legacy rows without durable verification material closed', async () => {
    const writer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const registered = await registerServiceAgent(
      writer,
      'Legacy Incomplete Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const persisted = mockAgentRows.get(registered.agentId)!;
    mockAgentRows.set(registered.agentId, {
      ...persisted,
      agentProtocol: null,
      publicKey: null,
      publicKeyHash: null,
    });
    redisStore.clear();
    redisSets.clear();

    await expect(
      new AgentIdentityService().getAgent(registered.agentId),
    ).rejects.toMatchObject({
      code: 'AGENT_RECORD_INCOMPLETE',
      statusCode: 503,
    });
  });

  it('automatically suspends on the tenth anomaly through the private audited path', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const registered = await registerServiceAgent(
      service,
      'Anomaly Guard Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const invalidSignature = Buffer.alloc(64).toString('base64');

    for (let attempt = 1; attempt <= 10; attempt++) {
      const result = await service.verifyAgent({
        agentId: registered.agentId,
        challenge: `invalid-signature-${attempt}`,
        signature: invalidSignature,
        requestedCapabilities: ['credential.verify'],
        context: {
          purpose: 'anomaly threshold test',
          resourceId: `credential-${attempt}`,
        },
      });
      expect(result.verified).toBe(false);
      expect(mockAgentRows.get(registered.agentId)?.anomalyCount).toBe(attempt);
      expect(mockAgentRows.get(registered.agentId)?.status).toBe(
        attempt === 10 ? 'SUSPENDED' : 'ACTIVE',
      );
    }

    redisStore.clear();
    redisSets.clear();
    const recovered = await new AgentIdentityService().getAgent(registered.agentId);

    expect(recovered).toMatchObject({
      agentId: registered.agentId,
      status: 'suspended',
      suspendedBy: 'internal:anomaly-detector',
      suspensionReason: 'Automatic suspension: 10 anomalies detected',
      stats: { anomalyCount: 10 },
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: operatorId,
        action: 'AGENT_SUSPENDED',
        resourceId: registered.agentId,
        details: expect.objectContaining({
          suspendedBy: 'internal:anomaly-detector',
          source: 'anomaly-threshold',
          automatic: true,
          anomalyCount: 10,
        }),
      }),
    });
    expect(mockIdentityFindUnique).toHaveBeenCalledTimes(1);
    expect(mockIdentityFindUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'internal:anomaly-detector' },
      }),
    );
  });
});
