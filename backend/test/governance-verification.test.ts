import express from "express";
import request from "supertest";

const mockSchemaFindUnique = jest.fn();
const mockSchemaUpdate = jest.fn();
const mockIdentityFindUnique = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockGetVerificationStatus = jest.fn();
const mockIsAttestationValid = jest.fn();
const mockTransaction = jest.fn();

jest.mock("../src/middleware/rateLimit", () => ({
  governanceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../src/runtime", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  prisma: {
    $transaction: mockTransaction,
    schemaGovernance: {
      findUnique: mockSchemaFindUnique,
      update: mockSchemaUpdate,
    },
    identity: {
      findUnique: mockIdentityFindUnique,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
  },
}));

jest.mock("../src/services/government-api", () => ({
  governmentAPIService: {
    getVerificationStatus: mockGetVerificationStatus,
  },
}));

jest.mock("../src/services/tee", () => ({
  teeService: {
    isAttestationValid: mockIsAttestationValid,
  },
}));

import { governanceRoutes } from "../src/routes/governance";

const SCHEMA_ID = "11111111-1111-4111-8111-111111111111";

type TestSchemaRecord = {
  id: string;
  status: "PROPOSED" | "APPROVED" | "DEPRECATED";
  voters: string[];
  proposedBy: string;
  approvalVotes: number;
  rejectionVotes: number;
};

function createApp(identityId = "voter-1") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).identity = {
      id: identityId,
      did: `did:aethelred:test:${identityId}`,
      publicKey: "pub",
      status: "ACTIVE",
    };
    next();
  });
  app.use("/governance", governanceRoutes);
  return app;
}

function proposedSchema(): TestSchemaRecord {
  return {
    id: SCHEMA_ID,
    status: "PROPOSED",
    voters: [],
    proposedBy: "proposer-1",
    approvalVotes: 0,
    rejectionVotes: 0,
  };
}

describe("governance voter verification freshness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchemaFindUnique.mockResolvedValue(proposedSchema());
    mockSchemaUpdate.mockResolvedValue({
      ...proposedSchema(),
      voters: ["voter-1"],
      approvalVotes: 1,
    });
    mockIdentityFindUnique.mockResolvedValue({
      teeAttestationId: "attestation-1",
    });
    mockIsAttestationValid.mockResolvedValue(false);
    mockGetVerificationStatus.mockResolvedValue(null);
    mockAuditLogCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(
      async (
        operation: (transaction: {
          schemaGovernance: {
            findUnique: typeof mockSchemaFindUnique;
            update: typeof mockSchemaUpdate;
          };
          auditLog: { create: typeof mockAuditLogCreate };
        }) => Promise<unknown>,
      ) =>
        operation({
          schemaGovernance: {
            findUnique: mockSchemaFindUnique,
            update: mockSchemaUpdate,
          },
          auditLog: { create: mockAuditLogCreate },
        }),
    );
  });

  it("rejects stale TEE and government verification flags without current evidence", async () => {
    await request(createApp())
      .post(`/governance/schemas/${SCHEMA_ID}/vote`)
      .send({ approve: true })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe("SCHEMA_VOTER_UNVERIFIED");
      });

    expect(mockIsAttestationValid).toHaveBeenCalledWith("attestation-1");
    expect(mockGetVerificationStatus).toHaveBeenCalledWith("voter-1");
    expect(mockSchemaUpdate).not.toHaveBeenCalled();
  });

  it("allows voting when current government verification evidence exists", async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      provider: "EMIRATES_ID",
      referenceId: "eid-current",
      verifiedFields: ["idNumber"],
      verifiedAt: new Date("2026-04-01T00:00:00.000Z"),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const response = await request(createApp())
      .post(`/governance/schemas/${SCHEMA_ID}/vote`)
      .send({ approve: true })
      .expect(200);

    expect(response.body.data.voters).toEqual(["voter-1"]);
    expect(mockSchemaUpdate).toHaveBeenCalledWith({
      where: { id: SCHEMA_ID },
      data: {
        voters: { push: "voter-1" },
        approvalVotes: { increment: 1 },
      },
    });
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SCHEMA_VOTE_CAST",
          details: expect.objectContaining({
            approve: true,
            finalStatus: "PROPOSED",
          }),
        }),
      }),
    );
  });

  it.each([
    {
      approve: true,
      envName: "SCHEMA_APPROVAL_THRESHOLD",
      terminalStatus: "APPROVED",
      auditAction: "SCHEMA_APPROVED",
    },
    {
      approve: false,
      envName: "SCHEMA_REJECTION_THRESHOLD",
      terminalStatus: "DEPRECATED",
      auditAction: "SCHEMA_REJECTED",
    },
  ] as const)(
    "uses $auditAction only when a vote reaches $terminalStatus",
    async ({ approve, envName, terminalStatus, auditAction }) => {
      const previousThreshold = process.env[envName];
      process.env[envName] = "1";
      mockGetVerificationStatus.mockResolvedValue({ verified: true });
      mockSchemaUpdate.mockImplementation(async ({ data }) => ({
        ...proposedSchema(),
        voters: ["voter-1"],
        approvalVotes: approve ? 1 : 0,
        rejectionVotes: approve ? 0 : 1,
        status: data.status,
      }));

      try {
        const response = await request(createApp())
          .post(`/governance/schemas/${SCHEMA_ID}/vote`)
          .send({ approve })
          .expect(200);

        expect(response.body.data.status).toBe(terminalStatus);
        expect(mockAuditLogCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action: auditAction }),
          }),
        );
      } finally {
        if (previousThreshold === undefined) delete process.env[envName];
        else process.env[envName] = previousThreshold;
      }
    },
  );

  it("uses SCHEMA_REVOKED when the owner deprecates a schema", async () => {
    const approved = {
      ...proposedSchema(),
      status: "APPROVED" as const,
      proposedBy: "voter-1",
      approvalVotes: 3,
    };
    mockSchemaFindUnique.mockResolvedValue(approved);
    mockSchemaUpdate.mockResolvedValue({ ...approved, status: "DEPRECATED" });

    await request(createApp())
      .patch(`/governance/schemas/${SCHEMA_ID}/deprecate`)
      .expect(200);

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SCHEMA_REVOKED",
          details: { action: "deprecate", previousStatus: "APPROVED" },
        }),
      }),
    );
  });

  it("serializes concurrent duplicate votes so only one vote and audit entry commit", async () => {
    mockGetVerificationStatus.mockResolvedValue({
      verified: true,
      provider: "EMIRATES_ID",
      referenceId: "eid-current",
      verifiedFields: ["idNumber"],
      verifiedAt: new Date("2026-04-01T00:00:00.000Z"),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    let persisted = proposedSchema();
    mockSchemaFindUnique.mockImplementation(async () => ({
      ...persisted,
      voters: [...persisted.voters],
    }));
    const committedAudits: unknown[] = [];
    let transactionQueue = Promise.resolve();

    mockTransaction.mockImplementation(
      (operation: (transaction: any) => Promise<unknown>) => {
        const result = transactionQueue.then(() =>
          operation({
            schemaGovernance: {
              findUnique: async () => ({
                ...persisted,
                voters: [...persisted.voters],
              }),
              update: async ({ data }: any) => {
                const voter = data.voters.push as string;
                persisted = {
                  ...persisted,
                  voters: [...persisted.voters, voter],
                  approvalVotes:
                    persisted.approvalVotes +
                    (data.approvalVotes?.increment ?? 0),
                  rejectionVotes:
                    persisted.rejectionVotes +
                    (data.rejectionVotes?.increment ?? 0),
                  status: data.status ?? persisted.status,
                };
                return { ...persisted, voters: [...persisted.voters] };
              },
            },
            auditLog: {
              create: async (entry: unknown) => {
                committedAudits.push(entry);
                return entry;
              },
            },
          }),
        );
        transactionQueue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );

    const [first, second] = await Promise.all([
      request(createApp())
        .post(`/governance/schemas/${SCHEMA_ID}/vote`)
        .send({ approve: true }),
      request(createApp())
        .post(`/governance/schemas/${SCHEMA_ID}/vote`)
        .send({ approve: true }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first.body.code, second.body.code].filter(Boolean)).toContain(
      "SCHEMA_ALREADY_VOTED",
    );
    expect(persisted.voters).toEqual(["voter-1"]);
    expect(persisted.approvalVotes).toBe(1);
    expect(committedAudits).toHaveLength(1);
    expect(committedAudits[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ action: "SCHEMA_VOTE_CAST" }),
      }),
    );
  });
});
