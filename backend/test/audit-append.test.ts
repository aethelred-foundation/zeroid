import type { PrismaClient } from "@prisma/client";
import { AuditAction } from "@prisma/client";
import { appendAuditLog } from "@/services/audit-append";

function setup() {
  const findFirst = jest.fn();
  const create = jest.fn().mockResolvedValue({});
  const prisma = { auditLog: { findFirst, create } } as unknown as Pick<PrismaClient, "auditLog">;
  return { findFirst, create, prisma };
}

describe("appendAuditLog", () => {
  it("chains from the latest entryHash and writes the integrity fields", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue({ entryHash: "b".repeat(64) });
    await appendAuditLog(prisma, {
      action: AuditAction.CREDENTIAL_ISSUED,
      resourceType: "oid4vci_credential",
      details: { configId: "c" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREDENTIAL_ISSUED",
          resourceType: "oid4vci_credential",
          previousHash: "b".repeat(64),
          entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          integrityVersion: "zeroid.audit.hash.v1",
        }),
      }),
    );
  });

  it("uses genesis when there is no prior entry and generates a resourceId", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue(null);
    await appendAuditLog(prisma, { action: AuditAction.CREDENTIAL_ISSUED, resourceType: "rt", details: {} });
    const data = create.mock.calls[0][0].data;
    expect(data.previousHash).toBe("0".repeat(64));
    expect(typeof data.resourceId).toBe("string");
  });

  it("honors an explicit resourceId + identityId", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue(null);
    await appendAuditLog(prisma, {
      action: AuditAction.CREDENTIAL_ISSUED,
      resourceType: "rt",
      resourceId: "fixed",
      identityId: "id1",
      details: {},
    });
    const data = create.mock.calls[0][0].data;
    expect(data.resourceId).toBe("fixed");
    expect(data.identityId).toBe("id1");
  });
});
