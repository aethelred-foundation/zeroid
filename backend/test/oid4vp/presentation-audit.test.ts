import type { PrismaClient } from "@prisma/client";
import { createPrismaPresentationAuditRecorder } from "@/services/oid4vp/presentation-audit";
import type { PresentationDecision } from "@/services/oid4vp/verifier";

function setup() {
  const findFirst = jest.fn();
  const create = jest.fn().mockResolvedValue({});
  const prisma = { auditLog: { findFirst, create } } as unknown as Pick<PrismaClient, "auditLog">;
  return { findFirst, create, prisma };
}

const ALLOWED: PresentationDecision = {
  status: "ALLOWED",
  policyId: "P",
  vct: "dc+sd-jwt",
  satisfied: {},
  reasons: [],
  disclosedClaims: ["resident_country", "risk_tier"],
  relyingAppId: "wallet",
  verifiedAt: "2026-06-29T00:00:00.000Z",
};

describe("createPrismaPresentationAuditRecorder", () => {
  it("records an ALLOWED presentation as VERIFICATION_COMPLETED, chained from the latest entry", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue({ entryHash: "a".repeat(64) });
    await createPrismaPresentationAuditRecorder(prisma)(ALLOWED);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "VERIFICATION_COMPLETED",
          resourceType: "oid4vp_presentation",
          previousHash: "a".repeat(64),
          entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          integrityVersion: "zeroid.audit.hash.v1",
        }),
      }),
    );
  });

  it("records a DENIED presentation as VERIFICATION_FAILED, genesis-chained when no prior entry", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue(null);
    await createPrismaPresentationAuditRecorder(prisma)({ ...ALLOWED, status: "DENIED" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "VERIFICATION_FAILED", previousHash: "0".repeat(64) }),
      }),
    );
  });

  it("records only claim NAMES (privacy) — never values — in the audit details", async () => {
    const { findFirst, create, prisma } = setup();
    findFirst.mockResolvedValue(null);
    await createPrismaPresentationAuditRecorder(prisma)(ALLOWED);
    const details = create.mock.calls[0][0].data.details;
    expect(details).toMatchObject({
      policyId: "P",
      status: "ALLOWED",
      disclosedClaims: ["resident_country", "risk_tier"],
    });
  });
});
