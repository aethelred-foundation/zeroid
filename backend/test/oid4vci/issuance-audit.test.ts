import type { PrismaClient } from "@prisma/client";
import { createPrismaIssuanceAuditRecorder } from "@/services/oid4vci/issuance-audit";

function setup() {
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue({});
  const prisma = { auditLog: { findFirst, create } } as unknown as Pick<PrismaClient, "auditLog">;
  return { create, prisma };
}

describe("createPrismaIssuanceAuditRecorder", () => {
  it("records CREDENTIAL_ISSUED with config + holder, hash-chained, never the credential material", async () => {
    const { create, prisma } = setup();
    await createPrismaIssuanceAuditRecorder(prisma)({
      configId: "regulated-eligibility-v1",
      vct: "https://credentials.zeroid/regulated-eligibility/v1",
      subjectDid: "did:z:alice",
      format: "dc+sd-jwt",
      issuedAt: "2026-06-30T00:00:00.000Z",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREDENTIAL_ISSUED",
          resourceType: "oid4vci_credential",
          entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          integrityVersion: "zeroid.audit.hash.v1",
        }),
      }),
    );
    const details = create.mock.calls[0][0].data.details;
    expect(details).toMatchObject({
      configId: "regulated-eligibility-v1",
      subjectDid: "did:z:alice",
      format: "dc+sd-jwt",
    });
    // never persist the SD-JWT credential (the '~'-delimited material)
    expect(JSON.stringify(details)).not.toContain("~");
  });
});
