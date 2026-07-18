import crypto from 'crypto';

const redisStore = new Map<string, string>();
const redisSets = new Map<string, Set<string>>();
const mockAgentRows = new Map<string, Record<string, any>>();
const mockDelegationRows = new Map<string, Record<string, any>>();
const mockApprovalRows = new Map<string, Record<string, any>>();
const mockChallengeRows = new Map<string, Record<string, any>>();
const mockVerificationFailureRows = new Map<string, Record<string, any>>();
const mockAuthorizationUsageRows = new Map<string, Record<string, any>>();
const mockAuthorizationOperationRows = new Map<string, Record<string, any>>();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockAuditLogFindMany = jest.fn();
const mockAgentActionCreate = jest.fn();

function mockCloneValue(value: any): any {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(mockCloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mockCloneValue(item)]),
    );
  }
  return value;
}

function mockCloneAgent(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.map((capability: unknown) =>
          capability && typeof capability === 'object'
            ? { ...(capability as Record<string, any>) }
            : capability,
        )
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
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (
        Array.isArray(value) &&
        value.some((candidate) => mockAgentMatches(row, candidate))
      );
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const condition = value as Record<string, any>;
      if ('gt' in condition && !(row[key] > condition.gt)) return false;
      if ('gte' in condition && !(row[key] >= condition.gte)) return false;
      if ('lt' in condition && !(row[key] < condition.lt)) return false;
      if ('lte' in condition && !(row[key] <= condition.lte)) return false;
      if ('in' in condition && !condition.in.includes(row[key])) return false;
      if ('has' in condition && !row[key]?.includes(condition.has))
        return false;
      if (
        'hasEvery' in condition &&
        !condition.hasEvery.every((item: string) => row[key]?.includes(item))
      )
        return false;
      return true;
    }
    if (value instanceof Date && row[key] instanceof Date) {
      return row[key].getTime() === value.getTime();
    }
    return row[key] === value;
  });
}

const mockAIAgentCreate = jest.fn(
  async ({ data }: { data: Record<string, any> }) => {
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
      authorizationVersion: data.authorizationVersion ?? 0,
      metadata: data.metadata ?? null,
      lastActiveAt: data.lastActiveAt ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
    mockAgentRows.set(row.id, row);
    return mockCloneAgent(row);
  },
);

const mockAIAgentFindUnique = jest.fn(
  async ({
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
  },
);

const mockAIAgentFindMany = jest.fn(
  async ({ where }: { where: Record<string, any> }) =>
    Array.from(mockAgentRows.values())
      .filter((row) => mockAgentMatches(row, where))
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )
      .map(mockCloneAgent),
);

const mockAIAgentUpdate = jest.fn(
  async ({
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
  },
);

const mockAIAgentUpdateMany = jest.fn(
  async ({
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
  },
);

const mockAIAgent = {
  create: mockAIAgentCreate,
  findUnique: mockAIAgentFindUnique,
  findMany: mockAIAgentFindMany,
  update: mockAIAgentUpdate,
  updateMany: mockAIAgentUpdateMany,
};

const mockAgentDelegationCreate = jest.fn(
  async ({ data }: { data: Record<string, any> }) => {
    const row = {
      id: data.id,
      fromAgentId: data.fromAgentId,
      toAgentId: data.toAgentId,
      capabilities: [...data.capabilities],
      constraints: mockCloneValue(data.constraints),
      depth: data.depth,
      maxDepth: data.maxDepth,
      status: data.status ?? 'ACTIVE',
      parentDelegationId: data.parentDelegationId ?? null,
      createdAt: data.createdAt ?? new Date(),
      expiresAt: data.expiresAt,
      revokedAt: data.revokedAt ?? null,
      revokedBy: data.revokedBy ?? null,
      authorizationCount: data.authorizationCount ?? 0,
      lastAuthorizedAt: data.lastAuthorizedAt ?? null,
      version: data.version ?? 0,
    };
    mockDelegationRows.set(row.id, row);
    return mockCloneValue(row);
  },
);

const mockAgentDelegationFindUnique = jest.fn(
  async ({ where }: { where: { id: string } }) => {
    const row = mockDelegationRows.get(where.id);
    return row ? mockCloneValue(row) : null;
  },
);

const mockAgentDelegationFindMany = jest.fn(
  async ({
    where = {},
    orderBy,
  }: {
    where?: Record<string, any>;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }) => {
    const rows = Array.from(mockDelegationRows.values()).filter((row) =>
      mockAgentMatches(row, where),
    );
    if (orderBy?.createdAt) {
      rows.sort((left, right) =>
        orderBy.createdAt === 'asc'
          ? left.createdAt.getTime() - right.createdAt.getTime()
          : right.createdAt.getTime() - left.createdAt.getTime(),
      );
    }
    return rows.map(mockCloneValue);
  },
);

const mockAgentDelegationUpdateMany = jest.fn(
  async ({
    where = {},
    data,
  }: {
    where?: Record<string, any>;
    data: Record<string, any>;
  }) => {
    let count = 0;
    for (const [id, row] of mockDelegationRows.entries()) {
      if (!mockAgentMatches(row, where)) continue;
      mockDelegationRows.set(id, mockApplyAgentData(row, data));
      count++;
    }
    return { count };
  },
);

const mockAgentDelegation = {
  create: mockAgentDelegationCreate,
  findUnique: mockAgentDelegationFindUnique,
  findMany: mockAgentDelegationFindMany,
  updateMany: mockAgentDelegationUpdateMany,
};

const mockAgentApprovalRequestCreate = jest.fn(
  async ({ data }: { data: Record<string, any> }) => {
    const row = {
      id: data.id,
      approvalGroupId: data.approvalGroupId,
      operationId: data.operationId,
      operationDigest: data.operationDigest,
      authorizationSnapshotDigest: data.authorizationSnapshotDigest,
      requestedCapabilities: [...data.requestedCapabilities],
      requiredApproverIds: [...data.requiredApproverIds],
      agentId: data.agentId,
      audienceId: data.audienceId,
      operatorId: data.operatorId,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      riskLevel: data.riskLevel,
      context: mockCloneValue(data.context),
      status: data.status ?? 'PENDING',
      createdAt: data.createdAt ?? new Date(),
      expiresAt: data.expiresAt,
      respondedAt: data.respondedAt ?? null,
      respondedBy: data.respondedBy ?? null,
      responseNote: data.responseNote ?? null,
      consumedAt: data.consumedAt ?? null,
      consumedByChallengeId: data.consumedByChallengeId ?? null,
      version: data.version ?? 0,
    };
    mockApprovalRows.set(row.id, row);
    return mockCloneValue(row);
  },
);

const mockAgentApprovalRequestCreateMany = jest.fn(
  async ({
    data,
    skipDuplicates,
  }: {
    data: Record<string, any>[];
    skipDuplicates?: boolean;
  }) => {
    let count = 0;
    for (const item of data) {
      const duplicate = Array.from(mockApprovalRows.values()).find(
        (row) =>
          row.approvalGroupId === item.approvalGroupId &&
          row.operatorId === item.operatorId,
      );
      if (duplicate && skipDuplicates) continue;
      await mockAgentApprovalRequestCreate({ data: item });
      count++;
    }
    return { count };
  },
);

const mockAgentApprovalRequestFindUnique = jest.fn(
  async ({ where }: { where: { id: string } }) => {
    const row = mockApprovalRows.get(where.id);
    return row ? mockCloneValue(row) : null;
  },
);

const mockAgentApprovalRequestFindMany = jest.fn(
  async ({
    where = {},
    orderBy,
  }: {
    where?: Record<string, any>;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }) => {
    const rows = Array.from(mockApprovalRows.values()).filter((row) =>
      mockAgentMatches(row, where),
    );
    if (orderBy?.createdAt) {
      rows.sort((left, right) =>
        orderBy.createdAt === 'asc'
          ? left.createdAt.getTime() - right.createdAt.getTime()
          : right.createdAt.getTime() - left.createdAt.getTime(),
      );
    }
    return rows.map(mockCloneValue);
  },
);

const mockAgentApprovalRequestUpdateMany = jest.fn(
  async ({
    where = {},
    data,
  }: {
    where?: Record<string, any>;
    data: Record<string, any>;
  }) => {
    let count = 0;
    for (const [id, row] of mockApprovalRows.entries()) {
      if (!mockAgentMatches(row, where)) continue;
      mockApprovalRows.set(id, mockApplyAgentData(row, data));
      count++;
    }
    return { count };
  },
);

const mockAgentApprovalRequest = {
  create: mockAgentApprovalRequestCreate,
  createMany: mockAgentApprovalRequestCreateMany,
  findUnique: mockAgentApprovalRequestFindUnique,
  findMany: mockAgentApprovalRequestFindMany,
  updateMany: mockAgentApprovalRequestUpdateMany,
};

const mockAgentVerificationChallengeCreate = jest.fn(
  async ({ data }: { data: Record<string, any> }) => {
    const row = {
      id: data.id,
      agentId: data.agentId,
      audienceId: data.audienceId,
      nonceHash: data.nonceHash,
      operationId: data.operationId,
      operationDigest: data.operationDigest,
      requestedCapabilities: [...data.requestedCapabilities],
      context: mockCloneValue(data.context),
      approvalGroupId: data.approvalGroupId ?? null,
      status: data.status ?? 'ISSUED',
      issuedAt: data.issuedAt ?? new Date(),
      expiresAt: data.expiresAt,
      consumedAt: data.consumedAt ?? null,
      version: data.version ?? 0,
    };
    mockChallengeRows.set(row.id, row);
    return mockCloneValue(row);
  },
);

const mockAgentVerificationChallengeFindUnique = jest.fn(
  async ({ where }: { where: { id: string } }) => {
    const row = mockChallengeRows.get(where.id);
    return row ? mockCloneValue(row) : null;
  },
);

const mockAgentVerificationChallengeUpdateMany = jest.fn(
  async ({
    where = {},
    data,
  }: {
    where?: Record<string, any>;
    data: Record<string, any>;
  }) => {
    let count = 0;
    for (const [id, row] of mockChallengeRows.entries()) {
      if (!mockAgentMatches(row, where)) continue;
      mockChallengeRows.set(id, mockApplyAgentData(row, data));
      count++;
    }
    return { count };
  },
);

const mockAgentVerificationChallenge = {
  create: mockAgentVerificationChallengeCreate,
  findUnique: mockAgentVerificationChallengeFindUnique,
  updateMany: mockAgentVerificationChallengeUpdateMany,
};

const mockAgentVerificationFailureWindowFindUnique = jest.fn(
  async ({ where }: { where: Record<string, Record<string, any>> }) => {
    const unique = where.audienceId_agentId_windowStart;
    const key = `${unique.audienceId}|${unique.agentId}|${unique.windowStart.toISOString()}`;
    const row = mockVerificationFailureRows.get(key);
    return row ? mockCloneValue(row) : null;
  },
);

const mockAgentVerificationFailureWindowUpsert = jest.fn(
  async ({
    where,
    create,
    update,
  }: {
    where: Record<string, Record<string, any>>;
    create: Record<string, any>;
    update: Record<string, any>;
  }) => {
    const unique = where.audienceId_agentId_windowStart;
    const key = `${unique.audienceId}|${unique.agentId}|${unique.windowStart.toISOString()}`;
    const existing = mockVerificationFailureRows.get(key);
    if (existing) {
      const updated = mockApplyAgentData(existing, update);
      mockVerificationFailureRows.set(key, updated);
      return mockCloneValue(updated);
    }
    const row = {
      id: `failure-${mockVerificationFailureRows.size + 1}`,
      ...mockCloneValue(create),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockVerificationFailureRows.set(key, row);
    return mockCloneValue(row);
  },
);

const mockAgentVerificationFailureWindow = {
  findUnique: mockAgentVerificationFailureWindowFindUnique,
  upsert: mockAgentVerificationFailureWindowUpsert,
};

const mockAgentAuthorizationUsageUpsert = jest.fn(
  async ({
    where,
    create,
    update,
  }: {
    where: Record<string, Record<string, any>>;
    create: Record<string, any>;
    update: Record<string, any>;
  }) => {
    const unique = where.agentId_scopeKey_capability_windowType_windowStart;
    const key = [
      unique.agentId,
      unique.scopeKey,
      unique.capability,
      unique.windowType,
      unique.windowStart.toISOString(),
    ].join('|');
    const current = mockAuthorizationUsageRows.get(key);
    if (current) {
      const updated = mockApplyAgentData(current, update);
      mockAuthorizationUsageRows.set(key, updated);
      return mockCloneValue(updated);
    }
    const now = new Date();
    const row = {
      id: `usage-${mockAuthorizationUsageRows.size + 1}`,
      ...mockCloneValue(create),
      count: create.count ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    mockAuthorizationUsageRows.set(key, row);
    return mockCloneValue(row);
  },
);

const mockAgentAuthorizationUsage = {
  upsert: mockAgentAuthorizationUsageUpsert,
};

const mockAgentAuthorizationOperationCreate = jest.fn(
  async ({ data }: { data: Record<string, any> }) => {
    const duplicate = Array.from(mockAuthorizationOperationRows.values()).find(
      (row) =>
        (row.agentId === data.agentId &&
          row.audienceId === data.audienceId &&
          row.operationId === data.operationId) ||
        row.operationDigest === data.operationDigest,
    );
    if (duplicate) {
      throw Object.assign(new Error('Unique operation claim'), {
        code: 'P2002',
        meta: { target: ['agentId', 'audienceId', 'operationId'] },
      });
    }
    const now = new Date();
    const row = {
      id:
        data.id ??
        `authorization-operation-${mockAuthorizationOperationRows.size + 1}`,
      agentId: data.agentId,
      audienceId: data.audienceId,
      operationId: data.operationId,
      operationDigest: data.operationDigest,
      status: data.status,
      approvalGroupId: data.approvalGroupId ?? null,
      initialChallengeId: data.initialChallengeId,
      initialVerificationId: data.initialVerificationId,
      authorizedChallengeId: data.authorizedChallengeId ?? null,
      authorizationVerificationId: data.authorizationVerificationId ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
      authorizedAt: data.authorizedAt ?? null,
      version: data.version ?? 0,
    };
    mockAuthorizationOperationRows.set(row.id, row);
    return mockCloneValue(row);
  },
);

const mockAgentAuthorizationOperationFindUnique = jest.fn(
  async ({ where }: { where: Record<string, any> }) => {
    if (where.id) {
      const row = mockAuthorizationOperationRows.get(where.id);
      return row ? mockCloneValue(row) : null;
    }
    const unique = where.agentId_audienceId_operationId;
    const row = Array.from(mockAuthorizationOperationRows.values()).find(
      (candidate) =>
        candidate.agentId === unique.agentId &&
        candidate.audienceId === unique.audienceId &&
        candidate.operationId === unique.operationId,
    );
    return row ? mockCloneValue(row) : null;
  },
);

const mockAgentAuthorizationOperationUpdateMany = jest.fn(
  async ({
    where = {},
    data,
  }: {
    where?: Record<string, any>;
    data: Record<string, any>;
  }) => {
    let count = 0;
    for (const [id, row] of mockAuthorizationOperationRows.entries()) {
      if (!mockAgentMatches(row, where)) continue;
      mockAuthorizationOperationRows.set(id, mockApplyAgentData(row, data));
      count++;
    }
    return { count };
  },
);

const mockAgentAuthorizationOperation = {
  create: mockAgentAuthorizationOperationCreate,
  findUnique: mockAgentAuthorizationOperationFindUnique,
  updateMany: mockAgentAuthorizationOperationUpdateMany,
};

async function runMockTransaction(
  callback: (tx: Record<string, any>) => Promise<unknown>,
): Promise<unknown> {
  const snapshots = [
    [
      mockAgentRows,
      new Map(
        Array.from(mockAgentRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockDelegationRows,
      new Map(
        Array.from(mockDelegationRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockApprovalRows,
      new Map(
        Array.from(mockApprovalRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockChallengeRows,
      new Map(
        Array.from(mockChallengeRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockVerificationFailureRows,
      new Map(
        Array.from(mockVerificationFailureRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockAuthorizationUsageRows,
      new Map(
        Array.from(mockAuthorizationUsageRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
    [
      mockAuthorizationOperationRows,
      new Map(
        Array.from(mockAuthorizationOperationRows, ([key, value]) => [
          key,
          mockCloneValue(value),
        ]),
      ),
    ],
  ] as const;
  try {
    return await callback({
      aIAgent: mockAIAgent,
      agentDelegation: mockAgentDelegation,
      agentApprovalRequest: mockAgentApprovalRequest,
      agentVerificationChallenge: mockAgentVerificationChallenge,
      agentVerificationFailureWindow: mockAgentVerificationFailureWindow,
      agentAuthorizationUsage: mockAgentAuthorizationUsage,
      agentAuthorizationOperation: mockAgentAuthorizationOperation,
      identity: { findUnique: mockIdentityFindUnique },
      auditLog: { create: mockAuditLogCreate, findMany: mockAuditLogFindMany },
    });
  } catch (error) {
    for (const [target, snapshot] of snapshots) {
      target.clear();
      for (const [key, value] of snapshot) target.set(key, value);
    }
    throw error;
  }
}

const mockPrismaTransaction = jest.fn(runMockTransaction);

const mockPrisma = {
  identity: { findUnique: mockIdentityFindUnique },
  aIAgent: mockAIAgent,
  agentDelegation: mockAgentDelegation,
  agentApprovalRequest: mockAgentApprovalRequest,
  agentVerificationChallenge: mockAgentVerificationChallenge,
  agentVerificationFailureWindow: mockAgentVerificationFailureWindow,
  agentAuthorizationUsage: mockAgentAuthorizationUsage,
  agentAuthorizationOperation: mockAgentAuthorizationOperation,
  agentAction: { create: mockAgentActionCreate },
  auditLog: { create: mockAuditLogCreate, findMany: mockAuditLogFindMany },
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
  smembers: jest.fn(async (key: string) =>
    Array.from(redisSets.get(key) ?? []),
  ),
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
  del: jest.fn(async (...keys: string[]) => {
    let removed = 0;
    for (const key of keys) {
      if (redisStore.delete(key)) removed++;
      if (redisSets.delete(key)) removed++;
    }
    return removed;
  }),
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
  AgentVerificationRequest,
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
    sign: (message: string) =>
      crypto
        .sign(null, Buffer.from(message, 'utf8'), privateKey)
        .toString('base64'),
  };
}

function signVerificationRequest(
  signing: ReturnType<typeof createSigningMaterial>,
  request: Omit<AgentVerificationRequest, 'signature'>,
): string {
  return signing.sign(buildAgentVerificationSigningPayload(request));
}

function operationContext(
  operationId: string,
  overrides: Partial<AgentVerificationRequest['context']> = {},
): AgentVerificationRequest['context'] {
  return {
    operationId,
    purpose: 'production authorization test',
    resourceId: 'credential-1',
    resourceType: 'credential',
    action: 'verify',
    ...overrides,
  };
}

async function issueSignedVerification(
  service: AgentIdentityService,
  signing: ReturnType<typeof createSigningMaterial>,
  agentId: string,
  requestedCapabilities: string[],
  context: AgentVerificationRequest['context'],
  options: { audienceId?: string; approvalGroupId?: string } = {},
): Promise<AgentVerificationRequest> {
  const audienceId = options.audienceId ?? operatorId;
  const challenge = await service.issueVerificationChallenge(
    agentId,
    audienceId,
    {
      requestedCapabilities,
      context,
      approvalGroupId: options.approvalGroupId,
    },
  );
  return {
    ...challenge,
    signature: signVerificationRequest(signing, challenge),
  };
}

async function verifySignedOperation(
  service: AgentIdentityService,
  signing: ReturnType<typeof createSigningMaterial>,
  agentId: string,
  requestedCapabilities: string[],
  context: AgentVerificationRequest['context'],
  options: { audienceId?: string; approvalGroupId?: string } = {},
) {
  const request = await issueSignedVerification(
    service,
    signing,
    agentId,
    requestedCapabilities,
    context,
    options,
  );
  return service.verifyAgent(request, options.audienceId ?? operatorId);
}

async function registerServiceAgent(
  service: AgentIdentityService,
  name: string,
  capabilities: AgentCapability[],
  publicKey: string,
  maxDelegationDepth = 3,
  registrationOperatorId = operatorId,
) {
  return service.registerAgent({
    operatorId: registrationOperatorId,
    agentName: name,
    agentDescription: `${name} production control plane test fixture`,
    agentProtocol: 'aethelred_native',
    capabilities,
    publicKey,
    maxDelegationDepth,
    teeRequired: false,
  });
}

describe('Agent identity multi-node persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaTransaction.mockImplementation(runMockTransaction);
    redisStore.clear();
    redisSets.clear();
    mockAgentRows.clear();
    mockDelegationRows.clear();
    mockApprovalRows.clear();
    mockChallengeRows.clear();
    mockVerificationFailureRows.clear();
    mockAuthorizationUsageRows.clear();
    mockAuthorizationOperationRows.clear();
    mockIdentityFindUnique.mockResolvedValue({
      id: operatorId,
      did: 'did:aethelred:operator',
      status: 'ACTIVE',
    });
    mockAuditLogCreate.mockResolvedValue({ id: 'audit-entry' });
    mockAuditLogFindMany.mockResolvedValue([]);
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

  it('reads the agent audit endpoint from durable AuditLog evidence', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Durable Audit Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const timestamp = new Date('2026-05-01T00:00:00.000Z');
    mockAuditLogFindMany.mockResolvedValue([
      {
        id: 'audit-verification-1',
        action: 'VERIFICATION_FAILED',
        resourceType: 'agent_authorization',
        resourceId: 'av-1',
        details: {
          agentId: agent.agentId,
          reason: 'Signature verification failed',
          latencyMs: 12,
        },
        timestamp,
      },
    ]);

    const entries = await service.getAgentAudit(agent.agentId, 500);

    expect(mockAuditLogFindMany).toHaveBeenCalledWith({
      where: {
        identityId: operatorId,
        OR: [
          { resourceId: agent.agentId },
          { details: { path: ['agentId'], equals: agent.agentId } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        details: true,
        timestamp: true,
      },
    });
    expect(entries).toEqual([
      {
        entryId: 'audit-verification-1',
        agentId: agent.agentId,
        action: 'VERIFICATION_FAILED',
        resourceType: 'agent_authorization',
        resourceId: 'av-1',
        success: false,
        latencyMs: 12,
        error: 'Signature verification failed',
        anomalyDetected: false,
        timestamp,
      },
    ]);
  });

  it('shares pending approvals and responses across service instances', async () => {
    const writer = new AgentIdentityService();
    const reviewer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      writer,
      'Payments Controller',
      [approvalCapability],
      signing.publicKey,
    );

    const verification = await verifySignedOperation(
      writer,
      signing,
      agent.agentId,
      ['payment.release'],
      operationContext('approve-payment-release', {
        purpose: 'settlement release',
        resourceId: 'payment-1',
        resourceType: 'payment',
        action: 'release',
      }),
    );

    expect(verification.verified).toBe(false);
    const [approval] = await reviewer.listPendingApprovals(operatorId);

    expect(approval).toMatchObject({
      agentId: agent.agentId,
      action: 'release',
      status: 'pending',
    });

    await expect(
      reviewer.respondToApproval(
        approval.requestId,
        'identity-unrelated-active',
        true,
        'Cross-tenant approval attempt',
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED_APPROVAL',
      statusCode: 403,
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

  it('allows exactly one concurrent durable approval decision', async () => {
    const writer = new AgentIdentityService();
    const firstReviewer = new AgentIdentityService();
    const secondReviewer = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      writer,
      'Concurrent Approval Agent',
      [approvalCapability],
      signing.publicKey,
    );
    await verifySignedOperation(
      writer,
      signing,
      agent.agentId,
      ['payment.release'],
      operationContext('concurrent-approval', {
        purpose: 'concurrent approval decision',
        resourceId: 'payment-concurrent',
        resourceType: 'payment',
        action: 'release',
      }),
    );
    const [approval] = await writer.listPendingApprovals(operatorId);

    const outcomes = await Promise.allSettled([
      firstReviewer.respondToApproval(
        approval.requestId,
        operatorId,
        true,
        'First durable decision',
      ),
      secondReviewer.respondToApproval(
        approval.requestId,
        operatorId,
        false,
        'Conflicting durable decision',
      ),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({
      code: 'APPROVAL_ALREADY_RESOLVED',
      statusCode: 409,
    });
    const decisionAudits = mockAuditLogCreate.mock.calls.filter(
      ([entry]) =>
        entry.data.action === 'AGENT_ACTION_APPROVED' ||
        entry.data.action === 'AGENT_ACTION_REJECTED',
    );
    expect(decisionAudits).toHaveLength(1);

    redisStore.clear();
    redisSets.clear();
    await expect(
      new AgentIdentityService().listPendingApprovals(operatorId),
    ).resolves.toEqual([]);
  });

  it('expires approval requests durably and rejects late decisions', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Expiring Approval Agent',
      [approvalCapability],
      signing.publicKey,
    );
    await verifySignedOperation(
      service,
      signing,
      agent.agentId,
      ['payment.release'],
      operationContext('expiring-approval', {
        purpose: 'approval expiry test',
        resourceId: 'payment-expired',
        resourceType: 'payment',
        action: 'release',
      }),
    );
    const [approval] = await service.listPendingApprovals(operatorId);
    const persisted = mockApprovalRows.get(approval.requestId)!;
    persisted.createdAt = new Date(Date.now() - 48 * 3600_000);
    persisted.expiresAt = new Date(Date.now() - 24 * 3600_000);

    await expect(
      service.respondToApproval(
        approval.requestId,
        operatorId,
        true,
        'This decision is too late',
      ),
    ).rejects.toMatchObject({
      code: 'APPROVAL_EXPIRED',
      statusCode: 410,
    });
    expect(mockApprovalRows.get(approval.requestId)).toMatchObject({
      status: 'EXPIRED',
      version: 1,
    });
    await expect(service.listPendingApprovals(operatorId)).resolves.toEqual([]);
  });

  it('authorizes delegated capabilities from Prisma after Redis loss and restart', async () => {
    const writer = new AgentIdentityService();
    const reader = new AgentIdentityService();
    const delegatorSigning = createSigningMaterial();
    const delegateSigning = createSigningMaterial();

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

    const delegation = await writer.createDelegation(
      delegator.agentId,
      delegate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    redisStore.clear();
    redisSets.clear();

    const verification = await verifySignedOperation(
      reader,
      delegateSigning,
      delegate.agentId,
      ['credential.verify'],
      operationContext('delegated-verification', {
        callerAgentId: delegator.agentId,
        purpose: 'delegated credential verification',
      }),
    );

    expect(verification.verified).toBe(true);
    expect(verification.authorizedCapabilities).toEqual(['credential.verify']);
    expect(verification.delegationChain).toEqual([
      delegator.agentId,
      delegate.agentId,
    ]);
    expect(verification.expiresAt.getTime()).toBeLessThanOrEqual(
      delegation.expiresAt.getTime(),
    );
  });

  it('rejects non-Ed25519 registration keys and unsupported TEE enrollment', async () => {
    const service = new AgentIdentityService();
    const ed25519 = createSigningMaterial();
    const { publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const registration = {
      operatorId,
      agentName: 'Key Validation Agent',
      agentDescription: 'Agent used to validate production registration keys',
      agentProtocol: 'aethelred_native' as const,
      capabilities: [delegatedCapability],
      maxDelegationDepth: 2,
      teeRequired: false,
    };

    await expect(
      service.registerAgent({
        ...registration,
        publicKey: rsaPublicKey
          .export({ type: 'spki', format: 'pem' })
          .toString(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_PUBLIC_KEY_INVALID',
      statusCode: 400,
    });

    await expect(
      service.registerAgent({
        ...registration,
        publicKey: ed25519.publicKey,
        teeRequired: true,
      }),
    ).rejects.toMatchObject({
      code: 'TEE_ENROLLMENT_UNAVAILABLE',
      statusCode: 501,
    });

    expect(mockAgentRows).toHaveProperty('size', 0);
  });

  it('requires active delegation endpoints and revokes grants on suspension', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const firstTargetSigning = createSigningMaterial();
    const secondTargetSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Active Delegator',
      [delegatedCapability],
      rootSigning.publicKey,
    );
    const firstTarget = await registerServiceAgent(
      service,
      'First Delegation Target',
      [],
      firstTargetSigning.publicKey,
    );
    const secondTarget = await registerServiceAgent(
      service,
      'Second Delegation Target',
      [],
      secondTargetSigning.publicKey,
    );
    const delegation = await service.createDelegation(
      root.agentId,
      firstTarget.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );

    await service.suspendAgent(
      firstTarget.agentId,
      operatorId,
      'Target disabled by its operator',
    );
    expect(mockDelegationRows.get(delegation.delegationId)).toMatchObject({
      status: 'REVOKED',
      revokedBy: operatorId,
    });
    await expect(
      service.createDelegation(
        root.agentId,
        firstTarget.agentId,
        ['credential.verify'],
        [],
        1,
        operatorId,
      ),
    ).rejects.toMatchObject({ code: 'DELEGATION_AGENT_INACTIVE' });

    await service.suspendAgent(
      root.agentId,
      operatorId,
      'Source disabled by its operator',
    );
    await expect(
      service.createDelegation(
        root.agentId,
        secondTarget.agentId,
        ['credential.verify'],
        [],
        1,
        operatorId,
      ),
    ).rejects.toMatchObject({ code: 'DELEGATION_AGENT_INACTIVE' });
  });

  it('rejects delegation cycles and chains beyond the root maximum depth', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const bSigning = createSigningMaterial();
    const cSigning = createSigningMaterial();
    const dSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Depth Root',
      [delegatedCapability],
      rootSigning.publicKey,
      2,
    );
    const agentB = await registerServiceAgent(
      service,
      'Depth B',
      [],
      bSigning.publicKey,
      2,
    );
    const agentC = await registerServiceAgent(
      service,
      'Depth C',
      [],
      cSigning.publicKey,
      2,
    );
    const agentD = await registerServiceAgent(
      service,
      'Depth D',
      [],
      dSigning.publicKey,
      2,
    );

    const rootGrant = await service.createDelegation(
      root.agentId,
      agentB.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    await expect(
      service.createDelegation(
        agentB.agentId,
        root.agentId,
        ['credential.verify'],
        [],
        1,
        operatorId,
      ),
    ).rejects.toMatchObject({ code: 'DELEGATION_CYCLE' });
    const childGrant = await service.createDelegation(
      agentB.agentId,
      agentC.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    expect(childGrant.expiresAt.getTime()).toBeLessThanOrEqual(
      rootGrant.expiresAt.getTime(),
    );
    await expect(
      service.createDelegation(
        agentC.agentId,
        agentD.agentId,
        ['credential.verify'],
        [],
        1,
        operatorId,
      ),
    ).rejects.toMatchObject({ code: 'DELEGATION_DEPTH_EXCEEDED' });
    expect(mockDelegationRows).toHaveProperty('size', 2);
  });

  it('atomically revokes every derived delegation when root capabilities change', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const intermediateSigning = createSigningMaterial();
    const leafSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Capability Revocation Root',
      [delegatedCapability],
      rootSigning.publicKey,
      3,
    );
    const intermediate = await registerServiceAgent(
      service,
      'Capability Revocation Intermediate',
      [],
      intermediateSigning.publicKey,
      3,
    );
    const leaf = await registerServiceAgent(
      service,
      'Capability Revocation Leaf',
      [],
      leafSigning.publicKey,
      3,
    );
    const rootGrant = await service.createDelegation(
      root.agentId,
      intermediate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    const childGrant = await service.createDelegation(
      intermediate.agentId,
      leaf.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );

    await service.updateCapabilities(
      root.agentId,
      [{ ...delegatedCapability, description: 'Updated root authority' }],
      operatorId,
    );

    expect(mockDelegationRows.get(rootGrant.delegationId)).toMatchObject({
      status: 'REVOKED',
      version: 1,
      revokedBy: operatorId,
    });
    expect(mockDelegationRows.get(childGrant.delegationId)).toMatchObject({
      status: 'REVOKED',
      version: 1,
      revokedBy: operatorId,
    });
    const audit = mockAuditLogCreate.mock.calls.find(
      ([entry]) => entry.data.action === 'AGENT_CAPABILITIES_UPDATED',
    );
    expect(audit?.[0].data.details.revokedDelegationIds).toEqual([
      rootGrant.delegationId,
      childGrant.delegationId,
    ]);
  });

  it('owner-revokes one delegation with every active descendant using CAS', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const intermediateSigning = createSigningMaterial();
    const leafSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Manual Revocation Root',
      [delegatedCapability],
      rootSigning.publicKey,
      3,
    );
    const intermediate = await registerServiceAgent(
      service,
      'Manual Revocation Intermediate',
      [],
      intermediateSigning.publicKey,
      3,
    );
    const leaf = await registerServiceAgent(
      service,
      'Manual Revocation Leaf',
      [],
      leafSigning.publicKey,
      3,
    );
    const rootGrant = await service.createDelegation(
      root.agentId,
      intermediate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    const childGrant = await service.createDelegation(
      intermediate.agentId,
      leaf.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );

    await expect(
      service.revokeDelegation(
        rootGrant.delegationId,
        'identity-unrelated-active',
        root.agentId,
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED_DELEGATION_REVOCATION',
      statusCode: 403,
    });
    const revoked = await service.revokeDelegation(
      rootGrant.delegationId,
      operatorId,
      root.agentId,
    );

    expect(revoked).toMatchObject({
      delegation: { status: 'revoked', revokedBy: operatorId },
      revokedDelegationIds: [rootGrant.delegationId, childGrant.delegationId],
    });
    expect(mockDelegationRows.get(childGrant.delegationId)).toMatchObject({
      status: 'REVOKED',
      version: 1,
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityId: operatorId,
        action: 'DELEGATION_REVOKED',
        resourceId: rootGrant.delegationId,
      }),
    });
  });

  it('revalidates delegated creation authority inside the serializable transaction', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const targetSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Creation CAS Root',
      [delegatedCapability],
      rootSigning.publicKey,
    );
    const target = await registerServiceAgent(
      service,
      'Creation CAS Target',
      [],
      targetSigning.publicKey,
    );
    mockPrismaTransaction.mockImplementationOnce(async (callback) => {
      const row = mockAgentRows.get(root.agentId)!;
      row.capabilities = [];
      row.authorizationVersion += 1;
      return runMockTransaction(callback);
    });

    await expect(
      service.createDelegation(
        root.agentId,
        target.agentId,
        ['credential.verify'],
        [],
        1,
        operatorId,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CAPABILITIES' });
    expect(mockDelegationRows).toHaveProperty('size', 0);
  });

  it('enforces signed action/resource, server-derived risk, and durable rate constraints', async () => {
    const service = new AgentIdentityService();
    const delegatorSigning = createSigningMaterial();
    const delegateSigning = createSigningMaterial();
    const constrainedCapability: AgentCapability = {
      ...delegatedCapability,
      actions: ['verify', 'inspect'],
      resourceTypes: ['credential', 'document'],
    };
    const delegator = await registerServiceAgent(
      service,
      'Constraint Delegator',
      [constrainedCapability],
      delegatorSigning.publicKey,
    );
    const delegate = await registerServiceAgent(
      service,
      'Constraint Delegate',
      [],
      delegateSigning.publicKey,
    );
    await service.createDelegation(
      delegator.agentId,
      delegate.agentId,
      ['credential.verify'],
      [
        { type: 'action_scoped', parameters: { actions: ['verify'] } },
        {
          type: 'resource_scoped',
          parameters: {
            resourceIds: ['credential-allowed'],
            resourceTypes: ['credential'],
          },
        },
        { type: 'risk_bounded', parameters: { maxRiskLevel: 'medium' } },
        { type: 'rate_limited', parameters: { maxPerHour: 1, maxPerDay: 1 } },
      ],
      1,
      operatorId,
    );

    const verify = async (
      operationId: string,
      context: AgentVerificationRequest['context'],
    ) =>
      verifySignedOperation(
        service,
        delegateSigning,
        delegate.agentId,
        ['credential.verify'],
        {
          operationId,
          callerAgentId: delegator.agentId,
          purpose: 'constrained credential verification',
          ...context,
        },
      );

    const actionDenied = await verify('constraint-action-denied', {
      purpose: 'constrained credential verification',
      action: 'inspect',
      resourceId: 'credential-allowed',
      resourceType: 'credential',
    });
    expect(actionDenied.deniedCapabilities[0].reason).toContain(
      'delegation constraint',
    );

    const resourceDenied = await verify('constraint-resource-denied', {
      purpose: 'constrained credential verification',
      action: 'verify',
      resourceId: 'credential-denied',
      resourceType: 'credential',
    });
    expect(resourceDenied.deniedCapabilities[0].reason).toContain(
      'Resource ID',
    );

    const allowed = await verify('constraint-first-allowed', {
      purpose: 'constrained credential verification',
      action: 'verify',
      resourceId: 'credential-allowed',
      resourceType: 'credential',
    });
    expect(allowed).toMatchObject({
      verified: true,
      authorizedCapabilities: ['credential.verify'],
    });

    redisStore.clear();
    redisSets.clear();
    expect(mockDelegationRows.values().next().value).toMatchObject({
      status: 'ACTIVE',
      authorizationCount: 1,
      version: 0,
      toAgentId: delegate.agentId,
      capabilities: ['credential.verify'],
    });
    expect(
      mockAgentMatches(mockDelegationRows.values().next().value, {
        toAgentId: delegate.agentId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        capabilities: { has: 'credential.verify' },
      }),
    ).toBe(true);
    const rateDenied = await verify('constraint-rate-denied-after-restart', {
      purpose: 'constrained credential verification',
      action: 'verify',
      resourceId: 'credential-allowed',
      resourceType: 'credential',
    });
    expect(rateDenied.verified).toBe(false);
    expect(rateDenied.deniedCapabilities[0].reason).toContain('Rate limit');
    expect(Array.from(mockAuthorizationUsageRows.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ windowType: 'HOUR', count: 1 }),
        expect.objectContaining({ windowType: 'DAY', count: 1 }),
      ]),
    );
  });

  it('expires durable delegation rows and denies authorization', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const delegateSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Expiry Root',
      [delegatedCapability],
      rootSigning.publicKey,
    );
    const delegate = await registerServiceAgent(
      service,
      'Expiry Delegate',
      [],
      delegateSigning.publicKey,
    );
    const delegation = await service.createDelegation(
      root.agentId,
      delegate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    const persisted = mockDelegationRows.get(delegation.delegationId)!;
    persisted.createdAt = new Date(Date.now() - 2 * 3600_000);
    persisted.expiresAt = new Date(Date.now() - 3600_000);

    const verification = await verifySignedOperation(
      service,
      delegateSigning,
      delegate.agentId,
      ['credential.verify'],
      operationContext('expired-delegation', {
        callerAgentId: root.agentId,
        purpose: 'expired delegation must fail closed',
      }),
    );

    expect(verification.verified).toBe(false);
    expect(verification.delegationChain).toBeUndefined();
    expect(mockDelegationRows.get(delegation.delegationId)).toMatchObject({
      status: 'EXPIRED',
      version: 1,
    });
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
    const signedRequest = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      operationContext('capability-binding'),
    );

    await expect(
      service.verifyAgent(
        {
          ...signedRequest,
          requestedCapabilities: ['payment.release'],
        },
        operatorId,
      ),
    ).rejects.toMatchObject({
      code: 'AGENT_CHALLENGE_MISMATCH',
      statusCode: 400,
    });
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
    const request = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      operationContext('single-use-verification'),
    );

    const first = await service.verifyAgent(request, operatorId);

    expect(first.verified).toBe(true);
    await expect(
      service.verifyAgent(request, operatorId),
    ).rejects.toMatchObject({
      code: 'AGENT_CHALLENGE_ALREADY_USED',
      statusCode: 409,
    });
  });

  it('authorizes one non-approval operation exactly once across distinct challenges', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Operation Ledger Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const context = operationContext('one-durable-operation');
    const firstRequest = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      context,
    );
    const secondRequest = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      context,
    );

    const first = await service.verifyAgent(firstRequest, operatorId);
    const second = await service.verifyAgent(secondRequest, operatorId);

    expect(first.verified).toBe(true);
    expect(second).toMatchObject({
      verified: false,
      authorizedCapabilities: [],
    });
    expect(second.deniedCapabilities[0].reason).toContain(
      'already been authorized',
    );
    expect(Array.from(mockAuthorizationOperationRows.values())).toEqual([
      expect.objectContaining({
        agentId: agent.agentId,
        audienceId: operatorId,
        operationId: context.operationId,
        status: 'AUTHORIZED',
        authorizedChallengeId: firstRequest.challengeId,
      }),
    ]);
    await expect(
      service.issueVerificationChallenge(agent.agentId, operatorId, {
        requestedCapabilities: ['credential.verify'],
        context,
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_OPERATION_ALREADY_AUTHORIZED',
      statusCode: 409,
    });
  });

  it('retries the whole authorization transaction on an audit-tail conflict', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Audit Tail Retry Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const request = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      operationContext('audit-tail-retry'),
    );
    mockAuditLogCreate
      .mockRejectedValueOnce(
        Object.assign(new Error('Audit tail conflict'), {
          code: 'P2002',
          meta: { target: ['previousHash'] },
        }),
      )
      .mockResolvedValue({ id: 'audit-after-retry' });

    const result = await service.verifyAgent(request, operatorId);

    expect(result.verified).toBe(true);
    expect(mockChallengeRows.get(request.challengeId)).toMatchObject({
      status: 'CONSUMED',
      version: 1,
    });
    expect(Array.from(mockAuthorizationOperationRows.values())).toEqual([
      expect.objectContaining({ status: 'AUTHORIZED' }),
    ]);
  });

  it('fails challenge issuance and final authorization for inactive controllers', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const audienceId = 'identity-separate-audience';
    const agent = await registerServiceAgent(
      service,
      'Controller State Agent',
      [delegatedCapability],
      signing.publicKey,
    );

    mockIdentityFindUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      did:
        where.id === operatorId
          ? 'did:aethelred:operator'
          : `did:aethelred:${where.id}`,
      status: where.id === operatorId ? 'SUSPENDED' : 'ACTIVE',
    }));
    await expect(
      service.issueVerificationChallenge(agent.agentId, audienceId, {
        requestedCapabilities: ['credential.verify'],
        context: operationContext('inactive-controller-issuance'),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_CONTROLLER_INVALID',
      statusCode: 403,
    });

    mockIdentityFindUnique.mockResolvedValue({
      id: operatorId,
      did: 'did:aethelred:operator',
      status: 'ACTIVE',
    });
    const issued = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      operationContext('inactive-controller-commit'),
    );
    mockIdentityFindUnique.mockResolvedValue({
      id: operatorId,
      did: 'did:aethelred:operator',
      status: 'SUSPENDED',
    });

    const denied = await service.verifyAgent(issued, operatorId);
    expect(denied.verified).toBe(false);
    expect(denied.deniedCapabilities[0].reason).toContain(
      'controller identity is inactive',
    );
    expect(mockAuthorizationOperationRows).toHaveProperty('size', 0);
  });

  it('redeems an approved operation exactly once across separately issued challenges', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'One Time Approval Agent',
      [approvalCapability],
      signing.publicKey,
    );
    const context = operationContext('one-time-approved-release', {
      purpose: 'release one exact settlement',
      resourceId: 'payment-once',
      resourceType: 'payment',
      action: 'release',
    });
    const initial = await verifySignedOperation(
      service,
      signing,
      agent.agentId,
      ['payment.release'],
      context,
    );
    expect(initial).toMatchObject({ verified: false });
    expect(initial.approvalGroupId).toMatch(/^apg-[a-f0-9]{64}$/);
    const [approval] = await service.listPendingApprovals(operatorId);
    await service.respondToApproval(
      approval.requestId,
      operatorId,
      true,
      'Approve this bound settlement only',
    );

    const options = { approvalGroupId: initial.approvalGroupId! };
    const firstRequest = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['payment.release'],
      context,
      options,
    );
    const secondRequest = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['payment.release'],
      context,
      options,
    );
    const outcomes = [
      await service.verifyAgent(firstRequest, operatorId),
      await service.verifyAgent(secondRequest, operatorId),
    ];

    expect(outcomes.filter((outcome) => outcome.verified)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.verified)).toHaveLength(1);
    expect(mockApprovalRows.get(approval.requestId)).toMatchObject({
      status: 'CONSUMED',
      consumedAt: expect.any(Date),
      consumedByChallengeId: expect.stringMatching(/^ach-/),
    });
  });

  it('requires every upstream approval authority and rejects a leaf operator response', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const intermediateSigning = createSigningMaterial();
    const leafSigning = createSigningMaterial();
    const rootOperatorId = 'identity-root-operator';
    const intermediateOperatorId = 'identity-intermediate-operator';
    const leafOperatorId = 'identity-leaf-operator';
    const root = await registerServiceAgent(
      service,
      'Approval Root',
      [{ ...delegatedCapability, requiresApproval: true }],
      rootSigning.publicKey,
      3,
      rootOperatorId,
    );
    const intermediate = await registerServiceAgent(
      service,
      'Approval Intermediate',
      [],
      intermediateSigning.publicKey,
      3,
      intermediateOperatorId,
    );
    const leaf = await registerServiceAgent(
      service,
      'Approval Leaf',
      [],
      leafSigning.publicKey,
      3,
      leafOperatorId,
    );
    await service.createDelegation(
      root.agentId,
      intermediate.agentId,
      ['credential.verify'],
      [],
      2,
      rootOperatorId,
    );
    await service.createDelegation(
      intermediate.agentId,
      leaf.agentId,
      ['credential.verify'],
      [
        {
          type: 'approval_required',
          parameters: { reason: 'upstream review' },
        },
      ],
      2,
      intermediateOperatorId,
    );
    const context = operationContext('multi-authority-verification', {
      purpose: 'exercise every approval authority',
    });
    const initial = await verifySignedOperation(
      service,
      leafSigning,
      leaf.agentId,
      ['credential.verify'],
      context,
      { audienceId: leafOperatorId },
    );
    expect(initial.verified).toBe(false);

    const rootApprovals = await service.listPendingApprovals(rootOperatorId);
    const intermediateApprovals = await service.listPendingApprovals(
      intermediateOperatorId,
    );
    expect(rootApprovals).toHaveLength(1);
    expect(intermediateApprovals).toHaveLength(1);
    expect(rootApprovals[0].requiredApproverIds).toEqual([
      intermediateOperatorId,
      rootOperatorId,
    ]);
    await expect(
      service.respondToApproval(
        rootApprovals[0].requestId,
        leafOperatorId,
        true,
        'Leaf tries to approve root authority',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_APPROVAL', statusCode: 403 });

    await service.respondToApproval(
      rootApprovals[0].requestId,
      rootOperatorId,
      true,
      'Root authority approves',
    );
    await service.respondToApproval(
      intermediateApprovals[0].requestId,
      intermediateOperatorId,
      true,
      'Intermediate grantor approves',
    );
    const approved = await verifySignedOperation(
      service,
      leafSigning,
      leaf.agentId,
      ['credential.verify'],
      context,
      {
        audienceId: leafOperatorId,
        approvalGroupId: initial.approvalGroupId,
      },
    );
    expect(approved).toMatchObject({
      verified: true,
      authorizedCapabilities: ['credential.verify'],
    });
    expect(
      Array.from(mockApprovalRows.values()).every(
        (row) => row.status === 'CONSUMED',
      ),
    ).toBe(true);
  });

  it('fails closed when capability security state changes before commit', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const agent = await registerServiceAgent(
      service,
      'Capability CAS Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const request = await issueSignedVerification(
      service,
      signing,
      agent.agentId,
      ['credential.verify'],
      operationContext('capability-cas-race'),
    );
    mockPrismaTransaction.mockImplementationOnce(async (callback) => {
      const row = mockAgentRows.get(agent.agentId)!;
      row.capabilities = [];
      row.authorizationVersion += 1;
      return runMockTransaction(callback);
    });

    const result = await service.verifyAgent(request, operatorId);

    expect(result.verified).toBe(false);
    expect(result.deniedCapabilities[0].reason).toContain(
      'security state changed',
    );
    expect(mockChallengeRows.get(request.challengeId)?.status).toBe('CONSUMED');
    expect(mockAgentRows.get(agent.agentId)).toMatchObject({
      authorizationVersion: 1,
      capabilities: [],
    });
  });

  it('fails closed when a delegation is revoked before commit', async () => {
    const service = new AgentIdentityService();
    const rootSigning = createSigningMaterial();
    const leafSigning = createSigningMaterial();
    const root = await registerServiceAgent(
      service,
      'Delegation CAS Root',
      [delegatedCapability],
      rootSigning.publicKey,
    );
    const leaf = await registerServiceAgent(
      service,
      'Delegation CAS Leaf',
      [],
      leafSigning.publicKey,
    );
    const delegation = await service.createDelegation(
      root.agentId,
      leaf.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    const request = await issueSignedVerification(
      service,
      leafSigning,
      leaf.agentId,
      ['credential.verify'],
      operationContext('delegation-cas-race'),
    );
    mockPrismaTransaction.mockImplementationOnce(async (callback) => {
      const row = mockDelegationRows.get(delegation.delegationId)!;
      row.status = 'REVOKED';
      row.revokedAt = new Date();
      row.revokedBy = operatorId;
      row.version += 1;
      return runMockTransaction(callback);
    });

    const result = await service.verifyAgent(request, operatorId);

    expect(result.verified).toBe(false);
    expect(result.deniedCapabilities[0].reason).toContain('delegation changed');
    expect(mockChallengeRows.get(request.challengeId)?.status).toBe('CONSUMED');
    expect(mockDelegationRows.get(delegation.delegationId)).toMatchObject({
      status: 'REVOKED',
      version: 1,
      authorizationCount: 0,
    });
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
    const recovered = await new AgentIdentityService().getAgent(
      registered.agentId,
    );

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
    const result = await verifySignedOperation(
      writer,
      signing,
      registered.agentId,
      ['credential.verify'],
      operationContext('durable-statistics', {
        purpose: 'durable credential verification',
        resourceId: 'credential-durable-1',
      }),
    );
    expect(result.verified).toBe(true);

    redisStore.clear();
    redisSets.clear();
    const recovered = await new AgentIdentityService().getAgent(
      registered.agentId,
    );

    expect(recovered.stats).toMatchObject({
      totalActions: 1,
      successRate: 1,
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

  it('attributes and rate-limits cross-tenant invalid signatures without mutating the target', async () => {
    const service = new AgentIdentityService();
    const signing = createSigningMaterial();
    const delegateSigning = createSigningMaterial();
    const registered = await registerServiceAgent(
      service,
      'Signature Guard Agent',
      [delegatedCapability],
      signing.publicKey,
    );
    const delegate = await registerServiceAgent(
      service,
      'Signature Guard Delegate',
      [],
      delegateSigning.publicKey,
    );
    const delegation = await service.createDelegation(
      registered.agentId,
      delegate.agentId,
      ['credential.verify'],
      [],
      1,
      operatorId,
    );
    const invalidSignature = Buffer.alloc(64).toString('base64');
    const attackerId = 'identity-cross-tenant-attacker';

    for (let attempt = 1; attempt <= 20; attempt++) {
      const request = await issueSignedVerification(
        service,
        signing,
        registered.agentId,
        ['credential.verify'],
        operationContext(`invalid-signature-${attempt}`, {
          purpose: 'cross-tenant signature abuse test',
          resourceId: `credential-${attempt}`,
        }),
        { audienceId: attackerId },
      );
      const result = await service.verifyAgent(
        {
          ...request,
          signature: invalidSignature,
        },
        attackerId,
      );
      expect(result.verified).toBe(false);
    }

    expect(mockAgentRows.get(registered.agentId)).toMatchObject({
      status: 'ACTIVE',
      version: 0,
      authorizationVersion: 0,
      anomalyCount: 0,
      suspendedAt: null,
      suspendedBy: null,
    });
    expect(mockDelegationRows.get(delegation.delegationId)).toMatchObject({
      status: 'ACTIVE',
      version: 0,
      revokedAt: null,
      revokedBy: null,
    });
    expect(Array.from(mockVerificationFailureRows.values())).toEqual([
      expect.objectContaining({
        audienceId: attackerId,
        agentId: registered.agentId,
        count: 20,
      }),
    ]);
    const invalidSignatureAudits = mockAuditLogCreate.mock.calls.filter(
      ([entry]) =>
        entry.data.action === 'VERIFICATION_FAILED' &&
        entry.data.details?.reason === 'Signature verification failed',
    );
    expect(invalidSignatureAudits).toHaveLength(20);
    expect(
      invalidSignatureAudits.every(
        ([entry]) => entry.data.identityId === attackerId,
      ),
    ).toBe(true);
    await expect(
      service.issueVerificationChallenge(registered.agentId, attackerId, {
        requestedCapabilities: ['credential.verify'],
        context: operationContext('rate-limited-attacker'),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_AUDIENCE_RATE_LIMITED',
      statusCode: 429,
    });
    await expect(
      service.issueVerificationChallenge(delegate.agentId, attackerId, {
        requestedCapabilities: ['credential.verify'],
        context: operationContext('same-audience-different-target'),
      }),
    ).resolves.toMatchObject({
      agentId: delegate.agentId,
      audience: attackerId,
    });
  });
});
